/**
 * Dashboard aggregations.
 *
 * All helpers run client-side against Supabase (RLS-checked) — `userId`
 * is in the function signatures for self-documentation, but in practice
 * Supabase's `auth.uid()` already filters every query, so passing the
 * wrong id would still only return your own data.
 *
 * Bucketing depends on the period:
 *   today → hourly  (24 buckets)
 *   week  → daily   (7 buckets)
 *   month → daily   (~30 buckets)
 *   year  → monthly (12 buckets)
 *
 * Net-worth history is reconstructed by walking *backwards* from each
 * account's current balance and undoing the day's net change. It's an
 * approximation — accurate as long as no historical balance edits or
 * deletions happen — and it costs one query for the period instead of
 * needing daily snapshots.
 */
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  eachHourOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  format,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";

import { supabase } from "./supabase";
import {
  Period,
  periodRange,
  previousPeriodRange,
} from "@/stores/periodStore";

// ──────────────────────────────────────────────────────────────────────────
// Internal types
// ──────────────────────────────────────────────────────────────────────────
type RawTx = {
  id: string;
  amount: string;
  type: "income" | "expense" | "transfer";
  date: string;
  note: string | null;
  category_id: string | null;
  account_id: string;
};

type RawCategory = {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: "income" | "expense";
};

type RawAccount = {
  id: string;
  name: string;
  type: "cash" | "bank" | "credit" | "wallet" | "savings";
  balance: string;
  color: string;
  icon: string;
  archived: boolean;
};

// ──────────────────────────────────────────────────────────────────────────
// Bucketing helpers
// ──────────────────────────────────────────────────────────────────────────
function bucketKey(date: Date, period: Period): string {
  switch (period) {
    case "today": return format(date, "yyyy-MM-dd-HH");
    case "year":  return format(date, "yyyy-MM");
    default:      return format(date, "yyyy-MM-dd");
  }
}

function bucketsForPeriod(period: Period): {
  date: Date;
  key: string;
  label: string;
}[] {
  const { start, end } = periodRange(period);
  switch (period) {
    case "today":
      return eachHourOfInterval({ start, end }).map((d) => ({
        date: d,
        key: format(d, "yyyy-MM-dd-HH"),
        label: format(d, "ha"),
      }));
    case "year":
      return eachMonthOfInterval({ start, end }).map((d) => ({
        date: d,
        key: format(d, "yyyy-MM"),
        label: format(d, "MMM"),
      }));
    default:
      return eachDayOfInterval({ start, end }).map((d) => ({
        date: d,
        key: format(d, "yyyy-MM-dd"),
        label: format(d, "d"),
      }));
  }
}

async function fetchTransactions(start: Date, end: Date): Promise<RawTx[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,amount,type,date,note,category_id,account_id")
    .gte("date", start.toISOString())
    .lte("date", end.toISOString())
    .order("date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Total spent vs previous period
// ──────────────────────────────────────────────────────────────────────────
export type TotalSpent = {
  current: number;
  previous: number;
  /** Signed percentage change. Positive = spending went up. */
  changePct: number;
};

export async function getTotalSpent(
  _userId: string,
  period: Period,
): Promise<TotalSpent> {
  const cur = periodRange(period);
  const prev = previousPeriodRange(period);
  const [curTxs, prevTxs] = await Promise.all([
    fetchTransactions(cur.start, cur.end),
    fetchTransactions(prev.start, prev.end),
  ]);
  const sumExpense = (txs: RawTx[]) =>
    txs
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + Number(t.amount), 0);
  const current = sumExpense(curTxs);
  const previous = sumExpense(prevTxs);
  const changePct =
    previous === 0
      ? current === 0
        ? 0
        : 100
      : ((current - previous) / previous) * 100;
  return { current, previous, changePct };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Cash flow — income vs expense per bucket
// ──────────────────────────────────────────────────────────────────────────
export type CashFlowBucket = {
  label: string;
  date: Date;
  income: number;
  expense: number;
};

export type CashFlow = {
  buckets: CashFlowBucket[];
  totalIncome: number;
  totalExpense: number;
};

export async function getCashFlow(
  _userId: string,
  period: Period,
): Promise<CashFlow> {
  const { start, end } = periodRange(period);
  const txs = await fetchTransactions(start, end);
  const buckets = bucketsForPeriod(period);

  const incomeByKey = new Map<string, number>();
  const expenseByKey = new Map<string, number>();
  for (const t of txs) {
    const k = bucketKey(new Date(t.date), period);
    const v = Number(t.amount);
    if (t.type === "income") {
      incomeByKey.set(k, (incomeByKey.get(k) ?? 0) + v);
    } else if (t.type === "expense") {
      expenseByKey.set(k, (expenseByKey.get(k) ?? 0) + v);
    }
  }

  const out = buckets.map<CashFlowBucket>((b) => ({
    label: b.label,
    date: b.date,
    income: incomeByKey.get(b.key) ?? 0,
    expense: expenseByKey.get(b.key) ?? 0,
  }));

  return {
    buckets: out,
    totalIncome: out.reduce((s, b) => s + b.income, 0),
    totalExpense: out.reduce((s, b) => s + b.expense, 0),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Category breakdown — donut data
// ──────────────────────────────────────────────────────────────────────────
export type CategorySlice = {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  amount: number;
  pct: number;
};

export type CategoryBreakdown = {
  total: number;
  items: CategorySlice[];
};

export async function getCategoryBreakdown(
  _userId: string,
  period: Period,
): Promise<CategoryBreakdown> {
  const { start, end } = periodRange(period);
  const [txs, catRes] = await Promise.all([
    fetchTransactions(start, end),
    supabase.from("categories").select("id,name,color,icon,type"),
  ]);
  const cats = (catRes.data ?? []) as RawCategory[];
  const byCat = new Map<
    string,
    { name: string; color: string; icon: string; amount: number }
  >();

  for (const t of txs) {
    if (t.type !== "expense") continue;
    const cat = cats.find((c) => c.id === t.category_id);
    const key = t.category_id ?? "_uncat";
    const cur = byCat.get(key);
    byCat.set(key, {
      name: cat?.name ?? "Uncategorized",
      color: cat?.color ?? "#52525b",
      icon: cat?.icon ?? "circle",
      amount: (cur?.amount ?? 0) + Number(t.amount),
    });
  }

  const total = Array.from(byCat.values()).reduce((s, v) => s + v.amount, 0);
  const items = Array.from(byCat.entries())
    .map<CategorySlice>(([categoryId, v]) => ({
      categoryId,
      name: v.name,
      color: v.color,
      icon: v.icon,
      amount: v.amount,
      pct: total === 0 ? 0 : (v.amount / total) * 100,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { total, items };
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Daily spend trend (with average)
// ──────────────────────────────────────────────────────────────────────────
export type TrendPoint = { date: Date; label: string; amount: number };
export type DailyTrend = {
  points: TrendPoint[];
  average: number;
  max: number;
};

export async function getDailyTrend(
  _userId: string,
  period: Period,
): Promise<DailyTrend> {
  const { start, end } = periodRange(period);
  const txs = await fetchTransactions(start, end);
  const buckets = bucketsForPeriod(period);

  const byKey = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== "expense") continue;
    const k = bucketKey(new Date(t.date), period);
    byKey.set(k, (byKey.get(k) ?? 0) + Number(t.amount));
  }

  const points = buckets.map<TrendPoint>((b) => ({
    date: b.date,
    label: b.label,
    amount: byKey.get(b.key) ?? 0,
  }));

  const total = points.reduce((s, p) => s + p.amount, 0);
  const average = points.length > 0 ? total / points.length : 0;
  const max = points.reduce((m, p) => Math.max(m, p.amount), 0);

  return { points, average, max };
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Net-worth history (reconstructed from current balances + flows)
// ──────────────────────────────────────────────────────────────────────────
export type NetWorthPoint = { date: Date; value: number };
export type NetWorthHistory = {
  current: number;
  points: NetWorthPoint[];
  /** value(today) − value(start). Positive = net worth grew. */
  delta: number;
  deltaPct: number;
};

export async function getNetWorthHistory(
  _userId: string,
  days = 90,
): Promise<NetWorthHistory> {
  const today = new Date();
  const start = subDays(today, days - 1);

  const [accountsRes, txs] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,balance")
      .eq("archived", false),
    fetchTransactions(start, today),
  ]);

  const current = (accountsRes.data ?? []).reduce(
    (s, a) => s + Number(a.balance),
    0,
  );

  // Net change per day = income − expense (transfers cancel out across accounts)
  const netByDay = new Map<string, number>();
  for (const t of txs) {
    const k = format(new Date(t.date), "yyyy-MM-dd");
    const sign = t.type === "income" ? 1 : t.type === "expense" ? -1 : 0;
    netByDay.set(k, (netByDay.get(k) ?? 0) + sign * Number(t.amount));
  }

  // Walk backwards: balance at end-of-day d = balance at end-of-day d+1 − net(d+1)
  const dayList = eachDayOfInterval({ start, end: today });
  const points: NetWorthPoint[] = new Array(dayList.length);
  let value = current;
  for (let i = dayList.length - 1; i >= 0; i--) {
    points[i] = { date: dayList[i], value };
    const k = format(dayList[i], "yyyy-MM-dd");
    value -= netByDay.get(k) ?? 0;
  }

  const startValue = points[0]?.value ?? 0;
  const delta = current - startValue;
  const deltaPct =
    startValue === 0 ? (current === 0 ? 0 : 100) : (delta / startValue) * 100;

  return { current, points, delta, deltaPct };
}

// ──────────────────────────────────────────────────────────────────────────
// 6. Monthly totals (for the bar chart on the reports screen)
// ──────────────────────────────────────────────────────────────────────────
export type MonthlyTotal = {
  date: Date;
  label: string;
  total: number;
};

export async function getMonthlyTotals(
  _userId: string,
  months = 12,
): Promise<MonthlyTotal[]> {
  const today = new Date();
  const start = startOfMonth(subMonths(today, months - 1));
  const end = endOfMonth(today);

  const { data, error } = await supabase
    .from("transactions")
    .select("amount,type,date")
    .gte("date", start.toISOString())
    .lte("date", end.toISOString());
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const t of data ?? []) {
    if (t.type !== "expense") continue;
    const k = format(new Date(t.date), "yyyy-MM");
    totals.set(k, (totals.get(k) ?? 0) + Number(t.amount));
  }

  return eachMonthOfInterval({ start, end }).map<MonthlyTotal>((d) => ({
    date: d,
    label: format(d, "MMM"),
    total: totals.get(format(d, "yyyy-MM")) ?? 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// 7. Period summary — the four headline stats on the reports screen
// ──────────────────────────────────────────────────────────────────────────
export type PeriodSummary = {
  totalSpent: number;
  averageDaily: number;
  biggestExpense: {
    amount: number;
    note: string | null;
    date: Date;
    categoryId: string | null;
  } | null;
  mostFrequentCategory: {
    categoryId: string;
    name: string;
    color: string;
    icon: string;
    count: number;
  } | null;
};

export async function getPeriodSummary(
  _userId: string,
  period: Period,
): Promise<PeriodSummary> {
  const { start, end } = periodRange(period);
  const days = Math.max(1, differenceInCalendarDays(end, start) + 1);

  const [txs, catRes] = await Promise.all([
    fetchTransactions(start, end),
    supabase.from("categories").select("id,name,color,icon"),
  ]);
  const cats = (catRes.data ?? []) as RawCategory[];
  const expenses = txs.filter((t) => t.type === "expense");

  const totalSpent = expenses.reduce((s, t) => s + Number(t.amount), 0);
  const averageDaily = totalSpent / days;

  const biggest = expenses.reduce<RawTx | null>(
    (max, t) =>
      max == null || Number(t.amount) > Number(max.amount) ? t : max,
    null,
  );

  // Count by category, then pick the top.
  const counts = new Map<string, number>();
  for (const t of expenses) {
    if (!t.category_id) continue;
    counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1);
  }
  let topId: string | null = null;
  let topCount = 0;
  for (const [id, n] of counts.entries()) {
    if (n > topCount) {
      topCount = n;
      topId = id;
    }
  }
  const topCat = topId ? cats.find((c) => c.id === topId) ?? null : null;

  return {
    totalSpent,
    averageDaily,
    biggestExpense: biggest
      ? {
          amount: Number(biggest.amount),
          note: biggest.note ?? null,
          date: new Date(biggest.date),
          categoryId: biggest.category_id,
        }
      : null,
    mostFrequentCategory:
      topCat && topId
        ? {
            categoryId: topId,
            name: topCat.name,
            color: topCat.color,
            icon: topCat.icon,
            count: topCount,
          }
        : null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Bonus: accounts row with 30-day sparklines
// ──────────────────────────────────────────────────────────────────────────
export type AccountWithSparkline = {
  id: string;
  name: string;
  type: RawAccount["type"];
  balance: number;
  color: string;
  icon: string;
  sparkline: NetWorthPoint[];
};

export async function getAccountsWithSparklines(
  _userId: string,
  days = 30,
): Promise<AccountWithSparkline[]> {
  const today = new Date();
  const start = subDays(today, days - 1);

  const [accountsRes, txs] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,name,type,balance,color,icon,archived")
      .eq("archived", false)
      .order("created_at", { ascending: true }),
    fetchTransactions(start, today),
  ]);

  const dayList = eachDayOfInterval({ start, end: today });
  return ((accountsRes.data ?? []) as RawAccount[]).map((a) => {
    const accTxs = txs.filter((t) => t.account_id === a.id);
    const netByDay = new Map<string, number>();
    for (const t of accTxs) {
      const k = format(new Date(t.date), "yyyy-MM-dd");
      const sign = t.type === "income" ? 1 : t.type === "expense" ? -1 : 0;
      netByDay.set(k, (netByDay.get(k) ?? 0) + sign * Number(t.amount));
    }
    const sparkline: NetWorthPoint[] = new Array(dayList.length);
    let value = Number(a.balance);
    for (let i = dayList.length - 1; i >= 0; i--) {
      sparkline[i] = { date: dayList[i], value };
      const k = format(dayList[i], "yyyy-MM-dd");
      value -= netByDay.get(k) ?? 0;
    }
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      balance: Number(a.balance),
      color: a.color,
      icon: a.icon,
      sparkline,
    };
  });
}

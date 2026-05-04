/**
 * Local-notification helpers, primarily for budget threshold alerts.
 *
 * Flow:
 *   - `setupNotifications()` is called once from the root layout to install
 *     the foreground handler (Expo's default suppresses banners while the
 *     app is open).
 *   - `ensureNotificationPermissions()` lazily requests permission the first
 *     time we actually want to fire a notification.
 *   - `runBudgetCheck()` is called from every transaction-insert/edit
 *     mutation. It pulls the user's budgets + the relevant period's
 *     transactions through Supabase, computes spend %, and schedules
 *     "80%" or "100%" notifications for any thresholds that crossed since
 *     the last check.
 *
 * "Already notified for this period" is tracked in AsyncStorage so the
 * user gets each warning once per period (not on every save). Keys reset
 * naturally as the period rolls forward.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { supabase } from "./supabase";

let setupDone = false;

/** Install the foreground handler. Idempotent — safe to call repeatedly. */
export function setupNotifications(): void {
  if (setupDone) return;
  setupDone = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

// ──────────────────────────────────────────────────────────────────────────
// Budget threshold alerts
// ──────────────────────────────────────────────────────────────────────────
const THRESHOLDS = [80, 100] as const;
type Threshold = (typeof THRESHOLDS)[number];

export type BudgetForCheck = {
  id: string;
  amount: number;
  period: "weekly" | "monthly";
  spent: number;
  categoryName: string;
};

function periodKey(period: "weekly" | "monthly", ref: Date = new Date()): string {
  // Year + week number for weekly, year-month for monthly.
  if (period === "weekly") {
    const start = startOfWeek(ref, { weekStartsOn: 1 });
    return `W-${format(start, "yyyy-MM-dd")}`;
  }
  return `M-${format(ref, "yyyy-MM")}`;
}

function notifKey(budgetId: string, period: "weekly" | "monthly", t: Threshold): string {
  return `pulse.budget.notified.${budgetId}.${periodKey(period)}.${t}`;
}

/**
 * For each budget, check if its current spend has crossed an unannounced
 * threshold and schedule a one-shot notification if so.
 */
export async function checkBudgetThresholds(
  budgets: BudgetForCheck[],
): Promise<void> {
  if (budgets.length === 0) return;
  if (!(await ensureNotificationPermissions())) return;

  for (const b of budgets) {
    if (b.amount <= 0) continue;
    const pct = (b.spent / b.amount) * 100;
    for (const threshold of THRESHOLDS) {
      if (pct < threshold) continue;

      const key = notifKey(b.id, b.period, threshold);
      const already = await AsyncStorage.getItem(key);
      if (already) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title:
            threshold >= 100
              ? "Budget reached"
              : `You've used ${threshold}% of ${b.categoryName}`,
          body:
            threshold >= 100
              ? `You're at or over your ${b.categoryName} ${b.period} budget.`
              : `Heads-up — keep an eye on your ${b.categoryName} spend.`,
          data: { budgetId: b.id, threshold, periodKey: periodKey(b.period) },
        },
        trigger: null, // fire immediately
      });
      await AsyncStorage.setItem(key, "1");
    }
  }
}

/**
 * Convenience wrapper: pulls budgets + relevant period transactions from
 * Supabase, then runs `checkBudgetThresholds`. Safe to call on every save —
 * AsyncStorage de-duplicates the alerts.
 */
export async function runBudgetCheck(): Promise<void> {
  try {
    const today = new Date();
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

    const earliest = monthStart < weekStart ? monthStart : weekStart;
    const latest = monthEnd > weekEnd ? monthEnd : weekEnd;

    const [budgetsRes, txsRes] = await Promise.all([
      supabase
        .from("budgets")
        .select(`id, category_id, amount, period, category:categories(name)`),
      supabase
        .from("transactions")
        .select("amount, category_id, date")
        .eq("type", "expense")
        .gte("date", earliest.toISOString())
        .lte("date", latest.toISOString()),
    ]);

    if (budgetsRes.error || txsRes.error) return;
    const budgets = (budgetsRes.data ?? []) as Array<{
      id: string;
      category_id: string;
      amount: string;
      period: "weekly" | "monthly";
      category: { name: string } | null;
    }>;
    const txs = (txsRes.data ?? []) as Array<{
      amount: string;
      category_id: string | null;
      date: string;
    }>;

    const enriched: BudgetForCheck[] = budgets.map((b) => {
      const range =
        b.period === "weekly"
          ? { start: weekStart, end: weekEnd }
          : { start: monthStart, end: monthEnd };
      const spent = txs
        .filter((t) => {
          if (t.category_id !== b.category_id) return false;
          const d = new Date(t.date);
          return d >= range.start && d <= range.end;
        })
        .reduce((s, t) => s + Number(t.amount), 0);

      return {
        id: b.id,
        amount: Number(b.amount),
        period: b.period,
        spent,
        categoryName: b.category?.name ?? "your budget",
      };
    });

    await checkBudgetThresholds(enriched);
  } catch {
    // Notifications are a "nice to have" — never block the save path.
  }
}

/**
 * Drop the dedupe markers for a budget — call when the user edits the
 * budget amount so a previously-fired warning can fire again at the new
 * threshold within the same period.
 */
export async function clearBudgetNotifications(budgetId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const mine = keys.filter((k) =>
    k.startsWith(`pulse.budget.notified.${budgetId}.`),
  );
  if (mine.length) await AsyncStorage.multiRemove(mine);
}

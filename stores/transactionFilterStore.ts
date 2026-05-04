/**
 * Active filters for the Transactions screen.
 *
 * Held in a Zustand store so the screen, the filter sheet, and the chip
 * row all read/write the same source. The store also computes a stable
 * `hash()` for use as a TanStack Query key.
 *
 * Date filtering is preset-based (today / 7d / 30d / 90d / month / year).
 * `dateRange` resolves a preset to {start, end} on demand so the active
 * window slides forward each day without a manual refresh.
 */
import {
  startOfDay, endOfDay,
  startOfMonth, endOfMonth,
  startOfYear, endOfYear,
  subDays,
} from "date-fns";
import { create } from "zustand";

export type DatePreset =
  | "all"
  | "today"
  | "last7"
  | "last30"
  | "last90"
  | "month"
  | "year";

export type TxType = "income" | "expense" | "transfer";

export type TransactionFilter = {
  search: string;
  datePreset: DatePreset;
  accountIds: string[];
  categoryIds: string[];
  types: TxType[];
  amountMin: number | null;
  amountMax: number | null;
};

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all",    label: "All time"      },
  { value: "today",  label: "Today"         },
  { value: "last7",  label: "Last 7 days"   },
  { value: "last30", label: "Last 30 days"  },
  { value: "last90", label: "Last 90 days"  },
  { value: "month",  label: "This month"    },
  { value: "year",   label: "This year"     },
];

const EMPTY: TransactionFilter = {
  search: "",
  datePreset: "all",
  accountIds: [],
  categoryIds: [],
  types: [],
  amountMin: null,
  amountMax: null,
};

type State = {
  filter: TransactionFilter;
  setFilter: (patch: Partial<TransactionFilter>) => void;
  setSearch: (q: string) => void;
  reset: () => void;
};

export const useTransactionFilterStore = create<State>((set) => ({
  filter: EMPTY,
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  setSearch: (search) => set((s) => ({ filter: { ...s.filter, search } })),
  reset: () => set({ filter: EMPTY }),
}));

/** Resolve a preset to a concrete {start, end} window. `null` for "all". */
export function presetRange(p: DatePreset, ref: Date = new Date()): {
  start: Date;
  end: Date;
} | null {
  switch (p) {
    case "all":   return null;
    case "today": return { start: startOfDay(ref), end: endOfDay(ref) };
    case "last7": return { start: startOfDay(subDays(ref, 6)),  end: endOfDay(ref) };
    case "last30":return { start: startOfDay(subDays(ref, 29)), end: endOfDay(ref) };
    case "last90":return { start: startOfDay(subDays(ref, 89)), end: endOfDay(ref) };
    case "month": return { start: startOfMonth(ref), end: endOfMonth(ref) };
    case "year":  return { start: startOfYear(ref),  end: endOfYear(ref) };
  }
}

export function presetLabel(p: DatePreset): string {
  return DATE_PRESETS.find((x) => x.value === p)?.label ?? p;
}

/** Stable, JSON-able fingerprint for the filter — feed into queryKey. */
export function filterKey(f: TransactionFilter): string {
  return JSON.stringify({
    s: f.search.trim().toLowerCase(),
    d: f.datePreset,
    a: [...f.accountIds].sort(),
    c: [...f.categoryIds].sort(),
    t: [...f.types].sort(),
    mn: f.amountMin,
    mx: f.amountMax,
  });
}

/** Active chip descriptors for the filter chip row. */
export type FilterChip =
  | { kind: "search" }
  | { kind: "date" }
  | { kind: "type"; value: TxType }
  | { kind: "amount" }
  | { kind: "account"; id: string }
  | { kind: "category"; id: string };

export function chipsFor(f: TransactionFilter): FilterChip[] {
  const out: FilterChip[] = [];
  if (f.search.trim()) out.push({ kind: "search" });
  if (f.datePreset !== "all") out.push({ kind: "date" });
  for (const t of f.types) out.push({ kind: "type", value: t });
  if (f.amountMin != null || f.amountMax != null) out.push({ kind: "amount" });
  for (const id of f.accountIds) out.push({ kind: "account", id });
  for (const id of f.categoryIds) out.push({ kind: "category", id });
  return out;
}

/** Pure helper — returns a new filter with one chip removed. */
export function removeChip(
  f: TransactionFilter,
  chip: FilterChip,
): TransactionFilter {
  switch (chip.kind) {
    case "search":   return { ...f, search: "" };
    case "date":     return { ...f, datePreset: "all" };
    case "amount":   return { ...f, amountMin: null, amountMax: null };
    case "type":     return { ...f, types: f.types.filter((t) => t !== chip.value) };
    case "account":  return { ...f, accountIds: f.accountIds.filter((x) => x !== chip.id) };
    case "category": return { ...f, categoryIds: f.categoryIds.filter((x) => x !== chip.id) };
  }
}

/**
 * Global period selector. Every dashboard card reads from this store so a
 * single tap on the segmented pill rerenders the whole screen.
 *
 * Also exports two date-range helpers (`periodRange`, `previousPeriodRange`)
 * used by `lib/aggregations.ts` to build the SQL `gte/lte` filters.
 */
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from "date-fns";
import { create } from "zustand";

export type Period = "today" | "week" | "month" | "year";

type PeriodState = {
  period: Period;
  setPeriod: (p: Period) => void;
};

export const usePeriodStore = create<PeriodState>((set) => ({
  period: "month",
  setPeriod: (period) => set({ period }),
}));

export const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week",  label: "Week"  },
  { value: "month", label: "Month" },
  { value: "year",  label: "Year"  },
];

export function periodRange(p: Period, ref: Date = new Date()): {
  start: Date;
  end: Date;
} {
  switch (p) {
    case "today":
      return { start: startOfDay(ref), end: endOfDay(ref) };
    case "week":
      return {
        start: startOfWeek(ref, { weekStartsOn: 1 }),
        end: endOfWeek(ref, { weekStartsOn: 1 }),
      };
    case "month":
      return { start: startOfMonth(ref), end: endOfMonth(ref) };
    case "year":
      return { start: startOfYear(ref), end: endOfYear(ref) };
  }
}

export function previousPeriodRange(p: Period, ref: Date = new Date()): {
  start: Date;
  end: Date;
} {
  switch (p) {
    case "today":
      return periodRange("today", subDays(ref, 1));
    case "week":
      return periodRange("week", subWeeks(ref, 1));
    case "month":
      return periodRange("month", subMonths(ref, 1));
    case "year":
      return periodRange("year", subYears(ref, 1));
  }
}

export function periodLabel(p: Period): string {
  switch (p) {
    case "today": return "yesterday";
    case "week":  return "last week";
    case "month": return "last month";
    case "year":  return "last year";
  }
}

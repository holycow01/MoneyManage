/**
 * Reports — deeper analytics with three chart views.
 *
 * Period (Week / Month / Year / Custom) is local to this screen so it
 * doesn't fight the dashboard's selection. Three queries fan out:
 *
 *   - getCategoryBreakdown(period) → pie + categories CSV + filterable stats
 *   - getMonthlyTotals(12)         → bar (always last 12 months)
 *   - getNetWorthHistory(180)      → line
 *
 * Chart-type tabs cross-fade with Reanimated FadeIn. Tapping a category
 * legend filters the four stat cards to that category. The Export button
 * builds a CSV of the *active* chart's data and opens the OS share sheet.
 *
 * Custom range is wired through, but the date pickers themselves are
 * scoped out for now — Custom defaults to the last 90 days.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueries } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import {
  CartesianChart,
  Bar,
  Line,
  Pie,
  PolarChart,
} from "victory-native";
import { format, subDays } from "date-fns";
import {
  BarChart3,
  Check,
  Download,
  LineChart as LineIcon,
  PieChart as PieIcon,
} from "lucide-react-native";

import { formatAmount } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import {
  shareCSV,
  timestampedFilename,
  toCSV,
  type CsvRow,
} from "@/lib/csv";
import { Skeleton } from "@/components/Skeleton";
import {
  type CategoryBreakdown,
  type MonthlyTotal,
  type NetWorthHistory,
  type PeriodSummary,
  getCategoryBreakdown,
  getMonthlyTotals,
  getNetWorthHistory,
  getPeriodSummary,
} from "@/lib/aggregations";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Period, periodRange, usePeriodStore } from "@/stores/periodStore";

// Reports has its own period state so it doesn't clobber the dashboard.
type ReportPeriod = Period | "custom";
const REPORT_PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: "week",   label: "Week"   },
  { value: "month",  label: "Month"  },
  { value: "year",   label: "Year"   },
  { value: "custom", label: "Custom" },
];

type ChartType = "pie" | "bar" | "line";
const CHART_TYPES: { value: ChartType; label: string; icon: typeof PieIcon }[] = [
  { value: "pie",  label: "Pie",  icon: PieIcon  },
  { value: "bar",  label: "Bar",  icon: BarChart3 },
  { value: "line", label: "Line", icon: LineIcon },
];

const PALETTE = [
  "#10b981", // emerald
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#d946ef", // fuchsia
];

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function ReportsScreen() {
  // Personal mode — userId is unused by aggregation helpers (kept in their
  // signature for self-documentation only).
  const userId = "me";

  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("month");
  const [chart, setChart] = useState<ChartType>("pie");
  const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);

  // Map "custom" to last 90 days for now (no picker yet).
  const effectivePeriod: Period = reportPeriod === "custom" ? "month" : reportPeriod;

  const queries = useQueries({
    queries: [
      {
        queryKey: ["me"],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("users")
            .select("currency")
            .single();
          if (error) throw error;
          return data as { currency: string };
        },
      },
      {
        queryKey: ["report", "categories", effectivePeriod],
        queryFn: () => getCategoryBreakdown(userId, effectivePeriod),
        enabled: !!userId,
      },
      {
        queryKey: ["report", "monthly", 12],
        queryFn: () => getMonthlyTotals(userId, 12),
        enabled: !!userId,
      },
      {
        queryKey: ["report", "networth", 180],
        queryFn: () => getNetWorthHistory(userId, 180),
        enabled: !!userId,
      },
      {
        queryKey: ["report", "summary", effectivePeriod],
        queryFn: () => getPeriodSummary(userId, effectivePeriod),
        enabled: !!userId,
      },
    ],
  });

  const [meQ, catsQ, monthlyQ, netWorthQ, summaryQ] = queries;
  const currency = (meQ.data as { currency?: string })?.currency ?? "PKR";

  // Filter the headline stats when a legend chip is selected.
  const filteredStats = useMemo<PeriodSummary | undefined>(() => {
    const all = summaryQ.data as PeriodSummary | undefined;
    const cats = catsQ.data as CategoryBreakdown | undefined;
    if (!all) return undefined;
    if (!filterCategoryId || !cats) return all;
    const slice = cats.items.find((s) => s.categoryId === filterCategoryId);
    if (!slice) return all;
    return {
      totalSpent: slice.amount,
      averageDaily: slice.amount / Math.max(1, daysIn(effectivePeriod)),
      biggestExpense: null, // would require fetching tx-level data again
      mostFrequentCategory: {
        categoryId: slice.categoryId,
        name: slice.name,
        color: slice.color,
        icon: slice.icon,
        count: 0, // unknown from breakdown alone
      },
    };
  }, [summaryQ.data, catsQ.data, filterCategoryId, effectivePeriod]);

  const onExport = useCallback(async () => {
    Haptics.selectionAsync();
    const rows = csvRowsFor(chart, {
      categories: catsQ.data as CategoryBreakdown | undefined,
      monthly: monthlyQ.data as MonthlyTotal[] | undefined,
      netWorth: netWorthQ.data as NetWorthHistory | undefined,
    });
    if (!rows.length) {
      Alert.alert("Nothing to export", "There's no data in the current view.");
      return;
    }
    try {
      const ok = await shareCSV(timestampedFilename(`pulse-${chart}`), toCSV(rows));
      if (!ok) {
        Alert.alert("Sharing unavailable", "CSV saved to cache.");
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Please try again.");
    }
  }, [chart, catsQ.data, monthlyQ.data, netWorthQ.data]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View className="px-5 pt-2 pb-3">
          <Text
            style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
          >
            REPORTS
          </Text>
          <Text
            style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#f4f4f5", marginTop: 2 }}
          >
            Analytics
          </Text>
        </View>

        {/* Period segmented control */}
        <SegmentedRow<ReportPeriod>
          options={REPORT_PERIODS}
          value={reportPeriod}
          onChange={(v) => {
            Haptics.selectionAsync();
            setReportPeriod(v);
            setFilterCategoryId(null);
          }}
        />

        {/* Chart type tabs */}
        <View className="flex-row px-4 mt-3 mb-2" style={{ gap: 8 }}>
          {CHART_TYPES.map(({ value, label, icon: Icon }) => {
            const active = chart === value;
            return (
              <TouchableOpacity
                key={value}
                onPress={() => {
                  Haptics.selectionAsync();
                  setChart(value);
                }}
                activeOpacity={0.85}
                className="flex-1 h-10 items-center justify-center rounded-xl flex-row"
                style={{
                  borderWidth: 1,
                  borderColor: active ? EMERALD : "#27272a",
                  backgroundColor: active ? `${EMERALD}1a` : "transparent",
                }}
              >
                <Icon size={14} color={active ? EMERALD : "#f4f4f5"} />
                <Text
                  className="ml-2"
                  style={{
                    fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                    fontSize: 12,
                    color: active ? EMERALD : "#f4f4f5",
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Chart area */}
        <View className="px-4 mt-2">
          <View
            className="rounded-2xl bg-card border border-border p-4"
            style={{ minHeight: 320 }}
          >
            <Animated.View key={chart} entering={FadeIn.duration(180)}>
              {chart === "pie" ? (
                <PieView
                  data={catsQ.data as CategoryBreakdown | undefined}
                  loading={catsQ.isLoading}
                  currency={currency}
                  selectedId={filterCategoryId}
                  onToggle={(id) =>
                    setFilterCategoryId((prev) => (prev === id ? null : id))
                  }
                />
              ) : chart === "bar" ? (
                <BarView
                  data={monthlyQ.data as MonthlyTotal[] | undefined}
                  loading={monthlyQ.isLoading}
                  currency={currency}
                />
              ) : (
                <LineView
                  data={netWorthQ.data as NetWorthHistory | undefined}
                  loading={netWorthQ.isLoading}
                  currency={currency}
                />
              )}
            </Animated.View>
          </View>
        </View>

        {/* Stats grid */}
        <View className="px-4 mt-4 flex-row flex-wrap" style={{ gap: 12 }}>
          <StatCard
            label="Total Spent"
            value={
              filteredStats
                ? formatAmount(filteredStats.totalSpent, currency)
                : "—"
            }
            loading={summaryQ.isLoading}
          />
          <StatCard
            label="Avg Daily"
            value={
              filteredStats
                ? formatAmount(filteredStats.averageDaily, currency)
                : "—"
            }
            loading={summaryQ.isLoading}
          />
          <StatCard
            label="Biggest Expense"
            value={
              filteredStats?.biggestExpense
                ? formatAmount(filteredStats.biggestExpense.amount, currency)
                : "—"
            }
            sub={
              filteredStats?.biggestExpense?.note ??
              (filteredStats?.biggestExpense
                ? format(filteredStats.biggestExpense.date, "MMM d")
                : "")
            }
            loading={summaryQ.isLoading}
          />
          <StatCard
            label="Most Frequent"
            value={filteredStats?.mostFrequentCategory?.name ?? "—"}
            sub={
              filteredStats?.mostFrequentCategory
                ? `${filteredStats.mostFrequentCategory.count}× this period`
                : ""
            }
            color={filteredStats?.mostFrequentCategory?.color}
            loading={summaryQ.isLoading}
          />
        </View>

        {/* Export */}
        <View className="px-4 mt-5">
          <TouchableOpacity
            onPress={onExport}
            activeOpacity={0.85}
            className="h-12 items-center justify-center rounded-2xl flex-row"
            style={{ borderWidth: 1, borderColor: EMERALD }}
          >
            <Download size={16} color={EMERALD} />
            <Text
              className="ml-2"
              style={{ fontFamily: "Inter_700Bold", color: EMERALD, fontSize: 14 }}
            >
              Export current view as CSV
            </Text>
          </TouchableOpacity>
          <Text
            className="text-center mt-2"
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              color: ZINC_500,
            }}
          >
            Opens the system share sheet — save to Files, email, anywhere.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pie view
// ──────────────────────────────────────────────────────────────────────────
function PieView({
  data,
  loading,
  currency,
  selectedId,
  onToggle,
}: {
  data: CategoryBreakdown | undefined;
  loading: boolean;
  currency: string;
  selectedId: string | null;
  onToggle: (id: string) => void;
}) {
  if (loading || !data) return <ChartSkeleton />;

  const top = data.items.slice(0, 6).map((s, i) => ({
    name: s.name,
    amount: s.amount,
    color: PALETTE[i % PALETTE.length], // honor the spec palette order
    categoryId: s.categoryId,
    icon: s.icon,
    pct: s.pct,
  }));

  return (
    <View>
      <View
        style={{
          height: 220,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {top.length === 0 ? (
          <Text
            style={{ fontFamily: "Inter_500Medium", color: ZINC_400 }}
          >
            No expenses in this period.
          </Text>
        ) : (
          <View style={{ width: 220, height: 220 }}>
            <PolarChart
              data={top.map((s) => ({
                name: s.name,
                amount: s.amount,
                color: s.color,
              }))}
              labelKey="name"
              valueKey="amount"
              colorKey="color"
            >
              <Pie.Chart innerRadius="62%">
                {() => <Pie.Slice />}
              </Pie.Chart>
            </PolarChart>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ fontFamily: "Inter_500Medium", fontSize: 10, color: ZINC_400 }}
              >
                TOTAL
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 18,
                  color: "#f4f4f5",
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatAmount(data.total, currency)}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Legend (tappable filter) */}
      <View className="mt-3" style={{ gap: 8 }}>
        {top.map((s) => {
          const Icon = getLucideIcon(s.icon);
          const active = selectedId === s.categoryId;
          return (
            <Pressable
              key={s.categoryId}
              onPress={() => onToggle(s.categoryId)}
              className="flex-row items-center px-2 py-1.5 rounded-xl"
              style={{
                backgroundColor: active ? `${EMERALD}1a` : "transparent",
                borderWidth: 1,
                borderColor: active ? EMERALD : "transparent",
              }}
            >
              <View
                style={{
                  height: 10,
                  width: 10,
                  borderRadius: 5,
                  backgroundColor: s.color,
                  marginRight: 8,
                }}
              />
              <Icon size={14} color={ZINC_400} />
              <Text
                className="ml-2 flex-1"
                style={{
                  fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                  fontSize: 13,
                  color: active ? EMERALD : "#f4f4f5",
                }}
                numberOfLines={1}
              >
                {s.name}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                  color: ZINC_400,
                  marginRight: 8,
                }}
              >
                {s.pct.toFixed(0)}%
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 13,
                  color: "#f4f4f5",
                }}
              >
                {formatAmount(s.amount, currency)}
              </Text>
              {active ? (
                <Check size={14} color={EMERALD} style={{ marginLeft: 6 }} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Bar view (last 12 months)
// ──────────────────────────────────────────────────────────────────────────
function BarView({
  data,
  loading,
  currency,
}: {
  data: MonthlyTotal[] | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading || !data) return <ChartSkeleton />;
  const total = data.reduce((s, m) => s + m.total, 0);
  const max = data.reduce((m, d) => Math.max(m, d.total), 0);

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
        >
          LAST 12 MONTHS
        </Text>
        <Text
          style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#f4f4f5" }}
        >
          {formatAmount(total, currency)}
        </Text>
      </View>
      <View style={{ height: 220 }}>
        <CartesianChart
          data={data.map((d, i) => ({ i, label: d.label, total: d.total }))}
          xKey="i"
          yKeys={["total"]}
          domainPadding={{ left: 12, right: 12, top: 16 }}
        >
          {({ points, chartBounds }) => (
            <Bar
              points={points.total}
              chartBounds={chartBounds}
              color={EMERALD}
              roundedCorners={{ topLeft: 4, topRight: 4 }}
              animate={{ type: "timing", duration: 500 }}
            />
          )}
        </CartesianChart>
      </View>
      <Text
        className="text-center mt-2"
        style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_500 }}
      >
        Peak: {formatAmount(max, currency)}
      </Text>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Line view (net worth)
// ──────────────────────────────────────────────────────────────────────────
function LineView({
  data,
  loading,
  currency,
}: {
  data: NetWorthHistory | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading || !data) return <ChartSkeleton />;
  const up = data.delta >= 0;
  const trendColor = up ? EMERALD : "#f43f5e";

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
        >
          NET WORTH · LAST 180 DAYS
        </Text>
        <Text
          style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: trendColor }}
        >
          {up ? "+" : ""}
          {formatAmount(data.delta, currency)}
        </Text>
      </View>
      <Text
        style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#f4f4f5" }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatAmount(data.current, currency)}
      </Text>
      <View style={{ height: 200, marginTop: 8 }}>
        <CartesianChart
          data={data.points.map((p, i) => ({ i, value: p.value }))}
          xKey="i"
          yKeys={["value"]}
        >
          {({ points }) => (
            <Line
              points={points.value}
              color={trendColor}
              strokeWidth={2}
              curveType="cardinal"
              animate={{ type: "timing", duration: 500 }}
            />
          )}
        </CartesianChart>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Stat cards + segmented row
// ──────────────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  color,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  loading?: boolean;
}) {
  return (
    <View
      className="rounded-2xl bg-card border border-border p-4"
      style={{ flexBasis: "47.5%", flexGrow: 1 }}
    >
      <Text
        style={{
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          color: ZINC_500,
          letterSpacing: 0.6,
        }}
      >
        {label.toUpperCase()}
      </Text>
      {loading ? (
        <Skeleton style={{ height: 22, marginTop: 8 }} />
      ) : (
        <>
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 22,
              color: color ?? "#f4f4f5",
              marginTop: 4,
            }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {value}
          </Text>
          {sub ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 11,
                color: ZINC_400,
                marginTop: 2,
              }}
            >
              {sub}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function SegmentedRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [width, setWidth] = useState(0);
  const idx = options.findIndex((o) => o.value === value);
  const indicatorX = useSharedValue(0);
  const slot = width / options.length;
  if (slot && Math.abs(indicatorX.value - idx * slot) > 0.5) {
    indicatorX.value = withSpring(idx * slot, { damping: 18, stiffness: 220 });
  }
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
    width: slot,
  }));
  return (
    <View className="px-4">
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        className="h-10 flex-row rounded-full bg-card border border-border p-1"
      >
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 4,
              bottom: 4,
              left: 4,
              borderRadius: 999,
              backgroundColor: EMERALD,
            },
            indicatorStyle,
          ]}
        />
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              className="flex-1 items-center justify-center"
            >
              <Text
                style={{
                  fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                  fontSize: 13,
                  color: active ? "#09090b" : ZINC_400,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ChartSkeleton() {
  return (
    <View>
      <Skeleton style={{ height: 14, width: 100 }} />
      <Skeleton style={{ height: 220, marginTop: 12, borderRadius: 12 }} />
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function daysIn(p: Period): number {
  const r = periodRange(p);
  return Math.max(1, Math.round((+r.end - +r.start) / 86400000));
}

function csvRowsFor(
  chart: ChartType,
  data: {
    categories?: CategoryBreakdown;
    monthly?: MonthlyTotal[];
    netWorth?: NetWorthHistory;
  },
): CsvRow[] {
  if (chart === "pie") {
    return (data.categories?.items ?? []).map((s) => ({
      category: s.name,
      amount: s.amount.toFixed(2),
      percentage: s.pct.toFixed(2),
    }));
  }
  if (chart === "bar") {
    return (data.monthly ?? []).map((m) => ({
      month: format(m.date, "yyyy-MM"),
      total: m.total.toFixed(2),
    }));
  }
  return (data.netWorth?.points ?? []).map((p) => ({
    date: format(p.date, "yyyy-MM-dd"),
    net_worth: p.value.toFixed(2),
  }));
}

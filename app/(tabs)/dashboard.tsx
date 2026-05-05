/**
 * Dashboard — the "wow" screen.
 *
 * One global period (Today / Week / Month / Year) drives every card. Tap
 * the pill at the top → every query in the screen rerenders. Pull-to-
 * refresh re-runs them all.
 *
 * Charts use Victory Native XL (Skia under the hood). We keep them
 * font-less and axis-less by design — the cards have their own labels
 * around the chart, which keeps the visuals clean on dark.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { CartesianChart, Line, Area, Pie, PolarChart } from "victory-native";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount, formatNumber, symbolFor } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import { useCountUp } from "@/lib/useCountUp";
import { Skeleton } from "@/components/Skeleton";
import {
  PERIODS,
  Period,
  periodLabel,
  usePeriodStore,
} from "@/stores/periodStore";
import {
  AccountWithSparkline,
  CashFlow,
  CategoryBreakdown,
  DailyTrend,
  NetWorthHistory,
  TotalSpent,
  getAccountsWithSparklines,
  getCashFlow,
  getCategoryBreakdown,
  getDailyTrend,
  getNetWorthHistory,
  getTotalSpent,
} from "@/lib/aggregations";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";
const ZINC_400 = "#a1a1aa";
const ZINC_700 = "#3f3f46";

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const period = usePeriodStore((s) => s.period);

  // Personal mode — there's only one user; the helpers ignore the id.
  const userId = "me";

  const queries = useQueries({
    queries: [
      {
        queryKey: ["me"],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("users")
            .select("currency,name")
            .single();
          if (error) throw error;
          return data as { currency: string; name: string | null };
        },
      },
      {
        queryKey: ["dash", "total", period],
        queryFn: () => getTotalSpent(userId, period),
        enabled: !!userId,
      },
      {
        queryKey: ["dash", "cashflow", period],
        queryFn: () => getCashFlow(userId, period),
        enabled: !!userId,
      },
      {
        queryKey: ["dash", "categories", period],
        queryFn: () => getCategoryBreakdown(userId, period),
        enabled: !!userId,
      },
      {
        queryKey: ["dash", "trend", period],
        queryFn: () => getDailyTrend(userId, period),
        enabled: !!userId,
      },
      {
        queryKey: ["dash", "networth"],
        queryFn: () => getNetWorthHistory(userId, 90),
        enabled: !!userId,
      },
      {
        queryKey: ["dash", "accountsSpark"],
        queryFn: () => getAccountsWithSparklines(userId, 30),
        enabled: !!userId,
      },
      {
        queryKey: ["insights", "latest"],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("insights")
            .select("id,type,message,created_at,dismissed")
            .eq("dismissed", false)
            .order("created_at", { ascending: false })
            .limit(1);
          if (error) throw error;
          return data?.[0] ?? null;
        },
      },
    ],
  });

  const [meQ, totalQ, cashflowQ, categoriesQ, trendQ, netWorthQ, accountsSparkQ, insightQ] =
    queries;

  const currency = (meQ.data as { currency?: string })?.currency ?? "PKR";
  const firstName = useMemo(() => {
    const full = (meQ.data as { name?: string | null })?.name;
    if (!full) return "there";
    return full.split(" ")[0];
  }, [meQ.data]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["dash"] }),
      qc.invalidateQueries({ queryKey: ["insights"] }),
      qc.invalidateQueries({ queryKey: ["me"] }),
    ]);
    setRefreshing(false);
  }, [qc]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={EMERALD}
          />
        }
      >
        {/* Header */}
        <View className="px-5 pt-2 pb-4">
          <Text
            className="text-xs"
            style={{ fontFamily: "Inter_500Medium", color: ZINC_400 }}
          >
            DASHBOARD
          </Text>
          <Text
            className="text-foreground mt-1 text-2xl"
            style={{ fontFamily: "Inter_700Bold" }}
          >
            Hey {firstName} <Text style={{ fontSize: 22 }}>👋</Text>
          </Text>
        </View>

        <PeriodPill />

        <View className="px-4 mt-4 gap-4" style={{ gap: 16 }}>
          <HeroCard
            data={totalQ.data as TotalSpent | undefined}
            loading={totalQ.isLoading}
            currency={currency}
            period={period}
          />

          <CashFlowCard
            data={cashflowQ.data as CashFlow | undefined}
            loading={cashflowQ.isLoading}
            currency={currency}
          />

          <TopCategoriesCard
            data={categoriesQ.data as CategoryBreakdown | undefined}
            loading={categoriesQ.isLoading}
            currency={currency}
            onPressItem={(id) => router.push(`/transactions?category=${id}`)}
          />

          <TrendCard
            data={trendQ.data as DailyTrend | undefined}
            loading={trendQ.isLoading}
            currency={currency}
          />

          <NetWorthCard
            data={netWorthQ.data as NetWorthHistory | undefined}
            loading={netWorthQ.isLoading}
            currency={currency}
          />

          <AccountsRow
            data={accountsSparkQ.data as AccountWithSparkline[] | undefined}
            loading={accountsSparkQ.isLoading}
            currency={currency}
          />

          <InsightsTeaser
            insight={insightQ.data as { message: string } | null | undefined}
            loading={insightQ.isLoading}
            onPress={() => router.push("/insights")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Period pill
// ──────────────────────────────────────────────────────────────────────────
function PeriodPill() {
  const period = usePeriodStore((s) => s.period);
  const setPeriod = usePeriodStore((s) => s.setPeriod);
  const [width, setWidth] = useState(0);

  const idx = PERIODS.findIndex((p) => p.value === period);
  const indicatorX = useSharedValue(0);
  const slot = width / PERIODS.length;

  if (slot && Math.abs(indicatorX.value - idx * slot) > 0.5) {
    indicatorX.value = withSpring(idx * slot, {
      damping: 18,
      stiffness: 220,
    });
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
        {PERIODS.map((p) => {
          const active = p.value === period;
          return (
            <Pressable
              key={p.value}
              onPress={() => {
                Haptics.selectionAsync();
                setPeriod(p.value);
              }}
              className="flex-1 items-center justify-center"
            >
              <Text
                style={{
                  fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                  fontSize: 13,
                  color: active ? "#09090b" : ZINC_400,
                }}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero — total spent
// ──────────────────────────────────────────────────────────────────────────
function HeroCard({
  data,
  loading,
  currency,
  period,
}: {
  data: TotalSpent | undefined;
  loading: boolean;
  currency: string;
  period: Period;
}) {
  const animatedTotal = useCountUp(data?.current ?? 0);
  if (loading || !data) {
    return (
      <Card>
        <Skeleton style={{ height: 14, width: 80 }} />
        <Skeleton style={{ height: 44, width: 200, marginTop: 12 }} />
        <Skeleton style={{ height: 24, width: 140, marginTop: 14, borderRadius: 999 }} />
      </Card>
    );
  }

  const up = data.changePct > 0;
  const Trend = up ? TrendingUp : TrendingDown;
  const pillColor = up ? ROSE : EMERALD; // up = bad (more spending)

  return (
    <Card padding={20}>
      <LinearGradient
        colors={["rgba(16,185,129,0.18)", "rgba(9,9,11,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: "absolute",
          inset: 0 as any,
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          borderRadius: 20,
        }}
      />

      <Text
        style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: ZINC_400 }}
      >
        TOTAL SPENT · {periodWord(period)}
      </Text>

      <View className="flex-row items-baseline mt-2">
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 22,
            color: "#f4f4f5",
            marginRight: 6,
          }}
        >
          {symbolFor(currency).trim()}
        </Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 44,
            color: "#f4f4f5",
            lineHeight: 50,
          }}
        >
          {formatNumber(animatedTotal)}
        </Text>
      </View>

      <View className="flex-row items-center mt-3">
        <View
          className="flex-row items-center px-2 py-1 rounded-full"
          style={{ backgroundColor: `${pillColor}1f` }}
        >
          <Trend size={14} color={pillColor} />
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 12,
              color: pillColor,
              marginLeft: 4,
            }}
          >
            {(up ? "↑" : "↓") + " " + Math.abs(data.changePct).toFixed(0) + "%"}
          </Text>
        </View>
        <Text
          className="ml-2"
          style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: ZINC_400 }}
        >
          vs {periodLabel(period)}
        </Text>
      </View>
    </Card>
  );
}

function periodWord(p: Period) {
  return p === "today" ? "TODAY" : p.toUpperCase();
}

// ──────────────────────────────────────────────────────────────────────────
// Cash flow
// ──────────────────────────────────────────────────────────────────────────
function CashFlowCard({
  data,
  loading,
  currency,
}: {
  data: CashFlow | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading || !data) {
    return (
      <Card>
        <Skeleton style={{ height: 14, width: 100 }} />
        <Skeleton style={{ height: 120, marginTop: 16, borderRadius: 12 }} />
      </Card>
    );
  }

  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: ZINC_400 }}
        >
          CASH FLOW
        </Text>
        <View className="flex-row">
          <LegendDot color={EMERALD} label="In" />
          <View className="w-3" />
          <LegendDot color={ROSE} label="Out" />
        </View>
      </View>

      <View style={{ height: 140, marginTop: 16 }}>
        <CartesianChart
          data={data.buckets.map((b, i) => ({
            i,
            label: b.label,
            income: b.income,
            expense: b.expense,
          }))}
          xKey="i"
          yKeys={["income", "expense"]}
          domainPadding={{ top: 12, bottom: 4 }}
        >
          {({ points, chartBounds }) => (
            <>
              <Area
                points={points.income}
                y0={chartBounds.bottom}
                color={EMERALD}
                opacity={0.18}
                animate={{ type: "timing", duration: 500 }}
              />
              <Line
                points={points.income}
                color={EMERALD}
                strokeWidth={2}
                curveType="cardinal"
                animate={{ type: "timing", duration: 500 }}
              />
              <Area
                points={points.expense}
                y0={chartBounds.bottom}
                color={ROSE}
                opacity={0.15}
                animate={{ type: "timing", duration: 500 }}
              />
              <Line
                points={points.expense}
                color={ROSE}
                strokeWidth={2}
                curveType="cardinal"
                animate={{ type: "timing", duration: 500 }}
              />
            </>
          )}
        </CartesianChart>
      </View>

      <View className="flex-row justify-between mt-4">
        <View>
          <Text
            style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
          >
            Income
          </Text>
          <Text
            style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: EMERALD }}
          >
            {formatAmount(data.totalIncome, currency)}
          </Text>
        </View>
        <View className="items-end">
          <Text
            style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
          >
            Expense
          </Text>
          <Text
            style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: ROSE }}
          >
            {formatAmount(data.totalExpense, currency)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top categories
// ──────────────────────────────────────────────────────────────────────────
function TopCategoriesCard({
  data,
  loading,
  currency,
  onPressItem,
}: {
  data: CategoryBreakdown | undefined;
  loading: boolean;
  currency: string;
  onPressItem: (id: string) => void;
}) {
  const animatedTotal = useCountUp(data?.total ?? 0);

  if (loading || !data) {
    return (
      <Card>
        <Skeleton style={{ height: 14, width: 120 }} />
        <Skeleton style={{ height: 160, width: 160, alignSelf: "center", marginTop: 12, borderRadius: 999 }} />
        <View style={{ marginTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 16, marginTop: 10 }} />
          ))}
        </View>
      </Card>
    );
  }

  const top = data.items.slice(0, 5);

  return (
    <Card>
      <Text
        style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: ZINC_400 }}
      >
        TOP CATEGORIES
      </Text>

      <View style={{ height: 200, marginTop: 8, alignItems: "center", justifyContent: "center" }}>
        {data.items.length === 0 ? (
          <Text
            style={{ fontFamily: "Inter_500Medium", color: ZINC_400 }}
          >
            No expenses in this period.
          </Text>
        ) : (
          <View style={{ width: 200, height: 200 }}>
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
                inset: 0 as any,
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                  color: ZINC_400,
                }}
              >
                TOTAL
              </Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 20,
                  color: "#f4f4f5",
                  maxWidth: 110,
                }}
              >
                {formatAmount(animatedTotal, currency)}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View className="mt-2">
        {top.map((s) => (
          <CategoryLegendRow
            key={s.categoryId}
            slice={s}
            currency={currency}
            onPress={() => onPressItem(s.categoryId)}
          />
        ))}
      </View>
    </Card>
  );
}

function CategoryLegendRow({
  slice,
  currency,
  onPress,
}: {
  slice: CategoryBreakdown["items"][number];
  currency: string;
  onPress: () => void;
}) {
  const Icon = getLucideIcon(slice.icon);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      className="flex-row items-center py-2"
    >
      <View
        className="h-8 w-8 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${slice.color}26` }}
      >
        <Icon size={16} color={slice.color} />
      </View>
      <View className="flex-1">
        <Text
          style={{ fontFamily: "Inter_600SemiBold", color: "#f4f4f5", fontSize: 14 }}
        >
          {slice.name}
        </Text>
        <Text
          style={{ fontFamily: "Inter_500Medium", color: ZINC_400, fontSize: 11 }}
        >
          {slice.pct.toFixed(0)}%
        </Text>
      </View>
      <Text
        style={{ fontFamily: "Inter_700Bold", color: "#f4f4f5", fontSize: 14 }}
      >
        {formatAmount(slice.amount, currency)}
      </Text>
      <ChevronRight size={16} color={ZINC_400} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Spending trend
// ──────────────────────────────────────────────────────────────────────────
function TrendCard({
  data,
  loading,
  currency,
}: {
  data: DailyTrend | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading || !data) {
    return (
      <Card>
        <Skeleton style={{ height: 14, width: 120 }} />
        <Skeleton style={{ height: 120, marginTop: 16, borderRadius: 12 }} />
      </Card>
    );
  }
  const chartData = data.points.map((p, i) => ({
    i,
    amount: p.amount,
    avg: data.average,
  }));

  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: ZINC_400 }}
        >
          SPENDING TREND
        </Text>
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
        >
          avg {formatAmount(data.average, currency)}
        </Text>
      </View>
      <View style={{ height: 120, marginTop: 12 }}>
        <CartesianChart
          data={chartData}
          xKey="i"
          yKeys={["amount", "avg"]}
          domainPadding={{ top: 12, bottom: 4 }}
        >
          {({ points }) => (
            <>
              <Line
                points={points.avg}
                color={ZINC_700}
                strokeWidth={1}
                strokeDashArray={[4, 4]}
              />
              <Line
                points={points.amount}
                color={EMERALD}
                strokeWidth={2}
                curveType="cardinal"
                animate={{ type: "timing", duration: 500 }}
              />
            </>
          )}
        </CartesianChart>
      </View>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Net worth
// ──────────────────────────────────────────────────────────────────────────
function NetWorthCard({
  data,
  loading,
  currency,
}: {
  data: NetWorthHistory | undefined;
  loading: boolean;
  currency: string;
}) {
  const animatedValue = useCountUp(data?.current ?? 0);
  if (loading || !data) {
    return (
      <Card>
        <Skeleton style={{ height: 14, width: 100 }} />
        <Skeleton style={{ height: 36, width: 200, marginTop: 12 }} />
        <Skeleton style={{ height: 80, marginTop: 16, borderRadius: 12 }} />
      </Card>
    );
  }

  const up = data.delta >= 0;
  const ArrowIcon = up ? ArrowUpRight : ArrowDownRight;
  const trendColor = up ? EMERALD : ROSE;

  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: ZINC_400 }}
        >
          NET WORTH
        </Text>
        <View className="flex-row items-center">
          <ArrowIcon size={14} color={trendColor} />
          <Text
            className="ml-1"
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 12,
              color: trendColor,
            }}
          >
            {(up ? "+" : "") + formatAmount(data.delta, currency)} · 90d
          </Text>
        </View>
      </View>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 32,
          color: "#f4f4f5",
          marginTop: 6,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatAmount(animatedValue, currency)}
      </Text>
      <View style={{ height: 90, marginTop: 12 }}>
        <CartesianChart
          data={data.points.map((p, i) => ({ i, value: p.value }))}
          xKey="i"
          yKeys={["value"]}
        >
          {({ points, chartBounds }) => (
            <>
              <Area
                points={points.value}
                y0={chartBounds.bottom}
                color={trendColor}
                opacity={0.15}
              />
              <Line
                points={points.value}
                color={trendColor}
                strokeWidth={2}
                curveType="cardinal"
              />
            </>
          )}
        </CartesianChart>
      </View>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Accounts row
// ──────────────────────────────────────────────────────────────────────────
function AccountsRow({
  data,
  loading,
  currency,
}: {
  data: AccountWithSparkline[] | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading || !data) {
    return (
      <View>
        <Text
          className="px-1 mb-2"
          style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: ZINC_400 }}
        >
          ACCOUNTS
        </Text>
        <View className="flex-row">
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              style={{ width: 160, height: 100, marginRight: 12, borderRadius: 16 }}
            />
          ))}
        </View>
      </View>
    );
  }
  if (data.length === 0) return null;

  return (
    <View>
      <Text
        className="px-1 mb-2"
        style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: ZINC_400 }}
      >
        ACCOUNTS
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 4 }}
      >
        {data.map((a) => (
          <AccountCard key={a.id} account={a} currency={currency} />
        ))}
      </ScrollView>
    </View>
  );
}

function AccountCard({
  account,
  currency,
}: {
  account: AccountWithSparkline;
  currency: string;
}) {
  const Icon = getLucideIcon(account.icon);
  return (
    <View
      className="rounded-2xl bg-card border border-border p-3 mr-3"
      style={{ width: 170 }}
    >
      <View className="flex-row items-center">
        <View
          className="h-7 w-7 rounded-full items-center justify-center mr-2"
          style={{ backgroundColor: `${account.color}26` }}
        >
          <Icon size={14} color={account.color} />
        </View>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: "Inter_600SemiBold",
            fontSize: 13,
            color: "#f4f4f5",
            flex: 1,
          }}
        >
          {account.name}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 18,
          color: "#f4f4f5",
          marginTop: 4,
        }}
      >
        {formatAmount(account.balance, currency)}
      </Text>
      <View style={{ height: 32, marginTop: 4, justifyContent: "center" }}>
        {(() => {
          const vals = account.sparkline
            .map((p) => p.value)
            .filter((v) => Number.isFinite(v));
          const flat =
            vals.length < 2 || Math.max(...vals) === Math.min(...vals);
          if (flat) {
            return (
              <View
                style={{
                  height: 1.5,
                  backgroundColor: account.color,
                  opacity: 0.4,
                  borderRadius: 1,
                }}
              />
            );
          }
          return (
            <CartesianChart
              data={account.sparkline.map((p, i) => ({ i, v: p.value }))}
              xKey="i"
              yKeys={["v"]}
            >
              {({ points }) => (
                <Line
                  points={points.v}
                  color={account.color}
                  strokeWidth={1.5}
                  curveType="cardinal"
                />
              )}
            </CartesianChart>
          );
        })()}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Insights teaser
// ──────────────────────────────────────────────────────────────────────────
function InsightsTeaser({
  insight,
  loading,
  onPress,
}: {
  insight: { message: string } | null | undefined;
  loading: boolean;
  onPress: () => void;
}) {
  if (loading) {
    return (
      <Card>
        <Skeleton style={{ height: 18 }} />
        <Skeleton style={{ height: 14, width: "70%", marginTop: 8 }} />
      </Card>
    );
  }

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <Card padding={16}>
        <View className="flex-row items-start">
          <View
            className="h-9 w-9 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: `${AMBER}1f` }}
          >
            <Sparkles size={18} color={AMBER} />
          </View>
          <View className="flex-1">
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 12,
                color: ZINC_400,
              }}
            >
              LATEST INSIGHT
            </Text>
            <Text
              numberOfLines={3}
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                color: "#f4f4f5",
                marginTop: 4,
              }}
            >
              {insight?.message ??
                "No insights yet — Pulse will surface tips after a few days of data."}
            </Text>
            <View className="flex-row items-center mt-2">
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  color: EMERALD,
                }}
              >
                See all
              </Text>
              <ChevronRight size={14} color={EMERALD} />
            </View>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Bits
// ──────────────────────────────────────────────────────────────────────────
function Card({
  children,
  padding = 20,
}: {
  children: React.ReactNode;
  padding?: number;
}) {
  return (
    <View
      className="rounded-2xl bg-card border border-border overflow-hidden"
      style={{
        padding,
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      {children}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center">
      <View
        style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: color }}
      />
      <Text
        className="ml-1"
        style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
      >
        {label}
      </Text>
    </View>
  );
}

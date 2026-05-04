/**
 * Insights — AI-generated weekly insights + natural-language search.
 *
 * Three pieces stacked top-to-bottom:
 *   1. Header: "Insights" + "Generate now" button (manual trigger).
 *   2. Natural-language search bar (component below).
 *   3. List of undismissed insight cards, swipe-to-dismiss.
 *
 * The "Generate now" button calls the `generate-insights` Edge Function
 * for the current user. Scheduled weekly runs do the same thing for
 * everyone (configured via pg_cron — see the note at the bottom of the
 * Edge Function file).
 */
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Swipeable } from "react-native-gesture-handler";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ChevronLeft,
  Flame,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wand2,
} from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { Skeleton } from "@/components/Skeleton";
import { NLSearchBar } from "@/components/NLSearchBar";
import {
  dismissInsight,
  generateInsightsNow,
} from "@/lib/insights";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";
const SKY = "#0ea5e9";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

type InsightType = "weekly_summary" | "anomaly" | "tip" | "streak";
type InsightRow = {
  id: string;
  type: InsightType;
  message: string;
  data_json: Record<string, unknown> | null;
  created_at: string;
  dismissed: boolean;
};

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function InsightsScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("currency")
        .single();
      if (error) throw error;
      return data as { currency: string };
    },
  });
  const currency = meQ.data?.currency ?? "PKR";

  const insightsQ = useQuery<InsightRow[]>({
    queryKey: ["insights", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insights")
        .select("id,type,message,data_json,created_at,dismissed")
        .eq("dismissed", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InsightRow[];
    },
  });

  const dismiss = useMutation({
    mutationFn: dismissInsight,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["insights", "list"] });
      const prev = qc.getQueryData<InsightRow[]>(["insights", "list"]) ?? [];
      qc.setQueryData<InsightRow[]>(
        ["insights", "list"],
        prev.filter((i) => i.id !== id),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["insights", "list"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["insights"] }),
  });

  const generate = useMutation({
    mutationFn: generateInsightsNow,
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["insights"] });
      if (res.inserted === 0) {
        Alert.alert(
          "No insights this time",
          "You may not have enough activity yet, or things look pretty steady.",
        );
      }
    },
    onError: (e: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't generate", e?.message ?? "Please try again.");
    },
  });

  const onRefresh = useCallback(async () => {
    await insightsQ.refetch();
  }, [insightsQ]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={insightsQ.isRefetching}
            onRefresh={onRefresh}
            tintColor={EMERALD}
          />
        }
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={12}
            className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
            activeOpacity={0.85}
          >
            <ChevronLeft size={18} color="#f4f4f5" />
          </TouchableOpacity>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 20,
              color: "#f4f4f5",
            }}
          >
            Insights
          </Text>
          <TouchableOpacity
            onPress={() => generate.mutate()}
            disabled={generate.isPending}
            activeOpacity={0.85}
            className="h-9 px-3 items-center justify-center rounded-full flex-row"
            style={{
              backgroundColor: `${EMERALD}1a`,
              borderWidth: 1,
              borderColor: `${EMERALD}40`,
              opacity: generate.isPending ? 0.6 : 1,
            }}
          >
            {generate.isPending ? (
              <ActivityIndicator size="small" color={EMERALD} />
            ) : (
              <>
                <Wand2 size={12} color={EMERALD} />
                <Text
                  className="ml-1"
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 11,
                    color: EMERALD,
                  }}
                >
                  Generate now
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* NL search */}
        <NLSearchBar currency={currency} />

        {/* Section heading */}
        <View className="flex-row items-center justify-between px-5 pt-6 pb-2">
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              color: ZINC_500,
              letterSpacing: 0.6,
            }}
          >
            FOR YOU
          </Text>
          {insightsQ.data && insightsQ.data.length > 0 ? (
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 11,
                color: ZINC_400,
              }}
            >
              swipe to dismiss
            </Text>
          ) : null}
        </View>

        {/* Cards */}
        <View className="px-4" style={{ gap: 12 }}>
          {insightsQ.isLoading ? (
            <>
              <Skeleton style={{ height: 96, borderRadius: 16 }} />
              <Skeleton style={{ height: 96, borderRadius: 16 }} />
              <Skeleton style={{ height: 96, borderRadius: 16 }} />
            </>
          ) : (insightsQ.data ?? []).length === 0 ? (
            <EmptyState onGenerate={() => generate.mutate()} busy={generate.isPending} />
          ) : (
            (insightsQ.data ?? []).map((i) => (
              <InsightCard
                key={i.id}
                insight={i}
                currency={currency}
                onDismiss={() => dismiss.mutate(i.id)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Insight card
// ──────────────────────────────────────────────────────────────────────────
function InsightCard({
  insight,
  currency,
  onDismiss,
}: {
  insight: InsightRow;
  currency: string;
  onDismiss: () => void;
}) {
  const meta = insightTypeMeta(insight.type);

  const renderRightActions = () => (
    <View
      className="w-24 mr-3 items-center justify-center rounded-2xl"
      style={{ backgroundColor: "#27272a" }}
    >
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 12,
          color: ZINC_400,
        }}
      >
        Dismiss
      </Text>
    </View>
  );

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      onSwipeableOpen={() => {
        Haptics.selectionAsync();
        onDismiss();
      }}
      overshootRight={false}
    >
      <View
        className="rounded-2xl border border-border p-4"
        style={{ backgroundColor: `${meta.color}10`, borderColor: `${meta.color}33` }}
      >
        <View className="flex-row items-start">
          <View
            className="h-9 w-9 rounded-2xl items-center justify-center mr-3"
            style={{ backgroundColor: `${meta.color}26` }}
          >
            <meta.Icon size={16} color={meta.color} />
          </View>
          <View className="flex-1">
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 10,
                color: meta.color,
                letterSpacing: 0.5,
              }}
            >
              {meta.label.toUpperCase()}
            </Text>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 15,
                color: "#f4f4f5",
                marginTop: 2,
                lineHeight: 20,
              }}
            >
              {insight.message}
            </Text>
          </View>
        </View>

        <DataViz data={insight.data_json} type={insight.type} currency={currency} />

        <Text
          className="mt-3"
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 10,
            color: ZINC_500,
          }}
        >
          {formatDistanceToNow(new Date(insight.created_at), { addSuffix: true })} ·{" "}
          {format(new Date(insight.created_at), "MMM d")}
        </Text>
      </View>
    </Swipeable>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Inline data viz
// ──────────────────────────────────────────────────────────────────────────
function DataViz({
  data,
  type,
  currency,
}: {
  data: Record<string, unknown> | null;
  type: InsightType;
  currency: string;
}) {
  if (!data) return null;

  // Weekly summary: compare two numbers
  if (
    type === "weekly_summary" &&
    typeof (data as any).thisWeek === "number" &&
    typeof (data as any).lastWeek === "number"
  ) {
    const tw = (data as any).thisWeek as number;
    const lw = (data as any).lastWeek as number;
    const max = Math.max(tw, lw, 1);
    return (
      <View className="mt-3" style={{ gap: 6 }}>
        <ComparisonBar label="Last week" value={lw} max={max} currency={currency} dim />
        <ComparisonBar label="This week" value={tw} max={max} currency={currency} />
      </View>
    );
  }

  // Anomaly: single highlighted amount
  if (type === "anomaly" && typeof (data as any).amount === "number") {
    const a = data as { amount: number; note?: string; date?: string };
    return (
      <View className="mt-3 rounded-xl bg-zinc-900 border border-border p-3 flex-row items-center justify-between">
        <View className="flex-1">
          <Text
            style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
            numberOfLines={1}
          >
            {a.note ?? "Largest expense"}
            {a.date ? ` · ${a.date}` : ""}
          </Text>
        </View>
        <Text
          style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: ROSE }}
        >
          {formatAmount(a.amount, currency)}
        </Text>
      </View>
    );
  }

  // Tip: pct vs average
  if (
    type === "tip" &&
    typeof (data as any).thisWeekPct === "number" &&
    typeof (data as any).average === "number"
  ) {
    const tw = (data as any).thisWeekPct as number;
    const avg = (data as any).average as number;
    const max = Math.max(tw, avg, 1);
    return (
      <View className="mt-3" style={{ gap: 6 }}>
        <ComparisonBar
          label="Average"
          value={avg}
          max={max}
          suffix="%"
          dim
        />
        <ComparisonBar label="You" value={tw} max={max} suffix="%" />
      </View>
    );
  }

  // Streak: numeric milestone
  if (type === "streak" && typeof (data as any).weeksUnderBudget === "number") {
    const w = (data as any).weeksUnderBudget as number;
    return (
      <View className="mt-3 rounded-xl bg-zinc-900 border border-border p-3">
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
        >
          STREAK
        </Text>
        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 18,
            color: AMBER,
            marginTop: 2,
          }}
        >
          {w} week{w === 1 ? "" : "s"}
        </Text>
      </View>
    );
  }

  return null;
}

function ComparisonBar({
  label,
  value,
  max,
  currency,
  suffix,
  dim,
}: {
  label: string;
  value: number;
  max: number;
  currency?: string;
  suffix?: string;
  dim?: boolean;
}) {
  const pct = (value / max) * 100;
  return (
    <View>
      <View className="flex-row items-center justify-between mb-0.5">
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 11,
            color: ZINC_400,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: "Inter_600SemiBold",
            fontSize: 11,
            color: dim ? ZINC_400 : "#f4f4f5",
          }}
        >
          {suffix
            ? `${value.toFixed(0)}${suffix}`
            : currency
              ? formatAmount(value, currency)
              : value.toFixed(0)}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: "#27272a",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${Math.min(100, pct)}%`,
            height: "100%",
            backgroundColor: dim ? "#52525b" : EMERALD,
            borderRadius: 3,
          }}
        />
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────────────
function EmptyState({
  onGenerate,
  busy,
}: {
  onGenerate: () => void;
  busy: boolean;
}) {
  return (
    <View className="rounded-2xl bg-card border border-border p-8 items-center justify-center mt-2">
      <View
        className="h-14 w-14 rounded-2xl items-center justify-center mb-4"
        style={{ backgroundColor: `${EMERALD}1a` }}
      >
        <Sparkles size={26} color={EMERALD} />
      </View>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 16,
          color: "#f4f4f5",
        }}
      >
        Your first weekly insight arrives Sunday
      </Text>
      <Text
        className="mt-1 mb-4 text-center"
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          color: ZINC_400,
        }}
      >
        Pulse looks at your last two weeks of spending and surfaces what
        changed, what's odd, and where you can save. Or generate one now.
      </Text>
      <TouchableOpacity
        onPress={onGenerate}
        disabled={busy}
        activeOpacity={0.85}
        className="h-10 px-4 rounded-full flex-row items-center"
        style={{ backgroundColor: EMERALD, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? (
          <ActivityIndicator color="#09090b" />
        ) : (
          <>
            <Wand2 size={14} color="#09090b" />
            <Text
              className="ml-2"
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 13,
                color: "#09090b",
              }}
            >
              Generate insights now
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Type → icon + colour
// ──────────────────────────────────────────────────────────────────────────
function insightTypeMeta(type: InsightType): {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  color: string;
} {
  switch (type) {
    case "weekly_summary":
      return { Icon: TrendingDown, label: "Weekly summary", color: SKY };
    case "anomaly":
      return { Icon: AlertTriangle, label: "Anomaly", color: ROSE };
    case "tip":
      return { Icon: TrendingUp, label: "Tip", color: AMBER };
    case "streak":
      return { Icon: Flame, label: "Streak", color: EMERALD };
  }
}

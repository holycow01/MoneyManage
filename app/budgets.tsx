/**
 * Budgets — per-category monthly (and weekly) tracking.
 *
 * One screen-level cursor controls the visible *month* (chevrons + label
 * in the header). Monthly budgets respect the cursor; weekly budgets
 * always show the current week — they don't really fit the month nav.
 *
 * Data: two queries (budgets + transactions in the visible window),
 * combined client-side into a `BudgetCard[]` with spent/remaining/percent.
 *
 * Notifications fire from the home/edit save paths via `runBudgetCheck()`
 * — this screen doesn't need to schedule anything itself.
 */
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Target,
  Wallet,
  X,
} from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import { Skeleton } from "@/components/Skeleton";
import {
  BudgetSheet,
  type BudgetRow,
} from "@/components/BudgetSheet";
import { clearBudgetNotifications } from "@/lib/notifications";

const EMERALD = "#10b981";
const AMBER = "#f59e0b";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

type RawBudget = {
  id: string;
  category_id: string;
  amount: string;
  period: "weekly" | "monthly";
  start_date: string;
};

type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
};

type RawTx = {
  amount: string;
  type: "income" | "expense" | "transfer";
  category_id: string | null;
  date: string;
};

type BudgetCard = {
  id: string;
  category: Category | null;
  amount: number;
  spent: number;
  remaining: number;
  pct: number;
  period: "weekly" | "monthly";
  daysLeft: number;
};

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function BudgetsScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null);

  const today = new Date();
  const monthStart = useMemo(() => startOfMonth(cursor), [cursor]);
  const monthEnd = useMemo(() => endOfMonth(cursor), [cursor]);
  const weekStart = useMemo(
    () => startOfWeek(today, { weekStartsOn: 1 }),
    [],
  );
  const weekEnd = useMemo(() => endOfWeek(today, { weekStartsOn: 1 }), []);

  const monthKey = format(cursor, "yyyy-MM");
  const isCurrentMonth = isSameMonth(cursor, today);

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

  const budgetsQ = useQuery<RawBudget[]>({
    queryKey: ["budgets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("id,category_id,amount,period,start_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const categoriesQ = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,icon,color");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pull transactions covering both the visible month and the current week
  // so the per-budget computation has everything it needs.
  const txQ = useQuery<RawTx[]>({
    queryKey: ["budgets", "tx", monthKey],
    queryFn: async () => {
      const earliest = monthStart < weekStart ? monthStart : weekStart;
      const latest = monthEnd > weekEnd ? monthEnd : weekEnd;
      const { data, error } = await supabase
        .from("transactions")
        .select("amount,type,category_id,date")
        .eq("type", "expense")
        .gte("date", earliest.toISOString())
        .lte("date", latest.toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  const cards: BudgetCard[] = useMemo(() => {
    const budgets = budgetsQ.data ?? [];
    const cats = categoriesQ.data ?? [];
    const txs = txQ.data ?? [];
    return budgets
      .map<BudgetCard>((b) => {
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
        const amount = Number(b.amount);
        const remaining = Math.max(0, amount - spent);
        const pct = amount > 0 ? (spent / amount) * 100 : 0;
        const daysLeft = Math.max(
          0,
          differenceInCalendarDays(range.end, today) + 1,
        );
        return {
          id: b.id,
          category: cats.find((c) => c.id === b.category_id) ?? null,
          amount,
          spent,
          remaining,
          pct,
          period: b.period,
          daysLeft,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [
    budgetsQ.data,
    categoriesQ.data,
    txQ.data,
    monthStart,
    monthEnd,
    weekStart,
    weekEnd,
    today,
  ]);

  const summary = useMemo(() => {
    // Sum monthly only — weekly budgets aren't comparable across the month.
    const monthly = cards.filter((c) => c.period === "monthly");
    const totalBudget = monthly.reduce((s, c) => s + c.amount, 0);
    const totalSpent = monthly.reduce((s, c) => s + c.spent, 0);
    return {
      totalBudget,
      totalSpent,
      remaining: Math.max(0, totalBudget - totalSpent),
      pct: totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0,
    };
  }, [cards]);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("budgets")
        .delete()
        .eq("id", id);
      if (error) throw error;
      await clearBudgetNotifications(id);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });

  const goPrev = useCallback(() => {
    Haptics.selectionAsync();
    setCursor((c) => subMonths(c, 1));
  }, []);
  const goNext = useCallback(() => {
    Haptics.selectionAsync();
    setCursor((c) => addMonths(c, 1));
  }, []);

  const openAdd = () => {
    setEditingBudget(null);
    setSheetOpen(true);
  };
  const openEdit = (id: string) => {
    const row = (budgetsQ.data ?? []).find((b) => b.id === id) ?? null;
    setEditingBudget(row);
    setSheetOpen(true);
  };

  const onLongPress = (card: BudgetCard) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      `Delete ${card.category?.name ?? "budget"}?`,
      "This won't delete any transactions, just the budget.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMut.mutate(card.id),
        },
      ],
    );
  };

  const isLoading =
    budgetsQ.isLoading || categoriesQ.isLoading || txQ.isLoading;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={12}
            className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
            activeOpacity={0.85}
          >
            <X size={16} color="#f4f4f5" />
          </TouchableOpacity>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 20,
              color: "#f4f4f5",
            }}
          >
            Budgets
          </Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Month nav */}
        <View className="flex-row items-center justify-center px-5 pb-3" style={{ gap: 16 }}>
          <TouchableOpacity
            onPress={goPrev}
            hitSlop={10}
            className="h-8 w-8 items-center justify-center rounded-full bg-card border border-border"
          >
            <ChevronLeft size={16} color="#f4f4f5" />
          </TouchableOpacity>
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              color: "#f4f4f5",
              minWidth: 130,
              textAlign: "center",
            }}
          >
            {format(cursor, "MMMM yyyy")}
          </Text>
          <TouchableOpacity
            onPress={goNext}
            hitSlop={10}
            className="h-8 w-8 items-center justify-center rounded-full bg-card border border-border"
          >
            <ChevronRight size={16} color="#f4f4f5" />
          </TouchableOpacity>
        </View>

        {/* Summary */}
        <View className="px-4">
          <View className="rounded-2xl bg-card border border-border p-4">
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 11,
                color: ZINC_400,
                letterSpacing: 0.4,
              }}
            >
              MONTHLY BUDGET TOTAL
            </Text>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 28,
                color: "#f4f4f5",
                marginTop: 2,
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatAmount(summary.totalBudget, currency)}
            </Text>

            <View className="mt-3 mb-2">
              <ProgressBar pct={summary.pct} />
            </View>

            <View className="flex-row mt-2">
              <SummaryStat
                label="Spent"
                value={formatAmount(summary.totalSpent, currency)}
                color={progressColor(summary.pct)}
              />
              <SummaryStat
                label="Remaining"
                value={formatAmount(summary.remaining, currency)}
              />
              <SummaryStat
                label="Used"
                value={`${Math.round(summary.pct)}%`}
                color={progressColor(summary.pct)}
              />
            </View>
          </View>
        </View>

        {/* List */}
        <View className="px-4 mt-4" style={{ gap: 12 }}>
          {isLoading ? (
            <>
              <Skeleton style={{ height: 96, borderRadius: 16 }} />
              <Skeleton style={{ height: 96, borderRadius: 16 }} />
              <Skeleton style={{ height: 96, borderRadius: 16 }} />
            </>
          ) : cards.length === 0 ? (
            <EmptyState onAdd={openAdd} />
          ) : (
            cards.map((card) => (
              <BudgetItem
                key={card.id}
                card={card}
                currency={currency}
                onPress={() => openEdit(card.id)}
                onLongPress={() => onLongPress(card)}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Add button (FAB) */}
      <TouchableOpacity
        onPress={openAdd}
        activeOpacity={0.85}
        className="absolute bottom-6 left-4 right-4 h-12 items-center justify-center rounded-2xl flex-row"
        style={{
          backgroundColor: EMERALD,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Plus size={18} color="#09090b" />
        <Text
          className="ml-2"
          style={{ fontFamily: "Inter_700Bold", color: "#09090b" }}
        >
          Add budget
        </Text>
      </TouchableOpacity>

      <BudgetSheet
        open={sheetOpen}
        budget={editingBudget}
        currency={currency}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pieces
// ──────────────────────────────────────────────────────────────────────────
function BudgetItem({
  card,
  currency,
  onPress,
  onLongPress,
}: {
  card: BudgetCard;
  currency: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const Icon = getLucideIcon(card.category?.icon ?? "circle");
  const color = progressColor(card.pct);
  const overage = Math.max(0, card.spent - card.amount);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="rounded-2xl bg-card border border-border p-4"
    >
      <View className="flex-row items-start">
        <View
          className="h-10 w-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: `${card.category?.color ?? "#52525b"}26` }}
        >
          <Icon size={18} color={card.category?.color ?? ZINC_400} />
        </View>
        <View className="flex-1">
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              color: "#f4f4f5",
            }}
            numberOfLines={1}
          >
            {card.category?.name ?? "Uncategorized"}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 11,
              color: ZINC_400,
            }}
          >
            {card.period === "weekly" ? "This week" : "This month"} ·{" "}
            {card.daysLeft} day{card.daysLeft === 1 ? "" : "s"} left
          </Text>
        </View>
        <View className="items-end">
          <Text
            style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#f4f4f5" }}
          >
            {formatAmount(card.spent, currency)}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 11,
              color: ZINC_400,
            }}
          >
            of {formatAmount(card.amount, currency)}
          </Text>
        </View>
      </View>

      <View className="mt-3">
        <ProgressBar pct={card.pct} />
      </View>

      <View className="flex-row items-center justify-between mt-2">
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 11, color }}
        >
          {Math.round(card.pct)}% used
        </Text>
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 11,
            color: overage > 0 ? ROSE : ZINC_400,
          }}
        >
          {overage > 0
            ? `${formatAmount(overage, currency)} over`
            : `${formatAmount(card.remaining, currency)} left`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, pct);
  const color = progressColor(pct);
  return (
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
          width: `${clamped}%`,
          height: "100%",
          backgroundColor: color,
          borderRadius: 3,
        }}
      />
    </View>
  );
}

function progressColor(pct: number): string {
  if (pct >= 100) return ROSE;
  if (pct >= 70) return AMBER;
  return EMERALD;
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View className="flex-1">
      <Text
        style={{
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          color: ZINC_500,
          letterSpacing: 0.5,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 14,
          color: color ?? "#f4f4f5",
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <View
      className="rounded-2xl bg-card border border-border p-8 items-center justify-center"
      style={{ marginTop: 12 }}
    >
      <View
        className="h-14 w-14 rounded-2xl items-center justify-center mb-4"
        style={{ backgroundColor: `${EMERALD}1a` }}
      >
        <Target size={26} color={EMERALD} />
      </View>
      <Text
        style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#f4f4f5" }}
      >
        No budgets yet
      </Text>
      <Text
        className="mt-1 mb-4 text-center"
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          color: ZINC_400,
        }}
      >
        Set caps for your most-used categories and Pulse will warn you
        before you blow past them.
      </Text>
      <TouchableOpacity
        onPress={onAdd}
        activeOpacity={0.85}
        className="h-10 px-4 items-center justify-center rounded-full flex-row"
        style={{ backgroundColor: EMERALD }}
      >
        <Plus size={14} color="#09090b" />
        <Text
          className="ml-2"
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 13,
            color: "#09090b",
          }}
        >
          Set your first budget
        </Text>
      </TouchableOpacity>
    </View>
  );
}

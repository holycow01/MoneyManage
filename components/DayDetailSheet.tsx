/**
 * Day-detail bottom sheet for the calendar heatmap.
 *
 * Opens when the user taps a day cell. Shows that day's transactions
 * grouped by income/expense, the day total, and a CTA to add a new
 * transaction (routes to the quick-entry tab).
 */
import { useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { endOfDay, format, isSameDay, startOfDay } from "date-fns";
import { Plus, X } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";

type Tx = {
  id: string;
  amount: string;
  type: "income" | "expense" | "transfer";
  note: string | null;
  date: string;
  account_id: string;
  category_id: string | null;
  category: { name: string; icon: string; color: string } | null;
  account: { name: string } | null;
};

export function DayDetailSheet({
  open,
  date,
  currency,
  onClose,
}: {
  open: boolean;
  date: Date | null;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();

  const dayKey = date ? format(date, "yyyy-MM-dd") : "_none";
  const txQ = useQuery<Tx[]>({
    queryKey: ["calendar", "day", dayKey],
    queryFn: async () => {
      if (!date) return [];
      const { data, error } = await supabase
        .from("transactions")
        .select(
          `id,amount,type,note,date,account_id,category_id,
           category:categories(name,icon,color),
           account:accounts(name)`,
        )
        .gte("date", startOfDay(date).toISOString())
        .lte("date", endOfDay(date).toISOString())
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Tx[];
    },
    enabled: open && !!date,
  });

  const { totalSpend, totalIncome } = useMemo(() => {
    const list = txQ.data ?? [];
    return {
      totalSpend: list
        .filter((t) => t.type === "expense")
        .reduce((s, t) => s + Number(t.amount), 0),
      totalIncome: list
        .filter((t) => t.type === "income")
        .reduce((s, t) => s + Number(t.amount), 0),
    };
  }, [txQ.data]);

  const isToday = date ? isSameDay(date, new Date()) : false;
  const list = txQ.data ?? [];

  return (
    <Modal
      transparent
      visible={open}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-2xl bg-card border-t border-border"
          style={{ maxHeight: "78%" }}
        >
          {/* Header */}
          <View className="flex-row items-start justify-between px-5 pt-4 pb-3">
            <View className="flex-1">
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 18,
                  color: "#f4f4f5",
                }}
              >
                {date ? (isToday ? "Today" : format(date, "EEEE, MMM d")) : ""}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                  color: ZINC_400,
                  marginTop: 2,
                }}
              >
                {formatAmount(totalSpend, currency)} spent ·{" "}
                {list.length} {list.length === 1 ? "entry" : "entries"}
                {totalIncome > 0
                  ? ` · ${formatAmount(totalIncome, currency)} in`
                  : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <X size={20} color={ZINC_400} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {list.length === 0 ? (
              <View className="items-center justify-center py-16 px-8">
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    color: "#f4f4f5",
                    fontSize: 14,
                  }}
                >
                  No transactions yet.
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    color: ZINC_400,
                    fontSize: 12,
                    marginTop: 4,
                    textAlign: "center",
                  }}
                >
                  Tap the button below to log one for this day.
                </Text>
              </View>
            ) : (
              list.map((tx) => (
                <DayTxRow key={tx.id} tx={tx} currency={currency} />
              ))
            )}
          </ScrollView>

          <TouchableOpacity
            onPress={() => {
              onClose();
              router.push("/(tabs)/");
            }}
            activeOpacity={0.85}
            className="mx-4 mb-5 mt-2 h-12 items-center justify-center rounded-2xl flex-row"
            style={{ backgroundColor: EMERALD }}
          >
            <Plus size={18} color="#09090b" />
            <Text
              className="ml-2"
              style={{ fontFamily: "Inter_700Bold", color: "#09090b" }}
            >
              Add transaction
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DayTxRow({ tx, currency }: { tx: Tx; currency: string }) {
  const Icon = getLucideIcon(tx.category?.icon ?? "circle");
  const isIncome = tx.type === "income";
  return (
    <View className="flex-row items-center px-5 py-3 border-b border-zinc-800">
      <View
        className="h-10 w-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${tx.category?.color ?? "#52525b"}26` }}
      >
        <Icon size={18} color={tx.category?.color ?? ZINC_400} />
      </View>
      <View className="flex-1">
        <Text
          style={{
            fontFamily: "Inter_600SemiBold",
            color: "#f4f4f5",
            fontSize: 14,
          }}
          numberOfLines={1}
        >
          {tx.category?.name ?? (isIncome ? "Income" : "Expense")}
        </Text>
        <Text
          style={{
            fontFamily: "Inter_400Regular",
            color: ZINC_400,
            fontSize: 12,
          }}
          numberOfLines={1}
        >
          {format(new Date(tx.date), "h:mm a")}
          {tx.note ? ` · ${tx.note}` : ""}
          {tx.account ? ` · ${tx.account.name}` : ""}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 14,
          color: isIncome ? EMERALD : "#f4f4f5",
        }}
      >
        {isIncome ? "+" : "−"}
        {formatAmount(Number(tx.amount), currency).replace(/^-/, "")}
      </Text>
    </View>
  );
}

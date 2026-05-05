/**
 * Accounts list — your wallets, banks, cards.
 *
 *   - Net-worth pill in the header (sum of all unarchived effective balances).
 *   - Drag-to-reorder via react-native-draggable-flatlist; the order is
 *     persisted in AsyncStorage (no schema column needed for now).
 *   - Each card has a colour band on the left, the account icon, the
 *     effective balance, and a 30-day sparkline.
 *   - Archived accounts are hidden by default; toggle reveals them.
 *
 * Effective balance = `accounts.balance` (starting) + sum of every
 * transaction on the account. Transfers use signed amounts so they
 * "just work" inside the sum.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ArrowLeftRight,
  EyeOff,
  Pencil,
  Plus,
  X,
} from "lucide-react-native";
import { CartesianChart, Line } from "victory-native";
import { eachDayOfInterval, format, subDays } from "date-fns";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import { Skeleton } from "@/components/Skeleton";
import {
  AccountSheet,
  type AccountRow,
} from "@/components/AccountSheet";
import { TransferSheet } from "@/components/TransferSheet";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

const ORDER_STORAGE_KEY = "pulse.accountOrder";

type RawTx = {
  amount: string;
  type: "income" | "expense" | "transfer";
  account_id: string;
  date: string;
};

type Sparkline = { date: Date; value: number }[];

type AccountCard = AccountRow & {
  effectiveBalance: number;
  sparkline: Sparkline;
};

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function AccountsScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const [showArchived, setShowArchived] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(ORDER_STORAGE_KEY).then((s) => {
      try {
        if (s) setOrder(JSON.parse(s));
      } catch {
        /* ignore */
      }
    });
  }, []);

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

  const accountsQ = useQuery<AccountRow[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,name,type,balance,color,icon,archived")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const txAllQ = useQuery<RawTx[]>({
    queryKey: ["transactions", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("amount,type,account_id,date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const recentTxQ = useQuery<RawTx[]>({
    queryKey: ["transactions", "30d"],
    queryFn: async () => {
      const start = subDays(new Date(), 29);
      const { data, error } = await supabase
        .from("transactions")
        .select("amount,type,account_id,date")
        .gte("date", start.toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Compute effective balance + sparkline per account ───────────────
  const cards = useMemo<AccountCard[]>(() => {
    const accounts = accountsQ.data ?? [];
    const allTxs = txAllQ.data ?? [];
    const recentTxs = recentTxQ.data ?? [];

    const today = new Date();
    const dayList = eachDayOfInterval({
      start: subDays(today, 29),
      end: today,
    });

    return accounts.map((a) => {
      // Effective balance = starting + sum of all flows.
      let effective = Number(a.balance);
      for (const t of allTxs) {
        if (t.account_id !== a.id) continue;
        const amt = Number(t.amount);
        if (t.type === "income") effective += amt;
        else if (t.type === "expense") effective -= amt;
        else if (t.type === "transfer") effective += amt; // amount is signed
      }

      // 30-day sparkline — walk backwards from `effective`.
      const netByDay = new Map<string, number>();
      for (const t of recentTxs) {
        if (t.account_id !== a.id) continue;
        const k = format(new Date(t.date), "yyyy-MM-dd");
        const amt = Number(t.amount);
        const delta =
          t.type === "income"
            ? amt
            : t.type === "expense"
              ? -amt
              : amt; // transfer
        netByDay.set(k, (netByDay.get(k) ?? 0) + delta);
      }
      const sparkline: Sparkline = new Array(dayList.length);
      let value = effective;
      for (let i = dayList.length - 1; i >= 0; i--) {
        sparkline[i] = { date: dayList[i], value };
        value -= netByDay.get(format(dayList[i], "yyyy-MM-dd")) ?? 0;
      }

      return { ...a, effectiveBalance: effective, sparkline };
    });
  }, [accountsQ.data, txAllQ.data, recentTxQ.data]);

  // ── Apply user-defined order, then archived filter ──────────────────
  const orderedCards = useMemo(() => {
    const visible = cards.filter((c) => showArchived || !c.archived);
    if (order.length === 0) return visible;
    const idx = new Map<string, number>();
    order.forEach((id, i) => idx.set(id, i));
    return [...visible].sort((a, b) => {
      const ai = idx.has(a.id) ? idx.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = idx.has(b.id) ? idx.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [cards, order, showArchived]);

  const netWorth = useMemo(
    () =>
      cards
        .filter((c) => !c.archived)
        .reduce((s, c) => s + c.effectiveBalance, 0),
    [cards],
  );
  const archivedCount = cards.filter((c) => c.archived).length;

  const openAdd = () => {
    setEditingAccount(null);
    setSheetOpen(true);
  };
  const openEdit = (a: AccountRow) => {
    setEditingAccount(a);
    setSheetOpen(true);
  };

  const isLoading =
    accountsQ.isLoading || txAllQ.isLoading || recentTxQ.isLoading;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

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
          style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#f4f4f5" }}
        >
          Accounts
        </Text>
        <View
          className="h-9 px-3 rounded-full items-center justify-center"
          style={{ backgroundColor: `${EMERALD}1a`, borderWidth: 1, borderColor: `${EMERALD}40` }}
        >
          <Text
            numberOfLines={1}
            style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: EMERALD }}
          >
            {formatAmount(netWorth, currency)}
          </Text>
        </View>
      </View>

      {/* Action row */}
      <View className="flex-row px-4 pb-3" style={{ gap: 8 }}>
        <TouchableOpacity
          onPress={openAdd}
          activeOpacity={0.85}
          className="flex-1 h-10 items-center justify-center rounded-xl flex-row"
          style={{ backgroundColor: EMERALD }}
        >
          <Plus size={14} color="#09090b" />
          <Text
            className="ml-2"
            style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#09090b" }}
          >
            Add account
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTransferOpen(true)}
          activeOpacity={0.85}
          disabled={(accountsQ.data?.length ?? 0) < 2}
          className="flex-1 h-10 items-center justify-center rounded-xl flex-row"
          style={{
            borderWidth: 1,
            borderColor: EMERALD,
            opacity: (accountsQ.data?.length ?? 0) < 2 ? 0.5 : 1,
          }}
        >
          <ArrowLeftRight size={14} color={EMERALD} />
          <Text
            className="ml-2"
            style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: EMERALD }}
          >
            Transfer
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading ? (
        <View className="px-4" style={{ gap: 12 }}>
          <Skeleton style={{ height: 92, borderRadius: 16 }} />
          <Skeleton style={{ height: 92, borderRadius: 16 }} />
          <Skeleton style={{ height: 92, borderRadius: 16 }} />
        </View>
      ) : orderedCards.length === 0 ? (
        <EmptyState onAdd={openAdd} />
      ) : (
        <FlatList
          data={orderedCards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
          renderItem={({ item }) => (
            <AccountListItem
              item={item}
              currency={currency}
              onPress={() => router.push(`/accounts/${item.id}`)}
              onEdit={() => {
                Haptics.selectionAsync();
                openEdit(item);
              }}
            />
          )}
        />
      )}

      {/* Archived toggle footer */}
      {archivedCount > 0 ? (
        <Pressable
          onPress={() => setShowArchived((v) => !v)}
          className="flex-row items-center justify-center py-3 border-t border-border"
        >
          <EyeOff size={14} color={ZINC_400} />
          <Text
            className="ml-2"
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              color: ZINC_400,
            }}
          >
            {showArchived ? "Hide" : "Show"} {archivedCount} archived
          </Text>
        </Pressable>
      ) : null}

      <AccountSheet
        open={sheetOpen}
        account={editingAccount}
        currency={currency}
        onClose={() => setSheetOpen(false)}
      />
      <TransferSheet
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        currency={currency}
      />
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Card
// ──────────────────────────────────────────────────────────────────────────
function AccountListItem({
  item,
  currency,
  onPress,
  onEdit,
}: {
  item: AccountCard;
  currency: string;
  onPress: () => void;
  onEdit: () => void;
}) {
  const Icon = getLucideIcon(item.icon);
  const negative = item.effectiveBalance < 0;

  // Only render the sparkline if the values have actual variance —
  // otherwise Victory Native / Skia divides by zero on the y-domain
  // and crashes the screen with "value is undefined, expected a number".
  const sparklineValues = item.sparkline
    .map((p) => p.value)
    .filter((v) => Number.isFinite(v));
  const hasVariance =
    sparklineValues.length > 1 &&
    Math.max(...sparklineValues) !== Math.min(...sparklineValues);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onEdit}
      delayLongPress={350}
      className="rounded-2xl bg-card border border-border overflow-hidden flex-row"
      style={{
        opacity: item.archived ? 0.55 : 1,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
        {/* Left colour band */}
        <View style={{ width: 4, backgroundColor: item.color }} />

        <View className="flex-1 p-3">
          <View className="flex-row items-center">
            <View
              className="h-9 w-9 rounded-2xl items-center justify-center mr-3"
              style={{ backgroundColor: `${item.color}26` }}
            >
              <Icon size={18} color={item.color} />
            </View>
            <View className="flex-1">
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 14,
                  color: "#f4f4f5",
                }}
              >
                {item.name}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                  color: ZINC_400,
                  textTransform: "capitalize",
                }}
              >
                {item.type}
                {item.archived ? " · Archived" : ""}
              </Text>
            </View>
            <Pressable
              onPress={onEdit}
              hitSlop={10}
              accessibilityLabel={`Edit ${item.name}`}
              className="h-8 w-8 items-center justify-center rounded-full mr-1"
              style={{ backgroundColor: "#27272a" }}
            >
              <Pencil size={14} color="#f4f4f5" />
            </Pressable>
          </View>

          <View className="flex-row items-end mt-2">
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 22,
                color: negative ? ROSE : "#f4f4f5",
                flex: 1,
              }}
            >
              {formatAmount(item.effectiveBalance, currency)}
            </Text>
            <View style={{ width: 90, height: 30, marginLeft: 8, justifyContent: "center" }}>
              {hasVariance ? (
                <CartesianChart
                  data={item.sparkline.map((p, i) => ({ i, v: p.value }))}
                  xKey="i"
                  yKeys={["v"]}
                >
                  {({ points }) => (
                    <Line
                      points={points.v}
                      color={item.color}
                      strokeWidth={1.5}
                      curveType="cardinal"
                    />
                  )}
                </CartesianChart>
              ) : (
                <View
                  style={{
                    height: 1.5,
                    backgroundColor: item.color,
                    opacity: 0.4,
                    borderRadius: 1,
                  }}
                />
              )}
            </View>
          </View>
        </View>
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <View className="px-8 py-16 items-center">
      <View
        className="h-14 w-14 rounded-2xl items-center justify-center mb-4"
        style={{ backgroundColor: `${EMERALD}1a` }}
      >
        <Plus size={26} color={EMERALD} />
      </View>
      <Text
        style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#f4f4f5" }}
      >
        No accounts yet
      </Text>
      <Text
        className="mt-1 mb-4 text-center"
        style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: ZINC_400 }}
      >
        Add your bank, cash, and cards so Pulse can track everything in one
        place.
      </Text>
      <TouchableOpacity
        onPress={onAdd}
        activeOpacity={0.85}
        className="h-10 px-4 rounded-full flex-row items-center"
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
          Add your first account
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Account detail — balance over time + per-account transaction history.
 *
 * Header:        big effective balance + 90-day balance line.
 * Transactions:  this account's transactions, paginated, swipe → edit/delete.
 * Footer button: Edit account (opens AccountSheet).
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Swipeable } from "react-native-gesture-handler";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CartesianChart, Area, Line } from "victory-native";
import {
  eachDayOfInterval,
  endOfDay,
  format,
  isSameDay,
  startOfDay,
  subDays,
} from "date-fns";
import * as Haptics from "expo-haptics";
import {
  ChevronLeft,
  Pencil,
  Trash2,
} from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import {
  AccountSheet,
  type AccountRow,
} from "@/components/AccountSheet";
import {
  TransactionEditSheet,
  type EditableTransaction,
} from "@/components/TransactionEditSheet";

const PAGE_SIZE = 30;
const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

type Category = { id: string; name: string; icon: string; color: string };
type Tx = {
  id: string;
  amount: string;
  type: "income" | "expense" | "transfer";
  note: string | null;
  date: string;
  category_id: string | null;
  account_id: string;
};

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [editAccountOpen, setEditAccountOpen] = useState(false);
  const [editTx, setEditTx] = useState<EditableTransaction | null>(null);

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

  const accountQ = useQuery<AccountRow | null>({
    queryKey: ["accounts", "one", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,name,type,balance,color,icon,archived")
        .eq("id", id)
        .single();
      if (error) throw error;
      return (data ?? null) as AccountRow | null;
    },
    enabled: !!id,
  });

  const allTxQ = useQuery<Tx[]>({
    queryKey: ["accounts", "tx-all", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,amount,type,note,date,account_id,category_id")
        .eq("account_id", id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
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

  // Paginated transactions for this account
  const list = useInfiniteQuery<Tx[]>({
    queryKey: ["accounts", "tx-page", id],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = pageParam as number;
      const { data, error } = await supabase
        .from("transactions")
        .select("id,amount,type,note,date,account_id,category_id")
        .eq("account_id", id)
        .order("date", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (last, all) =>
      last.length < PAGE_SIZE ? undefined : all.length,
    enabled: !!id,
  });

  // ── Effective balance ───────────────────────────────────────────────
  const effective = useMemo(() => {
    const a = accountQ.data;
    if (!a) return 0;
    let bal = Number(a.balance);
    for (const t of allTxQ.data ?? []) {
      const amt = Number(t.amount);
      if (t.type === "income") bal += amt;
      else if (t.type === "expense") bal -= amt;
      else if (t.type === "transfer") bal += amt;
    }
    return bal;
  }, [accountQ.data, allTxQ.data]);

  // 90-day balance series
  const balanceSeries = useMemo(() => {
    const today = new Date();
    const dayList = eachDayOfInterval({ start: subDays(today, 89), end: today });
    const netByDay = new Map<string, number>();
    for (const t of allTxQ.data ?? []) {
      const d = new Date(t.date);
      if (d < subDays(today, 89)) continue;
      const k = format(d, "yyyy-MM-dd");
      const amt = Number(t.amount);
      const delta =
        t.type === "income" ? amt : t.type === "expense" ? -amt : amt;
      netByDay.set(k, (netByDay.get(k) ?? 0) + delta);
    }
    const out: { date: Date; value: number }[] = new Array(dayList.length);
    let value = effective;
    for (let i = dayList.length - 1; i >= 0; i--) {
      out[i] = { date: dayList[i], value };
      value -= netByDay.get(format(dayList[i], "yyyy-MM-dd")) ?? 0;
    }
    return out;
  }, [allTxQ.data, effective]);

  const flatTx = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const sections = useMemo(() => groupByDay(flatTx), [flatTx]);

  // Delete a single tx
  const deleteTx = useMutation({
    mutationFn: async (txId: string) => {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", txId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const account = accountQ.data;
  const Icon = getLucideIcon(account?.icon ?? "wallet");
  const negative = effective < 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

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
          numberOfLines={1}
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 16,
            color: "#f4f4f5",
            flex: 1,
            textAlign: "center",
            marginHorizontal: 8,
          }}
        >
          {account?.name ?? "Account"}
        </Text>
        <TouchableOpacity
          onPress={() => setEditAccountOpen(true)}
          hitSlop={12}
          className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
          activeOpacity={0.85}
        >
          <Pencil size={14} color="#f4f4f5" />
        </TouchableOpacity>
      </View>

      {accountQ.isLoading || !account ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={EMERALD} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <Header
              account={account}
              effective={effective}
              series={balanceSeries}
              currency={currency}
              negative={negative}
              Icon={Icon}
            />
          }
          ListEmptyComponent={
            <View className="px-8 py-16 items-center">
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  color: ZINC_400,
                }}
              >
                No transactions on this account yet.
              </Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-center justify-between px-5 pt-5 pb-2">
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 11,
                  color: ZINC_500,
                  letterSpacing: 1,
                }}
              >
                {section.title.toUpperCase()}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                  color: ZINC_400,
                }}
              >
                {formatAmount(section.delta, currency)}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <AccountTxRow
              tx={item}
              category={
                categoriesQ.data?.find((c) => c.id === item.category_id) ??
                null
              }
              currency={currency}
              onPress={() =>
                setEditTx({
                  id: item.id,
                  amount: item.amount,
                  type: item.type,
                  note: item.note,
                  account_id: item.account_id,
                  category_id: item.category_id,
                  date: item.date,
                })
              }
              onDelete={() => deleteTx.mutate(item.id)}
            />
          )}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching && !list.isFetchingNextPage}
              onRefresh={() => {
                list.refetch();
                allTxQ.refetch();
              }}
              tintColor={EMERALD}
            />
          }
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View className="py-6 items-center">
                <ActivityIndicator color={EMERALD} />
              </View>
            ) : null
          }
        />
      )}

      <AccountSheet
        open={editAccountOpen}
        account={account ?? null}
        currency={currency}
        onClose={() => {
          setEditAccountOpen(false);
          // If user deleted this account, leave the screen.
          if (!accountQ.data) router.back();
        }}
      />
      <TransactionEditSheet
        open={editTx !== null}
        tx={editTx}
        currency={currency}
        onClose={() => setEditTx(null)}
      />
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Header card
// ──────────────────────────────────────────────────────────────────────────
function Header({
  account,
  effective,
  series,
  currency,
  negative,
  Icon,
}: {
  account: AccountRow;
  effective: number;
  series: { date: Date; value: number }[];
  currency: string;
  negative: boolean;
  Icon: ReturnType<typeof getLucideIcon>;
}) {
  const startVal = series[0]?.value ?? effective;
  const delta = effective - startVal;
  const up = delta >= 0;
  return (
    <View className="px-4 pb-4">
      <View
        className="rounded-2xl border border-border overflow-hidden"
        style={{
          backgroundColor: `${account.color}10`,
        }}
      >
        <View style={{ height: 4, backgroundColor: account.color }} />
        <View className="p-4">
          <View className="flex-row items-center">
            <View
              className="h-10 w-10 rounded-2xl items-center justify-center mr-3"
              style={{ backgroundColor: `${account.color}33` }}
            >
              <Icon size={20} color={account.color} />
            </View>
            <View>
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                  color: ZINC_400,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {account.type}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 18,
                  color: "#f4f4f5",
                }}
              >
                {account.name}
              </Text>
            </View>
          </View>

          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 32,
              color: negative ? ROSE : "#f4f4f5",
              marginTop: 12,
            }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatAmount(effective, currency)}
          </Text>

          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              color: up ? EMERALD : ROSE,
              marginTop: 2,
            }}
          >
            {up ? "+" : ""}
            {formatAmount(delta, currency)} · last 90 days
          </Text>

          <View style={{ height: 100, marginTop: 12 }}>
            <CartesianChart
              data={series.map((p, i) => ({ i, value: p.value }))}
              xKey="i"
              yKeys={["value"]}
            >
              {({ points, chartBounds }) => (
                <>
                  <Area
                    points={points.value}
                    y0={chartBounds.bottom}
                    color={account.color}
                    opacity={0.18}
                  />
                  <Line
                    points={points.value}
                    color={account.color}
                    strokeWidth={2}
                    curveType="cardinal"
                  />
                </>
              )}
            </CartesianChart>
          </View>
        </View>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Tx row + grouping
// ──────────────────────────────────────────────────────────────────────────
function AccountTxRow({
  tx,
  category,
  currency,
  onPress,
  onDelete,
}: {
  tx: Tx;
  category: Category | null;
  currency: string;
  onPress: () => void;
  onDelete: () => void;
}) {
  const Icon = getLucideIcon(category?.icon ?? "circle");
  const amt = Number(tx.amount);
  const isIncoming =
    tx.type === "income" || (tx.type === "transfer" && amt > 0);
  const sign = isIncoming ? "+" : "−";

  const renderRightActions = () => (
    <TouchableOpacity
      onPress={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onDelete();
      }}
      className="w-20 items-center justify-center"
      style={{ backgroundColor: ROSE }}
    >
      <Trash2 size={20} color="#fff" />
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        className="flex-row items-center px-5 py-3 border-b border-zinc-800 bg-background"
      >
        <View
          className="h-10 w-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: `${category?.color ?? "#52525b"}26` }}
        >
          <Icon size={18} color={category?.color ?? ZINC_400} />
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
            {category?.name ??
              (tx.type === "transfer"
                ? "Transfer"
                : isIncoming
                  ? "Income"
                  : "Expense")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              color: ZINC_400,
            }}
            numberOfLines={1}
          >
            {format(new Date(tx.date), "h:mm a")}
            {tx.note ? ` · ${tx.note}` : ""}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 14,
            color: isIncoming ? EMERALD : "#f4f4f5",
          }}
        >
          {sign}
          {formatAmount(Math.abs(amt), currency).replace(/^-/, "")}
        </Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

type Section = { title: string; date: Date; delta: number; data: Tx[] };

function groupByDay(rows: Tx[]): Section[] {
  if (rows.length === 0) return [];
  const today = startOfDay(new Date());
  const yesterday = subDays(today, 1);
  const map = new Map<string, { date: Date; rows: Tx[] }>();
  for (const r of rows) {
    const d = startOfDay(new Date(r.date));
    const k = format(d, "yyyy-MM-dd");
    const cur = map.get(k);
    if (cur) cur.rows.push(r);
    else map.set(k, { date: d, rows: [r] });
  }
  return Array.from(map.values())
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map(({ date, rows }) => {
      const title = isSameDay(date, today)
        ? "Today"
        : isSameDay(date, yesterday)
          ? "Yesterday"
          : format(date, "MMM d");
      // Net delta on this account for this day (signed).
      const delta = rows.reduce((sum, r) => {
        const a = Number(r.amount);
        if (r.type === "income") return sum + a;
        if (r.type === "expense") return sum - a;
        return sum + a; // transfer (already signed)
      }, 0);
      return { title, date, delta, data: rows };
    });
}

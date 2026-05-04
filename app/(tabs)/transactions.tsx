/**
 * Transactions — full searchable history.
 *
 * Search + filters live in a Zustand store so the sheet, the chip row,
 * and the list all read from one place. The list is paginated via
 * useInfiniteQuery (50 rows per page) and grouped by day in JS after
 * each page lands; the SectionList renders day headers with day totals.
 *
 * Tap a row → edit sheet (reuses Keypad).
 * Swipe a row left → reveal Edit/Delete actions.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  format,
  isSameDay,
  startOfDay,
  subDays,
} from "date-fns";
import {
  ChevronRight,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import {
  TransactionFilterSheet,
} from "@/components/TransactionFilterSheet";
import {
  TransactionEditSheet,
  type EditableTransaction,
} from "@/components/TransactionEditSheet";
import {
  chipsFor,
  filterKey,
  presetLabel,
  presetRange,
  removeChip,
  type FilterChip,
  type TransactionFilter,
  useTransactionFilterStore,
} from "@/stores/transactionFilterStore";

const PAGE_SIZE = 50;
const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
type Tx = {
  id: string;
  amount: string;
  type: "income" | "expense" | "transfer";
  note: string | null;
  date: string;
  account_id: string;
  category_id: string | null;
};
type Category = { id: string; name: string; icon: string; color: string };
type Account = { id: string; name: string; icon: string; color: string };

type Section = {
  title: string;
  date: Date;
  total: number;
  data: Tx[];
};

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function TransactionsScreen() {
  const qc = useQueryClient();
  const filter = useTransactionFilterStore((s) => s.filter);
  const setSearch = useTransactionFilterStore((s) => s.setSearch);
  const setFilter = useTransactionFilterStore((s) => s.setFilter);

  const [filterOpen, setFilterOpen] = useState(false);
  const [editTx, setEditTx] = useState<EditableTransaction | null>(null);

  // Lookups for category names and icons
  const { data: categories } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,icon,color");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,name,icon,color");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: me } = useQuery({
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
  const currency = me?.currency ?? "PKR";

  // Pre-compute category IDs whose names match the search (so we can OR
  // them into the WHERE clause).
  const matchedCatIds = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    if (!q || !categories) return [] as string[];
    return categories
      .filter((c) => c.name.toLowerCase().includes(q))
      .map((c) => c.id);
  }, [filter.search, categories]);

  // Infinite query
  const list = useInfiniteQuery<Tx[], Error>({
    queryKey: [
      "transactions",
      "list",
      filterKey(filter),
      matchedCatIds.join(","),
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = pageParam as number;
      let q = supabase
        .from("transactions")
        .select("id,amount,type,note,date,account_id,category_id")
        .order("date", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      // Date preset
      const range = presetRange(filter.datePreset);
      if (range) {
        q = q
          .gte("date", range.start.toISOString())
          .lte("date", range.end.toISOString());
      }
      if (filter.accountIds.length)  q = q.in("account_id",  filter.accountIds);
      if (filter.categoryIds.length) q = q.in("category_id", filter.categoryIds);
      if (filter.types.length)        q = q.in("type",        filter.types);
      if (filter.amountMin != null)   q = q.gte("amount",    filter.amountMin);
      if (filter.amountMax != null)   q = q.lte("amount",    filter.amountMax);

      // Search — note ILIKE OR category match
      const term = filter.search.trim();
      if (term) {
        const ilike = `%${term.replace(/[%_,]/g, "")}%`;
        if (matchedCatIds.length) {
          q = q.or(
            `note.ilike.${ilike},category_id.in.(${matchedCatIds.join(",")})`,
          );
        } else {
          q = q.ilike("note", ilike);
        }
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length,
  });

  const flat: Tx[] = useMemo(
    () => list.data?.pages.flat() ?? [],
    [list.data],
  );
  const sections = useMemo(() => groupByDay(flat), [flat]);

  // Delete
  const deleteTx = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });
      const snapshot = qc.getQueriesData<{ pages: Tx[][] }>({
        queryKey: ["transactions"],
      });
      qc.setQueriesData<{ pages: Tx[][] } | undefined>(
        { queryKey: ["transactions"] },
        (data) => {
          if (!data?.pages) return data;
          return {
            ...data,
            pages: data.pages.map((p) => p.filter((t) => t.id !== id)),
          };
        },
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
  });

  const onRefresh = useCallback(async () => {
    await list.refetch();
  }, [list]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-2 pb-2">
        <Text
          className="text-foreground"
          style={{ fontFamily: "Inter_700Bold", fontSize: 22 }}
        >
          Transactions
        </Text>
        <TouchableOpacity
          onPress={() => setFilterOpen(true)}
          activeOpacity={0.85}
          className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
        >
          <SlidersHorizontal size={16} color="#f4f4f5" />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View className="px-4 pb-2">
        <View className="h-11 flex-row items-center px-3 rounded-xl bg-card border border-border">
          <Search size={16} color={ZINC_400} />
          <TextInput
            value={filter.search}
            onChangeText={setSearch}
            placeholder="Search notes, categories…"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 ml-2 text-foreground"
            style={{ fontFamily: "Inter_400Regular" }}
          />
          {filter.search ? (
            <TouchableOpacity
              onPress={() => setSearch("")}
              hitSlop={10}
              className="ml-2"
            >
              <X size={16} color={ZINC_400} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Active chips */}
      <ChipRow
        filter={filter}
        categories={categories ?? []}
        accounts={accounts ?? []}
        onRemove={(chip) => setFilter(diff(filter, chip))}
      />

      {/* List */}
      <SectionList<Tx, Section>
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={
          list.isLoading ? (
            <View className="items-center justify-center py-16">
              <ActivityIndicator color={EMERALD} />
            </View>
          ) : (
            <EmptyState />
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View className="py-6 items-center">
              <ActivityIndicator color={EMERALD} />
            </View>
          ) : null
        }
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage)
            list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={onRefresh}
            tintColor={EMERALD}
          />
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
              {formatAmount(section.total, currency)}
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const cat =
            categories?.find((c) => c.id === item.category_id) ?? null;
          const acc =
            accounts?.find((a) => a.id === item.account_id) ?? null;
          return (
            <TransactionRow
              tx={item}
              category={cat}
              account={acc}
              currency={currency}
              onEdit={() =>
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
          );
        }}
      />

      <TransactionFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        currency={currency}
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
// Helpers + sub-components
// ──────────────────────────────────────────────────────────────────────────
function diff(f: TransactionFilter, chip: FilterChip): Partial<TransactionFilter> {
  const next = removeChip(f, chip);
  return next; // setFilter merges, so passing the next snapshot is fine
}

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
      const total = rows
        .filter((r) => r.type === "expense")
        .reduce((s, r) => s + Number(r.amount), 0);
      return { title, date, total, data: rows };
    });
}

function ChipRow({
  filter,
  categories,
  accounts,
  onRemove,
}: {
  filter: TransactionFilter;
  categories: Category[];
  accounts: Account[];
  onRemove: (chip: FilterChip) => void;
}) {
  const chips = chipsFor(filter);
  if (chips.length === 0) return null;

  const labelFor = (c: FilterChip) => {
    switch (c.kind) {
      case "search":   return `“${filter.search}”`;
      case "date":     return presetLabel(filter.datePreset);
      case "type":     return capitalize(c.value);
      case "amount":   {
        const lo = filter.amountMin ?? "";
        const hi = filter.amountMax ?? "";
        return `${lo}–${hi}`;
      }
      case "account":  return accounts.find((a) => a.id === c.id)?.name ?? "Account";
      case "category": return categories.find((cc) => cc.id === c.id)?.name ?? "Category";
    }
  };

  return (
    <View className="px-4 pb-2 flex-row flex-wrap" style={{ gap: 6 }}>
      {chips.map((c, i) => (
        <TouchableOpacity
          key={`${c.kind}-${("id" in c && c.id) || ("value" in c && c.value) || i}`}
          onPress={() => onRemove(c)}
          activeOpacity={0.85}
          className="h-7 px-2 flex-row items-center rounded-full"
          style={{ borderWidth: 1, borderColor: EMERALD, backgroundColor: `${EMERALD}1a` }}
        >
          <Text
            style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: EMERALD }}
          >
            {labelFor(c)}
          </Text>
          <X size={12} color={EMERALD} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function capitalize(s: string) {
  return s[0]?.toUpperCase() + s.slice(1);
}

function TransactionRow({
  tx,
  category,
  account,
  currency,
  onEdit,
  onDelete,
}: {
  tx: Tx;
  category: Category | null;
  account: Account | null;
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = getLucideIcon(category?.icon ?? "circle");
  const isIncome = tx.type === "income";
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <View className="flex-row">
      <TouchableOpacity
        onPress={() => {
          swipeRef.current?.close();
          onEdit();
        }}
        className="w-16 items-center justify-center"
        style={{ backgroundColor: "#27272a" }}
        activeOpacity={0.85}
      >
        <Pencil size={18} color="#f4f4f5" />
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 10,
            color: "#f4f4f5",
            marginTop: 2,
          }}
        >
          Edit
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          swipeRef.current?.close();
          onDelete();
        }}
        className="w-16 items-center justify-center"
        style={{ backgroundColor: ROSE }}
        activeOpacity={0.85}
      >
        <Trash2 size={18} color="#fff" />
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 10,
            color: "#fff",
            marginTop: 2,
          }}
        >
          Delete
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
    >
      <TouchableOpacity
        onPress={onEdit}
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
            className="text-foreground"
            style={{ fontFamily: "Inter_600SemiBold", fontSize: 14 }}
            numberOfLines={1}
          >
            {category?.name ?? (isIncome ? "Income" : "Expense")}
          </Text>
          <Text
            style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: ZINC_400 }}
            numberOfLines={1}
          >
            {(tx.note ? `${tx.note} · ` : "") + (account?.name ?? "")}
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
        <ChevronRight size={14} color={ZINC_500} style={{ marginLeft: 6 }} />
      </TouchableOpacity>
    </Swipeable>
  );
}

function EmptyState() {
  return (
    <View className="items-center justify-center px-8 py-20">
      <View
        className="h-16 w-16 rounded-2xl items-center justify-center mb-4"
        style={{ backgroundColor: `${EMERALD}1a` }}
      >
        <Search size={28} color={EMERALD} />
      </View>
      <Text
        className="text-foreground mb-1"
        style={{ fontFamily: "Inter_700Bold", fontSize: 16 }}
      >
        No transactions found
      </Text>
      <Text
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          color: ZINC_400,
          textAlign: "center",
        }}
      >
        Try adjusting your filters or search terms.
      </Text>
    </View>
  );
}

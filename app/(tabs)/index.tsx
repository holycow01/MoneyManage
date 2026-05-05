/**
 * Home / Quick Entry — the most-used screen in Pulse.
 *
 * Two-tap flow: type amount → tap category → done. The keypad is a small
 * calculator (1+2 etc.) and there's an optional shortcut row above the
 * categories for one-tap repeat entries.
 *
 * Data flow:
 *   - Reads accounts/categories/shortcuts/today's transactions via TanStack
 *     Query against Supabase (RLS-checked).
 *   - Inserts go through the same Supabase client; we optimistically update
 *     the cached "recent" list and "today total" so the UI flips
 *     instantly. Rollback on error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { format, startOfDay, endOfDay } from "date-fns";
import {
  Check,
  ChevronDown,
  Settings as SettingsIcon,
  Target,
  Trash2,
  Wallet,
} from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { getLucideIcon } from "@/lib/icons";
import { formatAmount, formatNumber, symbolFor } from "@/lib/currency";
import { formatExpression } from "@/lib/calculator";
import { useEntryStore } from "@/stores/entryStore";
import { Keypad, KeypadSaveButton } from "@/components/Keypad";
import { runBudgetCheck } from "@/lib/notifications";

// ──────────────────────────────────────────────────────────────────────────
// Types (mirroring db/schema columns we actually read)
// ──────────────────────────────────────────────────────────────────────────
type Account = {
  id: string;
  name: string;
  type: "cash" | "bank" | "credit" | "wallet" | "savings";
  color: string;
  icon: string;
  archived: boolean;
};
type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: "income" | "expense";
};
type Shortcut = {
  id: string;
  label: string;
  amount: string; // numeric → string from postgres-js
  category_id: string | null;
  account_id: string | null;
  position: number;
};
type Transaction = {
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
export default function HomeScreen() {
  const qc = useQueryClient();
  const router = useRouter();

  const expression = useEntryStore((s) => s.expression);
  const amount = useEntryStore((s) => s.amount);
  const selectedCategoryId = useEntryStore((s) => s.selectedCategoryId);
  const selectedAccountId = useEntryStore((s) => s.selectedAccountId);
  const note = useEntryStore((s) => s.note);
  const pressKey = useEntryStore((s) => s.pressKey);
  const setCategory = useEntryStore((s) => s.setCategory);
  const setAccount = useEntryStore((s) => s.setAccount);
  const setNote = useEntryStore((s) => s.setNote);
  const setAmount = useEntryStore((s) => s.setAmount);
  const reset = useEntryStore((s) => s.reset);

  // Currency from the user row (cached). Default to PKR.
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

  const accountsQ = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,name,type,color,icon,archived")
        .eq("archived", false)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const categoriesQ = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,icon,color,type")
        .order("type", { ascending: false }) // expenses first
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const shortcutsQ = useQuery<Shortcut[]>({
    queryKey: ["shortcuts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shortcuts")
        .select("id,label,amount,category_id,account_id,position")
        .order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const todayStart = startOfDay(new Date()).toISOString();
  const todayEnd = endOfDay(new Date()).toISOString();
  const todayQ = useQuery<Transaction[]>({
    queryKey: ["transactions", "today", todayStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,amount,type,note,date,category_id,account_id")
        .gte("date", todayStart)
        .lte("date", todayEnd)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const recentQ = useQuery<Transaction[]>({
    queryKey: ["transactions", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,amount,type,note,date,category_id,account_id")
        .order("date", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pick the first non-archived account once it loads.
  useEffect(() => {
    if (!selectedAccountId && accountsQ.data?.length) {
      setAccount(accountsQ.data[0].id);
    }
  }, [accountsQ.data, selectedAccountId, setAccount]);

  // ── Mutation: insert a transaction ───────────────────────────────────
  const insertTx = useMutation({
    mutationFn: async (input: {
      amount: number;
      categoryId: string | null;
      accountId: string;
      note: string | null;
      type: "income" | "expense";
    }) => {
      const { data, error } = await supabase
        .from("transactions")
        .insert({
          amount: input.amount.toFixed(2),
          type: input.type,
          note: input.note,
          category_id: input.categoryId,
          account_id: input.accountId,
          date: new Date().toISOString(),
        })
        .select("id,amount,type,note,date,category_id,account_id")
        .single();
      if (error) throw error;
      return data as Transaction;
    },
    onMutate: async (input) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["transactions", "today", todayStart] }),
        qc.cancelQueries({ queryKey: ["transactions", "recent"] }),
      ]);
      const prevToday = qc.getQueryData<Transaction[]>([
        "transactions", "today", todayStart,
      ]) ?? [];
      const prevRecent = qc.getQueryData<Transaction[]>([
        "transactions", "recent",
      ]) ?? [];
      const optimistic: Transaction = {
        id: `optimistic-${Date.now()}`,
        amount: input.amount.toFixed(2),
        type: input.type,
        note: input.note,
        date: new Date().toISOString(),
        category_id: input.categoryId,
        account_id: input.accountId,
      };
      qc.setQueryData(
        ["transactions", "today", todayStart],
        [optimistic, ...prevToday],
      );
      qc.setQueryData(
        ["transactions", "recent"],
        [optimistic, ...prevRecent].slice(0, 5),
      );
      return { prevToday, prevRecent };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevToday)
        qc.setQueryData(
          ["transactions", "today", todayStart],
          ctx.prevToday,
        );
      if (ctx?.prevRecent)
        qc.setQueryData(["transactions", "recent"], ctx.prevRecent);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", "Please try again.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
    onSuccess: () => {
      // Fire-and-forget — never block the save path on a notification.
      void runBudgetCheck();
    },
  });

  // ── Mutation: delete a transaction (swipe) ───────────────────────────
  const deleteTx = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["transactions", "today", todayStart] }),
        qc.cancelQueries({ queryKey: ["transactions", "recent"] }),
      ]);
      const prevToday = qc.getQueryData<Transaction[]>([
        "transactions", "today", todayStart,
      ]) ?? [];
      const prevRecent = qc.getQueryData<Transaction[]>([
        "transactions", "recent",
      ]) ?? [];
      qc.setQueryData(
        ["transactions", "today", todayStart],
        prevToday.filter((t) => t.id !== id),
      );
      qc.setQueryData(
        ["transactions", "recent"],
        prevRecent.filter((t) => t.id !== id),
      );
      return { prevToday, prevRecent };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevToday)
        qc.setQueryData(["transactions", "today", todayStart], ctx.prevToday);
      if (ctx?.prevRecent)
        qc.setQueryData(["transactions", "recent"], ctx.prevRecent);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  // ── Save flow ────────────────────────────────────────────────────────
  const save = useCallback(
    async (overrides?: {
      amount?: number;
      categoryId?: string | null;
      accountId?: string | null;
      note?: string | null;
    }) => {
      const finalAmount = overrides?.amount ?? amount;
      const finalCategoryId = overrides?.categoryId ?? selectedCategoryId;
      const finalAccountId = overrides?.accountId ?? selectedAccountId;
      const finalNote = overrides?.note ?? (note || null);

      if (!finalAmount || finalAmount <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      if (!finalAccountId) {
        Alert.alert("Pick an account first.");
        return;
      }

      const cat = categoriesQ.data?.find((c) => c.id === finalCategoryId);
      const txType: "income" | "expense" =
        cat?.type === "income" ? "income" : "expense";

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      insertTx.mutate({
        amount: finalAmount,
        categoryId: finalCategoryId,
        accountId: finalAccountId,
        note: finalNote,
        type: txType,
      });
      reset();
    },
    [
      amount,
      selectedCategoryId,
      selectedAccountId,
      note,
      categoriesQ.data,
      insertTx,
      reset,
    ],
  );

  // ── Tap a category: save instantly if amount is set, else select ────
  const onCategoryTap = useCallback(
    (id: string) => {
      Haptics.selectionAsync();
      if (amount > 0) {
        save({ categoryId: id });
      } else {
        setCategory(selectedCategoryId === id ? null : id);
      }
    },
    [amount, save, selectedCategoryId, setCategory],
  );

  const onShortcutTap = useCallback(
    (s: Shortcut) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const amt = Number(s.amount);
      const acct = s.account_id ?? selectedAccountId;
      if (!acct) {
        Alert.alert("Set a default account first.");
        return;
      }
      save({
        amount: amt,
        categoryId: s.category_id,
        accountId: acct,
        note: s.label,
      });
    },
    [save, selectedAccountId],
  );

  // Haptics fire inside <Keypad/> itself.
  const onKey = pressKey;

  // ── Animated amount flip ─────────────────────────────────────────────
  const scale = useSharedValue(1);
  const colorMix = useSharedValue(0); // 0 = idle (zinc-100), 1 = typing (emerald)
  const lastAmount = useRef(amount);
  useEffect(() => {
    if (lastAmount.current !== amount) {
      scale.value = 1.06;
      scale.value = withSpring(1, { damping: 14, stiffness: 220 });
      lastAmount.current = amount;
    }
    colorMix.value = withTiming(expression ? 1 : 0, { duration: 180 });
  }, [amount, expression, scale, colorMix]);

  const amountStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const totalToday = useMemo(
    () =>
      (todayQ.data ?? [])
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + Number(t.amount), 0),
    [todayQ.data],
  );

  const selectedAccount = accountsQ.data?.find(
    (a) => a.id === selectedAccountId,
  );

  const [accountModalOpen, setAccountModalOpen] = useState(false);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Header */}
        <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
          <View className="flex-1">
            <Text
              className="text-foreground text-base"
              style={{ fontFamily: "Inter_600SemiBold" }}
            >
              {format(new Date(), "EEEE, MMM d")}
            </Text>
            <Text
              className="text-muted text-xs mt-0.5"
              style={{ fontFamily: "Inter_500Medium" }}
            >
              Today · {formatAmount(totalToday, currency)}
            </Text>
          </View>

          <View className="flex-row" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                router.push("/accounts");
              }}
              hitSlop={8}
              accessibilityLabel="Accounts"
              className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
              activeOpacity={0.85}
            >
              <Wallet size={16} color="#a1a1aa" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                router.push("/budgets");
              }}
              hitSlop={8}
              accessibilityLabel="Budgets"
              className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
              activeOpacity={0.85}
            >
              <Target size={16} color="#a1a1aa" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                router.push("/settings");
              }}
              hitSlop={8}
              accessibilityLabel="Settings"
              className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
              activeOpacity={0.85}
            >
              <SettingsIcon size={16} color="#a1a1aa" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. Amount display */}
        <View className="px-5 pt-4 pb-3">
          {expression ? (
            <Text
              className="text-muted text-sm"
              style={{ fontFamily: "Inter_500Medium" }}
              numberOfLines={1}
            >
              {formatExpression(expression)}
            </Text>
          ) : (
            <View className="h-5" />
          )}
          <Animated.View
            style={amountStyle}
            className="flex-row items-baseline mt-1"
          >
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 28,
                color: expression ? "#10b981" : "#a1a1aa",
                marginRight: 8,
              }}
            >
              {symbolFor(currency).trim()}
            </Text>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 64,
                lineHeight: 72,
                color: expression ? "#10b981" : "#f4f4f5",
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatNumber(amount)}
            </Text>
          </Animated.View>
        </View>

        {/* 3. Shortcut row (hidden when empty) */}
        {(shortcutsQ.data?.length ?? 0) > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            className="mb-2"
          >
            {shortcutsQ.data!.map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => onShortcutTap(s)}
                activeOpacity={0.85}
                className="mr-2 px-3 h-9 flex-row items-center rounded-full bg-card border border-border"
              >
                <Text
                  className="text-foreground text-xs"
                  style={{ fontFamily: "Inter_600SemiBold" }}
                >
                  {s.label}
                </Text>
                <Text
                  className="ml-2 text-muted text-xs"
                  style={{ fontFamily: "Inter_500Medium" }}
                >
                  {formatAmount(Number(s.amount), currency)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {/* 4. Category strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        >
          {(categoriesQ.data ?? []).map((c) => (
            <CategoryPill
              key={c.id}
              category={c}
              selected={c.id === selectedCategoryId}
              onPress={() => onCategoryTap(c.id)}
            />
          ))}
        </ScrollView>

        {/* 5. Account selector + note */}
        <View className="flex-row items-center px-5 mt-2 mb-3">
          <TouchableOpacity
            onPress={() => setAccountModalOpen(true)}
            activeOpacity={0.85}
            className="h-9 px-3 flex-row items-center rounded-full bg-card border border-border"
          >
            <Wallet size={14} color="#a1a1aa" />
            <Text
              className="ml-2 text-foreground text-xs"
              style={{ fontFamily: "Inter_600SemiBold" }}
            >
              {selectedAccount?.name ?? "Account"}
            </Text>
            <ChevronDown size={14} color="#a1a1aa" style={{ marginLeft: 4 }} />
          </TouchableOpacity>

          <View className="flex-1 ml-3">
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add note…"
              placeholderTextColor="#52525b"
              className="text-foreground"
              style={{ fontFamily: "Inter_400Regular" }}
            />
          </View>
        </View>

        {/* 6. Keypad */}
        <View className="px-3">
          <Keypad onKey={onKey} />
          <KeypadSaveButton
            disabled={!amount || !selectedAccountId}
            highlighted={!!selectedCategoryId && amount > 0}
            busy={insertTx.isPending}
            onPress={() => save()}
          />
        </View>

        {/* 7. Recent transactions */}
        <View className="mt-6">
          <Text
            className="px-5 text-muted text-xs"
            style={{ fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 }}
          >
            RECENT
          </Text>
          <View className="mt-2">
            {recentQ.isLoading ? (
              <View className="h-16 items-center justify-center">
                <ActivityIndicator color="#10b981" />
              </View>
            ) : (recentQ.data ?? []).length === 0 ? (
              <Text
                className="px-5 py-4 text-muted text-sm"
                style={{ fontFamily: "Inter_400Regular" }}
              >
                No entries yet — log your first one above.
              </Text>
            ) : (
              (recentQ.data ?? []).map((t) => (
                <RecentRow
                  key={t.id}
                  tx={t}
                  category={
                    categoriesQ.data?.find((c) => c.id === t.category_id) ??
                    null
                  }
                  account={
                    accountsQ.data?.find((a) => a.id === t.account_id) ?? null
                  }
                  currency={currency}
                  onDelete={() => deleteTx.mutate(t.id)}
                />
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* Account picker modal */}
      <Modal
        transparent
        visible={accountModalOpen}
        animationType="fade"
        onRequestClose={() => setAccountModalOpen(false)}
      >
        <Pressable
          className="flex-1 justify-end bg-black/60"
          onPress={() => setAccountModalOpen(false)}
        >
          <Pressable
            className="rounded-t-2xl bg-card border-t border-border p-4"
            onPress={(e) => e.stopPropagation()}
          >
            <Text
              className="px-2 pb-3 text-muted text-xs"
              style={{ fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 }}
            >
              SELECT ACCOUNT
            </Text>
            {(accountsQ.data ?? []).map((a) => (
              <TouchableOpacity
                key={a.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  setAccount(a.id);
                  setAccountModalOpen(false);
                }}
                className="flex-row items-center px-2 py-3"
              >
                <View
                  className="h-8 w-8 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: `${a.color}33` }}
                >
                  <AccountIcon name={a.icon} color={a.color} />
                </View>
                <Text
                  className="flex-1 text-foreground"
                  style={{ fontFamily: "Inter_500Medium" }}
                >
                  {a.name}
                </Text>
                {a.id === selectedAccountId ? (
                  <Check size={18} color="#10b981" />
                ) : null}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function CategoryPill({
  category,
  selected,
  onPress,
}: {
  category: Category;
  selected: boolean;
  onPress: () => void;
}) {
  const Icon = getLucideIcon(category.icon);
  const ringScale = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    ringScale.value = withSpring(selected ? 1 : 0, {
      damping: 14,
      stiffness: 220,
    });
  }, [selected, ringScale]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringScale.value,
    transform: [{ scale: 0.95 + ringScale.value * 0.1 }],
  }));

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      className="items-center mr-3"
      style={{ width: 64 }}
    >
      <View className="relative h-12 w-12 items-center justify-center">
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              borderWidth: 2,
              borderColor: "#10b981",
            },
            ringStyle,
          ]}
        />
        <View
          className="h-10 w-10 rounded-full items-center justify-center"
          style={{ backgroundColor: `${category.color}26` }}
        >
          <Icon size={20} color={category.color} />
        </View>
      </View>
      <Text
        numberOfLines={1}
        className="mt-1 text-xs"
        style={{
          fontFamily: "Inter_500Medium",
          color: selected ? "#f4f4f5" : "#a1a1aa",
        }}
      >
        {category.name}
      </Text>
    </TouchableOpacity>
  );
}

function AccountIcon({ name, color }: { name: string; color: string }) {
  const Icon = getLucideIcon(name);
  return <Icon size={16} color={color} />;
}

function RecentRow({
  tx,
  category,
  account,
  currency,
  onDelete,
}: {
  tx: Transaction;
  category: Category | null;
  account: Account | null;
  currency: string;
  onDelete: () => void;
}) {
  const Icon = getLucideIcon(category?.icon ?? "circle");
  const isIncome = tx.type === "income";

  const renderRightActions = () => (
    <View className="w-20 items-center justify-center bg-rose-600/90 rounded-r-2xl mx-3">
      <Trash2 size={20} color="#fff" />
    </View>
  );

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      onSwipeableOpen={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onDelete();
      }}
      overshootRight={false}
    >
      <View className="mx-3 mb-2 px-3 py-3 flex-row items-center rounded-2xl bg-card border border-border">
        <View
          className="h-10 w-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: `${category?.color ?? "#52525b"}26` }}
        >
          <Icon size={18} color={category?.color ?? "#a1a1aa"} />
        </View>
        <View className="flex-1">
          <Text
            className="text-foreground"
            style={{ fontFamily: "Inter_600SemiBold" }}
            numberOfLines={1}
          >
            {category?.name ?? (isIncome ? "Income" : "Expense")}
          </Text>
          <Text
            className="text-muted text-xs"
            style={{ fontFamily: "Inter_400Regular" }}
            numberOfLines={1}
          >
            {(tx.note ? `${tx.note} · ` : "") + (account?.name ?? "")}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 16,
            color: isIncome ? "#10b981" : "#f4f4f5",
          }}
        >
          {isIncome ? "+" : "−"}
          {formatAmount(Number(tx.amount), currency).replace(/^-/, "")}
        </Text>
      </View>
    </Swipeable>
  );
}

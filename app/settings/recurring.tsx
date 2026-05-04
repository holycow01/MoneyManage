/**
 * Recurring transactions — paused/active rules from the `recurring` table.
 *
 *   Tap a row    → open <RecurringSheet> in edit mode.
 *   Tap "+"      → open the sheet in create mode.
 *   Long-press   → quick delete confirmation.
 *   Inline switch → flips the `active` flag without opening the sheet.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import { Skeleton } from "@/components/Skeleton";
import { RecurringSheet, type RecurringRow } from "@/components/RecurringSheet";

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

type Category = { id: string; name: string; icon: string; color: string };
type Account = { id: string; name: string };

export default function RecurringScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRow | null>(null);

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

  const recurringQ = useQuery<RecurringRow[]>({
    queryKey: ["recurring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring")
        .select("id,account_id,category_id,amount,frequency,next_run,note,active")
        .order("active", { ascending: false })
        .order("next_run", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RecurringRow[];
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

  const accountsQ = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("id,name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await supabase
        .from("recurring")
        .update({ active: next })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, next }) => {
      await qc.cancelQueries({ queryKey: ["recurring"] });
      const prev = qc.getQueryData<RecurringRow[]>(["recurring"]) ?? [];
      qc.setQueryData<RecurringRow[]>(
        ["recurring"],
        prev.map((r) => (r.id === id ? { ...r, active: next } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["recurring"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recurring").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["recurring"] });
    },
  });

  const grouped = useMemo(() => {
    const rows = recurringQ.data ?? [];
    return {
      active: rows.filter((r) => r.active),
      paused: rows.filter((r) => !r.active),
    };
  }, [recurringQ.data]);

  const openAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (r: RecurringRow) => {
    setEditing(r);
    setSheetOpen(true);
  };

  const onLongPress = (r: RecurringRow) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "Delete recurring rule?",
      "Already-created transactions won't be touched.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(r.id) },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
          activeOpacity={0.85}
        >
          <ChevronLeft size={18} color="#f4f4f5" />
        </TouchableOpacity>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#f4f4f5" }}>
          Recurring
        </Text>
        <TouchableOpacity
          onPress={openAdd}
          hitSlop={12}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `${EMERALD}1a`, borderWidth: 1, borderColor: `${EMERALD}40` }}
          activeOpacity={0.85}
        >
          <Plus size={16} color={EMERALD} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {recurringQ.isLoading ? (
          <View className="px-4 mt-2" style={{ gap: 8 }}>
            <Skeleton style={{ height: 64, borderRadius: 16 }} />
            <Skeleton style={{ height: 64, borderRadius: 16 }} />
          </View>
        ) : (recurringQ.data ?? []).length === 0 ? (
          <EmptyState onAdd={openAdd} />
        ) : (
          <>
            <Group
              label="ACTIVE"
              rows={grouped.active}
              currency={currency}
              categories={categoriesQ.data ?? []}
              accounts={accountsQ.data ?? []}
              onPress={openEdit}
              onLongPress={onLongPress}
              onToggle={(id, next) => toggleActive.mutate({ id, next })}
            />
            <Group
              label="PAUSED"
              rows={grouped.paused}
              currency={currency}
              categories={categoriesQ.data ?? []}
              accounts={accountsQ.data ?? []}
              onPress={openEdit}
              onLongPress={onLongPress}
              onToggle={(id, next) => toggleActive.mutate({ id, next })}
              dim
            />
          </>
        )}
      </ScrollView>

      <RecurringSheet
        open={sheetOpen}
        recurring={editing}
        currency={currency}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

function Group({
  label,
  rows,
  currency,
  categories,
  accounts,
  onPress,
  onLongPress,
  onToggle,
  dim,
}: {
  label: string;
  rows: RecurringRow[];
  currency: string;
  categories: Category[];
  accounts: Account[];
  onPress: (r: RecurringRow) => void;
  onLongPress: (r: RecurringRow) => void;
  onToggle: (id: string, next: boolean) => void;
  dim?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <View>
      <Text
        className="px-5 pt-6 pb-2"
        style={{
          fontFamily: "Inter_500Medium",
          fontSize: 11,
          color: ZINC_500,
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
      <View className="mx-4 rounded-2xl bg-card border border-border overflow-hidden">
        {rows.map((r, i) => (
          <RecurringRowView
            key={r.id}
            row={r}
            category={categories.find((c) => c.id === r.category_id) ?? null}
            account={accounts.find((a) => a.id === r.account_id) ?? null}
            currency={currency}
            onPress={() => onPress(r)}
            onLongPress={() => onLongPress(r)}
            onToggle={(next) => onToggle(r.id, next)}
            last={i === rows.length - 1}
            dim={dim}
          />
        ))}
      </View>
    </View>
  );
}

function RecurringRowView({
  row,
  category,
  account,
  currency,
  onPress,
  onLongPress,
  onToggle,
  last,
  dim,
}: {
  row: RecurringRow;
  category: Category | null;
  account: Account | null;
  currency: string;
  onPress: () => void;
  onLongPress: () => void;
  onToggle: (next: boolean) => void;
  last: boolean;
  dim?: boolean;
}) {
  const Icon = getLucideIcon(category?.icon ?? "refresh-cw");
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      android_ripple={{ color: "#27272a" }}
      style={{
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: "#27272a",
        opacity: dim ? 0.55 : 1,
      }}
      className="flex-row items-center px-4 py-3"
    >
      <View
        className="h-9 w-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${category?.color ?? "#52525b"}26` }}
      >
        <Icon size={16} color={category?.color ?? ZINC_400} />
      </View>
      <View className="flex-1">
        <Text
          numberOfLines={1}
          style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#f4f4f5" }}
        >
          {category?.name ?? row.note ?? "Recurring"}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
        >
          {capitalize(row.frequency)} · next on {format(new Date(row.next_run), "MMM d")}
          {account ? ` · ${account.name}` : ""}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 13,
          color: "#f4f4f5",
          marginRight: 10,
        }}
      >
        {formatAmount(Number(row.amount), currency)}
      </Text>
      <Switch
        value={row.active}
        onValueChange={(v) => {
          Haptics.selectionAsync();
          onToggle(v);
        }}
        trackColor={{ false: "#3f3f46", true: EMERALD }}
        thumbColor="#f4f4f5"
      />
    </Pressable>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <View className="px-8 py-16 items-center">
      <View
        className="h-14 w-14 rounded-2xl items-center justify-center mb-4"
        style={{ backgroundColor: `${EMERALD}1a` }}
      >
        <RefreshCw size={26} color={EMERALD} />
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#f4f4f5" }}>
        No recurring transactions
      </Text>
      <Text
        className="mt-1 mb-4 text-center"
        style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: ZINC_400 }}
      >
        Add rules for things that hit your account on a schedule — salary,
        rent, gym memberships — and Pulse will log them automatically.
      </Text>
      <TouchableOpacity
        onPress={onAdd}
        className="h-10 px-4 rounded-full flex-row items-center"
        style={{ backgroundColor: EMERALD }}
      >
        <Plus size={14} color="#09090b" />
        <Text
          className="ml-2"
          style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#09090b" }}
        >
          Add recurring
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

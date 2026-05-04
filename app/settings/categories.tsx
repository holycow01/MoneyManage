/**
 * Categories management — list grouped by Expense / Income.
 *
 *   Tap a row     → open <CategorySheet> in edit mode.
 *   Tap "+"       → open <CategorySheet> in create mode.
 *   Long-press    → quick delete confirmation.
 *
 * Counts next to each row come from a single transactions query
 * (`select category_id`) bucketed in JS.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { ChevronLeft, ChevronRight, Plus, Tag } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { getLucideIcon } from "@/lib/icons";
import { Skeleton } from "@/components/Skeleton";
import { CategorySheet, type CategoryRow } from "@/components/CategorySheet";

const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";
const EMERALD = "#10b981";

export default function CategoriesScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);

  const categoriesQ = useQuery<CategoryRow[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,icon,color,type")
        .order("type", { ascending: false }) // expenses first
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
  });

  // Count transactions per category (for the secondary line)
  const countsQ = useQuery<Record<string, number>>({
    queryKey: ["categories", "counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("category_id");
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? []) {
        if (!r.category_id) continue;
        map[r.category_id] = (map[r.category_id] ?? 0) + 1;
      }
      return map;
    },
  });

  const grouped = useMemo(() => {
    const rows = categoriesQ.data ?? [];
    return {
      expense: rows.filter((c) => c.type === "expense"),
      income: rows.filter((c) => c.type === "income"),
    };
  }, [categoriesQ.data]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const openAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (c: CategoryRow) => {
    setEditing(c);
    setSheetOpen(true);
  };
  const onLongPress = (c: CategoryRow) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      `Delete ${c.name}?`,
      "Transactions in this category will become uncategorized.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => remove.mutate(c.id),
        },
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
          Categories
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
        {categoriesQ.isLoading ? (
          <View className="px-4 mt-2" style={{ gap: 8 }}>
            <Skeleton style={{ height: 56, borderRadius: 16 }} />
            <Skeleton style={{ height: 56, borderRadius: 16 }} />
            <Skeleton style={{ height: 56, borderRadius: 16 }} />
          </View>
        ) : (categoriesQ.data ?? []).length === 0 ? (
          <EmptyState onAdd={openAdd} />
        ) : (
          <>
            <Section
              label="EXPENSE"
              rows={grouped.expense}
              counts={countsQ.data ?? {}}
              onPress={openEdit}
              onLongPress={onLongPress}
            />
            <Section
              label="INCOME"
              rows={grouped.income}
              counts={countsQ.data ?? {}}
              onPress={openEdit}
              onLongPress={onLongPress}
            />
          </>
        )}
      </ScrollView>

      <CategorySheet
        open={sheetOpen}
        category={editing}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

function Section({
  label,
  rows,
  counts,
  onPress,
  onLongPress,
}: {
  label: string;
  rows: CategoryRow[];
  counts: Record<string, number>;
  onPress: (c: CategoryRow) => void;
  onLongPress: (c: CategoryRow) => void;
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
        {rows.map((c, i) => (
          <CategoryRowView
            key={c.id}
            category={c}
            count={counts[c.id] ?? 0}
            onPress={() => onPress(c)}
            onLongPress={() => onLongPress(c)}
            last={i === rows.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

function CategoryRowView({
  category,
  count,
  onPress,
  onLongPress,
  last,
}: {
  category: CategoryRow;
  count: number;
  onPress: () => void;
  onLongPress: () => void;
  last: boolean;
}) {
  const Icon = getLucideIcon(category.icon);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      android_ripple={{ color: "#27272a" }}
      style={{
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: "#27272a",
      }}
      className="flex-row items-center px-4 h-14"
    >
      <View
        className="h-8 w-8 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${category.color}26` }}
      >
        <Icon size={16} color={category.color} />
      </View>
      <View className="flex-1">
        <Text
          numberOfLines={1}
          style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#f4f4f5" }}
        >
          {category.name}
        </Text>
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: ZINC_400 }}
        >
          {count} transaction{count === 1 ? "" : "s"}
        </Text>
      </View>
      <ChevronRight size={16} color={ZINC_500} />
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
        <Tag size={26} color={EMERALD} />
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#f4f4f5" }}>
        No categories yet
      </Text>
      <Text
        className="mt-1 mb-4 text-center"
        style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: ZINC_400 }}
      >
        Pulse usually seeds 8 defaults on signup. If they're missing, tap +
        to add your first one.
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
          Add category
        </Text>
      </TouchableOpacity>
    </View>
  );
}

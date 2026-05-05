/**
 * Budget create/edit bottom sheet.
 *
 *   <BudgetSheet open={...} budget={null} onClose={...} />     // create
 *   <BudgetSheet open={...} budget={existing} onClose={...} /> // edit (incl. delete)
 *
 * Opens with the existing values prefilled (or empty for create), validates
 * locally, and runs an upsert/delete mutation against Supabase.
 *
 * In create mode, categories that already have a budget are filtered out
 * of the picker — one budget per category.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { format } from "date-fns";
import { Check, Trash2, X } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { getLucideIcon } from "@/lib/icons";
import { symbolFor } from "@/lib/currency";
import { clearBudgetNotifications } from "@/lib/notifications";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";

export type BudgetRow = {
  id: string;
  category_id: string;
  amount: string | number;
  period: "weekly" | "monthly";
  start_date: string;
};

type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: "income" | "expense";
};

export function BudgetSheet({
  open,
  budget,
  currency,
  onClose,
}: {
  open: boolean;
  budget: BudgetRow | null;
  currency: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!budget;

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [period, setPeriod] = useState<"weekly" | "monthly">("monthly");

  // Hydrate when the sheet opens with a row.
  useEffect(() => {
    if (!open) return;
    if (budget) {
      setCategoryId(budget.category_id);
      setAmountText(String(Number(budget.amount)));
      setPeriod(budget.period);
    } else {
      setCategoryId(null);
      setAmountText("");
      setPeriod("monthly");
    }
  }, [open, budget]);

  const categoriesQ = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,icon,color,type")
        .order("type", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const existingBudgetsQ = useQuery<{ category_id: string; id: string }[]>({
    queryKey: ["budgets", "category-ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("id,category_id");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  // Category options — exclude those already budgeted (unless we're editing
  // that specific budget).
  const categoryOptions = useMemo(() => {
    const cats = (categoriesQ.data ?? []).filter((c) => c.type === "expense");
    const taken = new Set(
      (existingBudgetsQ.data ?? []).map((b) => b.category_id),
    );
    if (budget) taken.delete(budget.category_id);
    return cats.filter((c) => !taken.has(c.id));
  }, [categoriesQ.data, existingBudgetsQ.data, budget]);

  const amount = Number(amountText.replace(/[^\d.]/g, "")) || 0;
  const valid = !!categoryId && amount > 0;

  const upsert = useMutation({
    mutationFn: async () => {
      if (!categoryId) throw new Error("Pick a category");
      if (amount <= 0) throw new Error("Amount must be positive");
      if (isEdit) {
        const { error } = await supabase
          .from("budgets")
          .update({
            category_id: categoryId,
            amount: amount.toFixed(2),
            period,
          })
          .eq("id", budget!.id);
        if (error) throw error;
        await clearBudgetNotifications(budget!.id);
      } else {
        const { error } = await supabase.from("budgets").insert({
          category_id: categoryId,
          amount: amount.toFixed(2),
          period,
          start_date: format(new Date(), "yyyy-MM-dd"),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["budgets"] });
      onClose();
    },
    onError: (e: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e?.message ?? "Please try again.");
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!budget) return;
      const { error } = await supabase
        .from("budgets")
        .delete()
        .eq("id", budget.id);
      if (error) throw error;
      await clearBudgetNotifications(budget.id);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["budgets"] });
      onClose();
    },
  });

  return (
    <Modal
      transparent
      visible={open}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={onClose}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-2xl bg-card border-t border-border"
            style={{ maxHeight: "92%" }}
          >
            {/* Header */}
            <View className="flex-row items-center justify-between px-5 pt-4 pb-3">
              <Text
                style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#f4f4f5" }}
              >
                {isEdit ? "Edit budget" : "Add budget"}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={20} color={ZINC_400} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {/* Amount */}
              <View className="px-5 pt-2">
                <Text style={sectionLabel}>AMOUNT</Text>
                <View className="h-12 flex-row items-center rounded-xl border border-border bg-background px-3 mt-2">
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 18,
                      color: ZINC_400,
                      marginRight: 6,
                    }}
                  >
                    {symbolFor(currency).trim()}
                  </Text>
                  <TextInput
                    value={amountText}
                    onChangeText={(t) => setAmountText(t.replace(/[^\d.]/g, ""))}
                    placeholder="0"
                    placeholderTextColor="#52525b"
                    keyboardType="decimal-pad"
                    clearButtonMode="while-editing"
                    className="flex-1 text-foreground"
                    style={{ fontFamily: "Inter_600SemiBold", fontSize: 18 }}
                  />
                  {amountText.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => setAmountText("")}
                      hitSlop={10}
                      accessibilityLabel="Clear amount"
                      className="ml-2 h-6 w-6 items-center justify-center rounded-full"
                      style={{ backgroundColor: "#27272a" }}
                    >
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: ZINC_400, lineHeight: 14 }}>×</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {/* Period */}
              <View className="px-5 pt-4">
                <Text style={sectionLabel}>PERIOD</Text>
                <View className="flex-row mt-2" style={{ gap: 8 }}>
                  {(["monthly", "weekly"] as const).map((p) => {
                    const active = period === p;
                    return (
                      <TouchableOpacity
                        key={p}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setPeriod(p);
                        }}
                        className="flex-1 h-10 items-center justify-center rounded-xl"
                        style={{
                          borderWidth: 1,
                          borderColor: active ? EMERALD : "#3f3f46",
                          backgroundColor: active ? `${EMERALD}1a` : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                            fontSize: 13,
                            color: active ? EMERALD : "#f4f4f5",
                            textTransform: "capitalize",
                          }}
                        >
                          {p}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Category */}
              <View className="px-5 pt-4">
                <Text style={sectionLabel}>CATEGORY</Text>
                {categoryOptions.length === 0 ? (
                  <Text
                    className="mt-2"
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                      color: ZINC_400,
                    }}
                  >
                    All expense categories already have a budget.
                  </Text>
                ) : (
                  <View
                    className="flex-row flex-wrap mt-2"
                    style={{ gap: 8 }}
                  >
                    {categoryOptions.map((c) => {
                      const Icon = getLucideIcon(c.icon);
                      const active = c.id === categoryId;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setCategoryId(c.id);
                          }}
                          activeOpacity={0.85}
                          className="h-9 pl-2 pr-3 flex-row items-center rounded-full"
                          style={{
                            borderWidth: 1,
                            borderColor: active ? EMERALD : "#3f3f46",
                            backgroundColor: active
                              ? `${EMERALD}1a`
                              : "transparent",
                          }}
                        >
                          <View
                            className="h-5 w-5 rounded-full items-center justify-center mr-2"
                            style={{ backgroundColor: `${c.color}33` }}
                          >
                            <Icon size={12} color={c.color} />
                          </View>
                          <Text
                            style={{
                              fontFamily: active
                                ? "Inter_700Bold"
                                : "Inter_500Medium",
                              fontSize: 12,
                              color: active ? EMERALD : "#f4f4f5",
                            }}
                          >
                            {c.name}
                          </Text>
                          {active ? (
                            <Check
                              size={12}
                              color={EMERALD}
                              style={{ marginLeft: 6 }}
                            />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* Actions */}
              <View className="px-4 pt-5 pb-5">
                <TouchableOpacity
                  onPress={() => upsert.mutate()}
                  disabled={!valid || upsert.isPending}
                  activeOpacity={0.85}
                  className="h-12 items-center justify-center rounded-2xl"
                  style={{
                    backgroundColor: valid ? EMERALD : "#1f2937",
                    opacity: valid ? 1 : 0.5,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      color: valid ? "#09090b" : ZINC_400,
                      fontSize: 14,
                    }}
                  >
                    {isEdit ? "Save changes" : "Create budget"}
                  </Text>
                </TouchableOpacity>

                {isEdit ? (
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        "Delete budget?",
                        "This won't delete any transactions, just the budget itself.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => remove.mutate(),
                          },
                        ],
                      );
                    }}
                    activeOpacity={0.7}
                    className="h-10 items-center justify-center mt-3 flex-row"
                  >
                    <Trash2 size={14} color={ROSE} />
                    <Text
                      className="ml-2"
                      style={{
                        fontFamily: "Inter_600SemiBold",
                        color: ROSE,
                        fontSize: 13,
                      }}
                    >
                      Delete budget
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const sectionLabel = {
  fontFamily: "Inter_600SemiBold",
  fontSize: 11,
  color: ZINC_400,
  letterSpacing: 0.4,
} as const;

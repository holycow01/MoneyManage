/**
 * Recurring transaction create/edit bottom sheet.
 *
 * The `recurring` table holds the rule (account, category, amount,
 * frequency, next_run, active). A separate worker is expected to scan
 * `next_run <= now()` and materialize transactions — this sheet only
 * manages the rule itself.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
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

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";

export type RecurringRow = {
  id: string;
  account_id: string;
  category_id: string | null;
  amount: string | number;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  next_run: string;
  note: string | null;
  active: boolean;
};

const FREQUENCIES = [
  { value: "daily",   label: "Daily"   },
  { value: "weekly",  label: "Weekly"  },
  { value: "monthly", label: "Monthly" },
  { value: "yearly",  label: "Yearly"  },
] as const;

type Account = { id: string; name: string; color: string; icon: string };
type Category = { id: string; name: string; color: string; icon: string; type: string };

export function RecurringSheet({
  open,
  recurring,
  currency,
  onClose,
}: {
  open: boolean;
  recurring: RecurringRow | null;
  currency: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!recurring;

  const [amountText, setAmountText] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<RecurringRow["frequency"]>("monthly");
  const [nextRunText, setNextRunText] = useState(format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");
  const [active, setActive] = useState(true);

  const accountsQ = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,name,color,icon,archived")
        .eq("archived", false);
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });
  const categoriesQ = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,color,icon,type");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (recurring) {
      setAmountText(String(Number(recurring.amount)));
      setAccountId(recurring.account_id);
      setCategoryId(recurring.category_id);
      setFrequency(recurring.frequency);
      setNextRunText(recurring.next_run.slice(0, 10));
      setNote(recurring.note ?? "");
      setActive(recurring.active);
    } else {
      setAmountText("");
      setAccountId(accountsQ.data?.[0]?.id ?? null);
      setCategoryId(null);
      setFrequency("monthly");
      setNextRunText(format(new Date(), "yyyy-MM-dd"));
      setNote("");
      setActive(true);
    }
  }, [open, recurring, accountsQ.data]);

  const amount = useMemo(() => {
    const n = Number(amountText.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }, [amountText]);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(nextRunText.trim());
  const valid = !!accountId && amount > 0 && validDate;

  const save = useMutation({
    mutationFn: async () => {
      if (!valid) throw new Error("Fill all required fields");
      const payload = {
        account_id: accountId!,
        category_id: categoryId,
        amount: amount.toFixed(2),
        frequency,
        next_run: nextRunText.trim(),
        note: note.trim() || null,
        active,
      };
      if (isEdit) {
        const { error } = await supabase
          .from("recurring")
          .update(payload)
          .eq("id", recurring!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("recurring").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["recurring"] });
      onClose();
    },
    onError: (e: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e?.message ?? "Please try again.");
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!recurring) return;
      const { error } = await supabase
        .from("recurring")
        .delete()
        .eq("id", recurring.id);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["recurring"] });
      onClose();
    },
  });

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-2xl bg-card border-t border-border"
            style={{ maxHeight: "92%" }}
          >
            <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#f4f4f5" }}>
                {isEdit ? "Edit recurring" : "Add recurring"}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={20} color={ZINC_400} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
              {/* Amount */}
              <Section label="AMOUNT">
                <View className="h-12 flex-row items-center rounded-xl border border-border bg-background px-3">
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 18, color: ZINC_400, marginRight: 6 }}>
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
              </Section>

              {/* Frequency */}
              <Section label="FREQUENCY">
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {FREQUENCIES.map((f) => {
                    const active = f.value === frequency;
                    return (
                      <TouchableOpacity
                        key={f.value}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setFrequency(f.value);
                        }}
                        className="h-9 px-3 items-center justify-center rounded-full"
                        style={{
                          borderWidth: 1,
                          borderColor: active ? EMERALD : "#3f3f46",
                          backgroundColor: active ? `${EMERALD}1a` : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                            fontSize: 12,
                            color: active ? EMERALD : "#f4f4f5",
                          }}
                        >
                          {f.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>

              {/* Next run date */}
              <Section label="NEXT RUN (YYYY-MM-DD)">
                <TextInput
                  value={nextRunText}
                  onChangeText={setNextRunText}
                  placeholder="2026-05-15"
                  placeholderTextColor="#52525b"
                  autoCapitalize="none"
                  className="h-11 rounded-xl border border-border bg-background px-3 text-foreground"
                  style={{ fontFamily: "Inter_500Medium" }}
                />
              </Section>

              {/* Account */}
              <Section label="ACCOUNT">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {(accountsQ.data ?? []).map((a) => {
                    const Icon = getLucideIcon(a.icon);
                    const isActive = a.id === accountId;
                    return (
                      <TouchableOpacity
                        key={a.id}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setAccountId(a.id);
                        }}
                        className="h-9 pl-2 pr-3 flex-row items-center rounded-full"
                        style={{
                          borderWidth: 1,
                          borderColor: isActive ? a.color : "#3f3f46",
                          backgroundColor: isActive ? `${a.color}1f` : "transparent",
                        }}
                      >
                        <View
                          className="h-5 w-5 rounded-full items-center justify-center mr-2"
                          style={{ backgroundColor: `${a.color}33` }}
                        >
                          <Icon size={12} color={a.color} />
                        </View>
                        <Text
                          style={{
                            fontFamily: isActive ? "Inter_700Bold" : "Inter_500Medium",
                            fontSize: 12,
                            color: isActive ? a.color : "#f4f4f5",
                          }}
                        >
                          {a.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </Section>

              {/* Category */}
              <Section label="CATEGORY (OPTIONAL)">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {(categoriesQ.data ?? []).map((c) => {
                    const Icon = getLucideIcon(c.icon);
                    const isActive = c.id === categoryId;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setCategoryId(isActive ? null : c.id);
                        }}
                        className="h-9 pl-2 pr-3 flex-row items-center rounded-full"
                        style={{
                          borderWidth: 1,
                          borderColor: isActive ? EMERALD : "#3f3f46",
                          backgroundColor: isActive ? `${EMERALD}1a` : "transparent",
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
                            fontFamily: isActive ? "Inter_700Bold" : "Inter_500Medium",
                            fontSize: 12,
                            color: isActive ? EMERALD : "#f4f4f5",
                          }}
                        >
                          {c.name}
                        </Text>
                        {isActive ? <Check size={12} color={EMERALD} style={{ marginLeft: 6 }} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </Section>

              {/* Note */}
              <Section label="NOTE (OPTIONAL)">
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Salary, rent, gym membership…"
                  placeholderTextColor="#52525b"
                  className="h-11 rounded-xl border border-border bg-background px-3 text-foreground"
                  style={{ fontFamily: "Inter_500Medium" }}
                />
              </Section>

              {/* Active */}
              <View className="px-5 pt-4 flex-row items-center justify-between">
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 14, color: "#f4f4f5" }}>
                  Active
                </Text>
                <Switch
                  value={active}
                  onValueChange={(v) => {
                    Haptics.selectionAsync();
                    setActive(v);
                  }}
                  trackColor={{ false: "#3f3f46", true: EMERALD }}
                  thumbColor="#f4f4f5"
                />
              </View>

              <View className="px-4 pt-5 pb-4">
                <TouchableOpacity
                  onPress={() => save.mutate()}
                  disabled={!valid || save.isPending}
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
                    {isEdit ? "Save changes" : "Create recurring"}
                  </Text>
                </TouchableOpacity>

                {isEdit ? (
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        "Delete recurring rule?",
                        "Already-created transactions won't be touched.",
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => remove.mutate() },
                        ],
                      );
                    }}
                    activeOpacity={0.7}
                    className="h-10 items-center justify-center mt-3 flex-row"
                  >
                    <Trash2 size={14} color={ROSE} />
                    <Text className="ml-2" style={{ fontFamily: "Inter_600SemiBold", color: ROSE, fontSize: 13 }}>
                      Delete
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="px-5 pt-4">
      <Text
        className="mb-2"
        style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: ZINC_400, letterSpacing: 0.4 }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

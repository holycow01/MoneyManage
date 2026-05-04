/**
 * Transaction edit bottom sheet.
 *
 * Opens with a transaction prefilled into a tiny entry-store-like local
 * state (we don't want to clobber the home screen's `useEntryStore`).
 * Reuses <Keypad> from components/Keypad so the edit experience matches
 * the quick-entry experience exactly.
 *
 * Saving is an optimistic Supabase update; the parent invalidates
 * ["transactions"] queries on settle so the row's display refreshes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Check, ChevronDown, Wallet, X } from "lucide-react-native";

import { Keypad, KeypadSaveButton } from "@/components/Keypad";
import { appendKey, evaluate, formatExpression } from "@/lib/calculator";
import { formatNumber, symbolFor } from "@/lib/currency";
import { getLucideIcon } from "@/lib/icons";
import { supabase } from "@/lib/supabase";
import { runBudgetCheck } from "@/lib/notifications";

export type EditableTransaction = {
  id: string;
  amount: string | number;
  type: "income" | "expense" | "transfer";
  note: string | null;
  account_id: string;
  category_id: string | null;
  date: string;
};

type Account = {
  id: string;
  name: string;
  color: string;
  icon: string;
};
type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: "income" | "expense";
};

export function TransactionEditSheet({
  open,
  tx,
  currency,
  onClose,
  onDeleted,
}: {
  open: boolean;
  tx: EditableTransaction | null;
  currency: string;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const qc = useQueryClient();

  // Prefill from `tx` whenever the sheet opens with a different row.
  const initial = useMemo(
    () => (tx ? Number(tx.amount).toFixed(2) : ""),
    [tx],
  );
  const [expression, setExpression] = useState(initial);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [accountModal, setAccountModal] = useState(false);

  useEffect(() => {
    if (!open || !tx) return;
    setExpression(Number(tx.amount).toFixed(2).replace(/\.?0+$/, ""));
    setCategoryId(tx.category_id ?? null);
    setAccountId(tx.account_id);
    setNote(tx.note ?? "");
  }, [open, tx]);

  const amount = evaluate(expression);

  const accountsQ = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,name,color,icon,archived")
        .eq("archived", false)
        .order("created_at", { ascending: true });
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
        .select("id,name,icon,color,type")
        .order("type", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const updateTx = useMutation({
    mutationFn: async () => {
      if (!tx) throw new Error("no row");
      if (!accountId) throw new Error("no account");
      const cat = categoriesQ.data?.find((c) => c.id === categoryId);
      const txType: "income" | "expense" =
        cat?.type === "income" ? "income" : "expense";
      const { error } = await supabase
        .from("transactions")
        .update({
          amount: amount.toFixed(2),
          type: txType,
          note: note.trim() || null,
          category_id: categoryId,
          account_id: accountId,
        })
        .eq("id", tx.id);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      void runBudgetCheck();
      onClose();
    },
    onError: (e: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e?.message ?? "Please try again.");
    },
  });

  const deleteTx = useMutation({
    mutationFn: async () => {
      if (!tx) return;
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", tx.id);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      onDeleted?.(tx?.id ?? "");
      onClose();
    },
  });

  const onKey = useCallback(
    (k: string) => setExpression((prev) => appendKey(prev, k)),
    [],
  );

  if (!tx) return null;

  const selectedCat = categoriesQ.data?.find((c) => c.id === categoryId);
  const selectedAcc = accountsQ.data?.find((a) => a.id === accountId);

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
            <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
              <Text
                style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#f4f4f5" }}
              >
                Edit transaction
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={20} color="#a1a1aa" />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {/* Amount readout */}
              <View className="px-5 pt-2 pb-3">
                {expression ? (
                  <Text
                    style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#a1a1aa" }}
                    numberOfLines={1}
                  >
                    {formatExpression(expression)}
                  </Text>
                ) : (
                  <View style={{ height: 16 }} />
                )}
                <View className="flex-row items-baseline mt-1">
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 22,
                      color: expression ? "#10b981" : "#a1a1aa",
                      marginRight: 6,
                    }}
                  >
                    {symbolFor(currency).trim()}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 44,
                      lineHeight: 50,
                      color: expression ? "#10b981" : "#f4f4f5",
                    }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatNumber(amount)}
                  </Text>
                </View>
              </View>

              {/* Category strip */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
              >
                {(categoriesQ.data ?? []).map((c) => {
                  const Icon = getLucideIcon(c.icon);
                  const selected = c.id === categoryId;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setCategoryId(selected ? null : c.id);
                      }}
                      activeOpacity={0.85}
                      className="items-center mr-3"
                      style={{ width: 64 }}
                    >
                      <View className="relative h-12 w-12 items-center justify-center">
                        {selected ? (
                          <View
                            pointerEvents="none"
                            style={{
                              position: "absolute",
                              inset: 0 as any,
                              left: 0,
                              right: 0,
                              top: 0,
                              bottom: 0,
                              borderRadius: 999,
                              borderWidth: 2,
                              borderColor: "#10b981",
                            }}
                          />
                        ) : null}
                        <View
                          className="h-10 w-10 rounded-full items-center justify-center"
                          style={{ backgroundColor: `${c.color}26` }}
                        >
                          <Icon size={20} color={c.color} />
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
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Account + note */}
              <View className="flex-row items-center px-5 mt-2 mb-3">
                <TouchableOpacity
                  onPress={() => setAccountModal(true)}
                  activeOpacity={0.85}
                  className="h-9 px-3 flex-row items-center rounded-full bg-background border border-border"
                >
                  <Wallet size={14} color="#a1a1aa" />
                  <Text
                    className="ml-2 text-foreground text-xs"
                    style={{ fontFamily: "Inter_600SemiBold" }}
                  >
                    {selectedAcc?.name ?? "Account"}
                  </Text>
                  <ChevronDown
                    size={14}
                    color="#a1a1aa"
                    style={{ marginLeft: 4 }}
                  />
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

              {/* Keypad */}
              <View className="px-3">
                <Keypad onKey={onKey} />
                <KeypadSaveButton
                  disabled={!amount || !accountId}
                  highlighted={amount > 0 && !!accountId}
                  busy={updateTx.isPending}
                  onPress={() => updateTx.mutate()}
                  label="Save changes"
                />
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      "Delete transaction?",
                      "This can't be undone.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => deleteTx.mutate(),
                        },
                      ],
                    );
                  }}
                  className="mt-3 mb-2 items-center"
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      color: "#f43f5e",
                      fontSize: 13,
                    }}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>

        {/* Account picker (nested modal) */}
        <Modal
          transparent
          visible={accountModal}
          animationType="fade"
          onRequestClose={() => setAccountModal(false)}
        >
          <Pressable
            className="flex-1 bg-black/60 justify-end"
            onPress={() => setAccountModal(false)}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              className="rounded-t-2xl bg-card border-t border-border p-4"
            >
              <Text
                className="px-2 pb-3 text-muted text-xs"
                style={{ fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 }}
              >
                SELECT ACCOUNT
              </Text>
              {(accountsQ.data ?? []).map((a) => {
                const Icon = getLucideIcon(a.icon);
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setAccountId(a.id);
                      setAccountModal(false);
                    }}
                    className="flex-row items-center px-2 py-3"
                  >
                    <View
                      className="h-8 w-8 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: `${a.color}33` }}
                    >
                      <Icon size={16} color={a.color} />
                    </View>
                    <Text
                      className="flex-1 text-foreground"
                      style={{ fontFamily: "Inter_500Medium" }}
                    >
                      {a.name}
                    </Text>
                    {a.id === accountId ? (
                      <Check size={18} color="#10b981" />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

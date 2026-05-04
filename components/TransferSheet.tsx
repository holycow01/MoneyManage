/**
 * Transfer bottom sheet — moves money between two accounts.
 *
 * Schema note: the existing transactions table has no `to_account_id`
 * column. We model a transfer as TWO rows linked by amount sign:
 *
 *   Row A — outgoing leg, amount = −X, account_id = source
 *   Row B — incoming leg, amount = +X, account_id = destination
 *
 * Both rows have `type = "transfer"` and a paired note (`→ {name}` /
 * `← {name}`) so they're visually obvious in the transactions list.
 *
 * If either insert fails the other is rolled back manually — true
 * atomicity would need a Postgres function or a `transfer_group_id`
 * column added in a follow-up migration.
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
import { ArrowDownUp, ArrowRight, X } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { getLucideIcon } from "@/lib/icons";
import { symbolFor } from "@/lib/currency";

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

type Account = {
  id: string;
  name: string;
  type: string;
  color: string;
  icon: string;
  archived: boolean;
};

export function TransferSheet({
  open,
  onClose,
  defaultFromId,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  defaultFromId?: string | null;
  currency: string;
}) {
  const qc = useQueryClient();

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
    enabled: open,
  });

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");

  // Hydrate when sheet opens.
  useEffect(() => {
    if (!open) return;
    const accounts = accountsQ.data ?? [];
    const from = defaultFromId ?? accounts[0]?.id ?? null;
    const to = accounts.find((a) => a.id !== from)?.id ?? null;
    setFromId(from);
    setToId(to);
    setAmountText("");
    setNote("");
  }, [open, defaultFromId, accountsQ.data]);

  const amount = useMemo(() => {
    const n = Number(amountText.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }, [amountText]);

  const fromAcc = accountsQ.data?.find((a) => a.id === fromId);
  const toAcc = accountsQ.data?.find((a) => a.id === toId);

  const valid =
    !!fromAcc && !!toAcc && fromAcc.id !== toAcc.id && amount > 0;

  const swap = () => {
    Haptics.selectionAsync();
    setFromId(toId);
    setToId(fromId);
  };

  const transfer = useMutation({
    mutationFn: async () => {
      if (!fromAcc || !toAcc) throw new Error("Pick both accounts");
      if (fromAcc.id === toAcc.id) throw new Error("Pick different accounts");
      if (amount <= 0) throw new Error("Enter an amount");

      const date = new Date().toISOString();
      const trimmedNote = note.trim();

      // Outgoing leg
      const { data: outRow, error: outErr } = await supabase
        .from("transactions")
        .insert({
          account_id: fromAcc.id,
          type: "transfer",
          amount: (-amount).toFixed(2),
          note:
            trimmedNote.length > 0
              ? `→ ${toAcc.name}: ${trimmedNote}`
              : `→ ${toAcc.name}`,
          date,
        })
        .select("id")
        .single();
      if (outErr) throw outErr;

      // Incoming leg
      const { error: inErr } = await supabase
        .from("transactions")
        .insert({
          account_id: toAcc.id,
          type: "transfer",
          amount: amount.toFixed(2),
          note:
            trimmedNote.length > 0
              ? `← ${fromAcc.name}: ${trimmedNote}`
              : `← ${fromAcc.name}`,
          date,
        });

      // Rollback the first leg if the second fails.
      if (inErr) {
        await supabase.from("transactions").delete().eq("id", outRow.id);
        throw inErr;
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      onClose();
    },
    onError: (e: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't transfer", e?.message ?? "Please try again.");
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
            <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 18,
                  color: "#f4f4f5",
                }}
              >
                Transfer
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={20} color={ZINC_400} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {/* From / To row with swap button between */}
              <View className="px-5 pt-2">
                <Text style={sectionLabel}>FROM</Text>
                <AccountPicker
                  accounts={accountsQ.data ?? []}
                  selectedId={fromId}
                  excludeId={toId}
                  onSelect={(id) => {
                    Haptics.selectionAsync();
                    setFromId(id);
                  }}
                />
              </View>

              <View className="items-center my-2">
                <TouchableOpacity
                  onPress={swap}
                  activeOpacity={0.85}
                  className="h-9 w-9 rounded-full items-center justify-center bg-card border border-border"
                >
                  <ArrowDownUp size={16} color={EMERALD} />
                </TouchableOpacity>
              </View>

              <View className="px-5">
                <Text style={sectionLabel}>TO</Text>
                <AccountPicker
                  accounts={accountsQ.data ?? []}
                  selectedId={toId}
                  excludeId={fromId}
                  onSelect={(id) => {
                    Haptics.selectionAsync();
                    setToId(id);
                  }}
                />
              </View>

              {/* Amount */}
              <View className="px-5 pt-4">
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
                    onChangeText={(t) =>
                      setAmountText(t.replace(/[^\d.]/g, ""))
                    }
                    placeholder="0"
                    placeholderTextColor="#52525b"
                    keyboardType="decimal-pad"
                    className="flex-1 text-foreground"
                    style={{ fontFamily: "Inter_600SemiBold", fontSize: 18 }}
                  />
                </View>
              </View>

              {/* Note */}
              <View className="px-5 pt-4">
                <Text style={sectionLabel}>NOTE (OPTIONAL)</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Salary day, rent split…"
                  placeholderTextColor="#52525b"
                  className="h-11 mt-2 rounded-xl border border-border bg-background px-3 text-foreground"
                  style={{ fontFamily: "Inter_500Medium" }}
                />
              </View>

              {/* Preview */}
              {fromAcc && toAcc && fromAcc.id !== toAcc.id ? (
                <View className="px-5 pt-4">
                  <View className="rounded-xl bg-background border border-border p-3 flex-row items-center">
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 12,
                        color: "#f4f4f5",
                        flex: 1,
                      }}
                    >
                      {fromAcc.name}
                    </Text>
                    <ArrowRight
                      size={14}
                      color={EMERALD}
                      style={{ marginHorizontal: 8 }}
                    />
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 12,
                        color: "#f4f4f5",
                        flex: 1,
                        textAlign: "right",
                      }}
                    >
                      {toAcc.name}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Submit */}
              <View className="px-4 pt-5 pb-4">
                <TouchableOpacity
                  onPress={() => transfer.mutate()}
                  disabled={!valid || transfer.isPending}
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
                    Transfer
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AccountPicker({
  accounts,
  selectedId,
  excludeId,
  onSelect,
}: {
  accounts: Account[];
  selectedId: string | null;
  excludeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mt-2"
      contentContainerStyle={{ gap: 8 }}
    >
      {accounts.map((a) => {
        const Icon = getLucideIcon(a.icon);
        const active = a.id === selectedId;
        const disabled = a.id === excludeId;
        return (
          <TouchableOpacity
            key={a.id}
            onPress={() => !disabled && onSelect(a.id)}
            activeOpacity={disabled ? 1 : 0.85}
            className="h-10 pl-2 pr-3 flex-row items-center rounded-full"
            style={{
              borderWidth: 1,
              borderColor: active ? a.color : disabled ? "#27272a" : "#3f3f46",
              backgroundColor: active ? `${a.color}1f` : "transparent",
              opacity: disabled ? 0.4 : 1,
            }}
          >
            <View
              className="h-6 w-6 rounded-full items-center justify-center mr-2"
              style={{ backgroundColor: `${a.color}33` }}
            >
              <Icon size={12} color={a.color} />
            </View>
            <Text
              style={{
                fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                fontSize: 12,
                color: active ? a.color : "#f4f4f5",
              }}
            >
              {a.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const sectionLabel = {
  fontFamily: "Inter_600SemiBold",
  fontSize: 11,
  color: ZINC_500,
  letterSpacing: 0.4,
} as const;

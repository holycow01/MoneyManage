/**
 * Account create / edit bottom sheet.
 *
 *   <AccountSheet open={...} account={null}     onClose={...} />  // create
 *   <AccountSheet open={...} account={existing} onClose={...} />  // edit
 *
 * Notes:
 *   - The `balance` column is treated as the account's *starting balance*
 *     — set when the account is created and rarely touched afterwards.
 *     The accounts screen computes the effective balance dynamically by
 *     summing transactions on top of it.
 *   - Edit mode also exposes Archive (soft-hide) and Delete (cascade).
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Archive, Check, Trash2, X } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { getLucideIcon } from "@/lib/icons";
import { symbolFor } from "@/lib/currency";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";

export type AccountRow = {
  id: string;
  name: string;
  type: "cash" | "bank" | "credit" | "wallet" | "savings";
  balance: string | number;
  color: string;
  icon: string;
  archived: boolean;
};

export const ACCOUNT_TYPES: {
  value: AccountRow["type"];
  label: string;
  defaultIcon: string;
}[] = [
  { value: "cash",    label: "Cash",    defaultIcon: "banknote"    },
  { value: "bank",    label: "Bank",    defaultIcon: "landmark"    },
  { value: "credit",  label: "Credit",  defaultIcon: "credit-card" },
  { value: "wallet",  label: "Wallet",  defaultIcon: "wallet"      },
  { value: "savings", label: "Savings", defaultIcon: "piggy-bank"  },
];

const COLORS = [
  "#10b981", // emerald
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#d946ef", // fuchsia
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#f97316", // orange
  "#64748b", // slate
];

const ICONS = [
  "wallet",
  "banknote",
  "credit-card",
  "piggy-bank",
  "landmark",
  "coins",
  "hand-coins",
  "briefcase",
];

export function AccountSheet({
  open,
  account,
  currency,
  onClose,
}: {
  open: boolean;
  account: AccountRow | null;
  currency: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!account;

  const [name, setName] = useState("");
  const [type, setType] = useState<AccountRow["type"]>("bank");
  const [startingBalanceText, setStartingBalanceText] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState(ICONS[0]);

  // Hydrate when sheet opens
  useEffect(() => {
    if (!open) return;
    if (account) {
      setName(account.name);
      setType(account.type);
      setStartingBalanceText(String(Number(account.balance)));
      setColor(account.color);
      setIcon(account.icon);
    } else {
      setName("");
      setType("bank");
      setStartingBalanceText("");
      setColor(COLORS[0]);
      setIcon(ACCOUNT_TYPES[1].defaultIcon);
    }
  }, [open, account]);

  // When the user swaps type in create mode, suggest a matching icon.
  useEffect(() => {
    if (!open || isEdit) return;
    const t = ACCOUNT_TYPES.find((x) => x.value === type);
    if (t) setIcon(t.defaultIcon);
  }, [type, open, isEdit]);

  const balance = useMemo(() => {
    const n = Number(startingBalanceText.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }, [startingBalanceText]);

  const valid = name.trim().length > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!valid) throw new Error("Name is required");
      const payload = {
        name: name.trim(),
        type,
        balance: balance.toFixed(2),
        color,
        icon,
      };
      if (isEdit) {
        const { error } = await supabase
          .from("accounts")
          .update(payload)
          .eq("id", account!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("accounts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      onClose();
    },
    onError: (e: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e?.message ?? "Please try again.");
    },
  });

  const archive = useMutation({
    mutationFn: async () => {
      if (!account) return;
      const { error } = await supabase
        .from("accounts")
        .update({ archived: !account.archived })
        .eq("id", account.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!account) return;
      const { error } = await supabase
        .from("accounts")
        .delete()
        .eq("id", account.id);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      onClose();
    },
  });

  const PreviewIcon = getLucideIcon(icon);

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
                {isEdit ? "Edit account" : "Add account"}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={20} color={ZINC_400} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {/* Live preview */}
              <View className="px-5 pt-1 pb-4">
                <View
                  className="rounded-2xl p-4 flex-row items-center"
                  style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}
                >
                  <View
                    className="h-12 w-12 rounded-2xl items-center justify-center mr-3"
                    style={{ backgroundColor: `${color}33` }}
                  >
                    <PreviewIcon size={22} color={color} />
                  </View>
                  <View className="flex-1">
                    <Text
                      style={{
                        fontFamily: "Inter_700Bold",
                        fontSize: 16,
                        color: "#f4f4f5",
                      }}
                      numberOfLines={1}
                    >
                      {name || "Untitled account"}
                    </Text>
                    <Text
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 12,
                        color: ZINC_400,
                        textTransform: "capitalize",
                      }}
                    >
                      {type}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Name */}
              <Section label="NAME">
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="HBL Bank, Cash, Apple Card…"
                  placeholderTextColor="#52525b"
                  className="h-11 rounded-xl border border-border bg-background px-3 text-foreground"
                  style={{ fontFamily: "Inter_500Medium" }}
                />
              </Section>

              {/* Type segmented */}
              <Section label="TYPE">
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {ACCOUNT_TYPES.map((t) => {
                    const active = t.value === type;
                    return (
                      <TouchableOpacity
                        key={t.value}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setType(t.value);
                        }}
                        activeOpacity={0.85}
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
                          {t.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>

              {/* Starting balance */}
              <Section
                label={
                  isEdit
                    ? "STARTING BALANCE (RARELY TOUCHED)"
                    : "STARTING BALANCE"
                }
              >
                <View className="h-11 flex-row items-center rounded-xl border border-border bg-background px-3">
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 16,
                      color: ZINC_400,
                      marginRight: 6,
                    }}
                  >
                    {symbolFor(currency).trim()}
                  </Text>
                  <TextInput
                    value={startingBalanceText}
                    onChangeText={(t) => setStartingBalanceText(t.replace(/[^\d.\-]/g, ""))}
                    placeholder="0"
                    placeholderTextColor="#52525b"
                    keyboardType="decimal-pad"
                    className="flex-1 text-foreground"
                    style={{ fontFamily: "Inter_600SemiBold", fontSize: 16 }}
                  />
                </View>
                <Text
                  className="mt-1"
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: "#71717a",
                  }}
                >
                  Pulse adds and subtracts transactions on top of this — you
                  rarely need to edit it.
                </Text>
              </Section>

              {/* Color */}
              <Section label="COLOR">
                <View className="flex-row" style={{ gap: 10 }}>
                  {COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setColor(c);
                      }}
                      className="h-9 w-9 rounded-full items-center justify-center"
                      style={{
                        backgroundColor: c,
                        borderWidth: color === c ? 2 : 0,
                        borderColor: "#f4f4f5",
                      }}
                    >
                      {color === c ? <Check size={14} color="#09090b" /> : null}
                    </Pressable>
                  ))}
                </View>
              </Section>

              {/* Icon */}
              <Section label="ICON">
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {ICONS.map((name) => {
                    const Icon = getLucideIcon(name);
                    const active = icon === name;
                    return (
                      <Pressable
                        key={name}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setIcon(name);
                        }}
                        className="h-10 w-10 rounded-xl items-center justify-center"
                        style={{
                          backgroundColor: active ? `${color}33` : "#27272a",
                          borderWidth: 1,
                          borderColor: active ? color : "transparent",
                        }}
                      >
                        <Icon size={18} color={active ? color : ZINC_400} />
                      </Pressable>
                    );
                  })}
                </View>
              </Section>

              {/* Actions */}
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
                    {isEdit ? "Save changes" : "Create account"}
                  </Text>
                </TouchableOpacity>

                {isEdit ? (
                  <View className="flex-row mt-3" style={{ gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => archive.mutate()}
                      activeOpacity={0.85}
                      className="flex-1 h-10 items-center justify-center rounded-xl flex-row"
                      style={{ borderWidth: 1, borderColor: "#3f3f46" }}
                    >
                      <Archive size={14} color={ZINC_400} />
                      <Text
                        className="ml-2"
                        style={{
                          fontFamily: "Inter_600SemiBold",
                          color: "#f4f4f5",
                          fontSize: 13,
                        }}
                      >
                        {account?.archived ? "Unarchive" : "Archive"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert(
                          `Delete ${account?.name}?`,
                          "All transactions on this account will be deleted too. This can't be undone.",
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
                      activeOpacity={0.85}
                      className="flex-1 h-10 items-center justify-center rounded-xl flex-row"
                      style={{ borderWidth: 1, borderColor: ROSE }}
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
                        Delete
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="px-5 pt-4">
      <Text
        className="mb-2"
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
          color: ZINC_400,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

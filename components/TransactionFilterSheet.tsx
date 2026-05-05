/**
 * Filter bottom sheet for the Transactions screen.
 *
 * Edits a *draft* copy of the global filter and only commits it on Apply
 * — so closing without applying acts as a Cancel. Reset clears
 * everything (including search, which lives in the same store).
 *
 * Sections:
 *   - Date range (preset segmented row)
 *   - Type toggle (income / expense / transfer)
 *   - Amount min/max
 *   - Accounts multi-select
 *   - Categories multi-select (icons + colors)
 */
import { useEffect, useState } from "react";
import {
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
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { getLucideIcon } from "@/lib/icons";
import { symbolFor } from "@/lib/currency";
import {
  DATE_PRESETS,
  type DatePreset,
  type TransactionFilter,
  type TxType,
  useTransactionFilterStore,
} from "@/stores/transactionFilterStore";

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";

const TYPES: { value: TxType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
];

type Account = { id: string; name: string; color: string; icon: string };
type Category = { id: string; name: string; color: string; icon: string };

export function TransactionFilterSheet({
  open,
  onClose,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  currency: string;
}) {
  const filter = useTransactionFilterStore((s) => s.filter);
  const setFilter = useTransactionFilterStore((s) => s.setFilter);
  const reset = useTransactionFilterStore((s) => s.reset);

  const [draft, setDraft] = useState<TransactionFilter>(filter);
  useEffect(() => {
    if (open) setDraft(filter);
  }, [open, filter]);

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
        .select("id,name,color,icon");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const apply = () => {
    setFilter(draft);
    onClose();
  };
  const onReset = () => {
    reset();
    setDraft({
      search: "",
      datePreset: "all",
      accountIds: [],
      categoryIds: [],
      types: [],
      amountMin: null,
      amountMax: null,
    });
  };

  const toggle = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

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
                Filters
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={20} color={ZINC_400} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              <Section label="DATE RANGE">
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {DATE_PRESETS.map((p) => (
                    <Chip
                      key={p.value}
                      active={draft.datePreset === p.value}
                      label={p.label}
                      onPress={() =>
                        setDraft((d) => ({ ...d, datePreset: p.value as DatePreset }))
                      }
                    />
                  ))}
                </View>
              </Section>

              <Section label="TYPE">
                <View className="flex-row" style={{ gap: 8 }}>
                  {TYPES.map((t) => (
                    <Chip
                      key={t.value}
                      active={draft.types.includes(t.value)}
                      label={t.label}
                      onPress={() =>
                        setDraft((d) => ({ ...d, types: toggle(d.types, t.value) }))
                      }
                    />
                  ))}
                </View>
              </Section>

              <Section label={`AMOUNT (${symbolFor(currency).trim()})`}>
                <View className="flex-row" style={{ gap: 12 }}>
                  <AmountInput
                    placeholder="Min"
                    value={draft.amountMin}
                    onChange={(v) => setDraft((d) => ({ ...d, amountMin: v }))}
                  />
                  <AmountInput
                    placeholder="Max"
                    value={draft.amountMax}
                    onChange={(v) => setDraft((d) => ({ ...d, amountMax: v }))}
                  />
                </View>
              </Section>

              <Section label="ACCOUNTS">
                {(accountsQ.data ?? []).length === 0 ? (
                  <EmptyHint>No accounts yet.</EmptyHint>
                ) : (
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {(accountsQ.data ?? []).map((a) => (
                      <IconChip
                        key={a.id}
                        active={draft.accountIds.includes(a.id)}
                        label={a.name}
                        color={a.color}
                        icon={a.icon}
                        onPress={() =>
                          setDraft((d) => ({
                            ...d,
                            accountIds: toggle(d.accountIds, a.id),
                          }))
                        }
                      />
                    ))}
                  </View>
                )}
              </Section>

              <Section label="CATEGORIES">
                {(categoriesQ.data ?? []).length === 0 ? (
                  <EmptyHint>No categories yet.</EmptyHint>
                ) : (
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {(categoriesQ.data ?? []).map((c) => (
                      <IconChip
                        key={c.id}
                        active={draft.categoryIds.includes(c.id)}
                        label={c.name}
                        color={c.color}
                        icon={c.icon}
                        onPress={() =>
                          setDraft((d) => ({
                            ...d,
                            categoryIds: toggle(d.categoryIds, c.id),
                          }))
                        }
                      />
                    ))}
                  </View>
                )}
              </Section>
            </ScrollView>

            {/* Footer actions */}
            <View
              className="flex-row px-4 pt-3 pb-5 border-t border-border"
              style={{ gap: 12 }}
            >
              <TouchableOpacity
                onPress={onReset}
                className="flex-1 h-12 items-center justify-center rounded-2xl border border-border"
                activeOpacity={0.85}
              >
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    color: "#f4f4f5",
                  }}
                >
                  Reset
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={apply}
                className="flex-[2] h-12 items-center justify-center rounded-2xl"
                style={{ backgroundColor: EMERALD }}
                activeOpacity={0.85}
              >
                <Text
                  style={{ fontFamily: "Inter_700Bold", color: "#09090b" }}
                >
                  Apply
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pieces
// ──────────────────────────────────────────────────────────────────────────
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

function Chip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      className="h-9 px-3 flex-row items-center rounded-full"
      style={{
        borderWidth: 1,
        borderColor: active ? EMERALD : "#3f3f46",
        backgroundColor: active ? `${EMERALD}1a` : "transparent",
      }}
    >
      {active ? <Check size={14} color={EMERALD} /> : null}
      <Text
        style={{
          fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
          fontSize: 12,
          color: active ? EMERALD : "#f4f4f5",
          marginLeft: active ? 6 : 0,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function IconChip({
  active,
  label,
  color,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  color: string;
  icon: string;
  onPress: () => void;
}) {
  const Icon = getLucideIcon(icon);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      className="h-9 pl-2 pr-3 flex-row items-center rounded-full"
      style={{
        borderWidth: 1,
        borderColor: active ? EMERALD : "#3f3f46",
        backgroundColor: active ? `${EMERALD}1a` : "transparent",
      }}
    >
      <View
        className="h-5 w-5 rounded-full items-center justify-center mr-2"
        style={{ backgroundColor: `${color}33` }}
      >
        <Icon size={12} color={color} />
      </View>
      <Text
        style={{
          fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
          fontSize: 12,
          color: active ? EMERALD : "#f4f4f5",
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function AmountInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const text = value == null ? "" : String(value);
  return (
    <View className="flex-1 h-11 flex-row items-center px-3 rounded-xl border border-border bg-background">
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="#52525b"
        keyboardType="decimal-pad"
        clearButtonMode="while-editing"
        value={text}
        onChangeText={(t) => {
          const cleaned = t.replace(/[^\d.]/g, "");
          onChange(cleaned === "" ? null : Number(cleaned));
        }}
        className="flex-1 text-foreground"
        style={{ fontFamily: "Inter_500Medium" }}
      />
      {text.length > 0 ? (
        <TouchableOpacity
          onPress={() => onChange(null)}
          hitSlop={10}
          accessibilityLabel="Clear amount"
          className="ml-2 h-6 w-6 items-center justify-center rounded-full"
          style={{ backgroundColor: "#27272a" }}
        >
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: ZINC_400, lineHeight: 14 }}>×</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: "Inter_400Regular",
        fontSize: 12,
        color: ZINC_400,
      }}
    >
      {children}
    </Text>
  );
}

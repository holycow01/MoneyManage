/**
 * Category create/edit bottom sheet.
 *
 *   <CategorySheet open={...} category={null}     onClose={...} />  // create
 *   <CategorySheet open={...} category={existing} onClose={...} />  // edit
 */
import { useEffect, useState } from "react";
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
import { Check, Trash2, X } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { getLucideIcon } from "@/lib/icons";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";

export type CategoryRow = {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: "income" | "expense";
};

const COLORS = [
  "#10b981", "#0ea5e9", "#8b5cf6", "#d946ef",
  "#f43f5e", "#f59e0b", "#f97316", "#64748b",
];

const ICON_NAMES = [
  "utensils", "coffee", "car", "bus", "shopping-bag", "shopping-cart",
  "receipt", "zap", "wifi", "phone", "film", "music", "gift",
  "heart-pulse", "stethoscope", "graduation-cap", "book-open",
  "briefcase", "wallet", "banknote", "piggy-bank", "trending-up",
  "home", "wrench", "shirt", "plane", "dumbbell", "cat", "more-horizontal",
];

export function CategorySheet({
  open,
  category,
  onClose,
}: {
  open: boolean;
  category: CategoryRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!category;

  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState(ICON_NAMES[0]);

  useEffect(() => {
    if (!open) return;
    if (category) {
      setName(category.name);
      setType(category.type);
      setColor(category.color);
      setIcon(category.icon);
    } else {
      setName("");
      setType("expense");
      setColor(COLORS[0]);
      setIcon(ICON_NAMES[0]);
    }
  }, [open, category]);

  const valid = name.trim().length > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!valid) throw new Error("Name is required");
      const payload = { name: name.trim(), type, color, icon };
      if (isEdit) {
        const { error } = await supabase
          .from("categories")
          .update(payload)
          .eq("id", category!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("categories").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
    onError: (e: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e?.message ?? "Please try again.");
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!category) return;
      const { error } = await supabase
        .from("categories")
        .delete()
        .eq("id", category.id);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
  });

  const Preview = getLucideIcon(icon);

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-2xl bg-card border-t border-border"
            style={{ maxHeight: "92%" }}
          >
            <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#f4f4f5" }}>
                {isEdit ? "Edit category" : "Add category"}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={20} color={ZINC_400} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
              {/* Preview */}
              <View className="px-5 pt-1 pb-4 items-center">
                <View
                  className="h-16 w-16 rounded-2xl items-center justify-center"
                  style={{ backgroundColor: `${color}33` }}
                >
                  <Preview size={28} color={color} />
                </View>
                <Text
                  className="mt-2"
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 16,
                    color: "#f4f4f5",
                  }}
                >
                  {name || "New category"}
                </Text>
              </View>

              {/* Name */}
              <Section label="NAME">
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Coffee, Rent, Side income…"
                  placeholderTextColor="#52525b"
                  className="h-11 rounded-xl border border-border bg-background px-3 text-foreground"
                  style={{ fontFamily: "Inter_500Medium" }}
                />
              </Section>

              {/* Type */}
              <Section label="TYPE">
                <View className="flex-row" style={{ gap: 8 }}>
                  {(["expense", "income"] as const).map((t) => {
                    const active = type === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setType(t);
                        }}
                        activeOpacity={0.85}
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
                          {t}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
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
                  {ICON_NAMES.map((n) => {
                    const Icon = getLucideIcon(n);
                    const active = icon === n;
                    return (
                      <Pressable
                        key={n}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setIcon(n);
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
                    {isEdit ? "Save changes" : "Create category"}
                  </Text>
                </TouchableOpacity>

                {isEdit ? (
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        `Delete ${category?.name}?`,
                        "Transactions in this category will become uncategorized but won't be deleted.",
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
                      Delete category
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

/**
 * Settings — iOS-style grouped list. Nine sections, see prompt for the spec.
 *
 * Where each preference lives:
 *   - currency, theme, name           → `users` table (Supabase)
 *   - everything else                 → AsyncStorage via `usePreferencesStore`
 *   - PIN                             → SecureStore via `lib/pin`
 *   - last unlocked timestamp         → SecureStore via `lib/biometric`
 *
 * Theme switching stores the preference but doesn't actually re-skin the
 * app — the entire design system is dark-first today. Wire to NativeWind's
 * `colorScheme` once a light palette exists.
 */
import { useCallback, useState } from "react";
import {
  Alert,
  Linking,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import Constants from "expo-constants";
import {
  AlarmClock,
  Bell,
  Calendar,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  DollarSign,
  Download,
  FileText,
  Fingerprint,
  Info,
  KeyRound,
  Lock,
  MessageCircle,
  Moon,
  RefreshCw,
  Sparkles,
  Tag,
  Upload,
  X,
} from "lucide-react-native";
import { format, formatDistanceToNow } from "date-fns";

import { LOCAL_USER_ID, supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import {
  shareCSV,
  timestampedFilename,
  toCSV,
  type CsvRow,
} from "@/lib/csv";
import { setPin, hasPin, clearPin } from "@/lib/pin";
import {
  type AutoLockMinutes,
  type WeekStart,
  usePreferencesStore,
} from "@/stores/preferencesStore";
import { useLockStore } from "@/stores/lockStore";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

const CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "INR", "SAR"] as const;
const THEMES = ["system", "dark", "light"] as const;
const AUTO_LOCK_OPTIONS: { value: AutoLockMinutes; label: string }[] = [
  { value: 0,  label: "Immediately" },
  { value: 1,  label: "1 minute"    },
  { value: 5,  label: "5 minutes"   },
  { value: 30, label: "30 minutes"  },
];
const REMINDER_TIMES = [
  { value: 8,  label: "8 AM" },
  { value: 12, label: "12 PM" },
  { value: 18, label: "6 PM" },
  { value: 21, label: "9 PM" },
  { value: 22, label: "10 PM" },
];
const MONTH_START_DAYS = [
  { value: 1,  label: "1st"  },
  { value: 15, label: "15th" },
  { value: 25, label: "25th" },
];

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const prefs = usePreferencesStore();

  // Picker modal state
  const [picker, setPicker] = useState<
    | null
    | { key: "currency" }
    | { key: "theme" }
    | { key: "weekStart" }
    | { key: "monthStart" }
    | { key: "autoLock" }
    | { key: "reminderTime" }
  >(null);
  const [pinSheet, setPinSheet] = useState(false);
  const [editName, setEditName] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Server-side prefs (users table) ────────────────────────────────
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("currency,theme,name")
        .single();
      if (error) throw error;
      return data as { currency: string; theme: string; name: string | null };
    },
  });
  const currency = meQ.data?.currency ?? "PKR";
  const theme = meQ.data?.theme ?? "dark";

  const updateUser = useMutation({
    mutationFn: async (patch: Partial<{ currency: string; theme: string; name: string }>) => {
      const { error } = await supabase
        .from("users")
        .update(patch)
        .eq("id", LOCAL_USER_ID);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      Haptics.selectionAsync();
    },
  });

  // ── Sync indicator (last cache update) ─────────────────────────────
  const lastSync = qc.getQueryState(["transactions", "recent"])?.dataUpdatedAt;
  const syncedLabel = lastSync
    ? `${formatDistanceToNow(new Date(lastSync), { addSuffix: true })}`
    : "—";

  // ── Exports ─────────────────────────────────────────────────────────
  const exportAllCSV = useCallback(async () => {
    setExporting(true);
    try {
      const { data: txs, error } = await supabase
        .from("transactions")
        .select("id,amount,type,note,date,account_id,category_id");
      if (error) throw error;

      const [{ data: accs }, { data: cats }] = await Promise.all([
        supabase.from("accounts").select("id,name"),
        supabase.from("categories").select("id,name"),
      ]);
      const accName = (id: string) =>
        accs?.find((a) => a.id === id)?.name ?? "";
      const catName = (id: string | null) =>
        id ? cats?.find((c) => c.id === id)?.name ?? "" : "";

      const rows: CsvRow[] = (txs ?? []).map((t) => ({
        date: t.date,
        amount: Number(t.amount).toFixed(2),
        type: t.type,
        category: catName(t.category_id),
        account: accName(t.account_id),
        note: t.note ?? "",
      }));

      const ok = await shareCSV(timestampedFilename("pulse-export"), toCSV(rows));
      if (!ok) Alert.alert("Sharing unavailable", "CSV saved to cache.");
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Please try again.");
    } finally {
      setExporting(false);
    }
  }, []);

  const exportPDF = useCallback(async () => {
    setExporting(true);
    try {
      const html = await buildPdfHtml(currency);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Export Pulse PDF",
        });
      } else {
        Alert.alert("Sharing unavailable", "PDF saved to cache.");
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Please try again.");
    } finally {
      setExporting(false);
    }
  }, [currency]);

  // ── Lock the app ─────────────────────────────────────────────────────
  const onSignOut = () => {
    Alert.alert(
      "Lock the app?",
      "You'll be asked for your biometric / PIN to get back in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Lock",
          style: "destructive",
          onPress: () => {
            useLockStore.getState().setLocked(true);
            router.replace("/(auth)/lock");
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
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
          Settings
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* PROFILE */}
        <SectionHeader>PROFILE</SectionHeader>
        <Card>
          <Row
            label={meQ.data?.name ?? "You"}
            value="Edit your display name"
            twoLine
            icon={
              <View
                className="h-9 w-9 rounded-full items-center justify-center"
                style={{ backgroundColor: `${EMERALD}26` }}
              >
                <Text
                  style={{ fontFamily: "Inter_700Bold", color: EMERALD, fontSize: 14 }}
                >
                  {(meQ.data?.name?.[0] ?? "P").toUpperCase()}
                </Text>
              </View>
            }
            chevron
            onPress={() => setEditName(true)}
          />
        </Card>

        {/* PREFERENCES */}
        <SectionHeader>PREFERENCES</SectionHeader>
        <Card>
          <Row
            icon={<DollarSign size={16} color={ZINC_400} />}
            label="Currency"
            value={currency}
            chevron
            onPress={() => setPicker({ key: "currency" })}
          />
          <Row
            icon={<Moon size={16} color={ZINC_400} />}
            label="Theme"
            value={cap(theme)}
            chevron
            onPress={() => setPicker({ key: "theme" })}
          />
          <Row
            icon={<Calendar size={16} color={ZINC_400} />}
            label="Start of week"
            value={prefs.weekStartsOn === 1 ? "Monday" : "Sunday"}
            chevron
            onPress={() => setPicker({ key: "weekStart" })}
          />
          <Row
            icon={<CalendarDays size={16} color={ZINC_400} />}
            label="Month starts on"
            value={`Day ${prefs.monthStartsOnDay}`}
            chevron
            onPress={() => setPicker({ key: "monthStart" })}
            last
          />
        </Card>

        {/* SECURITY */}
        <SectionHeader>SECURITY</SectionHeader>
        <Card>
          <Row
            icon={<Fingerprint size={16} color={ZINC_400} />}
            label="Biometric lock"
            control={
              <Switch
                value={prefs.biometricEnabled}
                onValueChange={(v) => {
                  Haptics.selectionAsync();
                  prefs.set("biometricEnabled", v);
                }}
                trackColor={{ false: "#3f3f46", true: EMERALD }}
                thumbColor="#f4f4f5"
              />
            }
          />
          <Row
            icon={<RefreshCw size={16} color={ZINC_400} />}
            label="Auto-lock after"
            value={
              AUTO_LOCK_OPTIONS.find((o) => o.value === prefs.autoLockMinutes)
                ?.label ?? "1 minute"
            }
            chevron
            onPress={() => setPicker({ key: "autoLock" })}
          />
          <Row
            icon={<KeyRound size={16} color={ZINC_400} />}
            label="Change PIN"
            chevron
            onPress={() => setPinSheet(true)}
            last
          />
        </Card>

        {/* NOTIFICATIONS */}
        <SectionHeader>NOTIFICATIONS</SectionHeader>
        <Card>
          <Row
            icon={<Bell size={16} color={ZINC_400} />}
            label="Budget alerts"
            control={
              <Switch
                value={prefs.budgetAlertsEnabled}
                onValueChange={(v) => {
                  Haptics.selectionAsync();
                  prefs.set("budgetAlertsEnabled", v);
                }}
                trackColor={{ false: "#3f3f46", true: EMERALD }}
                thumbColor="#f4f4f5"
              />
            }
          />
          <Row
            icon={<Sparkles size={16} color={ZINC_400} />}
            label="Weekly insights"
            control={
              <Switch
                value={prefs.weeklyInsightsEnabled}
                onValueChange={(v) => {
                  Haptics.selectionAsync();
                  prefs.set("weeklyInsightsEnabled", v);
                }}
                trackColor={{ false: "#3f3f46", true: EMERALD }}
                thumbColor="#f4f4f5"
              />
            }
          />
          <Row
            icon={<AlarmClock size={16} color={ZINC_400} />}
            label="Daily reminder"
            control={
              <Switch
                value={prefs.dailyReminderEnabled}
                onValueChange={(v) => {
                  Haptics.selectionAsync();
                  prefs.set("dailyReminderEnabled", v);
                }}
                trackColor={{ false: "#3f3f46", true: EMERALD }}
                thumbColor="#f4f4f5"
              />
            }
            last={!prefs.dailyReminderEnabled}
          />
          {prefs.dailyReminderEnabled ? (
            <Row
              label="Reminder time"
              value={
                REMINDER_TIMES.find((t) => t.value === prefs.dailyReminderHour)
                  ?.label ?? `${prefs.dailyReminderHour}:00`
              }
              chevron
              onPress={() => setPicker({ key: "reminderTime" })}
              last
            />
          ) : null}
        </Card>

        {/* DATA */}
        <SectionHeader>DATA</SectionHeader>
        <Card>
          <Row
            icon={<Download size={16} color={ZINC_400} />}
            label="Export all data as CSV"
            chevron
            onPress={exportAllCSV}
            disabled={exporting}
          />
          <Row
            icon={<FileText size={16} color={ZINC_400} />}
            label="Export PDF report"
            chevron
            onPress={exportPDF}
            disabled={exporting}
          />
          <Row
            icon={<Upload size={16} color={ZINC_400} />}
            label="Import CSV"
            value="Coming soon"
            chevron
            onPress={() =>
              Alert.alert("Import CSV", "Coming in a future update.")
            }
          />
          <Row
            icon={<Cloud size={16} color={ZINC_400} />}
            label="Sync status"
            value={`Last synced ${syncedLabel}`}
            last
          />
        </Card>

        {/* ORGANIZATION */}
        <SectionHeader>ORGANIZATION</SectionHeader>
        <Card>
          <Row
            icon={<Tag size={16} color={ZINC_400} />}
            label="Manage categories"
            chevron
            onPress={() => router.push("/settings/categories")}
          />
          <Row
            icon={<RefreshCw size={16} color={ZINC_400} />}
            label="Recurring transactions"
            chevron
            onPress={() => router.push("/settings/recurring")}
            last
          />
        </Card>

        {/* ABOUT */}
        <SectionHeader>ABOUT</SectionHeader>
        <Card>
          <Row
            icon={<Info size={16} color={ZINC_400} />}
            label="Version"
            value={`${Constants.expoConfig?.version ?? "0.0.0"}${Platform.OS === "ios" ? "" : ""}`}
          />
          <Row
            label="Privacy Policy"
            chevron
            onPress={() => Linking.openURL("https://example.com/privacy")}
          />
          <Row
            label="Terms of Service"
            chevron
            onPress={() => Linking.openURL("https://example.com/terms")}
          />
          <Row
            icon={<MessageCircle size={16} color={ZINC_400} />}
            label="Send feedback"
            chevron
            onPress={() =>
              Linking.openURL("mailto:feedback@pulse.app?subject=Pulse%20feedback")
            }
            last
          />
        </Card>

        {/* SIGN OUT */}
        <View className="px-4 mt-8 mb-2">
          <TouchableOpacity
            onPress={onSignOut}
            activeOpacity={0.85}
            className="h-12 items-center justify-center rounded-2xl flex-row"
            style={{ borderWidth: 1, borderColor: ROSE }}
          >
            <Lock size={16} color={ROSE} />
            <Text
              className="ml-2"
              style={{ fontFamily: "Inter_700Bold", color: ROSE, fontSize: 14 }}
            >
              Lock now
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Pickers */}
      <PickerSheet
        open={!!picker}
        onClose={() => setPicker(null)}
        title={pickerTitle(picker)}
        options={pickerOptions(picker, prefs)}
        selected={pickerSelectedValue(picker, currency, theme, prefs)}
        onSelect={(v) => {
          Haptics.selectionAsync();
          if (!picker) return;
          if (picker.key === "currency")     updateUser.mutate({ currency: v });
          else if (picker.key === "theme")    updateUser.mutate({ theme: v });
          else if (picker.key === "weekStart") prefs.set("weekStartsOn", Number(v) as WeekStart);
          else if (picker.key === "monthStart") prefs.set("monthStartsOnDay", Number(v));
          else if (picker.key === "autoLock") prefs.set("autoLockMinutes", Number(v) as AutoLockMinutes);
          else if (picker.key === "reminderTime") prefs.set("dailyReminderHour", Number(v));
          setPicker(null);
        }}
      />

      {/* Edit name modal */}
      {editName ? (
        <EditNameModal
          initial={meQ.data?.name ?? ""}
          onClose={() => setEditName(false)}
          onSave={async (name) => {
            await supabase
              .from("users")
              .update({ name: name.trim() || "You" })
              .eq("id", LOCAL_USER_ID);
            qc.invalidateQueries({ queryKey: ["me"] });
            setEditName(false);
          }}
        />
      ) : null}

      {/* Change PIN modal */}
      {pinSheet ? (
        <ChangePinModal onClose={() => setPinSheet(false)} />
      ) : null}
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Building blocks (iOS-grouped list)
// ──────────────────────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Text
      className="px-5 pt-6 pb-2"
      style={{
        fontFamily: "Inter_500Medium",
        fontSize: 11,
        color: ZINC_500,
        letterSpacing: 0.6,
      }}
    >
      {children}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View className="mx-4 rounded-2xl bg-card border border-border overflow-hidden">
      {children}
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  chevron,
  onPress,
  control,
  twoLine,
  last,
  disabled,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  chevron?: boolean;
  onPress?: () => void;
  control?: React.ReactNode;
  twoLine?: boolean;
  last?: boolean;
  disabled?: boolean;
}) {
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: "#27272a" }}
      style={{
        opacity: disabled ? 0.5 : 1,
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: "#27272a",
      }}
      className="flex-row items-center px-4"
    >
      <View
        className="flex-row items-center"
        style={{ minHeight: twoLine ? 60 : 48, flex: 1 }}
      >
        {icon ? <View className="mr-3">{icon}</View> : null}
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 14,
              color: "#f4f4f5",
            }}
          >
            {label}
          </Text>
          {twoLine && value ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                color: ZINC_400,
                marginTop: 2,
              }}
            >
              {value}
            </Text>
          ) : null}
        </View>
        {!twoLine && value ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              color: ZINC_400,
              marginRight: chevron ? 4 : 0,
              maxWidth: 180,
            }}
          >
            {value}
          </Text>
        ) : null}
        {control ? <View className="ml-2">{control}</View> : null}
        {chevron ? (
          <ChevronRight size={16} color={ZINC_500} />
        ) : null}
      </View>
    </Wrap>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Picker modal
// ──────────────────────────────────────────────────────────────────────────
function PickerSheet({
  open,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-2xl bg-card border-t border-border p-2"
        >
          <Text
            className="px-3 pt-2 pb-1"
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              color: ZINC_500,
              letterSpacing: 0.5,
            }}
          >
            {title.toUpperCase()}
          </Text>
          {options.map((o) => (
            <TouchableOpacity
              key={o.value}
              onPress={() => onSelect(o.value)}
              className="flex-row items-center px-3 h-12 rounded-xl"
              activeOpacity={0.85}
            >
              <Text
                className="flex-1"
                style={{
                  fontFamily: o.value === selected ? "Inter_700Bold" : "Inter_500Medium",
                  fontSize: 14,
                  color: o.value === selected ? EMERALD : "#f4f4f5",
                }}
              >
                {o.label}
              </Text>
              {o.value === selected ? <Check size={16} color={EMERALD} /> : null}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={onClose}
            className="h-11 items-center justify-center mt-1 mb-2"
          >
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                color: ZINC_400,
                fontSize: 13,
              }}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function pickerTitle(p: { key: string } | null): string {
  switch (p?.key) {
    case "currency": return "Currency";
    case "theme": return "Theme";
    case "weekStart": return "Start of week";
    case "monthStart": return "Month starts on";
    case "autoLock": return "Auto-lock after";
    case "reminderTime": return "Reminder time";
    default: return "";
  }
}

function pickerOptions(
  p: { key: string } | null,
  prefs: ReturnType<typeof usePreferencesStore.getState>,
): { value: string; label: string }[] {
  switch (p?.key) {
    case "currency":
      return CURRENCIES.map((c) => ({ value: c, label: c }));
    case "theme":
      return THEMES.map((t) => ({ value: t, label: cap(t) }));
    case "weekStart":
      return [
        { value: "0", label: "Sunday" },
        { value: "1", label: "Monday" },
      ];
    case "monthStart":
      return MONTH_START_DAYS.map((d) => ({
        value: String(d.value),
        label: d.label,
      }));
    case "autoLock":
      return AUTO_LOCK_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }));
    case "reminderTime":
      return REMINDER_TIMES.map((t) => ({ value: String(t.value), label: t.label }));
    default:
      return [];
  }
}

function pickerSelectedValue(
  p: { key: string } | null,
  currency: string,
  theme: string,
  prefs: ReturnType<typeof usePreferencesStore.getState>,
): string {
  switch (p?.key) {
    case "currency": return currency;
    case "theme": return theme;
    case "weekStart": return String(prefs.weekStartsOn);
    case "monthStart": return String(prefs.monthStartsOnDay);
    case "autoLock": return String(prefs.autoLockMinutes);
    case "reminderTime": return String(prefs.dailyReminderHour);
    default: return "";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Edit name modal
// ──────────────────────────────────────────────────────────────────────────
function EditNameModal({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/70 items-center justify-center px-6"
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-card border border-border p-5"
        >
          <Text
            style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#f4f4f5" }}
          >
            Edit name
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#52525b"
            className="mt-3 h-11 rounded-xl border border-border bg-background px-3 text-foreground"
            style={{ fontFamily: "Inter_500Medium" }}
          />
          <View className="flex-row mt-4" style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 h-10 rounded-xl items-center justify-center"
              style={{ borderWidth: 1, borderColor: "#3f3f46" }}
            >
              <Text style={{ fontFamily: "Inter_600SemiBold", color: "#f4f4f5" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                setSaving(true);
                try { await onSave(name); } finally { setSaving(false); }
              }}
              className="flex-1 h-10 rounded-xl items-center justify-center"
              style={{ backgroundColor: EMERALD }}
            >
              <Text style={{ fontFamily: "Inter_700Bold", color: "#09090b" }}>
                {saving ? "Saving…" : "Save"}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Change PIN modal
// ──────────────────────────────────────────────────────────────────────────
function ChangePinModal({ onClose }: { onClose: () => void }) {
  const [pin, setPinInput] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) return setError("PIN must be 4–6 digits.");
    if (pin !== confirm) return setError("PINs don't match.");
    setSaving(true);
    try {
      await setPin(pin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save PIN.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/70 items-center justify-center px-6"
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-card border border-border p-5"
        >
          <View className="flex-row items-center justify-between">
            <Text
              style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#f4f4f5" }}
            >
              Change PIN
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <X size={18} color={ZINC_400} />
            </TouchableOpacity>
          </View>

          <TextInput
            value={pin}
            onChangeText={(t) => setPinInput(t.replace(/\D/g, ""))}
            placeholder="New PIN (4–6 digits)"
            placeholderTextColor="#52525b"
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            className="mt-3 h-11 rounded-xl border border-border bg-background px-3 text-foreground text-center"
            style={{ fontFamily: "Inter_600SemiBold", letterSpacing: 6 }}
          />
          <TextInput
            value={confirm}
            onChangeText={(t) => setConfirm(t.replace(/\D/g, ""))}
            placeholder="Confirm PIN"
            placeholderTextColor="#52525b"
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            className="mt-2 h-11 rounded-xl border border-border bg-background px-3 text-foreground text-center"
            style={{ fontFamily: "Inter_600SemiBold", letterSpacing: 6 }}
          />
          {error ? (
            <Text
              className="mt-2 text-center"
              style={{ fontFamily: "Inter_500Medium", color: ROSE, fontSize: 12 }}
            >
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={submit}
            disabled={saving}
            className="h-11 mt-4 rounded-xl items-center justify-center"
            style={{ backgroundColor: EMERALD, opacity: saving ? 0.6 : 1 }}
          >
            <Text style={{ fontFamily: "Inter_700Bold", color: "#09090b" }}>
              {saving ? "Saving…" : "Save PIN"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => {
              await clearPin();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              onClose();
            }}
            className="h-10 items-center justify-center mt-2"
          >
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                color: ROSE,
                fontSize: 12,
              }}
            >
              Clear current PIN
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// PDF report (built off the recent transaction list)
// ──────────────────────────────────────────────────────────────────────────
async function buildPdfHtml(currency: string): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [{ data: txs }, { data: accs }, { data: cats }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id,amount,type,note,date,account_id,category_id")
      .gte("date", since.toISOString())
      .order("date", { ascending: false }),
    supabase.from("accounts").select("id,name"),
    supabase.from("categories").select("id,name,color"),
  ]);

  const accName = (id: string) => accs?.find((a) => a.id === id)?.name ?? "";
  const catFor = (id: string | null) => cats?.find((c) => c.id === id);

  const rows = (txs ?? []).slice(0, 200);
  const totalExpense = rows
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = rows
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + Number(t.amount), 0);

  const rowHtml = rows
    .map((t) => {
      const cat = catFor(t.category_id);
      const sign = t.type === "income" ? "+" : "−";
      const amt = formatAmount(Math.abs(Number(t.amount)), currency).replace(/^-/, "");
      return `
        <tr>
          <td>${format(new Date(t.date), "MMM d")}</td>
          <td>${escape(cat?.name ?? "—")}</td>
          <td>${escape(t.note ?? "")}</td>
          <td>${escape(accName(t.account_id))}</td>
          <td style="text-align: right; color: ${t.type === "income" ? "#10b981" : "#18181b"};">
            ${sign} ${escape(amt)}
          </td>
        </tr>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", sans-serif; margin: 32px; color: #18181b; }
  .header { display: flex; justify-content: space-between; align-items: baseline; }
  h1 { font-size: 22px; margin: 0; }
  .muted { color: #71717a; font-size: 12px; }
  .stats { display: flex; gap: 12px; margin: 20px 0 12px; }
  .stat { flex: 1; padding: 12px; border: 1px solid #e4e4e7; border-radius: 12px; }
  .stat .label { font-size: 11px; color: #71717a; letter-spacing: 0.4px; }
  .stat .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
  thead { background: #f4f4f5; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #e4e4e7; }
  th { font-size: 10px; color: #71717a; letter-spacing: 0.4px; text-transform: uppercase; }
  .footer { margin-top: 16px; font-size: 10px; color: #a1a1aa; text-align: center; }
</style></head><body>
  <div class="header">
    <div>
      <h1>Pulse Report</h1>
      <div class="muted">${format(since, "MMM d")} – ${format(new Date(), "MMM d, yyyy")}</div>
    </div>
    <div class="muted">Generated ${format(new Date(), "PPP")}</div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="label">EXPENSES</div>
      <div class="value">${escape(formatAmount(totalExpense, currency))}</div>
    </div>
    <div class="stat">
      <div class="label">INCOME</div>
      <div class="value" style="color:#10b981">${escape(formatAmount(totalIncome, currency))}</div>
    </div>
    <div class="stat">
      <div class="label">NET</div>
      <div class="value">${escape(formatAmount(totalIncome - totalExpense, currency))}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Date</th><th>Category</th><th>Note</th><th>Account</th><th style="text-align:right">Amount</th></tr>
    </thead>
    <tbody>${rowHtml || `<tr><td colspan="5" class="muted">No transactions in this window.</td></tr>`}</tbody>
  </table>

  <div class="footer">Exported from Pulse · ${format(new Date(), "yyyy-MM-dd")}</div>
</body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

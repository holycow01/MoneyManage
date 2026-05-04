/**
 * Calendar — monthly heatmap of daily spend.
 *
 * One Supabase query per visible month (cached on `["calendar", "yyyy-MM"]`).
 * Days are bucketed in JS, the maximum spend in the month sets the colour
 * scale, and each cell is tinted with a 6-step emerald ramp.
 *
 * Tap a day → DayDetailSheet. Swipe horizontally on the grid → previous /
 * next month. Today gets an emerald ring.
 */
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  runOnJS,
} from "react-native-reanimated";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  isSameMonth,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { formatAmount } from "@/lib/currency";
import { DayDetailSheet } from "@/components/DayDetailSheet";

// 6-step emerald ramp + zinc-900 base
const ZINC_900 = "#18181b";
const EMERALD_950 = "#022c22";
const EMERALD_800 = "#065f46";
const EMERALD_600 = "#059669";
const EMERALD_500 = "#10b981";
const EMERALD_400 = "#34d399";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

type RawTx = {
  id: string;
  amount: string;
  type: "income" | "expense" | "transfer";
  date: string;
};

type DayBucket = { total: number; count: number };

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function CalendarScreen() {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const monthStart = useMemo(() => startOfMonth(cursor), [cursor]);
  const monthEnd = useMemo(() => endOfMonth(cursor), [cursor]);
  const monthKey = format(cursor, "yyyy-MM");

  const { data: me } = useQuery({
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
  const currency = me?.currency ?? "PKR";

  const txQ = useQuery<RawTx[]>({
    queryKey: ["calendar", monthKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,amount,type,date")
        .gte("date", monthStart.toISOString())
        .lte("date", monthEnd.toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  const byDay = useMemo(() => {
    const m = new Map<string, DayBucket>();
    for (const t of txQ.data ?? []) {
      if (t.type !== "expense") continue;
      const k = format(new Date(t.date), "yyyy-MM-dd");
      const cur = m.get(k);
      m.set(k, {
        total: (cur?.total ?? 0) + Number(t.amount),
        count: (cur?.count ?? 0) + 1,
      });
    }
    return m;
  }, [txQ.data]);

  const maxAmount = useMemo(() => {
    let m = 0;
    for (const v of byDay.values()) if (v.total > m) m = v.total;
    return m;
  }, [byDay]);

  // 6 weeks × 7 days; pad with adjacent-month placeholders so weekday columns line up.
  const cells = useMemo(() => {
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const startWeekday = (getDay(monthStart) + 6) % 7; // Mon = 0
    const out: { date: Date; inMonth: boolean }[] = [];
    for (let i = startWeekday; i > 0; i--) {
      const d = new Date(monthStart);
      d.setDate(monthStart.getDate() - i);
      out.push({ date: d, inMonth: false });
    }
    for (const d of days) out.push({ date: d, inMonth: true });
    while (out.length % 7 !== 0) {
      const last = out[out.length - 1].date;
      const d = new Date(last);
      d.setDate(last.getDate() + 1);
      out.push({ date: d, inMonth: false });
    }
    return out;
  }, [monthStart, monthEnd]);

  // Footer stats (in-month only)
  const stats = useMemo(() => {
    let total = 0;
    let busiestKey: string | null = null;
    let busiestTotal = 0;
    let daysWithSpend = 0;
    for (const [k, v] of byDay.entries()) {
      total += v.total;
      daysWithSpend += 1;
      if (v.total > busiestTotal) {
        busiestTotal = v.total;
        busiestKey = k;
      }
    }
    return {
      total,
      busiest: busiestKey
        ? { key: busiestKey, total: busiestTotal }
        : null,
      averageDaily:
        daysWithSpend > 0
          ? total / daysWithSpend
          : 0,
    };
  }, [byDay]);

  const goPrev = useCallback(() => {
    Haptics.selectionAsync();
    setCursor((c) => subMonths(c, 1));
  }, []);
  const goNext = useCallback(() => {
    Haptics.selectionAsync();
    setCursor((c) => addMonths(c, 1));
  }, []);

  // Horizontal swipe → month nav. activeOffsetX gates against vertical scroll.
  const swipe = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      "worklet";
      if (e.translationX > 60) runOnJS(goPrev)();
      else if (e.translationX < -60) runOnJS(goNext)();
    });

  const today = new Date();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
        <TouchableOpacity
          onPress={goPrev}
          hitSlop={12}
          className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
          activeOpacity={0.8}
        >
          <ChevronLeft size={18} color="#f4f4f5" />
        </TouchableOpacity>
        <View className="items-center">
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 20,
              color: "#f4f4f5",
            }}
          >
            {format(cursor, "MMMM")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              color: ZINC_400,
              marginTop: -2,
            }}
          >
            {format(cursor, "yyyy")}
          </Text>
        </View>
        <TouchableOpacity
          onPress={goNext}
          hitSlop={12}
          className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
          activeOpacity={0.8}
        >
          <ChevronRight size={18} color="#f4f4f5" />
        </TouchableOpacity>
      </View>

      {/* Day-of-week header (Mon-start) */}
      <View className="flex-row px-3 pb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <View key={i} className="flex-1 items-center">
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 11,
                color: ZINC_500,
                letterSpacing: 0.4,
              }}
            >
              {d}
            </Text>
          </View>
        ))}
      </View>

      {/* Grid (swipe to change month, fade-in on month change) */}
      <GestureDetector gesture={swipe}>
        <Animated.View
          key={monthKey}
          entering={FadeIn.duration(180)}
          className="flex-1 px-2"
        >
          {chunk(cells, 7).map((row, ri) => (
            <View key={ri} className="flex-row" style={{ flex: 1 }}>
              {row.map((cell, ci) => {
                const k = format(cell.date, "yyyy-MM-dd");
                const bucket = byDay.get(k);
                const total = bucket?.total ?? 0;
                const ratio = maxAmount > 0 ? total / maxAmount : 0;
                const isTodayCell = isSameDay(cell.date, today);
                return (
                  <DayCell
                    key={`${ri}-${ci}`}
                    date={cell.date}
                    inMonth={cell.inMonth}
                    total={total}
                    ratio={ratio}
                    isToday={isTodayCell}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSelectedDay(cell.date);
                    }}
                  />
                );
              })}
            </View>
          ))}
        </Animated.View>
      </GestureDetector>

      {/* Footer summary */}
      <View
        className="px-5 pt-3 pb-4 flex-row border-t border-border"
        style={{ backgroundColor: ZINC_900 }}
      >
        <Stat
          label="Total"
          value={
            txQ.isLoading ? "—" : formatAmount(stats.total, currency)
          }
        />
        <Stat
          label="Busiest"
          value={
            stats.busiest
              ? formatAmount(stats.busiest.total, currency)
              : "—"
          }
          sub={
            stats.busiest
              ? format(new Date(stats.busiest.key), "MMM d")
              : ""
          }
        />
        <Stat
          label="Avg / day"
          value={formatAmount(stats.averageDaily, currency)}
        />
      </View>

      <DayDetailSheet
        open={selectedDay !== null}
        date={selectedDay}
        currency={currency}
        onClose={() => setSelectedDay(null)}
      />
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pieces
// ──────────────────────────────────────────────────────────────────────────
function DayCell({
  date,
  inMonth,
  total,
  ratio,
  isToday,
  onPress,
}: {
  date: Date;
  inMonth: boolean;
  total: number;
  ratio: number;
  isToday: boolean;
  onPress: () => void;
}) {
  const bg = inMonth ? intensityColor(ratio) : ZINC_900;
  const opacity = inMonth ? 1 : 0.35;

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        margin: 2,
        borderRadius: 10,
        backgroundColor: bg,
        opacity,
        padding: 6,
        borderWidth: isToday ? 2 : 0,
        borderColor: EMERALD_500,
        overflow: "hidden",
      }}
    >
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 12,
          color: ratio > 0 ? "#f4f4f5" : "#a1a1aa",
        }}
      >
        {format(date, "d")}
      </Text>
      <View style={{ flex: 1 }} />
      {total > 0 ? (
        <Text
          numberOfLines={1}
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 9,
            color: "#d4d4d8",
          }}
        >
          {compactNumber(total)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View className="flex-1">
      <Text
        style={{
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          color: ZINC_400,
          letterSpacing: 0.6,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 15,
          color: "#f4f4f5",
          marginTop: 2,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      {sub ? (
        <Text
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 10,
            color: ZINC_500,
          }}
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function intensityColor(ratio: number): string {
  if (ratio <= 0) return ZINC_900;
  if (ratio < 0.2) return EMERALD_950;
  if (ratio < 0.45) return EMERALD_800;
  if (ratio < 0.65) return EMERALD_600;
  if (ratio < 0.85) return EMERALD_500;
  return EMERALD_400;
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

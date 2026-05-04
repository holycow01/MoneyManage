/**
 * Onboarding — shown after first sign-up.
 *
 * Three swipeable intro slides explaining Quick Entry, Dashboard, and
 * Insights, followed by a setup slide that captures currency, the first
 * account name, and its starting balance. Submitting the setup slide
 * creates the account, updates `users.currency`, and routes to /(tabs).
 *
 * AuthGate redirects here when `ensureUserProvisioned()` returns
 * `{ created: true }`. Existing users (with at least one account) never
 * see this screen.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  ArrowRight,
  ChevronRight,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react-native";

import { LOCAL_USER_ID, supabase } from "@/lib/supabase";
import { symbolFor } from "@/lib/currency";
import { ensureLocalUser } from "@/lib/provision";

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

const { width: SCREEN_W } = Dimensions.get("window");

const CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "INR", "SAR"] as const;
const ACCOUNT_TYPES = [
  { value: "cash",    label: "Cash"    },
  { value: "bank",    label: "Bank"    },
  { value: "credit",  label: "Credit"  },
  { value: "wallet",  label: "Wallet"  },
  { value: "savings", label: "Savings" },
] as const;

const SLIDES = [
  {
    icon: Wallet,
    eyebrow: "QUICK ENTRY",
    title: "Two taps to log",
    body:
      "Type the amount on the calculator keypad, tap a category — done. Save shortcuts for the things you log every day.",
  },
  {
    icon: TrendingUp,
    eyebrow: "DASHBOARD",
    title: "Your money, finally clear",
    body:
      "Hero stats, cash flow, donut breakdowns, net worth, account sparklines — everything for the period you pick.",
  },
  {
    icon: Sparkles,
    eyebrow: "AI INSIGHTS",
    title: "Coached by Claude",
    body:
      "Every Sunday Pulse drops 3–5 personal insights — what changed, what's odd, where to save. Ask anything.",
  },
];
const TOTAL_PAGES = SLIDES.length + 1;

// ──────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const router = useRouter();
  const scrollX = useSharedValue(0);
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const goTo = useCallback((index: number) => {
    Haptics.selectionAsync();
    scrollRef.current?.scrollTo({ x: index * SCREEN_W, animated: true });
    setPage(index);
  }, []);

  const skipToSetup = useCallback(() => goTo(SLIDES.length), [goTo]);
  const finishOnboarding = useCallback(
    () => router.replace("/(tabs)"),
    [router],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      {/* Skip — only visible on intro slides */}
      <View className="flex-row justify-end px-5 pt-2">
        <TouchableOpacity
          onPress={skipToSetup}
          hitSlop={12}
          accessibilityLabel="Skip intro"
          activeOpacity={0.7}
          style={{ opacity: page < SLIDES.length ? 1 : 0 }}
          disabled={page >= SLIDES.length}
        >
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              color: ZINC_400,
            }}
          >
            Skip
          </Text>
        </TouchableOpacity>
      </View>

      <Animated.ScrollView
        ref={scrollRef as any}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          if (i !== page) {
            Haptics.selectionAsync();
            setPage(i);
          }
        }}
        style={{ flex: 1 }}
      >
        {SLIDES.map((s, i) => (
          <IntroSlide key={i} slide={s} index={i} scrollX={scrollX} />
        ))}
        <SetupSlide onFinish={finishOnboarding} />
      </Animated.ScrollView>

      {/* Dots + advance */}
      <View className="flex-row items-center justify-between px-5 pb-2">
        <Dots count={TOTAL_PAGES} index={page} scrollX={scrollX} />
        {page < SLIDES.length ? (
          <TouchableOpacity
            onPress={() => goTo(page + 1)}
            activeOpacity={0.85}
            accessibilityLabel="Next slide"
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: EMERALD }}
          >
            <ArrowRight size={20} color="#09090b" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 48 }} />
        )}
      </View>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Intro slide
// ──────────────────────────────────────────────────────────────────────────
function IntroSlide({
  slide,
  index,
  scrollX,
}: {
  slide: (typeof SLIDES)[number];
  index: number;
  scrollX: Animated.SharedValue<number>;
}) {
  const Icon = slide.icon;

  // Parallax: icon fades + scales as the slide enters/exits the viewport.
  const animStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * SCREEN_W,
      index * SCREEN_W,
      (index + 1) * SCREEN_W,
    ];
    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0.4, 1, 0.4],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      scrollX.value,
      inputRange,
      [0.85, 1, 0.85],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      scrollX.value,
      inputRange,
      [20, 0, 20],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ scale }, { translateY }],
    };
  });

  return (
    <View style={{ width: SCREEN_W }} className="flex-1 px-8 justify-center">
      <Animated.View style={animStyle} className="items-center">
        <View
          className="h-24 w-24 rounded-3xl items-center justify-center mb-6"
          style={{ backgroundColor: `${EMERALD}1f` }}
        >
          <Icon size={44} color={EMERALD} />
        </View>
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 11,
            color: EMERALD,
            letterSpacing: 1.5,
          }}
        >
          {slide.eyebrow}
        </Text>
        <Text
          className="text-center mt-3"
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 28,
            color: "#f4f4f5",
            lineHeight: 34,
          }}
        >
          {slide.title}
        </Text>
        <Text
          className="text-center mt-3"
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            color: ZINC_400,
            lineHeight: 22,
            maxWidth: 320,
          }}
        >
          {slide.body}
        </Text>
      </Animated.View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Setup slide — currency + first account
// ──────────────────────────────────────────────────────────────────────────
function SetupSlide({
  onFinish,
}: {
  onFinish: () => void;
}) {
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("PKR");
  const [name, setName] = useState("Cash");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]["value"]>(
    "cash",
  );
  const [balanceText, setBalanceText] = useState("");
  const [busy, setBusy] = useState(false);

  const balance = useMemo(() => {
    const n = Number(balanceText.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }, [balanceText]);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBusy(true);
    try {
      // Belt-and-braces: make sure the local user row exists.
      await ensureLocalUser();

      const { error: e1 } = await supabase
        .from("users")
        .update({ currency })
        .eq("id", LOCAL_USER_ID);
      if (e1) throw e1;

      const { error: e2 } = await supabase.from("accounts").insert({
        name: name.trim(),
        type,
        balance: balance.toFixed(2),
        color: defaultColorFor(type),
        icon: defaultIconFor(type),
      });
      if (e2) throw e2;

      onFinish();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't set up", e?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ width: SCREEN_W }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 11,
            color: EMERALD,
            letterSpacing: 1.5,
          }}
        >
          ONE LAST THING
        </Text>
        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 26,
            color: "#f4f4f5",
            marginTop: 6,
            lineHeight: 32,
          }}
        >
          Add your first account
        </Text>
        <Text
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            color: ZINC_400,
            marginTop: 4,
          }}
        >
          You can add more anytime under Accounts.
        </Text>

        <Section label="CURRENCY">
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {CURRENCIES.map((c) => {
              const active = c === currency;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setCurrency(c);
                  }}
                  accessibilityLabel={`Currency ${c}`}
                  className="h-9 px-3 items-center justify-center rounded-full"
                  style={{
                    minWidth: 60,
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
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <Section label="ACCOUNT NAME">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Cash, HBL Bank, Apple Card…"
            placeholderTextColor="#52525b"
            accessibilityLabel="Account name"
            className="h-11 rounded-xl border border-border bg-card px-3 text-foreground"
            style={{ fontFamily: "Inter_500Medium" }}
          />
        </Section>

        <Section label="ACCOUNT TYPE">
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
                  accessibilityLabel={`Type ${t.label}`}
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

        <Section label="STARTING BALANCE">
          <View className="h-12 flex-row items-center rounded-xl border border-border bg-card px-3">
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
              value={balanceText}
              onChangeText={(t) => setBalanceText(t.replace(/[^\d.]/g, ""))}
              placeholder="0"
              placeholderTextColor="#52525b"
              keyboardType="decimal-pad"
              accessibilityLabel="Starting balance"
              className="flex-1 text-foreground"
              style={{ fontFamily: "Inter_600SemiBold", fontSize: 18 }}
            />
          </View>
          <Text
            className="mt-1"
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              color: ZINC_500,
            }}
          >
            How much is in this account right now? You can leave at 0 and add
            transactions later.
          </Text>
        </Section>

        <View className="mt-6">
          <TouchableOpacity
            onPress={submit}
            disabled={!valid || busy}
            activeOpacity={0.85}
            accessibilityLabel="Get started"
            className="h-12 items-center justify-center rounded-2xl flex-row"
            style={{
              backgroundColor: valid ? EMERALD : "#1f2937",
              opacity: valid ? 1 : 0.5,
            }}
          >
            {busy ? (
              <ActivityIndicator color="#09090b" />
            ) : (
              <>
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 14,
                    color: "#09090b",
                    marginRight: 6,
                  }}
                >
                  Get started
                </Text>
                <ChevronRight size={16} color="#09090b" />
              </>
            )}
          </TouchableOpacity>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pieces
// ──────────────────────────────────────────────────────────────────────────
function Dots({
  count,
  index,
  scrollX,
}: {
  count: number;
  index: number;
  scrollX: Animated.SharedValue<number>;
}) {
  return (
    <View className="flex-row items-center" style={{ gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Dot key={i} i={i} scrollX={scrollX} />
      ))}
    </View>
  );
}

function Dot({
  i,
  scrollX,
}: {
  i: number;
  scrollX: Animated.SharedValue<number>;
}) {
  const animStyle = useAnimatedStyle(() => {
    const inputRange = [(i - 1) * SCREEN_W, i * SCREEN_W, (i + 1) * SCREEN_W];
    const width = interpolate(
      scrollX.value,
      inputRange,
      [8, 24, 8],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0.4, 1, 0.4],
      Extrapolation.CLAMP,
    );
    return {
      width,
      opacity,
    };
  });
  return (
    <Animated.View
      style={[
        { height: 8, borderRadius: 4, backgroundColor: EMERALD },
        animStyle,
      ]}
    />
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
    <View className="mt-5">
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

function defaultIconFor(t: (typeof ACCOUNT_TYPES)[number]["value"]): string {
  switch (t) {
    case "cash":    return "banknote";
    case "bank":    return "landmark";
    case "credit":  return "credit-card";
    case "wallet":  return "wallet";
    case "savings": return "piggy-bank";
  }
}

function defaultColorFor(t: (typeof ACCOUNT_TYPES)[number]["value"]): string {
  switch (t) {
    case "cash":    return "#10b981";
    case "bank":    return "#0ea5e9";
    case "credit":  return "#f43f5e";
    case "wallet":  return "#8b5cf6";
    case "savings": return "#f59e0b";
  }
}

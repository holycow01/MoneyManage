/**
 * Natural-language search bar for the Insights screen.
 *
 * The user types a question, we POST it to the `nl-query` Edge Function,
 * and render Claude's answer + an optional structured summary (KPI,
 * list, or comparison bars) inline below the input.
 *
 *   <NLSearchBar currency={currency} />
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { ChevronRight, Search, Sparkles, X } from "lucide-react-native";

import { askNL, type NlAnswer, type NlSummary } from "@/lib/insights";
import { formatAmount } from "@/lib/currency";

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";

const SUGGESTIONS = [
  "How much on coffee last month?",
  "Show all transactions over ₨ 5,000",
  "Average weekend spending",
  "What did I spend the most on this week?",
];

export function NLSearchBar({ currency }: { currency: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<NlAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    Haptics.selectionAsync();
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await askNL(text);
      setAnswer(res);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't get an answer.");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setQuestion("");
    setAnswer(null);
    setError(null);
  };

  return (
    <View className="px-4">
      <View className="h-12 flex-row items-center rounded-2xl border border-border bg-card px-3">
        <Sparkles size={16} color={EMERALD} />
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask anything about your spending…"
          placeholderTextColor="#52525b"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => submit()}
          editable={!busy}
          className="flex-1 ml-2 text-foreground"
          style={{ fontFamily: "Inter_500Medium", fontSize: 14 }}
        />
        {busy ? (
          <ActivityIndicator color={EMERALD} />
        ) : question ? (
          <Pressable onPress={clear} hitSlop={10}>
            <X size={16} color={ZINC_400} />
          </Pressable>
        ) : (
          <Search size={16} color={ZINC_400} />
        )}
      </View>

      {/* Suggestion chips — only when no question has been typed yet */}
      {!question && !answer && !busy ? (
        <View className="mt-2 flex-row flex-wrap" style={{ gap: 6 }}>
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                setQuestion(s);
                submit(s);
              }}
              className="h-7 px-2 rounded-full flex-row items-center"
              style={{ borderWidth: 1, borderColor: "#3f3f46" }}
            >
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                  color: ZINC_400,
                }}
              >
                {s}
              </Text>
              <ChevronRight size={12} color={ZINC_400} style={{ marginLeft: 2 }} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Answer card */}
      {answer ? (
        <View className="mt-3 rounded-2xl border border-border bg-card p-4">
          <View className="flex-row items-start">
            <View
              className="h-7 w-7 rounded-full items-center justify-center mr-2"
              style={{ backgroundColor: `${EMERALD}1a` }}
            >
              <Sparkles size={14} color={EMERALD} />
            </View>
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 14,
                color: "#f4f4f5",
                flex: 1,
                lineHeight: 20,
              }}
            >
              {answer.answer}
            </Text>
          </View>
          <SummaryView summary={answer.summary} currency={currency} />
        </View>
      ) : null}

      {error ? (
        <Text
          className="mt-3 text-xs"
          style={{ fontFamily: "Inter_500Medium", color: "#f43f5e" }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Summary renderer
// ──────────────────────────────────────────────────────────────────────────
function SummaryView({
  summary,
  currency,
}: {
  summary: NlSummary;
  currency: string;
}) {
  if (!summary || summary.kind === "none") return null;

  if (summary.kind === "amount") {
    return (
      <View
        className="mt-3 rounded-xl px-3 py-3"
        style={{ backgroundColor: `${EMERALD}10` }}
      >
        <Text
          style={{ fontFamily: "Inter_500Medium", fontSize: 10, color: ZINC_500, letterSpacing: 0.5 }}
        >
          ANSWER
        </Text>
        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 24,
            color: "#f4f4f5",
            marginTop: 2,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatAmount(summary.value, summary.currency || currency)}
        </Text>
      </View>
    );
  }

  if (summary.kind === "list") {
    return (
      <View className="mt-3" style={{ gap: 4 }}>
        {summary.rows.slice(0, 8).map((r, i) => (
          <View
            key={i}
            className="flex-row items-center justify-between py-1.5 px-2 rounded-lg"
            style={{ backgroundColor: i % 2 === 0 ? "#27272a" : "transparent" }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 12,
                color: "#f4f4f5",
                flex: 1,
              }}
            >
              {r.label}
            </Text>
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 12,
                color: "#f4f4f5",
              }}
            >
              {typeof r.value === "number"
                ? formatAmount(r.value, currency)
                : String(r.value)}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  // Comparison: simple horizontal bars
  if (summary.kind === "comparison") {
    const max = summary.rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
    return (
      <View className="mt-3" style={{ gap: 6 }}>
        {summary.rows.map((r, i) => (
          <View key={i}>
            <View className="flex-row items-center justify-between mb-0.5">
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                  color: ZINC_400,
                }}
                numberOfLines={1}
              >
                {r.label}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 11,
                  color: "#f4f4f5",
                }}
              >
                {formatAmount(r.value, currency)}
              </Text>
            </View>
            <View
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: "#27272a",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${(r.value / max) * 100}%`,
                  height: "100%",
                  backgroundColor: EMERALD,
                  borderRadius: 3,
                }}
              />
            </View>
          </View>
        ))}
      </View>
    );
  }

  return null;
}

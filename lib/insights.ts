/**
 * Client helpers for the insights screen.
 *
 *   generateInsightsNow()  — manually trigger the `generate-insights`
 *                            Edge Function for the current user.
 *   askNL(question)         — call `nl-query` for a natural-language answer.
 *   dismissInsight(id)     — mark an insight as dismissed (soft-delete).
 */
import { supabase } from "./supabase";

export type NlSummary =
  | { kind: "amount"; value: number; currency: string }
  | { kind: "list"; rows: Array<{ label: string; value: number | string }> }
  | { kind: "comparison"; rows: Array<{ label: string; value: number }> }
  | { kind: "none" };

export type NlAnswer = {
  answer: string;
  summary: NlSummary;
  model?: string;
};

export async function generateInsightsNow(): Promise<{ inserted: number }> {
  const { data, error } = await supabase.functions.invoke("generate-insights", {
    body: {},
  });
  if (error) throw new Error(error.message);
  return data as { inserted: number };
}

export async function askNL(question: string): Promise<NlAnswer> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error("Empty question");
  const { data, error } = await supabase.functions.invoke("nl-query", {
    body: { question: trimmed },
  });
  if (error) throw new Error(error.message);
  return data as NlAnswer;
}

export async function dismissInsight(id: string): Promise<void> {
  const { error } = await supabase
    .from("insights")
    .update({ dismissed: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

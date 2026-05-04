/**
 * nl-query — answer a natural-language question about the user's spending.
 *
 *   POST /functions/v1/nl-query
 *   Authorization: Bearer <Clerk JWT>
 *   { "question": "How much on coffee last month?" }
 *
 *   → { "answer": "...", "summary": { kind, value }, "model": "claude-opus-4-7" }
 *
 * The function pulls the calling user's last 180 days of transactions
 * (RLS keeps it scoped to that user automatically), the full categories
 * and accounts lists, and feeds them to Claude with the user's question.
 *
 * Claude returns a JSON object with a one-sentence answer plus an
 * optional structured summary the screen renders as a chart or KPI.
 *
 * Privacy: amounts and notes go to Anthropic. If you ever process notes
 * containing PII, mask them before sending.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-7";
const LOOKBACK_DAYS = 180;
const MAX_TX = 1500; // hard cap so prompts don't explode

type Summary =
  | { kind: "amount"; value: number; currency: string }
  | { kind: "list"; rows: Array<{ label: string; value: number | string }> }
  | { kind: "comparison"; rows: Array<{ label: string; value: number }> }
  | { kind: "none" };

type NlAnswer = {
  answer: string;
  summary: Summary;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  let question = "";
  try {
    const body = await req.json();
    question = String(body.question ?? "").trim();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  if (!question) return json({ error: "Empty question" }, 400);
  if (question.length > 500) return json({ error: "Question too long" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );

  // Pull RLS-filtered context.
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [meRes, txRes, catRes, accRes] = await Promise.all([
    supabase.from("users").select("currency").single(),
    supabase
      .from("transactions")
      .select("amount,type,date,note,category_id,account_id")
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(MAX_TX),
    supabase.from("categories").select("id,name,type"),
    supabase.from("accounts").select("id,name,type"),
  ]);

  if (meRes.error) return json({ error: meRes.error.message }, 500);
  const currency = meRes.data?.currency ?? "PKR";

  const txs = txRes.data ?? [];
  const cats = catRes.data ?? [];
  const accs = accRes.data ?? [];

  // Resolve ids → names so Claude doesn't have to cross-reference UUIDs.
  const enrichedTxs = txs.map((t) => ({
    amount: Number(t.amount),
    type: t.type,
    date: t.date.slice(0, 10),
    note: t.note,
    category: cats.find((c) => c.id === t.category_id)?.name ?? null,
    account: accs.find((a) => a.id === t.account_id)?.name ?? null,
  }));

  try {
    const result = await askClaude(question, enrichedTxs, currency, cats, accs);
    return json({ ...result, model: CLAUDE_MODEL });
  } catch (e) {
    console.error("nl-query failed", e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Prompt
// ──────────────────────────────────────────────────────────────────────────
function buildPrompt(
  question: string,
  txs: ReturnType<typeof enrichTxs>,
  currency: string,
  cats: Array<{ name: string; type: string }>,
  accs: Array<{ name: string; type: string }>,
): string {
  return [
    `You are Pulse, a personal-finance assistant. Today is ${new Date()
      .toISOString()
      .slice(0, 10)}.`,
    `The user's currency is ${currency}.`,
    ``,
    `Their categories: ${cats.map((c) => c.name).join(", ") || "(none)"}.`,
    `Their accounts:  ${accs.map((a) => a.name).join(", ") || "(none)"}.`,
    ``,
    `Below is a JSON array of every transaction in the last ${LOOKBACK_DAYS} days,`,
    `most recent first (capped at ${MAX_TX}). Amounts are in ${currency}.`,
    ``,
    `${JSON.stringify(txs)}`,
    ``,
    `User's question: """${question}"""`,
    ``,
    `Answer the question using ONLY the data above.`,
    ``,
    `Respond with a single JSON object — no markdown, no preamble:`,
    `{`,
    `  "answer": "<one or two short sentences, plain language, with the key numbers>",`,
    `  "summary": {`,
    `     "kind": "amount" | "list" | "comparison" | "none",`,
    `     // For "amount":     { "kind": "amount",     "value": <number>, "currency": "${currency}" }`,
    `     // For "list":       { "kind": "list",       "rows": [{"label": <str>, "value": <number|string>}, ...] }`,
    `     // For "comparison": { "kind": "comparison", "rows": [{"label": <str>, "value": <number>}, ...] }`,
    `     // For "none":       { "kind": "none" }`,
    `  }`,
    `}`,
    ``,
    `If the question can't be answered from the data, set "summary.kind": "none"`,
    `and explain in "answer" what's missing — don't invent numbers.`,
  ].join("\n");
}

// helper alias
function enrichTxs(): never[] { return []; }

// ──────────────────────────────────────────────────────────────────────────
// Claude call
// ──────────────────────────────────────────────────────────────────────────
async function askClaude(
  question: string,
  txs: ReturnType<typeof enrichTxs>,
  currency: string,
  cats: Array<{ name: string; type: string }>,
  accs: Array<{ name: string; type: string }>,
): Promise<NlAnswer> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const prompt = buildPrompt(question, txs, currency, cats, accs);

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [
        { role: "user", content: prompt },
        // Prefill so the assistant returns a raw JSON object straight away.
        { role: "assistant", content: "{" },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body}`);
  }

  const payload = await res.json();
  const text: string = payload.content?.[0]?.text ?? "";
  const raw = "{" + text;

  const closeIdx = raw.lastIndexOf("}");
  const jsonText = closeIdx >= 0 ? raw.slice(0, closeIdx + 1) : raw;

  let parsed: NlAnswer;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    console.error("Bad JSON from Claude", jsonText);
    throw new Error("Claude returned invalid JSON");
  }

  // Validate shape.
  if (typeof parsed.answer !== "string") {
    throw new Error("Missing 'answer'");
  }
  const s = parsed.summary;
  const validKind =
    s && (s.kind === "amount" || s.kind === "list" ||
          s.kind === "comparison" || s.kind === "none");
  if (!validKind) parsed.summary = { kind: "none" };

  return parsed;
}

/**
 * generate-insights — weekly AI spending insights.
 *
 * Modes:
 *   1. Manual (from the app)  — Authorization: Bearer <Clerk JWT>
 *      Runs for the JWT's user only. RLS already filters everything to that
 *      user, so we just use the calling client.
 *
 *   2. Scheduled (pg_cron)    — Authorization: Bearer <SERVICE_ROLE_KEY>
 *                              + x-cron-secret: <CRON_SECRET>
 *      Iterates over every user and runs the same logic for each, using
 *      the service role to read across users (RLS bypassed).
 *
 * The Anthropic call uses model `claude-opus-4-7`. Output is parsed as a
 * JSON array of `{ type, message, data }`. We "prefill" the assistant turn
 * with `[` so Claude reliably emits raw JSON (no markdown fences).
 *
 * Env (set with `supabase secrets set …`):
 *   ANTHROPIC_API_KEY   — Anthropic API key
 *   CRON_SECRET         — random string the cron job sends in x-cron-secret
 *   SUPABASE_URL        — auto-injected by Supabase
 *   SUPABASE_ANON_KEY   — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected (only used in cron mode)
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-7";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
type InsightType = "weekly_summary" | "anomaly" | "tip" | "streak";
type ClaudeInsight = {
  type: InsightType;
  message: string;
  data?: Record<string, unknown>;
};

type Tx = {
  amount: string;
  type: "income" | "expense" | "transfer";
  date: string;
  category_id: string | null;
  note: string | null;
};
type Category = { id: string; name: string };
type Budget = {
  category_id: string;
  amount: string;
  period: "weekly" | "monthly";
};

// ──────────────────────────────────────────────────────────────────────────
// HTTP entry
// ──────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecretHeader = req.headers.get("x-cron-secret");
  const isCron =
    !!cronSecretHeader &&
    cronSecretHeader === Deno.env.get("CRON_SECRET");

  try {
    if (isCron) {
      // Service-role client to iterate over all users.
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: users, error } = await admin
        .from("users")
        .select("id,currency");
      if (error) throw error;

      let total = 0;
      for (const u of users ?? []) {
        try {
          const inserted = await runForUser(admin, u.id, u.currency ?? "PKR");
          total += inserted;
        } catch (e) {
          console.error(`generate-insights: ${u.id} failed`, e);
        }
      }
      return json({ ok: true, mode: "cron", users: users?.length ?? 0, inserted: total });
    }

    // Manual mode — read the user from the JWT.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // The Clerk integration sets `auth.jwt() -> sub` as the user id; the
    // user row has the same id, so a single self-select gives us the row.
    const { data: me, error: meErr } = await supabase
      .from("users")
      .select("id,currency")
      .single();
    if (meErr || !me) return json({ error: "Not provisioned" }, 401);

    const inserted = await runForUser(supabase, me.id, me.currency ?? "PKR");
    return json({ ok: true, mode: "manual", inserted });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Per-user pipeline
// ──────────────────────────────────────────────────────────────────────────
async function runForUser(
  client: SupabaseClient,
  userId: string,
  currency: string,
): Promise<number> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [{ data: txs }, { data: cats }, { data: budgets }] = await Promise.all([
    client
      .from("transactions")
      .select("amount,type,date,category_id,note")
      .eq("user_id", userId)
      .gte("date", twoWeeksAgo.toISOString())
      .lte("date", now.toISOString()),
    client.from("categories").select("id,name").eq("user_id", userId),
    client
      .from("budgets")
      .select("category_id,amount,period")
      .eq("user_id", userId),
  ]);

  if (!txs || txs.length === 0) {
    // Nothing to talk about yet — skip.
    return 0;
  }

  const summary = summarize(
    txs as Tx[],
    cats as Category[],
    budgets as Budget[],
    weekAgo,
    twoWeeksAgo,
    now,
  );
  const claudeInsights = await callClaude(summary, currency);
  if (claudeInsights.length === 0) return 0;

  const rows = claudeInsights
    .filter((i) => i.message && i.type)
    .map((i) => ({
      user_id: userId,
      type: i.type,
      message: i.message,
      data_json: i.data ?? null,
    }));

  if (rows.length === 0) return 0;

  const { error } = await client.from("insights").insert(rows);
  if (error) {
    console.error("insert insights", error);
    return 0;
  }
  return rows.length;
}

// ──────────────────────────────────────────────────────────────────────────
// Stat summary — what we feed Claude
// ──────────────────────────────────────────────────────────────────────────
type Summary = {
  week1: { start: string; end: string; total: number; byCategory: Record<string, number> };
  week2: { start: string; end: string; total: number; byCategory: Record<string, number> };
  largestExpenses: Array<{ amount: number; note: string | null; categoryName: string; date: string }>;
  budgets: Array<{ categoryName: string; amount: number; spent: number; period: "weekly" | "monthly" }>;
};

function summarize(
  txs: Tx[],
  cats: Category[],
  budgets: Budget[],
  weekAgo: Date,
  twoWeeksAgo: Date,
  now: Date,
): Summary {
  const catName = (id: string | null) =>
    cats.find((c) => c.id === id)?.name ?? "Uncategorized";

  const week1Txs = txs.filter((t) => {
    const d = new Date(t.date);
    return d >= twoWeeksAgo && d < weekAgo && t.type === "expense";
  });
  const week2Txs = txs.filter((t) => {
    const d = new Date(t.date);
    return d >= weekAgo && d <= now && t.type === "expense";
  });

  const sum = (list: Tx[]) => list.reduce((s, t) => s + Number(t.amount), 0);
  const byCat = (list: Tx[]) => {
    const m: Record<string, number> = {};
    for (const t of list) {
      const n = catName(t.category_id);
      m[n] = (m[n] ?? 0) + Number(t.amount);
    }
    return m;
  };

  const largestExpenses = txs
    .filter((t) => t.type === "expense")
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5)
    .map((t) => ({
      amount: Number(t.amount),
      note: t.note,
      categoryName: catName(t.category_id),
      date: t.date.slice(0, 10),
    }));

  // Budget vs spend (current period)
  const budgetSummary = budgets.map((b) => {
    const periodStart =
      b.period === "weekly"
        ? weekAgo
        : new Date(now.getFullYear(), now.getMonth(), 1);
    const spent = txs
      .filter(
        (t) =>
          t.type === "expense" &&
          t.category_id === b.category_id &&
          new Date(t.date) >= periodStart,
      )
      .reduce((s, t) => s + Number(t.amount), 0);
    return {
      categoryName: catName(b.category_id),
      amount: Number(b.amount),
      spent,
      period: b.period,
    };
  });

  return {
    week1: {
      start: twoWeeksAgo.toISOString().slice(0, 10),
      end: weekAgo.toISOString().slice(0, 10),
      total: sum(week1Txs),
      byCategory: byCat(week1Txs),
    },
    week2: {
      start: weekAgo.toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
      total: sum(week2Txs),
      byCategory: byCat(week2Txs),
    },
    largestExpenses,
    budgets: budgetSummary,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Claude call
// ──────────────────────────────────────────────────────────────────────────
function buildPrompt(summary: Summary, currency: string): string {
  return [
    `You are Pulse, a friendly and concise personal-finance coach.`,
    `Currency for amounts: ${currency}.`,
    ``,
    `Here is the user's spending data for the last 14 days, split into two weeks:`,
    ``,
    `## Week 1 (older — ${summary.week1.start} to ${summary.week1.end})`,
    `Total expense: ${summary.week1.total.toFixed(2)}`,
    `By category: ${formatCatMap(summary.week1.byCategory)}`,
    ``,
    `## Week 2 (newer — ${summary.week2.start} to ${summary.week2.end})`,
    `Total expense: ${summary.week2.total.toFixed(2)}`,
    `By category: ${formatCatMap(summary.week2.byCategory)}`,
    ``,
    `## Largest single expenses (last 14 days)`,
    summary.largestExpenses
      .map(
        (e) =>
          `- ${e.amount.toFixed(2)} on ${e.date} — ${e.categoryName}${
            e.note ? ` (${e.note})` : ""
          }`,
      )
      .join("\n") || "(none)",
    ``,
    `## Active budgets`,
    summary.budgets.length
      ? summary.budgets
          .map(
            (b) =>
              `- ${b.categoryName} (${b.period}): spent ${b.spent.toFixed(2)} of ${b.amount.toFixed(2)} (${
                b.amount > 0 ? Math.round((b.spent / b.amount) * 100) : 0
              }%)`,
          )
          .join("\n")
      : "(none)",
    ``,
    `Generate **3 to 5 short, useful insights** about this user's spending.`,
    `Each insight is one of these types:`,
    `  - "weekly_summary": overall spending vs last week`,
    `  - "anomaly": a single transaction that looks unusual`,
    `  - "tip": actionable advice based on a pattern (e.g. "you're spending 40% on food, average is 25%")`,
    `  - "streak": positive reinforcement (e.g. "3 weeks under your Food budget!")`,
    ``,
    `Rules:`,
    `  - Each "message" must be ≤ 140 characters, in 2nd person ("You").`,
    `  - Be specific. Quote real numbers from the data, not vague trends.`,
    `  - No emojis, no markdown, no preamble.`,
    `  - Prefer mixing types — at most ONE of each per response.`,
    `  - "data" is optional, but include structured numbers when relevant`,
    `    (e.g. {"thisWeek": 18200, "lastWeek": 12400, "deltaPct": 47}).`,
    ``,
    `Respond with a JSON array only — no surrounding text. Schema:`,
    `[`,
    `  {`,
    `    "type": "weekly_summary" | "anomaly" | "tip" | "streak",`,
    `    "message": string,`,
    `    "data": object | null`,
    `  },`,
    `  …`,
    `]`,
  ].join("\n");
}

function formatCatMap(m: Record<string, number>): string {
  const entries = Object.entries(m).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "(none)";
  return entries.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ");
}

async function callClaude(
  summary: Summary,
  currency: string,
): Promise<ClaudeInsight[]> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const prompt = buildPrompt(summary, currency);

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        { role: "user", content: prompt },
        // Prefill the assistant turn with "[" so Claude continues straight
        // into raw JSON without any "Sure, here's…" preamble.
        { role: "assistant", content: "[" },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body}`);
  }

  const payload = await res.json();
  const text: string = payload.content?.[0]?.text ?? "";
  const raw = "[" + text;

  // Best-effort: trim anything after the closing `]`.
  const closeIdx = raw.lastIndexOf("]");
  const jsonText = closeIdx >= 0 ? raw.slice(0, closeIdx + 1) : raw;

  try {
    const parsed = JSON.parse(jsonText) as ClaudeInsight[];
    if (!Array.isArray(parsed)) return [];
    // Cap at 5, validate type.
    return parsed
      .filter(
        (i) =>
          i &&
          typeof i.message === "string" &&
          ["weekly_summary", "anomaly", "tip", "streak"].includes(i.type),
      )
      .slice(0, 5);
  } catch (e) {
    console.error("Claude JSON parse failed", e, jsonText);
    return [];
  }
}

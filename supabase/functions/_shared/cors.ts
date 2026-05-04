/**
 * Shared CORS headers for Edge Functions called from the React Native app.
 * The app sends `Authorization` (Clerk JWT via the Supabase client) and
 * `apikey` (Supabase anon key) on every invocation.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

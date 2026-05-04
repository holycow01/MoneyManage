/**
 * Personal-mode provisioning — ensures the single local user row exists.
 *
 * The migration already inserts `users.id = 'me'`, so this is just a
 * belt-and-braces idempotent insert in case someone wipes the row.
 * Called from the onboarding setup slide.
 */
import { LOCAL_USER_ID, supabase } from "./supabase";

export async function ensureLocalUser(): Promise<void> {
  const { error } = await supabase
    .from("users")
    .upsert(
      { id: LOCAL_USER_ID, email: "me@local" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

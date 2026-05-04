/**
 * Supabase client — personal mode, no auth.
 *
 * RLS is disabled on the personal-mode schema, so the anon key gives
 * full access to your data. Don't share this key publicly.
 */
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/** The single user id used everywhere. Matches the migration's default. */
export const LOCAL_USER_ID = "me";

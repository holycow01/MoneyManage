/**
 * Drizzle client for server-side use only (Supabase Edge Functions, scripts,
 * migrations). Do NOT import this from any file under app/ or components/ —
 * the `postgres` driver requires Node and a direct DATABASE_URL.
 *
 * For client-side reads/writes from the React Native app, use the Supabase
 * client at lib/supabase.ts (it goes through PostgREST + RLS).
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export type DB = typeof db;

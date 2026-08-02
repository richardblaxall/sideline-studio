// Service-role Supabase client for the ingest worker. Bypasses RLS — VPS-only, never shipped
// to the browser. Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the worker's own env.
import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/** Throw with a concise message if a supabase-js call returned an error. */
export function assertOk(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

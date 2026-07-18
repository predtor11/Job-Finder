import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client — bypasses RLS.
 * Server-only. Used for Storage operations from workers/cron where there is no
 * user cookie session (e.g. downloading a resume to attach to an email).
 */
export function createAdminClient() {
  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

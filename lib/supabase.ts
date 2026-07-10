import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Both clients are built lazily (only when actually used) rather than at
// module load. That way the app still boots — and shows a clear "not
// configured" error only from the code path that needed Supabase — even
// before NEXT_PUBLIC_SUPABASE_URL etc. are filled in in .env.local.

let browserClient: SupabaseClient | null = null;

// Public client — safe to use in browser components. Respects Row Level
// Security policies (none are enforced yet since this is a single-user tool).
export function getSupabase(): SupabaseClient {
  if (browserClient) return browserClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. Add them to .env.local (see .env.example)."
    );
  }

  browserClient = createClient(supabaseUrl, supabaseAnonKey);
  return browserClient;
}

let adminClient: SupabaseClient | null = null;

// Admin client — server-only (API routes, cron jobs). Uses the service role
// key which bypasses RLS, so it must NEVER be imported into client components.
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. Add them to .env.local (see .env.example)."
    );
  }

  adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  return adminClient;
}

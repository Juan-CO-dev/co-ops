/**
 * Browser-side Supabase client — Phase 2.
 *
 * Anon client only. Practical use cases are narrow:
 *   - Pages that need a Supabase handle but no RLS-gated data (login screen,
 *     marketing pages).
 *   - Future Realtime channel subscriptions, where the JWT is supplied to
 *     the channel auth flow after a session is established.
 *   - Future tables with explicit anon-readable policies (none today —
 *     every existing RLS policy routes through `current_user_role_level()`,
 *     which anon cannot execute by design; see migration `0029_helpers_revoke_anon`).
 *
 * Authenticated requests are *not* this client's job — those go through
 * the per-request authenticated client in lib/supabase-server.ts.
 *
 * Auth model: our app signs JWTs in lib/auth.ts and sends them on the
 * `Authorization: Bearer <token>` header. Supabase verifies them against
 * the active HS256 signing key (kid `cc9d42e8-…`) configured in the
 * project's JWT keys system. PostgREST exposes the verified payload to RLS
 * via `current_setting('request.jwt.claims', true)` (per migration 0032).
 */

"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }

  cached = createClient(url, anonKey, {
    auth: {
      // We don't use Supabase Auth — sessions are managed by lib/session.ts.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

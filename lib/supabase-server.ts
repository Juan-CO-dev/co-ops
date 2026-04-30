/**
 * Server-side Supabase clients — Phase 2.
 *
 * Two factories:
 *
 *   createAuthedClient(jwt)
 *     Per-request, RLS-enforcing. Sends the caller's JWT on the
 *     `Authorization: Bearer …` header so PostgREST verifies it and engages
 *     RLS via the verified claims. Construct fresh per request — never cache
 *     across requests, never reuse a JWT bound to a different actor.
 *
 *   getServiceRoleClient()
 *     RLS-bypassing. Backed by SUPABASE_SERVICE_ROLE_KEY (the modern
 *     `sb_secret_*` key, sent as the `apikey` header by @supabase/supabase-js).
 *     Restrict use to:
 *       - audit log writes (lib/audit.ts)
 *       - notification deliveries (lib/notifications.ts)
 *       - integration adapters (toast, shifts, sms)
 *       - lockout state mutations + session lifecycle (lib/session.ts)
 *       - prep-list resolution generator
 *       - email verification + password reset token operations
 *
 * SECURITY: never import this module from client code. There is no Next
 * runtime guard here (no `server-only` dep yet); the convention is enforced
 * by review.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set");
  return url;
}

function getAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  return key;
}

function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set (server-side only)");
  return key;
}

/**
 * Build a Supabase client that authenticates as the JWT's subject.
 * The anon key is sent as the `apikey` header (PostgREST baseline auth);
 * the JWT in `Authorization: Bearer …` selects the database role via the
 * `role` claim and exposes the verified payload to RLS.
 */
export function createAuthedClient(jwt: string): SupabaseClient {
  return createClient(getUrl(), getAnonKey(), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

let cachedServiceRole: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (cachedServiceRole) return cachedServiceRole;
  cachedServiceRole = createClient(getUrl(), getServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cachedServiceRole;
}

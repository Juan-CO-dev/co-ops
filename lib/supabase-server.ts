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
 * SECURITY: never import this module from client code. The `server-only`
 * import below makes this a build-time guarantee — any client-component
 * import path fails the build instead of leaking the service-role key
 * into a client bundle. (Was review-enforced convention before 2026-07-23;
 * hardened after two council seats independently flagged the gap.)
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertSimTarget } from "./sim-isolation-shared";

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
  if (process.env.SIM_MODE) assertSimTarget(process.env.NEXT_PUBLIC_SUPABASE_URL);
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
  if (process.env.SIM_MODE) assertSimTarget(process.env.NEXT_PUBLIC_SUPABASE_URL);
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

/**
 * A service-role client whose every request goes through `fetchImpl` (digests round 3, PR 4; CC addendum A4-4).
 * supabase-js awaits its access token before it calls the transport, so a request can pass a deadline check just
 * before a cutoff and reach the network just after it. The digest's labor-money pre-load closes that gap with a
 * `fetch` that re-checks the stage's deadline immediately before the transport.
 *
 * Same key and same auth options as `getServiceRoleClient`. A NEW client per call: never cached, never the shared
 * singleton, so no other code path ever runs through the wrapped transport.
 * ONE caller: lib/report-digests-labor.ts (pinned by an import census).
 */
export function createServiceRoleClientWithFetch(fetchImpl: typeof fetch): SupabaseClient {
  if (process.env.SIM_MODE) assertSimTarget(process.env.NEXT_PUBLIC_SUPABASE_URL);
  return createClient(getUrl(), getServiceRoleKey(), {
    global: { fetch: fetchImpl },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

# Portal-2 — Customer Account Principal + Magic-Link Auth (allowlist-gated) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a real, separate **customer** auth principal for the catering portal — a passwordless magic-link sign-in / account-create flow keyed on email — without ever letting a customer token satisfy a staff check (or vice-versa), and gated so email only delivers to an allowlist until Resend DNS is verified.

**Architecture:** A customer is a `catering_customers` contact (never a `users` row). A NEW second principal rides its own `co_ops_portal` cookie → own JWT (`customer_id`/`email` claim) → new `catering_portal_sessions` row, validated by a `requireCustomerSession` that mirrors staff `requireSessionCore` (dual JWT + `token_hash` verification, revoked/expiry checks). Magic-link tokens live in a new `catering_portal_tokens` table (email-keyed, since the account may not exist yet). Enforcement is **app-layer + service-role** (consistent with every existing catering lib); a `current_customer_id()` RLS helper + deny-all-to-anon policies are defense-in-depth. Reuses `lib/auth.ts` `generateToken()`/`hashToken()` verbatim; everything else is new (staff `signJwt` is hardcoded to `role:'authenticated'` + `AppJwtClaims`, and `email_verifications`/`sessions` are `user_id NOT NULL`).

**Tech Stack:** Next.js 16 (App Router, Node runtime routes), TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres (service-role client + RLS), `jose` (HS256 JWT), Resend (allowlist-gated), migrations via Supabase MCP `apply_migration` + captured as `supabase/migrations/NNNN_*.sql`.

---

## Decisions (defaults chosen; ⭐ = worth Juan's explicit nod)

- **D1 ⭐ Pull the in-DB rate-limit substrate into Portal-2.** The spec parks the throttle in Portal-3, but magic-link requests need throttling *now* (link-spam / enumeration). Ship `catering_portal_rate_limits` here; Portal-3 reuses it for submission. **Recommended: yes.**
- **D2 Customer JWT is app-layer-primary.** Reads/writes go through the service-role client with app-layer "this customer owns this row" checks (identical to every catering lib today). `current_customer_id()` is created and the portal tables get deny-all-to-anon RLS as defense-in-depth; the JWT is not relied on as a live PostgREST token in v1. Keeps the two principals cleanly separated (staff JWT has `user_id`, no `customer_id`; customer JWT the reverse — each fails the other's helper closed).
- **D3 Customer session = 30 days, no idle timeout; magic-link token = 30 min, single-use.** Consumer UX (staff is 12h + 10-min idle by contrast). Cookie `co_ops_portal`, httpOnly/secure/sameSite=lax.
- **D4 Allowlist via `PORTAL_MAGIC_LINK_ALLOWLIST`** (comma-sep emails; defaults to `juan@complimentsonlysubs.com`). Non-allowlisted recipients get the same constant-shape success response but no email is sent (belt-and-suspenders with Resend's own default-sender restriction). The portal **cannot go live to customers until Resend DNS is verified** — the build doesn't wait; the launch does.
- **D5 ⭐ Rename `catering_companies.claimed_by_user_id` → `claimed_by_customer_id` now** (the spec's "fix owed" — the claimer is a customer, not a staff user), FK → `catering_customers(id)`. It's a live column `lib/catering/companies.ts` reads, so the lib + type update ship in the same task. **Recommended: yes.**
- **Out of scope (later PRs):** order submission + Stripe deposit session + confirmation emails (Portal-3); account home / past orders (Portal-4); Stripe balance/net-terms + pg_cron sweeps (Portal-5).

---

## File Structure

**Migrations (new, captured as files):**
- `supabase/migrations/0124_catering_company_claimed_by_customer.sql` — rename + re-FK the claimer column.
- `supabase/migrations/0125_catering_portal_auth.sql` — `catering_portal_tokens`, `catering_portal_sessions`, `catering_portal_rate_limits`, `catering_customers.email_verified_at` + `last_portal_login_at`, `current_customer_id()` helper, RLS (deny-all to anon/authenticated), `REVOKE EXECUTE ... FROM anon, PUBLIC` on the helper.

**Lib (new):**
- `lib/portal/auth.ts` — customer JWT sign/verify (own claims), `generateCustomerToken`/`hashToken` re-export, cookie constants.
- `lib/portal/session.ts` — `createCustomerSession`, `requireCustomerSession` (route + server-component variants), `revokeCustomerSession`, cookie helpers. Mirrors `lib/session.ts`.
- `lib/portal/magic-link.ts` — `requestMagicLink({email, name, ip, origin})` (rate-limit + allowlist + token + send), `consumeMagicLink({token, ip})` (validate → resolve-or-create customer → create session), `resolveOrCreatePortalCustomer(email, name?)` (un-gated core, reuses `companies.ts` domain-attribution helpers).
- `lib/portal/rate-limit.ts` — `checkAndRecord(key, windowSeconds, max)` over `catering_portal_rate_limits`.
- `lib/email-templates/magic-link.ts` — the magic-link email (typography-only header, per the established email pattern).

**Routes (new, public):**
- `app/api/portal/magic-link/request/route.ts` — POST `{email, name?, website?(honeypot)}` → constant-shape `{ok:true}`.
- `app/api/portal/magic-link/verify/route.ts` — POST `{token}` → consume → set `co_ops_portal` cookie → `{ok:true, next}`.

**UI (wire the existing mockups to the real backend):**
- `app/order/verify/page.tsx` — the magic-link landing page (client; POSTs the token on mount, then redirects). NEW.
- `app/order/start/page.tsx` — swap the mock "Continue (preview)" for a real POST to the request route; the "check your email" copy reflects real (allowlist-gated) sending. MODIFY.

**Modify:**
- `proxy.ts` — add `/api/portal/*` to `PUBLIC_PATHS` + matcher (customer routes self-check; they are not staff-JWT-gated).
- `lib/catering/companies.ts` — `claimed_by_user_id` → `claimed_by_customer_id` (row type, `CateringCompany.claimedByCustomerId`, `mapCompany`, `COMPANY_COLS`); export the attribution helpers already used (`extractDomain`, `normalizeEmail`, `resolveCompanyForEmail`, `isPersonalDomain`) for reuse.
- `lib/types.ts` — add `CateringPortalSession`, `CateringPortalCustomer` shapes if the codebase centralizes types (else colocate in `lib/portal/*`).
- `.env.local.example` — document `PORTAL_MAGIC_LINK_ALLOWLIST`.

**Verification style (repo idiom):** this codebase has no Jest suite — verification is `npm run build` green + `tsc` + targeted Supabase MCP DB probes + a scripted smoke against a running dev server (mirrors `scripts/phase-2-audit-harness.ts`). Each task ends with the concrete check + a commit.

---

## Task 1: Rename the company claimer column (D5)

**Files:**
- Create: `supabase/migrations/0124_catering_company_claimed_by_customer.sql`
- Modify: `lib/catering/companies.ts`

- [ ] **Step 1: Apply the migration via Supabase MCP** (`apply_migration`, name `0124_catering_company_claimed_by_customer`):

```sql
-- Migration 0124_catering_company_claimed_by_customer
-- The catering portal's account claimer is a CUSTOMER (catering_customers), not a staff user.
-- Rename the placeholder column PR-1 shipped and re-point the FK.
ALTER TABLE catering_companies RENAME COLUMN claimed_by_user_id TO claimed_by_customer_id;
-- No prior FK existed (PR-1 left it unconstrained, claim-ready). Add the correct one now.
ALTER TABLE catering_companies
  ADD CONSTRAINT catering_companies_claimed_by_customer_fkey
  FOREIGN KEY (claimed_by_customer_id) REFERENCES catering_customers(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Capture the migration file** with the going-forward header (per AGENTS.md convention) — same SQL, prefixed:

```sql
-- Migration 0124_catering_company_claimed_by_customer
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: lib/catering/companies.ts (claimedByCustomerId) + Portal-2 plan.
```

- [ ] **Step 3: Update `lib/catering/companies.ts`** — rename every reference:
  - `COMPANY_COLS`: `claimed_by_user_id` → `claimed_by_customer_id`.
  - `interface DbCompanyRow`: `claimed_by_user_id` → `claimed_by_customer_id`.
  - `interface CateringCompany`: `claimedByUserId` → `claimedByCustomerId`.
  - `mapCompany`: `claimedByUserId: r.claimed_by_user_id` → `claimedByCustomerId: r.claimed_by_customer_id`.

- [ ] **Step 4: Grep for stragglers** (the shared-type-consumer discipline):

Run: `rg "claimed_by_user_id|claimedByUserId" lib app components`
Expected: no matches (all renamed).

- [ ] **Step 5: Verify build + column shape.**

Run: `npm run build` → Expected: compiles clean.
Supabase probe: `select column_name from information_schema.columns where table_name='catering_companies' and column_name like 'claimed%';` → Expected: `claimed_by_customer_id`, `claimed_at`.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0124_catering_company_claimed_by_customer.sql lib/catering/companies.ts
git commit -m "feat(portal): rename catering_companies.claimed_by_user_id -> claimed_by_customer_id (0124)"
```

---

## Task 2: Portal auth schema (tables + helper + RLS)

**Files:**
- Create: `supabase/migrations/0125_catering_portal_auth.sql`

- [ ] **Step 1: Apply the migration** (`apply_migration`, name `0125_catering_portal_auth`):

```sql
-- Magic-link tokens — EMAIL-keyed (the account may not exist yet at request time).
CREATE TABLE catering_portal_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,                         -- normalized (trim+lower)
  token_hash   text NOT NULL,                         -- sha256(rawToken)
  name         text,                                  -- optional, carried from intake
  purpose      text NOT NULL DEFAULT 'magic_link' CHECK (purpose IN ('magic_link')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  ip_address   text
);
CREATE INDEX catering_portal_tokens_hash ON catering_portal_tokens (token_hash);
CREATE INDEX catering_portal_tokens_email ON catering_portal_tokens (lower(email));

-- Customer sessions — the second principal's session store.
CREATE TABLE catering_portal_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES catering_customers(id) ON DELETE CASCADE,
  token_hash        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  ip_address        text,
  user_agent        text
);
CREATE INDEX catering_portal_sessions_customer ON catering_portal_sessions (customer_id);

-- In-DB rate limiter (D1) — keyed on ip+email+window bucket. Reused by Portal-3 submission.
CREATE TABLE catering_portal_rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key    text NOT NULL,                         -- e.g. 'magic_link:<ip>:<email>'
  window_start  timestamptz NOT NULL,
  count         int NOT NULL DEFAULT 1,
  UNIQUE (bucket_key, window_start)
);

-- Portal-account state on the contact.
ALTER TABLE catering_customers ADD COLUMN email_verified_at   timestamptz;
ALTER TABLE catering_customers ADD COLUMN last_portal_login_at timestamptz;

-- current_customer_id() — the second-principal RLS helper (defense-in-depth; mirrors
-- current_user_id()). SECURITY DEFINER + locked search_path; revoke from anon AND public.
CREATE OR REPLACE FUNCTION current_customer_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'customer_id', '')::uuid
$$;
REVOKE EXECUTE ON FUNCTION current_customer_id() FROM anon;
REVOKE EXECUTE ON FUNCTION current_customer_id() FROM public;

-- RLS: deny-all to end-user roles (service-role bypasses; app-layer authz is the gate).
ALTER TABLE catering_portal_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE catering_portal_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE catering_portal_rate_limits ENABLE ROW LEVEL SECURITY;
-- No permissive policies => no anon/authenticated access at all; service-role bypasses RLS.
```

- [ ] **Step 2: Capture the migration file** with the going-forward header + a one-line purpose comment block.

- [ ] **Step 3: Verify** via Supabase probe:
  - `select table_name from information_schema.tables where table_name like 'catering_portal%';` → 3 rows.
  - `select proname from pg_proc where proname='current_customer_id';` → 1 row.
  - `select has_function_privilege('anon','current_customer_id()','execute');` → `f`.
  - `select relrowsecurity from pg_class where relname='catering_portal_tokens';` → `t`.

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/0125_catering_portal_auth.sql
git commit -m "feat(portal): customer portal auth schema — tokens/sessions/rate-limits + current_customer_id (0125)"
```

---

## Task 3: Customer JWT primitives (`lib/portal/auth.ts`)

**Files:**
- Create: `lib/portal/auth.ts`

- [ ] **Step 1: Write it.** Own claims shape; reuses the staff HS256 key + `generateToken`/`hashToken`. `role:'authenticated'` is included ONLY so the token is a well-formed PostgREST JWT if ever passed; the discriminator is the `customer_id` claim (staff tokens never carry it).

```ts
import { SignJWT, jwtVerify } from "jose";
export { generateToken, hashToken } from "@/lib/auth";

const JWT_ALG = "HS256";
const JWT_ISSUER = "co-ops-portal";
const JWT_EXP = "30d";
export const PORTAL_COOKIE_NAME = "co_ops_portal";

function getJwtKey(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET is not set");
  return Buffer.from(secret, "hex"); // hex-decoded to match Supabase's HS256 key bytes
}

export interface CustomerJwtClaims {
  customer_id: string;
  email: string;
  session_id: string;
  role: "authenticated";
}
export interface VerifiedCustomerJwt extends CustomerJwtClaims { iat: number; exp: number; iss: string }

export async function signCustomerJwt(claims: CustomerJwtClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: JWT_ALG }).setIssuedAt().setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXP).sign(getJwtKey());
}
export async function verifyCustomerJwt(token: string): Promise<VerifiedCustomerJwt> {
  const { payload } = await jwtVerify(token, getJwtKey(), { issuer: JWT_ISSUER, algorithms: [JWT_ALG] });
  if (!payload.customer_id) throw new Error("not a customer token"); // hard reject staff tokens
  return payload as unknown as VerifiedCustomerJwt;
}
```

- [ ] **Step 2: Verify** — `npm run build` compiles.
- [ ] **Step 3: Commit** (`feat(portal): customer JWT primitives`).

---

## Task 4: Customer session lifecycle (`lib/portal/session.ts`)

**Files:**
- Create: `lib/portal/session.ts`

Mirrors `lib/session.ts` `createSession` + `requireSessionCore` (dual JWT + `token_hash` verify, revoked/expiry, `last_activity_at` touch) with customer deltas: `co_ops_portal` cookie, 30-day expiry, **no idle timeout**, no step-up.

- [ ] **Step 1: Write it.**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { signCustomerJwt, verifyCustomerJwt, hashToken, PORTAL_COOKIE_NAME, type CustomerJwtClaims } from "./auth";

const SESSION_DAYS = 30;

export interface PortalContext { customerId: string; email: string; sessionId: string }

function cookieOpts(maxAgeSeconds: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}

export async function createCustomerSession(customerId: string, email: string, ctx?: { ip?: string | null; ua?: string | null }) {
  const sb = getServiceRoleClient();
  const sessionId = crypto.randomUUID();
  const jwt = await signCustomerJwt({ customer_id: customerId, email, session_id: sessionId, role: "authenticated" } satisfies CustomerJwtClaims);
  const tokenHash = await hashToken(jwt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400 * 1000);
  const { error } = await sb.from("catering_portal_sessions").insert({
    id: sessionId, customer_id: customerId, token_hash: tokenHash,
    last_activity_at: now.toISOString(), expires_at: expiresAt.toISOString(),
    ip_address: ctx?.ip ?? null, user_agent: ctx?.ua ?? null,
  });
  if (error) throw new Error(`createCustomerSession: ${error.message}`);
  await sb.from("catering_customers").update({ last_portal_login_at: now.toISOString() }).eq("id", customerId);
  return { sessionId, jwt, cookieName: PORTAL_COOKIE_NAME, cookieMaxAgeSeconds: SESSION_DAYS * 86400 };
}

async function requireCore(rawJwt: string | null): Promise<PortalContext | { denied: true }> {
  if (!rawJwt) return { denied: true };
  let claims; try { claims = await verifyCustomerJwt(rawJwt); } catch { return { denied: true }; }
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb.from("catering_portal_sessions").select("*").eq("id", claims.session_id).maybeSingle<{ id: string; customer_id: string; token_hash: string; expires_at: string; revoked_at: string | null }>();
  if (error || !row) return { denied: true };
  if ((await hashToken(rawJwt)) !== row.token_hash) return { denied: true }; // forgery guard
  if (row.revoked_at) return { denied: true };
  if (new Date(row.expires_at) <= new Date()) return { denied: true };
  await sb.from("catering_portal_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", row.id);
  return { customerId: row.customer_id, email: claims.email, sessionId: row.id };
}

export async function requireCustomerSession(req: NextRequest): Promise<PortalContext | NextResponse> {
  const raw = req.cookies.get(PORTAL_COOKIE_NAME)?.value ?? null;
  const r = await requireCore(raw);
  if ("denied" in r) { const res = NextResponse.json({ error: "unauthorized" }, { status: 401 }); res.cookies.set(PORTAL_COOKIE_NAME, "", cookieOpts(0)); return res; }
  return r;
}
export async function getCustomerFromHeaders(): Promise<PortalContext | null> {
  const raw = (await nextCookies()).get(PORTAL_COOKIE_NAME)?.value ?? null;
  const r = await requireCore(raw);
  return "denied" in r ? null : r;
}
export async function revokeCustomerSession(sessionId: string) {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("catering_portal_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", sessionId).is("revoked_at", null).select("id");
  if (error) throw new Error(`revokeCustomerSession: ${error.message}`);
  return { rowsAffected: data?.length ?? 0 };
}
export function applyPortalCookie(res: NextResponse, s: { cookieName: string; jwt: string; cookieMaxAgeSeconds: number }) {
  res.cookies.set(s.cookieName, s.jwt, cookieOpts(s.cookieMaxAgeSeconds)); return res;
}
export function clearPortalCookie(res: NextResponse) { res.cookies.set(PORTAL_COOKIE_NAME, "", cookieOpts(0)); return res; }
async function _ipHeaders() { const h = await nextHeaders(); return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), ua: h.get("user-agent") }; }
export { _ipHeaders };
```

- [ ] **Step 2: Verify** — `npm run build` compiles.
- [ ] **Step 3: Commit** (`feat(portal): customer session lifecycle`).

---

## Task 5: Rate limiter (`lib/portal/rate-limit.ts`)

**Files:**
- Create: `lib/portal/rate-limit.ts`

- [ ] **Step 1: Write it** — fixed-window counter over `catering_portal_rate_limits` (service-role; UPSERT on `(bucket_key, window_start)`).

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";

/** Returns true when the action is ALLOWED (under the cap), false when throttled. */
export async function checkAndRecord(bucketKey: string, windowSeconds: number, max: number): Promise<boolean> {
  const sb = getServiceRoleClient();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  // Insert-or-increment the current window bucket.
  const { data: existing } = await sb.from("catering_portal_rate_limits").select("id, count").eq("bucket_key", bucketKey).eq("window_start", windowStart).maybeSingle<{ id: string; count: number }>();
  if (!existing) {
    const { error } = await sb.from("catering_portal_rate_limits").insert({ bucket_key: bucketKey, window_start: windowStart, count: 1 });
    if (error && error.code === "23505") return checkAndRecord(bucketKey, windowSeconds, max); // raced — retry read path
    return true;
  }
  if (existing.count >= max) return false;
  await sb.from("catering_portal_rate_limits").update({ count: existing.count + 1 }).eq("id", existing.id);
  return true;
}
```

- [ ] **Step 2: Verify** — `npm run build`.
- [ ] **Step 3: Commit** (`feat(portal): in-DB fixed-window rate limiter`).

---

## Task 6: Magic-link core (`lib/portal/magic-link.ts`)

**Files:**
- Create: `lib/portal/magic-link.ts`
- Create: `lib/email-templates/magic-link.ts`

- [ ] **Step 1: Write the email template** (`lib/email-templates/magic-link.ts`) — typography-only header (Gmail blocks localhost images; established pattern), one Diet-Coke-fill CTA button, the signed link `${NEXT_PUBLIC_APP_URL}/order/verify?token=${rawToken}`. Mirror the structure of `lib/email-templates/verification.ts`.

- [ ] **Step 2: Write `magic-link.ts`.** `resolveOrCreatePortalCustomer` reuses the `companies.ts` attribution helpers (no staff actor); `requestMagicLink` is rate-limited + allowlist-gated + constant-shape; `consumeMagicLink` validates + single-uses the token, resolves-or-creates the customer, stamps `email_verified_at`, and creates the session.

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { generateToken, hashToken } from "./auth";
import { createCustomerSession } from "./session";
import { checkAndRecord } from "./rate-limit";
import { extractDomain, normalizeEmail, resolveCompanyForEmail } from "@/lib/catering/companies";
import { sendEmail } from "@/lib/email";
import { renderMagicLinkEmail } from "@/lib/email-templates/magic-link";
import { audit } from "@/lib/audit";

const TOKEN_TTL_MIN = 30;

function allowlisted(email: string): boolean {
  const raw = process.env.PORTAL_MAGIC_LINK_ALLOWLIST ?? "juan@complimentsonlysubs.com";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

/** Constant-shape: always resolves. Internal disposition is audited only (enumeration defense). */
export async function requestMagicLink(input: { email: string; name?: string | null; ip?: string | null }): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email || extractDomain(email) === null) return; // silently no-op on garbage (still constant-shape upstream)
  // Rate limit: max 5 requests / 15 min per (ip,email).
  const ok = await checkAndRecord(`magic_link:${input.ip ?? "noip"}:${email}`, 15 * 60, 5);
  if (!ok) { void audit({ actorId: null, actorRole: null, action: "portal.magic_link_throttled", resourceTable: "catering_portal_tokens", resourceId: email, metadata: { ip: input.ip }, ipAddress: input.ip ?? null, userAgent: null }); return; }
  const sb = getServiceRoleClient();
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000).toISOString();
  const { error } = await sb.from("catering_portal_tokens").insert({ email, token_hash: tokenHash, name: input.name?.trim() || null, expires_at: expiresAt, ip_address: input.ip ?? null });
  if (error) { void audit({ actorId: null, actorRole: null, action: "portal.magic_link_insert_failed", resourceTable: "catering_portal_tokens", resourceId: email, metadata: { error: error.message }, ipAddress: input.ip ?? null, userAgent: null }); return; }
  if (allowlisted(email)) {
    const link = `${process.env.NEXT_PUBLIC_APP_URL}/order/verify?token=${rawToken}`;
    await sendEmail({ to: email, subject: "Your Compliments Only sign-in link", html: renderMagicLinkEmail({ link }) });
  }
  void audit({ actorId: null, actorRole: null, action: "portal.magic_link_requested", resourceTable: "catering_portal_tokens", resourceId: email, metadata: { allowlisted: allowlisted(email) }, ipAddress: input.ip ?? null, userAgent: null });
}

export interface ConsumeResult { ok: boolean; session?: Awaited<ReturnType<typeof createCustomerSession>> }

export async function consumeMagicLink(input: { token: string; ip?: string | null; ua?: string | null }): Promise<ConsumeResult> {
  const sb = getServiceRoleClient();
  const tokenHash = await hashToken(input.token);
  // Atomic single-use: flip consumed_at only if still null + unexpired.
  const { data: rows, error } = await sb.from("catering_portal_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token_hash", tokenHash).is("consumed_at", null).gt("expires_at", new Date().toISOString())
    .select("id, email, name");
  if (error || !rows || rows.length === 0) return { ok: false };
  const tok = rows[0]!;
  const customerId = await resolveOrCreatePortalCustomer(tok.email, tok.name);
  await sb.from("catering_customers").update({ email_verified_at: new Date().toISOString() }).eq("id", customerId).is("email_verified_at", null);
  const session = await createCustomerSession(customerId, tok.email, { ip: input.ip, ua: input.ua });
  void audit({ actorId: null, actorRole: null, action: "portal.magic_link_consumed", resourceTable: "catering_customers", resourceId: customerId, metadata: {}, ipAddress: input.ip ?? null, userAgent: input.ua ?? null });
  return { ok: true, session };
}

/** Un-gated resolve-or-create keyed on lower(email); auto-attributes corporate domains. */
export async function resolveOrCreatePortalCustomer(emailRaw: string, name?: string | null): Promise<string> {
  const email = normalizeEmail(emailRaw);
  const sb = getServiceRoleClient();
  const { data: existing } = await sb.from("catering_customers").select("id").eq("active", true).ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle<{ id: string }>();
  if (existing) return existing.id;
  const companyId = await resolveCompanyForEmail(email);
  const { data: inserted, error } = await sb.from("catering_customers").insert({ name: name?.trim() || email, email, company_id: companyId, active: true, created_by: null }).select("id").single<{ id: string }>();
  if (error) {
    if (error.code === "23505") { const { data: raced } = await sb.from("catering_customers").select("id").eq("active", true).ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle<{ id: string }>(); if (raced) return raced.id; }
    throw new Error(`resolveOrCreatePortalCustomer: ${error.message}`);
  }
  void audit({ actorId: null, actorRole: null, action: "catering.customer.create", resourceTable: "catering_customers", resourceId: inserted.id, metadata: { via: "portal_magic_link", email, auto_company_id: companyId }, ipAddress: null, userAgent: null });
  return inserted.id;
}
```

- [ ] **Step 3: Verify** — `npm run build`. Confirm `sendEmail` signature matches `lib/email.ts` (adjust the call if the wrapper differs); confirm `audit` accepts a null `actorId` (it does — see the session_token_mismatch precedent).
- [ ] **Step 4: Commit** (`feat(portal): magic-link request/consume + portal customer resolve-or-create`).

---

## Task 7: Public routes (`request` + `verify`)

**Files:**
- Create: `app/api/portal/magic-link/request/route.ts`
- Create: `app/api/portal/magic-link/verify/route.ts`
- Modify: `proxy.ts`

- [ ] **Step 1: `request/route.ts`** — POST, honeypot + Origin check, constant-shape 200:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/portal/magic-link";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body.website === "string" && body.website.length > 0) return NextResponse.json({ ok: true }); // honeypot: pretend success
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  if (typeof body.email === "string") await requestMagicLink({ email: body.email, name: typeof body.name === "string" ? body.name : null, ip });
  return NextResponse.json({ ok: true }); // constant shape regardless of internal disposition
}
```

- [ ] **Step 2: `verify/route.ts`** — POST, consumes token, sets cookie:

```ts
import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink } from "@/lib/portal/magic-link";
import { applyPortalCookie } from "@/lib/portal/session";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body.token !== "string") return NextResponse.json({ ok: false }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  const result = await consumeMagicLink({ token: body.token, ip, ua: req.headers.get("user-agent") });
  if (!result.ok || !result.session) return NextResponse.json({ ok: false }, { status: 400 });
  const res = NextResponse.json({ ok: true, next: "/order/build" });
  return applyPortalCookie(res, result.session);
}
```

- [ ] **Step 3: `proxy.ts`** — add the portal API surface to public:
  - In `PUBLIC_PATHS`, add `"/api/portal/magic-link/request"` and `"/api/portal/magic-link/verify"`.
  - In `isPublicPath`, add `if (pathname.startsWith("/api/portal/")) return true;`.
  - In the matcher regex alternation, add `api/portal/.*` alongside the existing `order(?:/.*)?$` (use non-capturing groups; Next 16 rejects capturing groups).

- [ ] **Step 4: Verify** — `npm run build`; boot `next dev` and confirm no matcher parse error (the integration-smoke-needs-a-real-dev-server lesson).
- [ ] **Step 5: Commit** (`feat(portal): magic-link request/verify routes + public proxy paths`).

---

## Task 8: Wire the UI (verify landing + real request)

**Files:**
- Create: `app/order/verify/page.tsx`
- Modify: `app/order/start/page.tsx`

- [ ] **Step 1: `app/order/verify/page.tsx`** — client page; reads `?token=` from `window.location` in `useEffect` (avoids the `useSearchParams` prerender-Suspense constraint), POSTs it to the verify route on mount, then `router.push(next)` on success or shows a "link expired — request a new one" state. (JS-on-mount avoids email-scanner prefetch consuming the token.)

- [ ] **Step 2: `app/order/start/page.tsx`** — replace the mock `setSent(true)` path: on submit, POST `{ email, name }` (+ persist details to sessionStorage as today) to `/api/portal/magic-link/request`; keep the "check your email" screen but drop "(preview)" and the mock "Continue" button — the real link arrives by email (allowlist-gated). Keep the returning/new toggle.

- [ ] **Step 3: Verify** — `npm run build`; all `/order/*` routes still prerender.
- [ ] **Step 4: Commit** (`feat(portal): verify landing page + real magic-link request wiring`).

---

## Task 9: End-to-end smoke + env docs

**Files:**
- Create: `scripts/portal-2-smoke.ts` (mirrors `scripts/phase-2-audit-harness.ts` shape)
- Modify: `.env.local.example`

- [ ] **Step 1:** Add `PORTAL_MAGIC_LINK_ALLOWLIST=juan@complimentsonlysubs.com` to `.env.local.example` with a comment (comma-sep; gates real delivery until Resend DNS).

- [ ] **Step 2: Write `scripts/portal-2-smoke.ts`** — against a running dev server + service-role DB: (a) POST request for an allowlisted email → 200 `{ok:true}`; read `catering_portal_tokens` for the row; (b) reuse the raw token (grab from DB in the smoke since email isn't asserted) → POST verify → assert `{ok:true}` + a `co_ops_portal` cookie is set + a `catering_portal_sessions` row + a `catering_customers` row with `email_verified_at`; (c) replay the same token → `{ok:false}` (single-use); (d) expired token → `{ok:false}`; (e) 6th request in the window → still `{ok:true}` shape but a `portal.magic_link_throttled` audit row exists; (f) a staff `co_ops_session` JWT does NOT satisfy `verifyCustomerJwt` and a customer JWT does NOT satisfy staff `verifyJwt`. Clean up fixtures (deactivate, per append-only).

- [ ] **Step 3: Run the smoke** against `next dev` → all pass.
- [ ] **Step 4: Commit** (`test(portal): Portal-2 magic-link smoke + env docs`).

---

## Task 10: Juan smoke + PR

- [ ] **Step 1:** Push the branch; open a PR to `main`; wait for the `build` check to explicitly read **pass** (not just `--watch` exit); verify `gh pr view --json state` before any branch cleanup (the #133 near-miss lesson).
- [ ] **Step 2: Juan live smoke** (allowlisted = his email): `/order` → Start your order → enter his email → receives the real magic-link email → clicks → `/order/verify` signs him in → lands in `/order/build`. Confirm a second request rate-limits after 5; confirm a wrong/old token shows the expired state.
- [ ] **Step 3:** Merge (squash), delete branch via `gh api -X DELETE` **after** confirming MERGED, sync `main`. Capture to memory + CHIEF: Portal-2 shipped; NEXT = Portal-3.

---

## Self-Review

- **Spec coverage:** customer principal ✓ (T3–T4), magic-link ✓ (T6–T8), account-create-on-verify ✓ (T6 `resolveOrCreatePortalCustomer`), `claimed_by_customer_id` fix ✓ (T1), `current_customer_id()` RLS ✓ (T2), public routes ✓ (T7), in-DB throttle ✓ (T2/T5, pulled early per D1), honeypot + Origin/CSRF ✓ (T7), allowlist-gating ✓ (T6/D4). Server-side price authority + order submission are Portal-3 (out of scope, correctly).
- **Type consistency:** `PORTAL_COOKIE_NAME`, `CustomerJwtClaims`, `PortalContext`, `createCustomerSession` return shape, `checkAndRecord`, `resolveOrCreatePortalCustomer` used consistently across T3–T9.
- **Placeholder scan:** load-bearing code (migrations, JWT, session core, magic-link, routes) is complete; email-template HTML + the smoke body are described against a named mirror file (`verification.ts`, `phase-2-audit-harness.ts`) rather than re-pasted — acceptable since those are direct-analog boilerplate, but the executor should open the mirror.
- **Adaptation note:** this codebase has no unit-test suite; "tests" here = `npm run build` + Supabase DB probes + a dev-server smoke script, matching the repo's actual verification idiom rather than the skill's default TDD-per-task.

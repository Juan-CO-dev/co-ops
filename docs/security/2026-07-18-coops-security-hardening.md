# CO-OPS Security Hardening Pass — Scope, Threat Model & Findings Register

**Started:** 2026-07-18 · **Base:** main `3dab9fa` (3a-core merged) · **Owner:** Juan · **Auditor:** CC (sole reviewer)

Extensive adversarial security pass. Goal: **catering can't be messed with** (competitors tampering
with orders, payment injection, order abuse, enumeration, spam) **and co-ops in general** (IDOR,
cross-tenant, privilege-escalation, RLS, silent-at-scale money/integrity bugs).

**Method (Juan-locked):** two waves — **Wave A = internet-exposed surface first**, then **Wave B =
staff/admin core**. **Parallel opus audits by dimension** (read-only; audits parallelize, fixes
serialize). **Catalog all findings → severity-triage with Juan → batched fix PRs** (auth-critical
held for Juan's smoke). Every finding scored against the 20-class recurring-bug catalog
(`feedback_recurring_bug_classes`).

## Attack surface (who can reach what)

- **Internet-exposed (anon / competitor / customer principal)** — the proxy leaves these un-gated;
  each route does its own checks. `/api/portal/*` (magic-link request/verify; `order/draft/{lines,
  preview,submit,[quoteId]}`; `order/submit`; `quote/[id]/pay`), `/api/auth/*` (pin, password,
  verify, password-reset(-request), step-up, logout), `/api/locations`, `/api/users/login-options`,
  `/order/*` pages.
- **Staff-authed (proxy JWT + `requireSession`)** — ~90 routes: checklist, opening, prep, cash,
  `admin/*` (users, vendors, checklist-templates, skus, items, recipes, menu-items), operations
  (receiving/production), ai, toast, sms, notifications, photos.

## Existing security foundation (what the audit stress-tests, doesn't assume)

D20 server price authority · magic-link single-use + allowlist · in-DB fixed-window rate-limits ·
RLS append-only + `_no_user_delete` + SECURITY DEFINER helpers (anon-revoked) · filter-injection
UUID guards on `.or()` · dual-verification sessions (JWT signature/exp + `token_hash`) · two-tier
step-up (Tier A/B) · `canActOn` (admin can't act on peer/senior) · constant-shape enumeration
defense · session-revoke on credential/authz change.

## Severity scale

- **Critical** — remote/anon exploit that tampers with another party's order/money/account, or full
  auth bypass / privilege escalation. Fix before launch, no exceptions.
- **High** — exploitable by an authenticated principal (customer or low staff) to reach data/actions
  outside their authority; or a DoS/abuse vector with real impact.
- **Medium** — defense-in-depth gap, info disclosure, or an exploit needing an unlikely precondition.
- **Low** — hardening nicety; hygiene.
- **Info** — observation / non-issue confirmed / future-proofing note.

## Per-finding schema

`id` (e.g. `A1-03`) · `severity` · `title` · `location (file:line)` · `bug-class` (from the catalog,
or NEW) · `exploit sketch` (how an attacker actually uses it) · `proposed fix` · `auditor confidence`.

---

## Wave A — internet-exposed (catering portal + public auth)

- **A1 — Order-artifact integrity.** D20 price authority (can a client inject/override a price, or
  smuggle a price through refs?); ownership on EVERY draft op (customer B reads/edits/submits
  customer A's draft — `loadDraft`/`setDraftLines`/`previewDraft`/`submitDraft` + the `[quoteId]`
  GET); status guards (edit a `submitted` order, double-submit race, resubmit); intake-on-token
  abuse (crafted `locationId`, negative/huge headcount, spurious lead/quote rows, cross-customer
  draft via a swapped token); napkins/tip manipulation; the mutable-draft → versioned invariant.
- **A2 — Payment-intent integrity (pre-provider).** `catering_payments` seam: deposit-amount
  tampering, `markPaymentPaid` reachability from a customer principal, spurious/duplicate/replayed
  intents, `initiatePayment` payment-plan authority (wrong kind/amount), ownership on pay routes.
- **A3 — Auth / session / magic-link.** Single-use atomicity + replay, token TTL, session
  dual-verification, allowlist gate, cookie flags (httpOnly/secure/sameSite), session
  fixation/hijack, the create-only-post-verify property, logout idempotency, password-reset
  session-revoke.
- **A4 — Enumeration / abuse / spam / DoS.** Constant-shape responses (magic-link request/verify),
  rate-limit COVERAGE on every abusable endpoint (draft-create, line-edits, preview, submit,
  magic-link, login-options, locations, auth), honeypot, `login-options`/`locations` enumeration,
  error-message leakage, CSRF/origin checks on portal POSTs, unbounded input (huge carts / huge
  intake payloads → resource exhaustion), IP-spoof of rate-limit keys.
- **A5 — Injection / input validation (portal).** `.or()` filter-injection (UUID guards), SQL
  (parameterization), the intake `jsonb` store→read round-trip, **XSS in customer-supplied fields**
  (contact name, notes, event name, dietary notes — rendered on the staff pipeline board + in
  emails), email-header/template injection, path/param injection in `[quoteId]`, mass-assignment on
  the draft/intake payloads.

## Wave B — staff/admin core (co-ops in general)

- **B1 — Tenancy / IDOR / location-scoping.** Cross-location read/write across the ~90 staff routes
  (`lockLocationContext`/`readScopeOr`/`canSeeLocation` coverage — any route loading a record by id
  without a scope check = bind-record IDOR); the polymorphic photo FK; the notifications/views
  ownership.
- **B2 — Privilege escalation / role gates.** The 3-layer gate discipline (lib + RLS + UI),
  `canActOn` (admin can't act on peer/senior), step-up (Tier A/B) coverage on every
  destructive/admin action, self-signoff prevention, JWT claim staleness (session-revoke on
  role/location/deactivation), the PostgREST reserved `role` claim.
- **B3 — RLS integrity.** `FOR ALL` permitting DELETE, append-only `_no_user_delete` outliers,
  SECURITY DEFINER + locked `search_path`, silent UPDATE-denial (rowCount checks), helper-function
  anon revocation, the app-layer column boundaries (forecast_notes, vendors trivial/full,
  notification fields, users self-update).
- **B4 — Input validation / injection (staff).** Write-target validation (audit-backlog Tier 2:
  unvalidated write-targets), `.or()` filter-injection across staff loaders, SQL, mass-assignment,
  the **AI route** (`/api/ai` — prompt injection / output handling), toast/sms/notifications routes,
  the SMS queue processor.
- **B5 — Silent-at-scale + money/integrity.** The audit-backlog **Tier 1** (1000-row truncation in
  cost/production/readiness loaders that corrupt money/readiness as data grows), integer-cents +
  server-side SUM discipline, cash-deposit money model, audit-log completeness, RPC↔table
  column-shape mismatches.

---

## Findings register

> Populated as audits complete. Merged + deduped by CC; severity is CC's call, ranked for Juan's
> triage. `status`: `open` → `triaged` → `fixed` (PR#) → `verified` / `wontfix (rationale)`.

### Wave A findings
_(pending — audits in flight)_

### Wave B findings
_(pending — Wave A triage first)_

---

## Triage & fix log
_(populated after Juan triages each wave)_

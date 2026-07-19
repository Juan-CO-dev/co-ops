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

### Wave A findings (5 dimension audits complete 2026-07-18; CC-synthesized + deduped)

**Convergence note:** the top items were independently flagged by multiple auditors (e.g. `tipBps` by
A1/A2/A5; missing throttles by A4/A2) — high confidence. Confirmed-safe items at the bottom show the
existing foundation (D20 unit-price authority, ownership/IDOR, create-post-verify, session dual-verify,
constant-shape enumeration, filter-injection guards, mass-assignment whitelists, no
`dangerouslySetInnerHTML`) all held under adversarial reading. **No Critical found.**

#### HIGH (fix before launch)

**A-H1 — Unbounded/unvalidated `tipBps` violates the money invariant + corrupts the charge stack** · status: open
- *Location:* `app/api/portal/order/draft/{lines,preview,submit}/route.ts` (`tipBps: typeof body.tipBps === "number" ? body.tipBps : undefined`); `lib/portal/draft.ts:122` (`ratesWithTip`); `lib/catering/quotes.ts:96` (`bpsOf`, no clamp). *(merges A1-01, A2-01, A2-02, A5-03 — 4 auditors)*
- *Bug-class:* price-authority-bypass / input-validation. *Confidence:* high.
- *Exploit:* the customer body's `tipBps` reaches `gratuityBps` with NO app-layer clamp (the STAFF path clamps `0..10000` via `normalizeBps`; the customer path does not). `NaN`/`Infinity` are `typeof "number"` so they pass and propagate `NaN` through `bpsOf → total → deposit`. Negative / >10000 / NaN are currently **backstopped by the `catering_quotes` gratuity_bps `0..10000` CHECK** (so no money is stolen *today*), BUT: (a) the app depends on a column CHECK for a money invariant — exactly what hardening should remove; (b) the violation surfaces as an ungraceful **500** (generic `Error`, not `PortalDraftError`); (c) in `setDraftLines` it fires AFTER the line delete+insert → partial-write (see A-M3); (d) it directly poisons the amount a future provider will collect.
- *Fix:* validate `tipBps` at the route/`ratesWithTip` boundary — `Number.isFinite && Number.isInteger && 0 ≤ tipBps ≤ MAX_TIP_BPS` (UI only offers 0/15/18/20% → cap ~5000), else 400; and `Math.max(0, …)` the total/gratuity in `computeChargeStack` as defense-in-depth.

**A-H2 — Stored XSS in emails via unescaped customer `name`** · status: open
- *Location:* `lib/email-templates/order-confirmation.ts:35` (+ call `lib/portal/draft.ts:494,498`); `lib/catering/quotes.ts:913` (staff `sendQuote` inline HTML). An unused `escapeHtml` sits in `lib/email-templates/_layout.ts:64`. *(merges A5-01, A5-02)*
- *Bug-class:* stored-XSS (email). *Confidence:* high.
- *Exploit:* customer-controlled `name` (magic-link request → `catering_portal_tokens.name` → `catering_customers.name`) is interpolated **unescaped** into email HTML on the order-confirmation and staff-sent-quote paths. A registration name like `<img src=x onerror=…>` renders as live HTML in the recipient's mail client; persisted, so it also lands on any future staff surface/BCC/preview that HTML-renders `name`.
- *Fix:* `escapeHtml()` every customer-supplied interpolation before it enters email HTML (reuse the existing `_layout.ts` helper); ideally have the layout escape structured fields so callers can't forget.

**A-H3 — No rate limit on the draft + pay routes** · status: open
- *Location:* `app/api/portal/order/draft/{lines,preview,submit}/route.ts`, `app/api/portal/quote/[id]/pay/route.ts` — none call `checkAndRecord` (only the legacy `order/submit` + `magic-link/request` are throttled). *(merges A4-01, A2-04)*
- *Bug-class:* missing-rate-limit. *Confidence:* high.
- *Exploit:* one valid customer (30-day session, no idle timeout) can hammer these DB-heavy endpoints unbounded — `setDraftLines` does delete+insert+update + full menu reload per call; `initiatePayment` creates duplicate `due` rows (A-M6).
- *Fix:* `checkAndRecord` per `customerId` on each (`draft_lines:`, `draft_preview:`, `draft_submit:`, `pay:`), mirroring `order_submit:${customerId}`.

**A-H4 — Unbounded input (cart line count / body size / intake strings / quantity) → DoS + bloat** · status: open
- *Location:* `lib/portal/draft.ts:321` (`resolveLines`, no `lines.length` cap; quantity only `>0`+finite), `app/api/portal/order/draft/lines/route.ts` + `order/submit/route.ts` (`body.lines.map`, no length check); `app/api/portal/magic-link/request/route.ts:18` (`parseIntake` — no string-length caps); no JSON body-size limit anywhere (`next.config.ts`). *(merges A4-02, A4-03, A4-04, A1-04)*
- *Bug-class:* unbounded-input-DoS. *Confidence:* high.
- *Exploit:* a 100k-element `lines` array forces a 100k-row insert on one draft per request; multi-MB intake jsonb is stored verbatim on the (anon-reachable, never-swept) token table; no body-size ceiling means large JSON is buffered to memory before validation; fractional/huge `quantity` (1e12) overflows the `integer` cents column → 500 + partial write.
- *Fix:* cap `lines.length` (≤~200), require integer `quantity` with a sane max, cap each intake string length in `parseIntake`, and enforce a request body-size ceiling in a shared portal helper.

**A-H5 — CSRF guard is skipped when the `Origin` header is absent (cross-site order/payment tampering)** · status: open
- *Location:* every portal mutating route: `if (origin) { …host check… }` — `app/api/portal/order/draft/{lines,submit,preview}/route.ts`, `order/submit/route.ts`, `quote/[id]/pay/route.ts`, `magic-link/request/route.ts`. *(A3-01)*
- *Bug-class:* CSRF / conditional-guard-bypass. *Confidence:* high.
- *Exploit:* the origin/host check runs ONLY when `Origin` is present; the `co_ops_portal` cookie is `sameSite=lax`. A cross-site request crafted to omit `Origin` reaches the handler with the customer's cookie and `origin===null` → guard skipped → an attacker page can mutate/submit a signed-in customer's order + trigger the deposit intent. `sameSite=lax` is a heuristic, not a sufficient sole control for money/order mutations — and this is exactly Juan's "competitors tampering with orders" threat. *(CC ranked High given the threat model; auditor said Medium.)*
- *Fix:* treat missing/empty `Origin` as a rejection on state-changing POSTs, and/or add a `Sec-Fetch-Site` check (reject `cross-site`/`none`), and/or require a custom `X-Portal-Request` header.

#### MEDIUM

**A-M1 — In-DB rate-limiter under-counts under concurrency (read-then-increment)** · status: open · *(A4-06)*
- `lib/portal/rate-limit.ts:17-35` — non-atomic SELECT→check→UPDATE; N concurrent requests all read the same count and pass. **Highest-leverage fix — hardens EVERY `checkAndRecord` caller at once.** Fix: single atomic `INSERT … ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = count+1 RETURNING count`, deny when `> max`.

**A-M2 — `x-forwarded-for` is client-controlled → per-source throttle + audit IP spoofable** · status: open · *(A3-09, A4-05)*
- IP taken from the leftmost `x-forwarded-for` token across portal + auth routes. The per-VICTIM email key is IP-independent (holds), but the per-SOURCE key + audit `ip_address` are spoofable. Fix: derive IP from the platform-trusted source (Vercel `x-vercel-forwarded-for` / connecting IP).

**A-M3 — `setDraftLines` delete→insert→update is non-transactional (items vs snapshot can disagree)** · status: open · *(A1-02)*
- `lib/portal/draft.ts:388-401` — three separate writes, no transaction. A failing stack UPDATE leaves new line items with the OLD money snapshot; a brief window shows 0 lines. Fix: one atomic RPC (delete+insert+update), matching the `submit_*_atomic` pattern.

**A-M4 — Double-submit race duplicates the napkins line on a now-immutable quote** · status: open · *(A1-03)*
- `lib/portal/draft.ts:456-484` — napkins is inserted BEFORE the atomic status flip; two concurrent submits both insert napkins, one wins the flip → a submitted (immutable) quote with 2 napkins lines vs a snapshot that counted one. Deposit money authority (snapshot) holds. Fix: insert napkins only after winning the `WHERE status='draft'` flip, or fold the whole submit into one atomic RPC.

**A-M5 — Staff auth family un-throttled + `password-reset-request` mail-bomb** · status: open · *(A4-07, A4-08)*
- `app/api/auth/{pin,password,password-reset-request,verify}/route.ts` — no per-source throttle (only per-account lockout on sign-in). `password-reset-request` inserts a token + sends a Resend email per call with no cap → mail-bomb any known staff email + unbounded `password_resets` growth. Documented Phase-2 deferral, BUT the DB-backed `checkAndRecord` is now available (no KV needed). Fix: `checkAndRecord` on reset-request (per-email) + a coarse per-source cap on sign-in.

**A-M6 — Duplicate `due` payment intents (no unique constraint + SELECT-then-INSERT race)** · status: open · *(A2-03)*
- `lib/portal/quotes.ts:246-266` + `lib/catering/payments.ts:157` — no `UNIQUE(quote_id, kind) WHERE status='due'`; concurrent `/pay` taps create N `due` rows → double-charge hazard for a future provider. Fix: partial unique index + `ON CONFLICT DO NOTHING`.

**A-M7 — No email-format validation before store/send** · status: open · *(A5-04)*
- `lib/portal/magic-link.ts` / `lib/catering/companies.ts` — only trim+lowercase+`@.` check; a newline/control-char address passes and is stored (delivery fails closed via Resend JSON API + allowlist, so bounded). Fix: strict single-line email regex before storage/send.

#### LOW

- **A-L1** — `locationId` validated only as UUID+FK, not as a catering-enabled/customer-facing location (`lib/portal/draft.ts:190`, `orders.ts:143`). *(A1-05)* Fix: allowlist catering-enabled locations.
- **A-L2** — `catering_portal_tokens.token_hash` is a plain index, not UNIQUE; consume does `rows[0]!` (`migration 0125:22`, `magic-link.ts:78`). *(A3-02)* Fix: UNIQUE (or `rows.length===1` assert). Not practically exploitable (256-bit tokens).
- **A-L3** — raw magic-link token travels in the URL → referer/history leak within the 30-min TTL (`app/order/verify/page.tsx`). *(A3-03)* Fix: `history.replaceState` to strip the token + `Referrer-Policy: no-referrer` on the verify route.
- **A-L4** — `login-options` + `locations` give an anon the full staff roster by location+role+user_id (documented tradeoff, re-flagged; aids PIN-brute + social-eng). *(A4-09)* Fix (if revisited): gate behind a location-code + throttle.
- **A-L5** — unbounded growth / no sweep: `catering_portal_rate_limits`, `catering_portal_tokens`, abandoned `draft`/`inquiry` artifacts. *(A4-10, A4-11)* Fix: pg_cron janitor.

#### INFO / confirmed-safe (the foundation holds) + deferred

- **Confirmed defended:** D20 unit/package/portion price authority (A1-06); ownership re-checked on every draft/pay op vs the SESSION customerId, no IDOR (A1-07, A2-07); create-only-post-verify, no unverified/competitor rows, customer_id always the session's (A1-08, A3-07); cross-principal separation — distinct issuer + `customer_id` hard-reject + omitted `role` claim + per-principal `token_hash` forgery guard (A3-05); customer session dual-verify + fresh session_id (no fixation) + correct cookie flags (A3-06); allowlist constant-shape mint (A3-04); staff auth crypto / atomic lockout / constant-shape reset+verify (A3-08); constant-shape enumeration on request/verify/reset (A4-12); `.or()` filter-injection UUID-guarded at every portal site (A5-05); mass-assignment blocked by field-by-field whitelists with server-owned customer_id/prices (A5-06); jsonb intake re-validated on read, no prototype-pollution sink (A5-07); no `dangerouslySetInnerHTML` anywhere, React auto-escaping on the staff board + quote view (A5-08).
- **Deferred to Portal-5 (payment provider):** webhook must verify signature + match amount/currency + idempotency on `provider_ref` + never expose a customer-reachable "mark paid"; `markPaymentPaid` is customer-unreachable today (A2-05, A2-06).

**Wave A counts (CC-consolidated):** Critical 0 · High 5 · Medium 7 · Low 5 · Info/confirmed ~14 + Portal-5 deferral.

### Wave B findings (5 dimension audits complete 2026-07-19; CC-synthesized + live-DB-verified)

**Headline:** one **Critical** (anon-executable SECURITY DEFINER RPCs → forged writes) — **already
hotfixed on prod (migration 0132)**. A cluster of **High** silent-at-scale truncation in the reporting +
readiness layer (correctness/integrity that corrupts money/readiness as data grows). Tenancy/IDOR
(WB1) and privilege-escalation (WB2) came back essentially clean — `canActOn`, `revokeAllUserSessions`
on every authz change, the reserved `role` claim, bind-record location scoping, and (verified live) NO
`cmd='ALL'` RLS policies + locked/anon-revoked helpers all held.

#### CRITICAL — FIXED (migration 0132, applied to prod)

**WB3-01 — Anon-executable SECURITY DEFINER atomic RPCs → unauthenticated forged operational + audit writes** · status: **FIXED (0132)**
- *Location:* live functions `submit_am_prep_atomic`, `submit_mid_day_phase1_atomic`,
  `save_mid_day_phase2_item_atomic` (migrations 0043/0060/0061) — had `has_function_privilege('anon',…)=true`.
- *Bug-class:* anon-execute + secdef-privilege-escalation (the AGENTS.md default-ACL gotcha, un-applied here).
- *Exploit:* all three are `SECURITY DEFINER` (bypass RLS) and take `p_actor_id` as a caller-supplied
  param validated only at the route layer. PostgREST exposes `public` RPCs to any caller with the
  **public anon key** (in the browser bundle). An unauthenticated attacker `POST`s `/rest/v1/rpc/
  submit_am_prep_atomic` with an arbitrary `p_actor_id` + payload → forges `checklist_completions` /
  `checklist_submissions` attributed to any user, flips instance status, supersedes real completions,
  writes forged `audit_log` rows — corrupting append-only history + audit provenance with no credential.
  *Proven by asymmetry:* the newer siblings (`submit_opening_atomic` etc.) were correctly service-role-only.
- *Fix (applied):* **migration 0132** `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on all three
  (+ WB3-02). CC-verified post-condition: anon/authenticated EXECUTE = false, service_role = true.

#### HIGH — silent-at-scale truncation (reporting + readiness/recipe)

**WB5-01 — `loadTrendSeries` reads 4 growth tables unpaginated → every trend metric drifts low at scale** · status: open
- `lib/reports-trends.ts:193/219/241/306` — no `.range()`/`selectAllRows`; relies on the implicit 1000-row
  cap. `checklist_completions` is **already 4,177 rows**; a wide trend window truncates → completion %,
  under/over-par, temp-flag, cash metrics all silently understate. The tell: `lib/reports-search.ts`
  correctly paginates the SAME tables. Fix: wrap all four in `selectAllRows` + stable order.

**WB5-02 — `listReports` + `computeReportSignals` + detail loaders unpaginated → reports vanish + signals understated** · status: open
- `lib/reports-hub.ts` (`:97, :186, :1127, :1135, :376, :383, :565, :574, :856`) — same family, second loader
  over the same tables; a wide window drops reports off the hub list + understates badges. Fix: paginate.

**WB5-03 — `loadGraphRows` (readiness) unpaginated → readiness badges wrong once the inventory spine is authored** · status: open (LATENT)
- `lib/admin/readiness-load.ts:79-86` (recipes/inputs/outputs/items). Dormant today (tiny tables) but arms
  when the deliberately-deferred spine is authored — a dropped edge → a not-ready item silently badges
  "ready" (soft-gate says go-live-safe when it isn't). Sibling loaders in the SAME file are already
  paginated. Fix: `selectAllRows` on all four.

**WB5-04 — `recipes.ts` graph-walk loaders unpaginated → cycle-guard + one-active-producer WRITE-guard bypass at scale** · status: open (LATENT)
- `lib/recipes.ts:266-267/73/81/164`. `loadItemRecipeGraph` loads the full `recipe_outputs`+`recipe_inputs`
  to build the cycle-detection graph; >1000 edges → the guard operates on a truncated graph and can ADMIT
  a cycle it exists to prevent. `activeProducerExists` (the one-active-producer write-guard) can miss a
  duplicate past row 1000. Enforcement gap, not just display. Fix: paginate the graph reads.

#### MEDIUM

- **WB3-02 — `portal_rate_limit_hit` was anon-executable** (my B2 migration 0131 — `REVOKE FROM anon`
  didn't strip the PUBLIC grant) → an anon could inflate any rate-limit bucket to DoS a victim's legit
  action. **FIXED in 0132** (same REVOKE). status: **FIXED**.
- **WB3-03 — `opening_setup_verifications` SELECT policy is `USING (true)`** → any authenticated user (even
  level 0–3) reads every location's setup verifications (cross-location info disclosure); its own INSERT
  policy correctly scopes by role+location. Fix: replace with the sibling role-floor + location-scope pattern. status: open
- **WB4-01 — admin user-search free-text into a `.or()` filter** (`lib/admin/users.ts:103-105`) — `?q=` is
  interpolated into `name.ilike.%q%,email.ilike.%q%` with no `escapeLike`. The ONLY un-guarded free-text
  filter site. Admin-gated (level 8, Owner/CGS who already see all users) → no priv gain today, but a
  landmine if copied to a lower-privileged search + breaks the "only filter what you can see" invariant.
  Fix: `escapeLike`/strip metacharacters, or two parameterized `.ilike()` unioned in-memory. status: open
- **WB5-05 — `loadSkus` (`lib/admin/skus.ts:252`) unpaginated** → feeds the readiness SKU universe; a SKU
  past row 1000 is absent from readiness (un-badged, excluded from the gate). Latent. Fix: paginate. status: open
- **WB5-06 — `team-metrics.ts computePersonMetrics`** leaves the finalization/PM/audit reads unpaginated
  (`:359/389/398/419/425/435`) while its heavy reads ARE paginated → a high-activity manager's oversight
  score can understate. Reporting-only. Fix: paginate for consistency. status: open

#### LOW

- **WB2-01** — Tier-A step-up is "unlock once, act many" for `createUser` + `updateUserProfile`; promote
  both to Tier B (fresh ≤120s) to match the other user-lifecycle mutations. (`app/api/admin/users/route.ts:40`, `[id]/route.ts:27`)
- **WB2-02** — `ctx.locations` is read from the stale JWT (role/level are read live); a level-8 MoO with a
  just-narrowed location set keeps old-location assign rights until revoke/exp (revoke-on-location-change
  already closes it next mutation). Fix: derive locations live in `requireSessionCore`.
- **WB4-02** — `invoiceTotal` (`lib/receiving.ts:108`) written with no numeric validation (display field,
  not in cost math). Fix: validate like the line prices.
- **WB3-04** — `catering_rate_rules` + `catering_portal_rate_limits` lack an explicit `FOR DELETE
  USING(false)` (no permissive DELETE exists today, so default-denied; risk is a future `FOR ALL`). Fix:
  add the deny to match the 0106 pattern (prioritize `catering_rate_rules` — it has an authoring UI).

#### INFO / confirmed-safe (the co-ops core holds)

- **WB1 Tenancy/IDOR — uniformly defended:** every load-by-id path re-checks the record's `location_id`
  via `lockLocationContext` before acting; `location_id`-in-body is validated against the actor's scope;
  RLS is a correct backstop where reads use the authed client; `/api/pm-report` validates the target
  against the location roster. 0 findings. (Doc-drift: `ALL_LOCATIONS_THRESHOLD=9`, not 7 — code + RLS
  agree at 9, so no split-brain; AGENTS.md/memory say 7 and are stale.)
- **WB2 Privilege escalation — solid:** `canActOn` strict-greater (no self-promote / act-on-peer-senior /
  promote-to-≥-self); `revokeAllUserSessions` confirmed on reset-pin/set-password/role-change(both
  directions)/set-locations/deactivate; role gates server-side + live (never the `x-co-role-level`
  header); step-up session-scoped; reserved `role` claim = `authenticated`; self-update touches only
  language/profile_blurb.
- **WB3 RLS:** **zero `cmd='ALL'` permissive policies** (the FOR-ALL→DELETE footgun is fully eliminated
  live); the 3 `current_user_*` helpers + catering helpers + newer atomic RPCs all have locked
  `search_path` + anon revoked; append-only coverage complete except WB3-04; column boundaries hold.
- **WB4:** no mass-assignment (every admin write is field-by-field allowlisted); all other `.or()` sites
  guarded; `.rpc()` all parameterized; staff-quote client-price is by-design (level-6+, stack still
  server-computed). **AI / toast / sms-queue / notifications are 501 stubs** — no live surface, but when
  built MUST level-gate + rate-limit `/api/ai` + scope its context, and guard `/api/sms/process-queue` +
  `/api/toast` with a cron/internal secret.
- **WB5:** RPC↔`audit_log` column shape CLEAN (no 42703 drift); money math CLEAN (integer cents
  end-to-end, server-authoritative sums, `bpsOf` floors negatives, no float drift).

**Wave B counts (CC-consolidated):** Critical 1 (FIXED) · High 4 · Medium 5 (1 FIXED) · Low 4 · Info/confirmed extensive.

---

## Triage & fix log

**Triage (Juan, 2026-07-19):** fix all High + all Medium now, batched; Lows triaged separately;
auth-critical batch held for Juan's login+order smoke before merge.

**Batch B1 — money/correctness + email (no login impact) — FIXED (this PR):**
- **A-H1** `tipBps` — validated to an integer `0..MAX_TIP_BPS(5000)` at the `ratesWithTip` chokepoint
  (throws 400 `invalid_tip`); routes coerce with `Number.isFinite` (NaN/Infinity → undefined);
  `bpsOf` floors non-finite/negative rates to 0 (DiD). No longer depends on the DB CHECK.
- **A-H2** email XSS — exported `escapeHtml` from `_layout.ts`; applied to `name` (+ eventDateLabel)
  in the order-confirmation email and to `cust.name` in `sendQuote`.
- **A-H4** unbounded input — `MAX_CART_LINES(200)` (lib + route fast-reject), integer `quantity`
  `1..MAX_LINE_QTY(100000)`, `parseIntake` string caps (200/500/2000) + `headcount` `0..100000`.
- **A-M3** `setDraftLines` — ordering guarantee documented: all validation (resolveLines / ratesWithTip
  / resolveDeliveryFee) throws BEFORE the delete, so a bad payload can't leave a stale snapshot. Full
  delete+insert+update RPC atomicity DEFERRED (residual = sub-ms concurrent-self-read window only).
- **A-M4** double-submit napkins — `submitDraft` now folds napkins into the snapshot up front but only
  inserts the line + creates the payment AFTER winning the atomic `status='draft'` flip.
- **A-M6** duplicate `due` intents — migration **0130** partial unique index
  `catering_payments_one_due (quote_id, kind) WHERE status='due'` (applied to prod) + `createPaymentDue`
  idempotent on 23505.
- **A-M7** email format — strict single-line `EMAIL_RE` in `requestMagicLink` (blocks
  whitespace/control-char/header-injection values before store/send).
- Verified: build + typecheck + lint green; `scripts/3a-smoke.ts` extended with B1 guard assertions
  (bad tip / fractional qty / over-cap cart rejected, draft untouched) — PASS, zero residue.

**Batch B2 — rate-limiting + IP + CSRF (AUTH-CRITICAL — HELD for Juan's login+order smoke):**
- **A-M1** atomic limiter — migration **0131** `portal_rate_limit_hit` RPC (INSERT…ON CONFLICT DO
  UPDATE…RETURNING, serialized on the unique index; applied to prod + self-tested allow/allow/deny);
  `checkAndRecord` delegates to it, fail-open on RPC error. Hardens EVERY throttle at once.
- **A-H3** throttle the previously-unthrottled routes — `draft/lines` + `draft/preview` (60/60s),
  `draft/submit` + `quote/[id]/pay` (10/300s), per `customerId` → 429 when exceeded.
- **A-M2** trusted client IP — new `lib/client-ip.ts trustedClientIp` (prefers Vercel's
  `x-vercel-forwarded-for` / `x-real-ip`, then the RIGHTMOST XFF hop — never the spoofable leftmost);
  `extractIp` (all auth routes) + the portal magic-link routes now use it.
- **A-M5** reset mail-bomb — `password-reset-request` throttled 3/15min per email (constant-shape
  preserved, audited `throttled`). Deliberately NO per-source cap on PIN/password sign-in (a whole
  location shares one IP → would false-lock legit staff; per-account lockout is the brake there).
- **A-H5** CSRF fail-closed — new `lib/portal/csrf.ts assertSameOrigin` rejects missing/cross-site
  `Origin` (+ `Sec-Fetch-Site: cross-site`) on ALL 7 portal mutating routes (was: skipped when Origin
  absent). `sameSite=lax` is no longer the sole control for order/payment mutations.
- Verified: migration applied + RPC self-tested; build + typecheck + lint green; 3a-smoke PASS zero
  residue. **HELD for Juan's smoke** (login + a full customer order on the preview URL) before merge.

**Lows:** L2 (`token_hash` UNIQUE) + L3 (strip token from URL) recommended for fix; L1 + L5 deferred
(multi-location / Portal-5); L4 accepted (documented tile-flow tradeoff) — _awaiting Juan's pick._

---

**Wave B triage (Juan, 2026-07-19):** Critical hotfixed immediately (0132, merged #143). Fix the 4 High
truncation now (batched), then the Mediums; Lows listed for Juan's pick.

**Wave B Batch 1 — silent-at-scale truncation (4 High) — FIXED (this PR):**
- **WB5-01** `lib/reports-trends.ts` `loadTrendSeries` — 4 growth-table reads wrapped in `selectAllRows`
  (checklist_instances/template_items/completions/cash_reports), stable `id` order.
- **WB5-02** `lib/reports-hub.ts` — `listReports` + `computeReportSignals` + the checklist/opening/pm
  detail loaders (8 reads) paginated; the `loadPmDetail` `<L4 own-eval-only` security filter preserved
  inside the paginated callback (CC-verified).
- **WB5-03** `lib/admin/readiness-load.ts` `loadGraphRows` — all 4 recipe-graph reads paginated.
- **WB5-04** `lib/recipes.ts` — `loadItemRecipeGraph` / `recipeIdsWithInputs` / `outputNamesByRecipe` /
  `activeProducerExists` graph reads paginated (closes the cycle-guard + one-active-producer write-guard
  bypass at scale).
- Verified: build + typecheck green; all 9 ordered tables have an `id` PK (runtime-safe); **runtime proof
  on real data** — `selectAllRows` returns all **4,177** `checklist_completions` rows (not the 1000 cap),
  no dupes across pages. No login impact → CI-mergeable.

**Wave B Batch 2 — Mediums — FIXED (this PR):**
- **WB3-03** — migration **0133** scopes `opening_setup_verifications` SELECT from `USING(true)` →
  `current_user_role_level() >= 4` (matches the sibling verification table). Applied to prod +
  verified; regression-free (no app code reads the table via the RLS-enforced authed client — all
  access is service-role RPCs).
- **WB4-01** — `listUsers` search term stripped of `.or()`-structural chars (`,()"\`) before
  interpolation (`lib/admin/users.ts`) → filter-injection closed.
- **WB5-05** — `lib/admin/skus.ts loadSkus` paginated (`selectAllRows`).
- **WB5-06** — `lib/team-metrics.ts computePersonMetrics` (8 reads) paginated + the sibling
  `loadTeamOperatingHealth` cash/pm/audit reads (3 more) folded in for consistency; the `evals`
  own-eval-only security filter preserved. Verified: build + typecheck green.

**Wave B Lows (WB2-01 step-up tiering, WB2-02 live locations, WB4-02 invoiceTotal, WB3-04 delete-deny):** _awaiting Juan's pick._

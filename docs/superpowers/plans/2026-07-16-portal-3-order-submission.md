# Portal-3 — Customer Order Submission Engine (payment-seam, data-dormant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated portal customer (the Portal-2 principal) submit their built catering order — creating a real, server-priced pipeline lead + quote staff can review/confirm, a confirmation email, and a "deposit due" record — with the payment step behind a **provider-agnostic seam** (no Stripe/Toast assumption) so payments wire in later. Built correct against the real menu/pricing schema; **dormant in prod until the menu/pricing data lands** (Juan's upcoming integrated wiring pass), and proven now via a seeded-data smoke.

**Architecture:** Mirrors the staff `createLead`/`createQuote` paths but for the customer principal (un-gated by staff `AuthContext`; keyed on `customer_id` from `requireCustomerSession`). **Strict server-side price authority (D20):** the client submits item/package references + quantities; the server resolves each line's price from the real `items.menu_price` / `catering_packages.price_cents` (never trusts a client price) and runs the existing pure `computeChargeStack`. Submission is one coherent flow: resolve+price → insert pipeline lead (`source='portal'`) + a `'submitted'` quote (charge-stack snapshot) + quote items + a `catering_payments` deposit-`due` row → allowlist-gated confirmation email → audit. Payment is a separate, provider-agnostic table with a state a future provider (or a staff "mark paid" action) advances.

**Tech Stack:** Next.js 16 (Node routes), TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS), the Portal-2 customer principal (`lib/portal/session.ts`), the 1E charge-stack engine (`lib/catering/quotes.ts` `computeChargeStack`), Portal-2's rate limiter + email pattern.

---

## UNIFIED quote/order model (Juan, 2026-07-16)

One artifact (`catering_quotes`), two entry points that converge on ONE customer review+pay surface reached by magic-link sign-in; the **payment plan splits by `origin`**:

- **`origin='self_serve'`** (customer-built): total = full price; **deposit REQUIRED** → wait for team confirmation → pay the balance. No lead-time branch.
- **`origin='staff'`** (staff-built custom quote): total = full price; if `event_date` is **>1 week out** → deposit OPTIONAL (deposit to lock, or pay full); if **≤1 week out (or no date)** → **full only**. **Net-30/60** for company accounts = future.

`paymentPlan(quote)` is the single pure function encoding this; the shared surface renders the right pay options from it. Payment itself is a **stub** behind the provider-agnostic seam (payment provider deferred — Stripe/Toast/other TBD).

## Decisions

- **D1 Artifact = quote.** Both entry points produce a `catering_quotes` row (charge stack + line items). Self-serve also creates a `catering_pipeline` lead (`stage='inquiry'`, `lead_source='portal'`); a staff quote already lives on its lead. New quote fields: status `'submitted'` (self-serve, extend the CHECK) + `origin` (`self_serve`|`staff`).
- **D2 Strict server-side price authority (D20)** for self-serve: client sends `{ itemId|packageId, quantity }`; server looks up the real price. With 0 menu rows today the self-serve engine is correctly **dormant** (unresolvable cart rejected); the seeded smoke proves it. (Staff quotes keep the existing 1E builder, which already prices server-side incl. free-text lines.)
- **D3 Payment seam = provider-agnostic `catering_payments`** (`kind='deposit'|'balance'|'full'`, `amount_cents`, `status='due'|'paid'|'refunded'|'void'`, nullable `provider`/`provider_ref`). The customer pay action + a staff **"mark paid"** stub advance it; a real provider webhook replaces the stub. NOT the full D19 settlement ledger (evolves with real money).
- **D4 Shared customer surface** `/order/quote/[id]` (authed via Portal-2) — renders a quote the signed-in customer owns (`customer_id = current customer`) in the order-review format + the `paymentPlan` options + a stubbed pay. Serves self-serve AND staff-sent quotes.
- **D5 Staff-send wiring:** the existing `sendQuote` (1E) email links to `/order/quote/[id]`; the customer signs in (magic-link) to view+pay. The customer principal can load a quote where `customer_id` = them.
- **D6 Confirmation email** allowlist-gated (reuses Portal-2's allowlist + `sendEmail`).
- **D7 Throttle** reuses Portal-2's `catering_portal_rate_limits` on submit + pay.
- **Out of scope (fast follow / wiring pass / data):** the staff quote-BUILDER reskin to look like the cart; the functional self-serve builder UI wired to the real menu (mockup stays the preview until menu data); catering-price-derivation + Toast push; the real payment provider; the full settlement ledger; Net-30/60.

---

## File Structure

**Migration (new):**
- `supabase/migrations/0127_catering_portal_orders.sql` — extend `catering_quotes_status_check` to add `'submitted'`; create `catering_payments` (provider-agnostic seam) with deny-all-to-end-users RLS.

**Lib (new):**
- `lib/portal/menu.ts` — un-gated customer-facing loaders: `loadPublicCateringMenu()` (à-la-carte items), `loadPublicCateringPackages(locationId)`, `loadPublicPricingContext(locationId)`. Mirror `lib/catering/menu.ts` + `quotes.ts loadPricingContext` minus the staff `requireLevel`/`canSeeLocation`.
- `lib/portal/orders.ts` — `submitOrder(customerId, input)` (the engine) + `SubmitOrderInput` type.
- `lib/catering/payments.ts` — `createDepositDue(...)`, `markDepositPaid(actor, paymentId)` (staff, level-gated), `loadPaymentsForQuote`.
- `lib/email-templates/order-confirmation.ts` — the confirmation email (`renderOrderConfirmationEmail({...}): string`).

**Routes (new):**
- `app/api/portal/order/submit/route.ts` — POST, `requireCustomerSession`, Origin check → `submitOrder`.
- `app/api/catering/payments/[id]/mark-paid/route.ts` — POST, staff `requireSession` + level gate → `markDepositPaid` (the seam-advance stub).

**Verification:** `scripts/portal-3-smoke.ts` (seeds a pricing rule + a catering-available item + a customer, drives submit against a real dev server, asserts lead/quote/items/payment/email, cleans up).

**Modify:** none of the staff pipeline/quote boards strictly need changes (a `'submitted'` quote + `source='portal'` lead render on the existing boards); a follow-up may add a "portal / submitted" badge — noted, not required for this PR.

**Verification idiom:** `npm run build` + Supabase probes + a seeded dev-server smoke (no unit-test suite in this repo).

---

## Task 1: Schema — `'submitted'` status + `catering_payments` seam

**Files:** Create `supabase/migrations/0127_catering_portal_orders.sql`

- [ ] **Step 1: Apply via Supabase MCP** (`apply_migration`, `0127_catering_portal_orders`):

```sql
-- Customer-submitted quotes need a status the staff-authored vocabulary lacks.
ALTER TABLE catering_quotes DROP CONSTRAINT catering_quotes_status_check;
ALTER TABLE catering_quotes ADD CONSTRAINT catering_quotes_status_check
  CHECK (status = ANY (ARRAY['draft','sent','accepted','declined','expired','submitted']));

-- origin drives the payment plan: self_serve = deposit-required; staff = full (deposit
-- optional only if >1wk out). Existing rows are staff-built → default 'staff'.
ALTER TABLE catering_quotes ADD COLUMN origin text NOT NULL DEFAULT 'staff'
  CHECK (origin IN ('self_serve','staff'));

-- Provider-agnostic payment seam. One row per intent; a future provider (or a staff
-- mark-paid action) advances status. NOT the full settlement ledger (that evolves when
-- real money flows) — this is the wire-in point.
CREATE TABLE catering_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      uuid NOT NULL REFERENCES catering_quotes(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES catering_customers(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('deposit','balance','full')),
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  currency      text NOT NULL DEFAULT 'usd',
  status        text NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid','refunded','void')),
  provider      text,                 -- null until a provider is wired (stripe/toast/…)
  provider_ref  text,                 -- external session/charge id
  created_at    timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz,
  created_by    uuid                  -- customer_id for portal-created, user id for staff actions
);
CREATE INDEX catering_payments_quote ON catering_payments (quote_id);
ALTER TABLE catering_payments ENABLE ROW LEVEL SECURITY; -- deny-all to end-users; service-role only
```

- [ ] **Step 2:** Capture the migration file (going-forward header per AGENTS.md) + verify: `status` CHECK includes `submitted`; `catering_payments` exists with RLS on; a `'submitted'` test insert succeeds and an invalid status still fails.
- [ ] **Step 3: Commit** (`feat(portal): 0127 — submitted quote status + catering_payments seam`).

---

## Task 2: Public menu/pricing loaders (`lib/portal/menu.ts`)

**Files:** Create `lib/portal/menu.ts`

- [ ] **Step 1:** Implement un-gated (no staff `AuthContext`) mirrors of `lib/catering/menu.ts` + `quotes.ts loadPricingContext`, taking `locationId` directly:
  - `loadPublicCateringMenu(): Promise<CateringMenuItem[]>` — active `catering_available` items, `menu_price`→cents (reuse the `dollarsToCents` logic).
  - `loadPublicCateringPackages(locationId): Promise<CateringPackage[]>` — active packages (global or this location) + expanded lines (same resolution as `loadCateringPackagesForQuote`).
  - `loadPublicPricingContext(locationId): Promise<{ rates: ChargeRates; hasPricingRule: boolean; zones: DeliveryZone[] }>` — the active `catering_pricing_rules` row (or `ZERO_RATES`) + active delivery zones. Import `ChargeRates`/`DeliveryZone`/`ZERO_RATES`-equivalent shapes from `@/lib/catering/quotes` (export `ZERO_RATES` if not already exported; else re-declare).
  - Reuse `lineTotalCents` + `computeChargeStack` from `@/lib/catering/quotes` (already exported).
- [ ] **Step 2:** `npm run build`; commit (`feat(portal): public catering menu + pricing loaders`).

---

## Task 3: The submission engine (`lib/portal/orders.ts`)

**Files:** Create `lib/portal/orders.ts`

- [ ] **Step 1:** Implement `submitOrder`. **Server-side price authority is the load-bearing property**: resolve each line's price from the real menu, never from the client.

```ts
export interface SubmitLineInput { itemId?: string | null; packageId?: string | null; quantity: number; notes?: string | null }
export interface SubmitOrderInput {
  locationId: string;
  eventDate?: string | null; headcount?: number | null;
  isDelivery?: boolean; deliveryZoneId?: string | null;
  contactName: string; company?: string | null; notes?: string | null;
  lines: SubmitLineInput[];
}
export interface SubmitOrderResult { pipelineId: string; quoteId: string; paymentId: string; depositCents: number; totalCents: number }
```

Flow (all service-role):
1. Throttle: `checkAndRecord(\`order_submit:\${customerId}\`, 15*60, 5)` → throttled ⇒ throw a 429-mapped error.
2. Load `customer` (email/name) by `customerId`; require active.
3. Resolve+price each line against the real menu (`loadPublicCateringMenu` + `loadPublicCateringPackages`): for an `itemId`, unit price = that item's `unitPriceCents`; for a `packageId`, unit price = that package's `priceCents`; a line referencing neither, or an unknown id, is **rejected** (no free-text, no client price). Empty resolved set ⇒ reject (this is the dormant-until-data guard).
4. `pricing = loadPublicPricingContext(locationId)`; `deliveryFee = resolveDeliveryFee(...)`; `stack = computeChargeStack(lineTotals, deliveryFee, pricing.rates)`.
5. Insert `catering_pipeline` lead (`contact_name`, `event_date`, `headcount`, `stage='inquiry'`, `lead_source='portal'`, `location_id`, `customer_id`, `estimated_revenue_cents = stack.totalCents`, `created_by=null`) + the initial `catering_pipeline_events` row (`from_stage=null, to_stage='inquiry'`).
6. Insert `catering_quotes` (`status='submitted'`, `pipeline_id`, `customer_id`, snapshot of `stack` + `rates` via the same column shape `quotes.ts snapshotColumns` uses, `expires_at`, `created_by=null`) + `catering_quote_items`.
7. Insert `catering_payments` deposit row (`quote_id`, `customer_id`, `kind='deposit'`, `amount_cents=stack.depositCents`, `status='due'`, `created_by=customerId`).
8. Allowlist-gated confirmation email (Task 5) — best-effort.
9. `audit` (`action='catering.order.submit'`, `resourceId=quoteId`, `metadata={ pipeline_id, customer_id, total_cents, deposit_cents, lines }`, `actorId=null`).
10. Return `{ pipelineId, quoteId, paymentId, depositCents, totalCents }`.

Error checking: every insert checks `error` (Supabase swallows). Order the inserts lead→quote→items→payment so a failure early doesn't strand money rows; on a later-step failure, throw (the customer retries — a partial lead with no quote is a benign orphan a staff can clean, acceptable for v1; note it).

- [ ] **Step 2:** `npm run build`; commit (`feat(portal): customer order-submission engine (server-priced lead+quote+deposit)`).

---

## Task 4: Payments lib + staff mark-paid (`lib/catering/payments.ts`)

**Files:** Create `lib/catering/payments.ts` + `app/api/catering/payments/[id]/mark-paid/route.ts`

- [ ] **Step 1:** `lib/catering/payments.ts`:
  - `createDepositDue(sb, { quoteId, customerId, amountCents, createdBy })` — the insert helper Task 3 calls (or inline in orders.ts; keep one home).
  - `markDepositPaid(actor: AuthContext, paymentId)` — staff (level ≥ 6 + location via the quote's location) flips `status 'due' → 'paid'` (guarded `.eq('status','due')` → count 0 ⇒ 409), sets `paid_at`, `provider='manual'`; audits `catering.payment.mark_paid`. This is the seam-advance stub a real provider webhook replaces.
  - `loadPaymentsForQuote(actor, quoteId)` — staff read.
- [ ] **Step 2:** `app/api/catering/payments/[id]/mark-paid/route.ts` — POST, `requireSession` + the mark-paid call. (Optional Tier-B step-up later; not required for the stub.)
- [ ] **Step 3:** `npm run build`; commit (`feat(catering): payment seam lib + staff mark-deposit-paid`).

---

## Task 5: Confirmation email (`lib/email-templates/order-confirmation.ts`)

**Files:** Create `lib/email-templates/order-confirmation.ts`; wire the send in `lib/portal/orders.ts`.

- [ ] **Step 1:** `renderOrderConfirmationEmail({ name, eventDate, totalCents, depositCents }): string` — reuse `renderEmailLayout` (read `lib/email-templates/_layout.ts`). Copy: "Order received — pending our team's confirmation," the estimated total + deposit-to-reserve, "we'll confirm within ~24h; if we can't do your date, your deposit is refunded in full." (No payment link yet — payment deferred.)
- [ ] **Step 2:** In `submitOrder`, after the payment insert: if the customer's email is allowlisted (reuse Portal-2's allowlist helper — export it from `lib/portal/magic-link.ts` or re-implement the tiny check) AND `NEXT_PUBLIC_APP_URL` set, `sendEmail({ to, subject, html, text })`. Best-effort (never throws).
- [ ] **Step 3:** `npm run build`; commit (`feat(portal): order confirmation email (allowlist-gated)`).

---

## Task 6: The submit route (`app/api/portal/order/submit/route.ts`)

**Files:** Create the route.

- [ ] **Step 1:** POST, `runtime='nodejs'`. Origin check (mirror the magic-link route). `requireCustomerSession(req)` → 401 if not signed in. Parse body → `SubmitOrderInput` (validate shapes: locationId string, lines array). Call `submitOrder(ctx.customerId, input)`. Map `Catering*Error`/throttle → proper status; success → `{ ok:true, quoteId, depositCents, totalCents }`.
- [ ] **Step 2:** Add `/api/portal/*` already public in proxy (Portal-2) — confirm no change needed (it covers `/api/portal/order/submit`). `npm run build`; boot dev to confirm the route registers. Commit (`feat(portal): POST /api/portal/order/submit`).

---

## Task 7: Seeded smoke (`scripts/portal-3-smoke.ts`)

**Files:** Create `scripts/portal-3-smoke.ts`

- [ ] **Step 1:** Against a running dev server + service-role DB: (a) seed a temp `catering_pricing_rules` row for a location (tax/service/deposit bps), a temp `items` row `catering_available=true` with a `menu_price`, and a temp `catering_customers` + a `catering_portal_sessions` (mint a customer JWT via `createCustomerSession`) so the request is authenticated; (b) POST `/api/portal/order/submit` with a line referencing the temp item; (c) assert 200 `{ok:true}` + a `catering_pipeline` lead (`lead_source='portal'`), a `catering_quotes` row (`status='submitted'`, correct `total_cents`/`deposit_cents` from the charge stack), `catering_quote_items`, a `catering_payments` `deposit`/`due` row; (d) assert a client-supplied bogus price is IGNORED (server used the seeded menu price — D20); (e) call `markDepositPaid` (as a seeded staff actor) → payment `paid`; (f) cleanup ALL seeded rows (hard-delete the throwaway test rows).
- [ ] **Step 2:** Run against `npm run dev` → all pass. Commit (`test(portal): Portal-3 order-submission smoke (seeded)`).

---

## Task 8: Review + PR

- [ ] Final adversarial review over the whole diff (auth: only the owning customer can submit; price authority: no client price trusted; single coherent submit; RLS deny-all on payments; silent-failure checks; the dormant-guard rejects an unresolvable/empty cart). Fix findings.
- [ ] Open PR; wait for `build` = **pass** (verify explicitly); confirm `state==MERGED` before any cleanup. Juan smoke (seeded, or note it's dormant-until-data). Merge; capture to memory + CHIEF (Portal-3 engine shipped, dormant until the wiring pass; NEXT = the integrated wiring pass + Portal-4).

---

## Self-Review
- **Spec coverage:** submission ✓ (T3/T6), server price authority ✓ (T3/D2), pipeline+quote creation ✓ (T3), confirmation email ✓ (T5), throttle ✓ (T3), payment seam ✓ (T1/T4) provider-agnostic (no Stripe/Toast baked in). Account-home (Portal-4) + real builder UI + price-derivation/Toast push correctly out of scope.
- **Type consistency:** `SubmitOrderInput`/`SubmitLineInput`/`SubmitOrderResult`, `loadPublicPricingContext`, `createDepositDue`/`markDepositPaid` used consistently T2–T7. Reuses `computeChargeStack`/`lineTotalCents`/`ChargeRates` from `lib/catering/quotes.ts` (no re-implementation of money math).
- **Dormant-until-data:** T3 step 3 rejects an unresolvable/empty cart, so with 0 menu rows the engine is correctly inert in prod; the seeded smoke (T7) proves correctness. Documented, not silent.
- **Adaptation note:** verification = build + DB probes + seeded dev-server smoke (repo has no unit-test suite).

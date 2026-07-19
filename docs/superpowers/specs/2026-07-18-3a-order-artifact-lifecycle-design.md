# 3a — Order-Artifact Lifecycle + Real-Data Wiring (design)

> Sub-project of the customer-portal arc, from Juan's 2026-07-18 notes (backlog:
> `project_coops_catering_wiring_ideas_backlog`). Turns the mockup customer order flow into a
> **real, server-backed order artifact** born at intake and carried through its lifecycle.
> Decomposition: **3a-core (this spec)** → 3a-print (printable rich summaries, fast-follow) → W4
> (reserve/deplete logic).

**Goal:** Make the customer new-order flow produce ONE real server artifact, created at intake and
filled/carried forward through build → review → deposit → balance → fulfillment → account history —
wired to real menu data and server-side pricing — replacing the client-only sessionStorage mockup
(which is the root cause of the live 24→20 headcount bug).

**Architecture:** The artifact = the existing `catering_pipeline` lead (mutable CRM/details) + its
current `catering_quotes` row (append-only *versioned* priced doc), already linked by `pipeline_id`.
Born at intake as a **draft** once the customer is verified; **mutable in place while `draft`**, then
**immutable + versioned once `submitted`**. Same model for staff-sent quotes (one artifact, two
origins). Inventory reserve/deplete keys off pipeline stage (3a sets the stages; the logic is W4).

**Tech stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind v4, TS strict +
`noUncheckedIndexedAccess`, Supabase (service-role + RLS), integer-cents money, bps rates. Builds on
W1a's derivation (`lib/catering/pricing-derivation.ts` + `loadPublicCateringMenu`) and the existing
charge stack (`computeChargeStack`). Tests = `tsx` seeded smoke.

---

## 1. Context (what's there now)

- The customer **new-order flow is a client-only mockup**: `/order/start` (intake) →
  `/order/build` (hardcoded `MENU`) → `/order/review` (illustrative client-side rates) →
  `/order/checkout` — all on **sessionStorage** (`co_order_details`, `co_order`, `co_order_charges`),
  producing **no server artifact**. The real engine (`submitOrder` → `catering_quotes`) is reached
  only via a staff-sent quote, never by this flow.
- **24→20 bug root cause:** headcount lives in TWO disconnected client places — `co_order_details.guests`
  (intake) and `OrderBlob.headcount` (build, defaults 20) — which diverge. One server artifact with one
  headcount removes the entire class.
- **Substrate (reused, not rebuilt):** `catering_pipeline` (mutable lead: contact/company/event_date/
  headcount/stage/notes; stages inquiry→quote_sent→confirmed→completed→lost; append-only
  `catering_pipeline_events`), `catering_quotes` (versioned priced doc: lines + charge-stack snapshot +
  status draft/submitted/sent/accepted/declined/expired + `origin`), `catering_payments` (deposit/balance
  seam), `catering_customers` (Portal-2 identity), Portal-4 account (history derived from quotes),
  W1a `loadPublicCateringMenu` + derivation, `computeChargeStack`.

## 2. The artifact model

**One order = the lead + its current quote.** The **lead** (`catering_pipeline`) holds the stable
order *details* (contact + event + logistics + the new intake fields); the **quote**
(`catering_quotes`) holds the *priced* lines + charge-stack snapshot (versioned). The customer/account
see it as one order (already true — Portal-4 derives history from quotes).

**Born at intake.** A **verified** customer submitting intake → server creates the lead (stage
`inquiry`) + a **draft** quote (`status='draft'`, `origin='self_serve'`, 0 lines) carrying the intake
details. Creation happens **after intake-submit + email-verify/sign-in** (Juan's Q2 answer) — so no
unverified/competitor spam ever creates real rows (a first seed of the Security pass, Note 1).
Staff-sent quotes use the identical shape (`origin='staff'`) and lifecycle.

**Mutable-draft → versioned (D19 refinement).** While `status='draft'`, line edits happen **in place**
(replace `catering_quote_items` + recompute the charge stack on the same row) — no version churn per
keystroke. On **submit**, the draft → `submitted` and becomes **immutable**; any post-submit edit
(customer or staff) goes through the existing append-only `reviseQuote` (new version). This keeps clean
history without a version per edit.

## 3. Lifecycle + inventory hooks

Quote status (money doc): `draft → submitted → …` (existing vocabulary). Pipeline stage (lifecycle
tracker + inventory trigger): `inquiry → quote_sent → confirmed → out → completed` (+ `lost`/declined),
where **`out` is NEW**.

- Deposit paid (`submitted`) → team confirms → **`confirmed` = RESERVE stock** → **`out` = DEPLETE** →
  `completed`. Balance rides `catering_payments` (existing). 3a **sets these stages**; the reserve/deplete
  **logic is W4** — this gives W4 clean, explicit triggers.

## 4. Data model (proposed — verify exact columns/CHECKs at plan time)

- **Extend `catering_pipeline`** (the mutable lead) with the new intake detail fields:
  `contact_phone`, `delivery_address`, `time_window`, `event_type`, `dietary_notes`, `event_name`,
  `dropoff_door` (all nullable text; `time_window` may be text or a start/end pair — decide at plan
  time). `event_date`/`headcount`/`company`/`contact_name` already exist.
- **Add `'out'`** to the pipeline stage CHECK + `PIPELINE_STAGES` in `lib/catering/pipeline.ts` (and any
  stage-ordering/terminal logic).
- **Napkins & utensils add-on:** modeled as a **catering-available `item`** ("Napkins & Utensils",
  priced) that the review stage toggles into the cart → priced via W1a derivation. **No schema change** —
  reuses W1a + the line model. (A seed item + a review toggle.)
- **Headcount** is set server-side once from intake onto the lead + draft quote (one value; no client
  divergence) → structurally fixes 24→20.

## 5. New lib surface — `lib/portal/draft.ts` (portal draft lifecycle)

Customer-principal, service-role, ownership-checked (`customer_id`), status-guarded, server price
authority (D20 — client sends refs + qty, never prices):
- `createDraftFromIntake(customerId, intake)` → insert lead (`inquiry`) + draft quote (0 lines) with
  intake details; returns `{ quoteId, pipelineId }`. Called post-verify.
- `loadDraft(customerId, quoteId)` → the owned draft + its lines + the real menu
  (`loadPublicCateringMenu(locationId)`), or 404.
- `setDraftLines(customerId, quoteId, lines)` → **only if owned + `status='draft'`**: resolve+price
  every line via W1a derivation (subs `menuItemId`+`portion`, extras `itemId`), replace
  `catering_quote_items`, recompute + snapshot the charge stack via `computeChargeStack`. (The persisting
  cousin of `previewQuote`.)
- `submitDraft(customerId, quoteId, { isDelivery, deliveryZoneId, tipBps, napkins })` → transition draft
  → `submitted`, add the napkins add-on line if toggled, create the deposit-due `catering_payments` row,
  move the pipeline to the deposit-pending stage, send the confirmation email (allowlist-gated). Reuses
  `submitOrder`'s tail (charge-stack snapshot, payment, audit).

Existing `submitOrder` (one-shot) is superseded by create-draft → setDraftLines → submitDraft for the
self-serve path; keep it (or refactor its tail into a shared helper) — decide at plan time.

## 6. Real-data wiring (the flow)

Rewrite `/order/start` → `/order/build` → `/order/review` from mockup to server-backed:
- **`/order/start`**: richer intake form (§7). On verified submit → `createDraftFromIntake` → the draft
  `quoteId` becomes the flow's handle (URL param or server session), replacing sessionStorage.
- **`/order/build`**: load the **real** menu (`loadPublicCateringMenu`) + the draft; every cart change →
  `setDraftLines` (server-priced, real charge stack). Uses W1a's `kind`/`portion`/`portionPricesCents`.
- **`/order/review`**: shows the **server** charge stack (no client illustrative rates); the napkins
  toggle; the one "complete order" click → `submitDraft` → deposit (existing `/order/quote/[id]` pay
  surface / checkout).
- Coverage/servings continue to work off real portions (W1a).

## 7. Richer intake + napkins add-on

`/order/start` gains: contact phone, delivery/pickup **time window**, **event type**, **dietary &
allergen notes**, **event/order name**, **preferred drop-off door** (delivery address already collected)
— kept to a light, progressive form. All persist on the lead via `createDraftFromIntake`. **Napkins &
utensils** = a paid toggle in `/order/review` that adds the add-on line (an upcharge).

## 8. Security (seeds the Note-1 hardening pass)

3a-core bakes in: **create-only-post-verify** (no unverified rows), **ownership checks** (`customer_id`)
on every draft op, **status guards** (edits only while `draft`; owned-only), **server price authority**
(D20) on all pricing, **rate-limits** on draft-create + line-edits (existing `lib/portal/rate-limit.ts`),
and UUID guards on any `.or()` filter. The full adversarial threat-model (payment injection, abuse,
enumeration) is the separate **Security Hardening** sub-project — 3a builds on these guards, it doesn't
replace that pass.

## 9. Error handling & edges

- Draft op on a non-owned / non-draft / missing quote → 404/409 (never leak another customer's order).
- Unpriceable / unknown line ref → `invalid_line` (W1a rules; client price ignored).
- Dormant data: with 0 catering rows the flow can't resolve a real order — the artifact machinery is
  correct + smoke-proven, DORMANT until data (same as W1a).
- Abandoned drafts accumulate → a `draft`-status sweep (pg_cron, later) can expire them; out of 3a scope.
- Headcount/date required at intake; the single server value drives coverage + pricing.

## 10. Testing

Seeded smoke (`scripts/3a-smoke.ts`) against W1a's seeded menu: create a verified customer → intake draft
(assert lead + draft quote, one headcount, intake fields on the lead) → `setDraftLines` (assert server
pricing + charge stack, in-place, no new version) → `submitDraft` (assert `submitted` + deposit-due +
pipeline stage + napkins line if toggled) → post-submit edit → new version (immutability) → stage
`confirmed`→`out`→`completed` transitions. Roll back all seeded rows.

## 11. Scope & decisions

**In 3a-core:** the artifact-from-intake + server-backed draft lifecycle (`lib/portal/draft.ts`), the
pipeline intake-field extension + `'out'` stage (one migration), the napkins add-on (seed + toggle),
the real-data rewrite of `/order/start`+`/order/build`+`/order/review`, richer intake, the smoke.

**Deferred:** 3a-print (printable rich order/account/quote summaries — fast-follow); W4 (reserve/deplete
logic off the `confirmed`/`out` stages); abandoned-draft sweep; the full Security Hardening pass.

**Locked decisions (Juan, 2026-07-18):** artifact = lead+quote pair, born at intake, both origins;
server-backed draft, mutable-while-`draft` → versioned-after-`submitted`; add the `'out'` fulfillment
stage; intake detail fields live on the pipeline lead; napkins/utensils = a catering item + review
toggle (no schema); create-only-post-verify.

## 12. Confirm-before-authoring checklist (run at plan/authoring time, live DB `bgcvurheqzylyfehqgzh`)

- `catering_pipeline` columns + the **stage CHECK constraint** (before adding `'out'`) + `pg_constraint`.
- `catering_quotes` status CHECK + the draft/version columns; whether an in-place draft edit needs any
  new column or just line-replace + stack-recompute.
- `catering_quote_items` shape (from W1a — `portion` present).
- Next migration number (0128 is the current tip after W1a).
- `submitOrder`'s exact tail (payment/pipeline/email/audit) to factor into `submitDraft`.
- How the flow carries the draft handle across pages (URL param vs server session) + the magic-link
  verify → create-draft hand-off.

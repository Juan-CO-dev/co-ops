# R3 — Receiving (manual foundation) design

**Date:** 2026-07-01
**Status:** approved (design), pending plan
**Slice:** R3 of the resliced inventory roadmap (recalibration `5d6c275`).
**Builds on (shipped):** R1 (`content_oz`, `avg_oz_per_each`) + R2 (`vendor_price_history` prices, `lib/admin/cost.ts`).

> When a delivery arrives, whoever's on shift logs **what physically came in** per SKU.
> Each line optionally carries the invoice **price** (→ feeds R2's price ledger, cost goes
> receipt-driven) and an optional **observed oz-per-each** produce sample (→ self-refines the
> SKU's `avg_oz_per_each`). This is the FIRST operational (non-admin) inventory surface. It
> captures receiving **events**; on-hand *state* is R4. Auto email-capture of digital receipts
> is the next slice (R3b), designed to draft into this same model + confirm path.

---

## 1. The model in one breath

> A **delivery** (`vendor_deliveries` header) has **line items** (new `vendor_delivery_items`):
> per SKU, `qty_received` (packs) + optional `unit_price` + optional `observed_oz_per_each`.
> On submit: lines are written; each priced line inserts a `vendor_price_history` row
> (effective_date = delivery date); each observed-oz line recomputes the SKU's
> `avg_oz_per_each` = running mean of all observed samples. KH+ at `/operations/receiving`,
> location-bound.

## 2. Decomposition (locked with Juan)

- **R3 (this slice):** Manual receiving — data model + operational entry + price→ledger +
  avg-oz refinement.
- **R3b (next slice, its own spec/plan):** Auto email capture (no AI) — inbound email →
  per-vendor structured parse → **draft** delivery → human confirm, reusing R3's tables +
  the R3 confirm/commit path. Needs inbound-email infra + per-vendor format + vendor/SKU
  matching + a review queue. Out of scope here; R3's model is designed to receive it (a
  parsed email becomes a draft delivery a human confirms through R3's UI).

## 3. Schema (migration 0100)

Current: `vendor_deliveries` (header, dormant, 0 rows: `id, vendor_id, location_id,
delivery_date, invoice_number, invoice_total, notes, received_by, created_at`); NO delivery
line-items table; `vendor_price_history` (R2); `items.avg_oz_per_each` (R1).

- **Reuse `vendor_deliveries`** as the header — no DDL change (activate the dormant table).
- **New `vendor_delivery_items`:**
  - `id uuid pk default gen_random_uuid()`
  - `delivery_id uuid not null references vendor_deliveries(id)`
  - `vendor_item_id uuid not null references vendor_items(id)`
  - `qty_received numeric not null check (qty_received > 0)` — in packs (the SKU's pack unit)
  - `unit_price numeric check (unit_price is null or unit_price > 0)` — optional invoice price per pack
  - `observed_oz_per_each numeric check (observed_oz_per_each is null or observed_oz_per_each > 0)` — optional produce sample
  - `notes text`
  - `created_at timestamptz not null default now()`
  - `created_by uuid` (the receiver)
- **RLS:** append-only, deny-all to end users on `vendor_delivery_items` (mirror the vendor/SKU
  tables: `_no_user_select/insert/update/delete`). Reads + writes go through **service-role**;
  authorization is **app-layer** (KH+ gate + location-bind) in the receiving lib/route.
  `vendor_deliveries` RLS unchanged (already deny-all).

## 4. Data flow — `recordDelivery` (one atomic-ish submit)

Input: `{ vendorId, locationId, deliveryDate, invoiceNumber?, invoiceTotal?, notes?, lines: [{ skuId, qtyReceived, unitPrice?, observedOzPerEach?, notes? }] }`.

1. **Gate:** KH+ (≥3); `locationId` must be one the actor is authorized for (location-bind,
   404 on mismatch, mirroring the admin IDOR pattern). Vendor + each SKU must be active.
2. **Header:** insert `vendor_deliveries` (`received_by` = actor, `delivery_date`).
3. **Lines:** insert `vendor_delivery_items` (one per line; `created_by` = actor).
4. **Prices:** for each line with `unitPrice`, insert a `vendor_price_history` row
   (`vendor_item_id`, `unit_price`, `effective_date = deliveryDate`, `recorded_by` = actor).
   Reuses R2's ledger — cost becomes receipt-driven.
5. **Avg-oz refinement:** for each SKU that got an `observedOzPerEach` on this delivery,
   recompute the **SKU's** `vendor_items.avg_oz_per_each` = the mean of **all**
   `observed_oz_per_each` values across `vendor_delivery_items` for that SKU (including the new
   ones). Simple mean (each delivery's sample = one observation). Update in place.
6. **Audit:** `delivery.received` (metadata: vendor, location, line count, priced-line count,
   avg-oz-updated SKU ids).

> Not wrapped in a DB transaction/RPC in R3 (multi-step service-role writes; failure mid-way
> leaves a partial delivery, acceptable for a manual low-frequency flow — the receiver can
> re-log). If this proves fragile, an atomic RPC is a fast-follow. Flag noted.

## 5. Surfaces & authority

- **`/operations/receiving`** (KH+, ≥3): "Log a delivery" form — vendor picker (active vendors),
  delivery date (default today), optional invoice #/total, and a repeatable line editor
  (SKU picker + qty + optional price + optional observed-oz). Plus a **recent deliveries**
  list (this location, most recent first) with a drill-in showing the lines.
- **Dashboard tile** (KH+) linking to it.
- **Authority:** receive = KH+ (≥3), **location-bound**. KH+ may enter invoice prices here
  (transcribing the invoice in hand; audited) — R2's standalone admin record-price stays AGM+.
- The receiving lib is **operational** (KH+), distinct from the admin cost/SKU libs; it lives in
  `lib/receiving.ts` (server, service-role, app-gated), NOT under `lib/admin/`.

## 6. avg-oz running refinement (detail)

`observed_oz_per_each` on a line = "we weighed a sample of this delivery's produce and it
averaged X oz per each." The SKU's canonical `avg_oz_per_each` becomes the mean of all such
observations over time → self-correcting for case-to-case produce variance. Recompute on submit
(query all `observed_oz_per_each` for the SKU, average, update `vendor_items.avg_oz_per_each`).
The residual between this refined average and the R4 physical count becomes the R5 shrinkage
signal. Lines without an observation don't touch the average.

## 7. Verification

- `npx tsc --noEmit` + `npm run build` clean.
- Throwaway tsx smoke (deleted before commit): `recordDelivery` with a 2-line delivery (one
  priced, one with observed-oz) → asserts a `vendor_deliveries` + 2 `vendor_delivery_items` +
  1 `vendor_price_history` row landed, and the SKU's `avg_oz_per_each` updated to the running
  mean; numeric→number coercion asserted; location-bind rejects a foreign location.
- **Operator smoke (Juan, preview):** existing AM-prep / mid-day / Opening / closing render
  identical (receiving is a NEW surface, touches no existing operator path); then log a delivery
  at `/operations/receiving` → it appears in recent deliveries; a priced line shows up as the
  SKU's new current cost in R2's SKU panel; an observed-oz line moves the SKU's avg.

## 8. Boundary (what R3 is NOT)

- **on-hand state** ("how much do we have now", "available for prep") = R4 (R3 captures received
  events; R4 computes on-hand = received − counted).
- **Auto email capture** = R3b.
- **Ordering** (`vendor_orders`, order→receive reconciliation) = a separate later slice; R3
  receiving requires no prior order.
- **Variance** (actual vs theoretical) = R5.

## 9. Open decisions deferred
- **D-atomic:** `recordDelivery` is multi-step service-role (not a single RPC) in R3; promote to
  an atomic RPC if partial-delivery failures show up. (§4 flag.)
- **D-draft-status:** `vendor_deliveries` gets no `status` column in R3 (all manual = committed);
  R3b adds `status draft|confirmed` for the email-draft path.
- **D-avg-weighting:** avg-oz refinement is a simple mean of observations; qty-weighting or
  recency-decay can come later if the simple mean drifts.

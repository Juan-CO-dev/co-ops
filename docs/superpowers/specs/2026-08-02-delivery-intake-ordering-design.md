# Delivery Intake + Par-Pass Ordering — Design

**Date:** 2026-08-02 · **Status:** approved-pending-Juan's-spec-review · **Owner:** CC
**Origin:** Juan's mid-shift notes (CHIEF `00-INBOX/2026-08-02-cowork-inventory-truth-model.md` + `...-audit-tool-inferred-bootstrap.md`) → seven-seat council (`~/.claude/council/2026-08-02-delivery-intake/`) → Juan's design approval + calls A/B.

## 1. Context and truth model

Juan's reframe, which this design implements: the shop does not do census counts. Ground truth for on-hand is the triangulation of **delivery intake** (in), **sales/production depletion** (out), and **par-pass ordering signals** (level hints). The delivery intake form is the centerpiece. Constraint (verbatim): "we need to not add friction… just improve the current workflow." The ONLY new friction permitted is the manager-at-door intake ceremony — deliberate, chosen "to make sure we get the actual count and keep the system true." Quality bar: "make this a great design for the user."

## 2. Verified current state (council-corrected)

- `recordDelivery()` (`lib/receiving.ts`) is production-grade: pack-chain oz resolution at write (advisory-null), price → `vendor_price_history`, atomic insert, RECEIVE_MIN=4, location-bind. **No re-architecture.**
- **Receipt + per-line photo capture is ALREADY LIVE** in `ReceivingForm.tsx` via the 0164 private bucket (the "stubbed" belief was stale).
- `sku_count_events`/`sku_count_lines` + `computeOnHand`/`computeVariance` (`lib/counts*.ts`): sound, empty, advisory-null-honest. Gates: AGM+ (6) + Tier-A write.
- **SKU-grain pars DO NOT EXIST** (`item_par_levels` is item-grain; dormant `par_levels` has no creation migration). Must be built (§D5).
- **No inbound email**; Resend outbound-only AND domain unverified (`onboarding@resend.dev` reaches only Juan) — automated vendor email is out for v1. EZCater webhook = the ingestion pattern precedent.
- **`app/api/ai` is a 501 stub** — the LLM-parse lane must be built, not wired.
- Roles: 4 = **KH (KEY HOLDER)**, 6 = AGM, 7 = GM, 8 = MOO.

## 3. Design

### D1 — The door ceremony (intake form upgrade)
Vendor tap → **pre-fill hierarchy**: parsed email receipt (vendor's claim of what shipped) → last delivery from this vendor ("same as last time") → blank. Form shows ONLY expected lines + an "add item" affordance (overages/substitutions; subs allow free-text when not in catalog). **Count-by-exception**: one tap confirms a line at expected qty; tapping opens inline adjust — qty steppers (+1 case / +1 unit; no numeric keypads) and single-tap flags `short | over | damaged | substitution` that expand in-row (no modals, no separate step). **Receipt photo is a REQUIRED step** (full-screen camera; PC fallback = file upload; camera failure → "photo later" flag creating an outstanding task, never blocking submit). Mechanical hardening (all v1): offline draft persisted client-side (IndexedDB) with visible "saved on device" state; dedupe guard on (vendor, invoice_number, delivery_date); partial-delivery `delivery_status: in_progress|complete` with "continue intake"; price authority = intake `unit_price` always (parsed email price advisory). Enhancement (P2+): barcode scan-to-increment where vendor cases carry codes. Target: 60–90s clean delivery; every added tap is a design defect.

### D2 — Two-way match (not three-way)
The photo and the emailed receipt are the same document — the vendor's claim — captured via two channels. Match = **manager's count ↔ vendor claim**. `vendor_deliveries.match_state: counted_only → matched | discrepant | override` (+ `email_receipt_id` FK nullable). Email arriving after the truck (normal; ~48h window, then "missing email" flag) reconciles asynchronously: background job links by vendor + date-window (+ invoice number when parsed), computes line deltas through the pack chain (case↔each normalized), transitions state. Discrepant deliveries surface in a review queue with side-by-side (intake vs claim + photo thumbnail); override requires a note. **Nothing in the match lifecycle ever blocks the door.** Un-matched deliveries' received_oz remains fully valid (the count is truth); match is verification, not gating.

### D3 — Credits with teeth
`vendor_credits`: vendor_id, delivery_id/delivery_item_id (nullable), reason `short|over|damaged|substitution|price_discrepancy`, sku_id, qty, amount (server-derived), status `open → in_progress → resolved_credit|resolved_refund|written_off`, memo URL, notes, resolved_at. Auto-born from line flags (a backordered expected-line received-0 auto-opens one); creation atomic with the intake write (BC-007). Surfaced: delivery detail · **vendor profile aggregate** ("$X outstanding across N deliveries" — visible before placing the next order) · aging view (part of v1 credits: a flag rotting unresolved creates false trust). Inactive-vendor rollup filtering per BC-009.

### D4 — Email channel, staged
**v1:** dedicated receipts address per location; managers forward (or vendors CC). Inbound seam per the EZCater pattern: ledger-first (`email_receipts`: raw MIME + attachments to the private bucket, source `forward|upload|watch`, parse_state, parsed_json, confidence, linked_delivery_id), rate-limit + auth gate, poison-on-malformed. Manual upload in the form is the equal fallback. **v2:** render the raw email/PDF beside the delivery for visual compare (value before any parsing exists). **v3:** build the AI route for real; LLM structured extraction (vendor, invoice #, lines) → **expectation pre-fill only, never truth**; unmatched parsed lines queue for human SKU-mapping (no silent SKU creation — fixture-fiction law). **North star:** auto-watch on the shop inbox (Gmail watch/poll with vendor-sender allowlist from `vendor_contacts`) once forwarding proves the flow.

### D5 — Par-pass ordering
Build **SKU-grain pars** as columns on `vendor_items` (`par_value`, `par_unit`, optional `weekend_par_value`) — the simpler shape (builder's recommendation; fewer joins; matches how the seed captured vendor pars). The dormant `par_levels` table stays dormant; graduate to it only if per-day-of-week SKU pars are ever actually needed. Walker UX (phone, grouped by vendor, ordered by storage walk): per SKU — name/pack, par, advisory on-hand ("system thinks ~3.2 cases" when derivable), last order qty, **one input: order qty** (quick-buttons; default suggestion par − advisory clamped ≥0 once advisory exists). Tables: `par_pass_events` (location, vendor nullable, walked_by, walked_at, status draft|submitted) + `par_pass_lines` (event, sku, par_qty_snapshot, order_qty, implied_on_hand_oz server-derived = par − order_qty via pack chain). **Gate: KH+ (4), no step-up** — routine operational action. Submit → draft order per vendor rendered from `vendor_ordering_details` method (v1 delivery: copy/mailto/portal-link; automated send deferred until Resend domain verification). All new display surfaces use oz-normalized paths (BC-026).

### D6 — Truth model: source-tagged anchors, audit as a tool
`computeOnHand` anchors gain a source tag with strict tiers: **`census` (hard) > `par_estimate` (soft) > `inferred` (bootstrap)**.
- **census** — the existing counts machinery, REFRAMED as the on-demand **Audit tool** (Juan's call A): UI copy becomes "Inventory Audit"; owner/GM invokes it whenever ("like a tool they have available"); gates unchanged (AGM+ + Tier-A); zero scheduled expectation. A census line supersedes all soft anchors for its SKU.
- **par_estimate** — implied levels from par-pass submissions; server-written as a side-effect (walker never "does a count").
- **inferred** — the cold-start bootstrap (Juan's call A): for a SKU with no census and no par-estimate, infer a LEVEL BASE from prep activity — production_inputs consumption over a lookback window under a coverage assumption (base ≈ par where a par exists, else ≈ N days of observed consumption run-rate; N tunable, default set at plan time with a concrete number). Mechanics: the inferred value is the anchor BASE; properly-intaken deliveries and depletion then accrue on top of it exactly as they would on a census anchor ("as the SKUs coming in start to stock the shelves the system just uses that" — Juan). The base is REPLACED, per SKU, by the first par_estimate or census anchor; inference is computed once per SKU and never regenerates after any real signal exists.
- **Variance computes between hard (census) anchors ONLY** — soft anchors never feed variance (anchor-poisoning guard, 4-seat council ruling). Estimate-vs-computed divergence beyond threshold surfaces as a **shrinkage signal** (advisory attention item), not variance.
- Every surface shows anchor provenance ("estimated" / "inferred" / "audited <date>"). Industry corroboration: theoretical-inventory pattern (MarketMan/xtraCHEF/MarginEdge).

### D7 — Roles (Juan's call B)
RECEIVE_MIN stays **4 (KH+ = key holder and above)** — "anyone with authority can go intake the delivery." Par-pass KH+. Audit AGM+ + Tier-A. No changes to the roles spine.

### D8 — Rollout
- **P1 — door ceremony:** D1 complete + D3 credits + `match_state` columns (manual email upload only). Ships on the live spine; columns + one table.
- **P2 — email channel + inference:** D4 v1/v2 + D6 inferred bootstrap + provenance-labeled advisory on-hand + shrinkage signal + Audit-tool reframe (copy only).
- **P3 — ordering:** D5 complete (SKU pars migration + walker + draft orders + par_estimate anchors).
- **P4 — intelligence:** AI route + LLM parse → pre-fill; auto-watch; credit aging dashboard polish; barcode scan.

## 4. Data model deltas (summary)
New: `vendor_credits` · `email_receipts` · `par_pass_events` · `par_pass_lines` · SKU-grain pars (table-or-columns). Extended: `vendor_deliveries` (+match_state, +email_receipt_id, +delivery_status, +invoice_number if absent) · `vendor_delivery_items` (+expected_qty, +discrepancy_type) · anchor resolution (+source tag; census rows = existing `sku_count_events` unchanged). No existing column repurposed; append-only laws hold.

## 5. Non-goals / deferred
Automated vendor order emails (Resend domain unverified) · Gmail OAuth auto-watch before forwarding proves out · recurring/scheduled counts of any kind (dead by design) · vendor-facing credit automation (managers chase; CO-OPS remembers) · Dynamic Pars (separate owner-called design; this arc feeds it data) · packages/platter-level receiving.

## 6. Decisions register
- Two-way match, not three-way (builder+aggie convergence; Juan-approved via design §2).
- Par-pass NEVER writes `sku_count_events` (4-seat ruling over cc/sonnet's kind-flag; anchor-poisoning guard).
- Census = on-demand Audit tool, no mandatory bootstrap; cold start via prep-inference that self-heals (Juan, call A).
- KH+ (key holder) keeps receiving; KH = key holder, correct all copy accordingly (Juan, call B).
- Intake price is price authority, always. Parse output is pre-fill, never truth. Nothing blocks the door.

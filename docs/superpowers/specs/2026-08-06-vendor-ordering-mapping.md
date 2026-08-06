# Vendor Ordering Module — Brief-to-Reality Mapping

**Date:** 2026-08-06 · **Status:** mapping for Juan's decisions · **Input:** the Juan × Claude Chat design brief (CHIEF `00-INBOX/2026-08-06-cowork-vendor-ordering-brief.md`). Chat is blind to current CO-OPS; this doc maps its shape onto the shipped delivery-intake arc (P1 #239, P2 #240, P3 #241 — all prod) and isolates the genuinely new build.

## A. Already shipped — the brief re-derives these (no build)

| Brief section | Shipped equivalent | Notes |
|---|---|---|
| §2 Generate/Review | Par-pass walker (`/ordering`, P3): pars + usage + advisory on-hand → suggested qty → review sheet | Generation exists; what's missing is the ORDER ARTIFACT it should produce (see B1) |
| §4 `received` | Delivery intake door ceremony (P1): expected-vs-received count, discrepancy flags → `vendor_credits` | Maps cleanly — the brief's Q9.4 answer is yes |
| §5 inbound doc store | `email_receipts` + private `receipts` bucket (P2): ingest/upload, ±2d single-candidate auto-link, svix webhook (dormant until DNS) | Built for invoices/receipts; confirmations + SMS are additive |
| §5 exceptions surface | Match attestation (matched/discrepant/override) + credits ledger w/ vendor aggregate + aging + shrinkage signal | The brief's "never silently absorbed" is already law here |
| §7 order-sheet-primary | Draft cards always carry Copy; mailto/tel/portal affordances per `vendor_ordering_details` | Proto-adapter behavior exists |
| §7 no scraping / §8 manual-first | Matches the ratified spec exactly | Convergent independently |
| §6.2 vendor products | `vendor_items`: item_number, pack model, price history, pars | GAPS: guide-sequence position; per-location split (see D1) |
| §6.3 vendor record | `vendor_ordering_details` (method/value/label) + `vendor_contacts` + `order_days`/`delivery_days` | GAPS: tier column; cutoff TIMES (we have days, not times) |

**One important reconciliation:** the P1 council ruled the match "two-way, not three-way" — because no order artifact existed then. The brief's frozen order snapshot supplies the missing third leg. Both were right for their moment: with snapshots, two-way (counted↔claimed) EXTENDS to three-way (ordered↔invoiced↔received). The credits ledger already handles the discrepancy lifecycle; the order leg plugs into it, not around it.

## B. The genuinely new build (what shakes out)

1. **The order as a first-class entity** — `purchase_orders` + `po_lines`: lifecycle `draft → confirmed → placed → invoiced → received → reconciled` (see D3 for `acknowledged`), Confirm freezes the immutable snapshot (lines, qtys, price-at-order from price history, confirmed_by, ET timestamp), every transition audited. THE keystone gap.
2. **Walker → order wiring** — submitting a par-pass CREATES draft POs per vendor (see D2). The walker's review sheet becomes the brief's Review step; a Confirm action freezes; par_pass_lines remain the observation layer feeding the anchor tiers (unchanged).
3. **Transmission tier + adapter seam** — `vendors.transmission_tier (auto|assisted|manual)` config column; adapter contract = confirmed snapshot in, transmission result out; email adapter DORMANT until Resend DNS (then Confirm-is-the-order for rep vendors); assisted/manual = render + explicit "Mark placed" (killing the approved-but-never-ordered gap the brief names).
4. **Cutoffs drive the system** — `vendor_cutoffs` (per vendor, optional per location: cutoff time ET + which order_day it governs); surfacing rides the existing attention-item machinery ("<vendor> cutoff in 3h — draft ready", links to the walker/PO review). This turns the walk from remembered to tapped-on-the-shoulder.
5. **Order-guide sequence** — `guide_position` (per vendor SKU; per-location if D1 splits) + assisted-tier rendering in the vendor's own sort order; MOXē Import Order file eval later.
6. **Intake linkage upgrade** — `vendor_deliveries.purchase_order_id`; door-form expected-lines pre-fill hierarchy gains its intended top source: the CONFIRMED ORDER (spec always listed it; now it exists). Receiving against an order auto-advances it to `received`.
7. **Inbound → order matching** — extend `email_receipts` matching to open POs (vendor + PO ref + date); confirmations captured as metadata/documents on the PO; SMS ingestion later; parse (P4 LLM lane) feeds `invoiced` lines.
8. **PFG EDI** — future adapter behind Confirm, zero upstream refactor. Gated on Juan emailing PFS-SystemsIntegrationSupport@pfgc.com (his errand, Phase-4-contingent).

## C. Proposed phasing (supersedes the old "P4" framing; absorbs it)

- **V1 (build next):** B1 + B2 + B3(manual/assisted rendering only) + B4 + B6. Every vendor works day one; cutoff surfacing live; orders become the intake's expected source. The old P4 items continue-mode hydration + credit aging ride along where they touch.
- **V2 (post-DNS):** email auto-adapter (Confirm-is-the-order) + inbound confirmations/invoices matching to POs + LLM parse (the old P4 core) → `invoiced` + three-way exceptions.
- **V3:** guide sequences seeded + portal deep links + MOXē import eval + barcode scan.
- **V4:** PFG EDI (contingent on their answer) · SMS legs · full-auto tier only-if-asked.

## D. Decisions for Juan (blocking V1 design)

1. **Per-location pars/products:** current SKU pars are GLOBAL (weekday/weekend on vendor_items; seeded from the Cap Hill guide). Split per location now (schema + double data upkeep) or keep global until the shops' pars genuinely diverge?
2. **Walker↔order relationship:** walker submit creates draft POs directly (one artifact chain, recommended) — or keep par-pass and orders as separate layers with manual promotion?
3. **`acknowledged` state:** distinct lifecycle state now, or metadata on `placed` until inbound confirmation ingestion ships (V2)? (Recommended: metadata until V2.)
4. **Ground-truth tiers:** per-vendor truth only Juan knows — who's actually rep-email/text (auto-tier candidates), who's portal (US Foods MOXē, Baldor — assisted), where does Sysco really sit, and which vendors have real cutoff times to seed?

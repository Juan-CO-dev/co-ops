# Vendor Ordering V1 — Design

**Date:** 2026-08-06 · **Status:** for Juan's spec review · **Owner:** CC
**Lineage:** Juan × Claude Chat brief (CHIEF-captured) → brief-to-reality mapping (`2026-08-06-vendor-ordering-mapping.md`) → Juan's four decisions (this doc's §1). Builds directly on the shipped delivery-intake arc (P1-P3).

## 1. Decisions register (Juan, 2026-08-06)

- **D1 — Per-location model (his words):** "Global is supposed to be where both shops activate SKUs from… sometimes locations have different promotional items… par levels are definitely per location and each shop has their own pars." → global `vendor_items` = the registry; a per-location overlay carries activation + pars. Existing `weekday_par`/`weekend_par` on vendor_items become GLOBAL DEFAULTS; the overlay overrides per shop.
- **D2 — Walker births draft POs.** One artifact chain: walk → draft POs per vendor → Confirm freezes → transmit. `par_pass_events/lines` remain the observation layer feeding the anchor tiers, unchanged.
- **D3 — `acknowledged` = metadata on `placed` in V1;** becomes a distinct state in V2 when inbound confirmations flow.
- **D4 — Every vendor seeds at MANUAL tier** ("everyone starts at the lowest pipe"); the vendor profile gets tier/cutoff/adapter config so upgrades are per-vendor flips as the real paths get confirmed (known already: PFG orders via their site → assisted when set).

## 2. Data model (migration 0174)

1. **`location_sku_settings`** (the D1 overlay): location_id + sku_id (unique pair), `active_override boolean null` (null = inherit global active; false = deactivated at this shop; true = active here even if promotional/location-specific), `weekday_par numeric null`, `weekend_par numeric null` (null = inherit global default), audit cols. Seeded: NO rows initially — pure inheritance means day-one behavior is exactly today's; shops diverge by writing overrides. Resolution rule (one shared pure fn): `parFor(location, sku, day)` = overlay value ?? global value; `activeAt(location, sku)` = overlay.active_override ?? sku.active.
2. **`purchase_orders`**: id, location_id, vendor_id, par_pass_event_id null (born-from), status `draft|confirmed|placed|invoiced|received|reconciled` (D3: no acknowledged), confirmed_snapshot jsonb null (frozen at Confirm: lines w/ qty, unit label, price-at-order from latest price history, guide refs), confirmed_by/at, placed_by/at, placed_note (D3 ack metadata lives here + jsonb `ack` field), cutoff_at_confirm timestamptz null, created_at. Append-only rows; status transitions app-layer with rowcount checks; every transition audited (`po.confirmed`, `po.placed`, `po.received`, `po.reconciled` — dot-namespaced).
3. **`po_lines`**: po_id, sku_id, order_qty, order_unit_label, price_cents_at_order null, guide_position_snapshot null, note. Editable while `draft`; frozen after Confirm (the snapshot jsonb is the dispute anchor; lines table serves queries).
4. **Vendor config:** `vendors.transmission_tier text default 'manual' check (auto|assisted|manual)` + `vendors.portal_url text null` (assisted deep link; `vendor_ordering_details` remains the contact/method registry the adapters read) + **`vendor_cutoffs`**: vendor_id, location_id null (null = both shops), order_day smallint (0-6), cutoff_time time (ET), active. A vendor may have multiple (per order-day) cutoffs.
5. **`vendor_items.guide_position integer null`** (global; assisted-tier sort; per-location variance NOT modeled until real — YAGNI).
6. **`vendor_deliveries.purchase_order_id uuid null`** — the intake↔order link.

## 3. Lifecycle + flows

- **Draft birth (D2):** walker submit creates one `draft` PO per vendor (orderQty > 0 lines) alongside the existing par-pass artifacts + draft cards. Drafts also spawn WITHOUT a walk via cutoff surfacing (§4): "generate draft now" builds one from suggestedQty (walker machinery reused server-side).
- **Confirm:** KH+ reviews the draft (same review-sheet UX, now backed by the PO), taps Confirm → snapshot frozen (prices resolved from `vendor_price_history` latest-at-confirm; ET timestamp; cutoff_at_confirm stamped when a cutoff governs today). Draft lines lock.
- **Transmit (tier switch):** auto (V2, dormant — no vendor can select it until the email adapter wakes post-DNS; the column allows it, the UI marks it "requires email setup") · assisted → render lines in `guide_position` order (nulls last, then name) + portal_url deep link + "Mark placed" · manual → render + contact card (vendor_contacts + ordering details) + "Mark placed". Mark-placed records placed_by/at + optional note (D3 ack metadata). **No pipe failure can block ordering: the rendered sheet + Copy is always present** (brief §7, already house behavior).
- **received:** door-ceremony intake gains PO awareness — when an open `placed` PO exists for the vendor+location, the intake pre-fill hierarchy uses THE PO's lines as expected (top source, superseding last-delivery), links `vendor_deliveries.purchase_order_id`, and completing the delivery advances the PO to `received` (partial deliveries: PO advances only when the delivery completes; multiple deliveries per PO out of scope V1 — note in intake when a second delivery claims a PO).
- **reconciled (V1-thin):** received + all its credits resolved → a "Mark reconciled" action (AGM+) on the PO detail; automated three-way (invoice leg) is V2 with parsing. The PO detail page shows the trail: snapshot vs received vs credits.

## 4. Cutoff surfacing

`loadOrderingAttention(actor, locationId)`: for today (ET), vendors with an active cutoff on today's order_day where NO PO ≥ confirmed exists today → attention item `ordering_cutoff` (yellow; "‹vendor› cutoff {time} — {draft ready|no draft yet}", links to /ordering). Rides the mid-shift pulse exactly like shrinkage (fail-open). The walker page shows the same cutoff chips on vendor sections ("cutoff 3:00 PM").

## 5. Surfaces

- **/ordering** grows: draft-PO list ("Today's orders": draft/confirmed/placed chips per vendor) above the walk affordance; the post-walk review becomes the PO review (Confirm + tier-appropriate transmit affordances + Mark placed). PO history + detail (snapshot, transitions, linked delivery, credits, reconcile action).
- **Vendor admin profile:** tier selector (auto disabled w/ "requires email setup" until DNS) + portal URL + cutoffs editor (day+time rows) — extends the existing vendors admin per its disclosure patterns.
- **SKU admin:** per-location tab/section on the SKU editor for overlay values (activation toggle + par pair per shop) — reads/writes `location_sku_settings`; global fields unchanged.
- **Walker/anchors:** walker reads `parFor(location, …)` + `activeAt(location, …)` everywhere it currently reads global pars/active. `submitParPass` snapshots the RESOLVED per-location par (anchor math unchanged — implied oz already snapshots par_qty).

## 5b. Inbound attribution — the two-store email problem (Juan, 2026-08-06)

Juan's gap: both stores' vendor documents arriving at one address must sort correctly. The scheme (his proposal, which the shipped P2 architecture already anticipates — `locations.receipt_email_address` exists, and `locations` carries `address` + `code`):

1. **Per-store aliases are the primary attribution key.** `pstreet@complimentsonlysubs.com` / `8thstreet@…` (final names Juan's call at DNS time) → each set as that location's `receipt_email_address`. Resend inbound routes any address on the domain to the one webhook; ingestion already attributes by to-address match. A primary `vendors@…` catch-all is legitimate: mail to it lands UNATTRIBUTED (location_id null) in the existing triage/link queue — sorted by a human, never lost, never guessed.
2. **Outbound sends FROM the store's alias (V2 adapter law):** the email adapter sets from/reply-to = the ordering location's alias, so vendor replies (confirmations, invoices) return self-sorted to the right store. Attribution starts at transmission, not ingestion.
3. **Location-prefixed PO codes in every subject:** confirmed POs get a display code `{location.code}-{YYYYMMDD}-{vendor short}` rendered into transmission subjects/bodies (V1 does this already in the manual/assisted rendered sheets). Inbound documents quoting it match deterministically to both the order AND the location — the strongest key, human-readable in disputes.
4. **Ship-to address as the V2 parse-time fallback:** vendor invoices carry the delivery address; the LLM parse extracts ship-to and matches against `locations.address` when neither alias nor PO code resolves. Matching-key precedence: PO code > to-alias > ship-to > vendor+date window (single-candidate rule, per the shipped P2 law: auto-attach only when unambiguous, else triage).

## 6. Non-goals (V1)

Email/SMS transmission (V2, post-DNS) · inbound confirmation/invoice matching to POs + LLM parse (V2) · guide-sequence seeding beyond the column (V3 does the data entry + MOXē import eval) · PFG EDI (V4; Juan emails their integration team meanwhile) · multiple deliveries per PO · per-location guide positions · full-auto ordering (not designed; adapter seam doesn't preclude).

## 7. Migration/rollout notes

0174 is additive-only. Day-one behavior identical everywhere until: a cutoff is entered (surfacing starts), a tier is flipped (assisted rendering starts), an overlay row is written (per-location divergence starts). The walker keeps working exactly as shipped, now leaving PO artifacts behind. Seed: all vendors `manual`; no cutoffs; no overlays — Juan/GMs populate from the vendor profiles as truth gets confirmed (D4).

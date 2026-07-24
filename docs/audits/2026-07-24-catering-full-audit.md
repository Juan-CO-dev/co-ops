# Catering Feature — Full Audit (2026-07-24)

**Method:** three parallel auditors (plan-vs-built over all 10 catering/toast/ezcater specs · end-to-end wiring over 5 chains · deferred/dormant reconciliation) + prod-DB verification (migrations, row counts, pg_policies). Material claims independently verified before inclusion. Fixes PR: #177.

## Verdict

**The catering feature is consistent with its plans, structurally complete, and properly wired — with one HIGH wiring defect (fixed in #177), two RLS-discipline gaps (migration 0150, staged), one silent data gap (napkins), and an honest, fully-enumerated backlog.** Every core chain is connected call-site-to-call-site; every "empty" surface in prod is explained by a named data/credential gate, not missing code.

## Wiring (5 chains traced through real call sites)

- **Customer funnel** `/order` → start (geocode/route/preselect) → magic link → draft → build (sizes, package configurator) → review → submit → quote → pay-seam: **CONNECTED**; server price authority (D20) holds at every step — `resolveLines`/`previewDraft`/`submitDraft` all recompute server-side; client prices never read.
- **Staff moat** lead → quote (W1a/W1b) → confirm → `reservePrepDemand` (incl. package-picks resolution) → W4b SKU flatten → cancel → release → W4c-a surplus classifier → W4c-b LTO → `pushLtoToPos` stub: **CONNECTED** end-to-end.
- **Intake channels** portal (`lead_source='portal'`), staff punch-in (source registry + `assigned_to` + non-assignee edit logging), EZCater webhook (HMAC → ledger → auto-lead): **CONNECTED**; proxy permits `/api/webhooks/*` + `/api/cron/*`.
- **Toast read stack** crosswalk tab → routes → lib; Sales tab → ingest → graph engines; cron → `pullSalesForAllLocations`: **CONNECTED**.
- **Reachability:** every catering surface nav-reachable EXCEPT `/admin/catering/rate-rules` — **the W1a rate editor had zero inbound links** (fixed: hub card in #177). Observation: `zones` vs `fulfillment` hub cards both read as delivery-zone editors — label-clarity only.

## Plan-vs-built (10 specs)

All ten specs (W1a, 3a, funnel-⑤, à-la-carte sizes, package configurator, menu admin, toast crosswalk, toast sales, intake attribution, ezcater intake) verified **built-as-spec**, with declared deferrals accurate. Material discrepancies, all addressed:
1. `catering_rate_rules` missing insert/update deny policies (0128) — **0150 staged**.
2. `catering_package_slot_options` zero explicit policies (0136) — **0150 staged**. (Default-deny held in both; discipline gap, not a hole.)
3. **Napkins & Utensils item absent from prod** — the `/order/review` add-on toggle is a silent no-op (seed script was dev-only). Needs a prod seed (dev script priced it $25 flat) — **Juan's price call**.
4. Funnel-⑤ vs configurator-B spec contradiction on packages-as-CTAs — **supersession note added** (#177).
5. Toast sales spec described `diningOption.name` — implementation (correctly) uses the reference-shape + config-API names per PR #174's review — **spec corrected** (#177).

## Prod DB layer

- Migration lineage **complete**: 0001→0149 all applied, one lineage, catering 0109–0149 verified individually.
- Dormancy map (all zeros explained): prep_demand 0 — **no lead has ever been confirmed in prod** (5 portal leads all at inquiry; the moat has never fired on real data, by dormancy not defect); payments 0 (no provider); fulfillment_nodes 0 (zone config pending); toast_*/ezcater_* 0 (credential errands pending); lto 0 (no surplus). Seeded config present: 68 menu_items, 16 packages + 108 slot options, 8 item_sizes, rate-rule baseline ×2.

## Stub-consumer check (no UI pretends success)

`pushLtoToPos` → `not_pushed` handled honestly on `/lto` · `initiatePayment` stub → explicit "payment isn't wired yet" message, intent still recorded · `/order/checkout` is a labeled mockup off the real path · `fetchPlatformOrders` seam now a **dead export** (EZCater went webhook — candidate for removal or future poll-capable providers) · **`markPaymentPaid` is fully built but has NO route/UI consumer** — staff cannot manually mark a check/cash payment paid; recommended small fast-follow.

## The honest backlog (consolidated, deduplicated)

**Gated on Juan (externals/decisions):** payment provider + Net-30/60 (L) · Toast creds errand · ezManage token errand + setup script · fulfillment-node zone config · napkins prod seed price · Resend DNS (magic-link/confirmation emails allowlist-only until then) · Toast write track = rep conversation.
**Real deferred work (by size):** EZCater quote synthesis #2c-b (M, unlocks auto-reserve) · build-page package slot picker for customers (M) · per-lead pipeline detail page (M) · Toast spec #3 variance (M, needs weigh-checklist honest) · Module #17 LTO performance (M) · hard capacity hold (M) · general over-prep surplus source (M) · staff quote builder per-location reskin (S-M) · portal-wide i18n/es (L — the customer funnel is English-only) · 3a-print (S) · reorder pre-fill (S) · per-location delivery windows (S) · `markPaymentPaid` route+UI (S) · abandoned-draft sweep (XS) · LTO expired auto-flip (XS) · W1b per-head scaling (XS).
**Previously-deferred now DONE:** package-picks W4a consumption, à-la-carte sizes, package configurator, menu admin C, funnel carry-through, Toast 1+2, intake attribution 2b, EZCater 2c — all merged with migrations 0143–0149 in prod.

## Fixes shipped in PR #177 (held per standing rules)

Hub card for rate-rules · migration 0150 deny triads (staged) · LTO i18n papercuts (2) · both spec corrections · this report.

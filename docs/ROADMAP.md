# CO-OPS ROADMAP — the living "what's left" list

> **Canonical.** Council-produced 2026-07-29 (session `.claude/council/2026-07-29-roadmap/`,
> six blind seats, repo-verified). **Supersedes `docs/REMAINING_SCOPE.md`** (2026-06-13,
> severely stale — do not plan from it). Update this file at every arc-close; keep NOW
> capped at 3 builds. Dated entries; delete, don't strikethrough.

**The strategic read (unanimous):** the center of gravity has moved from BUILDING to
LIGHTING UP. The deepest stacks (Toast depletion, the catering moat, pack chains) are
built and dormant behind owner externals. Converting dormant→live outranks new builds.

---

## JUAN'S ERRANDS (the highest-leverage list in this file)

1. **Toast prod credentials** → first-live re-verification → sales-pull cron live.
   Unlocks: real consumption → true count variance → depletion-into-drift →
   Dynamic Pars velocity → (eventually) Store Ordering. The keystone.
2. **Resend DNS** → magic links reach real customers (today the allowlist gates them
   to juan@). Unlocks: real catering leads → the W1/W4 moat finally breathes.
3. **Two-minute decisions:** photo storage target (recommended: Supabase Storage);
   cash-gate → hard_gate fold (a single data flip on the template item — zero code).
4. Standing data errands (tools all built and waiting): 9 deli pack chains (the
   wizard) · 34-line needs-link backlog (the builder's Doctor) · shop weigh pass 2
   (calibration checklist) · catalog curation (on_hand flips, cleaning/misc classes)
   · fulfillment nodes radius config · catering rate rules authoring.
5. **Strategic decision when ready:** payment provider (Stripe/Square/Toast) — gates
   portal launch; has tax/accounting implications; deserves its own sit-down.

## NOW (build — small, unblocked, dormant→live)

1. **Photo uploader seam** — IN FLIGHT (branch `claude/photo-uploader`, 2026-07-29):
   migration 0164 (photos registry + private bucket) + lib/photos-shared (pure, tested)
   + lib/photos + POST/GET /api/photos (replaces the 501) + PhotoCapture component +
   wired ChecklistItem (closing/am_prep/mid_day) + ReceivingForm (line photo + receipt)
   + reports detail photo links. Opening capture UI = fast-follow (see DEBT). One PR + smoke.
2. **Written Reports (#2) + Settings** — the two council-named highest-value stubs.
   Written Reports' DB schema + types ALREADY EXIST (build = lib + routes + page;
   incident/observation capture that today lives in text messages). Settings first
   or parallel (small; establishes the user-preferences pattern).
3. **Ops guardrails mini-arc** — cron-failure alert (toast-sales-pull fails silently),
   backup/restore runbook + drill, adoption card (audit-log-derived "surfaces used
   this week"), markPaymentPaid wiring (built fn, zero UI — staff cannot record a
   check/cash payment as paid), orphaned-mirror Doctor check (code comment claims it
   exists; it does not).

## NEXT (the moment Toast goes live)

- **First-real-data hardening pass** (budgeted: expect crosswalk/spec-vs-reality gaps
  on the first real payloads).
- **Toast-depletion-into-drift** (read-track spec #3): depletion feeds counts'
  consumed side → TRUE variance. Drift is already correct for prep-consumed items;
  retail-sold items are blind until this.
- **Dynamic Pars — design session** (owner-called). Build AFTER consumption data
  flows; weather bootstraps from the existing manual weather field on the daily
  report before any feed is built. Then EZCater 2c-b when the ezManage token lands.

## LATER (sequenced, not forgotten)

- **Store Ordering (Phase 5)** — the capstone every inventory arc points at (SKU par
  → purchase orders; sku_par + purchase_order tables are greenfield). After
  depletion-live. Par input starts STATIC (valid v1); Dynamic Pars enriches it.
- **Storefront i18n (`/order/*` Spanish)** — deliberately re-timed: the portal is not
  customer-live while payment + DNS pend; translate BEFORE launch, not before.
- **Deep Cleaning (#15)** — post-photo-seam (photo-verified by design); the template
  builder already supports the deep_cleaning type (lower lift than assumed).
- **Tip Pool (#11)** — decide the 7shifts-adapter question first (no adapter exists;
  without it, hours are manual entry permanently).
- **The comms family** — Announcements (schema exists) → Internal Comms → incident
  escalation path. Then: Shift Overlay + Prep Sheet + Today's Synthesis (read
  surfaces; want Written Reports live first) · staff Recipes viewer (cheap read) ·
  Rollups / AI Insights (need months of data) · Module #17 LTO measurement (needs
  lto_events volume) · admin Audit/Locations/Pars pages.
- **Food-cost % / margin dashboard** — the owner's number; natural fast-follow once
  Toast sales + inventory costs are both live. Not yet designed; on the radar.
- **Tenant-config T1** — GATE UNCHANGED: 30 consecutive days of real CO use OR a
  named warm prospect. Do not build speculatively.

## RADAR (named risks — not builds yet)

Monitoring/alerting (sustained 5xx at 6 AM = nobody knows; audit is fail-open by
design) · bus-factor/credential SPOF (one person holds every key; runbook + break-
glass access) · CCPA/data-export for portal customers (design before volume) ·
void/comp visibility depends entirely on Toast sales-pull · count-validation workflow
(periodic manual count vs the received−used advisory sharpens W4b TODAY, no code) ·
offline/dead-zone resilience (walk-ins, basements) · customer-facing menu display
(exists? wanted?) · first-live cred rotation when Toast write access lands.

## DEBT (each with its trigger)

| Item | Fire when |
|---|---|
| Opening photo capture UI (server ready) | next opening-client touch |
| Orphaned-mirror Doctor check | NOW (comment already promises it) |
| reconcileRefTrackItems N+1 batch | before ref_track real adoption |
| Spine-link DB CHECK + item_id FK action | after the 34-line needs-link backlog clears |
| warn/info token surface hex collision | next theme touch |
| TemplateBuilderClient updater side-effect | next builder-client touch |
| order/build textarea aria association | next storefront touch |
| i18n dead-key sweep (whitelist-aware) | after stub modules build (their keys resolve) |
| rk()/TranslationKey cast class | when the i18n key map next churns |
| Storefront back-link constellation (~10 pages) | with the storefront-i18n arc |
| Dead exports: fetchPlatformOrders | delete opportunistically |
| AGENTS.md migration count + stale live-list line | fixed in this docs push |

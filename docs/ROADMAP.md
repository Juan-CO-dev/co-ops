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

1. ✅ **DONE — Toast is LIVE (verified 2026-07-31 against prod: live auth probe +
   daily cron.success + ~8k toast_sales_events since 07-23, both shops; GUIDs set
   07-25; crosswalk confirmed 07-25..27).** This errand was stale — the keystone
   already turned. What it unlocks is now a BUILD queue, not an errand: sales are
   banked but nothing consumes them yet → **depletion-into-drift is the real NEXT.**
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

**✅ NOW COLUMN COMPLETE (2026-07-30):** photo uploader (#211, mig 0164), Written
Reports + Settings (#212), ops guardrails (#213 — cron visibility, backup runbook,
adoption card, mark-paid wiring, orphaned-mirror check). The board now waits on the
owner keystones below; the next NOW column gets written when one of them turns.

**✅ OWNER-INTERRUPT ARC (2026-07-30, same day):** the checklist FULL-EDIT arc —
meatball-question hotfix (#214) → prep full-edit floor (#215) → question input
types for closing lists (#216, mig 0165) → prep overview + Doctor in the builder
(#217). Council session `.claude/council/2026-07-30-checklist-fulledit/`. Named
follow-up with trigger: question input types on OPENING lists (fire when the
opening Phase-1 answer path learns input_type). Trust-recovery errand (Juan):
paper-audit the AM prep template + walk the opener through it once.

**✅ QUALITY-HARDENING PASS (2026-07-31):** 8-seat whole-app council → 5 fix
batches ALL merged (#224–#233): security/correctness (finalize gate, toast-map
IDOR, operational-day UTC family, sales silent-zero taint), visible breakage
(order-review cart-loss), the batching pass (reports-hub ~182→~5 queries),
seam hygiene (honest toast/shifts stubs, prune-sessions cron), UX/i18n
(IdleTimeoutWarning app-wide, /lto into (authed), specific link errors).
Q1/Q2 owner decisions closed in #234 (toast_daily_data KEPT + annotated;
gate-predicate engine kept, stale comments fixed). Register:
`.claude/council/2026-07-31-quality-hardening/report.md`. Deferred w/ triggers
→ DEBT table below.

**✅ MID-SHIFT PULSE ARC (2026-07-31/08-01):** 7-seat council (incl. a blind
Fable seat that caught the open-day gap-taint interaction) → 3 PRs ALL merged:
#235 live Toast sales panel + same-day pull triggers (closing-confirm +
45-min-debounced on-visit; EVENTS-ONLY law — nightly cron stays the sole
ledger materializer; open-day gap guardrail) · #236 location tabs +
active-today attribution + parallel loaders (~3-4×) + named overdue states ·
#237 Pulse Score (green/yellow/red) + catering-due-today strip (quiet when
empty — owner-confirmed) + unchecked-fridge alert. Session:
`.claude/council/2026-07-31-midshift-pulse/report.md`.

## NEXT

- ✅ **Toast-depletion-into-drift DONE (PR #220 `a2ec9bd`, 2026-07-31; mig 0166).**
  Register sales now feed counts' consumed side via the direct-lane daily ledger
  (the double-count law: direct-sale SKUs vs production-covered SKUs, never both).
  Backfilled + lane-verified against the banked week (Sub Roll 4,728 oz direct /
  0 flattened at Cap Hill — ~150 rolls/day).
- ⭐ **THE FIRST PHYSICAL SKU COUNT (Juan — now the #1 errand).** `sku_count_events`
  is EMPTY: every pipe is connected (receiving in, production + register sales
  out) but variance has no starting line until a count anchors it. First count →
  on-hand/variance goes live for every SKU touched — AND fires two queued builds:
  the mid-shift low-stock/under-par attention item (designed, council 2026-07-31)
  and the counts `loadOnHand` per-SKU batching pass (deferred until real count
  data exists to verify against).
- **Dynamic Pars — design session** (owner-called) once a count cycle + sales
  velocity have a couple of weeks of data. Weather bootstraps from the existing
  manual weather field on the daily report before any feed is built. Then
  EZCater 2c-b when the ezManage token lands.

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
| counts loadOnHand + detectRetroEditStaleness per-SKU batch | first SKU count (verify against real data) |
| loadPublicCateringMenu 3×/cart-cycle threading (D20 path) | real customer cart traffic |
| midshift low-stock/under-par attention item (designed) | first SKU count |
| lto_events pos_push_status write-back | Toast write-access phase |
| 108 `as TranslationKey` casts (folds into the rk() row) | i18n key-map churn |
| gate-predicate convergence (author opening predicate, delete loadPriorClosingState) | if/when configurable gates get a 2nd customer |
| midshift per-location EXPECTED_BY hours | when MEP/EM store hours diverge |

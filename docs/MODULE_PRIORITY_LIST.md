# CO-OPS Module Priority List

**Last updated:** May 5, 2026
**Status:** Living document — updated whenever module sequence changes
**Source of truth:** This document. All other module lists in spec docs, handoffs, or conversations are reference-only.

---

## Purpose and How to Use This Document

This is the canonical build-order document for CO-OPS modules. It captures three things:

1. **The original 16-module priority list** locked in April 2026 (verbatim, never edited)
2. **The evolution log** — every change since April 2026 with date and reason
3. **The current updated priority list** — what to actually build next

Future-Claude reading this on cold-open should:

- Read the **Current Updated Priority List** (Section 5) first to know what's next
- Read the **Module List Evolution Log** (Section 4) to understand why the order changed
- Refer to the **Original 16-Module List** (Section 2) only when historical context is needed
- Update this doc whenever module sequence changes — capture the change in the evolution log

This document lives alongside `AGENTS.md`, `SPEC_AMENDMENTS.md`, and the foundation spec (`CO-OPS_Foundation_Spec_v1_X.md`) as a primary architectural reference.

---

## 1. CO-OPS Build Pattern

Foundation-first build pattern locked in April 2026:

1. **Foundation** — full schema, auth, RLS, integration adapters, navigation shell, photo service, notification infrastructure, AI integration layer, search/filter/read receipts infrastructure, expand/collapse card pattern, inventory item registry, audit logging, admin tools (location/user/par-level management). All ~18 tables exist on day one even if most are empty. Toast + 7shifts + SMS adapters scaffolded but not yet connected.
2. **Modules built sequentially** after foundation ships, each as a separate Claude Code session, each adding views/forms/business-logic against tables that already exist with permissions that already work.

**Key architectural principle:** modules are additive, not invasive. Each module fills in views against the locked foundation contract. No module rewrites schema, permissions, or navigation.

---

## 2. Original 16-Module Priority List (April 2026 — Reference Only, Never Edited)

This is the locked-at-foundation-time list. It represents the priority order Juan and Claude agreed to in the foundation-spec planning session before any module shipped to production. Preserved verbatim for historical reference.

| # | Module | Why this priority | Foundation dependencies |
|---|--------|-------------------|---------------------------|
| 1 | **Daily Report** | The core data capture loop. Nothing else has value until this is live. | Roles, locations, inventory registry, photo service, audit log |
| 2 | **Report Review (Reports Hub)** | Closes the loop — submitters see reports get read, recipients see flow. | My Reports/Inbox queries, search/filter, expand/collapse, read receipts |
| 3 | **AI Insights** | Turns raw data into management leverage. Pete's first "wow" moment. | AI adapter, role-scoping, handoff flag logic |
| 4 | **Vendor Module** | Captures cost data systematically. Builds price history starting day one. | Vendor tables, photo service, audit log |
| 5 | **Inventory Ordering** | Pairs with Vendor Module. Closes par → order → delivery loop. | Vendor module live, par levels, daily report inventory data |
| 6 | **Internal Comms** | Operational glue for the team. In-app first, SMS when A2P clears. | Notification infrastructure, SMS adapter, user_notification_prefs |
| 7 | **Maintenance Log** | Equipment notes from daily reports get a real workflow home. | Photo service, audit log, daily report data |
| 8 | **Cash Deposit Confirmation** | Closes cash-handling loop, Cristian's accountability win. | Photo service, daily report cash data |
| 9 | **Tip Pool Calculator** | Eliminates a 20-minute weekly chore, generates per-employee tip data. | Cash tip data from daily report, user list |
| 10 | **Catering Pipeline + Customers** | Maria's primary workflow tool. Self-contained module. | Catering tables, follow-up surfacing on dashboard |
| 11 | **Recipe Flash Cards** | Reference tool for line. Long-tail content build by chef/Pete. | Photo service, video URL field |
| 12 | **AOR / Training Module** | Tap-each-as-complete checklists generate per-employee performance data. | Positions, training tables, audit log |
| 13 | **Deep Cleaning Rotation** | Auto-distribution algorithm + photo verification. | AOR module live (shares completion-tracking pattern), photo service |
| 14 | **Customer Feedback** | Public no-login form. QR code on Toast receipts. | customer_feedback table, AI insights integration |
| 15 | **LTO Performance Tracking** | Pete's LTO decision-support tool. Lightweight module. | Daily report data, weekly rollup integration |
| 16 | **Weekly + Monthly Rollups** | Auto-generated forecast fuel. Last because it needs ~12 weeks of data to mean anything. | Everything above. This is where forecasting starts. |

---

## 3. Reconciliation: What Actually Shipped vs. Original Plan

The original "Module 1: Daily Report" got expanded substantially during Build #1 → Build #2 because operational reality surfaced multiple distinct *types* of reports rather than a single "Daily Report." The mapping from original to shipped:

### Build #1 (Foundation, March-April 2026)

Shipped the foundation layer per the architectural plan. 14 clean PRs. Established the working rhythm: commit-per-step, PR-per-step, CI gate enforcement, no admin bypass, squash-merge with rebase-onto-main between PRs.

This wasn't a "module" in the priority list sense — it was the foundation that all modules build on top of. ✅ Shipped.

### Build #1.5 (i18n architecture, April 2026)

Translate-from-day-one architecture (C.37), system-key vs display-string discipline (C.38). Business keys stay English source-of-truth, translation at render time only.

Not a module per the original list — it's foundational i18n that unlocks every future module. ✅ Shipped.

### Build #2 (May 2026 — Multi-PR arc)

What shipped: **AM Prep vertical slice + Standard Closing v2 + C.46 post-submission edit with chained attribution.**

How this maps to the original list:

- **Original Module 1 ("Daily Report")** turned out to be NOT a single thing. Operational reality at CO has multiple report types — AM Prep, Closing, Mid-Shift, PM, Catering, Maintenance, Cash Deposit. Build #2 shipped the first two (AM Prep + Standard Closing v2) plus the chained-edit / attribution architecture (C.46) that ALL future report types will inherit.
- **Original Module 2 ("Report Review / Reports Hub")** was NOT shipped in Build #2. The auto-complete + report-reference-item pattern in C.42 + C.46 gives a primitive form of cross-report visibility (closing references AM Prep, AM Prep submitter sees "Edit AM Prep" affordance), but a full Reports Hub waits until more report types exist.

**Production identifiers from Build #2:**
- PR 1 squash `dc85e7e` — AM Prep vertical slice + Standard Closing v2
- PR 2 squash `3cc856d` — TZ canonical lift + required-fields validation
- PR 3 squash `6de8190` — C.46 post-submission edit with chained attribution
- Cleanup 1 squash `960d0fa` — v1 Standard Closing flip-to-inactive
- Cleanup 2 squash `7857411` — formatDateLabel canonical lift + Spanish-UX fix

**Insight from the reconciliation:** the original "Module 1: Daily Report" assumed a single artifact. Reality required separating it into per-report-type modules with shared infrastructure (chained edits, audit emission, snapshot universe locking, validation). Build #2 shipped two report types and the shared infrastructure. Remaining report types ship next.

---

## 4. Module List Evolution Log

Every change to the priority list with date and reason. Append-only — never edit prior entries.

### April 2026 (Original list locked)

16 modules sequenced per Section 2. Locked at end of foundation-spec planning session. No edits until production reality forced reconciliation.

### May 5, 2026 (Build #2 close-out reconciliation)

After Build #2 shipped (AM Prep + Standard Closing v2 + C.46), the following changes were locked:

1. **"Module 1: Daily Report" decomposed into per-report-type modules.** Operational reality surfaced multiple distinct report types rather than a single artifact. AM Prep + Standard Closing v2 shipped as Build #2; remaining report types (Mid-Shift, PM, Catering, Maintenance, Cash Deposit) become individual modules.

2. **"Module 2: Report Review (Reports Hub)" deferred.** Originally sequenced as #2 in the build order, now deferred until the full set of report types exists. Reports Hub needs a complete corpus to search/filter across — search/filter on 2 report types is thin; on 6-8 types it's substantive. New position: ships after all report types are live.

3. **"Module 3: AI Insights" moved to back-of-list.** AI Insights depends on months of operational data to produce meaningful output. Will only have ~2 weeks of AM Prep data on production by the time spec v1.3 ships. Pushed back to ensure data foundation exists before insight generation. New position: late-stage module (after ~3-6 months of operational data).

4. **New module added: Time Clock (C.47).** Geofenced login=clock-in / logout=clock-out time tracking integrated with Toast + 7shifts. Architecture locked May 5, 2026; deferred 6-12 months until Toast + 7shifts integration phase. CO-OPS as event source → 7shifts as punch sink (writeable POST /time_punches) → Toast Payroll CSV downstream. Browser-only PWA, foreground location only, manager-gap reconciliation primary. Folds into spec v1.3 as architectural amendment.

5. **Time Clock + AI Insights both pushed to back-of-list.** Both depend on substrate that doesn't exist yet:
   - Time Clock requires Toast + 7shifts integration adapters connected (Phase 2 of integration work)
   - AI Insights requires ~3-6 months of operational data

### Reasoning for the May 5, 2026 changes

The original sequence assumed Module 1 was a single artifact and that Module 3 (AI Insights) could ship early to be Pete's "first wow moment." Production reality changed both assumptions:

- **Pete already had his "wow moment"** when AM Prep + Closing v2 shipped and Cristian started using it operationally. AI Insights doesn't need to be early — it's downstream value when data exists.
- **Module 1 fragmentation** is healthy, not concerning. Each report type teaches the platform something specific (AM Prep = inventory snapshot + prep tracking; Closing = settlement + reconciliation; Mid-Shift = operational pulse). Shipping them sequentially lets the architecture prove out per type.

### May 6, 2026 (Wave 2 ordering refinement)

After Build #3 PR 2 (Opening Report Phase 1 Verification Checklist) shipped, the following change to Wave 2 ordering was locked:

**Wave 2 ordering refinement — Opening Report sequenced before Mid-day Prep; Mid-day Prep added as separate module from Mid-Shift Report.** Original §5 Wave 2 listed Mid-Shift Report; Build #3 design conversation (2026-05-05/06) clarified two distinct concerns: (1) Mid-day Prep is the operational capture artifact for mid-shift prep submissions per C.43; (2) Mid-Shift Report is a future read surface aggregating Mid-day Prep + Toast read + other mid-shift signals. Opening Report (Build #3) sequenced before Mid-day Prep (Build #4) because Opening's bring-to-par output is what Mid-day Prep depends on for ground truth. Mid-Shift Report stays in Wave 2 ordering after capture artifacts are live. Captured in `BUILD_3_OPENING_REPORT_DESIGN.md`.

---

## 5. Current Updated Priority List (May 5, 2026)

This is the active build sequence. Modules grouped by **shipping wave** rather than rigid #1, #2, #3 numbering — because some can ship in parallel (e.g., individual report types) and some have hard dependencies (e.g., Reports Hub needs all report types live first).

### Wave 0: Build #2 close-out (✅ DONE)

- AM Prep (Build #2 PR 1)
- Standard Closing v2 (Build #2 PR 1)
- C.46 post-submission edit + chained attribution (Build #2 PR 3)
- Cleanup PRs (v1 closing flip, formatDateLabel lift)

### Wave 1: Spec v1.3 refresh (✅ shipped 2026-05-06, squash fbf6930)

Mechanical fold of amendments C.16-C.46 into v1.2 base + integration of C.47 (Time Clock architectural commitment). Pure documentation work, no code. Closes Build #2 fully and produces unified source of truth before Module #2 work begins.

### Wave 2: Remaining report types (after Wave 1)

Each ships as its own focused module per the locked Build #2 architecture (chained edits, audit emission, snapshot universe locking, validation). Order within this wave is tunable based on operational urgency.

| Module | Why it matters | Dependencies |
|---|---|---|
| **Opening Report** (Build #3, ✅ shipped 2026-05-06, squash a02022f) | Phase 1 morning verification + bring-to-par output that Mid-day Prep depends on for ground truth | Build #2 patterns, closing v2 cross-references |
| **Mid-day Prep** (Build #4) | Operational capture artifact for mid-shift prep submissions per C.43 (multiple instances per day, numbered) | Build #2 + Build #3 patterns, Opening's bring-to-par output |
| **Mid-Shift Report** | Future read surface aggregating Mid-day Prep + Toast read + other mid-shift signals (distinct from Mid-day Prep capture artifact); read-surface default per AGENTS.md (f) | Mid-day Prep live, Toast adapter |
| **PM Report** | Late-day operational data (closing-prep but not closing) | Build #2 patterns |
| **Cash Deposit Confirmation** | Closes cash-handling loop, Cristian's accountability win (was Module 8 in original list) | Photo service, daily report cash data |
| **Maintenance Log** | Equipment notes from daily reports get a real workflow home (was Module 7 in original list) | Photo service, audit log, daily report data |
| **Catering Reports** | Maria's catering operation tracking, distinct from catering pipeline | Catering tables, photo service |

**Sequencing within Wave 2:** Opening Report shipped first (Build #3); Mid-day Prep ships next (Build #4) because Opening's bring-to-par output is its ground truth dependency. Mid-Shift Report follows once Mid-day Prep capture is live (it's a read surface over Mid-day Prep + Toast). PM Report, Cash Deposit, and Maintenance Log can ship in parallel once their substrate modules (Build #2 patterns, Toast read, audit log) are sufficient. Catering Reports ship last in Wave 2 — Maria's catering operation tracking is operationally bounded (no cross-template dependencies) so it doesn't unblock other work; capture artifact for catering events is its own scope.

### Wave 3: Reports Hub (after Wave 2 substantially complete)

The "Module 2: Report Review" from the original list. Search/filter/read receipts across the full corpus of report types. Ships after Wave 2 is substantially complete so the Hub has real content to search across. Read receipts + Inbox/My Reports queries + cross-report visibility + audit trail surfacing.

### Wave 4: Vendor + Ordering pipeline (after Wave 3)

| Module | Why it matters | Original list # |
|---|---|---|
| **Vendor Profiles** | Cost data capture starts immediately (Cardinal, Baldor, Sysco, Keany, etc.) | #4 |
| **Inventory Ordering** | Pairs with Vendor Module. Closes par → order → delivery loop | #5 |

These pair tightly. Vendor Profiles ships first; Inventory Ordering follows shortly after.

### Wave 5: Operational tooling (after Wave 4)

| Module | Why it matters | Original list # |
|---|---|---|
| **Internal Comms** | Operational glue for the team. In-app first, SMS when A2P clears | #6 |
| **Tip Pool Calculator** | Eliminates 20-min weekly chore | #9 |
| **Catering Pipeline + Customers** | Maria's primary workflow tool | #10 |

### Wave 6: Performance + Training (after Wave 5)

| Module | Why it matters | Original list # |
|---|---|---|
| **AOR / Training Module** | Tap-each-as-complete checklists, per-employee performance data | #12 |
| **Deep Cleaning Rotation** | Auto-distribution + photo verification | #13 |
| **Recipe Flash Cards** | Reference tool for line | #11 |

### Wave 7: Customer-facing + analytics (after Wave 6)

| Module | Why it matters | Original list # |
|---|---|---|
| **Customer Feedback** | Public no-login form, QR code on Toast receipts | #14 |
| **LTO Performance Tracking** | Pete's LTO decision-support | #15 |
| **Weekly + Monthly Rollups** | Forecast fuel. Needs ~12 weeks of data | #16 |

### Wave 8: Integration + advanced (back-of-list, deferred)

These were originally higher-priority but moved back as operational reality clarified what data is needed first.

| Module | Why deferred | Trigger to revisit |
|---|---|---|
| **AI Insights** | Needs months of data to produce meaningful output | After Wave 7 ships and ~3-6 months of operational data exists |
| **Time Clock (C.47)** | Needs Toast + 7shifts integration adapters connected | After Toast + 7shifts integration phase ships |

---

## 6. Triggers That Would Change the List Again

Future-Juan or future-Claude updating this list should look for these signals:

1. **A new operational reality emerges that doesn't fit existing modules.** Example: Cristian discovers a workflow gap that's not covered by any planned module. Add as a new module with rationale; sequence based on urgency.

2. **A scheduled module loses urgency or becomes obsolete.** Example: Toast adds a feature natively that replaces a planned CO-OPS module. Mark deferred or removed in evolution log.

3. **Dependencies shift.** Example: SMS A2P registration completes earlier than expected → Internal Comms moves up in the wave because the constraint is gone.

4. **A module turns out to be much bigger than estimated.** Example: Reports Hub gets scoped and reveals 4-6 PRs of work, becomes its own multi-build arc rather than a single module.

5. **An external deadline forces sequencing.** Example: delivery internalization's June 29 deadline. CO-OPS modules don't directly support delivery internalization, but resource allocation between projects can affect module sequencing.

6. **Operational data reveals which modules unlock the most value.** After 3-6 months of running CO-OPS, real usage data shows which workflow gaps are most painful — that data should retroactively inform priority order for remaining modules.

When updating: append a new entry to **Section 4 (Module List Evolution Log)** with date and reason, then update **Section 5 (Current Updated Priority List)** to match.

---

## 7. Architectural Patterns That Carry Across All Modules

Captured for future-Claude reference. Every module inherits these from Build #2's locked architecture:

- **Chained edit + attribution (C.46)** — KH+ correction workflow with cap (3 updates), chain head snapshot inheritance, mandatory employee attestation when time-shifting, audit emission inside RPC transaction
- **Snapshot universe locking (C.44)** — historical reports preserve template state at submission time; edits operate on snapshot, not live template
- **Three-layer audit pattern** — lib + RLS + UI grep sweep on any role-level gate
- **Audit-the-audit** — never UPDATE audit_log; corrections via `audit.metadata_correction` action
- **System-key vs display-string discipline (C.38)** — business keys stay English source-of-truth; translation at render time only
- **Translate-from-day-one (C.37)** — every new UI surface ships with EN + ES translations
- **Migration-driven audit emission convention** — actor_id=invoker, metadata.actor_context=migration_apply, metadata.migration=filename
- **Path A versioning supersession** — ship vN+1, verify operational, flip vN to inactive in cleanup PR
- **Canonical i18n helpers** — `formatTime`, `formatDateLabel`, `formatChainAttribution` at `lib/i18n/format.ts`
- **Form validation iterates source of truth** — templateItems, never operator-state-only structures (rawValues)
- **RPC-side audit_log INSERTs match actual column shape via information_schema query** — don't infer columns from JS-side helpers

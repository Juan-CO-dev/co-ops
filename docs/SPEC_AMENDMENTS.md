# CO-OPS Spec Amendments

**Purpose:** Capture every place where the built reality intentionally diverges from CO-OPS Foundation Spec v1.2, so a future v1.3 (or any future-Claude reading the codebase) can reconcile spec text with code without ambiguity.

**Scope:** Amendments only. The spec itself isn't edited — that document is locked at v1.2. This file is the corrections-and-clarifications log that v1.3 will fold in when it ships.

**Format:** Dated entries, monotonic IDs (`C.<n>`). Each entry: spec section under amendment, what spec says, what built reality is, why, what v1.3 should do.

---

## C.16 — `checklist_confirmations` table is denormalized onto `checklist_instances`

**Date added:** 2026-05-01
**Spec sections:** §4.3 (Checklist tables), §6.1 (Checklist confirmation PIN re-entry)
**What spec says:** §6.1 step 6 instructs "insert `checklist_confirmations` row" as part of the PIN-confirm flow. §4.3, however, does **not** define a `checklist_confirmations` table — it lists `checklist_templates`, `checklist_template_items`, `checklist_instances`, `checklist_completions`, `checklist_submissions`, `checklist_incomplete_reasons`, and `prep_list_resolutions`. The §6.1 reference is vestigial.
**What built reality is:** No separate `checklist_confirmations` table exists. Confirmation state is denormalized onto `checklist_instances`:
- `checklist_instances.status ∈ {'open', 'confirmed', 'incomplete_confirmed'}`
- `checklist_instances.confirmed_at TIMESTAMPTZ`
- `checklist_instances.confirmed_by UUID REFERENCES users(id)`
- The PIN-confirm event itself is logged via `checklist_submissions` with `is_final_confirmation = true` plus an `audit_log` row.
- Incomplete-item reasons captured at confirmation go into `checklist_incomplete_reasons` (defined in §4.3).
**Why:** A separate confirmations table would duplicate state already captured by the (status, confirmed_at, confirmed_by) tuple plus the linked submission and reasons rows. Denormalization is consistent with append-only philosophy: the instance row is the canonical "is this shift closed?" record, and supporting events (submissions, completions, reasons, audit) cluster around it via foreign keys.
**v1.3 action:** Remove the `checklist_confirmations` reference in §6.1 step 6 and reword as "transition `checklist_instances.status` to `confirmed` or `incomplete_confirmed`, set `confirmed_at` and `confirmed_by`, insert `checklist_submissions` with `is_final_confirmation = true`, insert `checklist_incomplete_reasons` rows for any required-and-incomplete items, write `audit_log` row." `lib/types.ts` already documents this with an explicit comment ("Confirmation fields are populated on PIN-confirm — there is no separate confirmations table.").

---

## C.18 — Prep workflow has two trigger paths (closer-initiated and operator-initiated), not opener-initiated

**Date added:** 2026-05-01
**Spec sections:** §1.4 (Artifact model), §2.4 (Per-item completion), §4.3 (Checklist tables), §10 / §15 lib/prep.ts, §16 Phase 6 step 46
**What spec says:** Prep is modeled as opener-driven. Spec §15 lib/prep.ts comment: "1. Resolve par per vendor_item for (location, day-of-week) 2. Read on-hand from latest opening checklist closing-count completions 3. needed = max(par_target − on_hand, 0)." The implication is that opening produces counts and prep math derives from them.
**What built reality is (and intended for v1.3):** Two trigger paths:
1. **Closer-initiated (`triggered_by: 'closing'`)** — at end of shift, the closer estimates tomorrow's prep needs based on today's depletion. This is the AM Prep List that ships in Build #2 as Phase 2 of the closing flow. The operator's judgment is the source of truth, not a system computation.
2. **Operator-initiated (`triggered_by: 'manual'`)** — when any shift staff member (level 3+) notices depletion across multiple items mid-shift and decides a fresh prep instance is warranted.

Both produce `checklist_instances` rows where `template.type = 'prep'`, distinguished by a new `triggered_by` field (plus `triggered_by_user_id` and `triggered_at`). **No new `prep_instances` table is needed** — reuses existing `checklist_*` infrastructure.

**Why:** The spec model assumes computable inventory math (par minus on-hand from opener-collected counts). CO's operational reality is judgment-driven: the closer who watched today's depletion knows tomorrow's needs better than a static par would. And mid-day operator triggers are an emergent signal — they tell us when forecasted prep was insufficient — that the spec model has no way to capture.

**v1.3 action:**
- Add to `checklist_instances` schema: `triggered_by TEXT CHECK (triggered_by IN ('closing', 'opening', 'manual'))`, `triggered_by_user_id UUID REFERENCES users(id)`, `triggered_at TIMESTAMPTZ`. (Or store all three on a JSONB `metadata` column — defer specific implementation to Build #2 design.)
- Reframe §10 / §15 lib/prep.ts: prep math is operator-supplied, not system-computed. `prep_list_resolutions` rows still exist as the audit trail of what par/on-hand/needed values were *at generation time*, but the values come from the operator's input, not a query.
- Permission for mid-day prep triggering: level 3+ (anyone on shift). See C.21.

---

## C.19 — Closing has two phases (cleaning checklist + AM Prep List generation)

**Date added:** 2026-05-01
**Spec sections:** §1.4 (Artifact model), §4.3 (Checklist tables), §10–§12 (Module #1 Daily Operations), §16 Phase 6
**What spec says:** Closing is modeled as a single artifact: cleaning checklist with role-leveled items, multi-submission, PIN-confirmed.
**What built reality is:** Closing is **two phases** combined into one close-of-shift workflow:
- **Phase 1 — cleaning checklist (Image 6 content).** Station-grouped role-leveled items. Ships in Module #1 Build #1.
- **Phase 2 — AM Prep List generation.** Closer estimates tomorrow's prep needs. Generates a `checklist_instances` row with `template.type = 'prep'` and (per C.18) `triggered_by = 'closing'`. Ships in Module #1 Build #2 as part of the Prep workflow.

Single PIN attestation covers both phases: at end of close-of-shift, the closer enters PIN once, attesting to *both* the cleaning checklist completion and the AM Prep List. Audit captures both artifact creations under the same logical event.

**UI seam for Build #1 → Build #2 evolution:** The Build #1 closing UI ends with `[items] → [review] → [PinConfirmModal]`. The "Continue" button on the review screen is implemented via a function prop pattern (`onContinue: () => openPinModal()` in Build #1; `onContinue: () => navigateToPhase2()` in Build #2). When Phase 2 ships, it inserts between review and PIN: `[review] → [Phase 2 prep estimation] → [PinConfirmModal]`. The PIN modal covers both attestations.

**Build #2 ships a new closing template version** that excludes the "Fill out AM Prep List" line item — Phase 2 (digital AM Prep List generation) replaces it functionally. **Template versioning is implemented via name-suffix + active flag (Path A), no schema change.** Build #2 inserts `name = 'Standard Closing v2'` with `active = true`, flips `'Standard Closing v1'.active = false`. Old `checklist_instances` retain their FK to v1; new instances FK to v2. The existing UNIQUE `(location_id, type, name)` constraint already permits this (different `name` strings, no conflict). No `version` column is added to `checklist_templates` — Path A append-only honors §2.10 (foundation locks schema).

**Why:** CO's operational reality is one act, two artifacts. Spec's single-artifact model loses the linkage between today's closing observations and tomorrow's prep estimate. Modeling them as two phases of one workflow preserves the linkage *and* lets each phase ship in the right build (cleaning is well-defined now; prep estimation needs the prep_instances trigger model from C.18 first).

**v1.3 action:**
- Restructure §1.4 closing artifact description: "Closing has two phases: (a) cleaning checklist completion, (b) AM Prep List generation. Single PIN attestation. The AM Prep List generates a paired prep_instance with `triggered_by = 'closing'` per C.18."
- Document the Phase 1 → Phase 2 UI seam pattern in §10 (shared infrastructure services) as a reference for future multi-phase artifacts.
- Document template versioning via append-only name-suffix + active flag in §13.5 (Checklist Template Management) as the canonical pattern for non-breaking template evolution.

---

## C.20 — Opening is a verification artifact, not a count-collection artifact

**Date added:** 2026-05-01
**Spec sections:** §1.4 (Artifact model), §4.3, §10–§12 (Module #1 Daily Operations), §15 lib/prep.ts (which references "opener-collected counts")
**What spec says:** Opening collects on-hand counts of inventory items. Those counts feed the prep-math computation per §15 lib/prep.ts.
**What built reality is:** Opening's purpose is **quality control on the prior closing + spot-check validation of the AM Prep List instance generated at end of last close**. It is not the source of inventory counts. Counts are operator judgment captured at closing (per C.18). The opener confirms or flags discrepancies; they don't generate the canonical numbers.

Concretely, an Opening instance:
- Reviews the prior closing instance's completed items and its AM Prep List
- Flags any obvious closer mistakes (item left unfinished, prep estimate visibly wrong against actual current state)
- Triggers a `checklist_instances` row with `template.type = 'prep'` and (per C.18) `triggered_by = 'opening'` only when the opener's spot-check disagrees with the closer's estimate

**Why:** CO's operational loop is closer-led, not opener-led. The closer has watched the depletion; the opener has not. Opening as data-entry duplicates work and creates two competing numbers (closer's estimate vs opener's count) for the same question. Opening as verification keeps the data canonical (closer's estimate is authoritative until validated otherwise) and surfaces signal (opener disagreement) instead of noise (opener-recapture of what's already known).

**v1.3 action:**
- Reframe §1.4 opening artifact description: "Opening verifies the prior closing's completion quality and validates the AM Prep List generated at close. Counts are not collected at opening — they were captured at closing per C.18. Opening can trigger a fresh prep_instance with `triggered_by = 'opening'` only when the opener's spot-check materially disagrees with the closer's estimate."
- Update §15 lib/prep.ts comment: prep math comes from operator input (closer at end of shift; opener on disagreement; any shift member on mid-day depletion) — never from a stored opener-count query.

---

## C.21 — Mid-day prep initiation is open to all shift staff (level 3+)

**Date added:** 2026-05-01
**Spec sections:** §7.2 (Permissions), §15 lib/prep.ts
**What spec says:** Spec doesn't explicitly assign a permission level for mid-day prep initiation. It's implicit in the opener-driven model that prep initiation is bound to whoever runs the opening.
**What built reality is (and intended for v1.3):** Mid-day prep initiation is **open to anyone on shift, level 3+**. Any KH, Trainer, SL, or above who notices depletion can trigger a fresh `checklist_instances` row with `template.type = 'prep'` and `triggered_by = 'manual'`. The triggering user's id is captured in `triggered_by_user_id` (per C.18) for forensic visibility — patterns over time tell management which roles tend to spot mid-day shortfalls, which is signal for both staffing decisions and process tightening.
**Why:** The fastest signal for "we under-prepped" is a line cook running short during service. Gating that signal behind role permissions slows the response. Auditing it preserves the visibility without adding friction.
**v1.3 action:**
- Add to §7.2 PERMISSION_MIN_LEVEL: `'prep.trigger.manual': 3`. (`prep.trigger.closing` and `prep.trigger.opening` are implicit in `checklist.complete` since they happen as part of those flows.)
- Document in §15 lib/prep.ts that `triggered_by_user_id` is captured on every prep_instance and exposed in Synthesis View (Module #1 Build #5) as a pattern over time.

---

## C.22 — Notes-edit reuses the supersede flow (write multiplier acceptable for v1)

**Date added:** 2026-05-01
**Spec sections:** §2.5 (append-only correction model), §4.3 (`checklist_completions`), §15 lib/checklists.ts (Module #1 Build #1 step 6 component design)
**What spec says:** §2.5 specifies that "checklist completions and submissions are immutable on creation. To correct a checklist completion, submit a new completion event (which supersedes by recency)." This applies to corrections of any field on the completion, including `notes`.
**What built reality is:** Build #1's `ChecklistItem` component (step 6) treats notes-edit as a re-completion event: editing the notes on a completed item creates a new `checklist_completions` row that supersedes the prior live completion via `lib/checklists.ts` `completeItem()`. Architecturally clean — there is one and only one supersede path for any field change. The cost is a write multiplier: every notes edit creates a new row + an UPDATE on the prior, even though the only field changing is notes.
**Why:** Acceptable for v1 throughput. Closing items with notes are a small fraction of total completions, and notes-edit-after-completion is operationally rare (the closer adds a note when something unexpected surfaces, not as a routine flow). Architectural clarity beats optimization at this scale.
**v1.3 action:** Defer. If Cristian's operational feedback shows high-frequency note editing (e.g., the closer routinely refines notes during the close cycle), introduce a `PATCH /api/checklist/completions/{id}/notes` route that updates the `notes` column in-place without going through the supersede flow. Update `checklist_completions` RLS to permit notes-only updates by the original `completed_by` user (a column-level allowance the schema doesn't currently support cleanly — would need a function gate or a more permissive UPDATE policy paired with app-layer field restriction). Don't introduce until usage data argues for it; the supersede-everything pattern is the simpler default.

---

## How to add an entry

1. Pick the next monotonic ID (`C.<n>` — current next: C.23).
2. Spec sections under amendment.
3. Quote what spec says.
4. Document what built reality is.
5. Why the divergence is correct (operational reasoning, not just "we changed our mind").
6. What v1.3 should do — concrete action so the spec can be reconciled mechanically.

Date entries to whatever calendar the project is on (currently 2026-05-01).

This file is consumed by future spec versions. Its purpose is to make spec drift cheap to reconcile, not to legitimize ad-hoc deviations. Every entry should pass the test "would I tell Pete or Cristian this is the right way to do it?" before it lands here.

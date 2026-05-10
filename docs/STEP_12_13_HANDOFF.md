# Step 12+13 Handoff — C.50 Implementation Bundle

**Date:** 2026-05-09
**Branch:** `claude/nice-wilson-398de1`
**Status:** Step 12+13 bundled commit shipped; Step 14 smoke pending; Step 15 wrap pending
**Context:** Bundled commit per α lock (Step 12 form rewrite + Step 13 RPC rewrite ship atomically; no broken-on-preview window between commits). Reading this doc cold-opens Step 14 smoke OR Step 15 wrap.

---

## State at handoff

### Branch state

- **Branch:** `claude/nice-wilson-398de1`
- **Commits ahead of `origin/main`:** 13 (after the bundled Step 12+13 commit lands)
- **PR:** #42 (https://github.com/Juan-CO-dev/co-ops/pull/42)
- **Vercel preview URL:** https://co-ops-git-claude-nice-wilson-398de1-juan-co-devs-projects.vercel.app

### Migrations applied (Step 11 + 12+13)

| Migration | Purpose | Status |
|---|---|---|
| `0051_opening_phase2_calc_redesign` | Two new tables: `opening_closer_count_snapshots` + `opening_section_verifications`. No backfill (existing `references_template_item_id` column FK is canonical per Lock 1 simplification). | Applied + verified |
| `0052_create_opening_instance_atomic_rpc` | Atomic instance + snapshots create RPC (Step 11 review-time tightening per Confirm 2). Race-aware INSERT instance with ON CONFLICT DO NOTHING + snapshot insert in same transaction. SECURITY DEFINER + service_role-only grant. | Applied + verified |
| `0053_submit_opening_atomic_c50_rewrite` | RPC rewrite per C.50 §1, §2, §4, §8.4. DROP + CREATE (signature change adds `p_section_verifications jsonb DEFAULT NULL`). Server-side compute (ground_truth, prep_need, delta_vs_prep_need); §8.4 invariant enforcement; N-per-item under-prep notification dispatch on delta_vs_prep_need < 0. | Applied + verified |

Migration files captured in `supabase/migrations/` per AGENTS.md migration text repo capture convention.

### Architectural state — C.50 fully implemented

**Spec status:**
- C.50 §1-§7 architectural model: Locked
- C.50 §8 implementation answers: Locked in pre-build response on commit `b39d25b`
- C.50 §9 (concerns surfaced + answered): Locked
- Spec correction note: Appended to §2 documenting `references_template_item_id` column FK as canonical (vs the proposed-then-dropped JSONB duplication)

**Compute logic (RPC 0053 mirrors C.50 §1 exactly):**
- `ground_truth_count = COALESCE(opener_recount, closer_count)` when section verified or recount populated; else throws `ground_truth_unresolved`
- `prep_need = GREATEST(0, par_value - ground_truth_count)` (NULL when par_value NULL — par-null Tomato case)
- `delta_vs_prep_need = opener_prepped - prep_need`
- `over_under_status ∈ {'at_par', 'over_prep', 'under_prep'}` with NULL-delta → 'at_par'
- `spot_check_status ∈ {'flagged_recount', 'matched_via_section_verify'}`

**§8.4 invariant enforced on every Phase 2 completion's `prep_data.phase2`:**
- `phase=2`, `closer_count`, `ground_truth_count`, `opener_prepped`, `prep_need`, `delta_vs_prep_need`, `over_under_status` (one of three enum values)
- All six core fields persist EVEN on at-par happy path
- Future closer-accuracy view materializes from this shape with NO backfill

**Validation gates (server canonical per §8.3 lock):**
- Gate 1: `ground_truth_unresolved` — section verified OR opener_recount populated
- Gate 2: `opener_prepped_missing` — always required (even par-null items)
- Gate 3: `over_par_reason_missing` / `under_par_reason_missing` — when delta != 0

**Notification dispatch:**
- N-per-item under-prep notifications (NOT batched per Concern 2 lock)
- Trigger: delta_vs_prep_need < 0 (shifted from delta_vs_par)
- Recipients: KH+ at location + MoO + Owner DISTINCT (preserved from 0050)
- Body params extended with C.50 fields (parValue, closerCount, groundTruthCount, prepNeed, openerPrepped, deltaVsPrepNeed, overUnderStatus)

**Section verifications:**
- Inserted at submit time via 0053 RPC (one row per `verified=true` entry in payload)
- Append-only — no UNIQUE constraint on (instance, sectionKey)
- NOT re-inserted on update path (chain edits don't re-do section-verify)

---

## Step 14 — smoke testing entry point

### Prerequisites verified at handoff

- Migration 0051 + 0052 + 0053 all applied to production
- 68 opening Phase 2 template items have `references_template_item_id` populated (all 34 MEP + 34 EM items)
- C.50 RPC accepts new payload shape with `p_section_verifications` array
- Vercel preview URL live; CI gate green on the bundled commit

### EM gate state at handoff time

EM's 2026-05-08 closing was still `open` at the time of last gate check (auto-release window passes 2026-05-09 05:58 UTC = 1:58am EDT). When Juan opens Step 14 smoke session, the lazy auto-release path should fire on dashboard render (per Step 11 architectural verification).

If gate is still blocked at smoke time:
- Option α: Juan navigates to gate banner CTA "View last night's closing" → finalize manually (CGS-level)
- Option β: Service-role direct `UPDATE` on EM 2026-05-08 closing status to `'auto_finalized'` with system_auto attribution (smoke-setup pattern from earlier in this conversation)
- Today (2026-05-09) MEP opening is fresh — no historical pollution from the S1 bug-data submit (which was superseded via audit.gap_recovery row `2f3bcbf1` earlier in this conversation). MEP is the cleanest smoke target.

### Q-extensions for smoke (per Step 11 / SPEC_AMENDMENTS C.50 §9 lock)

| Q-extension | Verifies |
|---|---|
| **Q-ext 1** | Per-item ground_truth derivation lands correctly in prep_data audit (test BOTH section-verified path AND recount path within same submission) |
| **Q-ext 2** | prep_need edge case: par=10 / ground_truth=12 → prep_need=0 (NOT negative) |
| **Q-ext 3** | N-per-item notification dispatch verified (3 under-par items → 3 notifications + 9 recipient rows, NOT 1 batched + 3) |
| **Q-ext 4** | Submit gate enforcement: attempt submit with unverified section + no recount on items in that section → expect `ground_truth_unresolved` (sqlstate P0001) |

### Smoke scenarios (revised from Step 9 plan with C.50 corrected calc)

| # | Scenario | Submit gate behavior | Notification expected |
|---|---|---|---|
| **S1'** | Happy path same-day with all sections verified, all opener_prepped at prep_need | submit succeeds; status=confirmed; all delta=0 → over_under_status='at_par' | 0 notifications |
| **S2'** | Over-prep single item (section verified, opener_prepped > prep_need) | over-prep modal triggers; reason captured; submit succeeds; over_under_status='over_prep' | 0 urgent notifications |
| **S3'** | Under-prep single item (section verified, opener_prepped < prep_need) | under-prep modal triggers; reason + freetext required; submit succeeds; **1 urgent notification fires** | 1 notification → KH+ + MoO + Owner DISTINCT |
| **S4'** | Mixed (over + under simultaneously) | both modals exercised serially; submit succeeds | N-per-under-item notifications |
| **S5'** | Tomato (par-null) | inputs work; no signal renders; no modal triggers; over_under_status='at_par' (delta NULL → at_par) | 0 notifications |
| **S6'** | Per-item recount on flagged item | recount panel opens; opener_recount populated; prep_need recomputes; submit succeeds with spot_check_status='flagged_recount' | depends on delta sign |
| **NEW S7** | Section unverified + no recount → submit failure (Q-ext 4) | submit blocked client-side; if forced (curl/Postman direct API) → server returns sqlstate P0001 `ground_truth_unresolved` | 0 notifications |

### Verification queries (Q1-Q5 from earlier smoke + Q-extensions)

After each smoke scenario, run these against production:

**Q1 + Q2: Notifications + recipients (post-submit window)**
```sql
SELECT id, type, priority, title, location_id, created_at::text,
       data->'bodyParams'->>'prepped' AS prepped,
       data->'bodyParams'->>'par' AS par,
       data->'bodyParams'->>'closer' AS closer,
       data->>'overUnderStatus' AS status,
       data->>'deltaVsPrepNeed' AS delta
FROM notifications
WHERE created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC;

SELECT nr.notification_id, nr.user_id, u.role, u.name, nr.delivery_method, nr.delivery_status
FROM notification_recipients nr
JOIN users u ON u.id = nr.user_id
WHERE nr.created_at >= now() - interval '5 minutes'
ORDER BY nr.notification_id, u.role;
```

**Q3: Phase 2 prep_data invariant verification (§8.4 lock)**
```sql
SELECT cc.id, cti.label, cc.prep_data->'phase2' AS phase2_data,
       cc.prep_data->'phase2'->>'closer_count' AS closer_count,
       cc.prep_data->'phase2'->>'ground_truth_count' AS ground_truth,
       cc.prep_data->'phase2'->>'prep_need' AS prep_need,
       cc.prep_data->'phase2'->>'opener_prepped' AS opener_prepped,
       cc.prep_data->'phase2'->>'delta_vs_prep_need' AS delta,
       cc.prep_data->'phase2'->>'over_under_status' AS status,
       cc.prep_data->'phase2'->>'spot_check_status' AS spot_check
FROM checklist_completions cc
JOIN checklist_template_items cti ON cti.id = cc.template_item_id
WHERE cc.completed_at >= now() - interval '10 minutes'
  AND cc.prep_data->'phase2' IS NOT NULL
ORDER BY cc.completed_at DESC;
```

**Q4: opening.submit audit metadata (C.50 counters)**
```sql
SELECT occurred_at::text, action, actor_id, resource_id,
       metadata->>'phase2_count' AS phase2_count,
       metadata->>'section_verify_count' AS section_verify_count,
       metadata->>'recount_count' AS recount_count,
       metadata->>'at_par_count' AS at_par_count,
       metadata->>'over_prep_count' AS over_prep_count,
       metadata->>'under_prep_count' AS under_prep_count,
       metadata->>'under_par_notification_count' AS notif_count
FROM audit_log
WHERE occurred_at >= now() - interval '10 minutes'
  AND action = 'opening.submit'
ORDER BY occurred_at DESC;
```

**Q5 + Q-ext 1: Section verifications populated**
```sql
SELECT osv.section_key, osv.verified_at::text, osv.verified_by, u.name AS verified_by_name,
       osv.opening_instance_id
FROM opening_section_verifications osv
JOIN users u ON u.id = osv.verified_by
WHERE osv.verified_at >= now() - interval '10 minutes'
ORDER BY osv.verified_at DESC;
```

**Q-ext 2: Closer-count snapshots (frozen at instance create)**
```sql
SELECT ocs.template_item_id, cti.label,
       ocs.closer_count, ocs.par_value, ocs.par_unit,
       ocs.snapshot_taken_at::text
FROM opening_closer_count_snapshots ocs
JOIN checklist_template_items cti ON cti.id = ocs.template_item_id
WHERE ocs.opening_instance_id = '<the smoke instance id>'
ORDER BY cti.display_order;
```

---

## Step 15 — wrap deliverables

### AGENTS.md durable lesson candidates (queued from this conversation)

**1. Pre-build responses should query operational artifacts first.**
When proposing schema additions, FK relationships, or data model changes during a pre-build response, query current schema state before drafting recommendations. Sibling discipline to "verify against operational artifacts, not generic priors." Concern 5 (redundant `amPrepTemplateItemId` JSONB FK proposal) was caught when pre-build framing missed the existing `references_template_item_id` column FK from migration 0049.

**2. Wire-shape coupling at the architectural level, not the conversational level.**
Three sightings consolidated into one durable lesson:
- Step 11 Confirm 2 — atomicity hole between INSERT(instance) + INSERT(snapshots); resolved via atomic RPC migration 0052
- Step 12+13 α bundling — wire shape change atomic across form / route / RPC; locked single-commit (not split commits)
- Phase 3 → 4 boundary absorption — type changes propagate from `OpeningEntryPhase2` through form / route handler; Phase 3 absorbed route handler updates to maintain tsc green

Pattern: review surface → catch coupling → align commit boundary → verify → commit.

**3. Operational voice varies by audience role within the same flow.**
Refinement to Step 8 operational voice locks: alerts seen by managers use operational shorthand ("Under-par"); modals where opener captures reasons use the corrected technical wording ("prep need" / "necesario"). Two audiences, two registers, both operationally correct. C.50 modal copy shift in Phase 4.

**4. Migration 0050+ post-cleanup pattern.**
Post-Step 11 cleanup of bare-tick smoke artifact via `audit.gap_recovery` row `2f3bcbf1` (covered the 34 Phase 2 completions on instance `4688a6e2` from the broken S1 submit). Validates the established `audit.gap_recovery` pattern from Build #3 PR 2 enum mismatch as the canonical recovery path.

**5. Three rowToTemplateItem mapper sites — consolidation candidate (cleanup PR scope).**
Phase 1 caught duplicate `TemplateItemRow + rowToTemplateItem` mappers in `lib/opening.ts`, `lib/prep.ts`, and `app/(authed)/operations/closing/page.tsx`. Adding fields to shared types requires grepping for type consumers, not trusting that lib-level updates propagate. Forward note for Cleanup PR scope: consolidate to a single shared mapper.

**6. Review-time architectural tightening matters more than ship-speed.**
When pre-build response or implementation surface review catches a foundational gap, tighten before commit even if it expands scope. Cost of partial-state recovery after the fact is much higher than cost of catching it during the review gate.

PR 3 catch trend (positive — earlier catches require less recovery work):
- PR 2 enum mismatch: post-commit; required audit.gap_recovery
- PR 3 loader prep_meta strip: post-commit; required audit.gap_recovery
- Concern 5 redundant FK: pre-commit; clean simplification
- Confirm 2 atomicity hole: pre-commit; clean tightening via atomic RPC
- Wire-shape coupling: pre-commit; phase boundary absorbed

### Spec amendments queued for Step 15 authoring

**C.50** — already locked + landed in spec at commit `b39d25b` + appended with §9 locks at commit `58ece4d` + spec correction note in Phase 5. No further authoring needed.

**C.51 (deferred)** — narrow scope (Phase 1A/1B split moved to C.53):
- Opening report dashboard tile (parity with AM Prep tile)
- Back-to-dashboard affordance on opening page
- Opening submit auto-finalizing yesterday's closing per C.48 dependency graph (Finding 3)
- PAR + PREP NEED visual prominence — these are the headline values for prep decisions; current layout treats them as supporting data. UX restructure should make them visually dominant. Future Toast API integration makes par dynamic; visual prominence prepares for that operational meaning.

C.51 is the next amendment slot. Step 15 should NOT author C.51 itself — it's a future architectural conversation. Just leave the slot open with a brief stub.

**C.52 (authored — Phase 2 collaborative real-time prep)** — full text below. Locked in conversation. Ready for fresh-session implementation when PR 3 squash-merges.

- **Status:** Locked
- **Triggered by:** Operational reality at Compliments Only — multiple cooks (line cooks, dishwashers also doing prep) work concurrently during the 2-3 hour pre-service window. Single-actor atomic submit model from C.50 doesn't match how the kitchen actually operates. Real-time per-item save matches the operational pattern (and reuses existing closing-checklist infrastructure).
- **Scope:** Phase 2 prep execution becomes location-scoped collaborative real-time. Phase 1 (verification) stays single-user (KH+ opener). Submit authority remains with KH+ opener who completed Phase 1.
- **Out of scope:** Phase 1 collaborative behavior (stays single-user); Phase 3 (handled in C.53); cross-cutting offline-save-queue (separate amendment).
- **Depends on:** C.53 (three-phase restructure — Phase 2 simplification depends on Phase 1 absorbing verification work).

#### C.52 §1 — Operational model

The opening report's Phase 2 (prep execution) becomes a location-scoped collaborative surface. After C.53's Phase 1 verification submits, Phase 2 unlocks for the location with `prep_need` pre-resolved per item.

**Actor model:**

- **KH+ opener** — same actor who submitted Phase 1; eventually submits Phase 2 (and Phase 3 per C.53)
- **Any clocked-in employee at the location** — can input `opener_prepped` per item with explicit save button. CO doesn't have a formal "cook" role distinction; all back-of-house staff (line cooks doing sandwich prep, dishwashers doing prep) participate in opening prep. Self-coordinated verbally; no platform-layer claiming or assignment.

**Save semantic:**
Per-item explicit save button. Each save persists immediately to `checklist_completions` with the actor's `user_id` captured as `saved_by`. Other clocked-in employees at the location see updates via real-time subscription (same pattern as the existing closing checklist's collaborative behavior).

No autosave (operationally clean intent capture; explicit save = "I prepped this amount, locked in"). No claim-based locking (kitchen self-coordinates verbally; two cooks won't redundantly prep the same item).

**Edit semantics:**
Append-only, own-row only. Original prepper updates their own entry to correct (e.g., prepped 4 QT initially, realized at 7:50am they prepped another 2 QT after — they tap into marinara → recount their previous value 4 → update to 6 → save).

Cross-author edits don't happen at the platform layer. Verbal coordination handles aggregation cases. If Cook A prepped 4 QT marinara and Cook B independently prepped 2 QT, verbal coordination → Cook A updates their own row to 6 QT (self-aggregation). Operationally rare; not a platform concern.

**Submit authority:**
Only the KH+ opener who submitted Phase 1 can submit Phase 2. Auth gate: `current_user_id == instance.phase1_submitter_id`. Other clocked-in employees can save per-item entries; only the Phase 1 submitter transitions instance state.

**Submit gate:**
Per C.50 §4 (preserved):

- Every Phase 2 item with `prep_need > 0` has `opener_prepped` populated
- Every item with `delta ≠ 0` has reason category + free-text captured

**Submit produces:**

- `confirmed` — gate fully passes; instance complete
- `incomplete_confirmed` — opener submits with missing items + manager-level reason captured. Two distinct reason-capture surfaces: per-item under/over-prep reason captured by the prepper at save time (their accountability); whole-report incomplete-submit reason captured by KH+ opener at submission time (manager-level reasoning for missing items).

#### C.52 §2 — Why this lands operationally

**Matches kitchen reality.** 2-3 cooks working in close quarters during prep window, self-coordinating, prepping different items. Each saves what they prepped as they finish. Opener oversees, sees real-time progress, submits when ready.

**Reuses existing infrastructure.** The closing checklist already supports multi-author per-item saves with real-time sync. C.52 is the same pattern applied to Phase 2 prep, with numeric inputs instead of binary ticks.

**Per-actor accountability preserved.** `saved_by` captures who saved each entry. Audit trail surfaces "Cook A prepped 4 QT marinara at 7:32am; Cook B prepped 2 QT caramelized onion at 7:45am; Opener submitted at 8:30am." Manager review queues consume this for performance discussion.

**Operationally cleaner than alternatives.** Without C.52, opener has to walk around asking each cook what they prepped, manually enter all values themselves at submit time. That's how the platform would force them to operate today (single-actor C.50 model), and that's not how kitchens actually work. C.52 closes the gap between system and reality.

#### C.52 §3 — Data model

C.50's `prep_data->phase2` JSONB shape preserved with two new fields:

```jsonc
{
  "phase": 2,
  "closer_count": <number | null>,
  "ground_truth_count": <number | null>,
  "prep_need": <number | null>,
  "opener_prepped": <number>,
  "delta_vs_prep_need": <number | null>,
  "over_under_status": "at_par" | "over_prep" | "under_prep" | null,
  "over_under_reason_category": <enum | null>,
  "over_under_reason_text": <text | null>,
  "directed_by": <uuid | null>,
  "saved_at": <timestamp>,         // NEW per C.52 — per-item-save timestamp
  "saved_by": <uuid>               // NEW per C.52 — per-item-save actor
}
```

`saved_at` and `saved_by` capture the per-item save event. On C.46 chain edits (own-row corrections), `saved_at` updates to the latest save and `saved_by` stays as the original prepper (own-row edit semantics — the actor doesn't change because only the original author can edit their own entry).

`completed_by` (existing column on `checklist_completions`) mirrors `saved_by` for backward-compat with closing checklist queries.

§8.4 invariant from C.50 preserved: every Phase 2 completion's `prep_data->phase2` MUST contain all 6 core fields once Phase 2 submits. `saved_at` and `saved_by` are additional fields, not part of the invariant (because they're populated incrementally during prep, before the invariant is enforced at submit).

#### C.52 §4 — Real-time subscription

**Scope:** Location-scoped + active-instance-scoped.

Each connected client subscribes to `checklist_completions` filtered to:

- `instance_id` = today's opening Phase 2 instance for the user's current location
- Phase 2 completions only (filter by `template_item_id` matching Phase 2 items)

**Subscription lifecycle:**

- Open on Phase 2 view mount
- Close on Phase 2 view unmount
- Auto-close once instance reaches terminal state (`confirmed` or `incomplete_confirmed` or `auto_finalized`)

**Multi-location actors (MoO, Owner) — visibility scope:**
Real-time subscriptions for multi-location actors are still location-scoped at the subscription level (one subscription per location they're viewing). They can switch between locations to monitor different sites. They don't get a single subscription that aggregates all locations — that would create connection-multiplication concerns.

**Historical access — role-gated (separate cross-cutting amendment):**
This is a cross-cutting concern that applies to all reports, not just Phase 2 prep. Captured separately (not in C.52 scope):

- Employee level: up to 1 week historical view
- KH through SL: up to 1 month historical view
- AGM+: full historical view

C.52 implementation should respect whatever historical access amendment is active when it ships.

#### C.52 §5 — Form rendering (per-item save)

Phase 2 component rewrite per C.53 §5:

For each Phase 2 item:

- Item name + station context (informational)
- PAR value (prominent typography)
- PREP NEED (prominent typography, color-coded)
- OPENER PREPPED input (numeric)
- **Save button per item** — explicit save fires when tapped; persists to `checklist_completions` with `saved_at = NOW()` and `saved_by = current_user_id`
- Live save state indicator (saving / saved / error)
- Multi-author display: "Saved by [name] at [time]" inline below the input (when populated)
- Over/under-prep signal banner (live-computed against current saved value)
- Reason capture modals (when delta ≠ 0)

**Optimistic UI pattern:**

- User taps save → input shows "saving..." indicator immediately
- Save request fires → server confirms → indicator transitions to "saved at [time]"
- Save fails (network, validation) → indicator shows error + retry CTA

**Real-time updates from other clients:**

- Subscription pushes update for any item saved by another user
- Local state merges → input field for that item updates with the new value
- "Saved by [name] at [time]" inline display updates
- If current user has unsaved local changes for that item, conflict resolution applies (see below)

**Conflict resolution (rare but possible):**
Two clients editing the same item simultaneously:

- Last save wins at the server level (own-row edit semantics — each save is a new completion row, latest wins per `saved_at`)
- UI surfaces a brief conflict notification when remote update arrives while user has local changes ("This item was just saved by [name] — review their value before saving")
- Operationally rare per Q2 lock (cooks self-coordinate verbally; two won't prep the same item)

#### C.52 §6 — Submit authority + dispatch

Submit Phase 2 → `submit_phase2_atomic` RPC.

**Submit auth gate:**

- `current_user_id == instance.phase1_submitter_id`
- If different user attempts submit → P0001 sqlstate `phase2_submit_unauthorized`

**Submit validation gate (per C.50 §4 preserved):**

- Every `prep_need > 0` item has `opener_prepped` populated
- Every `delta ≠ 0` item has reason captured

**Submit dispatch:**

- Persists §8.4 invariant fields if not already populated (`closer_count` + `ground_truth_count` + `prep_need` + `delta` + `over_under_status` — most populated during Phase 1 by C.53; finalized at Phase 2 submit)
- N-per-item under-prep notifications fire per Concern 2 lock (NOT batched)
- Audit emission `opening.phase2_submit` with metadata (`phase2_count`, `save_event_count`, `distinct_savers_count`, `at_par_count`, `over_prep_count`, `under_prep_count`, `under_par_notification_count`)

**Notification dispatch timing:**
Notifications fire at submit time, not per-item save time. Reasons:

- Per-item saves are interim state (cooks may save partial values, update later)
- Submission is the operational moment of "this is the final state for this opening"
- Batching at submit produces clean dispatch (under-prep items captured at submit reflect final intent)
- Avoids notification noise during prep window (Pete doesn't need 3 notifications across 30 minutes as Cook A saves marinara at 4 QT, then 6 QT, then 5 QT — only the final value matters)

This matches C.50's notification timing; C.52 doesn't shift it.

#### C.52 §7 — Migration impact

**Schema changes:**

- `checklist_completions.prep_data` JSONB shape extended with `saved_at` + `saved_by` (no schema migration; JSONB shape evolves)
- Backward-compat: existing rows without `saved_at`/`saved_by` interpreted as "saved at completion timestamp by `completed_by` user" — Phase 2 RPC handles missing fields gracefully

**RPC changes:**

- `submit_phase2_atomic` (renamed from `submit_opening_atomic` per C.53) extends to:
  - Validate auth gate (`phase1_submitter_id` match)
  - Accept partial state (some items may have been saved during prep window with `saved_at` populated; submit finalizes)
  - Final §8.4 invariant enforcement
  - Existing notification dispatch logic preserved
- New per-item save endpoint: `save_phase2_item_atomic(instance_id, template_item_id, opener_prepped, reason_category, reason_text, directed_by)`
  - Validates: caller is clocked-in at the instance's location (auth gate)
  - Validates: instance status is `phase1_complete` (not yet at `phase2_complete`+)
  - Inserts new completion row with `prep_data->phase2` populated, `saved_at = NOW()`, `saved_by = current_user_id`
  - Returns: completion row + computed delta + over_under_status (for client-side UI update)

**Form changes:**

- `OpeningPrepEntry` rewrites per C.53 §5 (already scoped) — additionally adds per-item save button + multi-author display + optimistic UI + real-time subscription handling
- New `useSubscribeOpeningInstance` hook for real-time subscription lifecycle

**Notification changes:**

- No changes from C.50 — same trigger condition (`delta_vs_prep_need < 0`), same N-per-item, same routing, same timing (at submit)

#### C.52 §8 — What stays unchanged from C.50

- Calculation logic (`closer_count` + `ground_truth_count` + `prep_need` + `opener_prepped` + `delta_vs_prep_need` + `over_under_status`)
- Three signals architecture
- Notification dispatch (N-per-item, recipient routing, no re-emission on chain edits, fired at submit time)
- C.46 chained edit semantics (own-row only, edit_count cap)
- C.48 auto-release infrastructure
- Append-only convention
- Bilingual translation discipline

#### C.52 §9 — Open implementation questions for pre-build response

When fresh session opens C.52 implementation (post-PR-3, sequenced relative to C.53):

1. **C.52 vs C.53 implementation ordering** — C.52 depends on C.53 (Phase 2 simplification needs Phase 1 to absorb verification first). Implementation order: C.53 first → C.52 second OR both bundled? Pre-build response should propose.
2. **Real-time subscription library** — Supabase Realtime's existing patterns. Same as closing checklist? Pre-build response confirms exact implementation pattern matches existing collaborative surface.
3. **Conflict resolution UX details** — when remote update arrives while user has unsaved local changes, what's the UX? Toast notification? Inline diff? Modal? Pre-build response should propose.
4. **Per-item save endpoint vs single multi-item endpoint** — does each save fire its own RPC call (chatty, simple) or do saves batch within a debounce window (less chatty, more complex)? Pre-build response should propose. My read: per-item save endpoint, simple and matches operator intent.
5. **Save state recovery on connection loss** — if user saves while offline, what happens? Cross-cutting offline-save-queue amendment will handle this generally; in C.52's scope, fail-fast with retry CTA is acceptable. Pre-build response should propose interim behavior.
6. **Multi-author audit visibility** — when KH+ reviews submitted opening, do they see per-item save attribution surfaced in the form? Or only in audit log? Pre-build response should propose.
7. **C.46 chain-edit semantics with C.52 multi-author saves** — if Cook A saves 4 QT, then later (post-submit) the opener chain-edits to 6 QT (correction), does the chain edit replace Cook A's `saved_by` attribution or preserve it? My read: chain edit creates a new completion row with `edit_count > 0`; original Cook A's row stays as the original audit trail. Pre-build response should confirm.
8. **Visibility of in-progress saves to MoO/Owner** — multi-location actors monitoring real-time during prep. UI surface for them — same as opener's view, or different (read-only, aggregated)? Pre-build response should propose.

#### C.52 §10 — Test surface requirements

Per AGENTS.md "Multi-surface PRs need integration smoke before merge":

- Unit tests for `save_phase2_item_atomic` RPC (auth gate, instance state validation, JSONB shape)
- Unit tests for `submit_phase2_atomic` partial-state handling (some items pre-saved, some not)
- Integration tests for multi-author save sequence (Cook A saves marinara, Cook B saves caramelized onion, opener submits)
- Integration tests for conflict resolution (concurrent saves on same item)
- Smoke test surface for full collaborative prep flow at MEP (multiple test users saving items, opener submitting)
- Smoke test surface for real-time subscription behavior (Cook A's save appears on Cook B's screen within reasonable latency)
- Smoke test surface for offline behavior (Cook A goes offline mid-save, comes back online; what happens to their save)

Smoke against operational data is required before merge.

**C.53 (authored — three-phase opening report restructure: verification → prep → setup)** — full text below. Locked in conversation. Ready for fresh-session implementation when PR 3 squash-merges.

#### C.53 §1 — Operational model

The opening report is restructured from two phases to three, each with a distinct actor model and verification activity:

**Phase 1 — KH+ opener verification (single-user, sequential walk).**
Opener arrives 2-3 hours before service. Walks the kitchen station-by-station. For each station card:

- Station cleanliness check — visual confirm, single tap.
- Temperature reading — numeric input from temp probe, with photo evidence optional.
- Sauces topped off / dated correctly — single tap confirm.
- Spot-check items in this station's section — opener walks the items physically, eyeballs each item against closer's count from yesterday's AM Prep. Per-item state captures one of:
  - **Section-verified** — opener taps "verify section counts" CTA, covering all items in the station that aren't individually flagged. `ground_truth_count = closer_count` for those items.
  - **Per-item recount** — opener taps into an item that looks off, enters `opener_recount` value. `ground_truth_count = opener_recount` for that item.
- Station ready for service — final confirm tap.

Submit Phase 1 → instance status `open` → `phase1_complete` → Phase 2 unlocks for the location with `prep_need` pre-resolved per item. By the time Phase 2 unlocks, every item has `ground_truth_count` + `prep_need` computed; the prep marching-order list is fully populated.

**Phase 2 — Collaborative prep execution (location-scoped multi-actor).**
Phase 2 renders as a clean prep-execution surface. For each item:

- Item name and station context
- PAR value (prominent — driven by Toast API integration eventually)
- PREP NEED (prominent — already computed from Phase 1's resolved ground_truth)
- OPENER PREPPED input (numeric, with per-item save button per C.52 collaborative model)
- Over/under-prep signal banners + reason capture when delta ≠ 0

Any clocked-in employee at the location can save per-item `opener_prepped` values. Each save persists immediately (per C.52). Other clocked-in employees at the location see updates in real-time. Verbal coordination handles who-preps-what; no claiming or conflict resolution at the platform layer.

Edit semantics: append-only, own-row only. Original prepper can update their own entry to correct.

Per-item under-prep notifications fire at Phase 2 submit time (not per-item save), N-per-item per Concern 2 lock, recipients per C.48 routing (KH+ at location + MoO + Owner DISTINCT).

Submit Phase 2 → instance status `phase1_complete` → `phase2_complete` → Phase 3 unlocks for the same KH+ opener.

**Phase 3 — KH+ opener station setup verification (single-user, sequential walk).**
After prep is complete, opener walks the kitchen verifying station setup is service-ready. Phase 3 renders as a per-station setup checklist — items grouped by station context, each item either boolean (placed/not placed) or quantitative-with-threshold (e.g., 2-4 QT basil distributed). Multi-station items render once with their distribution semantic.

For each setup item, opener taps verification (or enters quantitative value within range). Items can be untapped before submit; once submit fires, append-only audit captures the final state.

Setup items include placement checks, backup inventory verification, and station-readiness items that physically prepare the kitchen for service.

Submit Phase 3 → instance status `phase2_complete` → `confirmed` (if all setup items verified within range) OR `incomplete_confirmed` (if any items missing or out-of-range, with manager-level reason captured at submit time).

Missing-item notifications fire at Phase 3 submit per the same N-per-item dispatch model as Phase 2 under-prep — recipients per C.48 routing.

#### C.53 §2 — Why this lands operationally

**Verification work stays with the verification actor.** Opener does ALL verification work (station, temp, spot-check counts, station setup) in Phase 1 + Phase 3. Cooks don't engage with verification mechanics.

**Prep work surfaces clearly to prep actors.** Cooks open Phase 2 and see prep needs immediately — no verification mechanics in their view. They prep and save.

**Sequential phases match physical workflow.** Opener walks → cooks prep → opener verifies setup → submit. Each phase is a distinct physical activity at a distinct time during the 2-3 hour pre-service window.

**Phase boundaries enforce ordering.** Phase 2 can't start until Phase 1 verifies counts (otherwise prep_need can't compute). Phase 3 can't start until Phase 2 produces the prepped items (otherwise setup has nothing to place). Architectural gates match operational reality.

**Single KH+ owns the report end-to-end.** Same opener does Phase 1 verification, oversees Phase 2 collaborative prep, executes Phase 3 setup verification. Submit authority flows from Phase 1's submitter through to Phase 3's submit.

#### C.53 §3 — Data model

**Phase 1 verification state.** Existing tables from C.50 stay valid; just shift WHEN data is populated:

- `opening_closer_count_snapshots` — materializes at instance create (C.50 unchanged)
- `opening_section_verifications` — populated at Phase 1 submit (was Phase 2 in C.50)
- `checklist_completions` — Phase 1 completions for stations + temps + spot-check unchanged shape; spot-check fields land in `prep_data->phase1`:

```jsonc
{
  "phase": 1,
  "spot_check_status": "matched_via_section_verify" | "flagged_recount" | null,  // null for non-spot-check items
  "opener_recount": <number | null>,
  "ground_truth_count": <number | null>  // null for non-spot-check items (e.g. station cleanliness)
}
```

**Phase 2 prep state.** Existing C.50 shape preserved with only `opener_prepped` + delta + status fields populated at Phase 2 submit:

- `checklist_completions` — Phase 2 completions for prep items, `prep_data->phase2`:

```jsonc
{
  "phase": 2,
  "closer_count": <number | null>,           // mirrored from snapshot for forensic continuity
  "ground_truth_count": <number | null>,     // mirrored from Phase 1 spot-check resolution
  "prep_need": <number | null>,              // computed from ground_truth + par_value
  "opener_prepped": <number>,                // captured per-item-save (C.52)
  "delta_vs_prep_need": <number | null>,
  "over_under_status": "at_par" | "over_prep" | "under_prep" | null,
  "over_under_reason_category": <enum | null>,
  "over_under_reason_text": <text | null>,
  "directed_by": <uuid | null>,
  "saved_at": <timestamp>,                   // per-item-save timestamp (C.52)
  "saved_by": <uuid>                         // per-item-save actor (C.52)
}
```

§8.4 invariant from C.50 preserved — every Phase 2 completion's `prep_data` MUST contain all six core fields once Phase 2 submits.

**Phase 3 setup state — NEW.** Two new tables for setup item definitions and per-instance verifications:

```sql
-- Setup item definitions (template-like; seed data initially)
CREATE TABLE opening_setup_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id                uuid NULL REFERENCES regions(id),  -- nullable for global items; per-region for future scoping
  location_id              uuid NULL REFERENCES locations(id), -- nullable for region-wide items; per-location for future scoping (C.21 region scoping pattern)
  item_label               text NOT NULL,
  item_type                text NOT NULL CHECK (item_type IN ('boolean', 'quantitative_range')),
  min_value                numeric NULL,        -- for quantitative_range only
  max_value                numeric NULL,        -- for quantitative_range only
  unit                     text NULL,            -- for quantitative_range only ("QT", "min", "logs", etc.)
  applies_to_stations      text[] NOT NULL,      -- station_keys this item applies to
  verification_scope       text NOT NULL CHECK (verification_scope IN ('shared', 'per_station')),
  display_order            int NOT NULL,
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT NOW()
  -- ...
);

-- Per-instance verification state (append-only)
CREATE TABLE opening_setup_verifications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_instance_id      uuid NOT NULL REFERENCES checklist_instances(id),
  setup_item_id            uuid NOT NULL REFERENCES opening_setup_items(id),
  station_key              text NULL,            -- populated for per_station verification_scope; NULL for shared
  verified_at              timestamptz NOT NULL DEFAULT NOW(),
  verified_by              uuid NOT NULL REFERENCES users(id),
  verified_value           numeric NULL,         -- for quantitative_range; the number opener entered
  in_range                 boolean NULL,         -- computed at verification time for quantitative; NULL for boolean
  unverified_reason_category text NULL,          -- when item is intentionally NOT verified at submit (e.g., "ingredient_unavailable")
  unverified_reason_text   text NULL
);
```

**Important — multi-station verification semantics:**

- `verification_scope = 'shared'` items (e.g., "2-4 QT basil distributed between walking + 3rd party stations") render once. Single verified row inserted with `station_key = NULL` and `verified_value` capturing the total quantity.
- `verification_scope = 'per_station'` items (e.g., "GF bread + knife on each station") render once per station they apply to. Multiple verified rows inserted, one per `station_key`, each with its own verification state.

This handles the operational distinction: bacon distributed across stations is one shared verification; towel + knife per station is verified per station independently.

**Instance state graph extension.** Existing states preserved; new transitional states added:

| State | Meaning | Set by |
|---|---|---|
| `open` | Instance created, no phase submitted | Instance create RPC |
| `phase1_complete` | Phase 1 submitted, prep_need resolved per item | `submit_phase1_atomic` RPC |
| `phase2_complete` | Phase 2 submitted, prep complete | `submit_phase2_atomic` RPC |
| `confirmed` | Phase 3 submitted with all setup verified in range | `submit_phase3_atomic` RPC |
| `incomplete_confirmed` | Phase 3 submitted with missing/out-of-range items + manager reason | `submit_phase3_atomic` RPC |
| `auto_finalized` | C.48 16h auto-release fired; instance closed without explicit submit | `system_auto` |

C.46 chain edits scoped per-phase per existing convention. KH+ can edit Phase 1 items after `phase1_complete`, Phase 2 items after `phase2_complete`, Phase 3 items after `confirmed` (or `incomplete_confirmed`). Edit_count cap = 3 per phase.

#### C.53 §4 — Three signals re-mapped (no change from C.50, just re-anchored to new phase boundaries)

Three signals computed from per-item state, each with distinct organizational accountability:

| Signal | Computation | Owner accountability | Captured during |
|---|---|---|---|
| **Closer accuracy** | Δ(closer_count, ground_truth_count) per item, aggregated over time per closer. Non-zero only when opener-recount fired during Phase 1 spot-check. | Closer's job performance / count discipline | Phase 1 (spot-check) |
| **Opener execution** | Δ(opener_prepped, prep_need) per item. Zero = at par. Negative = under-prep. Positive = over-prep. | Opener's job performance / prep discipline | Phase 2 (prep) |
| **Setup accuracy** | Boolean items: verified count vs total count. Quantitative items: in_range count vs total count. Per-station for per_station scope; aggregate for shared scope. | Opener's job performance / service-readiness discipline (NEW SIGNAL) | Phase 3 (setup) |

**New signal — Setup accuracy** — surfaces patterns over time. "Juan's openings consistently set up Caesar kits correctly; Maria's openings frequently miss backup pickle." Manager review queues consume this signal for performance discussion.

#### C.53 §5 — Behavior contract per phase

**Phase 1 form rendering.** Phase 1 renders as per-station cards (option α from design conversation). Each station card includes:

- Station name header
- Cleanliness check item
- Temperature reading item (with optional photo)
- Sauces topped off item
- Spot-check section: items in this station, with section-verify CTA at top OR per-item recount drill-in
- Station-ready confirm item

Form scrolls station-by-station vertically. Cards are different lengths depending on items per station (Cooks station has more items than Slicing).

**Submit Phase 1 gate:**
- Every station's cleanliness + temp + ready items completed
- Every spot-check item: section-verified OR `opener_recount` populated (per Concern 3 lock from C.50)

**Phase 1 RPC — `submit_phase1_atomic`.** New RPC (replaces partial logic from C.50's `submit_opening_atomic`).

Validates Phase 1 gate. Persists:

- Phase 1 completions (stations + temps + spot-check entries)
- `opening_section_verifications` rows for each section-verified entry
- `prep_data->phase1` JSONB on spot-check completions
- Computed `ground_truth_count` per spot-check item
- Computed `prep_need` per spot-check item (mirroring to Phase 2 prep_data fields ahead of Phase 2 dispatch)

Audit emission: `opening.phase1_submit` row with metadata (counts: stations_verified, temps_recorded, items_section_verified, items_recounted, total_recount_delta).

Transitions instance status `open` → `phase1_complete`.

No notification dispatch from Phase 1 (verification only; no operational deltas to surface).

**Phase 2 form rendering.** Phase 2 renders as a flat list of prep items (no sections, no verification mechanics). Per item:

- Item name + station context (informational, not interactive)
- PAR value (prominent typography)
- PREP NEED (prominent typography, color-coded by value)
- OPENER PREPPED input (numeric, with explicit save button — C.52)
- Over/under-prep signal banner (live-computed against current value)
- Reason capture modals (when delta ≠ 0)

Multi-actor visibility: real-time subscription on `checklist_completions` filtered to today's instance + Phase 2 completions. Updates from other clocked-in employees at the location surface immediately. Optimistic local save + reconciliation per C.52.

**Submit Phase 2 gate:**
- Every item with `prep_need > 0` has `opener_prepped` populated
- Every item with `delta ≠ 0` has reason category + free-text captured
- Submit authority: only the KH+ who submitted Phase 1 (`instance.phase1_submitter_id`)

**Phase 2 RPC — `submit_phase2_atomic`.** Renamed from `submit_opening_atomic` (C.50's RPC). Logic simplified — Phase 1 work already done; this RPC only handles Phase 2 dispatch.

Validates Phase 2 gate. Persists:

- Per-item Phase 2 completion rows updated with final `opener_prepped` + computed `delta` + `over_under_status` fields (per-item-save during prep already populated `opener_prepped`; submit finalizes the row)
- §8.4 invariant enforcement: every `prep_data->phase2` JSONB MUST contain all 6 core fields

Notification dispatch: N-per-item under-prep notifications per Concern 2 lock. Same trigger condition as C.50 (`delta_vs_prep_need < 0` on submit). Same recipients (KH+ at location + MoO + Owner DISTINCT).

Audit emission: `opening.phase2_submit` row with metadata (phase2_count, at_par_count, over_prep_count, under_prep_count, under_par_notification_count, total_save_events).

Transitions instance status `phase1_complete` → `phase2_complete`.

**Phase 3 form rendering.** Phase 3 renders as a per-station setup card. Each station card lists setup items applicable to that station:

- Items with `verification_scope = 'per_station'` render in each station card they apply to (separate verification per station)
- Items with `verification_scope = 'shared'` render once at the top of Phase 3 (or in a dedicated "shared setup" section), single verification covers all stations

Per item:

- Item label
- Quantitative items: numeric input with min/max range displayed; in-range indicator
- Boolean items: tap-confirm CTA

Items can be untapped before submit; final state captured at submit.

**Submit Phase 3 gate:**
- Every Phase 3 item: verified (boolean) OR verified-with-value (quantitative) OR explicitly-unverified-with-reason
- Submit authority: only the KH+ who submitted Phase 1 (same actor across all three phases)

**Phase 3 RPC — `submit_phase3_atomic`.** New RPC.

Validates Phase 3 gate. Persists:

- `opening_setup_verifications` rows per item (one row for shared-scope items; multiple rows for per_station items)
- `verified_value` for quantitative items; `in_range` computed boolean
- `unverified_reason_category` + `unverified_reason_text` for explicitly-unverified items

Notification dispatch: N-per-item missing-setup notifications when items are explicitly-unverified at submit. Same dispatch infrastructure as Phase 2 under-prep. Recipients per C.48 routing.

Audit emission: `opening.phase3_submit` row with metadata (setup_items_verified, setup_items_in_range, setup_items_unverified, missing_setup_notification_count).

Transitions instance status `phase2_complete` → `confirmed` (all items verified in range) OR `incomplete_confirmed` (some items unverified, manager reason captured).

#### C.53 §6 — Migration impact

Substantial. Implementation phases will sequence migrations carefully:

**Schema migrations:**
- New table: `opening_setup_items` (Phase 3 item definitions)
- New table: `opening_setup_verifications` (Phase 3 per-instance verifications)
- Status enum extension: `phase1_complete`, `phase2_complete` added to `checklist_instances.status`
- Existing `opening_section_verifications` table: unchanged structurally; populated at different submit moment (Phase 1 instead of Phase 2)
- Existing `opening_closer_count_snapshots` table: unchanged

**RPC migrations:**
- New RPC: `submit_phase1_atomic` — new logic; validates + persists Phase 1 completions + section verifications + spot-check fields + computed prep_need
- Renamed RPC: `submit_opening_atomic` → `submit_phase2_atomic`. Logic simplified — Phase 2 dispatch only; spot-check work already done in Phase 1.
- New RPC: `submit_phase3_atomic` — new logic; validates + persists setup verifications + dispatches missing-setup notifications

Migration ordering: schema migrations first (tables + enum extension), then RPC migrations.

**Form rewrites:**
- Phase 1 component (`OpeningStation*` + new): existing per-station card extended with spot-check items list embedded. New `OpeningStationSpotCheck` component (analogous to existing `OpeningSectionVerify` but rendered within station card).
- Phase 2 component (`OpeningPrepEntry`): simplified rewrite — section-verify CTAs removed, recount drill-in removed, closer-count display removed, "verify section first" pending copy removed. Renders prep marching-order list with per-item save (C.52 pattern).
- Phase 3 component (NEW — `OpeningSetupVerify`): per-station setup card with mixed item types. Boolean tap + quantitative numeric input + range validation indicator. Multi-station verification handling.

**i18n keys:**
- Removed: Phase 2 section-verify keys, recount drill-in keys, "verify section first" pending key, closer-count display keys
- Added (Phase 1): spot-check copy in station context (verify counts, recount item, closer count display)
- Added (Phase 3): setup item copy (place item, verify range, missing reason categories)

**Seed data:**
- Phase 3 setup items seed — initial standard checklist (per Q-P3-1 lock). Single global checklist initially; region/location scoping reserved for future activation.
- Existing Phase 2 seed — preserved (Standard Opening v1 template still has 34 Phase 2 items)
- Phase 1 spot-check seed extension — existing Standard Opening v1 template's 34 spot-check items mapped to Phase 1 spot-check rendering (no schema change; just render shift)

#### C.53 §7 — What stays unchanged from C.50

- C.50 calculation logic (`closer_count` + `ground_truth_count` + `prep_need` + `opener_prepped` + `delta_vs_prep_need` + `over_under_status`) — preserved end-to-end
- Three signals architecture — preserved + extended (setup accuracy added)
- Notification dispatch (N-per-item, recipient routing, no re-emission on chain edits) — preserved
- C.46 chained edit semantics — preserved per phase
- C.48 auto-release infrastructure — preserved (16h window applies to instances stuck at any phase)
- Region scoping pattern — preserved (Phase 3 setup items follow same pattern)
- Append-only convention — preserved across all three phases
- Bilingual translation discipline — preserved

#### C.53 §8 — Open implementation questions for pre-build response

When fresh session opens C.53 implementation, pre-build response surfaces:

1. **Phase 3 seed data shape** — how is the standard checklist authored? SQL seed file? TypeScript-defined data with migration-time INSERT? Authoring path needs to be specified for the ~30+ setup items. Per-station `station_keys` list per item also needs structuring (alignment with existing station_keys: `'station_cooks'`, `'station_veg'`, `'station_sauces'`, `'station_slicing'`, `'station_cold'`).
2. **Phase 2 instance state for in-progress prep** — when Phase 2 unlocks but prep isn't started yet, what does the dashboard tile show? Per C.52 collaborative design, multiple cooks may be saving entries asynchronously. Tile rendering for "phase2_complete" vs "phase1_complete with 0/34 prep entries" vs "phase1_complete with 18/34 prep entries" needs to be spec'd.
3. **Phase 3 item ordering** — `display_order` field is in the schema. How is initial ordering set? Alphabetical? Operational priority (ingredients-first, placement-second, backups-last)? Per-station physical walking order? Pre-build response should propose an ordering convention.
4. **Quantitative range UX edge cases** — what happens if opener enters a value outside the range? Form rejects? Form accepts with warning? Form requires reason? My read: form accepts but visually flags out-of-range; submit gate either requires reason for out-of-range items OR transitions instance to `incomplete_confirmed`. Pre-build response should propose.
5. **Multi-station shared verification UX** — when a "shared" item like "2-4 QT basil distributed between walking + 3rd party stations" renders, where does it render in the form? At the top of Phase 3 (cross-station section)? Within the first station card it applies to? Pre-build response should propose.
6. **C.46 chain-edit boundaries across phases** — if opener edits Phase 1 spot-check after Phase 2 submits (chain edit on Phase 1), does that retroactively change Phase 2's `ground_truth_count` + `prep_need`? Probably no (Phase 2 captured ground_truth at its submit time, not live), but the data model needs to be explicit. Pre-build response should propose.
7. **Phase 3 incomplete + reason capture** — what reason categories apply to Phase 3 incomplete? "Ingredient unavailable" / "Equipment broken" / "Skipped due to time pressure" / etc.? Pre-build response should propose initial enum + free-text path.
8. **Setup item edit semantics** — once Phase 3 submits, can opener chain-edit individual setup items (e.g., realized later that bacon was actually placed correctly)? Per C.46 cap-at-3 across all chains, or independent caps per phase? Pre-build response should propose.
9. **Notification body for missing setup** — what does the notification body contain? Per-item details ("Bacon backup missing in walking station") vs aggregated summary ("3 setup items missing at MEP opening")? My read: per-item details for forensic richness, matching C.50's per-item under-prep dispatch. Pre-build response should confirm.

#### C.53 §9 — Test surface requirements

Per the AGENTS.md durable lesson "Multi-surface PRs need integration smoke before merge," C.53 implementation must include:

- Unit tests for Phase 1 RPC: spot-check derivation (recount fired vs section-verified), prep_need computation persisted to Phase 2 prep_data ahead of Phase 2 dispatch
- Unit tests for Phase 2 RPC simplified: validates only Phase 2 fields (Phase 1 work pre-resolved)
- Unit tests for Phase 3 RPC: setup item validation, range checking, multi-station verification handling
- Integration tests for full three-phase round-trip: instance create → Phase 1 submit → Phase 2 saves + submit → Phase 3 submit
- Smoke test surface for end-to-end three-phase flow at MEP and EM (location-scoped collaborative behavior)
- Smoke test surface for chain-edit behavior across phases (edit Phase 1 after Phase 2 submits — does Phase 2 data shift?)
- Smoke test surface for `incomplete_confirmed` at Phase 3 (missing items + reason capture + notification dispatch)

Smoke against operational data is required before merge — CI green alone insufficient.

#### C.53 §10 — Implementation sequencing

C.53 spans more surface than C.50 implementation did. Recommended phase structure for fresh-session implementation:

| Phase | Scope | Rough LOC | Files touched |
|---|---|---|---|
| 1 | Schema migrations + Phase 3 seed data + types | ~300 | New tables, status enum, types, seed |
| 2 | Phase 3 component (setup verification UI) | ~600 | New `OpeningSetupVerify`, supporting components, i18n |
| 3 | Phase 1 component restructure (spot-check absorbed) | ~500 | `OpeningStation*` rewrite, new spot-check sub-component, i18n |
| 4 | Phase 2 component simplification | ~400 | `OpeningPrepEntry` rewrite (smaller surface), i18n cleanup |
| 5 | Three RPCs (Phase 1, Phase 2 rename, Phase 3) + RPC migrations | ~1500 plpgsql | Three migrations, `lib/opening.ts` dispatch |
| 6 | Form ↔ RPC wire-shape integration + verification + commit | ~500 | Loader, route handler, types alignment, smoke prep |

Total estimated: ~3800 LOC across 6 phases (vs. C.50's ~2000 LOC across 6 phases). Larger because three phases of restructure instead of one.

Mid-phase surface check-ins per AGENTS.md rhythm. Single-commit at end per α lock semantic from C.50.

### Cross-cutting amendments captured (not yet numbered; await fresh-session authoring)

- **Offline-save-queue pattern** — applies to all reports (closing, AM Prep, opening Phase 2, Mid-day Prep). Save queued locally, replayed when online. Pattern generalizes; ship once, inherit everywhere.
- **Role-gated historical access** — employee 1 week / KH-SL 1 month / AGM+ full. Cross-cutting; affects all report types. Implementation per existing role-level conventions.

Forward note for fresh session: these amendments are NOT in `docs/SPEC_AMENDMENTS.md` yet. Captured inline in handoff doc only. Amendment authoring happens during pre-build response when implementation begins, same pattern as C.50.

### Finding 3 deferred pointer

**Finding 3 from Step 9 smoke** — KH+ self-service release affordance for unfinalized prior closing (the gate blocks opener with no path forward when prior closing stuck `open`). Captured at the time as "PR 4 architectural home" per design doc §5 + lib/checklists.ts:370 comment.

PR 4 is referenced architecturally in the design doc but not currently scoped on the active branch. After PR 3 merges to main, opening Finding 3 means scoping a PR 4 (opener-release UI + retroactive gate predicates + system auto-release notification routing).

Step 15 wrap should reference Finding 3 in the handoff but NOT scope PR 4 itself.

### Other open items captured for cleanup

- **Phase-tab key duplication** in i18n (`opening.phase.tab_phase1` / `tab_phase2_disabled` / `tab_phase2_subtitle` vs `opening.phase.tab_phase2` / `tab_phase2_locked` / `tab_phase2_locked_aria`). Surfaced during Step 8 audit. Both sets active or one set dead; Cleanup PR investigation.
- **Three rowToTemplateItem mappers** consolidation (lesson #5 above).
- **Live `loadCloserCountSnapshots` resolver** still exists in `lib/opening.ts` — only used for the now-deleted form-load-time path (replaced by `loadOpeningCloserCountSnapshots`). Currently consumed by `loadOpeningState` create-path (the snapshot materialization). Could be inlined into create-path or kept as separate concern; cleanup decision.

---

## Cold-start path for next Claude Code session

1. Read this doc (`docs/STEP_12_13_HANDOFF.md`) first
2. Read `AGENTS.md` (durable lessons; Phase 3+ section) — but note pending durable lesson candidates from this conversation are in §"Step 15 wrap deliverables" above
3. Check branch state: `git status` should show clean tree on `claude/nice-wilson-398de1`
4. If smoke session: open Vercel preview URL, exercise scenarios per § Step 14
5. If Step 15 session: author AGENTS.md durable lessons + final handoff doc + regression smoke

---

## Working rhythm preserved

This bundle's commit cycle exemplified:

- **α lock semantic** — single commit covers wire-shape change atomically (form + route + RPC); no broken-on-preview window
- **Phase boundary absorption when wire-shape coupling demands it** — Phase 3 absorbed route handler updates; Phase 4 became smaller (modal copy)
- **Mid-phase architectural surface** — Concerns 1-5 surfaced + locked before code; Confirm 1+2 tightening before Step 11 commit
- **Migration text repo capture** — every applied migration committed as `supabase/migrations/NNNN_*.sql` with canonical headers
- **Operational voice locks** — applied through translation surfaces (Step 8 + Phase 4 modal copy refinements)
- **Audit-the-audit + audit.gap_recovery patterns** — Step 11 smoke artifact cleanup followed established conventions

Each phase landed clean (tsc + build + JSON parity gates); commit shipped after final review surface; CI green on push.

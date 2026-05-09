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

**C.51 (deferred)** — out of scope for C.50 per the locks:
- Phase 1A/1B section split (station/temp verification distinct from count verification)
- Opening report dashboard tile (parity with AM Prep tile)
- Back-to-dashboard affordance on opening page
- Opening submit auto-finalizing yesterday's closing per C.48 dependency graph

C.51 is the next amendment slot. Step 15 should NOT author C.51 itself — it's a future architectural conversation. Just leave the slot open with a brief stub.

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

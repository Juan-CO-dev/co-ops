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

## C.23 — `locations.timezone` referenced in spec but not in schema

**Date added:** 2026-05-01
**Spec sections:** §4.1 (`locations` table), Module #1 dashboard date calculations (step 8)
**What spec says:** Module #1 Build #1 step 8 design referenced `locations.timezone` for computing today / yesterday dates per location ("use locations.timezone field, default to America/New_York if null"). Foundation Spec v1.2 §4.1 lists the `locations` table with: `id`, `name`, `code`, `type`, `active`, `address`, `phone`, `created_at`, `created_by`. **No `timezone` column.** `lib/types.ts` `Location` interface mirrors §4.1 — also no `timezone` field.
**What built reality is:** Step 8's dashboard hardcodes `OPERATIONAL_TZ = "America/New_York"` for all date calculations. Both CO locations (MEP / EM) are in DC, same TZ — operational reality is single-timezone in v1. `app/dashboard/page.tsx` documents the rationale in its header comment.
**Why:** Touching schema in step 8 of Build #1 violates the §2.10 foundation lock (foundation-only-empty-tables rule; schema locked at end of Phase 1). The single-TZ assumption is correct for current operational reality. Adding the column for a hypothetical future expansion is premature.
**v1.3 action:**
- If/when CO expands beyond DC (different timezone), add a Supabase MCP migration: `ALTER TABLE locations ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York';` Backfill all existing rows with the default. Update `lib/types.ts` `Location` interface to include `timezone: string`.
- Update §4.1 to include the `timezone` column.
- Code change at the consumer (`app/dashboard/page.tsx` and any future TZ-dependent surface) is a one-line swap from the hardcoded constant to a per-row read off the resolved Location object.
- Don't introduce until operational expansion forces the issue.

---

## C.24 — Page-level reads use service-role instead of authed client

**Date added:** 2026-05-01
**Spec sections:** §5 (RLS philosophy), §15 (lib/supabase-server.ts use-case list), Module #1 Build #1 step 8 (`/dashboard`) and step 9 (`/operations/closing`)
**What spec says:** Spec §5 establishes RLS as the primary access-control layer; service-role usage is reserved per `lib/supabase-server.ts` for "audit log writes, notification deliveries, integration adapters, lockout state mutations, prep-list resolution generator, email verification + password reset token operations." Page-level reads aren't on that list — they'd default to authed client, RLS-gated.
**What built reality is:** Both `/dashboard` (step 8) and `/operations/closing` (step 9) Server Components use service-role for their data reads (locations, templates, instances, items, completions, author-name joins). Auth is enforced at the boundary via `requireSessionFromHeaders` + `lockLocationContext`; service-role bypasses RLS for the actual queries below the boundary.
**Why:**
- Server Components don't have direct access to the JWT (`requireSessionFromHeaders` returns the AuthContext but not the raw cookie value), so constructing an authed client requires extra plumbing through `cookies()` from `next/headers`.
- `requireSessionFromHeaders` + `lockLocationContext` provide the equivalent guarantees app-layer that RLS would provide DB-layer for the queries we actually run (location-scoped reads where the actor's accessible locations have already been verified).
- For Build #1 simplicity — both pages are read-only at the page level (writes go through API routes which DO use authed clients), so the security exposure is bounded.
**Acceptable risk for Build #1**, NOT a permanent stance. Defense-in-depth would have RLS gating the page reads even if the app-layer auth check ever breaks. The hardening path: in each Server Component, read the session JWT from the cookie store via `next/headers`, construct an authed client via `lib/supabase-server.ts createAuthedClient(jwt)`, use that for page-level reads. Service-role stays scoped to the writes that legitimately need it (per `lib/supabase-server.ts` use-case comment).
**v1.3 action:**
- Hardening pass: convert `/dashboard` and `/operations/closing` page-level reads to authed client. Verify with a quick smoke test that nothing relied on service-role's RLS bypass (the role-7+ all-locations override flows through `accessibleLocations`, so the authed client should still resolve correctly when the user has the override claim).
- Revisit when any new Server Component is added — default it to authed client at construction time; only fall back to service-role with explicit justification.
- Captured during Module #1 Build #1 step 9 implementation.

---

## C.25 — User permission model needs role + tags, not role only

**Date added:** 2026-05-01
**Spec sections:** §4.1 (`users` table), §7.1 (RoleCode hierarchy in `lib/roles.ts`), §7.2 (PERMISSION_MIN_LEVEL matrix)
**What spec says:** Foundation Spec v1.2 §4.1 / §7.1 model user permissions as a single `role` field tied to a hierarchical level. `RoleCode` is one of `cgs / owner / moo / gm / agm / catering_mgr / shift_lead / key_holder / trainer`, each with a numeric level. Permission checks via `lib/permissions.ts` `hasPermission(role, key)` resolve through `getRoleLevel(role) >= PERMISSION_MIN_LEVEL[key]`.
**What built reality is:** CO's operational reality includes capabilities that are orthogonal to the role hierarchy — most prominently "trainer." Examples Juan flagged during Build #1 step 10 testing:
- A KH who is also a trainer needs full KH permissions plus the ability to file training reports / lead trainee shifts
- An employee not yet promoted to KH may still hold the trainer capability — they can train newer employees on prep / cleaning standards even before they have key-holder responsibilities
- A Shift Lead who is also a trainer needs both
- An AGM who is NOT a trainer should not be filing training reports as the primary trainer (per spec §7.2 `training_report.write` permission, currently level 3+ — open to anyone, but the trainer ↔ trainee assignment relationship has no formal model)

The current `users.role = 'trainer'` enum value treats trainer as a single role at level 3, which forces a choice: an employee is either KH OR trainer, never both. Operationally, both should be possible.
**Why this matters:** Build #1 closing checklist doesn't surface the gap directly because closing items are role-leveled, not capability-leveled. Build #2 (Prep) and Build #3 (Opening) and Module #14 (Training) WILL surface it: training reports, trainee assignment, trainer-led shift attestation — all need to query "is this user a trainer?" independent of their seniority role.
**v1.3 action:**
- Introduce a tags layer. Two implementation options:
  - **Option A — separate table:** `CREATE TABLE user_tags (user_id UUID REFERENCES users(id), tag TEXT, granted_at TIMESTAMPTZ, granted_by UUID, PRIMARY KEY(user_id, tag))`. Tags are append-only with audit; deactivation handled via `active BOOLEAN` or row-removal.
  - **Option B — JSONB column on users:** `ALTER TABLE users ADD COLUMN tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`. Simpler queries; less audit granularity.
- Update `lib/roles.ts` / `lib/permissions.ts`:
  - Remove `trainer` from `RoleCode` (or keep it as a transitional "trainer-only with no other role" employee level)
  - Add `hasCapability(user, tag)` checks for `'trainer'` and any future tags
  - Permission matrix gains capability-keyed entries alongside role-keyed entries
- Module #14 (Training) design uses tags for trainer assignment; Module #2 (Prep) and Module #3 (Opening) consult tags for trainer-led shift annotations.
- Until the migration lands, the `trainer` role enum value stays — backwards-compatible, lets foundation continue to operate. Phase 5+ admin user-management tooling adds tag assignment/revocation at the same time the schema migration ships.
- Captured during Build #1 step 10 testing when Juan flagged the gap. Don't try to retrofit the tag system into Build #1 — the data model change requires schema migration plus admin-tool UI to support it. Address in the user-permissions design conversation when Modules 2/3/14 land.

---

## C.26 — Closing finalization gated by Walk-Out Verification completion + role

**Date added:** 2026-05-01 (initial role-only gate); refined 2026-05-01 (Walk-Out Verification completion gate added during Build #1 step 10 testing).
**Spec sections:** §2.4 (per-item completion model), §6.1 (PIN re-entry), Module #1 Build #1 step 9 (`/operations/closing` UI), §15 lib/checklists.ts (already enforces role-sufficiency at the lib + RLS layer per spec §6.1 step 5)
**What spec says:** Spec §2.4 establishes per-item completion. Spec §6.1 step 5 establishes confirm-time role check ("user's role level is sufficient to confirm this checklist (≥ all min_role_levels of completed items, OR equal to highest completed item level)"). Spec doesn't model the "who is the finalizer" question — it implicitly assumes a single submitter from the start of the shift.
**What built reality is (per Juan's confirmed Model A operational reality):** Closing is a **multi-author multi-hour process**. Persons A, B, C, D all tick items throughout shift — Crunchy Boi closes at 2pm, 3rd Party at 4pm, evening prep, etc. Items save individually via the optimistic UI flow in `ChecklistItem` (per step 6) and persist across sessions until finalization (no auto-submission, no per-user submit). Whoever's the **actual last-out** does **Walk-Out Verification** (lights off / devices charging / oven off / front doors locked / back door locked). That action signals "I'm finalizing this closing" and triggers the finalize affordance for THAT person.

**Fix applied** in `app/operations/closing/closing-client.tsx`. Finalize/Review UI gated by **both** conditions:

1. **`actor.level >= 4`** — security gate. Only KH+ can lock up the shop. Below KH, no finalization path renders regardless of Walk-Out Verification state.
2. **`walkOutVerificationComplete`** — operational gate. All 5 items in the "Walk-Out Verification" station must have live (non-superseded) completions. Computed reactively from the closing's completion Map — if a Walk-Out Verification item gets superseded or undone, the finalize UI disappears; re-completing brings it back.

The combined `canFinalize` flag wraps:
- Inline "Review & submit" CTA at end of list
- Sticky footer pill
- Review section (incomplete-reason inputs)
- `PinConfirmModal` mount (defense-in-depth)

Below the gate: items + per-station progress + sticky top progress bar render, but no finalization path. Closer's optimistic completions still save individually. The closing instance persists across sessions until someone finalizes — the closer who walks back in tomorrow morning sees yesterday's items already done.

**Why both conditions matter:** Role-only gating (the prior C.26 fix) correctly hid finalize from employees but still surfaced it to every KH+ actor on every page load. Operationally that's wrong — a KH who's been ticking Walk Ins items at 4pm shouldn't see "Review & submit" yet; the closing isn't ready to close. Walk-Out Verification completion is the system's way of detecting "the shift is actually wrapping up, this person is the one locking up." Combining the two gates means the affordance appears for the right person at the right time.

**ChecklistItem behavior unchanged** — every actor whose level satisfies the item's `min_role_level` can still complete items. `lib/checklists.ts` `confirmInstance` was already enforcing the role-sufficiency check at the lib layer per spec §6.1 step 5; the UI now layers the operational "is the closing ready to close?" check on top.

**Build #1 testing implication:** Validates correctly for the three test accounts. Juan (cgs/8) at MEP sees prior completions on fresh login (closing persists across sessions), completes the rest including Walk-Out Verification's 5 items, finalize UI appears, PIN attestation, read-only flip. Pete (owner/7) and Cristian (moo/6.5) work the same way. Employee-level UX validation comes when CO onboards real level-3 accounts (Build #1.5+) — the role gate already hides finalize from them; the Walk-Out Verification gate is moot for that role tier.

**v1.3 action:**
- Document this gating model explicitly in spec §6.1 alongside the role-sufficiency rule. Three layers in total:
  - **Item completion**: open to actors whose level satisfies each item's `min_role_level` (lib + RLS).
  - **Operational finalize-ready**: triggered by Walk-Out Verification station fully complete (UI gate).
  - **Finalize attestation**: PIN re-entry by the finalizer, role-checked against highest completed `min_role_level` (lib).
- Future modules with multi-author multi-hour artifacts (Opening, Prep, mid-day prep triggers) should adopt the same "operational signal triggers finalize affordance" pattern. The specific signal differs per artifact (Walk-Out Verification for closing; opening verification handshake for Opening per C.20; whichever).
- For any future closing-style artifact, the seed must include a station-or-equivalent that serves as the "I'm done with the shift" signal. Without that, the finalize UI never appears and the artifact can't close. Build #2 and Build #3 design conversations should explicitly address this.
- If CO ever introduces a "self-finalize before walk-out" override (e.g., management-only finalize without Walk-Out Verification, for late-night abandoned closings), it goes through admin tooling, not the closer's UI. See AGENTS.md `MODULE_REPORTS_CONSOLE_VISION.md` R.4 "late confirmations" + Phase 5+ admin override paths.

---

## C.27 — Notes need multi-tier visibility architecture (deferred)

**Date added:** 2026-05-01
**Spec sections:** §4.3 (`checklist_completions` schema — `notes TEXT`), §5.2 (RLS on `checklist_completions`), Module #1 Build #1 step 6 (`ChecklistItem` notes affordance)
**What spec says:** Spec §4.3 models notes as a single nullable text field on `checklist_completions`. Spec assumes one note per completion, no visibility scoping, no author attribution beyond the implicit `completed_by` linkage.
**What built reality is (per Juan's Pass 1 testing feedback):** CO's operational reality requires a richer notes model:
- **Public notes** — visible to all roles. Author-tagged with name + timestamp so the closer's note carries attribution context for the next shift.
- **Role-gated managerial notes** — visible only to actors at or above the author's level. A Shift Lead's managerial note is visible to SL+ (level 4+); an AGM's managerial note is visible to AGM+ (level 5+); a CGS note visible to CGS only. Mirrors how real kitchen handoffs work: some context is for everyone (public), some is "for managers' eyes" so it doesn't reach the floor team.
- **Multi-note per completion** — closing is multi-author over hours. Multiple authors may want to leave context on the same item ("Boris noticed the burner was sticky at 4pm, AGM noted it for follow-up at 9pm, GM signed off on the maintenance plan in the morning"). The current single-text-field model collapses these into one note that any later author overwrites or appends to inconsistently.
- **Visible UI rendering** — Build #1 stores notes via `checklist_completions.notes` (writeable from the row's expand affordance per step 6), but doesn't render them anywhere. The notes are forensic-only at this stage.

**What the design would likely look like:**
- New `checklist_completion_notes` table: `(id, completion_id, author_id, author_role, body, visibility, created_at)`. `visibility ∈ {'public', 'managerial'}`.
- New RLS policies scoping `managerial` notes to `current_user_role_level() >= author_role_level` per row. `public` notes readable by anyone with the parent completion read access.
- `ChecklistItem` refactor — render notes inline below the row when expanded, grouped by visibility tier and ordered chronologically.
- Authoring UI: the existing notes textarea expands into a "post note" affordance with a public/managerial toggle. AGM+ defaults to managerial; KH/SL defaults to public (with toggle available for SL to escalate to managerial visibility).
- Migration path for existing `checklist_completions.notes`: copy any non-null values into a single public note row authored by the original `completed_by` user. Then either drop the column or leave it as a denormalized "first-note" field for query convenience (TBD at design time).

**Why defer:**
- Real usage feedback from Cristian's first week of Build #1 closings should inform the visibility model + authoring patterns BEFORE schema is locked. Building a complex schema based on hypothetical workflows is the kind of premature architecture that ages badly.
- Build #1 is operationally functional without notes UI — the multi-author closing workflow validates end-to-end with items + completions + finalize. Notes are an enrichment layer, not a critical path.
- The existing `checklist_completions.notes` field continues to capture stored notes; nothing is lost. When the proper notes model ships, migration is straightforward.

**v1.3 action:**
- Build #1.5 polish session OR Build #2 kickoff design conversation: surface notes architecture as a top-tier discussion item. Inputs to that conversation: Cristian's first-week feedback on what notes he actually wants to leave + read.
- Schema migration goes through Supabase MCP `apply_migration` (Phase 1 lock notwithstanding — adding tables is non-breaking; the lock is about not modifying foundation tables).
- ChecklistItem notes-display refactor is a step-6-style component update; doesn't touch lib/checklists or API routes (notes are rendered, not validated against operational rules).
- Captured during Phase 3 Build #1 step 10 Pass 1 testing.

---

## How to add an entry

1. Pick the next monotonic ID (`C.<n>` — current next: C.28).
2. Spec sections under amendment.
3. Quote what spec says.
4. Document what built reality is.
5. Why the divergence is correct (operational reasoning, not just "we changed our mind").
6. What v1.3 should do — concrete action so the spec can be reconciled mechanically.

Date entries to whatever calendar the project is on (currently 2026-05-01).

This file is consumed by future spec versions. Its purpose is to make spec drift cheap to reconcile, not to legitimize ad-hoc deviations. Every entry should pass the test "would I tell Pete or Cristian this is the right way to do it?" before it lands here.

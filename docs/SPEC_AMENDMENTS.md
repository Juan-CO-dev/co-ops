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

## C.18 — Prep workflow architectural model (refined post-Image 1 reveal)

**Date added:** 2026-05-01
**Date updated:** 2026-05-04
**Spec sections:** §1.4 (Artifact model), §4.3 (Checklist tables), §10 / §15 lib/prep.ts
**What spec says:** Prep is modeled as opener-driven. Spec §15 lib/prep.ts comment: "1. Resolve par per vendor_item for (location, day-of-week) 2. Read on-hand from latest opening checklist closing-count completions 3. needed = max(par_target − on_hand, 0)." The implication is that opening produces counts and prep math derives from them.

**What built reality is (refined):** the prep workflow's architectural model is refined now that the actual operational artifact (CO's paper AM Prep List, "Image 1") is known. The two-trigger-paths model from the original C.18 stands; the data model is richer than originally scoped and the surfacing changes.

Two trigger paths for prep instances:

1. **Closer-initiated AM Prep (`triggered_by: 'closing'`)**: end of shift, single-author KH+ artifact (assignable to trainer or employee for training purposes). The closer fills the AM Prep List as their last operational task before closing finalize. Submission auto-completes the closing checklist's "AM Prep List submitted" item per C.42 reports architecture.

2. **Mid-day prep (`triggered_by: 'manual'`)**: any shift staff (level 3+, per C.21) can trigger a fresh prep instance when depletion surfaces. Multiple per day possible, numbered for the day per C.43.

**Data model is richer than originally scoped:**

Prep items have section-aware schemas with multiple numeric fields per item:

- **Veg section**: PAR / ON HAND / BACK UP / TOTAL columns
- **Cooks section**: PAR / ON HAND / TOTAL columns (no BACK UP)
- **Sides section**: PAR / PORTIONED / BACK UP / TOTAL (PORTIONED replaces ON HAND semantically)
- **Sauces section**: PAR / LINE / BACK UP / TOTAL (LINE replaces ON HAND)
- **Slicing section**: PAR / LINE / BACK UP / TOTAL
- **Misc/Notes section**: yes/no flags (e.g., meatball ready states, cook bacon) + free-form notes

PAR semantics:
- **PAR**: target quantity item should have
- **ON HAND / PORTIONED / LINE**: bottled/portioned/ready-for-service quantity
- **BACK UP**: unbottled/un-portioned quantity available but needs prep work to be service-ready
- **TOTAL**: combined service-readiness (operational interpretation; ON HAND + BACK UP semantically)

Units vary per item (QT, BTL, BAG, pan, count, "Prep Daily" special instruction).

**Why the original C.18 model is preserved but data model expanded:**

The original two-trigger-paths model and the operator-judgment-driven philosophy stand. What changes is the per-item structure, which is genuinely richer than `checklist_completions.count_value` can express cleanly. AM Prep is treated as a specialized form, not a force-fit into checklist primitives. Reuses existing checklist instance lifecycle, auth, audit, role-gate, RLS infrastructure (per C.42's reuse-where-natural principle) but uses a custom per-item data shape.

**v1.3 action:**

- Update §1.4 prep artifact description with the section-aware data model
- Add prep-specific tables/extensions to §4.3 schema
- Update §15 lib/prep.ts: prep math is operator-supplied, not system-computed; per-item data model carries PAR (denormalized from template), ON HAND/PORTIONED/LINE, BACK UP, TOTAL plus unit and section
- Reference C.42 (reports architecture) for surfacing details and C.43 (mid-day prep numbering) for multi-instance handling
- Reference C.44 (PAR template editing) for GM+ admin tooling

---

## C.19 — Closing as anchor, reports surface as items

**Date added:** 2026-05-01
**Date updated:** 2026-05-04
**Spec sections:** §1.4 (Artifact model), §4.3, §10–§12 (Module #1 Daily Operations), §16 Phase 6
**What spec says:** Closing is modeled as a single artifact: cleaning checklist with role-leveled items, multi-submission, PIN-confirmed. The original C.19 framed closing as having two phases (cleaning checklist + AM Prep List generation).

**What built reality is (refined):** Build #2's architectural surfacing reveals the closing checklist is better understood as the **shift anchor** that aggregates references to all operational reports for the day, with cleaning items + report-reference items + Walk-Out Verification all living in the same checklist.

Closing checklist remains a single operational artifact that finalizes the shift via PIN. Its template now includes three categories of items:

1. **Cleaning items** — existing per-station cleaning tasks (Image 6 content, shipped in Build #1)
2. **Report-reference items** — items that auto-complete when their corresponding operational report is submitted (per C.42 reports architecture):
   - "AM Prep List" item — auto-completes when AM Prep submitted that day
   - "Cash report" item — auto-completes when cash report submitted that day
   - "Opening report" item — auto-completes when opening report submitted that day (yesterday's opener for next-day's closer; today's opener for today's closer)
   - Future report types added as items as Build #2+ ships them
3. **Walk-Out Verification items** — existing 5-item finalize-gate (lights/devices/oven/doors, shipped in Build #1)

**The "two phases" framing is replaced with:**

The closing flow is one phase from the closer's UX perspective: open the closing checklist, tick cleaning items throughout the shift, fill AM Prep List as one of the last operational tasks (which auto-completes its closing item), submit cash report (auto-completes its closing item), complete Walk-Out Verification, finalize with PIN.

The auto-completion mechanic links report submissions to closing checklist items: when a report is submitted for the current operational date, a `checklist_completion` row is written for the corresponding closing template item, with completion attribution preserving the report submitter and a metadata link to the report instance.

**Existing closing finalize architecture preserved:**

- Walk-Out Verification gate from C.26 remains the operational signal
- Role gate (KH+) for finalization remains
- Incomplete required items can still be finalized with reasons (per Build #1 spec §6.1) — if a report wasn't submitted, the closer flags the corresponding closing item as incomplete with a reason ("Opener didn't show, opening report not done"). Same flow as any other incomplete required item.

**Standard Closing v2 still happens via Path A versioning:**

The original "Fill out AM Prep List" line item from Closing v1 is replaced by the new "AM Prep List" report-reference item in Closing v2. v1 stays active for old instances; v2 active for new instances. No schema change beyond template seeding.

**Why this refinement:**

The two-phases model treated AM Prep as architecturally special (its own phase). Reality is AM Prep is one of several operational reports the closer must reference; cash report and opening report carry the same architectural weight. Treating closing as the anchor that aggregates report references via auto-completing items gives a unified model that scales to all report types (per C.42).

**v1.3 action:**

- Restructure §1.4 closing artifact description: closing checklist is the day's anchor; aggregates cleaning items, report-reference items (auto-complete via report submission), and Walk-Out Verification items
- Document the report-item auto-completion mechanic in §10 (shared infrastructure services) — when a report submission lands, a paired `checklist_completion` row writes for the corresponding closing item
- Reference C.42 for the broader reports architecture
- Standard Closing v2 ships in Build #2 PR pass that includes AM Prep

---

## C.20 — Opening report (semantic rename, surfaces via reports architecture)

**Date added:** 2026-05-01
**Date updated:** 2026-05-04
**Spec sections:** §1.4 (Artifact model), §4.3, §10–§12 (Module #1 Daily Operations)
**What spec says:** Opening collects on-hand counts of inventory items. Those counts feed the prep-math computation per §15 lib/prep.ts.

**What built reality is (refined):** the verification artifact described in original C.20 (opening = quality control on prior closing + AM Prep validation, NOT count collection) is semantically renamed to **"Opening report"** and surfaces per C.42's reports architecture. Original operational purpose unchanged.

Opening report is the named artifact that opens each operational day. Per C.42 reports architecture:
- Reachable from a dedicated dashboard tile
- Submitted by the opener (KH+ typically; assignment rules per role permissions)
- Auto-completes the corresponding closing checklist item ("Opening report") when submitted
- Has its own searchable history (opening reports across days/locations)

The verification semantics from original C.20 are preserved:
- Reviews prior closing's completed items
- Validates the AM Prep List generated at close (spot-check actual current state vs closer's estimate)
- Triggers a fresh prep_instance with `triggered_by = 'opening'` ONLY when opener's spot-check materially disagrees with closer's estimate

**Why renamed:**

C.42's reports architecture treats each operational artifact as a first-class report on the dashboard. Calling it "opening verification" leaves the name implying it's an internal check rather than a first-class operational deliverable. "Opening report" makes it parallel with "Cash report," "AM Prep List," etc.

**v1.3 action:**

- Update §1.4 opening artifact description: name is "Opening report"; verification semantics from original C.20 stand
- Reference C.42 for surfacing model
- The C.20 "opener doesn't generate canonical numbers" point stands — opening report's optional prep-trigger fires only on disagreement

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

## C.28 — Revocation + accountability tagging (two-window architecture)

**Date added:** 2026-05-03
**Spec sections:** §2.5 (immutable completions), §4.3 (`checklist_completions`), §5.2 (RLS on `checklist_completions`)
**What spec says:** §2.5 establishes that "checklist completions and submissions are immutable on creation. To correct a checklist completion, submit a new completion event (which supersedes by recency)." Spec doesn't explicitly model revocation, accountability correction, or the "wrong person tapped" case.
**What built reality is:** Per Cristian's first-shift Build #1 use, closers want error correction without friction. Juan's refined model is two-window:

1. **Within 60s of completion (silent self-untick):** the actor who just tapped sees an "Undo" affordance that revokes the completion silently. Pure error correction — no reason required, no audit metadata beyond `revocation_reason: 'error_tap'` + `in_quick_window: true`. Constrained to self (`completed_by === actor.userId`).

2. **After 60s (structured action by self):** the actor who completed sees an "Edit completion" affordance with three chips:
   - `wrong_user_credited` — opens picker; the actor admits they tapped but someone else did the work. Original completion stays; `actual_completer_id` is annotated. Operational truth (the tap) preserved; accountability truth (who actually did it) corrected.
   - `not_actually_done` — revokes the completion; the row reopens.
   - `other` — revokes with a required free-form note (enforced at lib layer since cross-column constraints are awkward in Postgres).

3. **KH+ peer correction (any time after 60s):** any KH+ actor (level ≥4) viewing any completed row sees a "Tag actual completer" affordance. Picker scope (computed server-side): users with at least one non-revoked completion on this `checklist_instance` OR users with any sign-in audit row at this location today, filtered by item's `min_role_level`.

4. **Tag replacement rules:** lateral and upward allowed (`replacement_actor.level >= current_tagger.level`); downward not (a KH cannot override an AGM tag). Original tagger can self-correct any time regardless of level.

5. **Architectural separation of two truths:** `completed_by` is **operational truth** — the append-only record of who tapped — and is never modified. `actual_completer_id` is **accountability truth** — annotated retrospectively when the wrong person was credited. The two columns answer different questions and intentionally diverge. The audit trail of `actual_completer_tagged_by` + `actual_completer_tagged_at` preserves the correction event itself as immutable history.

6. **Future signal for Reports Console:** patterns of `actual_completer_id != completed_by` rows surface as data-quality signals (volume + role distribution over time) — diagnostic, not punitive. Captured in Module #1 Build #5 (Synthesis View) or the future Reports Console module (scope per [`docs/MODULE_REPORTS_CONSOLE_VISION.md`](./MODULE_REPORTS_CONSOLE_VISION.md)).

**Why:** Spec's append-only model is correct for "what happened in the system" but operationally insufficient for "who actually did the work." Real shifts have wrong-person taps, mid-shift relief, and trainee handoff that the system needs to capture without losing the original tap event. The two-window design (60s silent vs. structured-after) maps to real human error patterns: most fat-finger errors are caught within seconds; deliberate accountability corrections require a structured intent-capture path that the audit log can rely on. The "operational truth vs accountability truth" split keeps the data model honest about what each column means.
**v1.3 action:**
- Add to `checklist_completions` schema: `revoked_at TIMESTAMPTZ`, `revoked_by UUID`, `revocation_reason TEXT CHECK (IN ('error_tap', 'not_actually_done', 'other'))`, `revocation_note TEXT`, `actual_completer_id UUID`, `actual_completer_tagged_at TIMESTAMPTZ`, `actual_completer_tagged_by UUID`. All nullable; FKs to `users(id)`. Migration ships in Build #1.5 PR 1.
- Reword §2.5: "Completions are append-only for the `completed_by` field; corrections to operational error use the revocation columns (`revoked_*`); corrections to accountability error use the `actual_completer_*` columns. Tag replacement enforces lateral-and-upward only at the lib layer."
- Add audit action codes: `checklist_completion.revoke` (metadata: `in_quick_window`, `reason`, `note?`) and `checklist_completion.tag_actual_completer` (metadata: `actual_completer_id`, `replaced_prior_tag?: { tagger_id, prior_actual_completer_id }`). Both auto-derived destructive via `lib/destructive-actions.ts`.
- New `ChecklistError` subclasses: `ChecklistOutsideQuickWindowError`, `ChecklistNotSelfError`, `ChecklistTagWithinQuickWindowError`, `ChecklistInvalidPickerCandidateError`, `ChecklistTagHierarchyViolationError`, `ChecklistRevocationNoteRequiredError`.
- Lib functions in `lib/checklists.ts`: `revokeCompletion(authed, completionId, actor)` (60s self-only silent), `revokeWithReason(authed, completionId, actor, payload)` (post-60s self with reason+note), `tagActualCompleter(authed, completionId, actor, actualCompleterId)` (KH+ post-60s with picker scope + hierarchy enforcement). API routes in Build #1.5 PR 1; UI in PR 2.
- Captured during Phase 3 Build #1.5 design from Cristian's Build #1 first-shift production feedback + Juan's refined two-window model.

---

## C.29 — Notes inline display

**Date added:** 2026-05-03
**Spec sections:** §4.3 (`checklist_completions.notes`), C.27 (notes multi-tier visibility — deferred)
**What spec says:** §4.3 models notes as a single nullable text field on `checklist_completions`. C.27 defers the multi-tier visibility architecture (public vs managerial, multi-note per completion) pending real-usage feedback.
**What built reality is:** Notes are stored via `checklist_completions.notes` per the Build #1 step 6 notes-edit affordance, but are not rendered anywhere in the UI. Build #1.5 PR 3 surfaces stored notes inline in the row meta slot — below the completion attribution — for any live (non-revoked) completion with a non-null note. Format: small text using `co-text-muted`, italicized or with a "Note:" prefix. The C.27 multi-tier architecture stays deferred — Build #1.5 PR 3 just renders what's already stored to whoever can read the row (single note, no scoping, no per-author attribution beyond what's already visible from `completed_by`).
**Why:** The notes data exists and is being captured but is invisible, which means neither the closer who wrote it nor the next-shift staff who would benefit ever see it. A single rendering pass closes the visibility gap without committing to the full multi-tier architecture before Cristian has accumulated enough first-week notes to argue a specific visibility model.
**v1.3 action:**
- `ChecklistItem` renders `completion.notes` inline when non-null and the completion is live. Touch limited to `components/ChecklistItem.tsx` in Build #1.5 PR 3.
- No schema change.
- C.27's multi-tier architecture remains the next architectural step once usage data argues for a specific scoping model.
- Captured during Phase 3 Build #1.5 scoping (visibility gap noticed during Cristian's first-shift use).

---

## C.30 — Station header prominence

**Date added:** 2026-05-03
**Spec sections:** §10–§12 (Module #1 Daily Operations UI styling — not specifically prescriptive on station headers)
**What spec says:** Spec doesn't specify visual weight of station headers in the closing UI. The design language is implicit, inherited from brand book and prior step decisions in Build #1.
**What built reality is:** Build #1's station headers are too quiet visually for operational use. Cristian's first-shift feedback surfaced the friction: closers can't quickly identify their current station while moving between physical work and the screen. Build #1.5 PR 4 increases prominence in `app/operations/closing/closing-client.tsx`:
- Bump font size: `text-base` → `text-lg`
- Bolder weight: `font-medium` → `font-semibold`
- Add a thin Mustard-deep accent line beneath each station header (~1px, full width of header text)

Pure visual polish — no data model or behavioral changes.
**Why:** Closing operations are physical-first — closer is moving between equipment, prep stations, and back to the screen to tick items. The screen needs to support quick re-orientation; subdued station headers force the closer to read more carefully than the operational tempo allows.
**v1.3 action:**
- Update §10–§12 design language documentation to specify station headers as `text-lg` / `font-semibold` with Mustard-deep accent. Document the rationale (physical-first operational flow demands quick scan-ability).
- Future operational surfaces (Opening, Prep) inherit the same station-header treatment for consistency.
- Captured during Phase 3 Build #1.5 scoping (Cristian's first-shift visual prominence feedback).

---

## C.31 — Spanish toggle (i18n infrastructure for static UI strings)

**Date added:** 2026-05-03
**Spec sections:** §1 (CO operational context — Spanish-speaking staff), §4.1 (`users` table), Module #1 UI surfaces
**What spec says:** Spec acknowledges CO has Spanish-speaking staff but doesn't specify i18n infrastructure for static UI strings. All Build #1 UI ships English-only.
**What built reality is:** Static UI strings need bilingual support for CO's Spanish-speaking frontline staff. Build #1.5 PR 5 ships the i18n infrastructure:
- Translation file structure: `lib/i18n/en.json` and `lib/i18n/es.json`, keyed by translation key (e.g., `dashboard.greeting.hello`, `closing.review.continue`)
- React translation provider via Context (no external library — Next 16 + React 19 native Context is sufficient for static-string translation; the operational scope doesn't justify a dedicated i18n library at this stage)
- Translation hook `useTranslation()` returns `t(key, params?)` and current language
- Schema migration: `ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es'))`
- Language selector UI in the user menu / settings area; on change, PATCH user record + reload provider context
- All static strings refactored to use translation keys (one-time refactor across all UI files); namespaced by surface area: `auth.*`, `dashboard.*`, `closing.*`, `common.*`. Keys describe the string semantically (`closing.review.submit_button`), not literally
- Spanish translations generated for all existing keys — operational/practical Spanish, not formal — audience is Spanish-speaking restaurant workers

What's NOT in scope:
- Free-form content (notes, comments, written reports) stays in original language
- Database content (template item names, descriptions) stays English-only for now; multilingual database content deferred to Module #2 or beyond
- AI translation at read-time deferred to future AI integration
- URL routing (`/en/...` vs `/es/...`) NOT implemented; language is purely a per-user preference

**Why:** CO's frontline staff includes Spanish speakers operating the closing checklist nightly. English-only UI creates real comprehension friction at the wrong layer (operational, not strategic). Static-string translation is the high-leverage low-cost first step. Free-form content translation is a different problem (read-time AI translation when the AI integration lands) and the architectures shouldn't be coupled.
**v1.3 action:**
- Add `users.language` column to spec §4.1 schema documentation. Migration number reserved at PR 5 architectural surface time, applied at PR 5 implementation.
- Add `lib/i18n/` to lib structure docs.
- Add Spanish-translation-as-shipping-requirement to UI design language docs — every new UI surface in Build #2+ ships with translation keys (not literal strings) and a Spanish translation pass in the same PR.
- Free-form content translation (notes, written reports) becomes its own architectural conversation when AI integration lands.
- Captured during Phase 3 Build #1.5 scoping.

---

## C.32 — Login tile employee + trainee surfaces

**Date added:** 2026-05-03
**Spec sections:** §7.1 (RoleCode hierarchy), Module #1 Build #1 step 1 (login screen tiles)
**What spec says:** §7.1 lists the RoleCode hierarchy including `employee` (level 3) and `trainee` (level 2), but Build #1's login screen surfaced tiles only for higher-level accounts (KH+). The lower-level role tiles weren't built because Build #1 didn't have employee or trainee accounts to surface.
**What built reality is:** Build #1.5 PR 6 verifies that `employee` (level 3) and `trainee` (level 2) role codes exist in the `RoleCode` enum + `lib/roles.ts` registry, then adds tile support on the login screen so any active user account at the location renders a tile regardless of role level. If the role codes are missing at recon time, a small enum migration ships alongside the UI change.

Trainee permission scoping (read-only, training-period restrictions) remains at current design — no permission changes in this PR. Trainee-specific permission gating is a Module #2 concern (per C.34); Build #1.5 PR 6 only adds the tile rendering surface so trainee accounts can sign in at all.
**Why:** Build #1.5 begins the path to onboarding real employee + trainee accounts. The login screen needs to render tiles for those role levels before any of them can sign in. The permission scoping conversation is separate (Module #2 design conversation, captured in C.34).
**v1.3 action:**
- Verify §7.1 RoleCode hierarchy includes `employee` and `trainee`; if not, document the addition.
- Update Module #1 Build #1 step 1 spec text to remove any "higher-level only" tile rendering logic — login tiles render for all active users at the location.
- Trainee permission scoping (training-period restrictions, read-only constraints) is a Module #2 design question and is captured in C.33 + C.34.
- Captured during Phase 3 Build #1.5 scoping.

---

## C.33 — Full user level structure (9 levels, 0 through 8)

**Date added:** 2026-05-03
**Spec sections:** §7.1 (RoleCode hierarchy)
**What spec says:** §7.1 lists the RoleCode hierarchy at levels 2 (trainee), 3 (employee, trainer), 4 (key_holder), 5 (shift_lead, catering_mgr), 6 (gm), 6.5 (moo), 7 (owner), 8 (cgs). Spec doesn't model the lower levels (prospect, unassigned) because those are not authenticated system users in the current foundation.
**What built reality is (and intended for v1.3):** CO-OPS user lifecycle has 9 levels covering the full hire-to-promote arc:
- 0 — **prospect** (in recruitment pipeline, no login)
- 1 — **unassigned** (hired, no PIN, no system access)
- 2 — **trainee** (read-only scoped to role, 4-week training period)
- 3 — **employee** (full operational role)
- 4 — **key holder**
- 5 — **AGM / shift lead**
- 6.5 — **MoO, GM** (consolidated as effectively-equivalent in operational decision-making per CO's structure)
- 7 — **owner**
- 8 — **cgs**

State transitions: prospect → unassigned (hiring decision); unassigned → trainee (PIN setup); trainee → employee (4-week training completion + manager sign-off); subsequent promotions (manager-driven, audited). Each transition is an operational action with audit trail, not a manual database edit.

Build #1.5 PR 6 verifies + surfaces the **existing roles only** — levels 2 through 8 that already have foundation registry entries. Full lifecycle architecture (levels 0–1 + state-transition workflows) is deferred to Module #2 (C.34).
**Why:** Documenting the full level structure now (even before the lower levels are implemented) gives Module #2 design a clear architectural target — the lifecycle stages it must support. Without this captured, Module #2 risks rebuilding the level model from scratch and missing transitions like prospect → unassigned that don't fit cleanly into a CRUD model.
**v1.3 action:**
- Update §7.1 RoleCode hierarchy to include levels 0 (`prospect`) and 1 (`unassigned`) as future-reserved values.
- Document the state-transition graph with each transition as an audited operational action: hiring decision, PIN setup, training completion, promotion.
- Each transition becomes an admin action surface in Module #2 (per C.34) — not a direct database mutation.
- The 4-week training period is the canonical milestone for trainee → employee; Module #2 design specifies the milestone-tracking + manager-sign-off flow.
- Captured during Phase 3 Build #1.5 scoping (Build #1.5 PR 6 acts on levels 2–8 only; levels 0–1 reserved for Module #2).

---

## C.34 — Module #2: User Lifecycle & Recruitment (deferred)

**Date added:** 2026-05-03
**Spec sections:** §7 (User permission model), §13 (Admin tooling — partial coverage of user management)
**What spec says:** Spec §13 describes admin user-management tooling at a CRUD level (create, deactivate, role change). Recruitment, onboarding, training pipeline, and lifecycle state transitions are not modeled.
**What built reality is (deferred — captured here, designed in Module #2):** Module #2 is distinct from Module #1 (Daily Operations / Checklists). Scope:

(a) **Recruitment pipeline UI** for AGM+ — prospect tracking, evaluation, hiring decisions. AGM+ access (no separate "recruiter" tag).

(b) **Onboarding workflow** — PIN setup, first-day setup, account activation.

(c) **Training pipeline** — 4-week trainee period with milestone tracking, trainer endorsements per the C.25 tag system, certification per task type.

(d) **Promotion mechanics** — trainee → employee, employee → KH, etc., with audit trail. Each promotion is a structured operational action, not a database edit.

(e) **Cross-location candidate allocation** — prospects and trainees are a CO-wide pool initially. Locations can bid/request candidates from the pool. Supports labor capacity forecasting (4 weeks out) and natural talent flow between locations.

(f) **Region scoping architecture (dormant initially)** — data model supports region-based candidate pools when activated. Region structure controlled by MoO+. Default region applied to existing locations until first multi-region expansion. Single-region behavior (dormant region scoping) matches the CO-wide pool today; MoO+ activation gates the transition to region-aware pool when CO expands beyond a single metro.

Distinct data model, workflows, UI surfaces, and role considerations from Module #1.
**Why:** User lifecycle management has a fundamentally different operational tempo from daily ops. Daily ops are shift-cadence (hourly to daily); lifecycle ops are weeks-to-months (recruitment cycles, training periods, promotion windows). Mixing them in one module obscures both. The cross-location pool + region scoping decisions are also strategic-tier (MoO+ activates region structure), not operational-tier (shift staff trigger prep instances).
**v1.3 action:**
- Reserve Module #2 as the user-lifecycle module.
- Defer detailed design to a dedicated module-design conversation after Module #1 stabilizes (post Build #5 / Synthesis View).
- Module #2 design references C.25 (tags layer), C.32 (trainee tile surfacing), C.33 (full level structure including levels 0–1), and this entry (C.34 — scope).
- Until Module #2 ships, user lifecycle is handled via Phase 5+ admin tooling per Phase 2.5 §7 (manual provisioning, scrub procedure).
- Captured during Phase 3 Build #1.5 scoping (no PR — pure deferred capture).

---

## C.35 — Login tile performance indicators (deferred to dedicated design)

**Date added:** 2026-05-03
**Spec sections:** Module #1 Build #1 step 1 (login screen tiles), Module #1 Build #5 (Synthesis View)
**What spec says:** Spec doesn't model performance indicators on login tiles. Login is purely identity selection in spec.
**What built reality is (deferred — not building in Build #1.5):** Concept floated during Build #1.5 scoping: visual indicators on login tiles showing each user's recent performance metric (e.g., closing time, task count, sequence adherence). Defer to a dedicated design conversation because the metric definition has high leverage on culture and behavior:

- **Metric definition** — what counts as "doing well"? Closing time alone incentivizes rushing. Task count alone incentivizes ticking-without-doing. Sequence adherence alone may penalize legitimate workflow variations.
- **Visibility scoping** — who sees whose color? Public visibility creates social pressure / public ranking; manager-only visibility avoids that but reduces the indicator's motivational pull.
- **Cultural consideration** — performance ranking is a double-edged signal. The wrong metric incentivizes gaming behavior; the right metric reinforces operational excellence. CO's small-team culture amplifies both effects.

**Why defer:** Building a half-designed performance indicator surfaces the wrong incentive permanently. The metric design conversation needs Pete + Cristian + Juan in the room with operational data from real shifts (Build #5 Synthesis View output is the natural input).
**v1.3 action:**
- Reserve as a future surface within Module #1 (login screen) or as part of a dedicated "Performance Surfaces" cross-cutting concern.
- Schedule the design conversation after Build #5 ships and Synthesis View output is available as input.
- Capture metric design carefully — wrong metrics incentivize gaming. Multiple complementary metrics with role-aware visibility are likely better than a single composite metric.
- Captured during Phase 3 Build #1.5 scoping (no PR — pure deferred capture).

---

## C.36 — Module #3: Content / Social Media (deferred)

**Date added:** 2026-05-03
**Spec sections:** None — module not yet modeled in spec
**What spec says:** Spec doesn't model content / social media operations. CO-OPS foundation focuses on daily ops + user lifecycle.
**What built reality is (deferred — captured here, designed in Module #3):** New module entirely separate from Module #1 (Daily Operations) and Module #2 (User Lifecycle & Recruitment). Scope:

- Creative direction question handling (where does brand-relevant creative input go?)
- Photo / asset management (uploads, tagging, retrieval)
- Metrics reporting (engagement, post performance)
- Photoshoot request scheduling (when staff are needed for content)
- Content idea capture (running list of post / campaign ideas)
- Content participant coordination (which staff appears in what content; consent + scheduling)
- Calendar / scheduling integration (post timing, photoshoot timing, content release coordination with operations)

Distinct data model, workflows, role considerations.
**Why:** Content operations sit outside daily ops and user lifecycle but interact with both (staff scheduling, creative direction tied to ops calendar, photo subjects who are also on the floor). Modeling content as a separate module prevents bleed-through that would muddy Module #1 / Module #2 schemas.
**v1.3 action:**
- Reserve Module #3 as the content / social media module.
- Defer detailed design to a dedicated module-design conversation, scheduled after Module #1 + Module #2 stabilize.
- Captured during Phase 3 Build #1.5 scoping (no PR — pure deferred capture).

---

## C.37 — Translation-keys-from-day-one (CO-OPS i18n convention)

**Date added:** 2026-05-04
**Spec sections:** §1 (CO operational context), C.31 (i18n infrastructure)
**What spec says:** Spec doesn't address how new UI surfaces should handle i18n after PR 5a establishes the infrastructure.
**What built reality is (and intended for v1.3):** Every new UI surface in Build #2+ ships with translation keys (not literal strings) and a Spanish translation pass in the same PR. English-only string literals in JSX are scope-incomplete and must not ship. This applies to all future modules: recipe/training (Module #?), prep workflow (Module #1 Build #2), opening checklist (Build #3), shift overlay (Build #4), synthesis view (Build #5), Module #2 user lifecycle, Module #3 content/social media, and any future modules.
**Why:** Shipping English-only UI surfaces silently breaks the Spanish toggle for users who've selected Spanish — they see a half-translated app, which creates UX confusion and operational distrust ("the toggle doesn't actually work"). Half-translated surfaces are worse than monolingual English. The only sustainable path is: every new feature includes both languages from the moment it ships, no exceptions, no "translation pass later."
**v1.3 action:**
- Add a top-level convention statement to spec §1 establishing this as a CO-OPS architectural norm
- Future module specs reference this amendment in their definition-of-done
- AGENTS.md captures the working-rhythm version of this convention
- Captured during Phase 3 Build #1.5 PR 5a after Juan's push-back on partial-translation drift risk (the "ship complete or don't ship" expansion of PR 5a's scope to cover the full closing flow + PinConfirmModal end-to-end)

---

## C.39 — Authenticated route group with floating UserMenu pattern

**Date added:** 2026-05-04
**Spec sections:** §1 (CO operational context), C.31 (i18n infrastructure), Module #1 Build #1.5 PR 5b
**What spec says:** Spec doesn't address authentication boundary placement or how cross-cutting authenticated UI concerns (i18n provider, user menu) mount across the app.
**What built reality is:** PR 5b establishes `app/(authed)/*` as the authenticated route group. The group's `layout.tsx` owns three cross-cutting concerns:
1. `requireSessionFromHeaders()` auth boundary — denial redirects to `/?next=<path>` per Phase 2 Session 4
2. `TranslationProvider` mount with `user.language` read at the layout level — every authenticated client component gets translation Context for free
3. `UserMenu` mounted as a fixed-position floating element (`top-4 right-4 z-30`) — every authenticated page gets user-menu access without per-page boilerplate

Page-level `requireSessionFromHeaders` calls are KEPT for typed auth access (locations, level, role for page logic). The ~5ms duplicate cost is acceptable vs prop-drilling from this layout — Server Component layouts can't cleanly pass typed objects to children, and the alternatives (Context from a Server layer, or layout-children prop API gymnastics) create worse downstream problems.

Pages render their own structural chrome (headers, banners) underneath/beside the floating UserMenu. AuthShell stays on dashboard as page-level chrome; closing page keeps its minimal operational chrome.

**Why:** Solves the partial-language-toggle problem (UserMenu was previously closing-page-only, so language toggle was inaccessible from the dashboard); future authenticated pages inherit translation + menu access for free; preserves each page's chrome design (no banner stacking); no per-page UserMenu mount boilerplate; cleanly separates cross-cutting concerns (auth, translation, UserMenu) from page chrome design.

**Architectural constraint:** Top-right corner real estate is reserved for UserMenu (40×40 avatar circle + dropdown panel) and future floating elements (notification bell, breadcrumbs, etc.). Future module designs must NOT place critical interactive content in this corner where the floating UserMenu would overlap it.

**v1.3 action:**
- Document `app/(authed)/*` as the canonical authenticated route group
- New authenticated pages live inside this group and automatically inherit auth boundary, translation context, UserMenu access
- Update spec §13 admin tooling and Module #2 user lifecycle module to reference this pattern
- Future cross-cutting authenticated concerns (notification bell, breadcrumbs, command palette, etc.) mount at the same `(authed)/layout.tsx` rather than per-page
- Captured during Phase 3 Build #1.5 PR 5b after Juan's smoke test revealed UserMenu was closing-page-only

---

## C.38 — Closing template items use JSONB translations as a tactical fix; system-wide multilingual database content deferred

**Date added:** 2026-05-04
**Spec sections:** §4.3 (`checklist_template_items`), C.31 (i18n infrastructure)
**What spec says:** Spec doesn't address multilingual database content for `checklist_template_items` (or for other DB-stored user-facing strings like vendor items, recipes, training content, prep templates). C.31 deferred multilingual DB content to "Module #2 or beyond" but didn't specify the architectural pattern.
**What built reality is:** Build #1.5 PR 5c adds `checklist_template_items.translations JSONB NULL` as a tactical fix for the closing-flow Spanish experience. Shape: `{ "es": { "label": "...", "description": "...", "station": "..." } }`. Resolver `lib/i18n/content.ts` `resolveTemplateItemContent(item, language)` returns translated content when present and falls back to the original `label`/`description`/`station` columns otherwise.

What this is NOT:
- NOT a system-wide multilingual content architecture decision
- NOT applied to vendor items, recipes, training content, prep templates, or other DB content yet
- NOT a binding commitment to the JSONB-column pattern as the canonical solution; future architectural conversation might choose a translation table, locale-keyed rows, or other pattern

**System-key vs display-string discipline (CRITICAL):** Business keys stay English-source. The original `label` / `description` / `station` columns are the system source-of-truth AND the system-key for matching/grouping logic. Translation happens at render time only via the resolver. Examples:
- `it.station === WALK_OUT_VERIFICATION_STATION` (Walk-Out gate matching)
- station-grouping keys in the closing UI (`groupByStation`)
- `data-station` attribute used by IntersectionObserver scroll detection
- Future vendor item names for inventory matching, recipe names for prep template matching

Confused-deputy risk if translated strings are used as matching keys: a Spanish-language user's resolved station "Verificación de Salida" would not equal the English `WALK_OUT_VERIFICATION_STATION` constant, and the Walk-Out gate would never unlock for them. Future translatable content (vendor items, recipes, training, prep templates) MUST follow the same discipline: original field is the system source-of-truth, translations override at render only.

**Why:** The Spanish toggle from PR 5a translated UI scaffolding (Undo, Review and submit, Cancel, etc.) but checklist item content stayed English because it lives in the DB. Spanish-speaking closers saw Spanish chrome but English work items ("Wipe down meat slicer," "Lock back door") — half-translated for the people the toggle is meant to serve. Tactical JSONB fix completes the closing-flow Spanish experience without committing to a system-wide architecture under deadline pressure.

**v1.3 action:**
- Document the JSONB translations column on `checklist_template_items` as the tactical pattern; explicitly call out it's NOT canonical
- Document the system-key vs display-string discipline as a CO-OPS architectural norm; add to spec §1 alongside C.37's translate-from-day-one convention
- Schedule a dedicated architectural conversation for system-wide multilingual database content BEFORE Build #2 introduces more user-visible DB content (prep template items, opening checklist items in Build #3, vendor items in admin tooling, recipes/training in future modules). The conversation should evaluate JSONB-column vs translations-table vs locale-keyed-rows patterns and pick the canonical one for the system
- Until that conversation lands, NEW user-visible DB content uses the JSONB pattern by extension (cheap to migrate later if a different pattern wins)
- Captured during Phase 3 Build #1.5 PR 5c after Juan's smoke-test surfaced the partial-translation gap (UI scaffolding translated; DB content stayed English)

---

## C.40 — Pre-auth surfaces stay English permanently (not deferred)

**Date added:** 2026-05-04
**Spec sections:** §1 (CO operational context), C.31 (i18n infrastructure), C.37 (translate-from-day-one)

**What spec says:** C.31 establishes i18n infrastructure; C.37 establishes translate-from-day-one for new UI surfaces. Spec doesn't address pre-auth surfaces explicitly.

**What built reality is (and is intended to remain):** pre-auth surfaces — login screen (`/`), email verify pages, reset-password pages, and `PasswordModal` when mounted in pre-auth contexts — stay English permanently. This is **not a deferral**; it's a deliberate architectural commitment.

**Why:** pre-auth users have not expressed a language preference. Defaulting to a non-English language requires either (a) browser locale guessing (unreliable — English speakers in non-English-default browsers get the wrong default) or (b) remembered cookies from prior sessions (privacy-edge, requires explicit opt-in). English is the universal entry point — every authenticated user has navigated past it and reached UserMenu where they can express preference. The C.37 translate-from-day-one convention applies to **authenticated** UI surfaces; pre-auth surfaces are explicitly out of scope.

**v1.3 action:** document spec §1 with the pre-auth-stays-English commitment alongside C.31's i18n infrastructure description. Future modules adding pre-auth UI (e.g., new account-recovery flows, signup if introduced) inherit this commitment automatically. Captured during Phase 3 Build #1.5 PR 6 after Juan's explicit decision to lock pre-auth-English permanently rather than defer to a future translation pass.

---

## C.41 — Level number divergence between DB+lib implementation and C.33 documented intent

**Date added:** 2026-05-04
**Spec sections:** §7.1 (RoleCode hierarchy), C.26 (Walk-Out gate), C.33 (full 9-level user structure)

**What spec says:** C.33 documents the intended 9-level structure including `key_holder` at level 4 and `shift_lead` at level 5.

**What built reality is (current divergence):** DB constraint and `lib/roles.ts` currently implement `key_holder` at level 3 and `shift_lead` at level 4. The C.26 walk-out gate (`level >= 4` — only KH+ can lock up) operationally functions today because `shift_lead` is at level 4 in implementation, satisfying the gate at SL or above. But the documented C.33 intent (`key_holder` at level 4) hasn't been reconciled with implementation. Build #1.5 PR 6 (employee + trainee tile rendering) added `employee` at level 3 and `trainee` at level 2 per C.32; this surfaced — but did not fix — the broader C.33 divergence.

**Why this is acceptable for now:** operational behavior is correct (level-4 gate fires for SL+ today, which matches the spec's "KH+ can finalize" intent because SL > KH in role hierarchy regardless of numeric level). The divergence is a documentation/implementation drift, not a behavior bug. Reconciling it requires touching every RLS policy referencing role levels, the helper function `current_user_role_level()`, the permission matrix in `lib/permissions.ts`, and `lib/checklists.ts` finalize gates. Out of scope for Build #1.5.

**v1.3 action:** reconcile when Module #2 user lifecycle work lands (Module #2 will redefine the level map per C.33's full structure including levels 0–1, which is the natural moment to fix the existing 2–8 numbering). Until then, `lib/roles.ts` and DB CHECK constraint stay at current values; tests and gates against `level >= 4` continue to function as "SL+" effectively. Captured during Phase 3 Build #1.5 PR 6 recon when employee + trainee role addition surfaced the broader structure divergence.

**Build #2 PR 1 sub-finding (added 2026-05-04):** the closing finalize gate in `lib/checklists.ts` and `closing-client.tsx` uses `actor.level >= 4`, which operationally EXCLUDES KH (level 3 in current implementation) — directly contradicting C.26's "KH+ can finalize" intent. The same divergence appears at the `revokeWithReason` and `tagActualCompleter` peer-correction gates. The earlier rationalization in this amendment ("level-4 gate fires for SL+ today, which matches the spec's 'KH+ can finalize' intent because `SL > KH` in role hierarchy regardless of numeric level") was logically incoherent — `SL > KH` means `level >= 4` EXCLUDES KH, NOT includes them. The bug had been latent because Cristian (MoO 6.5) and Pete (owner 7) both clear the gate trivially; KH-level users never tested the finalize path. RLS audit during the same PR confirmed the closing finalize bug is purely app-layer — closing RLS uses per-item `min_role_level` thresholds (correct) and `>= 3` location-scoped writes (correct); no closing-related RLS policy needs the same fix.

**Build #2 PR 1 fix (2026-05-04):** Build #2 PR 1 ships the gate correction:

- `closing-client.tsx` `canFinalize`: `actor.level >= 4` → `actor.level >= 3`
- `lib/checklists.ts` `revokeWithReason` peer-correction: `< 4` → `< 3`
- `lib/checklists.ts` `tagActualCompleter` peer-correction: `< 4` → `< 3`
- `lib/prep.ts` `AM_PREP_BASE_LEVEL`: `4` → `3` (parallel new gate; AM Prep is one of the closer's last tasks, same authorization semantic)
- `scripts/seed-closing-template.ts` default `minRoleLevel` (create + sync paths): `4` → `3`
- Convergent seed re-run against production: 49 closing template items × 2 locations (MEP + EM) = 98 row updates, 2 `checklist_template.update` audit rows tagged with `phase: "3_module_1_build_2_pr_1"` and `reason: "C.41 reconciliation — closing finalize gate KH+ semantic"`

The broader level-number restructure documented in C.33 (renumbering KH=4, SL=5 per spec intent, plus levels 0–1) remains deferred to Module #2 user lifecycle work per the original C.41 framing. The Build #2 PR 1 fix only reconciles the specific app-layer gate that contradicted C.26; the underlying level numbers in `lib/roles.ts` stay at current values until Module #2 ships. Two non-closing RLS sites that use `current_user_role_level() >= 4` (`maintenance_tickets_insert/update` and `shift_overlay_corrections_insert`) were surveyed during the audit: maintenance_tickets is plausibly the same bug class but deferred to its own module's call; shift_overlay_corrections is intentionally managerial-domain and stays at `>= 4`.

---

## C.42 — Operational reports architecture

**Date added:** 2026-05-04
**Spec sections:** §1 (CO operational context), §1.4 (Artifact model), §4.3 (Schema)
**What spec says:** spec doesn't address the dashboard-as-hub model with first-class reports as operational artifacts. The original CO-OPS spec implicitly treated closing as THE operational artifact.

**What built reality is:**

CO-OPS treats operational artifacts as first-class reports. Each report type:
- Has a dedicated dashboard tile/button
- Has its own search/history surface
- Has its own data model designed for its operational purpose (custom where needed, reuse `checklist_*` primitives where natural)
- Reflects on the closing checklist via auto-completion of a corresponding report-reference item

**Reports inventory (Build #2+ scope):**

| Report | Trigger | Who | Required for closing? | Multi-per-day? |
|---|---|---|---|---|
| Opening report | Start of day | Opener (KH+) | Yes (per C.19/C.20) | No |
| AM Prep List | End of shift, part of closing | Closer (KH+, assignable) | Yes (per C.18/C.19) | No |
| Mid-day prep | Anytime needed | Shift staff (L3+) | No | Yes (per C.43) |
| Cash report | End of shift | Cash-counting role | Yes (per C.19) | No |
| Special report | Anytime | Anyone | No | Yes |
| Training report | When training event happens | Trainer or trainer-tagged staff (per C.25) | No | Yes |

Required-for-closing reports (Opening, AM Prep, Cash) auto-complete their corresponding closing checklist items when submitted. Non-blocking reports (Mid-day prep, Special, Training) don't have closing items — they exist independently on the dashboard.

**Auto-completion mechanic:**

When a required report is submitted for the current operational date:
- A `checklist_completion` row is written to the corresponding closing template item
- The completion's `completed_by` is the report submitter
- Metadata captures a link to the report instance (`report_type`, `report_instance_id`)
- Closer sees the item auto-checked in the closing UI **with attribution rendered inline**: "AM Prep List ✓ — submitted by Cristian at 9:47 PM"

The attribution rendering is a deliberate operational signal. The closer reviewing closing items sees at a glance who did what without drilling into the report. Same pattern for cash report ("Cash report ✓ — submitted by Sam at 10:15 PM"), opening report ("Opening report ✓ — submitted by Maria at 6:32 AM"), etc. If reconciliation issues surface later (cash discrepancy, AM prep estimate vs reality mismatch, etc.), the closer knows immediately who to follow up with.

If the report isn't submitted by the time closing finalizes, the closer flags the corresponding closing item as incomplete with a reason (per existing C.26 closing-finalize-with-incomplete-reasons flow). Same architectural pattern as any other incomplete required cleaning item — no new gating concept needed.

**Two surfaces, distinct scopes:**

CO-OPS distinguishes between action surfaces (do/view today) and a dedicated reports hub (historical browse/search). The dashboard renders action tiles per role; the reports hub is its own page for historical access.

**Surface 1 — Dashboard report tiles (action-oriented).**

The dashboard renders report tiles for what's relevant to the user RIGHT NOW for TODAY's operational date. Tile visibility is gated by:

1. **Role-based base permissions** — a tile renders for a user if their role has scope on that report type for today's operations (e.g., KH+ sees the Cash report tile; trainee normally doesn't)
2. **Assignment-down from KH+** — when a KH+ explicitly assigns a report to a trainer or employee for tonight's closing as a training exercise, the assignee's dashboard surfaces that tile for that operational date only

Default role-based visibility for dashboard tiles:

| Report | Trainee (L2) | Employee (L3) | Shift Lead (L4) | Key Holder (L5) | AGM+ (L6+) |
|---|---|---|---|---|---|
| Opening report | (hidden) | (hidden) | tile present | tile present | tile present |
| AM Prep List | (hidden, unless assigned) | (hidden, unless assigned) | (hidden, unless assigned) | tile present | tile present |
| Mid-day prep | tile present | tile present | tile present | tile present | tile present |
| Cash report | (hidden) | (hidden) | tile present | tile present | tile present |
| Special report | tile present | tile present | tile present | tile present | tile present |
| Training report | (hidden, unless assigned as trainee) | (hidden, unless assigned as trainer) | tile present | tile present | tile present |

Notes on the split:

- **Opening report**: SL and KH both have base access. Operationally, whoever opens the shop fills it.
- **AM Prep List**: KH+ has base access (closing is a KH+ responsibility; AM Prep is one of the closer's last tasks). SL doesn't see the tile by default but can be assigned down (KH assigns to SL for training in closing workflow). This is the operational reality — closing is the KH's responsibility, not SL's.
- **Mid-day prep**: any shift staff (L3+) per C.21. SL and KH both included.
- **Cash report**: SL and KH both have base access. "Sometimes the KH will do cash reports and sometimes shift lead." Either can submit; either can be assigned to do it via assignment-down.
- **Special report**: anyone can submit (anytime).
- **Training report**: trainer-tagged staff or trainer role can submit. SL and KH both included as potential trainers.

The assignment-down mechanic is a real architectural concept and applies to ALL report types, not just AM Prep. Any user with creation scope on a report type can assign that report to someone of equal or lower role level for an operational date. Common patterns:

- **AM Prep**: KH+ assigns to trainer or employee for training value at closing
- **Mid-day prep**: KH+ assigns to line cook (employee) to teach prep workflow
- **Cash report**: AGM+ assigns to KH for training cash-handling responsibility
- **Opening report**: KH+ assigns to trainer for training opening verification
- **Training report**: trainer assigns to themselves OR AGM+ assigns specific trainer to specific trainee
- **Special report**: rarely assigned (anyone can submit) but possible if needed

A single `report_assignments` schema serves all six report types: assigner_id, assignee_id, report_type, operational_date, optional note. The assignee's dashboard surfaces the assigned tile for that operational date based on `report_assignments`. After the operational date passes, the assignment is historical — assignee can still read what they submitted via the reports hub, but the tile no longer surfaces on dashboard.

Two-layer visibility enforcement: UI tile rendering (dashboard conditional on role + assignments) AND API access (RLS policies). UI-only enforcement is insufficient — RLS is the source of truth.

**Surface 2 — Reports hub (read-oriented, separate page).**

A dedicated "Reports" button on the dashboard opens its own page that lets users browse historical reports relevant to their role scope. This is not where reports are created or actioned — it's the operational library.

Reports hub serves three purposes:
1. **Training value** — trainees and employees browse past AM Prep submissions, opening reports, etc. to learn from real operational history
2. **Reconciliation and audit** — KH+, AGM+, GM+ search for specific reports during reconciliation moments (cash discrepancy investigation, prep estimate accuracy review)
3. **Cross-shift continuity** — anyone reviewing prior shifts' work without needing to action anything

Default read-scope for the reports hub:

| Report | Trainee (L2) | Employee (L3) | Shift Lead (L4) | Key Holder (L5) | AGM+ (L6+) |
|---|---|---|---|---|---|
| Opening report | read (all) | read (all) | read (all) | read (all) | read + audit |
| AM Prep List | read (all) | read (all) | read (all) | read (all) | read + audit |
| Mid-day prep | read (all) | read (all) | read (all) | read (all) | read + audit |
| Cash report | (hidden) | (hidden) | read (all) | read (all) | read + audit |
| Special report | read (own + own location) | read (all) | read (all) | read (all) | read + audit |
| Training report | read (own as trainee) | read (own + own location) | read (all) | read (all) | read + audit |

The dashboard gates AC-tion ("can I do this report today"). The reports hub gates VIS-ibility into operational history. They're orthogonal concerns with intentionally different rules.

**Why two surfaces:**

(1) The action surface needs to be focused — too many tiles dilute the dashboard's "what should I do right now" purpose
(2) The historical browse surface benefits from dedicated UI patterns (filters, search, date ranges) that would clutter the dashboard
(3) Training-value access (trainees reading past AM Preps) belongs in a browsing context, not as dashboard tiles
(4) Cross-shift continuity (KH reviewing what the prior shift left) is a "go to the library" workflow, not a "tap a tile" workflow

Module #2 (User Lifecycle) work will refine both visibility maps and add training-progression transitions. For Build #2 first PR, ship the dashboard tiles with sensible defaults; the reports hub page itself is a separate PR within Build #2 (probably PR pass 2 or 3 after AM Prep ships).

**Data model approach (custom-where-needed, reuse-where-natural):**

- **AM Prep, Mid-day prep, Opening report**: reuse `checklist_*` infrastructure (instance lifecycle, auth, audit, RLS) with custom per-item data shape per C.18's refined model. New `prep_template_items` extension or JSONB column on existing `checklist_template_items` for the rich PAR/ON HAND/BACK UP/TOTAL structure.
- **Cash report**: dedicated table for drawer count, tip count, denomination breakdowns, reconciliation. Distinct enough from checklist primitives that custom shape is warranted.
- **Special report**: lightweight text + photo capture; could be its own table or a minimal `checklist_*` reuse.
- **Training report**: dedicated table for trainer + trainee + topic + attestation; ties into C.25's tag system and Module #14 (Training).
- **Closing checklist**: existing `checklist_*` infrastructure unchanged.

**Why this architecture:**

(1) Treats operational artifacts as first-class — staff finds them on the dashboard rather than buried inside other flows.
(2) Searchable history per report type — "show me all cash reports this week" is a real query.
(3) Auto-completion mechanic preserves the closing-as-anchor concept without forcing every report through checklist primitives.
(4) Reuse-where-natural keeps code surface bounded; custom-where-needed prevents architectural force-fits.
(5) Pluggable: future report types (vendor receiving, maintenance, etc.) extend the same dashboard-tile + closing-item-auto-completion pattern.

**v1.3 action:**

- Add §1 description of dashboard-as-action-hub + reports-hub-as-library two-surface model
- Document the auto-completion mechanic in §10 shared infrastructure services, including inline attribution rendering on closing items
- Document dashboard tile visibility map (role-based + assignment-aware) and reports hub read-scope map (role-based) — two distinct visibility models in §10
- Document the `report_assignments` schema concept (assigner, assignee, report type, operational date) for assignment-down mechanic
- Document two-layer enforcement: UI tile rendering + RLS policies (RLS as source of truth)
- Document the report types inventory in §4.3 schema or a new Module #1 sub-section
- New module conventions document the dashboard-tile + reports-hub + closing-item-auto-completion pattern as canonical for future operational reports
- Reference Module #2 work as the natural moment to refine both visibility maps per role progression
- Schedule reports hub UI as a separate PR within Build #2 (after AM Prep first PR ships)

---

## C.43 — Mid-day prep multiple instances per day, numbered

**Date added:** 2026-05-04
**Spec sections:** §4.3 (`checklist_instances`), C.18 (prep trigger paths)
**What spec says:** existing UNIQUE `(template_id, location_id, date)` constraint on `checklist_instances` blocks multiple instances of the same template at the same location on the same date.

**What built reality is:**

Mid-day prep templates allow multiple instances per day at the same location. Two or three mid-day preps in one day is operationally normal at CO. Each is disambiguated by `triggered_at` (timestamp) and presented to staff as numbered for the day:
- "Mid-day Prep #1 (12:30 PM)"
- "Mid-day Prep #2 (3:15 PM)"
- "Mid-day Prep #3 (5:45 PM)"

**Schema change:**

The `(template_id, location_id, date)` UNIQUE constraint is preserved for non-prep-and-non-mid-day templates (closing, opening, AM prep — all single-per-day). For mid-day prep specifically:
- The constraint doesn't apply (or is conditional on template type)
- `triggered_at` becomes the disambiguator for multiple instances
- `triggered_by_user_id` (per C.18) captures who triggered each

Implementation choice between (a) dropping the UNIQUE constraint generally and enforcing single-per-day at lib layer for non-prep templates, or (b) keeping the constraint conditional on template type — to be decided during Build #2 implementation. Recommend (b) for safety: explicit DB constraint matching template type.

**UI presentation:**

Dashboard "Mid-day Prep" tile shows today's instances in a list with their numbered labels and status (in-progress / submitted). Tap an instance → view its details. Tap "+ New mid-day prep" → trigger a fresh instance (for level 3+ users per C.21).

**Why:**

Mid-day prep is operationally emergent — line cooks notice depletion when service realities surface it. Multiple per day is normal. Single-per-day constraint forces awkward workarounds (overwriting, finding the prior instance to update). Allowing multiple with explicit numbering matches operational reality.

**v1.3 action:**

- Update §4.3 `checklist_instances` constraint description: UNIQUE `(template_id, location_id, date)` applies to single-per-day templates; mid-day prep is the exception, disambiguated by `triggered_at`
- Reference C.18 for the trigger model
- Document numbered-display convention for multi-instance prep in §10 shared infrastructure

**Build #2 PR 1 sub-finding (added 2026-05-04):** during AM Prep seed implementation, recon revealed `lib/prep.ts loadAmPrepState` filters `type='prep' AND active=true` and picks most-recent active by `created_at DESC`. Works in PR 1 with one prep template per location (only "Standard AM Prep v1" exists). When Mid-day Prep ships per this amendment, both AM Prep AND Mid-day Prep will be `type='prep'` and the loader needs refinement.

Three options for Mid-day Prep design time:

1. **Filter by name pattern** (e.g., `name LIKE 'Standard AM Prep%'`) — fragile, name-coupling, rejected
2. **Distinct discriminator column** (e.g., `prep_subtype: 'am_prep' | 'mid_day_prep'`) — schema migration, cleanest
3. **Split the type enum** — schema migration with CHECK constraint update on `checklist_templates.type` to add `'am_prep'` and `'mid_day_prep'` as distinct values

Decision deferred to Mid-day Prep design time when the full discriminator landscape is in view. AGENTS.md "loadAmPrepState single-prep-template assumption" durable lesson captures the same architectural tension on the implementation side. Until then, Build #2 PR 1's AM Prep seed uses `type: 'prep'` with name `"Standard AM Prep v1"`; the convention for future prep templates (mid-day, training prep, etc.) is locked to a name suffix containing the subtype until the discriminator question is resolved.

---

## C.44 — PAR template editing by GM+ (admin tooling)

**Date added:** 2026-05-04
**Spec sections:** §13 (Admin tooling), Module #1 prep templates
**What spec says:** spec doesn't address operational-config admin tooling for prep templates. The implicit assumption was static seed data.

**What built reality is:**

Prep templates (AM Prep, Mid-day Prep) have items, sections, and PAR values that change over operational reality. Items are added (new menu item with new prep needs), removed (discontinued item), edited (PAR target adjusted as catering volume grows, unit changes, section reorganized).

GM+ (level 6+) has admin tooling to:
- Add new prep items (name, section, PAR value, unit, position)
- Edit existing items (rename, change PAR, change unit, move sections, reorder)
- Deactivate items (soft-delete; historical AM Prep instances retain references via denormalized snapshot)
- Reorder items within sections

**Versioning approach (denormalized snapshot, not template versioning):**

Historical AM Prep instances cache the PAR value, item name, section, and unit at submission time. PAR changes don't retroactively affect old reports. Implementation: prep completion rows carry the relevant denormalized fields (item_name_at_submission, par_at_submission, unit_at_submission, section_at_submission) alongside the operator-submitted values (on_hand, back_up, total).

This avoids template versioning complexity (per Path A versioning per C.19) for prep items specifically. GM edits affect future submissions only; historical submissions remain accurate to their submission moment.

**Why denormalized snapshot vs Path A versioning:**

Path A versioning works well for operational templates as wholes (Standard Closing v1 → v2). Per-item versioning of every prep item would be heavy and querying historical reports would require joining version-specific item rows. Denormalized snapshot trades some storage cost (a few extra fields per completion row) for query simplicity and unambiguous historical accuracy.

**Soft-delete for items:**

Removing an item via GM+ admin sets `active = false` on the prep_template_item. Historical references still resolve (via the denormalized snapshot). Active items only render in new prep submissions. Deactivated items can be reactivated.

**Audit:**

GM+ edits to prep template items emit audit rows. Standard destructive-action audit pattern — `prep_template_item.create`, `prep_template_item.update`, `prep_template_item.deactivate`, `prep_template_item.reactivate`.

**Scope note:**

PR-scope-wise, GM+ admin tooling is NOT part of Build #2's first PR (AM Prep vertical slice). Build #2's first PR ships AM Prep with seed-script-defined items; the editing UI lands as a follow-up PR within Build #2 (probably PR pass 1.5 or 2). Worth capturing as an amendment now so the data model accommodates editability from the start (denormalized snapshots in completion rows, soft-delete on template items).

**v1.3 action:**

- Add §13 admin tooling section for prep template editing
- Document denormalized snapshot pattern for prep completions
- Reference C.18 (prep model) and C.42 (reports architecture)
- Schedule the GM+ admin UI in Build #2 second PR (or third) within the prep vertical slice

---

## C.45 — Capabilities model: `is_trainee` and `is_trainer` as tags on user records

**Date added:** 2026-05-04
**Spec sections:** §7.1 (RoleCode hierarchy), C.32 (login tile employee + trainee surfaces), C.33 (full 9-level user structure), C.41 (level number divergence)

**What spec says:** PR 6 (per C.32) added `employee` (level 3) and `trainee` (level 2) as RoleCodes. Existing `trainer` (level 3) is also a RoleCode.

**What architectural intent is (locked here, implementation deferred):** trainer and trainee are CAPABILITIES that compose onto a role-level, not roles themselves. Specifically:

- `is_trainee` capability — auto-applied to new hires at hire-time (level 2 employee), removable ONLY via explicit operational action (supervisor decision) or automatically removed when user is promoted to level >= 3. Once removed, never re-applied.
- `is_trainer` capability — granted by appropriate authority (Module #2 to lock the granting threshold; likely MoO+), removable. Composable with any role-level >= [Module #2 decides floor].

**Why:** roles describe operational seniority (level); capabilities describe orthogonal authority (training oversight). Treating trainer/trainee as roles caused level collision (employee, key_holder, trainer all at level 3 in current implementation) and made the trainee-graduation mechanic implicit rather than explicit. Tag model makes "graduation" an explicit operational event (Cristian saying "Maria is fully ramped") and lets training authority compose with any underlying role.

The capabilities-as-tags pattern that this amendment establishes for `is_trainee` / `is_trainer` is the **canonical pattern for any future operational capability that's orthogonal to role-level seniority**. Future capabilities (e.g., shift-supervisor delegation, cash-handling certification, location-specific authority) follow this same model rather than introducing additional role tiers. Module #2 inherits the architectural discipline; future modules don't re-debate role-vs-tag for each new capability — the precedent is set here.

**Implementation deferred to Module #2 user lifecycle work**, which will:

- Move `employee` from level 3 to level 2 (consolidates with where trainee currently sits)
- Remove `trainee` as a RoleCode (migrate any trainee-role users to employee + `is_trainee` tag)
- Remove `trainer` as a RoleCode (migrate to `is_trainer` tag, attached to whatever role-level the trainer-tagged user actually holds)
- Add either `is_trainee` / `is_trainer` boolean columns on `users` (Path X) OR a `user_capabilities` table (Path Y); Module #2 decides based on full capability inventory at that scope
- Update RLS policies, permission checks, and assignment-down logic to use the capability check pattern

Build #2 PR 1 (current) ships with the closing finalize gate fix (`level >= 4` → `level >= 3`) per C.41 reconciliation but does NOT execute the role-to-capability refactor. AM Prep PR 1's authorization (`AM_PREP_BASE_LEVEL = 3`) and assignment-down logic will be refactored when Module #2 ships, but the fundamental data model (`report_assignments` storing `assignee_id`) is unaffected by the refactor.

**v1.3 action:** when Module #2 user lifecycle work scope is locked, this amendment becomes the architectural anchor for the role-to-capability refactor. Spec §7.1 RoleCode hierarchy gets restructured at that time. Future capability additions reference this amendment as precedent; the role-vs-tag question is closed.

Captured during Phase 3 Build #2 PR 1 architectural conversation when trainer-vs-employee level collision surfaced and Juan locked the capabilities model.

---

## C.46 — Submitted reports support post-submission updates with attribution (chained, capped, role+status-gated)

**Date added:** 2026-05-04
**Date updated:** 2026-05-04 (full architecture locked between Build #2 PR 2 merge and PR 3 implementation)
**Spec sections:** §2.5 (immutable completions, supersede-by-recency), C.18 (prep workflow), C.19 (closing as anchor), C.42 (reports architecture)

**What spec says:** §2.5 establishes immutable completions with corrections via supersede-by-recency. C.42 documents the reports architecture and the auto-completion mechanic but doesn't specify a post-submission edit flow.

**What built reality should be:** when a report (AM Prep first; opening, cash, mid-day prep, etc. inherit) has been submitted, original submitters and KH+ users have an edit affordance to update values with chained attribution preserving the original action plus every update in sequence.

The architecture below was locked after Build #2 PR 2's merge. Build #2 PR 3 implements C.46 for AM Prep specifically; future report-type PRs (Cash Report, Opening Report, Mid-day Prep) inherit the schema additions, RPC pattern, audit shape, and UI affordance pattern, with each report type defining its own per-report access rules in lib code.

### A1 — Edit access rules

- **Original submitter** (regardless of role-level) can edit while the closing instance status is `open`. On closing finalization (status flips to `confirmed`), assigned sub-KH+ submitters lose edit access.
- **KH+ users** (`role_level >= 3` per C.41 reconciliation) can edit anytime, regardless of closing status, until the edit cap is reached.
- **Sub-KH+ non-submitters** never have edit access.

**Edit cap:** 3 total updates per submission chain (not per-actor). Original submission + 3 updates = 4 entries maximum. After the 3rd update lands, the form locks permanently to read-only for everyone — no further edits, regardless of role.

The cap is intentional: unlimited update churn would erode the operational signal of a "submitted" report; 3 updates is enough headroom for typical correction workflows (closer catches their own error; another KH+ catches a missed line; final reconciliation pass) without becoming a full collaborative-editing surface.

### A2 — Edit affordance placement

- **Original submitter** sees "Edit" affordance on:
  - Dashboard AM Prep tile (until closing is finalized; then the affordance hides for sub-KH+ submitters)
  - Closing checklist's report-reference item (until closing is finalized; same gate)
- **Other KH+ users** (didn't submit) see "Edit" only on the closing checklist's report-reference item (the tile is action-oriented for "what should I do today"; KH+ users who didn't submit didn't action it today, so no tile-side surface).
- **Sub-KH+ users who didn't submit** see no edit affordance — view-only from dashboard tile.

### A3 — Edit mode UX

- Tapping "Edit" navigates to `/operations/am-prep` (same page as fresh submission)
- Form mounts in editable mode with all 32 required entries pre-populated with the current chain-resolved values
- Submit CTA label changes from "Submit AM Prep" to "Update AM Prep"
- Banner above the form reads "Editing AM Prep submitted by [name] at [time]" — distinct from the read-only mode banner so the operator knows they're in edit mode, not just viewing
- Cancel button explicit (matches Build #2 PR 1's discard-changes pattern); returns to read-only mode without saving
- On update success, banner becomes the chained attribution: `"Submitted by Cristian at 9:47 PM, updated by Sam at 10:00 PM, updated by Juan at 10:23 PM"`

### A4 — Closing-side rendering

- The closing checklist's auto-completed AM Prep List item does NOT supersede on AM Prep edit. The existing closing completion row stays in place (FK preserved; auto_complete_meta still references the original AM Prep submission).
- Closing-side rendering reads the AM Prep submission chain dynamically at render time (Server Component). One extra query against `checklist_submissions` for today's AM Prep chain; cached at the Server Component render boundary.
- ReportReferenceItem renders the chained attribution: `"AM Prep List ✓ — submitted by [name] at [time], updated by [name] at [time], updated by [name] at [time]"` — same comma-separated chain pattern as the AM Prep page's banner.

### A5 — Schema additions

```sql
-- checklist_completions
ALTER TABLE checklist_completions ADD COLUMN original_completion_id UUID NULL
  REFERENCES checklist_completions(id);
ALTER TABLE checklist_completions ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;
-- original_completion_id is NULL for the original (chain head); FK for every update.
-- edit_count is 0 for original, 1-3 for updates (cap enforced in RPC).

-- checklist_submissions
ALTER TABLE checklist_submissions ADD COLUMN original_submission_id UUID NULL
  REFERENCES checklist_submissions(id);
ALTER TABLE checklist_submissions ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;
-- Same chain pattern.
```

No closing-side schema additions: closing reads the AM Prep chain dynamically per A4. Avoids the supersede-cascade complexity that would arise if the closing's auto-complete row had to track the chain too.

### A6 — RPC changes

Extend the existing `submit_am_prep_atomic` RPC with an `is_update: boolean` parameter:

- **`is_update = false`** (existing behavior): creates AM Prep completions + submission row + flips instance to `confirmed` + auto-completes closing's report-reference item. All in one transaction.
- **`is_update = true`** (new): validates edit cap not exceeded + role+status access check; creates new completions linked to the original chain via `original_completion_id`; creates new submission row with `edit_count = previous + 1`; emits `report.update` audit row; does NOT change instance status (stays `confirmed`); does NOT touch closing's auto-complete row (preserves A4 dynamic-read pattern).

Atomicity guarantees stay in a single RPC call. No client-side multi-call orchestration needed.

### A7 — Audit shape

Action: `report.update` (generalized across all report types per A9). Standard destructive-action pattern (auto-derived `destructive=true` via `lib/destructive-actions.ts`).

```ts
metadata: {
  report_type: "am_prep",                    // generalizes to "cash_report" | "opening_report" | etc.
  report_instance_id: string,                // checklist_instances.id
  original_submission_id: string,            // chain head
  original_completed_by: string,             // user_id of original submitter
  original_completed_at: string,             // ISO timestamp
  updated_by: string,                        // user_id of the actor who triggered this update
  updated_at: string,                        // ISO timestamp
  edit_count: number,                        // 1-3
  changed_fields: string[],                  // e.g., ["onHand:tuna_salad", "yesNo:cook_bacon"]
}
```

`changed_fields` shape captures both the field name and the template_item_id slug for forensic trace. Operationally invaluable when reconciling discrepancies post-shift.

### A8 — Typed errors

Two new errors in `lib/prep.ts` (joining the existing `PrepRoleViolationError`, `PrepInstanceNotOpenError`, etc.):

- `ChecklistEditLimitExceededError` → 422 response with `code: "edit_limit_exceeded"` (chain already at edit_count=3; no further updates accepted)
- `ChecklistEditAccessDeniedError` → 403 response with `code: "edit_access_denied"` — covers two underlying scenarios surfaced through one error code:
  - Sub-KH+ submitter trying to edit after closing finalized
  - Sub-KH+ non-submitter trying to edit (no submission attribution + no KH+ override)

Existing typed errors (PrepRoleViolationError, PrepInstanceNotOpenError, etc.) still apply where their semantics still hold.

### A9 — Generalization commitment

This amendment captures the **canonical pattern** for post-submission update support across all CO-OPS report types:

- **Schema additions** (`original_*_id` + `edit_count`) reused on every report's submissions/completions tables
- **RPC pattern** (`is_update` parameter; chain-link + edit-cap enforcement; preserve auto-complete artifacts) reused for every report's submission RPC
- **Audit shape** (`report.update` action with `report_type` discriminator) reused for every report
- **UI affordance pattern** (Edit button on tile + closing-ref item; "Editing..." banner; "Update X" CTA; chained attribution rendering) reused

**Per-report rules vary** (Cash Report's edit access might differ from AM Prep's; the assigned-submitter-loses-access-on-finalization rule may not apply to every report type). Each report type defines its own access predicate in lib code. But the architectural primitives are shared infrastructure.

**Build #2 PR 3 ships AM Prep only.** Future report-type implementations (Cash Report, Opening Report, Mid-day Prep) inherit C.46 via this amendment; they do not re-debate the architecture.

**Why:** real operational reality — closer or another KH+ catches errors after submitting. Re-submitting a "fresh" report loses attribution to the original action; in-place corrections lose the immutable-history guarantee. Supersede-by-recency with capped chained attribution preserves the original signal, the correction trail, and the operational dignity of the "submitted" state.

**v1.3 action:** implement C.46 in Build #2 PR 3 (next PR after PR 2's TZ + required-fields validation). Schema additions + RPC update + lib edit-access + API extension + AmPrepForm edit mode + Dashboard tile edit affordance + ReportReferenceItem edit affordance + chained attribution + 2 new typed errors + new translations + `report.update` audit emission. The future generalization to other report types references this amendment as the locked canonical pattern; per-report-type access rules captured at each implementation PR.

Captured during Phase 3 Build #2 PR 1 smoke test from Juan's operational feedback ("the closing manager that day KH+ should be able to update the report with a updated by tag and time etc."); architecture locked between Build #2 PR 2 merge and PR 3 implementation.

### Build #2 PR 3 sub-finding — template-divergence between original submission and edit (added 2026-05-04)

Pre-C.46 EM AM Prep submission (`4ee8ef10-89b8-4cac-9218-f820acea12f8`) had 36 chain-head completions; live EM template had 38 active items by smoke time (Radish + Cucumber added between original submission and the smoke test). Initial PR 3 implementation passed the full live template to AmPrepForm in edit/read_only modes, causing the C.44 alignment guard in `submitAmPrepUpdate` to correctly reject submissions containing items not in the chain head's universe — but with bad UX (server-side `prep_shape` error mapped to "check the highlighted fields" banner without per-row highlighting fired client-side). Operator could fill the 2 new items (form's primary-required check fired on them, asking the operator to fill them to enable submit), then submit failed at the lib layer.

**Architectural commitment:** snapshot universe is locked at chain-head submission time per C.44. Template additions between original submission and edit appear ONLY on subsequent fresh submissions, NOT retroactively in the chain. This extends C.44's "snapshot frozen at submission time" semantic from PAR/section/unit values to the **template structure itself** (which items exist in the universe) — a strictly stronger snapshot lock than C.44 alone implied.

**Implementation deferred to C.44 admin tooling scope.** When C.44 admin tooling enables mid-day template changes (currently the only operational path that would create the divergence in production), the filter-to-chain-head-universe pattern applies: the page Server Component filters `templateItems` to the chain head's `completion_ids` universe in edit/read_only modes; submit mode (no chain yet) renders the full live template. The chain head's `completion_ids` array is the canonical reference (rather than filtering by `editCount === 0` on completion rows) so the filter doesn't depend on completion-row state semantics. A small info banner surfaces the divergence count to operators for clarity: "{N} items added since this report was submitted — they'll appear on tomorrow's report."

**Why deferred (Build #2 PR 3 decision):** the divergence only manifested in PR 3 smoke because Juan's pre-C.46 test submissions were captured against an earlier template version, and Radish + Cucumber were added to the EM template between those test submissions and the smoke. C.44 admin tooling hasn't shipped yet, so post-C.46 production submissions will all have coherent chains until admin tooling lands. Implementing the filter+banner now overfits a complex permanent UI surface to a one-time pre-C.46 data state. Cleaner: scrub the pre-C.46 test submissions, smoke C.46 against fresh state, and ship the filter pattern alongside C.44 admin tooling when the divergence becomes a real operational concern.

**Generalization:** future report types inheriting C.46 (Cash Report, Opening Report, Mid-day Prep — per A9) inherit this snapshot-universe semantic. When the implementation lands alongside C.44, each report type's edit-mode loader applies the filter pattern; info banner pattern is reusable.

Captured during Build #2 PR 3 smoke when Juan tried to edit the pre-C.46 EM submission and hit `prep_shape`. Architectural commitment captured here; implementation deferred per the rationale above.

---

## C.47 — Time Clock: login = clock-in, logout = clock-out, geofence-based, DC-compliant

**Date added:** 2026-05-05
**Spec sections:** §2 (locked architectural decisions), §4.1 (`users`, `locations`), §4.2 (`sessions`), §4.16 (`audit_log`), §10 (shared infrastructure services), §11 (integration adapters), §16 (build sequencing)

**What spec says:** §2 lists "Integration philosophy" (CO-OPS is the single source of operational truth; 7shifts and Toast are synced, not replaced). §11 mentions 7shifts as the scheduling adapter but does not address time punches. Login and logout are treated as pure session management. No Time Clock module or geofence concept exists in v1.2.

**What built reality should be:**

CO-OPS closes the gap between authentication and labor-law punch records by treating login as clock-in and logout as clock-out — with a geofence gate determining the actual punch timestamp. This integrates with the CO-OPS → 7shifts → Toast Payroll stack so a staff member never touches a separate time-clock app.

The architecture below was locked during the Wave 1 spec refresh session (2026-05-05). Implementation is explicitly deferred 6–12 months (Wave 8 per MODULE_PRIORITY_LIST.md, alongside AI Insights — both require 7shifts + Toast integration adapters to be in place first). Schema migrations land at implementation time; no schema changes land during Wave 1.

### A1 — Login is clock-in; logout is clock-out

Every session start event is a clock-in candidate; every session end event is a clock-out candidate. "Punch happened" is determined by the geofence gate at A3–A5. CO-OPS writes the punch to 7shifts via POST /time_punches (A9); 7shifts feeds Toast Payroll CSV. Staff members never use a separate time clock — the CO-OPS login tile IS the punch interface.

### A2 — 500ft default geofence, tunable per location by GM+

Each location has a configurable geofence radius (`locations.geofence_radius_ft INTEGER NOT NULL DEFAULT 500`). GM+ adjusts via admin tooling. Geofence center is the location's lat/long (`locations.latitude`, `locations.longitude` — new columns). Distance check uses the Haversine formula on the browser-supplied coordinates at login/logout time.

### A3 — Login-outside-geofence: clock-in deferred to proximity-entry moment

Session is created normally (auth doesn't gate on geofence). Dashboard shows persistent banner: **"You're authenticated but not yet clocked in. You'll clock in automatically when you arrive at the location."** Banner not dismissible; persists until geofence-enter event fires or session ends. Foreground `watchPosition` detects entry → clock-in fires with the geofence-enter timestamp as the punch time.

Privacy-first means transparent, not invisible.

**Session-but-no-punch scenario:** logout/idle before geofence-enter writes audit row `action: 'time_clock.login_no_punch'`, `metadata.reason: 'session_ended_before_geofence_entry'`. Manager reconciliation (A6) can add a manual punch.

### A4 — Logout-inside-geofence: punch timestamp is logout moment

Clean path. Punch written immediately. Audit: `time_clock.logout_punched`, `metadata.geofence_state: 'inside'`.

### A5 — Logout-outside-geofence: punch timestamp is last-in-proximity moment

Clock-out timestamp = `sessions.last_inside_geofence_at` (server-side high-water mark of the most recent `watchPosition` callback that reported inside-geofence with no subsequent outside-geofence callback before logout). If NULL (never reported inside), no auto-punch — fall to A3's no-punch path.

If populated:
1. Clock-out timestamp = `last_inside_geofence_at`
2. Late-clock-out reason prompt at logout (selection from A8)
3. Punch written to 7shifts with reason metadata; session revoked
4. Emits `action: 'time_clock.logout_auto_corrected'` with `metadata.original_logout_at`, `metadata.punch_timestamp`, `metadata.reason_category`

**Implementation note:** `last_inside_geofence_at` is updated via heartbeat-style PATCH or extension of `/api/auth/heartbeat` carrying position state. Exact wire-up deferred to implementation; the server-side session column is locked here.

### A6 — Manager gap reconciliation; thresholds locked

Manager reconciliation queue handles edge cases: forgotten clock-outs, device failures, geofence misfires, payroll disputes.

Scope:
- **Add punch** — `time_clock.punch_added` (requires reason + employee attestation per A7)
- **Correct timestamp** — `time_clock.punch_corrected` (requires reason + delta + attestation)
- **Void punch** — `time_clock.punch_voided` (requires reason + approval per delta magnitude)

All mutations write CO-OPS → 7shifts (PATCH /time_punches/:id; DELETE for void). CO-OPS audit_log is the authoritative forensic chain.

**Approval thresholds (locked here):** KH+ initiates all reconciliation; MoO+ approval required for corrections with > 15 minutes delta from original or spanning two calendar days (DC pay-period boundary concern). Thresholds may evolve based on operational experience post-implementation; changes require a new amendment entry.

### A7 — Mandatory employee attestation when auto-correction shifts time

When A5 auto-correction fires OR a manager adds/corrects a punch, the affected employee attests on next login.

Attestation flow:
1. Banner: "Your [clock-in/clock-out] on [date] was recorded as [time]. Please confirm."
2. **Confirm** → `time_clock.attestation_confirmed`; session proceeds
3. **Flag for review** → `time_clock.attestation_flagged`; queues second-level reconciliation review with optional note; session proceeds (flagging is non-blocking)

Attestation rows carry corrected timestamp, original timestamp, correction source (auto vs manager-id), and disposition. DC compliance: explicit record that staff were shown their punch records and had opportunity to dispute (TWWFAA paper-time-sheet sign-off equivalent).

### A8 — Late clock-out reason categories

- `stayed_late_shift_need`
- `stayed_late_manager_request`
- `stayed_late_personal`
- `forgot_to_clock_out`
- `device_issue`
- `other` — free-text required when selected

**Status:** preliminary list locked here; final lock at implementation time when full punch-correction UX is designed. No changes between here and implementation without new amendment entry — 7shifts metadata shape and DC reporting queries key on these strings.

### A9 — Integration stack: CO-OPS → 7shifts → Toast Payroll CSV

1. **CO-OPS → 7shifts:** POST /time_punches on clock-in; PATCH /time_punches/:id on clock-out / correction / reconciliation. CO-OPS holds lifecycle; 7shifts is the sink. REST API confirmed writeable.
2. **7shifts → Toast Payroll:** 7shifts exports CSV to Toast on configured pay-period schedule. CO-OPS does not touch Toast directly.

CO-OPS retains local `time_punches` (A12) as authoritative CO-OPS-side record. Sync failure → record locally, queue retry. Local-first principle locked here; retry queue mechanics implementation-time.

### A10 — Browser-only PWA delivery (Serwist + manifest.json)

Time Clock is a feature of the existing CO-OPS PWA. No App Store, no native push, no NFC. Geolocation is the only new device API. Serwist + `manifest.json` already part of foundation stack.

### A11 — Foreground location only; no background tracking

Geolocation requested only at login (A3 evaluation), continuously via `watchPosition` while foreground (A3 entry detection + A5 high-water mark), and at logout (A4/A5 evaluation).

CO-OPS does NOT use Background Geolocation API, does NOT store position coordinates beyond the binary inside/outside signal + `last_inside_geofence_at` timestamp, does NOT share position data with 7shifts or Toast. Position visibility to CO-OPS is "were you inside the geofence at these moments?" — not a movement trail.

Permission-denied state is not a sign-in blocker; falls back to manual punch + manager reconciliation queue with `metadata.geolocation_denied: true`.

### A12 — DC labor compliance: second precision, no rounding, 3-year retention, TWWFAA schema

CO operates under the District of Columbia Tipped Wage Workers Fairness Amendment Act (TWWFAA). Schema is designed for DC compliance from day one:

- **Second precision** on all `TIMESTAMPTZ` punch columns. No rounding (DC law prohibits).
- **3-year retention** — `time_punches` and time-clock `audit_log` rows are permanent (append-only philosophy). DC requires 3 years; CO-OPS retains indefinitely.
- **TWWFAA quarterly reporting shape** — `time_punches` carries employee ID, location, punch-in/out timestamps, role-level at punch time (tipped/non-tipped classification), correction chain — produces the quarterly wage report without joins.

**Target schema (locked at implementation time — no migrations land in Wave 1):**

```sql
-- Per-location geofence config
ALTER TABLE locations ADD COLUMN geofence_radius_ft INTEGER NOT NULL DEFAULT 500;
ALTER TABLE locations ADD COLUMN latitude DECIMAL(10,7) NULL;
ALTER TABLE locations ADD COLUMN longitude DECIMAL(10,7) NULL;

-- Session-level geofence tracking
ALTER TABLE sessions ADD COLUMN last_inside_geofence_at TIMESTAMPTZ NULL;

-- Authoritative punch record (CO-OPS side)
CREATE TABLE time_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES users(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  punch_in_at TIMESTAMPTZ NOT NULL,
  punch_out_at TIMESTAMPTZ NULL,
  punch_out_source TEXT NULL
    CHECK (punch_out_source IN (
      'logout_inside', 'logout_auto_corrected', 'manager', 'manual'
    )),
  late_reason_category TEXT NULL
    CHECK (late_reason_category IN (
      'stayed_late_shift_need', 'stayed_late_manager_request', 'stayed_late_personal',
      'forgot_to_clock_out', 'device_issue', 'other'
    )),
  late_reason_free_text TEXT NULL,
  role_level_at_punch NUMERIC(4,1) NOT NULL,
  seven_shifts_punch_id TEXT NULL,
  seven_shifts_synced_at TIMESTAMPTZ NULL,
  seven_shifts_sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (seven_shifts_sync_status IN ('pending', 'synced', 'failed', 'retry')),
  original_punch_id UUID NULL REFERENCES time_punches(id),
  correction_count INTEGER NOT NULL DEFAULT 0,
  manager_correction_by UUID NULL REFERENCES users(id),
  employee_attested_at TIMESTAMPTZ NULL,
  employee_attestation_disposition TEXT NULL
    CHECK (employee_attestation_disposition IN ('confirmed', 'flagged'))
);

CREATE INDEX time_punches_user_date ON time_punches(user_id, punch_in_at DESC);
CREATE INDEX time_punches_location_date ON time_punches(location_id, punch_in_at DESC);
CREATE INDEX time_punches_sync_status ON time_punches(seven_shifts_sync_status)
  WHERE seven_shifts_sync_status IN ('pending', 'failed', 'retry');
```

RLS: employee read-own, KH+ read-location, MoO+ read-all. Writes service-role only — CO-OPS lib writes punches; clients never write directly.

### A13 — Implementation deferred 6–12 months; schema migrations at implementation time

Time Clock depends on 7shifts and Toast integration adapters being in place and operationally stable. These are Wave 8 priority. Wave 8 is approximately 6–12 months out from Wave 1 (current).

**No schema migrations land during Wave 1.** Schema changes in A12 are documented as the intended target; they migrate at Wave 8 implementation. Prevents early schema additions that might conflict with integration adapter design decisions made when that wave is actually planned.

C.47 serves as the architectural commitment so the Wave 8 implementation session starts from resolved architecture rather than re-debating foundational questions.

### A14 — 7shifts is authoritative punch record for payroll; CO-OPS is richer forensic record

Operational authority split (matches §2 integration philosophy):

- **7shifts** — authoritative punch sink for payroll. Toast trusts 7shifts. Payroll dispute → 7shifts is the record.
- **CO-OPS `time_punches`** — richer forensic record. Carries geofence metadata, `last_inside_geofence_at`, correction chain, attestation history, sync status, A8 reason categories. Not stored in 7shifts.

When the two diverge (reconciliation, 7shifts direct edit, sync failure), CO-OPS records divergence in `audit_log` and surfaces it in manager reconciliation queue. Resolution flows through CO-OPS (which then syncs to 7shifts) — never by editing 7shifts directly.

### A15 — Manual punch entry fallback for device-failure edge cases

When geolocation unavailable, permission denied, or device failed, KH+ can enter a punch manually on behalf of an employee via the reconciliation queue. Explicit device-failure path — not a standard flow.

Requirements:
1. **Manager-initiated only** — employee cannot self-add manual punch (prevents self-serving fraud)
2. **Required reason** — A8 category (typically `device_issue`); free text required if `other`
3. **Full audit trail** — `time_clock.punch_added` with `metadata.creation_method: 'manual_entry'`, `metadata.reason`, `metadata.entered_by`, `metadata.entered_at`
4. **Employee attestation** — A7 prompt on next login; flag escalates to MoO+

Manual punches sync to 7shifts via same POST /time_punches; `punch_out_source = 'manual'`.

**Why manager-initiated only:** DC labor law makes employer responsible for accurate records. Manager-entered punches are the employer's record-correction mechanism; employee-self-entered would be operationally indistinguishable from fraud without additional verification infrastructure that's out of scope for v1.

**v1.3 action:**

- Add Time Clock as a module in §1.4 artifact model
- Add §2 locked architectural decision (Time Clock: login = clock-in; geofence-gated)
- Add §11 integration adapter entry for 7shifts time-punch API
- Add §4.1 deferred-schema notes for `locations` (`geofence_radius_ft`, `latitude`, `longitude`) and `users` (none — language column folds via C.31)
- Add §4.2 deferred-schema note for `sessions` (`last_inside_geofence_at`)
- Add §4.17 `time_punches` table schema (per A12, deferred to Wave 8)
- Add RLS policies for `time_punches` in §5 (deferred to Wave 8)
- Add §10 entries for geofence event model, sync-retry queue, manager reconciliation queue, employee attestation flow
- Add `DESTRUCTIVE_ACTIONS` entries: `time_clock.punch_corrected`, `time_clock.punch_voided`, `time_clock.punch_added`, `time_clock.attestation_flagged`
- Add §3.4 Compliance sub-section (DC TWWFAA: second precision, no rounding, 3-year retention, quarterly reporting shape)
- Document Wave 8 deferral in §16 build sequencing
- Reference MODULE_PRIORITY_LIST.md Wave 8 for sequencing rationale

Captured during Wave 1 spec refresh session (2026-05-05). Architecture locked with 15 sub-decisions (A1–A15) before any implementation begins, per the CO-OPS working rhythm of discuss-before-building.

---

## How to add an entry

1. Pick the next monotonic ID (`C.<n>` — current next: C.48).
2. Spec sections under amendment.
3. Quote what spec says.
4. Document what built reality is.
5. Why the divergence is correct (operational reasoning, not just "we changed our mind").
6. What v1.3 should do — concrete action so the spec can be reconciled mechanically.

Date entries to whatever calendar the project is on (currently 2026-05-05).

This file is consumed by future spec versions. Its purpose is to make spec drift cheap to reconcile, not to legitimize ad-hoc deviations. Every entry should pass the test "would I tell Pete or Cristian this is the right way to do it?" before it lands here.

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

## C.48 — Closing auto-release time-anchor: `shift_start_at + 16h` constant, not `locations.closes_at + 12h`

**Date added:** 2026-05-06
**Spec sections under amendment:** Build #3 design doc §4.3 (Auto-finalize mechanism); spec v1.3 §4.1 (`locations` table schema)
**Build:** Wave 2 Build #1 (Opening Report) — PR 1

**What design doc says:** §4.3 specifies the system auto-release backstop fires "12 hours after `location.closes_at`, if closing still 'open'." This implies a per-location operating-hours field on `locations` that the cron / lazy evaluator anchors against.

**What built reality is:** PR 1 anchors the auto-release window on `checklist_instances.shift_start_at + 16 hours` instead, applied as a global constant (not per-location). The 16h figure covers an 8h closing-shift maximum + an 8h overnight gap before the next morning's opener arrives. The window lives in the SQL function `release_overdue_closings(p_location_ids uuid[])` (migration 0046).

The `locations.closes_at` column is NOT added in PR 1. The `locations` table currently has no operating-hours data (nine columns: `id, name, code, type, active, address, phone, created_at, created_by` — confirmed via `information_schema.columns`).

**Why the divergence is correct:**

1. **Avoids a per-location data-entry dependency.** Adding `locations.closes_at` would require Pete-side or seed-side population before the cron could function correctly. Without that data, the cron either fail-closes (no releases ever fire) or fail-opens (releases fire too eagerly with NULL anchors). Using `shift_start_at` — already populated on every closing instance — makes the cron self-sufficient on day one.
2. **`shift_start_at` is a more honest anchor.** Operations vary: a Wednesday closing might start at 9pm; a busy Friday might start at 11pm. Anchoring on the actual shift start tracks the actual operational duration, not a static "we typically close at 11pm" assumption.
3. **The 16h constant is defensible and tunable.** 8h closing-shift max (CO's longest closing shifts) + 8h overnight gap (worst case: closer leaves at 7am Sunday after a 11pm Saturday open; next opener arrives Monday at 7am) = 16h. If real operational data later surfaces a tighter or looser bound, change the constant in the SQL function — single-site edit.
4. **CO is single-tenant in DC today.** Two locations (MEP, EM), both same TZ, similar operating windows. A per-location closes_at adds complexity without solving a current problem. When CO multi-tenants or expands beyond DC, revisit.

**v1.4 action:** Update the design doc / spec to reflect `shift_start_at + 16h` as the canonical anchor for the system_auto release path. Document the forward path: when location admin tooling lands (post-Phase 5+), add `locations.close_grace_hours INTEGER DEFAULT 16` so per-location overrides become possible without changing the SQL function shape. The opener-release path (per design doc §4.3) is unaffected — it has no time anchor (opener taps Release whenever they arrive); only the system_auto cron path is touched by this amendment.

**Restart-of-amendments note:** This is the first amendment after Wave 1 closed (spec v1.3 fold landed in PR #38). Per the design doc's frame ("amendments after Wave 1 should accumulate starting C.48"), C.48 marks the resumption of amendment capture for divergences that emerge during Build #3+ work.

---

## C.49 — Closing v2 fridge temp coverage + Opening verified cross-reference (lesson: verify against operational artifacts, not generic priors)

**Date added:** 2026-05-06
**Spec sections under amendment:** spec v1.3 §4.3 (Checklist tables); BUILD_3_OPENING_REPORT_DESIGN.md §2 (Phase 1 Verification Checklist) + §5 (PR 2 sequence)
**Build:** Wave 2 Build #1 (Opening Report) — PR 2

**What spec says:** v1.3 §4.3 defines the checklist template/item structure. Build #1 seeded Standard Closing v1 (then v2 in Build #2 PR 1) per CO's paper closing checklist available at the time. The Build #3 design doc §2.1 specifies that opening "mirrors closing's station structure for visual/cognitive parity" and lists three flavors of opening items, including "counts/state verification" — which implies opening verifies state that closing claimed.

**What built reality is:**

Closing v2 has temp tracking on at most 1 of CO's 8 fridges. The single existing temp item is labeled `"Walk-in temp log"` (Walk Ins station, display_order=15) — historically misleading naming because **no walk-in cooler exists at CO**. The label refers to the under-station fridge at the Walk Ins Station (which itself is named for walk-in customers, not refrigeration). CO's actual fridge inventory is 8 fridges, 0 walk-in coolers, 0 freezers:

1. 3-door fridge (Prep Area)
2. Back-line drinks fridge (Shut Down Back Line)
3. Sauce fridge (Prep Fridge — its own station per the paper checklist)
4. Deli display fridge (Expo)
5. FOH drinks fridge (Clean front of house)
6. Crunchy Boi station fridge
7. 3rd Party station fridge
8. Walk Ins station fridge

Closing v2 also has the item `"Wipe out sides fridge"` (Expo Station, display_order=25) — the "sides fridge" naming is historical/colloquial for the deli display fridge (#4 above).

Additionally, closing v2's Walk Ins station has historical naming drift: the `station` column value is `"Walk Ins station"` (lowercase 's') across all 5 existing items, where the canonical convention (matching the other 9 stations and the operational context) is `"Walk Ins Station"` (capital S). This is Build #1 seed drift — never operationally noticed because the closing-page renders the same string regardless of capitalization. C.49 standardizes the station value in place via UPDATE, touching all 6 rows currently at the lowercase value (5 existing items + the renamed temp log).

Closing v2 has no cross-reference item for Opening Report submission. C.42 established the report-reference auto-completion mechanic (closing's `"AM Prep List"` item with `report_reference_type='am_prep'` auto-completes when AM Prep submits). Opening needs the same mechanic in reverse temporal direction: closing(N) has an `"Opening verified"` item with `report_reference_type='opening_report'` that auto-completes when Opening(N+1) submits.

The PR 2 changes (mechanical, in-place additive seed; applied identically to MEP and EM templates):

| # | Op | Item / target | Station | display_order |
|---|---|---|---|---|
| 1 | UPDATE (station-value, 6 rows touched) | "Walk Ins station" → "Walk Ins Station" (canonical capital S) | n/a — column-value standardization | n/a |
| 2 | UPDATE (rename, id preserved) | "Walk-in temp log" → "Walk Ins station fridge temp log" | Walk Ins Station (post-rename #1) | 15 |
| 3 | UPDATE (rename, id preserved) | "Wipe out sides fridge" → "Wipe out deli display fridge" | Expo Station | 25 |
| 4 | INSERT | "Crunchy Boi station fridge temp log" (expects_count=true) | Crunchy Boi Station | 50 |
| 5 | INSERT | "3rd Party station fridge temp log" (expects_count=true) | 3rd Party Station | 51 |
| 6 | INSERT | "Sauce fridge temp log" (expects_count=true) | Prep Fridge | 52 |
| 7 | INSERT | "Back-line drinks fridge temp log" (expects_count=true) | Shut Down Back Line | 53 |
| 8 | INSERT | "Deli display fridge temp log" (expects_count=true) | Expo Station | 54 |
| 9 | INSERT | "FOH drinks fridge temp log" (expects_count=true) | Clean front of house | 55 |
| 10 | INSERT | "3-door fridge temp log" (expects_count=true) | Prep Area | 56 |
| 11 | INSERT | "Opening verified" (report_reference_type='opening_report') | Closing Manager | 57 |

`display_order` for new items appended at MAX+1 globally (50–57). The closing-client's `groupByStation` uses first-encounter Map insertion ordering (`closing-client.tsx:137`), so new items at order=50+ correctly cluster at the end of their respective station cards without renumbering existing items. Each new item ships with EN + ES translations inline via the `translations` JSONB column per C.37 translate-from-day-one.

**Operation order matters:** station-value standardization (rename #1) runs FIRST so the subsequent label rename (rename #2) can look up by `(station="Walk Ins Station", label="Walk-in temp log")` — i.e., post-standardization station value. Reversing the order would create an idempotency hazard on re-runs (the label-rename's `lookup-by-new` couldn't find the new label at the now-lowercase station). The opening template (Standard Opening v1) uses `"Walk Ins Station"` (capital S) from creation; only closing v2 needs the catch-up standardization.

Closing v2 final state post-C.49: **58 items, 10 stations, 8 fridge temp checks, 1 cross-reference auto-completion item** (Walk Ins station value standardized to canonical capital S across all 6 rows; row count unchanged because the standardization is column-value-only).

Plus a new template entirely: **Standard Opening v1** (10 stations mirroring closing exactly, 44 items, 8 fridge temp checks (one per fridge), all required, all KH+ at min_role_level=3). Seeded fresh; no prior Opening template exists. Auto-completion of closing's new "Opening verified" item via the existing C.42 lib mechanic — no new auto-completion code.

**Why the divergence is correct:**

1. **Don't infer domain structure from generic priors.** The Build #3 PR 2 design conversation surfaced that the implementing assistant had inferred a "walk-in cooler" + freezer station from generic restaurant knowledge — wrong. CO has zero walk-in coolers, zero freezers. The closing v2 template + the paper checklist + on-floor reality are the operational ground truth; the implementing surface MUST verify against those artifacts before proposing structure. This is the third related repetition across the design conversation — converging on a meta-principle: **read surfaces over new workflows; don't add new workflows when a new read surface will do; don't infer structure when the operational artifact tells you what's there.** The first two repetitions: Synthesis View as computed read over granular artifacts (not a separate workflow), Maintenance Log as aggregated read over equipment-tagged completions (not a separate equipment workflow).

2. **Closing template needs to evolve to support opening's verification scope.** Build #1's closing seed was complete for the closing-only universe; it missed temp logging breadth because there was no opening to verify against. Adding opening's verification scope retroactively expanded closing's responsibility. Both templates need to evolve together; PR 2's bundled change captures that joint architectural step rather than splitting into closing-only-then-opening-only PRs that would deploy a temp-logging gap to production between them.

3. **"Walk-Out Verification" station name kept identical on both opening and closing templates.** The `closing-client.tsx:135` hard-codes `WALK_OUT_VERIFICATION_STATION = "Walk-Out Verification"` for the finalize gate. Opening's mirror station shares the same name to enable clean Synthesis View / Reports Console querying later (per C.42 architecture). Different items underneath each template; identical station name. `submit_opening_atomic`'s whole-form atomic submission bypasses per-station gates, so the shared name is operationally fine for opening.

4. **The discovery mechanism: multi-source verification.** Juan's operational knowledge surfaced the wrong-fridge-inventory call (no walk-in cooler exists). Claude Code's database queries surfaced the existing closing v2 state including the misnamed "Walk-in temp log" item and the "Wipe out sides fridge" item. The paper checklist photo surfaced the Prep Fridge structural call (it's intentionally its own station, not a misstructured one). Each source caught different gaps; no source alone would have caught everything. Future builds touching operational structure should expect to need 2-3 verification sources before locking scope — Juan's eyes-on, database queries, and the operational artifact (paper, photo, or on-floor walkthrough).

**v1.4 action:**

1. Update §4.3 (or add a new sub-section) capturing Standard Closing v2's final state post-C.49: 58 items across 10 stations, 8 fridge temp checks (matching CO's actual 8-fridge inventory), 1 cross-reference auto-completion item.
2. Add Standard Opening v1 to the seeded templates list: 44 items across 10 stations (mirrors closing's structure with adapted opening-context items per three flavors — safety/security verification, counts/state verification, opening-specific tasks with no closing pair), 8 fridge temp checks (one per fridge), all required, all KH+ (min_role_level=3).
3. Add an architectural principle to the spec's working-rhythm section: **"Verify against operational artifacts, not generic priors."** When designing a new module that touches operational structure (stations, equipment, financial flows, role assignments), the implementing surface must verify against the existing operational artifacts — production schema, paper checklists, on-floor reality — before proposing structure inferred from generic domain knowledge. The closing template + the paper checklist are the operational ground truth for what stations/equipment exist; new templates must mirror that, not invent.
4. **Add a canonical fridge inventory reference table to §4.3 (alongside template descriptions).** The 8 fridges with their station mapping per the table above. Templates reference fridges via `expects_count=true` items; the table makes the equipment universe explicit so future module designs (Maintenance Log Wave 7, Synthesis View, AI Insights) reference the table directly rather than re-deriving from completion data. This is "read surfaces over new workflows" in action — equipment is read off operational templates, not modeled separately. The table becomes part of the operational template universe, not buried in operational-context prose.
5. Capture the in-place-additive-vs-Path-A-v3 precedent in the working-rhythm section. **In-place additive seed** is the right pattern when (a) all changes are additive INSERTs or label-only UPDATEs preserving id, (b) historical instances retain their snapshot via C.44 snapshot-universe-locking, (c) no item removals or breaking changes. Snapshot universe locking ensures historical instances retain their template-state-at-submission; new instances created post-seed include the new items. Renames preserve `template_item.id`, so the FK chain in `checklist_completions` stays intact for historical instances. **Path A v3** is the heavier artifact reserved for substantial revisions (item removals, role-level changes, structural restructuring). PR 2 = canonical reference for in-place; Build #2 cleanup PR (`960d0fa`) = canonical reference for Path A flip-to-inactive.

---

## C.50 — Opening Report Phase 2 calculation logic redesign

**Date added:** 2026-05-08
**Status:** Locked
**Supersedes:** Phase 2 architecture as locked in `BUILD_3_OPENING_REPORT_DESIGN.md` (three-values model: closer estimate / opener actual / opener prepped)
**Triggered by:** Smoke run 2026-05-08 at MEP — Juan surfaced that prep_need calculation against par alone produces nonsensical economics when ground truth exceeds par
**Scope:** Phase 2 form, dispatch RPC, schema, notification triggers, three signals computation
**Out of scope (deferred to C.51):** Phase 1A/1B section split, opening report dashboard tile, back-to-dashboard affordance, opening submit auto-finalizing yesterday's closing
**Build:** Wave 2 Build #1 (Opening Report) — PR 3 (branch `claude/nice-wilson-398de1`, post-S1-smoke architectural redesign)
**Lock state:** Architectural model (§1–§7) locked 2026-05-08; §8 implementation answers locked in pre-build response on commit `b39d25b` of branch `claude/nice-wilson-398de1` (see §8 inline annotations + §9 below).

### §1 — Operational model

The locked three-values model treated closer estimate, opener actual, and opener prepped as three equal-weight inputs to over/under-par determination. Smoke surfaced this is operationally wrong: it forced both shifts to do equivalent counting work and computed prep need against par alone, ignoring how much was already on hand.

The corrected model reflects how CO actually operates:

- **Closer's role at end of shift:** Full per-item count of all tracked inventory. This is the truth at close. Captured in the closing report as `closer_count` per item. Not an estimate — an actual count.
- **Opener's role on arrival:** Section-level spot check. Opener walks each station, scans the items, taps "verified" on the section as a whole if everything looks consistent with closer's recorded counts. Default fastest path: section-verify covers all items in that section.
- **Per-item exception path:** If opener spots an item within a section that looks off, opener taps into that item to expand a recount input. Opener enters the corrected count → `opener_recount` is populated for that item only. The recount becomes ground truth for that item; section-verify still covers the other items in the section.
- **Prep need derivation per item:**
  - `ground_truth_count = opener_recount IF opener_recount IS NOT NULL ELSE closer_count`
  - `prep_need = MAX(0, par − ground_truth_count)`
  - If `ground_truth ≥ par`, `prep_need` is 0 (already at par or above; no prep required to reach par)
- **Opener's prep work:** For each item where `prep_need > 0`, opener preps. The captured value is `opener_prepped` — the actual quantity made today. Audited against `prep_need`:
  - `opener_prepped == prep_need` → at par (happy path, no notification)
  - `opener_prepped > prep_need` → over-prep (requires reason capture; no urgent notification)
  - `opener_prepped < prep_need` → under-prep (requires reason capture + urgent notification dispatched per C.48 routing rules)
- **Par override case:** Opener may intentionally prep above `prep_need` (forecast busy day, catering load, prevent expiration) or below (slow day, ingredient shortage). Both are captured via the existing reason category enum + free-text. Same UI surface as today's over-par capture; semantic meaning shifts from "vs par" to "vs prep_need."

### §2 — Data model

**Per-section instance state (new — UI driven)**

New table or JSONB structure capturing section-level verification:

```sql
opening_section_verifications:
  artifact_instance_id    uuid (FK to artifact_instances)
  section_key             text (e.g., 'station_bread', 'station_cheese', 'station_protein')
  verified_at             timestamptz
  verified_by             uuid (FK to users)
  PRIMARY KEY (artifact_instance_id, section_key)
```

One row per section per artifact instance. Inserted when opener taps "verify section" in the form. Append-only — if opener un-verifies and re-verifies, both rows preserved with timestamps (existing CO-OPS append-only convention).

Implementation question for Claude Code: new dedicated table vs. JSONB column on `artifact_instances`. JSONB is simpler for read paths (single fetch surfaces all section verifications); dedicated table is cleaner for queries and indexing. Recommend dedicated table — section verification data will be queried independently (closer accuracy signals, opener performance dashboards) and benefits from indexed access patterns.

**Per-item completion state (modified)**

Existing `checklist_completions` table extends to support the new fields. AM Prep already uses `prep_data` JSONB for closer estimate; opening Phase 2 follows the same pattern with a different shape:

```jsonc
checklist_completions.prep_data (JSONB, opening Phase 2 shape):
{
  "phase": 2,
  "closer_count": <number>,            // populated from closing snapshot at form load
  "spot_check_status": <enum>,         // 'matched_via_section_verify' | 'flagged_recount'
  "opener_recount": <number | null>,   // populated only when status = 'flagged_recount'
  "ground_truth_count": <number>,      // computed at submit time
  "prep_need": <number>,               // computed at submit time (MAX(0, par - ground_truth_count))
  "opener_prepped": <number>,          // captured from form
  "delta_vs_prep_need": <number>,      // computed (opener_prepped - prep_need)
  "over_under_status": <enum>,         // 'at_par' | 'over_prep' | 'under_prep'
  "over_under_reason_category": <enum | null>,  // existing enum: management_directive, clear_fridge_space, etc.
  "over_under_reason_text": <text | null>,      // free-text capture
  "directed_by": <uuid | null>         // existing capture for management-directed over-prep
}
```

`count_value` column on `checklist_completions` is no longer used for opening Phase 2 (closer estimate previously lived there per AM Prep convention). All Phase 2 numeric data lives in `prep_data` JSONB.

**Closer-count snapshot table (new — locked per §8.1)**

`opening_closer_count_snapshots` captures the closer's per-item count at the moment opener begins verification, decoupling opening's ground-truth from closer's C.46 chained-edit window:

```sql
opening_closer_count_snapshots:
  id                       uuid PK
  opening_instance_id      uuid FK → checklist_instances
  template_item_id         uuid FK → checklist_template_items
  closing_instance_id      uuid FK → checklist_instances  -- forensic trace to source closing
  closer_count             numeric NOT NULL              -- the closer's `total` value (see 1:1 AM Prep correspondence below)
  par_value                numeric                        -- mirrored from prep_meta.parValue at snapshot time
  par_unit                 text                           -- mirrored from prep_meta.parUnit
  snapshot_taken_at        timestamptz NOT NULL DEFAULT NOW()
  snapshot_by              uuid FK → users               -- the opener who triggered the instance create
  UNIQUE (opening_instance_id, template_item_id)
```

`loadOpeningState` materializes the snapshot from yesterday's closing live state at the moment of opening instance creation, persists, and reads from the snapshot thereafter. Subsequent C.46 chain edits to closing affect closing's chain attribution but DO NOT alter what opener verified against. Per C.44 snapshot universe locking precedent: historical reports preserve template state at submission time; same principle applied to closer-count at opening boundary.

**1:1 AM Prep correspondence + `amPrepTemplateItemId` FK (architectural constraint, locked per Concerns 4 + 5)**

Each opening Phase 2 item MUST have a 1:1 correspondence with an AM Prep template item. The AM Prep schema MUST carry a `total` column for the matched item; opening Phase 2's `closer_count` reads `total` at snapshot materialization time. Multi-column AM Prep state (`onHand`, `portioned`, `line`, etc.) collapses to the canonical `total` value at the opening boundary. If a future Phase 2 item lacks a corresponding AM Prep item with `total`, the FK is NULL and the seed surfaces the gap; submission fails the submit gate until reconciled.

`OpeningPhase2Meta` carries `amPrepTemplateItemId: uuid` linking each opening Phase 2 item to its corresponding AM Prep template item. This explicit FK replaces label-matching (which conflicts with AGENTS.md C.38 system-key-vs-display-string discipline; label drift would silently break closer-snapshot lookup). Step 11 schema migration includes a one-time UPDATE that resolves FKs from existing seeded data via `(section, label)` matching, persists into `prep_meta` JSONB, and validates non-NULL on every Phase 2 item before C.50 implementation continues. Closer-snapshot lookups use the explicit FK exclusively from Step 11 onward.

**🔧 Spec correction post-pre-build (2026-05-09, Step 11 implementation kickoff):** The `amPrepTemplateItemId` JSONB field discussed in pre-build response and locked above is architecturally redundant with the existing column `checklist_template_items.references_template_item_id` added in migration 0049 (Step 1, populated for all 68 Phase 2 items as of 2026-05-08). Pre-build response framed Concern 5 as if no FK existed; that was a verification miss — schema state should have been queried before drafting the recommendation. Step 11 implementation uses the column FK as canonical; the JSONB addition is dropped. Migration 0051 simplifies to "two new tables, no backfill, no audit emission" per Step 11 Lock 1. The architectural constraint above (1:1 AM Prep correspondence + `total` column requirement) remains correct and unchanged — only the FK persistence mechanism shifts from JSONB to the existing column. Captured as a durable lesson candidate for AGENTS.md (Step 15 wrap): **pre-build responses should query operational artifacts first** — when proposing schema additions, FK relationships, or data model changes, query current schema state before drafting recommendations. Sibling discipline to "verify against operational artifacts, not generic priors"; same principle applied to architectural-design surface.

**Closer accuracy aggregation (new view or computed surface)**

Closer accuracy signal is computed per-item per-closer over time. Recommend a materialized view or scheduled aggregation:

```sql
closer_accuracy_signals:
  closer_user_id          uuid
  template_item_id        uuid
  artifact_instance_id    uuid
  closer_count            number
  ground_truth_count      number
  delta                   number    // ground_truth - closer
  recount_fired           boolean   // true if opener flagged a recount
  occurred_at             timestamptz
```

Only populated for items where `ground_truth_count != closer_count` OR where opener explicitly recounted. Non-recounted, section-verified items contribute "implicit zero delta" data points (lower forensic weight but useful at scale). Implementation detail deferred to Claude Code; minimum viable shape is a query view computed on demand.

### §3 — Three signals re-mapped

The three-values data shape produces three operationally distinct signals:

| Signal | Computation | Owner accountability | Surfaces in |
|---|---|---|---|
| **Closer accuracy** | Per-item Δ(`closer_count`, `ground_truth_count`) where recount fired. Aggregated over time per closer. | Closer's job performance / count discipline | Closer performance dashboards (post-Toast integration), end-of-week rollups |
| **Opener execution** | Per-item Δ(`opener_prepped`, `prep_need`). Zero = at par. Negative = under-prep. Positive = over-prep. | Opener's job performance / prep discipline | Opener performance dashboards, end-of-week rollups |
| **Par override / forecasting accuracy** | When `opener_prepped > prep_need` with management directive, OR `opener_prepped < prep_need` with intentional reason. | Operational judgment (currently opener; eventually Toast API + manager) | Manager review queues, par calibration over time |

Each signal has a clear owner and a clear use. The current under-par notification dispatch (per C.48 routing: KH+ at same location AND MoO Cristian AND Owner Pete) fires on the **opener execution** signal when `delta_vs_prep_need < 0` AND `over_under_reason_category` is captured.

### §4 — Behavior contract

**Form rendering**

Phase 2 renders per-section, with per-item drill-in for recounts:

- Section header with verify-section CTA
- List of items in section, each showing:
  - Item name
  - `closer_count` (read-only, surfaced from closing snapshot)
  - `prep_need` (computed and shown live as opener verifies/recounts)
  - Opener prepped input (numeric)
- Per-item tap-in opens recount panel: input for `opener_recount`, save → `prep_need` recomputes for that item, opener prepped input enabled

Form submit gate:

- Every section must be verified (or all items individually flagged with recounts — equivalent)
- Every item with `prep_need > 0` must have `opener_prepped` populated
- Items where `opener_prepped != prep_need` must have `over_under_reason_category` + `reason_text`
- Items with `over_under_status = 'over_prep'` and `directed_by` populated trace to a real KH+ user

**`submit_opening_atomic` RPC dispatch**

`submit_opening_atomic` Phase 2 path extends to:

1. Validate all sections verified OR all items individually recount-flagged
2. Compute `ground_truth_count` per item (`opener_recount` if present, else `closer_count`)
3. Compute `prep_need` per item (`MAX(0, par − ground_truth_count)`)
4. Compute `delta_vs_prep_need` per item (`opener_prepped − prep_need`)
5. Validate `reason_category` + `reason_text` present where `delta != 0`
6. Insert per-item Phase 2 completions with full `prep_data` JSONB
7. Insert per-section verification rows for all verified sections
8. Insert `closer_accuracy_signal` rows for items where `ground_truth != closer_count`
9. Dispatch **one notification per item** where `delta_vs_prep_need < 0` (under-prep) — urgent priority, recipients = KH+ at same location + MoO + Owner DISTINCT, routed per C.48 (per-item granularity confirmed in lock; see "Notification triggers" above)
10. Audit: `opening.submit` row with `phase2_count` populated, `section_verify_count`, `recount_count`

**Notification triggers**

Under-prep notification fires **per item — one notification per under-par item per submission**, dispatched per C.48 routing rules. Per-item granularity matches the operational unit of attention: managers may investigate items independently ("why bread" vs "why cheese"); per-item dismissal/read state matters; per-item card grain is preserved across the dashboard surface and `formatNotification` body shape from PR 3 Step 7. **Supersedes** the earlier draft framing of "batched into a single notification dispatch" — locked back to the Step 4 PR 3 kickoff convention. 3 under-par items in one submission → 3 notification rows + 9 recipient rows (3 × {KH+ at location, MoO, Owner DISTINCT}), severity urgent, in-app first, SMS when A2P clears.

Over-prep does NOT fire notifications (operational signal but not urgent — captured for review, not real-time response).

### §5 — Migration impact

**Schema changes**

- New table: `opening_closer_count_snapshots` (per §2 + §8.1 lock)
- New table: `opening_section_verifications`
- New JSONB field on `OpeningPhase2Meta`: `amPrepTemplateItemId` (per §2 + Concern 5 lock; populated via Step 11 backfill UPDATE)
- New view or aggregation: `closer_accuracy_signals` (deferred implementation, contract defined; per §8.4 lock)
- Existing `checklist_completions.prep_data` JSONB shape extended (no schema change; JSONB shape evolves)
- **JSONB invariant enforced at RPC submit (per §8.4 lock):** every Phase 2 completion `prep_data` MUST contain `phase=2`, `closer_count`, `ground_truth_count`, `opener_prepped`, `prep_need`, `delta_vs_prep_need`, `over_under_status` (one of `'at_par' | 'over_prep' | 'under_prep'`). Even on the section-verified happy path where `closer_count == ground_truth_count` and `delta_vs_prep_need = 0`, all six fields persist. Future closer-accuracy view materializes from this shape with no backfill.

**RPC changes**

- `submit_opening_atomic` Phase 2 dispatch path rewritten per §4
- Existing Phase 1 dispatch path unchanged
- Validation logic added for prep_need-relative checks

**Form changes**

- `OpeningClient` Phase 2 rendering rewritten per §4
- New section-verify component
- New per-item recount drill-in component
- `prep_need` surfaced live as derived value

**Loader changes**

- `loadOpeningState` extends to fetch `closer_count` from yesterday's closing snapshot per item
- Section verification state hydrated from new table
- `prep_need` computed at form-render time for live display

**Notification changes**

- Trigger logic moves from "delta_vs_par" to "delta_vs_prep_need"
- Per-item notification batching into single dispatch per submission
- Existing C.48 routing rules unchanged

### §6 — What stays unchanged

- Phase 1 verification flow (station ticks + temp checks + photo capture)
- C.46 chained-edit semantics (KH+ post-submission edit, `edit_count` cap = 3)
- C.48 auto-release infrastructure (16h window + lazy evaluator + system_auto path)
- Multi-location architecture (region scoping, location-aware data models)
- Append-only data convention (supersession via audit, never destructive overwrites)
- Notification routing rules (KH+ same location + MoO + Owner for under-par urgent path)
- Audit log structure and forensic chain conventions
- Bilingual translation surface (still candidate for C.48 amendment when scope reopens)

### §7 — Test surface requirements

Per the AGENTS.md durable lesson candidate (multi-surface PRs need integration smoke before merge), C.50 implementation must include:

- Unit tests for `prep_need` computation (par 10, ground_truth 8 → prep_need 2; par 10, ground_truth 12 → prep_need 0)
- Unit tests for `ground_truth` derivation (recount present → recount; recount null → closer_count)
- Integration test for full loader → form → submit round-trip with seeded Phase 2 items, including section-verify and per-item recount paths
- Smoke test surface for under-par notification dispatch end-to-end (form submit with under-prep → notification row created → recipient rows dispatched)

Smoke against operational data is required before merge — CI green alone insufficient.

### §8 — Open implementation questions for Claude Code

Locked answers landed in the pre-build response on commit `b39d25b` of branch `claude/nice-wilson-398de1`. Each question kept for forensic context with its lock annotation.

1. **Closer count snapshot strategy** — how does opener form load yesterday's closing counts per item? Live query against `checklist_completions` for yesterday's closing instance, or denormalized snapshot copied at opening instance creation? Trade-off: live query keeps data fresh but couples opening to closing's edit window (C.46 chained edits could change closer's counts after opening renders); snapshot is decoupled but stale if closer edits.
   - **🔒 Locked:** denormalized snapshot at opening instance creation. New table `opening_closer_count_snapshots` per §2. C.44 snapshot universe locking precedent applies; live query couples to closing edit window and creates audit ambiguity.

2. **Section key derivation** — `section_key` (e.g., `'station_bread'`) comes from where? Template item metadata? Hardcoded in form layout? Recommend: extend template item schema with `section_key` field, populated in seed data.
   - **🔒 Locked:** reuse existing `prep_meta.section` field; no new column. Already populated for opening Phase 2 items per Step 3 seed (values: `"Cooks"`, `"Veg"`, `"Sides"`, `"Sauces"`, `"Slicing"`). Bare names match closing v2 `station` column convention; C.38 system-key discipline says no namespacing. Redundant column would risk drift.

3. **`prep_need` computation timing** — computed server-side at submit only (form shows live preview but truth lives in DB) OR server-side validation that client-computed value matches recomputation?
   - **🔒 Locked:** server-side compute at submit only; **raw-inputs-only request shape** (no client-derived values in payload). Client preview is display-only and discarded at submit. Request payload contains: per item `templateItemId`, `openerRecount` (nullable), `openerPrepped`, `reasonCategory` (nullable), `reasonText` (nullable), `directedBy` (nullable); per section `sectionKey`, `verified`. Server derives `closer_count` (from snapshot table), `ground_truth_count`, `prep_need`, `delta_vs_prep_need`, `over_under_status`. Single source of truth in the RPC; AGENTS.md "Form validation must iterate the source of truth" discipline applied.

4. **Closer accuracy view materialization** — implement now as part of C.50 OR defer to a separate amendment when closer performance dashboards are scoped?
   - **🔒 Locked:** defer the view; tighten the per-completion `prep_data` JSONB validation invariant so the view materializes later with no backfill. RPC validates all six required fields present even on the section-verified happy path (see §5 invariant note). View itself ships with closer performance dashboards module (Wave 6+ scope).

### §9 — Locked decisions from pre-build response (concerns surfaced + answered)

Five architectural concerns surfaced during pre-build response on commit `b39d25b`. Each locked Y/N or counter-proposal:

1. **🔒 Add lock-state clarifying note** at top of C.50. Single line documenting the architectural-model-locked / §8-implementation-locked split. Prevents future-Claude reading "Status: Locked" and missing that §8 had open questions at draft time.

2. **🔒 Revert notification dispatch to N-per-item** (supersedes the C.50 §4 draft "batched into a single notification dispatch" framing). Per-item granularity matches operational unit of attention; per-item dismissal/read state matters; preserves the Step 4 PR 3 kickoff lock. 3 under-par items in one submission → 3 notification rows + 9 recipient rows. No rework to dashboard card layout or `formatNotification` body shape from PR 3 Step 7.

3. **🔒 Codify submit gate rule:** for every Phase 2 item, AT LEAST ONE OF (parent section verified) OR (`opener_recount` populated) must be true. Server-side enforcement with sqlstate-mapped error if violated. Matrix:
   - Section verified, no recount → `ground_truth = closer_count`
   - Section verified + recount on item → `ground_truth = opener_recount` (overrides)
   - Section NOT verified + recount on every item in section → `ground_truth = opener_recount` per item
   - Section NOT verified + any item without recount → submit FAILS with sqlstate-mapped error

4. **🔒 1:1 AM Prep correspondence + `total`-column constraint.** `closer_count` reads `total` from yesterday's AM Prep at snapshot materialization time. Multi-column AM Prep state collapses to single ground-truth at opening boundary. AM Prep schema must carry `total` for matched item; future Phase 2 items lacking a corresponding AM Prep item with `total` surface as NULL FK and fail submit gate until reconciled. Captured as architectural constraint in §2.

5. **🔒 Add `amPrepTemplateItemId` FK to `OpeningPhase2Meta`.** Replaces label-matching (fragile per C.38 system-key discipline). Step 11 backfill UPDATE resolves from existing data via `(section, label)` matching, persists, validates non-NULL. From Step 11 forward, all closer-snapshot lookups use the explicit FK. Captured in §2.

**Step 14 verification tightening (Q-extensions for smoke re-run):**

- **Q-extension 1:** per-item `ground_truth` derivation lands correctly in `prep_data` audit (test both section-verified path AND recount path within the same submission)
- **Q-extension 2:** `prep_need` edge case where `par=10 / ground_truth=12` produces `prep_need=0` (NOT negative)
- **Q-extension 3:** N-per-item notification dispatch verified (3 under-par items → 3 notifications + 9 recipient rows, NOT 1 + 3)
- **Q-extension 4:** submit gate enforcement — attempt submit with unverified section + no recount on items in that section → expect failure with sqlstate-mapped error

**Step sequence (locked):** Steps 11–15 per pre-build response proposal. Step 14 incorporates Q-extensions 1–4 above before Step 15 wrap.

**Migration files (locked):** `0051` (both new tables + `amPrepTemplateItemId` FK backfill UPDATE on existing seed data) and `0052` (RPC rewrite). Bundling at 0051 is right; separating RPC at 0052 follows AGENTS.md migration discipline (functions vs tables = different concerns; cleaner audit/rollback).

---

## C.51 — Opening report UX hygiene (deferred stub)

**Date added:** 2026-05-09
**Status:** Deferred — slot reserved; full authoring when implementation begins
**Build:** Wave 2 Build #1 (Opening Report) — post-C.53

**Scope** (per `docs/STEP_12_13_HANDOFF.md` §"Step 15 wrap deliverables" → C.51):

- Opening report dashboard tile (parity with AM Prep tile)
- Back-to-dashboard affordance on opening page
- Opening submit auto-finalizing yesterday's closing per C.48 dependency graph (Finding 3 from PR 3 smoke)
- PAR + PREP NEED visual prominence — headline values for prep decisions; current layout treats them as supporting data. Future Toast API integration makes par dynamic; visual prominence prepares for that operational meaning.

C.51 is intentionally a stub. The handoff doc captured the scope; this entry reserves the numerical slot in the canonical amendment register. Full authoring (operational reasoning, design decisions, v1.3 action checklist) lands when the implementation conversation opens — likely after C.53 ships the three-phase restructure, since several C.51 items (back-to-dashboard, tile rendering) sit naturally on top of C.53's new structure.

Captured during Step 15 reconcile (2026-05-25) when C.51–C.53 formalized from `docs/STEP_12_13_HANDOFF.md` into `SPEC_AMENDMENTS.md`.

---

## C.52 — Phase 2 collaborative real-time prep

**Date added:** 2026-05-09
**Status:** Locked
**Triggered by:** Operational reality at Compliments Only — multiple cooks (line cooks, dishwashers also doing prep) work concurrently during the 2-3 hour pre-service window. Single-actor atomic submit model from C.50 doesn't match how the kitchen actually operates. Real-time per-item save matches the operational pattern (and reuses existing closing-checklist infrastructure).
**Scope:** Phase 2 prep execution becomes location-scoped collaborative real-time. Phase 1 (verification) stays single-user (KH+ opener). Submit authority remains with KH+ opener who completed Phase 1.
**Out of scope:** Phase 1 collaborative behavior (stays single-user); Phase 3 (handled in C.53); cross-cutting offline-save-queue (separate amendment).
**Depends on:** C.53 (three-phase restructure — Phase 2 simplification depends on Phase 1 absorbing verification work).
**Build:** Wave 2 Build #1 (Opening Report) — implementation phase TBD; sequenced relative to C.53.

### §1 — Operational model

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

### §2 — Why this lands operationally

**Matches kitchen reality.** 2-3 cooks working in close quarters during prep window, self-coordinating, prepping different items. Each saves what they prepped as they finish. Opener oversees, sees real-time progress, submits when ready.

**Reuses existing infrastructure.** The closing checklist already supports multi-author per-item saves with real-time sync. C.52 is the same pattern applied to Phase 2 prep, with numeric inputs instead of binary ticks.

**Per-actor accountability preserved.** `saved_by` captures who saved each entry. Audit trail surfaces "Cook A prepped 4 QT marinara at 7:32am; Cook B prepped 2 QT caramelized onion at 7:45am; Opener submitted at 8:30am." Manager review queues consume this for performance discussion.

**Operationally cleaner than alternatives.** Without C.52, opener has to walk around asking each cook what they prepped, manually enter all values themselves at submit time. That's how the platform would force them to operate today (single-actor C.50 model), and that's not how kitchens actually work. C.52 closes the gap between system and reality.

### §3 — Data model

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

### §4 — Real-time subscription

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

### §5 — Form rendering (per-item save)

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

### §6 — Submit authority + dispatch

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

### §7 — Migration impact

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

### §8 — What stays unchanged from C.50

- Calculation logic (`closer_count` + `ground_truth_count` + `prep_need` + `opener_prepped` + `delta_vs_prep_need` + `over_under_status`)
- Three signals architecture
- Notification dispatch (N-per-item, recipient routing, no re-emission on chain edits, fired at submit time)
- C.46 chained edit semantics (own-row only, edit_count cap)
- C.48 auto-release infrastructure
- Append-only convention
- Bilingual translation discipline

### §9 — Open implementation questions for pre-build response

When fresh session opens C.52 implementation (post-PR-3, sequenced relative to C.53):

1. **C.52 vs C.53 implementation ordering** — C.52 depends on C.53 (Phase 2 simplification needs Phase 1 to absorb verification first). Implementation order: C.53 first → C.52 second OR both bundled? Pre-build response should propose.
2. **Real-time subscription library** — Supabase Realtime's existing patterns. Same as closing checklist? Pre-build response confirms exact implementation pattern matches existing collaborative surface.
3. **Conflict resolution UX details** — when remote update arrives while user has unsaved local changes, what's the UX? Toast notification? Inline diff? Modal? Pre-build response should propose.
4. **Per-item save endpoint vs single multi-item endpoint** — does each save fire its own RPC call (chatty, simple) or do saves batch within a debounce window (less chatty, more complex)? Pre-build response should propose. My read: per-item save endpoint, simple and matches operator intent.
5. **Save state recovery on connection loss** — if user saves while offline, what happens? Cross-cutting offline-save-queue amendment will handle this generally; in C.52's scope, fail-fast with retry CTA is acceptable. Pre-build response should propose interim behavior.
6. **Multi-author audit visibility** — when KH+ reviews submitted opening, do they see per-item save attribution surfaced in the form? Or only in audit log? Pre-build response should propose.
7. **C.46 chain-edit semantics with C.52 multi-author saves** — if Cook A saves 4 QT, then later (post-submit) the opener chain-edits to 6 QT (correction), does the chain edit replace Cook A's `saved_by` attribution or preserve it? My read: chain edit creates a new completion row with `edit_count > 0`; original Cook A's row stays as the original audit trail. Pre-build response should confirm.
8. **Visibility of in-progress saves to MoO/Owner** — multi-location actors monitoring real-time during prep. UI surface for them — same as opener's view, or different (read-only, aggregated)? Pre-build response should propose.

### §10 — Test surface requirements

Per AGENTS.md "Multi-surface PRs need integration smoke before merge":

- Unit tests for `save_phase2_item_atomic` RPC (auth gate, instance state validation, JSONB shape)
- Unit tests for `submit_phase2_atomic` partial-state handling (some items pre-saved, some not)
- Integration tests for multi-author save sequence (Cook A saves marinara, Cook B saves caramelized onion, opener submits)
- Integration tests for conflict resolution (concurrent saves on same item)
- Smoke test surface for full collaborative prep flow at MEP (multiple test users saving items, opener submitting)
- Smoke test surface for real-time subscription behavior (Cook A's save appears on Cook B's screen within reasonable latency)
- Smoke test surface for offline behavior (Cook A goes offline mid-save, comes back online; what happens to their save)

Smoke against operational data is required before merge.

---

## C.53 — Three-phase opening report restructure: verification → prep → setup

**Date added:** 2026-05-09
**Status:** Locked (architectural); implementation pending fresh-session pre-build
**Triggered by:** Operational mismatch in C.50's two-phase model — verification work and prep work belong to different actors at different times. C.50's single-shot opening submit forced opener to do both before any cook could start prepping; in reality the kitchen splits the workflow across opener (verification) + cooks (collaborative prep) + opener (setup verification).
**Scope:** Opening report restructures from 2 phases to 3 phases — Phase 1 (KH+ verification, single-user) + Phase 2 (collaborative prep per C.52, location-scoped multi-actor) + Phase 3 (KH+ setup verification, single-user).
**Out of scope:** Closing report (unchanged); AM Prep (unchanged); Mid-day Prep (handled in C.43); cross-cutting offline-save-queue (separate amendment); role-gated historical access (separate cross-cutting amendment).
**Depends on:** **C.54** — opening submit must not be gated by prior-closing existence; missing-closing becomes a routed signal. Specifically, C.53's submit surface must implement (A) auto-complete decoupled from submit success, (B) NULL-ground-truth-source manager signal, (C) opener attestation + provenance marker. See C.54 §2–§3. C.53's pre-build response must have C.54 on the table from its first turn or the restructure will need to be reopened.
**Build:** Wave 2 Build #1 (Opening Report) — implementation phase TBD (~3800 LOC across 6 phases per §10).

### §1 — Operational model

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

### §2 — Why this lands operationally

**Verification work stays with the verification actor.** Opener does ALL verification work (station, temp, spot-check counts, station setup) in Phase 1 + Phase 3. Cooks don't engage with verification mechanics.

**Prep work surfaces clearly to prep actors.** Cooks open Phase 2 and see prep needs immediately — no verification mechanics in their view. They prep and save.

**Sequential phases match physical workflow.** Opener walks → cooks prep → opener verifies setup → submit. Each phase is a distinct physical activity at a distinct time during the 2-3 hour pre-service window.

**Phase boundaries enforce ordering.** Phase 2 can't start until Phase 1 verifies counts (otherwise prep_need can't compute). Phase 3 can't start until Phase 2 produces the prepped items (otherwise setup has nothing to place). Architectural gates match operational reality.

**Single KH+ owns the report end-to-end.** Same opener does Phase 1 verification, oversees Phase 2 collaborative prep, executes Phase 3 setup verification. Submit authority flows from Phase 1's submitter through to Phase 3's submit.

### §3 — Data model

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

### §4 — Three signals re-mapped (no change from C.50, just re-anchored to new phase boundaries)

Three signals computed from per-item state, each with distinct organizational accountability:

| Signal | Computation | Owner accountability | Captured during |
|---|---|---|---|
| **Closer accuracy** | Δ(closer_count, ground_truth_count) per item, aggregated over time per closer. Non-zero only when opener-recount fired during Phase 1 spot-check. | Closer's job performance / count discipline | Phase 1 (spot-check) |
| **Opener execution** | Δ(opener_prepped, prep_need) per item. Zero = at par. Negative = under-prep. Positive = over-prep. | Opener's job performance / prep discipline | Phase 2 (prep) |
| **Setup accuracy** | Boolean items: verified count vs total count. Quantitative items: in_range count vs total count. Per-station for per_station scope; aggregate for shared scope. | Opener's job performance / service-readiness discipline (NEW SIGNAL) | Phase 3 (setup) |

**New signal — Setup accuracy** — surfaces patterns over time. "Juan's openings consistently set up Caesar kits correctly; Maria's openings frequently miss backup pickle." Manager review queues consume this signal for performance discussion.

### §5 — Behavior contract per phase

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

### §6 — Migration impact

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

### §7 — What stays unchanged from C.50

- C.50 calculation logic (`closer_count` + `ground_truth_count` + `prep_need` + `opener_prepped` + `delta_vs_prep_need` + `over_under_status`) — preserved end-to-end
- Three signals architecture — preserved + extended (setup accuracy added)
- Notification dispatch (N-per-item, recipient routing, no re-emission on chain edits) — preserved
- C.46 chained edit semantics — preserved per phase
- C.48 auto-release infrastructure — preserved (16h window applies to instances stuck at any phase)
- Region scoping pattern — preserved (Phase 3 setup items follow same pattern)
- Append-only convention — preserved across all three phases
- Bilingual translation discipline — preserved

### §8 — Open implementation questions for pre-build response

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

### §9 — Test surface requirements

Per the AGENTS.md durable lesson "Multi-surface PRs need integration smoke before merge," C.53 implementation must include:

- Unit tests for Phase 1 RPC: spot-check derivation (recount fired vs section-verified), prep_need computation persisted to Phase 2 prep_data ahead of Phase 2 dispatch
- Unit tests for Phase 2 RPC simplified: validates only Phase 2 fields (Phase 1 work pre-resolved)
- Unit tests for Phase 3 RPC: setup item validation, range checking, multi-station verification handling
- Integration tests for full three-phase round-trip: instance create → Phase 1 submit → Phase 2 saves + submit → Phase 3 submit
- Smoke test surface for end-to-end three-phase flow at MEP and EM (location-scoped collaborative behavior)
- Smoke test surface for chain-edit behavior across phases (edit Phase 1 after Phase 2 submits — does Phase 2 data shift?)
- Smoke test surface for `incomplete_confirmed` at Phase 3 (missing items + reason capture + notification dispatch)

Smoke against operational data is required before merge — CI green alone insufficient.

### §10 — Implementation sequencing

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

### §11 — Wiring status: SHIPPED 2026-05-30 (§10 restructure live in production); historical dormant-state detail preserved below

**Current status (2026-05-30):** **SHIPPED.** C.53 §10 Phase 3 restructure is live on `main` and deployed to production (`co-ops-ashy.vercel.app`). The d49d1504 stuck-shift class is **closed in the real UI** — confirmed by FT.1 operational smoke against the live `d49d1504` EM instance (see §11.1 below). The dormant-state detail that follows the §11.1 block is preserved as the accurate 2026-05-26 record (forensic history; do not delete).

**Historical status (2026-05-26):** wired and dormant. The no-prior-data Phase 1 path is fully wired end-to-end at the RPC + lib + route + form-orchestrator layers, but **operationally inert in the real UI** until C.53 §10 Phase 3 ("Phase 1 component restructure — spot-check absorbed") ships.

**What landed in the wiring commit (Build #3 PR 4 — 2026-05-26):**

- Migration `0055_create_submit_phase1_atomic_rpc` (applied prior session) — the Phase 1 atomic RPC implementing all 10 lock-v2 responsibilities + §9 chain-edit named verification gate + C.54 NULL-source provenance + per-instance attestation + Pattern A single notification dispatch
- `lib/opening.ts` — `submitPhase1Atomic` body fully wired (was a throw stub); per-phase error class additions (`OpeningGroundTruthUnresolvedError`, `OpeningActorNotFoundError`); message-discriminated P0001 + 23503 mapping with explicit coupling comments
- `app/api/opening/submit/phase1/route.ts` (new) — Phase 1 route with homogeneous-payload validator + attestation field + dispatch to `submitPhase1Atomic`
- `app/api/opening/submit/route.ts` — Piece 4 defensive branch (legacy route): detects `phase1_complete` instance state and returns 200 with `code: 'phase2_pending_next_release'` discriminator instead of the bare check_violation error
- `app/(authed)/operations/opening/opening-client.tsx` — `handleSubmit` split into `handlePhase1Submit` (POST `/phase1`) + `handlePhase2Submit` (POST legacy `/submit`); phase-aware submit button + gate hint; `needsAttestation` derived state + inline attestation prompt UI using Aggie's shipped `opening.phase1.attestation.*` strings; 5xx fallback to `opening.error.fallback`; Piece 4 graceful-response discriminator handling
- `components/opening/OpeningVerificationStation.tsx` + `components/opening/OpeningChecklistItem.tsx` — `closerSnapshotsMap` threaded through; tri-state `closerCount` prop (undefined/null/number) drives the inline spot-check recount section render
- `lib/i18n/{en,es}.json` — Aggie's parallel-lane strings for the 3 error codes + attestation prompt + phase2_pending_next_release notification + opening_no_prior_data alert

**What is NOT yet active (operational gap):**

The form's `phase1Items` set is still the legacy classification (station ticks + temp readings). C.53's §10 Phase 3 ("Phase 1 component restructure — spot-check absorbed") would move the C.53 spot-check items (currently in `phase2Items`, identified by `prep_meta.openingPhase2=true`) into `phase1Items`. Until that restructure ships:

- `needsAttestation` iterates `phase1Items` looking for items with `closerSnapshotsMap.has(id) && snapshot.closerCount === null && openerRecount !== null` — **returns 0** because spot-check items aren't in `phase1Items` yet
- The inline attestation prompt renders conditionally on `needsAttestation` — **never visible** to the opener today
- The inline spot-check recount section in `OpeningChecklistItem` renders conditionally on `closerSnapshotsMap.get(item.id) !== undefined` — **never visible** in the Phase 1 tab today (spot-check items appear in the Phase 2 tab via the existing `OpeningPrepEntry` component)
- The `/phase1` route receives only ticks + temps + photos + notes — RPC processes them via the non-spot-check branch (count_provenance stays NULL, no notification, no attestation)

**Activation criterion:** once `phase1Items` contains the spot-check items (post-§10-Phase-3), all wiring fires correctly. The SQL-level integration check in Build #3 PR 4 (three flows — no-prior-data, normal, Piece 4 — all passed against the applied 0055 RPC) proved the RPC + lib + route are correct end-to-end at the data layer.

**Operational consequence:** the d49d1504 stuck-shift class (C.54 §8 captured artifact) is **NOT yet closed in the real UI** despite this commit. The RPC can unblock the instance when called directly (proven in the integration check), but the form cannot drive that call until spot-check items move into the Phase 1 tab's submit payload. d49d1504 itself remains preserved in `open` state per C.54 §8's "do not touch" directive.

**What it would take to close the gap:** C.53 §10 Phase 3 — estimated ~500 LOC per the original sequencing table — which restructures the form to put spot-check items in the Phase 1 tab (with section-verify CTAs + recount affordance) and removes the spot-check half of `OpeningPrepEntry`. After that ships, the no-prior-data path becomes live end-to-end through the UI; no additional wiring is needed at the RPC/lib/route layers.

### §11.1 — Activation: §10 restructure shipped 2026-05-30 (stuck-shift class closed in production)

**Shipped commits (origin/main):**

- `899061f` — Lane A: absorb spot-check items into Phase 1 (T0.1 phase split, T0.3 tick-gate scoping, T0.4 `spotCheckResolved` gate, T0.5 hide empty Phase 2 tab) + build doc `docs/coops_C53-C54_phase3_builddoc_B-to-A_v1.md`
- `42562d3` — Lane B: section-verify header for spot-check stations (`OpeningVerificationStation` render-by-content branch + flag B `sectionHasUnrecountedNull` port + C.38 `prep_meta.section` keying + flag A `sectionVerifications` init repoint)

**Deploy:** CI `build` GREEN on `42562d3`; Vercel production deploy `success` (`HR4htkRa5VBtfCkfaVhhNgXujc9B`). Live on `co-ops-ashy.vercel.app`.

**FT.1 operational smoke (Juan, against the real `d49d1504` EM instance) — PASSED:**

- No-prior-data opener flowed through the new `/phase1` path (not the legacy `/submit` path)
- Attestation/recount path rendered and resolved (the §11 dormant items — `needsAttestation`, the inline attestation prompt, the spot-check recount section — are now **live** because spot-check items are in `phase1Items` post-restructure)
- Submit succeeded; surfaced the `phase2_pending_next_release` message — the Piece 4 guardrail behaving correctly (honest seam; Phase 2 submit is the next loop, not a defect)

**Build-state:** C.53 §10 is **done**. The d49d1504 stuck-shift class is **closed in the UI** (RPC + lib + route + form all live end-to-end). **Next loop:** the Phase 2 submit RPC (the `phase2_pending_next_release` seam is the entry point — Phase 2 prep submit is the remaining surface). `d49d1504` itself stays preserved in `open` state per C.54 §8's "do not touch" directive — the *class* is closed for new shifts; the captured artifact is not retroactively mutated.

**Deferred follow-up (queued, Flash):** FT.2 — i18n re-namespace of the `opening.phase2.*` keys still used in Phase 1 chrome (`OpeningSectionVerify` reads `opening.phase2.section_verify_cta` / `section_verified_button` / `section_disabled_null_items` and the recount label `opening.phase2.recount_label`) → `opening.section_verify.*` / `opening.recount.*`. Pure rename across `lib/i18n/{en,es}.json` + callsites; no behavior change. Not blocking.

---

## C.54 — Opening submit must not be gated by prior-closing existence; missing-closing becomes a routed signal, not a wall

**Date added:** 2026-05-25
**Status:** Authored (locked); implementation rides C.53
**Supersedes:** C.42's auto-complete semantic on the opening submit path only — the closing-side auto-complete behavior when a closing DOES exist is unchanged
**Triggered by:** NULL-SENTINEL smoke at EM, 2026-05-25 — opener completed full opening (Phase 1 verification + 34 Phase 2 at-par recounts via the C.50 NULL-sentinel path) and was hard-blocked at submit by `submit_opening_atomic`'s auto-complete step when no closing instance existed at `(location, opening_date − 1 day)`. The opener's complete, correct work was discarded by the RPC's transaction rollback. The blocked attempt is preserved as instance `d49d1504-da82-48fd-bf08-05abcb3f87d1` (see §8 below).
**Scope:** opening submit RPC's auto-complete branch; opener-facing attestation surface; routed missing-closing notification; per-completion provenance marker
**Out of scope:** strict-yesterday snapshot resolver semantic (held as Task #6 / separate amendment — C.54 is correct regardless of its resolution); planned-closure calendar modeling (not first-class state in CO-OPS); C.50's NULL-sentinel Phase 2 form path (unchanged — recount source, NULL badges, recount/opener_prepped/reason gates all preserved)
**Build:** Wave 2 Build #1 (Opening Report) — **rides C.53's three-phase restructure** (verification → prep → setup). C.53 rebuilds the exact submit surface C.54 modifies; C.54 cannot ship independently of C.53 without re-touching the same RPC twice.
**Lock state:** Operational reasoning (§1), three coupled decisions A/B/C (§2), and locked sub-decisions (§3) all locked 2026-05-25 in conversation. Open implementation question on provenance marker physical shape (§4) — pre-build call against live schema at C.53 build time.

### §1 — The contradiction (what spec said, what built reality enforced, why it breaks)

**What spec said:**

C.50 redesigned Phase 2 to *invite* operation when prior-night data is absent. When the closer-count snapshot is NULL for an item, the opener establishes ground truth via per-item recount; the snapshot row's NULL-reason badge surfaces this as `no_am_prep` (or `first_day` / `item_not_linked`). The form is fully designed to lead the opener through this path. The model recognizes "no prior data" as a valid operational state for which the recount IS the new source of truth.

C.42 (operational reports architecture) introduced auto-complete: when a downstream report (the opening) submits, it automatically marks the upstream report's cross-reference item complete. For the opening → closing link, this means the opening's submit marks yesterday's closing's "Opening verified" report-ref item as complete. The intent was a courtesy bookkeeping action — close the loop on yesterday's closing so its dashboard tile doesn't show a perpetually-incomplete cross-reference.

**What built reality enforced:**

`submit_opening_atomic` (migration 0053, line 539–584; logic preserved from migration 0050 — "Logic preserved from 0050 — no C.50 changes here") executes the auto-complete inside the submit transaction. The `closing_ix` CTE looks up a closing instance at `(location_id = opening's location, date = opening's date − 1 day)`. If the CTE returns zero rows, the RPC raises sqlstate 23503 (foreign_key_violation) with `v_auto_complete_id IS NULL` — and the entire transaction rolls back. The opener's submission row, all 34 Phase 2 completions, the Phase 1 completions, and the instance status transition (`open → confirmed`) are all discarded.

**Why this breaks:**

A secondary bookkeeping action (cross-report courtesy link) was gating a primary operational action (the opener's submit). That inversion is the defect. The opener is never the actor who failed to close yesterday; blocking their correct work because someone else's prior-night accountability is missing is wrong under every interpretation. The form said "go" (C.50's NULL-sentinel path was designed and operational); the RPC said "no" (C.42's auto-complete carried forward unexamined). The two designs make incompatible assumptions about whether absence of prior-day data is a valid state.

**Operational reality (per operator):** a missing prior-day closing is *most commonly a forgotten closing*, not a planned closure. So:

- The common case is an **accountability event**, not a routine state. The system should surface it to the role that owns the discipline problem.
- The opener's recount under NULL-source is a **morning reconstruction** of last-night's reality, not a capture of it. The two are operationally distinct and the provenance must be permanently distinguishable in the data — a reconstructed count cannot be mistaken for a closing-captured count when read later (audit, dashboard, forecast input).

### §2 — Resolution — three coupled decisions

#### A. Decouple auto-complete failure from submit failure

Opening submit commits on its own merits. Auto-completing yesterday's closing "Opening verified" item is **best-effort**, not blocking.

- Closing exists at `(location, opening_date − 1 day)` → auto-complete proceeds as today (unchanged from C.42 / 0053 logic).
- No closing exists → auto-complete is a **no-op**. Does not raise. Does not roll back. Opening submit commits cleanly.

The auto-complete branch in `submit_opening_atomic` (today's lines 539–584 in migration 0053) drops the `RAISE EXCEPTION ... ERRCODE = 'foreign_key_violation'` on `v_auto_complete_id IS NULL`. The branch becomes: "if a closing exists at N-1, insert the auto-complete row and supersede the prior live row; otherwise, do nothing." The transaction proceeds to commit either way.

`OpeningAutoCompleteError` and the `auto_complete_failed` HTTP 422 error code (lib/opening.ts + app/api/opening/_helpers.ts) are removed from the submit error surface. If a future submit-RPC failure mode needs an explicit error code, it gets a new one — not this one.

#### Governing predicate for B and C: NULL ground-truth source, not closing-row existence

The predicate for engaging §B (notification) and §C (attestation) keys on **"did this opening reconstruct ground truth from a NULL source?"** — not on "did a closing row exist at N-1?"

This covers three operational flavors uniformly:

1. **No closing row at all** at `(location, N-1)` — the EM 2026-05-25 case (16-day operational gap; §A's block does not fire here under the new design; opener backfilled from NULL via recount; §B and §C engage).
2. **Closing row exists but auto-finalized empty** — the EM 2026-05-09 case (closing row was system-auto-finalized with zero completions; §A's block never fires regardless because the closing row IS findable; but opener still backfills from NULL via recount because the snapshot's `closer_count` is NULL; §B and §C still engage).
3. **Any opening item with no usable count from its source** — generalized to cover future failure modes where the source row exists but doesn't carry a usable value (data corruption, schema migration gap, integration outage).

The question §B and §C answer is always **"captured at close, or reconstructed this morning?"** — not "what was the upstream row state?"

Operationally: the predicate fires when any opening Phase 2 completion lands with the provenance marker (§4) set to "reconstructed_morning" — i.e., `opener_recount IS NOT NULL` AND the corresponding snapshot's `closer_count IS NULL` at instance create time. Server-side derivation; client need not compute.

#### B. Missing-closing emits a routed MoO+ signal (primary mechanism)

On submit where any Phase 2 completion has provenance = "reconstructed_morning": dispatch one notification per opening submission (not per item — the per-item granularity already lives in the completion rows for forensic readback) to MoO+ per C.48 routing rules.

Notification copy (English source-of-truth, translate-from-day-one per AGENTS.md C.37):

> **[Location] opening [date] submitted with no usable closing data for [date − 1].**
> Opener-reported cause: [planned closure | missed/unknown].
> Counts established by morning recount, not captured at close.

This:

- Routes the planned-vs-forgotten judgment to the role that owns the discipline problem (MoO+). The system does not try to infer whether the closing was forgotten — the opener attests (§C), and the human reviewing the notification weighs the attestation against operational context (schedule, holidays, known closures).
- Turns recurring forgotten-closings into trackable data. The notification volume itself is a leading indicator of closing-discipline drift.
- Does not block any actor. The opener proceeds; the closer (if reachable) can be addressed independently by MoO+ in the normal course.

Notification action: `opening.submitted_with_no_prior_closing_data` (sibling to existing `opening.submit` actions; namespace-consistent with the auth_* / time_clock.* / closing.* conventions).

Recipients per C.48: MoO + Owner + KH+ at this location, DISTINCT. Priority: `urgent` (matches the urgent dispatch precedent C.50 set for under-prep notifications — accountability events warrant the same operational salience).

#### C. Opener attestation captures cause + provenance at submit

On NULL-source detection (any opening Phase 2 item lands with `opener_recount` populated under NULL `closer_count`), the form requires a single attestation step before submit commits:

> **No usable closing data for [date − 1].**
> Reason:
> ▢ Location was closed (planned)
> ▢ Closing was missed / I don't know

Two-tap binary-with-unknown. No free text. No directed-by. No reason category enum.

Persists on the submission/instance record (exact column shape deferred to §4) and rides into the §B notification payload as `opener_reported_cause: 'planned_closure' | 'missed_or_unknown'`. The MoO+ recipient sees the attestation in the notification copy.

**Per-completion provenance marker:** every Phase 2 completion whose `ground_truth_count` derives from `opener_recount` under NULL `closer_count` carries a provenance marker permanently distinguishing morning-reconstructed counts from closing-captured counts. Physical shape deferred to §4 (column vs JSONB value vs `spot_check_status` enum extension). Intent: any future read of this completion (audit, dashboard, AI forecast input, etc.) can answer the "captured-at-close vs reconstructed-this-morning" question without joining back to the snapshot row.

### §3 — Locked sub-decisions

1. **Predicate is NULL-source, not row-existence.** §B and §C engage on `any completion.provenance = 'reconstructed_morning'`, not on `closing row missing at N-1`. The latter is one of several upstream causes; the former is the operational reality being signaled. (Locks the "governing predicate" header above.)
2. **Attestation is binary-with-unknown, two taps no free-text.** Forcing free-text on every NULL-source submit would create friction without proportional signal. The two-bucket categorization (planned vs missed/unknown) gives the MoO+ reviewer enough to triage; if more detail is needed, the conversation happens person-to-person, not via free-text in the form.
3. **Manager flag fires on BOTH planned and missed/unknown, labeled differently.** A planned closure with no system record is still worth a manager knowing — planned closures aren't modeled as first-class state in CO-OPS, so the system cannot independently confirm the "planned" claim. The missed/unknown case is higher-priority (and labeled as such in the notification copy), but planned-closure also dispatches. If the volume of planned-closure notifications becomes operationally noisy, the resolution is modeling planned closures as first-class state (a separate amendment), not silencing the signal.
4. **Auto-complete remains in the same RPC, just no longer blocking.** The auto-complete logic stays inside `submit_opening_atomic` (or its C.53 successor `submit_phase2_atomic`) — it's tightly coupled to the opening commit transaction. The change is purely behavioral (no raise on NULL) not structural (still happens at the same step).
5. **No retroactive backfill.** Existing opening completions that landed before C.54 ships have no provenance marker; reads must tolerate NULL/missing. Forward-only — the marker is set at submit time for new completions, not patched onto historical ones. (Append-only philosophy: historical rows reflect what was true at submit time per their then-current schema; C.54 doesn't rewrite history.)

### §4 — Open implementation question for C.53 pre-build

**Provenance marker physical shape.** Three candidates, all viable; the call is a pre-build judgment against live schema state at C.53 build time:

- **(i) New column on `checklist_completions`** — e.g., `count_provenance TEXT CHECK (count_provenance IN ('closer_captured', 'reconstructed_morning'))`. Clean schema, queryable directly, no JSONB drift risk. Cost: new migration, RLS policy review.
- **(ii) Extend `spot_check_status` enum.** Today's values per C.50 §2 are `matched_via_section_verify` | `flagged_recount`. Could add `flagged_recount_null_source` (or rename to a 3-value enum). Pro: reuses existing field that already discriminates ground-truth derivation paths. Con: conflates two orthogonal axes (spot-check vs recount, AND captured vs reconstructed) into one column.
- **(iii) `prep_data` JSONB value.** Add `prep_data.phase2.provenance: 'closer_captured' | 'reconstructed_morning'` alongside existing C.50 §2 fields. Pro: zero migration. Con: JSONB-buried; queries need `prep_data->>'phase2'->>'provenance'`; reads from dashboard/forecast paths pay the JSONB-extract cost.

**Recommendation for the pre-build:** option (i) — dedicated column — under the assumption C.53 migrations are already non-trivial (three-phase restructure touches schema regardless) so the marginal cost of one more column is small, and the read-path cost of JSONB-buried provenance compounds across every consumer (audit, dashboard, forecast). But the call is for C.53's pre-build response against the actual migration shape proposed there. Locked here: the marker exists, distinguishes the two states, and is set at submit time. Where the bits live is the implementation choice.

**Opener attestation column shape** — same trichotomy, lower stakes (one value per opening submission, not per completion). Most natural shape: column on `checklist_instances` (e.g., `opener_no_prior_data_reason TEXT CHECK (... IN ('planned_closure', 'missed_or_unknown', NULL))`) since the attestation is instance-scoped, not item-scoped. NULL when no NULL-source detected; populated only when the attestation prompt fired.

### §5 — What stays unchanged from C.50 / C.42

- **C.50 NULL-sentinel form path** — recount source, NULL badges (`no_am_prep` / `first_day` / `item_not_linked`), per-section disabled VERIFY when items have NULL-source-without-recount, per-item recount as ground-truth derivation, opener_prepped numeric capture, reason capture on delta. All preserved.
- **C.42 auto-complete behavior when closing DOES exist** — `closing_ix` CTE finds the closing, insert + supersede proceeds, audit trail unchanged. C.54 only removes the downstream submit-RPC block; the success path is identical.
- **C.50 §8.4 invariant enforcement** — `ground_truth_count` derivation, `prep_need = MAX(0, par − ground_truth)`, `delta_vs_prep_need` computation, over/under signal banners, N-per-item under-prep notification dispatch. All preserved.
- **Closing report's submit behavior** — unchanged. C.54 is opening-side only.

### §6 — Dependency flag — C.53 must have C.54 on the table from its first pre-build response

C.53 (three-phase opening restructure: verification → prep → setup) rebuilds the exact submit surface C.54 modifies. C.54's requirements are **inputs to C.53's design**, not a bolt-on after:

- The opener attestation surface (§2.C) must live somewhere in the three-phase flow. C.53's pre-build must place it. Candidates: end of Phase 3 (setup) right before commit; or surfaced at Phase 1 (verification) when NULL-source is first detected and the opener begins recounting. Either is defensible; C.53 picks.
- The provenance marker (§4) must be in the data model C.53 writes. C.53's migrations are the natural home for the column add (option i) or the schema extension (option ii).
- The decoupled auto-complete (§2.A) is part of the submit RPC C.53 rebuilds (`submit_phase2_atomic` per C.53 §6). The RPC author must drop the raise, not preserve it from the 0053 ancestor.
- The §B routed notification dispatch is part of the same RPC's notification block (sibling to C.50's under-prep dispatch).

**If C.53 is designed without C.54 in front of it, the restructure gets built and then reopened.** State this dependency prominently wherever C.53's kickoff context lives — `docs/STEP_12_13_HANDOFF.md` §C.53 entry, the C.53 entry in this file once C.51–C.53 reconcile in, and any handoff doc Step 15 produces for the C.53 build session. A fresh session must not be able to design C.53 blind to C.54.

**Step 15 reconcile owes:** a "Depends on C.54" line at the top of C.53's amendment text in `docs/STEP_12_13_HANDOFF.md`, paired with the cross-references in §7 below.

### §7 — Cross-references

- **Task #6 (held)** — strict-yesterday snapshot resolver semantic (C.50 §2 source lookup keys on `today − 1` strictly; routine operational states routinely violate "yesterday always has data"). Sibling angle on the same gap C.54 closes. C.54 is correct regardless of how Task #6 resolves; resolving Task #6 (e.g., to "most-recent within N days" semantics) would reduce — but not eliminate — the frequency at which C.54's NULL-source path engages, since N-day windows still have boundary cases.
- **Task #7 (held — superseded by this amendment)** — first capture of the auto-complete-vs-NULL-SENTINEL contradiction. Task #7 stays in the candidate-findings hold as the historical trace of how the find surfaced; C.54 is its resolution.
- **C.42** — operational reports architecture / auto-complete mechanic. Partially superseded: closing-side behavior unchanged, opening-side submit-block removed.
- **C.50** — Phase 2 calculation logic redesign + NULL-sentinel UI. Unchanged. C.54 removes the downstream block that contradicted it.
- **C.51 (deferred stub)** — Phase 1A/1B split moved into C.53.
- **C.52** — Phase 2 collaborative real-time prep. Independent. The §A decoupling and §B/C signaling apply regardless of single-actor vs collaborative submit.
- **C.53** — three-phase opening restructure (verification → prep → setup). **Hard dependency.** C.54 ships inside C.53's build.

### §8 — Captured artifact (do not finalize, do not delete)

The blocked submit attempt is preserved as forensic evidence of the contradiction:

- **Opening instance:** `d49d1504-da82-48fd-bf08-05abcb3f87d1` at EM (P Street) dated 2026-05-25, status `open`.
- **Snapshots:** 34 rows in `opening_closer_count_snapshots` for this instance, all `closer_count IS NULL`, all `closing_instance_id IS NULL` (yesterday's closing didn't exist; AM Prep on yesterday didn't exist; both NULL-source paths active).
- **Completions:** zero. The RPC rolled them back when the auto-complete RAISE fired.
- **Submission row:** none. Same reason.
- **Audit chain:**
  - `2026-05-25 20:37:00Z` `checklist_instance.create` (today's opening instance created on form load)
  - `2026-05-25 20:37:00Z` `opening.snapshot_materialize` (34 snapshots, all `with_closer_count: 0`, all `without_closer_count: 34`)
  - `2026-05-25 20:44:48Z` `opening.submit` `outcome: auto_complete_failed` `rpc_error: submit_opening_atomic: no closing instance found at date N-1...`

This instance demonstrates the contradiction live in production. Leaving it in `open` state preserves the evidence for the C.53 pre-build conversation and any subsequent review. **Do not finalize, confirm, delete, or re-attempt submit on this instance** until C.54's implementation lands. If operational tempo requires opening to actually submit at EM before C.54 ships, create a new instance at a different date or coordinate via manual finalize through an admin path — do not touch `d49d1504`.

### §9 — Meta-lesson candidate for AGENTS.md (Step 15 wrap)

A fresh instance of the meta-pattern already partially captured in AGENTS.md:

> **Preserved-from-prior logic must be re-verified against any amendment that changes the operational assumptions it depended on.**

The 0053 RPC's auto-complete branch carried a comment "Logic preserved from 0050 — no C.50 changes here." That comment was true at the literal level (no logic changed) but wrong at the architectural level (C.50's NULL-sentinel redesign changed the operational reality the auto-complete logic was built against). The preserved logic should have been re-examined against C.50's new "absence of prior data is valid" assumption; it wasn't, and the contradiction shipped.

This is a sharper sibling to the existing AGENTS.md lesson about checking existing patterns before designing net-new — the failure mode is symmetric: net-new design needs to know the prior patterns; net-new amendments need to know what they invalidate in the preserved patterns.

Step 15 should author this into AGENTS.md alongside the other Build #3 PR 3 durable lessons. The phrasing above is a draft; the Step 15 wrap can tighten.

### v1.3 action checklist

- Drop `RAISE EXCEPTION` on `v_auto_complete_id IS NULL` from `submit_opening_atomic` (or its C.53 successor `submit_phase2_atomic`); make the auto-complete branch a no-op when CTE returns zero rows
- Remove `OpeningAutoCompleteError` class from `lib/opening.ts` and the `auto_complete_failed` mapping from `app/api/opening/_helpers.ts`
- Remove `opening.error.auto_complete_failed` translation keys from `lib/i18n/en.json` + `lib/i18n/es.json`
- Add `count_provenance` column (or equivalent per §4) to `checklist_completions` schema in §4.X; populate at submit time when `opener_recount IS NOT NULL` AND snapshot `closer_count IS NULL` → `'reconstructed_morning'`; otherwise `'closer_captured'`
- Add `opener_no_prior_data_reason` column (or equivalent per §4) to `checklist_instances`; populate at submit time when attestation fires
- Add notification action `opening.submitted_with_no_prior_closing_data` to the audit/notification namespace
- Add notification recipient routing per C.48 (MoO + Owner + KH+ at location, DISTINCT, priority urgent)
- Add opener attestation modal/inline-prompt to the C.53 submit surface (placement is a C.53 pre-build call)
- Update DESTRUCTIVE_ACTIONS registry if `opening.submitted_with_no_prior_closing_data` qualifies (likely no — it's a forward signal, not a destructive event)
- Add cross-reference link from C.53 entry (once C.51–C.53 reconcile into this file) pointing to C.54 as a hard dependency
- Update `docs/STEP_12_13_HANDOFF.md` §C.53 entry with a "Depends on C.54" header
- Update §16 build sequencing: C.54 ships inside the C.53 build, not as a separate cycle

Captured during NULL-SENTINEL smoke at EM, 2026-05-25. Architecture locked (§1–§3) and open implementation question (§4) recorded before C.53 pre-build opens.

---

## How to add an entry

1. Pick the next monotonic ID (`C.<n>` — current next: C.55).
2. Spec sections under amendment.
3. Quote what spec says.
4. Document what built reality is.
5. Why the divergence is correct (operational reasoning, not just "we changed our mind").
6. What v1.3 should do — concrete action so the spec can be reconciled mechanically.

Date entries to whatever calendar the project is on (currently 2026-05-25).

This file is consumed by future spec versions. Its purpose is to make spec drift cheap to reconcile, not to legitimize ad-hoc deviations. Every entry should pass the test "would I tell Pete or Cristian this is the right way to do it?" before it lands here.

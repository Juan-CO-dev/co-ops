# Spec #2b — Catering Intake & Attribution (design)

**Date:** 2026-07-23 · **Approved:** Juan (design presented remotely, "run it"; HOLD at CI-green PR — merge + 0148 prod apply on his go)
**Origin:** Juan's adds to the Toast sales-ingest arc: outside-platform catering (EZCater, direct invoices, phone) gets PUNCHED IN by the catering team and labeled by source; each order gets an individually assigned team member; platform APIs auto-ingest later. Assignment model (his call): **attribution + filter, edits open but LOGGED** — only the "order lead" should edit since they're the client's contact person, so any non-assignee edit is flagged in the audit trail rather than blocked.

## Scope

1. **Migration 0148 (staged):** `catering_pipeline.assigned_to uuid → users(id)`, nullable.
2. **Source registry** — `lib/catering/intake-shared.ts` (pure, client-safe): `portal · staff · phone · walk_in · toast_catering · ezcater · direct_invoice · other`; `isLeadSource`; i18n via `catering.intake.source.<code>` (system-key rule). Legacy free-text rows render verbatim; NEW writes validate against the registry app-layer (no DB CHECK — additive).
3. **Pipeline lib** (`lib/catering/pipeline.ts`): `assigned_to` through LEAD_COLS/row/view/inputs; `createLead`/`editLead` validate leadSource (registry) + assignedTo (active user, level ≥3, typed 400 otherwise); `editLead` audit metadata gains `non_assignee_edit: true` when actor ≠ assigned_to (and assigned) + `assigned_to_changed` when reassigned; new `loadAssignableStaff(actor)` (active users level ≥3: id/name/role) powering pickers and client-side name display.
4. **Routes:** existing create/edit routes pass `assignedTo` through their whitelists (UUID-validated); no new routes.
5. **UI** (`PipelineClient.tsx` + page): add-lead form's free-text source Field → registry SELECT + assignee SELECT (staff prop); lead cards show translated source chip + assignee name chip; board-level filters (by assignee, by source); edit path = existing PATCH (assignedTo joins the editable set at the existing ≥6 write floor — reassignment included, audited).
6. **Platform seam** — `lib/catering/intake-providers.ts` (server-only stub, `not_configured`, EZCater first): the punch-in flow it will one day automate ships NOW as the manual path, closing spec #2's named visibility gap (an EZCater order punched in flows through W4a reserve like any lead).
7. i18n en+es for all new strings; tests pin the registry + validator + legacy-verbatim rule.

**OUT:** platform API implementations (dormant seam only) · per-lead detail page (still the known deferred item from ③) · any permission gating on edits (explicitly rejected by Juan) · workload/performance views (future reader of `assigned_to` + the audit trail).

**Done criteria:** typecheck/tests/build green; add-lead punch-in with source+assignee works end-to-end locally; non-assignee edit provably flagged in audit metadata; 0148 staged only. HOLD at CI-green PR.

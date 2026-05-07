// lib/checklist-rows.ts
//
// Shared snake_case row shapes + column constants + row-mapper helpers
// for the checklist_instances and checklist_completions tables.
//
// Build #3 cleanup PR (2026-05-06) lifted these from four parallel sites
// (lib/checklists.ts, lib/prep.ts, lib/opening.ts, app/(authed)/operations/
// closing/page.tsx). Each site previously declared its own INSTANCE_COLUMNS,
// InstanceRow, rowToInstance, COMPLETION_COLUMNS, CompletionRow, and
// rowToCompletion. The constants and InstanceRow shape were byte-identical;
// rowToCompletion had three sites with byte-identical pass-through and one
// (lib/opening.ts) that hardcoded prepData/autoCompleteMeta to null. Per
// the bucket #3 surface decision (Option 1, canonical pass-through), the
// hardcoded-null pattern is dropped: opening completions now surface
// whatever the DB returned for those columns, matching the discipline of
// the other three consumer sites.
//
// FORWARD NOTE — TemplateItemRow projection asymmetry:
// lib/checklists.ts uses a 7-field TemplateItemRow shape (id, template_id,
// min_role_level, required, expects_count, expects_photo, active);
// lib/prep.ts + lib/opening.ts use a 15-field shape (adds station,
// display_order, label, description, vendor_item_id, translations,
// prep_meta, report_reference_type). The 7-field shape is intentional —
// authorization helpers don't need the display-bearing fields. Lift in a
// follow-up cleanup once a name for the projection is agreed
// (TemplateItemRowMinimal vs TemplateItemRow); not in scope for the
// Build #3 cleanup PR.
//
// FORWARD NOTE — prep_data / auto_complete_meta scoping:
// Currently no DB-layer constraint enforces which template types can have
// non-null prep_data or auto_complete_meta. Build #3 PR 2 surfaced that
// lib/opening.ts had a JS-side hardcoded-null assumption (removed in this
// cleanup PR consolidation; canonical pass-through pattern applied).
// If "opening completions never have prep_data" becomes a load-bearing
// invariant (vs. an aspirational claim), enforce at DB layer via CHECK
// constraint scoped by template type, not via JS-side mapper. Capture
// remains here as a forward note pending concrete need.

import type {
  AutoCompleteMeta,
  ChecklistCompletion,
  ChecklistInstance,
  PrepData,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// checklist_instances
// ─────────────────────────────────────────────────────────────────────────────

/** Column list for SELECTs against checklist_instances — single source of truth. */
export const INSTANCE_COLUMNS =
  "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at, triggered_by_user_id, triggered_at, finalized_at_actor_type, assigned_to, assignment_locked, dropped_at, dropped_by, dropped_reason";

export interface InstanceRow {
  id: string;
  template_id: string;
  location_id: string;
  date: string;
  shift_start_at: string | null;
  status: ChecklistInstance["status"];
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  // Build #2 (per SPEC_AMENDMENTS.md C.18 + C.43; migration 0038).
  triggered_by_user_id: string | null;
  triggered_at: string | null;
  // Build #3 PR 1 — finalize discriminator + assignment/drop tracking
  // (migration 0046).
  finalized_at_actor_type: ChecklistInstance["finalizedAtActorType"];
  assigned_to: string | null;
  assignment_locked: boolean;
  dropped_at: string | null;
  dropped_by: string | null;
  dropped_reason: string | null;
}

export function rowToInstance(r: InstanceRow): ChecklistInstance {
  return {
    id: r.id,
    templateId: r.template_id,
    locationId: r.location_id,
    date: r.date,
    shiftStartAt: r.shift_start_at,
    status: r.status,
    confirmedAt: r.confirmed_at,
    confirmedBy: r.confirmed_by,
    createdAt: r.created_at,
    triggeredByUserId: r.triggered_by_user_id,
    triggeredAt: r.triggered_at,
    finalizedAtActorType: r.finalized_at_actor_type,
    assignedTo: r.assigned_to,
    assignmentLocked: r.assignment_locked,
    droppedAt: r.dropped_at,
    droppedBy: r.dropped_by,
    droppedReason: r.dropped_reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// checklist_completions
// ─────────────────────────────────────────────────────────────────────────────

/** Column list for SELECTs against checklist_completions — single source of truth. */
export const COMPLETION_COLUMNS =
  "id, instance_id, template_item_id, completed_by, completed_at, count_value, photo_id, notes, superseded_at, superseded_by, revoked_at, revoked_by, revocation_reason, revocation_note, actual_completer_id, actual_completer_tagged_at, actual_completer_tagged_by, prep_data, auto_complete_meta, original_completion_id, edit_count";

export interface CompletionRow {
  id: string;
  instance_id: string;
  template_item_id: string;
  completed_by: string;
  completed_at: string;
  // Postgres numeric → JS string|number depending on driver path; mapper
  // normalizes to number|null.
  count_value: string | number | null;
  photo_id: string | null;
  notes: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  // Revoke / tag fields per SPEC_AMENDMENTS.md C.28.
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: ChecklistCompletion["revocationReason"];
  revocation_note: string | null;
  actual_completer_id: string | null;
  actual_completer_tagged_at: string | null;
  actual_completer_tagged_by: string | null;
  // Build #2 (per SPEC_AMENDMENTS.md C.18 + C.44; migration 0037). Mapper
  // pass-through; consumers that need narrowing (lib/prep.ts isPrepData())
  // narrow at the call site.
  prep_data: unknown | null;
  // Build #2 (per SPEC_AMENDMENTS.md C.42; migration 0040). Structured
  // attribution for auto-complete completions. Populated on closing's
  // report-reference items when their source report submits; NULL on
  // user-tap completions.
  auto_complete_meta: unknown | null;
  // Build #2 PR 3 (per SPEC_AMENDMENTS.md C.46; migration 0042). Chain
  // link FK + edit position. NULL/0 on chain head (original); FK/1-3 on
  // updates.
  original_completion_id: string | null;
  edit_count: number;
}

export function rowToCompletion(r: CompletionRow): ChecklistCompletion {
  return {
    id: r.id,
    instanceId: r.instance_id,
    templateItemId: r.template_item_id,
    completedBy: r.completed_by,
    completedAt: r.completed_at,
    countValue: r.count_value === null ? null : Number(r.count_value),
    photoId: r.photo_id,
    notes: r.notes,
    supersededAt: r.superseded_at,
    supersededBy: r.superseded_by,
    revokedAt: r.revoked_at,
    revokedBy: r.revoked_by,
    revocationReason: r.revocation_reason,
    revocationNote: r.revocation_note,
    actualCompleterId: r.actual_completer_id,
    actualCompleterTaggedAt: r.actual_completer_tagged_at,
    actualCompleterTaggedBy: r.actual_completer_tagged_by,
    // Canonical pass-through. lib/opening.ts previously hardcoded null
    // here; opening now surfaces DB state faithfully (Option 1 lift).
    prepData: (r.prep_data ?? null) as PrepData | null,
    autoCompleteMeta: (r.auto_complete_meta ?? null) as AutoCompleteMeta | null,
    originalCompletionId: r.original_completion_id,
    editCount: r.edit_count,
  };
}

/**
 * Checklist instance lifecycle — Phase 3 / Module #1 Build #1.
 *
 * Five exported functions for the cleaning-phase Closing Checklist (and, by
 * symmetry, future Opening / Prep instances):
 *
 *   - getOrCreateInstance — idempotent per (template_id, location_id, date)
 *   - completeItem        — append-only with prior-completion supersession
 *   - submitBatch         — non-final submission event over a set of completions
 *   - confirmInstance     — PIN-attestation, status transition, reasons capture
 *   - rejectIfPrepLocked  — guard for single_submission_only templates
 *
 * Client model: callers pass an authed SupabaseClient (constructed from the
 * session JWT via lib/supabase-server.ts createAuthedClient). Authed-client
 * writes are RLS-checked end-to-end. Service-role writes happen ONLY for
 * (a) audit_log inserts (RLS denies direct user writes) and (b) the prior-
 * completion supersession UPDATE on checklist_completions (RLS denies UPDATE
 * for everyone via checklist_completions_no_user_update; service-role
 * bypasses).
 *
 * Audit vocabulary (locked, used consistently here and in /api/checklist/*):
 *   - checklist_instance.create
 *   - checklist_completion.create
 *   - checklist_completion.supersede_failure
 *   - checklist_submission.create
 *   - checklist.confirm                         (with metadata.outcome
 *     ∈ {'success', 'role_insufficient', 'pin_mismatch', 'missing_pin_hash'})
 *
 * The confirm action carries every confirm-attempt outcome — successful
 * and failed alike — discriminated by metadata.outcome. Matches the
 * Phase 2 auth_signin_*_failure / metadata.reason pattern: single action
 * for log-query simplicity, rich metadata for forensic detail. PIN
 * failure at confirm is operationally a checklist event, not an auth
 * event — so it stays in the checklist namespace, not auth_*.
 *
 * None are on DESTRUCTIVE_ACTIONS (these are routine operational events);
 * audit() auto-derives destructive=false.
 *
 * Errors are throw-based with named classes — API routes catch and translate
 * to HTTP error shapes via lib/api-helpers.ts jsonError(). All errors extend
 * a single ChecklistError base for easy catch-and-translate.
 *
 * Spec references: §4.3 (checklist tables), §5.2 (RLS), §6.1 (PIN re-entry),
 * §2.4 (per-item completion + supersession). Amendments referenced:
 * SPEC_AMENDMENTS.md C.16 (denormalized confirmation state on
 * checklist_instances), C.19 (closing two-phase model — Build #1 ships
 * Phase 1 only, but the lib is symmetrical to support Phase 2's prep
 * trigger from confirmInstance in Build #2).
 */

import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";

import { verifyPin } from "./auth";
import { audit } from "./audit";
import { getServiceRoleClient } from "./supabase-server";
import { getRoleLevel, type RoleCode } from "./roles";
import type {
  ChecklistInstance,
  ChecklistCompletion,
  ChecklistRevocationReason,
  ChecklistSubmission,
  ChecklistIncompleteReason,
  ChecklistStatus,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Actor — the authenticated user driving the operation.
// API routes derive this from requireSession's AuthContext.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChecklistActor {
  userId: string;
  role: RoleCode;
  level: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error classes — all extend ChecklistError so API routes can catch one type.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base class for every named error this lib throws. API routes catch
 * `ChecklistError` once and translate to HTTP responses via the `code`
 * discriminator (mapped through lib/api-helpers.ts jsonError()).
 *
 * Subclass hierarchy (all extend ChecklistError):
 *   - ChecklistInstanceClosedError   (code: "instance_closed")
 *   - ChecklistLockedError           (code: "single_submission_locked")
 *   - ChecklistRoleViolationError    (code: "role_level_insufficient")
 *   - ChecklistMissingCountError     (code: "missing_count")
 *   - ChecklistMissingPhotoError     (code: "missing_photo")
 *   - ChecklistPinMismatchError      (code: "pin_mismatch")
 *   - ChecklistMissingReasonError    (code: "missing_reasons")
 *   - ChecklistExtraReasonError      (code: "extra_reasons")
 *   - ChecklistSupersedeFailedError  (code: "supersede_failed")
 *
 * Plus generic instances of ChecklistError itself for in-band shape errors
 * (empty batch, completion-not-found, completion-wrong-instance,
 * completion-wrong-author).
 */
export class ChecklistError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ChecklistError";
  }
}

export class ChecklistInstanceClosedError extends ChecklistError {
  constructor(public readonly instanceId: string, public readonly status: ChecklistStatus) {
    super(`Instance ${instanceId} is ${status}; only open instances accept writes.`, "instance_closed");
    this.name = "ChecklistInstanceClosedError";
  }
}

export class ChecklistLockedError extends ChecklistError {
  constructor(public readonly instanceId: string) {
    super(`Instance ${instanceId} is from a single-submission template and is locked.`, "single_submission_locked");
    this.name = "ChecklistLockedError";
  }
}

export class ChecklistRoleViolationError extends ChecklistError {
  constructor(
    public readonly required: number,
    public readonly actual: number,
    message?: string,
  ) {
    super(
      message ?? `Role level ${actual} is below required ${required}.`,
      "role_level_insufficient",
    );
    this.name = "ChecklistRoleViolationError";
  }
}

export class ChecklistMissingCountError extends ChecklistError {
  constructor(public readonly templateItemId: string) {
    super(`Item ${templateItemId} requires a count value.`, "missing_count");
    this.name = "ChecklistMissingCountError";
  }
}

export class ChecklistMissingPhotoError extends ChecklistError {
  constructor(public readonly templateItemId: string) {
    super(`Item ${templateItemId} requires a photo.`, "missing_photo");
    this.name = "ChecklistMissingPhotoError";
  }
}

export class ChecklistPinMismatchError extends ChecklistError {
  constructor() {
    super("PIN does not match.", "pin_mismatch");
    this.name = "ChecklistPinMismatchError";
  }
}

export class ChecklistMissingReasonError extends ChecklistError {
  constructor(public readonly missingTemplateItemIds: string[]) {
    super(
      `Reasons required for ${missingTemplateItemIds.length} required-and-incomplete item(s).`,
      "missing_reasons",
    );
    this.name = "ChecklistMissingReasonError";
  }
}

export class ChecklistExtraReasonError extends ChecklistError {
  constructor(public readonly extraTemplateItemIds: string[]) {
    super(
      `Reasons supplied for ${extraTemplateItemIds.length} item(s) that are completed.`,
      "extra_reasons",
    );
    this.name = "ChecklistExtraReasonError";
  }
}

/**
 * Thrown when a completion insert succeeded but the corresponding prior-
 * completion supersession UPDATE failed. Inconsistent state: two live
 * completions for the same item. Caller MUST handle — likely by retrying
 * the supersede, marking the new completion as superseded itself, or
 * surfacing a forensic alert. The audit log row tagged
 * `checklist_completion.supersede_failure` carries both completion ids.
 */
export class ChecklistSupersedeFailedError extends ChecklistError {
  constructor(
    public readonly newCompletionId: string,
    public readonly priorCompletionId: string,
    public readonly cause: string,
  ) {
    super(
      `Supersede failed for prior=${priorCompletionId} new=${newCompletionId}: ${cause}`,
      "supersede_failed",
    );
    this.name = "ChecklistSupersedeFailedError";
  }
}

// ─── Quick-window constants (per SPEC_AMENDMENTS.md C.28) ──────────────────

/**
 * Silent-revoke window: completions can be silently undone (no reason, no
 * note, error_tap audit) within QUICK_WINDOW_MS of completed_at. After
 * this window, structured revocation (revokeWithReason) or KH+ peer
 * tagging (tagActualCompleter) is the path.
 *
 * Window measured from the LIVE row's completed_at (resets on supersede
 * per C.22's notes-edit-is-re-completion model). Alternative would be a
 * hard cap from earliest completion in the supersede chain; rejected
 * because the user mental model expects "just touched it, can undo."
 * Theoretical exploit (extending window via repeated note edits) is
 * empty — extending silent-revoke doesn't unlock anything that
 * revokeWithReason doesn't already grant.
 */
const QUICK_WINDOW_MS = 60_000;

/** Returns ms elapsed since completedAt. Negative if completedAt is in the future (clock skew). */
function elapsedSinceCompleted(completedAtIso: string, now: Date = new Date()): number {
  return now.getTime() - new Date(completedAtIso).getTime();
}

// ─── Revoke / tag errors (per SPEC_AMENDMENTS.md C.28) ─────────────────────

/**
 * Thrown by revokeCompletion when the live completion's completed_at is
 * older than QUICK_WINDOW_MS (60s). Caller should switch to revokeWithReason
 * (post-60s structured path).
 */
export class ChecklistOutsideQuickWindowError extends ChecklistError {
  constructor(public readonly completionId: string, public readonly elapsedMs: number) {
    super(
      `Completion ${completionId} is past the silent-revoke window (${elapsedMs}ms elapsed; window is ${QUICK_WINDOW_MS}ms).`,
      "outside_quick_window",
    );
    this.name = "ChecklistOutsideQuickWindowError";
  }
}

/**
 * Thrown by revokeCompletion or revokeWithReason when the actor isn't the
 * row's completed_by. Self-only enforcement; KH+ peer correction goes
 * through tagActualCompleter, NOT revoke.
 */
export class ChecklistNotSelfError extends ChecklistError {
  constructor(public readonly completionId: string) {
    super(
      `Completion ${completionId} can only be revoked by the original completer.`,
      "not_self",
    );
    this.name = "ChecklistNotSelfError";
  }
}

/**
 * Thrown by tagActualCompleter when the live completion's completed_at is
 * still within QUICK_WINDOW_MS. Within the silent-correction window, the
 * actor self-corrects via Undo; KH+ peer correction is blocked to avoid
 * racing the actor's own correction.
 */
export class ChecklistTagWithinQuickWindowError extends ChecklistError {
  constructor(public readonly completionId: string, public readonly remainingMs: number) {
    super(
      `Completion ${completionId} is still within the silent-correction window (${remainingMs}ms remaining); KH+ tagging blocked until window expires.`,
      "tag_within_quick_window",
    );
    this.name = "ChecklistTagWithinQuickWindowError";
  }
}

/**
 * Thrown by tagActualCompleter when the supplied actualCompleterId fails
 * picker scope: not a completer on this instance AND not a today-signed-in
 * member of this location, OR fails the role floor (level < min_role_level
 * of the template_item), OR is not active.
 */
export class ChecklistInvalidPickerCandidateError extends ChecklistError {
  constructor(
    public readonly completionId: string,
    public readonly proposedActualCompleterId: string,
    public readonly reason: "out_of_scope" | "role_below_floor" | "inactive" | "not_found",
  ) {
    super(
      `Proposed actual_completer ${proposedActualCompleterId} for completion ${completionId} failed picker scope: ${reason}.`,
      "invalid_picker_candidate",
    );
    this.name = "ChecklistInvalidPickerCandidateError";
  }
}

/**
 * Thrown by tagActualCompleter when an existing tag is being replaced and
 * the new tagger's level is below the current tagger's level. Lateral and
 * upward replacement is allowed (level >= current_tagger.level); downward
 * is not. Self-correction by the original tagger is always allowed
 * regardless of level (handled by allowing actor.userId === current_tagger).
 */
export class ChecklistTagHierarchyViolationError extends ChecklistError {
  constructor(
    public readonly completionId: string,
    public readonly currentTaggerLevel: number,
    public readonly attemptedReplacerLevel: number,
  ) {
    super(
      `Cannot replace existing actual_completer tag on completion ${completionId}: replacer level ${attemptedReplacerLevel} is below current tagger level ${currentTaggerLevel}.`,
      "tag_hierarchy_violation",
    );
    this.name = "ChecklistTagHierarchyViolationError";
  }
}

/**
 * Thrown by revokeWithReason when reason='other' but note is empty/missing.
 * Cross-column constraint enforced at lib layer (not Postgres CHECK) per
 * the schema migration's column comment.
 */
export class ChecklistRevocationNoteRequiredError extends ChecklistError {
  constructor(public readonly completionId: string) {
    super(
      `Revocation note is required when reason='other' on completion ${completionId}.`,
      "revocation_note_required",
    );
    this.name = "ChecklistRevocationNoteRequiredError";
  }
}

/**
 * Thrown when a revoke/tag UPDATE matches 0 rows because the row was
 * concurrently revoked, superseded, or otherwise mutated between the
 * pre-flight load and the UPDATE. This is a state conflict (409),
 * not a server error (500): another operation legitimately won the race.
 *
 * UI can decide to retry (re-load the row, re-evaluate affordances) or
 * surface a "this completion was just modified by someone else" message.
 */
export class ChecklistConcurrentModificationError extends ChecklistError {
  constructor(
    public readonly completionId: string,
    public readonly operation: "revoke" | "revoke_with_reason" | "tag_actual_completer",
    cause?: string,
  ) {
    super(
      `Completion ${completionId} was concurrently modified during ${operation}${cause ? `: ${cause}` : ""}.`,
      "concurrent_modification",
    );
    this.name = "ChecklistConcurrentModificationError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// snake_case ↔ camelCase row mappers
// ─────────────────────────────────────────────────────────────────────────────

interface InstanceRow {
  id: string;
  template_id: string;
  location_id: string;
  date: string;
  shift_start_at: string | null;
  status: ChecklistStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
}

interface CompletionRow {
  id: string;
  instance_id: string;
  template_item_id: string;
  completed_by: string;
  completed_at: string;
  count_value: string | number | null;
  photo_id: string | null;
  notes: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: ChecklistRevocationReason | null;
  revocation_note: string | null;
  actual_completer_id: string | null;
  actual_completer_tagged_at: string | null;
  actual_completer_tagged_by: string | null;
}

/** Column list for SELECTs against checklist_completions — single source of truth. */
const COMPLETION_COLUMNS =
  "id, instance_id, template_item_id, completed_by, completed_at, count_value, photo_id, notes, superseded_at, superseded_by, revoked_at, revoked_by, revocation_reason, revocation_note, actual_completer_id, actual_completer_tagged_at, actual_completer_tagged_by";

interface SubmissionRow {
  id: string;
  instance_id: string;
  submitted_by: string;
  submitted_at: string;
  completion_ids: string[];
  is_final_confirmation: boolean;
}

interface ReasonRow {
  id: string;
  instance_id: string;
  template_item_id: string;
  reason: string;
  reported_by: string;
  reported_at: string;
}

interface TemplateItemRow {
  id: string;
  template_id: string;
  min_role_level: number;
  required: boolean;
  expects_count: boolean;
  expects_photo: boolean;
  active: boolean;
}

const rowToInstance = (r: InstanceRow): ChecklistInstance => ({
  id: r.id,
  templateId: r.template_id,
  locationId: r.location_id,
  date: r.date,
  shiftStartAt: r.shift_start_at,
  status: r.status,
  confirmedAt: r.confirmed_at,
  confirmedBy: r.confirmed_by,
  createdAt: r.created_at,
});

const rowToCompletion = (r: CompletionRow): ChecklistCompletion => ({
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
});

const rowToSubmission = (r: SubmissionRow): ChecklistSubmission => ({
  id: r.id,
  instanceId: r.instance_id,
  submittedBy: r.submitted_by,
  submittedAt: r.submitted_at,
  completionIds: r.completion_ids,
  isFinalConfirmation: r.is_final_confirmation,
});

const rowToReason = (r: ReasonRow): ChecklistIncompleteReason => ({
  id: r.id,
  instanceId: r.instance_id,
  templateItemId: r.template_item_id,
  reason: r.reason,
  reportedBy: r.reported_by,
  reportedAt: r.reported_at,
});

// Postgres unique-violation code (per pg docs).
const PG_UNIQUE_VIOLATION = "23505";

const isUniqueViolation = (e: PostgrestError | null): boolean =>
  e?.code === PG_UNIQUE_VIOLATION;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (private)
// ─────────────────────────────────────────────────────────────────────────────

async function loadInstanceOrThrow(
  authed: SupabaseClient,
  instanceId: string,
): Promise<InstanceRow> {
  const { data, error } = await authed
    .from("checklist_instances")
    .select(
      "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at",
    )
    .eq("id", instanceId)
    .maybeSingle<InstanceRow>();
  if (error) throw new Error(`load instance ${instanceId}: ${error.message}`);
  if (!data) throw new Error(`instance ${instanceId} not found or not visible to caller`);
  return data;
}

async function loadTemplateItemOrThrow(
  authed: SupabaseClient,
  templateItemId: string,
): Promise<TemplateItemRow> {
  const { data, error } = await authed
    .from("checklist_template_items")
    .select("id, template_id, min_role_level, required, expects_count, expects_photo, active")
    .eq("id", templateItemId)
    .maybeSingle<TemplateItemRow>();
  if (error) throw new Error(`load template_item ${templateItemId}: ${error.message}`);
  if (!data) throw new Error(`template_item ${templateItemId} not found or not visible to caller`);
  return data;
}

function ensureInstanceOpen(instance: InstanceRow): void {
  if (instance.status !== "open") {
    throw new ChecklistInstanceClosedError(instance.id, instance.status);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// rejectIfPrepLocked — guard called by completeItem, submitBatch, confirmInstance.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Throws ChecklistLockedError if the instance's template has
 * single_submission_only=true AND at least one checklist_submissions row
 * already exists for this instance.
 *
 * Build #1 has no single_submission_only=true templates (Closing v1 is
 * multi-submission). Wired anyway so Build #2's prep flow inherits the
 * guard without retrofit.
 *
 * No audit row — this is a read-only guard. The caller (completeItem /
 * submitBatch / confirmInstance) writes its own audit, which captures
 * the failed-attempt context if it surfaces a ChecklistLockedError.
 */
export async function rejectIfPrepLocked(
  authed: SupabaseClient,
  instanceId: string,
): Promise<void> {
  // Need the template's single_submission_only via the instance.
  const { data: ix, error: ixErr } = await authed
    .from("checklist_instances")
    .select("id, template_id")
    .eq("id", instanceId)
    .maybeSingle<{ id: string; template_id: string }>();
  if (ixErr) throw new Error(`rejectIfPrepLocked: load instance ${instanceId}: ${ixErr.message}`);
  if (!ix) throw new Error(`rejectIfPrepLocked: instance ${instanceId} not found`);

  const { data: tmpl, error: tmplErr } = await authed
    .from("checklist_templates")
    .select("id, single_submission_only")
    .eq("id", ix.template_id)
    .maybeSingle<{ id: string; single_submission_only: boolean }>();
  if (tmplErr) throw new Error(`rejectIfPrepLocked: load template ${ix.template_id}: ${tmplErr.message}`);
  if (!tmpl) throw new Error(`rejectIfPrepLocked: template ${ix.template_id} not found`);

  if (!tmpl.single_submission_only) return; // not a prep-style lock template

  const { count, error: countErr } = await authed
    .from("checklist_submissions")
    .select("*", { count: "exact", head: true })
    .eq("instance_id", instanceId);
  if (countErr) throw new Error(`rejectIfPrepLocked: count submissions ${instanceId}: ${countErr.message}`);

  if ((count ?? 0) > 0) {
    throw new ChecklistLockedError(instanceId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getOrCreateInstance — idempotent per (template_id, location_id, date).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the checklist_instances row for (template_id, location_id, date).
 * Creates it with status='open' if absent. Idempotent and concurrency-safe:
 * if two callers race the INSERT, the loser catches Postgres unique-
 * violation 23505, re-reads the row created by the winner, and returns it.
 *
 * Audit row written via service-role only when this call newly created
 * the instance (created=true). Skipped on race-loss / pre-existing.
 *
 * Errors:
 *   - throws on any unexpected DB error (caller maps to 500)
 *   - throws on pre-flight failure (e.g., template / location FK doesn't
 *     resolve — RLS will reject with a generic insert error in that case)
 */
export async function getOrCreateInstance(
  authed: SupabaseClient,
  args: {
    templateId: string;
    locationId: string;
    date: string;
    actor: ChecklistActor;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ instance: ChecklistInstance; created: boolean }> {
  const { templateId, locationId, date, actor } = args;

  // Fast path: already exists?
  const { data: existing, error: readErr } = await authed
    .from("checklist_instances")
    .select(
      "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at",
    )
    .eq("template_id", templateId)
    .eq("location_id", locationId)
    .eq("date", date)
    .maybeSingle<InstanceRow>();
  if (readErr) throw new Error(`getOrCreateInstance read: ${readErr.message}`);
  if (existing) {
    return { instance: rowToInstance(existing), created: false };
  }

  // Insert path. RLS gates on location_id ∈ user_locations AND role_level >= 3.
  const { data: inserted, error: insertErr } = await authed
    .from("checklist_instances")
    .insert({
      template_id: templateId,
      location_id: locationId,
      date,
      shift_start_at: new Date().toISOString(),
      status: "open" as ChecklistStatus,
    })
    .select(
      "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at",
    )
    .maybeSingle<InstanceRow>();

  // Race-loss path: another caller won the INSERT. Re-read and return.
  if (insertErr && isUniqueViolation(insertErr)) {
    const { data: race, error: raceErr } = await authed
      .from("checklist_instances")
      .select(
        "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at",
      )
      .eq("template_id", templateId)
      .eq("location_id", locationId)
      .eq("date", date)
      .maybeSingle<InstanceRow>();
    if (raceErr) throw new Error(`getOrCreateInstance race re-read: ${raceErr.message}`);
    if (!race) {
      throw new Error(
        `getOrCreateInstance race: 23505 raised but no row visible on re-read for (${templateId}, ${locationId}, ${date})`,
      );
    }
    return { instance: rowToInstance(race), created: false };
  }
  if (insertErr) throw new Error(`getOrCreateInstance insert: ${insertErr.message}`);
  if (!inserted) throw new Error(`getOrCreateInstance insert returned no row`);

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "checklist_instance.create",
    resourceTable: "checklist_instances",
    resourceId: inserted.id,
    metadata: {
      template_id: templateId,
      location_id: locationId,
      date,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { instance: rowToInstance(inserted), created: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// completeItem — append-only with prior-completion supersession.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Records a completion for a single template item on an open instance.
 * If a prior live (non-superseded) completion exists for the same
 * (instance_id, template_item_id), it is marked superseded by the new
 * row's id.
 *
 * Two-phase write: step 1 inserts the new completion via the authed
 * client (RLS-checked); step 2 updates the prior row's superseded_at /
 * superseded_by via service-role (RLS denies UPDATE on completions
 * regardless of caller). Step 2 is synchronous-blocking — completeItem
 * does NOT return success until both steps complete.
 *
 * Edge case: if step 1 succeeds but step 2 fails, the database is in an
 * inconsistent state with two live completions for the same item. The
 * function audits `checklist_completion.supersede_failure` with both
 * completion ids and throws ChecklistSupersedeFailedError carrying the
 * same. The caller (API route) is responsible for cleanup — likely by
 * retrying the supersede, marking the new completion as superseded
 * itself, or surfacing a forensic alert. Surfacing rather than silently
 * tolerating is intentional: in a closing-checklist context, duplicate
 * live completions visible in UI are worse than failing the operation.
 *
 * Validation:
 *   - instance must be 'open' (else ChecklistInstanceClosedError)
 *   - template not single-submission-locked (else ChecklistLockedError)
 *   - actor.level >= template_item.min_role_level (else ChecklistRoleViolationError)
 *   - if template_item.expects_count: countValue must be non-null
 *   - if template_item.expects_photo: photoId must be non-null
 *
 * RLS will also reject the insert if the instance isn't open or the
 * caller doesn't satisfy completed_by = current_user_id() — the app-
 * layer checks above provide clearer errors before the DB rejection.
 */
export async function completeItem(
  authed: SupabaseClient,
  args: {
    instanceId: string;
    templateItemId: string;
    actor: ChecklistActor;
    countValue?: number | null;
    photoId?: string | null;
    notes?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ completion: ChecklistCompletion }> {
  const { instanceId, templateItemId, actor } = args;

  const instance = await loadInstanceOrThrow(authed, instanceId);
  ensureInstanceOpen(instance);
  await rejectIfPrepLocked(authed, instanceId);

  const item = await loadTemplateItemOrThrow(authed, templateItemId);
  if (actor.level < item.min_role_level) {
    throw new ChecklistRoleViolationError(item.min_role_level, actor.level);
  }
  if (item.expects_count && (args.countValue === undefined || args.countValue === null)) {
    throw new ChecklistMissingCountError(templateItemId);
  }
  if (item.expects_photo && (args.photoId === undefined || args.photoId === null)) {
    throw new ChecklistMissingPhotoError(templateItemId);
  }

  // Find prior live completion (if any) for this item on this instance.
  const { data: prior, error: priorErr } = await authed
    .from("checklist_completions")
    .select("id, instance_id, template_item_id, completed_by")
    .eq("instance_id", instanceId)
    .eq("template_item_id", templateItemId)
    .is("superseded_at", null)
    .maybeSingle<{ id: string; instance_id: string; template_item_id: string; completed_by: string }>();
  if (priorErr) throw new Error(`completeItem load prior: ${priorErr.message}`);
  const priorId = prior?.id ?? null;

  // Step 1: insert new completion (authed; RLS checks completed_by =
  // current_user_id, instance.status='open', min_role_level <= caller level).
  const { data: inserted, error: insertErr } = await authed
    .from("checklist_completions")
    .insert({
      instance_id: instanceId,
      template_item_id: templateItemId,
      completed_by: actor.userId,
      count_value: args.countValue ?? null,
      photo_id: args.photoId ?? null,
      notes: args.notes ?? null,
    })
    .select(COMPLETION_COLUMNS)
    .maybeSingle<CompletionRow>();
  if (insertErr) throw new Error(`completeItem insert: ${insertErr.message}`);
  if (!inserted) throw new Error(`completeItem insert returned no row`);
  const newId = inserted.id;

  // Step 2: supersede prior (service-role; RLS denies UPDATE for everyone).
  // Per AGENTS.md UPDATE silent-denial footgun: a 0-row update returns no
  // exception, so we explicitly select the updated row and check we got
  // exactly one back. The .is() filter guards against re-superseding a row
  // already superseded by a concurrent operation.
  if (priorId) {
    const sb = getServiceRoleClient();
    const { data: supersededRows, error: supersedeErr } = await sb
      .from("checklist_completions")
      .update({
        superseded_at: new Date().toISOString(),
        superseded_by: newId,
      })
      .eq("id", priorId)
      .is("superseded_at", null)
      .select("id");

    if (supersedeErr || !supersededRows || supersededRows.length === 0) {
      const cause = supersedeErr?.message ?? `0 rows updated (already superseded?)`;
      await audit({
        actorId: actor.userId,
        actorRole: actor.role,
        action: "checklist_completion.supersede_failure",
        resourceTable: "checklist_completions",
        resourceId: newId,
        metadata: {
          instance_id: instanceId,
          template_item_id: templateItemId,
          new_completion_id: newId,
          prior_completion_id: priorId,
          error: cause,
        },
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      });
      throw new ChecklistSupersedeFailedError(newId, priorId, cause);
    }
  }

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "checklist_completion.create",
    resourceTable: "checklist_completions",
    resourceId: newId,
    metadata: {
      instance_id: instanceId,
      template_item_id: templateItemId,
      superseded_prior_id: priorId,
      had_count: args.countValue !== undefined && args.countValue !== null,
      had_photo: args.photoId !== undefined && args.photoId !== null,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { completion: rowToCompletion(inserted) };
}

// ─────────────────────────────────────────────────────────────────────────────
// submitBatch — non-final submission event over a set of completions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Records a checklist_submissions event referencing a batch of completions
 * the caller just performed. is_final_confirmation = false; the PIN-attest
 * submission flag belongs to confirmInstance.
 *
 * Validation:
 *   - instance must be 'open' (else ChecklistInstanceClosedError)
 *   - template not single-submission-locked (else ChecklistLockedError)
 *   - every completionId must exist on this instance and be authored by
 *     the actor (defense against caller passing arbitrary ids)
 *
 * RLS additionally enforces submitted_by = current_user_id() at insert.
 */
export async function submitBatch(
  authed: SupabaseClient,
  args: {
    instanceId: string;
    actor: ChecklistActor;
    completionIds: string[];
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ submission: ChecklistSubmission }> {
  const { instanceId, actor, completionIds } = args;

  if (completionIds.length === 0) {
    throw new ChecklistError("submitBatch: completionIds must be non-empty.", "empty_batch");
  }

  const instance = await loadInstanceOrThrow(authed, instanceId);
  ensureInstanceOpen(instance);
  await rejectIfPrepLocked(authed, instanceId);

  // Verify every completion exists, belongs to this instance, was authored
  // by the actor. (RLS will let any caller in this location read these
  // rows; we enforce ownership at app layer for clearer error messaging.)
  const { data: rows, error: rowsErr } = await authed
    .from("checklist_completions")
    .select("id, instance_id, completed_by")
    .in("id", completionIds);
  if (rowsErr) throw new Error(`submitBatch verify completions: ${rowsErr.message}`);
  const seen = new Set((rows ?? []).map((r) => r.id as string));
  const missing = completionIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new ChecklistError(
      `submitBatch: completion id(s) not found on this instance: ${missing.join(", ")}`,
      "completion_not_found",
    );
  }
  for (const r of rows ?? []) {
    if (r.instance_id !== instanceId) {
      throw new ChecklistError(
        `submitBatch: completion ${r.id} belongs to a different instance.`,
        "completion_wrong_instance",
      );
    }
    if (r.completed_by !== actor.userId) {
      throw new ChecklistError(
        `submitBatch: completion ${r.id} was not authored by the actor.`,
        "completion_wrong_author",
      );
    }
  }

  const { data: inserted, error: insertErr } = await authed
    .from("checklist_submissions")
    .insert({
      instance_id: instanceId,
      submitted_by: actor.userId,
      completion_ids: completionIds,
      is_final_confirmation: false,
    })
    .select("id, instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation")
    .maybeSingle<SubmissionRow>();
  if (insertErr) throw new Error(`submitBatch insert: ${insertErr.message}`);
  if (!inserted) throw new Error(`submitBatch insert returned no row`);

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "checklist_submission.create",
    resourceTable: "checklist_submissions",
    resourceId: inserted.id,
    metadata: {
      instance_id: instanceId,
      completion_count: completionIds.length,
      is_final_confirmation: false,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { submission: rowToSubmission(inserted) };
}

// ─────────────────────────────────────────────────────────────────────────────
// confirmInstance — PIN attestation, status transition, reasons capture.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Final attestation that a checklist instance is closed. Validates:
 *
 *   1. Instance is 'open' (ChecklistInstanceClosedError otherwise).
 *   2. Template not single-submission-locked (ChecklistLockedError).
 *   3. Actor's role level >= the highest min_role_level among completed
 *      items on this instance (ChecklistRoleViolationError otherwise,
 *      audited as `checklist.confirm` with metadata.outcome =
 *      'role_insufficient'). Spec §6.1 step 5: the confirmer attests
 *      on behalf of the highest-leveled work performed, so they must
 *      be able to perform that work.
 *   4. Caller-supplied incompleteReasons set must match the actual
 *      required-and-incomplete set exactly (ChecklistMissingReasonError
 *      / ChecklistExtraReasonError otherwise — these are programmer
 *      errors so they throw without an audit row).
 *   5. PIN matches users.pin_hash for actor.userId
 *      (ChecklistPinMismatchError, audited as `checklist.confirm`
 *      with metadata.outcome = 'pin_mismatch' or 'missing_pin_hash').
 *      No lockout, no failed_login_count increment — the actor is
 *      already authenticated and locking the step-up confirm doesn't
 *      raise the bar materially (Phase 2 Session 4 PasswordModal
 *      lesson). Action stays in the checklist namespace, not auth_*,
 *      because operationally this is a checklist event.
 *
 * Every confirm-attempt outcome — successful and failed alike — emits
 * a `checklist.confirm` audit row, discriminated by metadata.outcome
 * ∈ {'success', 'role_insufficient', 'pin_mismatch', 'missing_pin_hash'}.
 * Forensic queries can find every confirm attempt by filtering on a
 * single action.
 *
 * On success:
 *   - Inserts checklist_incomplete_reasons rows (authed; RLS enforces
 *     reported_by = current_user_id()).
 *   - Inserts checklist_submissions row with is_final_confirmation=true
 *     and completion_ids=[] (final-confirm event records attestation;
 *     prior submitBatch events captured the per-batch completion ids).
 *   - UPDATEs checklist_instances.status to 'confirmed' (no incomplete
 *     required) or 'incomplete_confirmed' (≥1 incomplete required),
 *     plus confirmed_at and confirmed_by. Per AGENTS.md UPDATE-silent-
 *     denial footgun, checks rowCount and throws on 0.
 *   - Audits `checklist.confirm` with metadata distinguishing the two
 *     status outcomes.
 */
export async function confirmInstance(
  authed: SupabaseClient,
  args: {
    instanceId: string;
    actor: ChecklistActor;
    pin: string;
    incompleteReasons: Array<{ templateItemId: string; reason: string }>;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{
  instance: ChecklistInstance;
  status: ChecklistStatus;
  incompleteReasonRows: ChecklistIncompleteReason[];
}> {
  const { instanceId, actor, pin, incompleteReasons } = args;

  const instance = await loadInstanceOrThrow(authed, instanceId);
  ensureInstanceOpen(instance);
  await rejectIfPrepLocked(authed, instanceId);

  // Live (non-superseded) completions for this instance.
  const { data: liveCompletions, error: liveErr } = await authed
    .from("checklist_completions")
    .select("id, template_item_id")
    .eq("instance_id", instanceId)
    .is("superseded_at", null);
  if (liveErr) throw new Error(`confirmInstance load completions: ${liveErr.message}`);
  const completedItemIds = new Set((liveCompletions ?? []).map((r) => r.template_item_id as string));

  // Required template items for this template.
  const { data: items, error: itemsErr } = await authed
    .from("checklist_template_items")
    .select("id, min_role_level, required, active")
    .eq("template_id", instance.template_id)
    .eq("active", true);
  if (itemsErr) throw new Error(`confirmInstance load template items: ${itemsErr.message}`);
  const allItems = (items ?? []) as Array<{
    id: string;
    min_role_level: number;
    required: boolean;
    active: boolean;
  }>;

  // Highest min_role_level among completed items — drives the role-sufficiency
  // gate per spec §6.1.
  let highestCompletedMinRole = 0;
  for (const it of allItems) {
    if (completedItemIds.has(it.id) && it.min_role_level > highestCompletedMinRole) {
      highestCompletedMinRole = it.min_role_level;
    }
  }
  if (actor.level < highestCompletedMinRole) {
    await audit({
      actorId: actor.userId,
      actorRole: actor.role,
      action: "checklist.confirm",
      resourceTable: "checklist_instances",
      resourceId: instanceId,
      metadata: {
        outcome: "role_insufficient",
        instance_id: instanceId,
        attempted_role_level: actor.level,
        expected_role_level: highestCompletedMinRole,
      },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
    throw new ChecklistRoleViolationError(
      highestCompletedMinRole,
      actor.level,
      `Confirm requires role level ≥ ${highestCompletedMinRole} (highest completed item).`,
    );
  }

  // Actual required-and-incomplete set.
  const incompleteRequiredIds = allItems
    .filter((it) => it.required && !completedItemIds.has(it.id))
    .map((it) => it.id);
  const incompleteRequiredSet = new Set(incompleteRequiredIds);

  // Caller-supplied reason set.
  const callerReasonIds = incompleteReasons.map((r) => r.templateItemId);
  const callerReasonSet = new Set(callerReasonIds);

  const missingReasonIds = [...incompleteRequiredSet].filter((id) => !callerReasonSet.has(id));
  if (missingReasonIds.length > 0) {
    throw new ChecklistMissingReasonError(missingReasonIds);
  }
  const extraReasonIds = callerReasonIds.filter((id) => !incompleteRequiredSet.has(id));
  if (extraReasonIds.length > 0) {
    throw new ChecklistExtraReasonError(extraReasonIds);
  }

  // PIN attestation. Authed-client self-read on the actor's own row —
  // RLS users_read_self permits the read. Minimum-privilege over service
  // role: the actor IS the row, no privilege escalation justified here.
  const { data: userRow, error: userErr } = await authed
    .from("users")
    .select("id, pin_hash")
    .eq("id", actor.userId)
    .maybeSingle<{ id: string; pin_hash: string | null }>();
  if (userErr) throw new Error(`confirmInstance load user: ${userErr.message}`);
  if (!userRow || !userRow.pin_hash) {
    // Treat absent hash as a mismatch — never reveal which condition fired.
    // The schema's NOT NULL on pin_hash makes the missing branch unreachable
    // in production today; defensive-in-depth against future schema relaxation.
    await audit({
      actorId: actor.userId,
      actorRole: actor.role,
      action: "checklist.confirm",
      resourceTable: "checklist_instances",
      resourceId: instanceId,
      metadata: {
        outcome: "missing_pin_hash",
        instance_id: instanceId,
        attempted_role_level: actor.level,
        expected_role_level: highestCompletedMinRole,
      },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
    throw new ChecklistPinMismatchError();
  }
  const pinOk = await verifyPin(pin, userRow.pin_hash);
  if (!pinOk) {
    await audit({
      actorId: actor.userId,
      actorRole: actor.role,
      action: "checklist.confirm",
      resourceTable: "checklist_instances",
      resourceId: instanceId,
      metadata: {
        outcome: "pin_mismatch",
        instance_id: instanceId,
        attempted_role_level: actor.level,
        expected_role_level: highestCompletedMinRole,
      },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
    throw new ChecklistPinMismatchError();
  }

  // Transition to confirmed / incomplete_confirmed.
  const newStatus: ChecklistStatus =
    incompleteRequiredIds.length > 0 ? "incomplete_confirmed" : "confirmed";

  // 1. Insert reason rows (authed; RLS enforces reported_by = current_user_id).
  let reasonRows: ChecklistIncompleteReason[] = [];
  if (incompleteReasons.length > 0) {
    const { data: insertedReasons, error: reasonErr } = await authed
      .from("checklist_incomplete_reasons")
      .insert(
        incompleteReasons.map((r) => ({
          instance_id: instanceId,
          template_item_id: r.templateItemId,
          reason: r.reason,
          reported_by: actor.userId,
        })),
      )
      .select("id, instance_id, template_item_id, reason, reported_by, reported_at");
    if (reasonErr) throw new Error(`confirmInstance insert reasons: ${reasonErr.message}`);
    reasonRows = ((insertedReasons ?? []) as ReasonRow[]).map(rowToReason);
  }

  // 2. Insert final-confirmation submission. The final-confirm submission
  //    is an attestation event, NOT a completion batch — no completions
  //    are added at confirm time. Prior submitBatch() events are the
  //    canonical source for which completions belong to this instance,
  //    each scoped to its own submission. So completion_ids = [].
  //    (Schema permits empty UUID array; checklist_submissions.completion_ids
  //    is `UUID[] NOT NULL`.) is_final_confirmation = true is the
  //    discriminator that lets queries find the attestation event.
  const { data: submissionRow, error: subErr } = await authed
    .from("checklist_submissions")
    .insert({
      instance_id: instanceId,
      submitted_by: actor.userId,
      completion_ids: [],
      is_final_confirmation: true,
    })
    .select("id, instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation")
    .maybeSingle<SubmissionRow>();
  if (subErr) throw new Error(`confirmInstance insert submission: ${subErr.message}`);
  if (!submissionRow) throw new Error(`confirmInstance submission insert returned no row`);

  // 3. UPDATE the instance status. RLS allows update at level 3+ in this
  //    location. Per AGENTS.md UPDATE silent-denial footgun, check rowCount
  //    and throw on 0 — RLS denial returns 0 rows with no exception.
  const { data: updatedRow, error: updateErr } = await authed
    .from("checklist_instances")
    .update({
      status: newStatus,
      confirmed_at: new Date().toISOString(),
      confirmed_by: actor.userId,
    })
    .eq("id", instanceId)
    .eq("status", "open") // optimistic concurrency: re-confirm only if still open
    .select(
      "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at",
    )
    .maybeSingle<InstanceRow>();
  if (updateErr) throw new Error(`confirmInstance update instance: ${updateErr.message}`);
  if (!updatedRow) {
    throw new Error(
      `confirmInstance update returned 0 rows for ${instanceId} — RLS denial or status changed since load`,
    );
  }

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "checklist.confirm",
    resourceTable: "checklist_instances",
    resourceId: instanceId,
    metadata: {
      outcome: "success",
      instance_id: instanceId,
      submission_id: submissionRow.id,
      status_after: newStatus,
      incomplete_required_count: incompleteRequiredIds.length,
      incomplete_reason_ids: reasonRows.map((r) => r.id),
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return {
    instance: rowToInstance(updatedRow),
    status: newStatus,
    incompleteReasonRows: reasonRows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revoke / tag helpers (per SPEC_AMENDMENTS.md C.28)
// ─────────────────────────────────────────────────────────────────────────────

const NY_TZ = "America/New_York";

/**
 * Returns the UTC ISO timestamp corresponding to "today 00:00 in NY"
 * (per SPEC_AMENDMENTS.md C.23 single-TZ convention). Used by the picker-
 * scope query to bound "sessions created today."
 *
 * Implementation: detect NY's UTC offset for the current NY date by formatting
 * UTC midnight on that date back into NY time and reading the hour. NY is
 * always UTC-4 (EDT) or UTC-5 (EST), so offsetHours below is always 4 or 5.
 *
 * Inline rather than centralized helper because this is the only consumer
 * at the lib layer; the dashboard page has its own date-string formatter
 * for a different purpose (display).
 */
function startOfTodayInNyAsUtcIso(): string {
  const now = new Date();
  const nyDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const utcMidnightOfNyDate = new Date(`${nyDate}T00:00:00Z`);
  const nyHourAtUtcMidnight = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(utcMidnightOfNyDate),
    10,
  );
  // At UTC 00:00 on nyDate, NY shows yesterday-evening (e.g., 19 or 20).
  // offsetHours = how many hours later UTC midnight is, after NY midnight.
  // The `% 24` defends against the theoretical hour=0 case (impossible for NY).
  const offsetHours = (24 - nyHourAtUtcMidnight) % 24;
  return new Date(utcMidnightOfNyDate.getTime() + offsetHours * 3600 * 1000).toISOString();
}

interface PickerCandidate {
  id: string;
  name: string;
  role: RoleCode;
  level: number;
}

/**
 * Picker scope for tagActualCompleter (per SPEC_AMENDMENTS.md C.28).
 *
 * Candidates = (users with non-revoked, non-superseded completions on this
 *               instance)
 *            ∪ (users whose user_locations includes this location AND who
 *               have a sessions row created since start of NY today)
 * filtered by (users.active = true AND level >= templateItem.min_role_level)
 *
 * Sessions don't bind to location (Phase 2 architectural decision — sessions
 * are per-user, the user's accessible locations are denormalized into the
 * JWT claims). "Signed in today at this location" is approximated as
 * "location-assigned AND signed in today (anywhere)." Pete (level 7,
 * all-locations override) signing into MEP would appear in EM's picker too —
 * acceptable false-positive class. If picker noise becomes friction at
 * scale (5+ locations), revisit by adding location_id to the sessions
 * table or introducing a new audit signal (e.g., page_view.location_scope).
 *
 * Two-step queries throughout (no PostgREST embedded selects with cross-
 * table .eq() filters per AGENTS.md Phase 2 Session 4 fragility lesson).
 *
 * Service-role for all reads — picker-scope candidate enumeration legitimately
 * needs to see (a) all completers on the instance regardless of who they
 * are, (b) all location members, (c) all today's sign-ins. Authed-client
 * RLS would filter sessions to the actor's own row only, breaking the
 * "today's roster" half. Trust boundary: this helper is invoked only after
 * the API route has already authenticated and authorized the actor (KH+
 * for tag, self for wrong_user_credited self-correction).
 */
async function loadPickerCandidates(args: {
  instanceId: string;
  locationId: string;
  minRoleLevel: number;
}): Promise<PickerCandidate[]> {
  const sb = getServiceRoleClient();

  // 1. Completers on this instance (live = non-revoked AND non-superseded).
  const { data: completerRows, error: completerErr } = await sb
    .from("checklist_completions")
    .select("completed_by")
    .eq("instance_id", args.instanceId)
    .is("revoked_at", null)
    .is("superseded_at", null);
  if (completerErr) throw new Error(`loadPickerCandidates completers: ${completerErr.message}`);
  const completerIds = new Set((completerRows ?? []).map((r) => r.completed_by as string));

  // 2. user_ids assigned to this location.
  const { data: locRows, error: locErr } = await sb
    .from("user_locations")
    .select("user_id")
    .eq("location_id", args.locationId);
  if (locErr) throw new Error(`loadPickerCandidates location members: ${locErr.message}`);
  const locationMembers = new Set((locRows ?? []).map((r) => r.user_id as string));

  // 3. user_ids with a sessions row created today (NY tz).
  const todayStartUtc = startOfTodayInNyAsUtcIso();
  const { data: sessionRows, error: sessionErr } = await sb
    .from("sessions")
    .select("user_id")
    .gte("created_at", todayStartUtc);
  if (sessionErr) throw new Error(`loadPickerCandidates sessions: ${sessionErr.message}`);
  const todaySignins = new Set((sessionRows ?? []).map((r) => r.user_id as string));

  // 4. Union: completers ∪ (locationMembers ∩ todaySignins).
  const candidateIds = new Set<string>(completerIds);
  for (const uid of locationMembers) {
    if (todaySignins.has(uid)) candidateIds.add(uid);
  }
  if (candidateIds.size === 0) return [];

  // 5. Load user details, filter by active + min_role_level (in app layer
  //    since RoleCode → level is registry-driven, not DB-driven).
  const { data: userRows, error: userErr } = await sb
    .from("users")
    .select("id, name, role, active")
    .in("id", Array.from(candidateIds))
    .eq("active", true);
  if (userErr) throw new Error(`loadPickerCandidates users: ${userErr.message}`);

  const candidates: PickerCandidate[] = [];
  for (const u of (userRows ?? []) as Array<{ id: string; name: string; role: RoleCode; active: boolean }>) {
    const level = getRoleLevel(u.role);
    if (level >= args.minRoleLevel) {
      candidates.push({ id: u.id, name: u.name, role: u.role, level });
    }
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}

/**
 * Loads a live (non-revoked, non-superseded) completion by id, throwing
 * `ChecklistError` with code "completion_not_found" if absent or already
 * revoked/superseded. Used as the first step of revoke/tag flows so each
 * function can assume a live row.
 */
async function loadLiveCompletionOrThrow(
  authed: SupabaseClient,
  completionId: string,
): Promise<CompletionRow> {
  const { data, error } = await authed
    .from("checklist_completions")
    .select(COMPLETION_COLUMNS)
    .eq("id", completionId)
    .is("revoked_at", null)
    .is("superseded_at", null)
    .maybeSingle<CompletionRow>();
  if (error) throw new Error(`load completion ${completionId}: ${error.message}`);
  if (!data) {
    throw new ChecklistError(
      `Completion ${completionId} not found, revoked, or superseded.`,
      "completion_not_found",
    );
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// revokeCompletion — silent within-60s self-untick (no reason, no note).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Silent self-revoke for a just-tapped completion. Window is QUICK_WINDOW_MS
 * (60s) measured from the live row's completed_at. Self-only.
 *
 * Validation:
 *   - Completion must exist and be live (not already revoked/superseded).
 *   - actor.userId === completion.completed_by (else ChecklistNotSelfError).
 *   - now - completed_at < QUICK_WINDOW_MS (else ChecklistOutsideQuickWindowError;
 *     caller should switch to revokeWithReason).
 *
 * On success: sets revoked_at=now, revoked_by=actor.userId,
 * revocation_reason='error_tap'. No note. Audits
 * checklist_completion.revoke with metadata.in_quick_window=true and
 * reason='error_tap'.
 *
 * Service-role for the UPDATE (existing checklist_completions_no_user_update
 * RLS denies UPDATE for everyone; same pattern as supersede in completeItem).
 */
export async function revokeCompletion(
  authed: SupabaseClient,
  args: {
    completionId: string;
    actor: ChecklistActor;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ completion: ChecklistCompletion }> {
  const { completionId, actor } = args;

  const completion = await loadLiveCompletionOrThrow(authed, completionId);

  if (completion.completed_by !== actor.userId) {
    throw new ChecklistNotSelfError(completionId);
  }

  const elapsed = elapsedSinceCompleted(completion.completed_at);
  if (elapsed >= QUICK_WINDOW_MS) {
    throw new ChecklistOutsideQuickWindowError(completionId, elapsed);
  }

  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();
  const { data: updatedRows, error: updateErr } = await sb
    .from("checklist_completions")
    .update({
      revoked_at: nowIso,
      revoked_by: actor.userId,
      revocation_reason: "error_tap",
    })
    .eq("id", completionId)
    .is("revoked_at", null)
    .is("superseded_at", null)
    .select(COMPLETION_COLUMNS);

  if (updateErr) {
    throw new Error(`revokeCompletion update: ${updateErr.message}`);
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw new ChecklistConcurrentModificationError(completionId, "revoke");
  }

  const updatedRow = updatedRows[0] as CompletionRow;

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "checklist_completion.revoke",
    resourceTable: "checklist_completions",
    resourceId: completionId,
    metadata: {
      instance_id: completion.instance_id,
      template_item_id: completion.template_item_id,
      in_quick_window: true,
      reason: "error_tap",
      elapsed_ms: elapsed,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { completion: rowToCompletion(updatedRow) };
}

// ─────────────────────────────────────────────────────────────────────────────
// revokeWithReason — post-60s self-revoke with structured reason (+ optional note).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structured self-revoke for a completion past the silent window. Self-only.
 *
 * Validation:
 *   - Completion must exist and be live.
 *   - actor.userId === completion.completed_by (else ChecklistNotSelfError).
 *   - now - completed_at >= QUICK_WINDOW_MS (else: caller should use the silent
 *     revokeCompletion path; surfaced as ChecklistError "use_quick_revoke" so
 *     UI can self-correct without forcing user to wait 60s).
 *   - reason ∈ {'not_actually_done', 'other'}. ('error_tap' is silent-only;
 *     attempting it here is rejected to keep the audit trail honest about
 *     window membership.)
 *   - When reason='other', note must be non-empty (else
 *     ChecklistRevocationNoteRequiredError).
 *
 * On success: sets revoked_at=now, revoked_by=actor.userId,
 * revocation_reason=<reason>, revocation_note=<note when reason='other'>.
 * Audits checklist_completion.revoke with metadata.in_quick_window=false,
 * reason, and (when present) note.
 */
export async function revokeWithReason(
  authed: SupabaseClient,
  args: {
    completionId: string;
    actor: ChecklistActor;
    reason: "not_actually_done" | "other";
    note?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ completion: ChecklistCompletion }> {
  const { completionId, actor, reason } = args;

  // Reject 'error_tap' explicitly — that path is reserved for the silent
  // revokeCompletion route, where in_quick_window=true is part of the audit
  // contract. Allowing 'error_tap' here would muddy the forensic distinction.
  if ((reason as string) === "error_tap") {
    throw new ChecklistError(
      `revokeWithReason does not accept reason='error_tap'; use revokeCompletion (silent within-60s path).`,
      "invalid_payload",
    );
  }

  const note = args.note?.trim() ?? "";
  if (reason === "other" && note.length === 0) {
    throw new ChecklistRevocationNoteRequiredError(completionId);
  }

  const completion = await loadLiveCompletionOrThrow(authed, completionId);

  if (completion.completed_by !== actor.userId) {
    throw new ChecklistNotSelfError(completionId);
  }

  const elapsed = elapsedSinceCompleted(completion.completed_at);
  if (elapsed < QUICK_WINDOW_MS) {
    // Caller is still within silent window — they should use revokeCompletion.
    // We surface a ChecklistError rather than auto-routing because UI clarity:
    // the caller should know which path it's on (silent vs structured).
    throw new ChecklistError(
      `Completion ${completionId} is still within the silent-revoke window (${QUICK_WINDOW_MS - elapsed}ms remaining); use revokeCompletion.`,
      "use_quick_revoke",
    );
  }

  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();
  const { data: updatedRows, error: updateErr } = await sb
    .from("checklist_completions")
    .update({
      revoked_at: nowIso,
      revoked_by: actor.userId,
      revocation_reason: reason,
      revocation_note: reason === "other" ? note : null,
    })
    .eq("id", completionId)
    .is("revoked_at", null)
    .is("superseded_at", null)
    .select(COMPLETION_COLUMNS);

  if (updateErr) {
    throw new Error(`revokeWithReason update: ${updateErr.message}`);
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw new ChecklistConcurrentModificationError(completionId, "revoke_with_reason");
  }

  const updatedRow = updatedRows[0] as CompletionRow;

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "checklist_completion.revoke",
    resourceTable: "checklist_completions",
    resourceId: completionId,
    metadata: {
      instance_id: completion.instance_id,
      template_item_id: completion.template_item_id,
      in_quick_window: false,
      reason,
      note: reason === "other" ? note : null,
      elapsed_ms: elapsed,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { completion: rowToCompletion(updatedRow) };
}

// ─────────────────────────────────────────────────────────────────────────────
// tagActualCompleter — KH+ peer correction (or self wrong_user_credited).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Annotates a live completion with `actual_completer_id` (per
 * SPEC_AMENDMENTS.md C.28's accountability-truth model). Does NOT revoke
 * the original completion: completed_by remains operational truth (the
 * append-only tap event); actual_completer_id is the retrospective
 * correction of who actually did the work.
 *
 * Authorization: KH+ (level >= 4) OR self when actor.userId ===
 * completion.completed_by (a self "wrong_user_credited" chip flow).
 *
 * Validation:
 *   - Completion must exist and be live.
 *   - now - completed_at >= QUICK_WINDOW_MS (else
 *     ChecklistTagWithinQuickWindowError; within the silent window the
 *     actor self-corrects via revokeCompletion's Undo, NOT via tagging).
 *   - actor.level >= 4 OR actor.userId === completion.completed_by.
 *   - actualCompleterId must be in picker scope for this instance + location
 *     (loadPickerCandidates above), filtered by template_item.min_role_level.
 *     Failures discriminated by reason code on ChecklistInvalidPickerCandidateError.
 *   - Tag replacement rules: if an existing actual_completer_id is being
 *     replaced, replacer level must be >= current tagger's level (lateral
 *     and upward only). Self-correction by the original tagger is always
 *     allowed regardless of level.
 *
 * On success: sets actual_completer_id=<newId>, actual_completer_tagged_at=now,
 * actual_completer_tagged_by=actor.userId. Audits
 * checklist_completion.tag_actual_completer with metadata including
 * actual_completer_id and (when replacing) replaced_prior_tag.
 */
export async function tagActualCompleter(
  authed: SupabaseClient,
  args: {
    completionId: string;
    actor: ChecklistActor;
    actualCompleterId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ completion: ChecklistCompletion; replacedPriorTag: boolean }> {
  const { completionId, actor, actualCompleterId } = args;

  const completion = await loadLiveCompletionOrThrow(authed, completionId);

  // Window check: tagging blocked during the actor's silent-correction window.
  const elapsed = elapsedSinceCompleted(completion.completed_at);
  if (elapsed < QUICK_WINDOW_MS) {
    throw new ChecklistTagWithinQuickWindowError(completionId, QUICK_WINDOW_MS - elapsed);
  }

  // Authorization: KH+ OR self.
  const isSelf = actor.userId === completion.completed_by;
  if (!isSelf && actor.level < 4) {
    throw new ChecklistRoleViolationError(
      4,
      actor.level,
      `Tagging actual completer requires KH+ (level >= 4) or self (when actor === completed_by).`,
    );
  }

  // Load template_item to enforce min_role_level on the candidate, and the
  // instance to derive location_id for picker scope.
  const instance = await loadInstanceOrThrow(authed, completion.instance_id);
  const item = await loadTemplateItemOrThrow(authed, completion.template_item_id);

  // Picker-scope check on the proposed actualCompleterId.
  const candidates = await loadPickerCandidates({
    instanceId: completion.instance_id,
    locationId: instance.location_id,
    minRoleLevel: item.min_role_level,
  });
  const chosen = candidates.find((c) => c.id === actualCompleterId);
  if (!chosen) {
    // Distinguish out_of_scope vs inactive vs role_below_floor vs not_found
    // via service-role lookup on the user record for forensic clarity.
    const sb = getServiceRoleClient();
    const { data: targetUser } = await sb
      .from("users")
      .select("id, role, active")
      .eq("id", actualCompleterId)
      .maybeSingle<{ id: string; role: RoleCode; active: boolean }>();
    let reason: "out_of_scope" | "role_below_floor" | "inactive" | "not_found";
    if (!targetUser) {
      reason = "not_found";
    } else if (!targetUser.active) {
      reason = "inactive";
    } else if (getRoleLevel(targetUser.role) < item.min_role_level) {
      reason = "role_below_floor";
    } else {
      reason = "out_of_scope";
    }
    throw new ChecklistInvalidPickerCandidateError(completionId, actualCompleterId, reason);
  }

  // Tag replacement rules: if a prior tag exists, enforce hierarchy.
  const priorTaggerId = completion.actual_completer_tagged_by;
  const priorActualCompleterId = completion.actual_completer_id;
  const replacingPriorTag = priorTaggerId !== null && priorActualCompleterId !== null;

  if (replacingPriorTag) {
    // Self-correction by the original tagger is always allowed.
    if (priorTaggerId !== actor.userId) {
      // Lookup prior tagger's level via service-role.
      const sb = getServiceRoleClient();
      const { data: priorTagger } = await sb
        .from("users")
        .select("role")
        .eq("id", priorTaggerId)
        .maybeSingle<{ role: RoleCode }>();
      const priorLevel = priorTagger ? getRoleLevel(priorTagger.role) : 0;
      if (actor.level < priorLevel) {
        throw new ChecklistTagHierarchyViolationError(completionId, priorLevel, actor.level);
      }
    }
  }

  // UPDATE via service-role (existing _no_user_update RLS denies for everyone).
  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();
  const { data: updatedRows, error: updateErr } = await sb
    .from("checklist_completions")
    .update({
      actual_completer_id: actualCompleterId,
      actual_completer_tagged_at: nowIso,
      actual_completer_tagged_by: actor.userId,
    })
    .eq("id", completionId)
    .is("revoked_at", null)
    .is("superseded_at", null)
    .select(COMPLETION_COLUMNS);

  if (updateErr) {
    throw new Error(`tagActualCompleter update: ${updateErr.message}`);
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw new ChecklistConcurrentModificationError(completionId, "tag_actual_completer");
  }

  const updatedRow = updatedRows[0] as CompletionRow;

  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "checklist_completion.tag_actual_completer",
    resourceTable: "checklist_completions",
    resourceId: completionId,
    metadata: {
      instance_id: completion.instance_id,
      template_item_id: completion.template_item_id,
      actual_completer_id: actualCompleterId,
      replaced_prior_tag: replacingPriorTag
        ? {
            tagger_id: priorTaggerId,
            prior_actual_completer_id: priorActualCompleterId,
          }
        : null,
      self_tag: isSelf,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { completion: rowToCompletion(updatedRow), replacedPriorTag: replacingPriorTag };
}

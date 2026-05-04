/**
 * Prep instance lifecycle — Phase 3 / Module #1 Build #2 PR 1.
 *
 * Sibling to lib/checklists.ts. Reuses checklist_* infrastructure (instance
 * lifecycle, auth, audit, RLS) per SPEC_AMENDMENTS.md C.42's
 * reuse-where-natural principle, with prep-aware narrowing on the
 * rich JSONB shapes per C.18 + C.44.
 *
 * Replaces the Phase-6 stub that envisioned computed prep math
 * (par - on_hand → needed). Per C.18 refined model the numbers are
 * operator-supplied; computation is irrelevant.
 *
 * Public API:
 *   Validators:
 *     - isReportType, isPrepSection, isPrepColumn, isPrepMeta, isPrepData
 *   Read-path narrowing:
 *     - narrowPrepTemplateItem (asserts station/prepMeta.section sync; strict-throw)
 *     - narrowPrepCompletion (no invariant — snapshots intentionally frozen)
 *   Write helpers (use from seed scripts + future GM admin tool):
 *     - setPrepItemSection — sets BOTH station AND prep_meta.section atomically
 *     - setPrepItemMeta — sets prep_meta blob; asserts station match pre-write
 *     - seedPrepItem — combined create helper
 *   Submission:
 *     - submitAmPrep — atomic via submit_am_prep_atomic RPC + JS-side audit
 *   Reads:
 *     - loadAmPrepState — server-component data loader
 *     - loadAssignmentForToday — slim shape for dashboard tile
 *
 * Audit vocabulary (locked, used here and in /api/prep/*):
 *   - prep.submit                   metadata.outcome ∈ {'success',
 *                                     'role_insufficient',
 *                                     'instance_not_open',
 *                                     'auto_complete_failed'}
 *   - prep.snapshot_drift           forensic-only on station/section drift
 * None on DESTRUCTIVE_ACTIONS (routine operational events).
 *
 * Spec references: §4.3, §15 lib/prep.ts. Amendments: C.18 (prep model),
 * C.42 (reports architecture + auto-completion), C.44 (denormalized snapshot),
 * C.43 (mid-day prep multi-instance — accommodated by triggered_at column;
 * not exercised in this PR).
 *
 * Authorization note (per C.41 reconciliation): "KH+" in C.42 maps to
 * level >= 3 in current implementation (key_holder is level 3 per
 * lib/roles.ts) — same convention as the closing finalize gate per
 * C.26 + the C.41 sub-finding fix. When Module #2 reconciles the
 * broader level-number restructure per C.33, both gates move together.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "./audit";
import { canEditReport } from "./checklists";
import type {
  AutoCompleteMeta,
  ChecklistCompletion,
  ChecklistInstance,
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  PrepColumn,
  PrepData,
  PrepInputs,
  PrepMeta,
  PrepSection,
  PrepSnapshot,
  ReportType,
} from "./types";
import type { RoleCode } from "./roles";

// ─────────────────────────────────────────────────────────────────────────────
// Actor — symmetric with lib/checklists.ts ChecklistActor.
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepActor {
  userId: string;
  role: RoleCode;
  level: number;
}

/**
 * Per C.42: AM Prep base-tile-visible at "KH+". Reconciled in Build #2 PR 1
 * to level >= 3 — matches C.26's "KH+ can finalize" intent now that the
 * closing finalize gate is also level >= 3 per the C.41 sub-finding fix.
 * Below this, assignment-down via report_assignments is the path.
 *
 * The broader level-number restructure (renumbering KH=4, SL=5 per spec
 * C.33 intent) remains deferred to Module #2 user lifecycle work; this
 * constant moves with the closing finalize gate when that reconciliation
 * lands.
 */
export const AM_PREP_BASE_LEVEL = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Runtime validators (narrowing predicates)
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_TYPE_VALUES: readonly ReportType[] = [
  "am_prep",
  "mid_day_prep",
  "cash_report",
  "opening_report",
  "training_report",
  "special_report",
];

const PREP_SECTION_VALUES: readonly PrepSection[] = [
  "Veg",
  "Cooks",
  "Sides",
  "Sauces",
  "Slicing",
  "Misc",
];

const PREP_COLUMN_VALUES: readonly PrepColumn[] = [
  "par",
  "on_hand",
  "portioned",
  "line",
  "back_up",
  "total",
  "yes_no",
  "free_text",
];

export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPE_VALUES as readonly string[]).includes(value);
}

export function isPrepSection(value: unknown): value is PrepSection {
  return typeof value === "string" && (PREP_SECTION_VALUES as readonly string[]).includes(value);
}

export function isPrepColumn(value: unknown): value is PrepColumn {
  return typeof value === "string" && (PREP_COLUMN_VALUES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isPrepMeta(value: unknown): value is PrepMeta {
  if (!isPlainObject(value)) return false;
  if (!isPrepSection(value.section)) return false;
  if (!isNumberOrNull(value.parValue)) return false;
  if (!isStringOrNull(value.parUnit)) return false;
  if (!isStringOrNull(value.specialInstruction)) return false;
  if (!Array.isArray(value.columns)) return false;
  for (const c of value.columns) {
    if (!isPrepColumn(c)) return false;
  }
  return true;
}

export function isPrepInputs(value: unknown): value is PrepInputs {
  if (!isPlainObject(value)) return false;
  if (value.onHand !== undefined && typeof value.onHand !== "number") return false;
  if (value.portioned !== undefined && typeof value.portioned !== "number") return false;
  if (value.line !== undefined && typeof value.line !== "number") return false;
  if (value.backUp !== undefined && typeof value.backUp !== "number") return false;
  if (value.total !== undefined && typeof value.total !== "number") return false;
  if (value.yesNo !== undefined && typeof value.yesNo !== "boolean") return false;
  if (value.freeText !== undefined && typeof value.freeText !== "string") return false;
  return true;
}

function isPrepSnapshot(value: unknown): value is PrepSnapshot {
  if (!isPlainObject(value)) return false;
  if (!isPrepSection(value.section)) return false;
  if (typeof value.itemName !== "string") return false;
  if (!isNumberOrNull(value.parValue)) return false;
  if (!isStringOrNull(value.parUnit)) return false;
  if (!isStringOrNull(value.specialInstruction)) return false;
  return true;
}

export function isPrepData(value: unknown): value is PrepData {
  if (!isPlainObject(value)) return false;
  if (!isPrepInputs(value.inputs)) return false;
  if (!isPrepSnapshot(value.snapshot)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class PrepError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PrepError";
  }
}

/**
 * Thrown by narrowPrepTemplateItem / narrowPrepCompletion when JSONB shape
 * fails structural validation.
 */
export class PrepShapeError extends PrepError {
  constructor(public readonly templateItemId: string, public readonly cause: string) {
    super(`PrepShapeError on template_item ${templateItemId}: ${cause}`, "prep_shape");
    this.name = "PrepShapeError";
  }
}

/**
 * Thrown by narrowPrepTemplateItem when prep_meta.section diverges from
 * the parent item's station. Strict-throw because silent default would
 * mask a write-path bug (per locked surface decision).
 */
export class PrepInvariantError extends PrepError {
  constructor(
    public readonly templateItemId: string,
    public readonly station: string | null,
    public readonly metaSection: string,
  ) {
    super(
      `PrepInvariantError on template_item ${templateItemId}: ` +
        `prepMeta.section=${metaSection} but station=${station ?? "<null>"}; ` +
        `write through setPrepItemSection() to keep them in sync.`,
      "prep_invariant",
    );
    this.name = "PrepInvariantError";
  }
}

/**
 * Thrown by submitAmPrep when actor.level < AM_PREP_BASE_LEVEL AND there's
 * no active report_assignment for this user/date.
 */
export class PrepRoleViolationError extends PrepError {
  constructor(public readonly required: string, public readonly actorLevel: number) {
    super(
      `PrepRoleViolationError: required=${required}, actor_level=${actorLevel}, no active assignment`,
      "prep_role_violation",
    );
    this.name = "PrepRoleViolationError";
  }
}

/**
 * Thrown by submitAmPrep when the underlying RPC's auto-complete step
 * fails (no closing instance found for the operational date AND a
 * report-reference item id was passed). The transaction rolls back; no
 * prep state lands. Caller surfaces a recoverable user-facing message.
 */
export class PrepAutoCompleteError extends PrepError {
  constructor(
    public readonly prepInstanceId: string,
    public readonly closingItemTemplateItemId: string | null,
    public readonly cause: string,
  ) {
    super(
      `PrepAutoCompleteError on prep ${prepInstanceId}, closing_ref=${closingItemTemplateItemId ?? "<null>"}: ${cause}`,
      "prep_auto_complete_failed",
    );
    this.name = "PrepAutoCompleteError";
  }
}

/**
 * Thrown when the prep instance is not in 'open' status (e.g., already
 * confirmed). Maps to HTTP 409 conflict.
 */
export class PrepInstanceNotOpenError extends PrepError {
  constructor(public readonly instanceId: string, public readonly status: string) {
    super(
      `PrepInstanceNotOpenError: instance ${instanceId} is ${status}; expected 'open'.`,
      "prep_instance_not_open",
    );
    this.name = "PrepInstanceNotOpenError";
  }
}

/**
 * C.46 A8 — thrown by submitAmPrep when an update is attempted against a
 * chain already at the cap (edit_count = 3). The RPC raises sqlstate P0001
 * with this semantic; lib maps to this typed error → HTTP 422.
 *
 * Code string is unprefixed (`edit_limit_exceeded`) because per C.46 A9 this
 * error generalizes across all report types (Cash Report, Opening Report,
 * Mid-day Prep, etc.). Currently lives in lib/prep.ts because PR 3 ships
 * AM Prep only; rename/move when generalization happens.
 */
export class ChecklistEditLimitExceededError extends PrepError {
  constructor(
    public readonly originalSubmissionId: string,
    public readonly currentEditCount: number,
  ) {
    super(
      `ChecklistEditLimitExceededError: chain ${originalSubmissionId} ` +
        `at edit_count=${currentEditCount}; cap=3.`,
      "edit_limit_exceeded",
    );
    this.name = "ChecklistEditLimitExceededError";
  }
}

/**
 * C.46 A8 — thrown by submitAmPrep when canEditReport returns canEdit=false
 * for an access reason (NOT cap — cap raises ChecklistEditLimitExceededError).
 *
 * Reason discriminator (internal-only; UI translates at render time per the
 * Phase 6 translation keys, never displays raw reason strings):
 *   - "closing_finalized_for_submitter" — sub-KH+ original submitter
 *     attempting to edit after closing has been finalized
 *   - "not_submitter_and_not_kh" — sub-KH+ user attempting to edit a chain
 *     they didn't originally submit
 *
 * Maps to HTTP 403.
 */
export class ChecklistEditAccessDeniedError extends PrepError {
  constructor(public readonly reason: string) {
    super(
      `ChecklistEditAccessDeniedError: ${reason}`,
      "edit_access_denied",
    );
    this.name = "ChecklistEditAccessDeniedError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-path: prep-aware narrowing + invariant assertion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Narrows a ChecklistTemplateItem's prepMeta from raw JSONB to typed PrepMeta
 * AND asserts the station/section sync invariant per C.18 + C.38.
 *
 * Behavior:
 *   - cleaning item (prepMeta null, station not section-shaped): pass through
 *   - prepMeta non-null + valid + section matches station: pass through
 *   - prepMeta non-null + invalid shape: throws PrepShapeError
 *   - prepMeta non-null + section !== station: emits prep.snapshot_drift
 *     audit (forensic) AND throws PrepInvariantError
 *   - prepMeta null but station matches a known section: warn-only (defensive
 *     branch; should not fire for current data)
 */
export function narrowPrepTemplateItem(item: ChecklistTemplateItem): ChecklistTemplateItem {
  if (item.prepMeta === null) {
    if (isPrepSection(item.station)) {
      // Defensive warn-only branch (per locked surface decision): cleaning
      // template item that happens to use a section name as its station.
      // Should not fire for current data — Standard Closing v1 stations are
      // "Crunchy Boi Station" / "Walk-Out Verification" etc., none match
      // PrepSection. If it ever fires, the seed/admin write-path didn't
      // populate prep_meta when it should have.
      console.warn(
        `[prep] narrowPrepTemplateItem: template_item ${item.id} has section-shaped station "${item.station}" but no prep_meta; possible write-path bug.`,
      );
    }
    return item;
  }

  if (!isPrepMeta(item.prepMeta)) {
    throw new PrepShapeError(item.id, "prepMeta failed isPrepMeta()");
  }

  if (item.prepMeta.section !== item.station) {
    // Forensic audit + strict throw. The audit is fire-and-forget (audit()
    // never throws by design); the PrepInvariantError throw is what blocks
    // the caller. Calling code should never catch+swallow this — drift
    // means setPrepItemSection() was bypassed.
    void audit({
      actorId: null,
      actorRole: null,
      action: "prep.snapshot_drift",
      resourceTable: "checklist_template_items",
      resourceId: item.id,
      metadata: {
        station: item.station,
        meta_section: item.prepMeta.section,
        cause: "prepMeta.section !== station; likely a write-path bypass of setPrepItemSection()",
      },
      ipAddress: null,
      userAgent: null,
    });
    throw new PrepInvariantError(item.id, item.station, item.prepMeta.section);
  }

  return item;
}

/**
 * Narrows a ChecklistCompletion's prepData from raw JSONB to typed PrepData.
 * No invariant on snapshot — snapshots are intentionally frozen at
 * submission time per C.44, so they may legitimately differ from current
 * template state (that's the whole point of the snapshot).
 */
export function narrowPrepCompletion(completion: ChecklistCompletion): ChecklistCompletion {
  if (completion.prepData === null) return completion;
  if (!isPrepData(completion.prepData)) {
    throw new PrepShapeError(completion.templateItemId, "prepData failed isPrepData()");
  }
  return completion;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write-path: drift-prevention helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single helper for setting a prep template item's section. Writes BOTH
 * station AND prep_meta.section in one atomic UPDATE. Section names stay
 * in sync by construction.
 *
 * USE FROM: seed scripts, GM admin tool (Build #2 follow-up PR).
 * NEVER write to station or prep_meta.section directly outside this helper
 * — the read-path invariant (narrowPrepTemplateItem) throws on drift.
 *
 * Operates against service-role: seed runs pre-auth, admin paths run
 * elevated. RLS already prevents non-admin writes.
 */
export async function setPrepItemSection(
  service: SupabaseClient,
  args: {
    templateItemId: string;
    section: PrepSection;
  },
): Promise<void> {
  // Read existing prep_meta to merge the section field (preserve other fields).
  const { data: existing, error: readErr } = await service
    .from("checklist_template_items")
    .select("prep_meta")
    .eq("id", args.templateItemId)
    .maybeSingle<{ prep_meta: unknown }>();
  if (readErr) {
    throw new Error(
      `setPrepItemSection: load template_item ${args.templateItemId}: ${readErr.message}`,
    );
  }
  if (!existing) {
    throw new Error(`setPrepItemSection: template_item ${args.templateItemId} not found`);
  }

  // Build the merged prep_meta. If existing is null/invalid, we initialize
  // with the section + safe defaults; caller is expected to set the rest
  // via setPrepItemMeta().
  const baseMeta: PrepMeta = isPrepMeta(existing.prep_meta)
    ? existing.prep_meta
    : {
        section: args.section,
        parValue: null,
        parUnit: null,
        specialInstruction: null,
        columns: [],
      };
  const nextMeta: PrepMeta = { ...baseMeta, section: args.section };

  const { error: updateErr } = await service
    .from("checklist_template_items")
    .update({
      station: args.section,
      prep_meta: nextMeta,
    })
    .eq("id", args.templateItemId);
  if (updateErr) {
    throw new Error(
      `setPrepItemSection: update template_item ${args.templateItemId}: ${updateErr.message}`,
    );
  }
}

/**
 * Sets the full prepMeta JSONB blob. Asserts that args.meta.section equals
 * the row's existing station BEFORE writing. To change section, call
 * setPrepItemSection() first. Or use seedPrepItem() for combined create.
 */
export async function setPrepItemMeta(
  service: SupabaseClient,
  args: {
    templateItemId: string;
    meta: PrepMeta;
  },
): Promise<void> {
  const { data: existing, error: readErr } = await service
    .from("checklist_template_items")
    .select("station")
    .eq("id", args.templateItemId)
    .maybeSingle<{ station: string | null }>();
  if (readErr) {
    throw new Error(
      `setPrepItemMeta: load template_item ${args.templateItemId}: ${readErr.message}`,
    );
  }
  if (!existing) {
    throw new Error(`setPrepItemMeta: template_item ${args.templateItemId} not found`);
  }
  if (existing.station !== args.meta.section) {
    throw new PrepInvariantError(args.templateItemId, existing.station, args.meta.section);
  }

  const { error: updateErr } = await service
    .from("checklist_template_items")
    .update({ prep_meta: args.meta })
    .eq("id", args.templateItemId);
  if (updateErr) {
    throw new Error(
      `setPrepItemMeta: update template_item ${args.templateItemId}: ${updateErr.message}`,
    );
  }
}

/**
 * Convenience for seed/admin: creates a prep template item with everything
 * set in one INSERT. Asserts args.section === args.meta.section by
 * construction (we build the full PrepMeta from args.section + args.meta).
 */
export async function seedPrepItem(
  service: SupabaseClient,
  args: {
    templateId: string;
    displayOrder: number;
    section: PrepSection;
    label: string;
    description: string | null;
    minRoleLevel: number;
    required?: boolean;
    meta: Omit<PrepMeta, "section">;
    translations?: ChecklistTemplateItemTranslations;
  },
): Promise<{ templateItemId: string }> {
  const fullMeta: PrepMeta = { ...args.meta, section: args.section };
  const { data, error } = await service
    .from("checklist_template_items")
    .insert({
      template_id: args.templateId,
      display_order: args.displayOrder,
      // Station is the system-key column; section is the typed accessor.
      // setPrepItemSection's invariant requires they match — we satisfy it
      // here by construction.
      station: args.section,
      label: args.label,
      description: args.description,
      min_role_level: args.minRoleLevel,
      required: args.required ?? true,
      expects_count: false,
      expects_photo: false,
      vendor_item_id: null,
      active: true,
      translations: args.translations ?? null,
      prep_meta: fullMeta,
      report_reference_type: null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    throw new Error(`seedPrepItem: insert failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(`seedPrepItem: insert returned no row`);
  }
  return { templateItemId: data.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read loaders
// ─────────────────────────────────────────────────────────────────────────────

interface InstanceRow {
  id: string;
  template_id: string;
  location_id: string;
  date: string;
  shift_start_at: string | null;
  status: ChecklistInstance["status"];
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  triggered_by_user_id: string | null;
  triggered_at: string | null;
}

interface TemplateItemRow {
  id: string;
  template_id: string;
  station: string | null;
  display_order: number;
  label: string;
  description: string | null;
  min_role_level: number;
  required: boolean;
  expects_count: boolean;
  expects_photo: boolean;
  vendor_item_id: string | null;
  active: boolean;
  translations: ChecklistTemplateItemTranslations | null;
  prep_meta: unknown | null;
  report_reference_type: ReportType | null;
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
  revocation_reason: ChecklistCompletion["revocationReason"];
  revocation_note: string | null;
  actual_completer_id: string | null;
  actual_completer_tagged_at: string | null;
  actual_completer_tagged_by: string | null;
  prep_data: unknown | null;
  auto_complete_meta: unknown | null;
}

const INSTANCE_COLUMNS =
  "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at, triggered_by_user_id, triggered_at";

const TEMPLATE_ITEM_COLUMNS =
  "id, template_id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, vendor_item_id, active, translations, prep_meta, report_reference_type";

const COMPLETION_COLUMNS =
  "id, instance_id, template_item_id, completed_by, completed_at, count_value, photo_id, notes, superseded_at, superseded_by, revoked_at, revoked_by, revocation_reason, revocation_note, actual_completer_id, actual_completer_tagged_at, actual_completer_tagged_by, prep_data, auto_complete_meta";

function rowToInstance(r: InstanceRow): ChecklistInstance {
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
  };
}

function rowToTemplateItem(r: TemplateItemRow): ChecklistTemplateItem {
  return {
    id: r.id,
    templateId: r.template_id,
    station: r.station,
    displayOrder: r.display_order,
    label: r.label,
    description: r.description,
    minRoleLevel: r.min_role_level,
    required: r.required,
    expectsCount: r.expects_count,
    expectsPhoto: r.expects_photo,
    vendorItemId: r.vendor_item_id,
    active: r.active,
    translations: r.translations,
    prepMeta: (r.prep_meta ?? null) as PrepMeta | null,
    reportReferenceType: r.report_reference_type,
  };
}

function rowToCompletion(r: CompletionRow): ChecklistCompletion {
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
    prepData: (r.prep_data ?? null) as PrepData | null,
    autoCompleteMeta: (r.auto_complete_meta ?? null) as AutoCompleteMeta | null,
  };
}

/**
 * Loads everything an AM Prep page Server Component needs in one call.
 * Returns null when no AM Prep template exists at the location (empty-state
 * handling at the page).
 *
 * Uses service-role per C.24 (page-level reads pattern; matches dashboard
 * + closing/page.tsx).
 *
 * Get-or-creates the prep instance for (template, location, date) — same
 * idempotent pattern as lib/checklists.ts getOrCreateInstance, but
 * specialized for prep templates.
 */
export async function loadAmPrepState(
  service: SupabaseClient,
  args: {
    locationId: string;
    date: string;
    actor: PrepActor;
  },
): Promise<{
  template: { id: string; name: string };
  templateItems: ChecklistTemplateItem[];
  instance: ChecklistInstance;
  completions: ChecklistCompletion[];
  authors: Record<string, string>;
} | null> {
  // Resolve active AM Prep template (most-recent-active per Path A versioning).
  const { data: tmplRow, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id, name")
    .eq("location_id", args.locationId)
    .eq("type", "prep")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
  if (tmplErr) {
    throw new Error(`loadAmPrepState: load template: ${tmplErr.message}`);
  }
  if (!tmplRow) return null;

  // Get-or-create the prep instance for today.
  let instanceRow: InstanceRow | null = null;
  const { data: existing, error: readErr } = await service
    .from("checklist_instances")
    .select(INSTANCE_COLUMNS)
    .eq("template_id", tmplRow.id)
    .eq("location_id", args.locationId)
    .eq("date", args.date)
    .maybeSingle<InstanceRow>();
  if (readErr) throw new Error(`loadAmPrepState: read instance: ${readErr.message}`);

  if (existing) {
    instanceRow = existing;
  } else {
    const triggerTimestamp = new Date().toISOString();
    const { data: inserted, error: insertErr } = await service
      .from("checklist_instances")
      .insert({
        template_id: tmplRow.id,
        location_id: args.locationId,
        date: args.date,
        shift_start_at: triggerTimestamp,
        status: "open",
        triggered_by_user_id: args.actor.userId,
        triggered_at: triggerTimestamp,
      })
      .select(INSTANCE_COLUMNS)
      .maybeSingle<InstanceRow>();
    if (insertErr) {
      // Race-loss path: another caller won the INSERT (UNIQUE constraint
      // hit). Re-read.
      if (insertErr.code === "23505") {
        const { data: race, error: raceErr } = await service
          .from("checklist_instances")
          .select(INSTANCE_COLUMNS)
          .eq("template_id", tmplRow.id)
          .eq("location_id", args.locationId)
          .eq("date", args.date)
          .maybeSingle<InstanceRow>();
        if (raceErr || !race) {
          throw new Error(
            `loadAmPrepState: race re-read failed: ${raceErr?.message ?? "no row"}`,
          );
        }
        instanceRow = race;
      } else {
        throw new Error(`loadAmPrepState: insert instance: ${insertErr.message}`);
      }
    } else {
      if (!inserted) throw new Error(`loadAmPrepState: insert returned no row`);
      instanceRow = inserted;

      // Audit the create — symmetric with lib/checklists.ts getOrCreateInstance.
      void audit({
        actorId: args.actor.userId,
        actorRole: args.actor.role,
        action: "checklist_instance.create",
        resourceTable: "checklist_instances",
        resourceId: inserted.id,
        metadata: {
          template_id: tmplRow.id,
          location_id: args.locationId,
          date: args.date,
          template_type: "prep",
        },
        ipAddress: null,
        userAgent: null,
      });
    }
  }

  if (!instanceRow) {
    throw new Error(`loadAmPrepState: failed to resolve instance row`);
  }

  // Load template items, narrow each (throws on drift).
  const { data: itemsRows, error: itemsErr } = await service
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("template_id", tmplRow.id)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (itemsErr) throw new Error(`loadAmPrepState: load items: ${itemsErr.message}`);
  const templateItems = ((itemsRows ?? []) as TemplateItemRow[])
    .map(rowToTemplateItem)
    .map(narrowPrepTemplateItem);

  // Load live (non-superseded, non-revoked) completions for the instance.
  const { data: completionRows, error: compErr } = await service
    .from("checklist_completions")
    .select(COMPLETION_COLUMNS)
    .eq("instance_id", instanceRow.id)
    .is("superseded_at", null)
    .is("revoked_at", null);
  if (compErr) throw new Error(`loadAmPrepState: load completions: ${compErr.message}`);
  const completions = ((completionRows ?? []) as CompletionRow[])
    .map(rowToCompletion)
    .map(narrowPrepCompletion);

  // Resolve author names for completedBy + confirmedBy + triggeredBy.
  const authorIds = new Set<string>();
  for (const c of completions) authorIds.add(c.completedBy);
  if (instanceRow.confirmed_by) authorIds.add(instanceRow.confirmed_by);
  if (instanceRow.triggered_by_user_id) authorIds.add(instanceRow.triggered_by_user_id);
  const authors: Record<string, string> = {};
  if (authorIds.size > 0) {
    const { data: userRows, error: userErr } = await service
      .from("users")
      .select("id, name")
      .in("id", Array.from(authorIds));
    if (userErr) throw new Error(`loadAmPrepState: load authors: ${userErr.message}`);
    for (const u of (userRows ?? []) as Array<{ id: string; name: string }>) {
      authors[u.id] = u.name;
    }
  }

  return {
    template: tmplRow,
    templateItems,
    instance: rowToInstance(instanceRow),
    completions,
    authors,
  };
}

/**
 * Slim-shape lookup for the dashboard tile: returns the active assignment
 * for (assignee=user, reportType, location, date) if one exists. Used to
 * surface the AM Prep tile to a sub-KH user when an assignment exists.
 *
 * Service-role query (dashboard already uses service-role per C.24).
 */
export async function loadAssignmentForToday(
  service: SupabaseClient,
  args: {
    userId: string;
    reportType: ReportType;
    locationId: string;
    date: string;
  },
): Promise<{ assignmentId: string; note: string | null; assignerId: string } | null> {
  const { data, error } = await service
    .from("report_assignments")
    .select("id, note, assigner_id")
    .eq("assignee_id", args.userId)
    .eq("report_type", args.reportType)
    .eq("location_id", args.locationId)
    .eq("operational_date", args.date)
    .eq("active", true)
    .maybeSingle<{ id: string; note: string | null; assigner_id: string }>();
  if (error) {
    throw new Error(`loadAssignmentForToday: ${error.message}`);
  }
  if (!data) return null;
  return {
    assignmentId: data.id,
    note: data.note,
    assignerId: data.assigner_id,
  };
}

/**
 * Slim shape loader for the dashboard AM Prep tile. Distinct from
 * loadAmPrepState (which loads templateItems + completions for the page
 * surface) and loadAssignmentForToday (which is just the assignment row).
 *
 * Returns ONLY what the tile needs to render:
 *   - hasTemplate: drives the "no_template" tile state
 *   - todayInstance: drives the three visual states (not started / in
 *     progress / submitted) via instance.status
 *   - confirmedByName: pre-resolved name for the "Submitted at {time} by
 *     {name}" subtitle
 *   - assignment: pre-resolved with assigner name for the assignment
 *     indicator on sub-KH+ tiles
 *   - isVisibleToActor: hasBaseAccess || (assignment !== null) — single
 *     truth value for the dashboard's "should the tile render" gate
 *
 * The assignment join + assignerName lookup ONLY fire for sub-KH+ users
 * (caller passes in the actor.level and the function short-circuits
 * the assignment query when level >= AM_PREP_BASE_LEVEL). KH+ users
 * always have base access; the assignment field comes back as null for
 * them regardless of whether one exists in the DB.
 *
 * Does NOT load templateItems or completions — that's loadAmPrepState's
 * job for the page surface.
 */
export async function loadAmPrepDashboardState(
  service: SupabaseClient,
  args: {
    locationId: string;
    date: string;
    actor: PrepActor;
  },
): Promise<{
  hasTemplate: boolean;
  todayInstance: {
    id: string;
    status: ChecklistInstance["status"];
    confirmedAt: string | null;
    confirmedBy: string | null;
  } | null;
  confirmedByName: string | null;
  assignment: {
    assignmentId: string;
    note: string | null;
    assignerId: string;
    assignerName: string;
  } | null;
  isVisibleToActor: boolean;
}> {
  // Resolve active prep template for this location.
  const { data: tmplRow, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", "prep")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (tmplErr) throw new Error(`loadAmPrepDashboardState: load template: ${tmplErr.message}`);

  const hasTemplate = tmplRow !== null;

  // Today's instance (if any). No get-or-create — dashboard reads only.
  let todayInstance: {
    id: string;
    status: ChecklistInstance["status"];
    confirmedAt: string | null;
    confirmedBy: string | null;
  } | null = null;
  let confirmedByName: string | null = null;

  if (hasTemplate && tmplRow) {
    const { data: instRow, error: instErr } = await service
      .from("checklist_instances")
      .select("id, status, confirmed_at, confirmed_by")
      .eq("template_id", tmplRow.id)
      .eq("location_id", args.locationId)
      .eq("date", args.date)
      .maybeSingle<{
        id: string;
        status: ChecklistInstance["status"];
        confirmed_at: string | null;
        confirmed_by: string | null;
      }>();
    if (instErr) throw new Error(`loadAmPrepDashboardState: load instance: ${instErr.message}`);

    if (instRow) {
      todayInstance = {
        id: instRow.id,
        status: instRow.status,
        confirmedAt: instRow.confirmed_at,
        confirmedBy: instRow.confirmed_by,
      };

      // Resolve confirmedBy name for the subtitle ("Submitted at {time} by
      // {name}"). Single user lookup — cheap.
      if (instRow.confirmed_by) {
        const { data: userRow, error: userErr } = await service
          .from("users")
          .select("name")
          .eq("id", instRow.confirmed_by)
          .maybeSingle<{ name: string }>();
        if (userErr) {
          throw new Error(`loadAmPrepDashboardState: load confirmer name: ${userErr.message}`);
        }
        confirmedByName = userRow?.name ?? null;
      }
    }
  }

  // Assignment lookup — only fires for sub-KH+ actors (KH+ always have
  // base access; assignment row state is irrelevant for them). Saves a
  // query for the common KH+ case.
  let assignment: {
    assignmentId: string;
    note: string | null;
    assignerId: string;
    assignerName: string;
  } | null = null;

  const hasBaseAccess = args.actor.level >= AM_PREP_BASE_LEVEL;
  if (!hasBaseAccess) {
    const raw = await loadAssignmentForToday(service, {
      userId: args.actor.userId,
      reportType: "am_prep",
      locationId: args.locationId,
      date: args.date,
    });
    if (raw) {
      // Resolve assigner name for the "Assigned by {name}" indicator.
      const { data: assignerRow, error: assignerErr } = await service
        .from("users")
        .select("name")
        .eq("id", raw.assignerId)
        .maybeSingle<{ name: string }>();
      if (assignerErr) {
        throw new Error(
          `loadAmPrepDashboardState: load assigner name: ${assignerErr.message}`,
        );
      }
      assignment = {
        assignmentId: raw.assignmentId,
        note: raw.note,
        assignerId: raw.assignerId,
        // Defensive fallback — if assigner row got soft-deleted between
        // assignment-create and tile-render, fall back to em-dash rather
        // than break the tile.
        assignerName: assignerRow?.name ?? "—",
      };
    }
  }

  const isVisibleToActor = hasBaseAccess || assignment !== null;

  return {
    hasTemplate,
    todayInstance,
    confirmedByName,
    assignment,
    isVisibleToActor,
  };
}

/**
 * Resolves the closing's report-reference template item id for a given
 * report type at a location. Returns null when no closing template exists
 * OR when the active closing template doesn't carry the requested
 * report-reference (e.g., Standard Closing v2 hasn't been seeded yet).
 *
 * Caller passes the resulting id (or null) to submitAmPrep as
 * closingReportRefItemId — see RPC asymmetry note in migration 0041.
 */
export async function resolveClosingReportRefItemId(
  service: SupabaseClient,
  args: {
    locationId: string;
    reportType: ReportType;
  },
): Promise<string | null> {
  const { data: tmplRow, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", "closing")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (tmplErr) {
    throw new Error(`resolveClosingReportRefItemId: load template: ${tmplErr.message}`);
  }
  if (!tmplRow) return null;

  const { data: itemRow, error: itemErr } = await service
    .from("checklist_template_items")
    .select("id")
    .eq("template_id", tmplRow.id)
    .eq("report_reference_type", args.reportType)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (itemErr) {
    throw new Error(`resolveClosingReportRefItemId: load item: ${itemErr.message}`);
  }
  return itemRow?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission lifecycle
// ─────────────────────────────────────────────────────────────────────────────

interface SubmitRpcResult {
  instance: InstanceRow;
  submissionId: string;
  completionIds: string[];
  autoCompleteId: string | null;
  /** C.46 update path: edit_count of the new submission (0 on original; 1-3 on update). */
  editCount: number;
  /** C.46 update path: chain head submission id (null on original; FK on update). */
  originalSubmissionId: string | null;
}

/**
 * C.46 — diff helper. Computes per-column change discriminators between the
 * chain-resolved current state and the new submission entries. Result feeds
 * into the report.update audit row's metadata.changed_fields per A7.
 *
 * Format: `<column>:<itemSlug>` where slug = `itemName.toLowerCase().replace(/\s+/g, "_")`.
 * Examples: `"onHand:tuna_salad"`, `"yesNo:cook_bacon"`.
 *
 * Diff is server-side (NOT caller-passed) so concurrent edits between
 * form-load and submit are reflected accurately in the audit trail.
 *
 * Cost: 2 queries (chain submissions + their completions). Chain max length
 * is 4 entries × 32 items ≈ 128 rows worst case — bounded.
 */
async function computeChangedFields(
  service: SupabaseClient,
  originalSubmissionId: string,
  newEntries: Array<{ templateItemId: string; inputs: PrepInputs }>,
): Promise<string[]> {
  // 1. Load chain submissions to flatten their completion_ids.
  const { data: chainSubs, error: subsErr } = await service
    .from("checklist_submissions")
    .select("id, edit_count, completion_ids")
    .or(`id.eq.${originalSubmissionId},original_submission_id.eq.${originalSubmissionId}`)
    .order("edit_count", { ascending: true });
  if (subsErr) {
    throw new Error(`computeChangedFields: load chain submissions: ${subsErr.message}`);
  }

  const allCompletionIds: string[] = [];
  for (const s of (chainSubs ?? []) as Array<{ completion_ids: string[] }>) {
    for (const cid of s.completion_ids ?? []) allCompletionIds.push(cid);
  }
  if (allCompletionIds.length === 0) return [];

  // 2. Load completions; for each template_item_id, pick the one with max
  //    edit_count (chain-resolved current state per template_item).
  const { data: completions, error: cErr } = await service
    .from("checklist_completions")
    .select("id, template_item_id, prep_data, edit_count")
    .in("id", allCompletionIds);
  if (cErr) {
    throw new Error(`computeChangedFields: load completions: ${cErr.message}`);
  }

  type CurrentState = {
    inputs: PrepInputs;
    itemName: string;
    editCount: number;
  };
  const currentByItemId = new Map<string, CurrentState>();
  for (const c of (completions ?? []) as Array<{
    template_item_id: string;
    prep_data: unknown;
    edit_count: number;
  }>) {
    if (!isPrepData(c.prep_data)) continue;
    const existing = currentByItemId.get(c.template_item_id);
    if (!existing || c.edit_count > existing.editCount) {
      currentByItemId.set(c.template_item_id, {
        inputs: c.prep_data.inputs,
        itemName: c.prep_data.snapshot.itemName,
        editCount: c.edit_count,
      });
    }
  }

  // 3. Diff each new entry against chain-resolved current; emit per-column entries.
  const changed: string[] = [];
  for (const entry of newEntries) {
    const current = currentByItemId.get(entry.templateItemId);
    if (!current) continue;  // RPC's C.44 guard catches this; defensive skip here
    const slug = current.itemName.toLowerCase().replace(/\s+/g, "_");
    const prev = current.inputs;
    const next = entry.inputs;
    if (prev.onHand !== next.onHand) changed.push(`onHand:${slug}`);
    if (prev.portioned !== next.portioned) changed.push(`portioned:${slug}`);
    if (prev.line !== next.line) changed.push(`line:${slug}`);
    if (prev.backUp !== next.backUp) changed.push(`backUp:${slug}`);
    if (prev.total !== next.total) changed.push(`total:${slug}`);
    if (prev.yesNo !== next.yesNo) changed.push(`yesNo:${slug}`);
    if ((prev.freeText ?? "") !== (next.freeText ?? "")) changed.push(`freeText:${slug}`);
  }
  return changed;
}

/**
 * Submits an AM Prep instance atomically via the submit_am_prep_atomic RPC.
 *
 * Pre-flight authorization (per locked surface):
 *   - actor.level >= AM_PREP_BASE_LEVEL (4 = SL+ in implementation, "KH+"
 *     in C.42 spec text per C.41 documented divergence), OR
 *   - active report_assignment for (user, am_prep, location, date)
 *
 * RPC handles atomicity (per migration 0041): completions + submission +
 * instance confirm + closing auto-complete all in one transaction. Failure
 * at any step rolls everything back.
 *
 * Auto-complete behavior depends on closingReportRefItemId:
 *   - null  → no closing template / no am_prep ref item; skip auto-complete
 *             gracefully, return autoCompleteId: null
 *   - uuid + matching closing instance exists → auto-complete row written
 *   - uuid + no closing instance for today → RPC raises foreign_key_violation;
 *             we map to PrepAutoCompleteError and the prep submission rolls back
 *
 * Audit emission (post-RPC, JS-side for IP/UA capture):
 *   - prep.submit with metadata.outcome = 'success' (or per error path)
 */
export async function submitAmPrep(
  service: SupabaseClient,
  args: {
    instanceId: string;
    actor: PrepActor;
    entries: Array<{
      templateItemId: string;
      inputs: PrepInputs;
    }>;
    /** Looked up by caller from the closing template; null if absent. Ignored on update path (per C.46 A4). */
    closingReportRefItemId: string | null;
    /** Active assignment for the actor, if any (caller pre-resolves). Ignored on update path. */
    activeAssignmentId: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    /** C.46 A6: when true, this is a chained update against an existing submission. */
    isUpdate?: boolean;
    /** C.46 A6: chain head submission id; required when isUpdate=true. */
    originalSubmissionId?: string;
  },
): Promise<{
  instance: ChecklistInstance;
  submittedCompletionIds: string[];
  /** Always `null` on update path per C.46 A4 (closing auto-complete row untouched). */
  closingAutoCompleteId: string | null;
  /** C.46: edit_count of the new submission (0 on original; 1-3 on update). */
  editCount: number;
  /** C.46: chain head submission id (null on original; FK on update). */
  originalSubmissionId: string | null;
}> {
  // C.46 update path: delegate to submitAmPrepUpdate before the existing
  // original-submission flow. Original-submission flow is runtime-identical
  // for isUpdate=false (no behavior change on the default path; existing
  // 4-arg callers see undefined → false → branch skipped → original code).
  if (args.isUpdate) {
    if (!args.originalSubmissionId) {
      throw new Error(
        `submitAmPrep: originalSubmissionId required when isUpdate=true`,
      );
    }
    return submitAmPrepUpdate(service, {
      instanceId: args.instanceId,
      actor: args.actor,
      entries: args.entries,
      originalSubmissionId: args.originalSubmissionId,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
  }

  // 1. Authorization gate.
  const isAuthorized =
    args.actor.level >= AM_PREP_BASE_LEVEL || args.activeAssignmentId !== null;
  if (!isAuthorized) {
    void audit({
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: "prep.submit",
      resourceTable: "checklist_instances",
      resourceId: args.instanceId,
      metadata: {
        outcome: "role_insufficient",
        actor_level: args.actor.level,
        required_level: AM_PREP_BASE_LEVEL,
        had_assignment: false,
      },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
    throw new PrepRoleViolationError(
      `level >= ${AM_PREP_BASE_LEVEL} OR active assignment`,
      args.actor.level,
    );
  }

  // 2. Pre-flight: load the instance + template items so we can build snapshots
  //    per C.44. The RPC itself doesn't read template items — it just inserts
  //    completions with whatever snapshot we pass. Snapshot construction is
  //    JS-side because we have the typed PrepMeta from narrowPrepTemplateItem.
  const { data: instRow, error: instErr } = await service
    .from("checklist_instances")
    .select("id, template_id, location_id, date, status")
    .eq("id", args.instanceId)
    .maybeSingle<{
      id: string;
      template_id: string;
      location_id: string;
      date: string;
      status: ChecklistInstance["status"];
    }>();
  if (instErr) throw new Error(`submitAmPrep: load instance: ${instErr.message}`);
  if (!instRow) throw new Error(`submitAmPrep: instance ${args.instanceId} not found`);
  if (instRow.status !== "open") {
    throw new PrepInstanceNotOpenError(args.instanceId, instRow.status);
  }

  // 3. Load template items for this instance's template; narrow each.
  const { data: itemsRows, error: itemsErr } = await service
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("template_id", instRow.template_id)
    .eq("active", true);
  if (itemsErr) throw new Error(`submitAmPrep: load items: ${itemsErr.message}`);
  const itemsById = new Map<string, ChecklistTemplateItem>();
  for (const r of (itemsRows ?? []) as TemplateItemRow[]) {
    const narrowed = narrowPrepTemplateItem(rowToTemplateItem(r));
    itemsById.set(narrowed.id, narrowed);
  }

  // 4. Build entries with snapshot per C.44. Validate every templateItemId
  //    exists in this template AND is a prep item (prepMeta non-null).
  const rpcEntries = args.entries.map((entry) => {
    const item = itemsById.get(entry.templateItemId);
    if (!item) {
      throw new PrepShapeError(
        entry.templateItemId,
        `template_item not found in template ${instRow.template_id}`,
      );
    }
    if (!item.prepMeta) {
      throw new PrepShapeError(
        entry.templateItemId,
        `template_item is not a prep item (prepMeta is null)`,
      );
    }
    const snapshot: PrepSnapshot = {
      section: item.prepMeta.section,
      itemName: item.label,
      parValue: item.prepMeta.parValue,
      parUnit: item.prepMeta.parUnit,
      specialInstruction: item.prepMeta.specialInstruction,
    };
    return {
      templateItemId: entry.templateItemId,
      inputs: entry.inputs,
      snapshot,
    };
  });

  // 5. Invoke RPC. Single transaction; failure rolls back.
  const { data: rpcData, error: rpcErr } = await service.rpc("submit_am_prep_atomic", {
    p_prep_instance_id: args.instanceId,
    p_actor_id: args.actor.userId,
    p_entries: rpcEntries,
    p_closing_report_ref_item_id: args.closingReportRefItemId,
  });

  if (rpcErr) {
    // Map specific Postgres errcodes to typed PrepError subclasses.
    // foreign_key_violation = case (b) auto-complete failure (no closing
    // instance for today). check_violation = pessimistic guard tripped
    // (instance not open).
    if (rpcErr.code === "23503") {
      void audit({
        actorId: args.actor.userId,
        actorRole: args.actor.role,
        action: "prep.submit",
        resourceTable: "checklist_instances",
        resourceId: args.instanceId,
        metadata: {
          outcome: "auto_complete_failed",
          cause: "no closing instance for operational date",
          closing_report_ref_item_id: args.closingReportRefItemId,
          rpc_error: rpcErr.message,
        },
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      });
      throw new PrepAutoCompleteError(
        args.instanceId,
        args.closingReportRefItemId,
        rpcErr.message,
      );
    }
    if (rpcErr.code === "23514") {
      void audit({
        actorId: args.actor.userId,
        actorRole: args.actor.role,
        action: "prep.submit",
        resourceTable: "checklist_instances",
        resourceId: args.instanceId,
        metadata: {
          outcome: "instance_not_open",
          cause: "concurrent confirm or instance state changed",
          rpc_error: rpcErr.message,
        },
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      });
      throw new PrepInstanceNotOpenError(args.instanceId, "concurrent_close");
    }
    throw new Error(`submitAmPrep: RPC failed: ${rpcErr.message}`);
  }

  if (!rpcData) {
    throw new Error(`submitAmPrep: RPC returned no data`);
  }
  const result = rpcData as SubmitRpcResult;

  // 6. Audit success.
  void audit({
    actorId: args.actor.userId,
    actorRole: args.actor.role,
    action: "prep.submit",
    resourceTable: "checklist_instances",
    resourceId: args.instanceId,
    metadata: {
      outcome: "success",
      submission_id: result.submissionId,
      completion_count: result.completionIds.length,
      had_assignment: args.activeAssignmentId !== null,
      assignment_id: args.activeAssignmentId,
      closing_report_ref_item_id: args.closingReportRefItemId,
      closing_auto_complete_id: result.autoCompleteId,
      report_type: "am_prep",
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return {
    instance: rowToInstance(result.instance),
    submittedCompletionIds: result.completionIds,
    closingAutoCompleteId: result.autoCompleteId,
    editCount: 0,
    originalSubmissionId: null,
  };
}

/**
 * C.46 A6 update-path implementation. Called by submitAmPrep when isUpdate=true.
 *
 * Flow:
 *   1. Load chain head submission for access predicate input
 *   2. Load max edit_count across chain
 *   3. Load closing instance status for access predicate input
 *   4. canEditReport gate — throw ChecklistEditAccessDeniedError or
 *      ChecklistEditLimitExceededError based on reason discriminator
 *   5. Load chain head completions; inherit their snapshots verbatim (Option B
 *      per C.46 A6 + C.44 — chain represents one logical submission for the
 *      date; pars/sections don't drift mid-chain even if C.44 admin tooling
 *      edits the live template between original submission and the update)
 *   6. computeChangedFields (server-side diff against chain-resolved current)
 *   7. Invoke RPC with is_update=true + chain head id + changed_fields
 *   8. Map RPC errors:
 *        - P0001 → ChecklistEditLimitExceededError (race past lib pre-check)
 *        - check_violation → PrepShapeError (template_item not in chain head;
 *          C.44 alignment guard)
 *        - foreign_key_violation → generic Error (chain head not found —
 *          shouldn't happen since we just loaded it)
 *   9. Return; NO JS-side success audit (RPC emits report.update inside its
 *      transaction per A7).
 */
async function submitAmPrepUpdate(
  service: SupabaseClient,
  args: {
    instanceId: string;
    actor: PrepActor;
    entries: Array<{ templateItemId: string; inputs: PrepInputs }>;
    originalSubmissionId: string;
    ipAddress: string | null;
    userAgent: string | null;
  },
): Promise<{
  instance: ChecklistInstance;
  submittedCompletionIds: string[];
  closingAutoCompleteId: string | null;
  editCount: number;
  originalSubmissionId: string | null;
}> {
  // 1. Load chain head submission. Pull completion_ids too so we can fetch
  //    the head's snapshot rows in one extra round trip (C.46 A6 + C.44:
  //    update inherits chain head's snapshot exactly — see step 5b).
  const { data: chainHeadRow, error: chainErr } = await service
    .from("checklist_submissions")
    .select("id, submitted_by, submitted_at, instance_id, original_submission_id, completion_ids")
    .eq("id", args.originalSubmissionId)
    .maybeSingle<{
      id: string;
      submitted_by: string;
      submitted_at: string;
      instance_id: string;
      original_submission_id: string | null;
      completion_ids: string[];
    }>();
  if (chainErr) {
    throw new Error(`submitAmPrep: load chain head: ${chainErr.message}`);
  }
  if (!chainHeadRow) {
    throw new Error(
      `submitAmPrep: chain head ${args.originalSubmissionId} not found`,
    );
  }
  if (chainHeadRow.original_submission_id !== null) {
    throw new Error(
      `submitAmPrep: ${args.originalSubmissionId} is an update row, not a chain head`,
    );
  }
  if (chainHeadRow.instance_id !== args.instanceId) {
    throw new Error(
      `submitAmPrep: chain head ${args.originalSubmissionId} is for instance ${chainHeadRow.instance_id}, not ${args.instanceId}`,
    );
  }

  // 2. Load max edit_count across chain.
  const { data: chainCounts, error: countErr } = await service
    .from("checklist_submissions")
    .select("edit_count")
    .or(
      `id.eq.${args.originalSubmissionId},original_submission_id.eq.${args.originalSubmissionId}`,
    );
  if (countErr) {
    throw new Error(`submitAmPrep: load chain edit counts: ${countErr.message}`);
  }
  const editCounts = ((chainCounts ?? []) as Array<{ edit_count: number }>).map(
    (r) => r.edit_count,
  );
  const currentEditCount = editCounts.length === 0 ? 0 : Math.max(...editCounts);

  // 3. Load prep instance (location/date for closing lookup) + closing status.
  const { data: instRow, error: instErr } = await service
    .from("checklist_instances")
    .select("id, template_id, location_id, date, status")
    .eq("id", args.instanceId)
    .maybeSingle<{
      id: string;
      template_id: string;
      location_id: string;
      date: string;
      status: ChecklistInstance["status"];
    }>();
  if (instErr) throw new Error(`submitAmPrep: load instance: ${instErr.message}`);
  if (!instRow) {
    throw new Error(`submitAmPrep: instance ${args.instanceId} not found`);
  }

  // Safer two-step pattern (per AGENTS.md PostgREST embedded-select gotcha):
  // first get closing template ids at the location, then look up the instance.
  const { data: closingTemplates, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id")
    .eq("location_id", instRow.location_id)
    .eq("type", "closing")
    .eq("active", true);
  if (tmplErr) {
    throw new Error(`submitAmPrep: load closing templates: ${tmplErr.message}`);
  }
  const closingTemplateIds = (
    (closingTemplates ?? []) as Array<{ id: string }>
  ).map((t) => t.id);

  let closingStatus: ChecklistInstance["status"] | null = null;
  if (closingTemplateIds.length > 0) {
    const { data: closingInst, error: cInstErr } = await service
      .from("checklist_instances")
      .select("status")
      .in("template_id", closingTemplateIds)
      .eq("date", instRow.date)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ status: ChecklistInstance["status"] }>();
    if (cInstErr) {
      throw new Error(`submitAmPrep: load closing instance: ${cInstErr.message}`);
    }
    closingStatus = closingInst?.status ?? null;
  }

  // 4. Access predicate (canEditReport from lib/checklists.ts).
  const access = canEditReport({
    actor: { userId: args.actor.userId, level: args.actor.level },
    originalSubmitterId: chainHeadRow.submitted_by,
    closingStatus,
    currentEditCount,
  });

  if (!access.canEdit) {
    void audit({
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: "prep.submit",
      resourceTable: "checklist_instances",
      resourceId: args.instanceId,
      metadata: {
        outcome: "update_denied",
        reason: access.reason,
        original_submission_id: args.originalSubmissionId,
        original_submitter_id: chainHeadRow.submitted_by,
        closing_status: closingStatus,
        current_edit_count: currentEditCount,
        report_type: "am_prep",
      },
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });
    if (access.reason === "cap_exceeded") {
      throw new ChecklistEditLimitExceededError(
        args.originalSubmissionId,
        currentEditCount,
      );
    }
    throw new ChecklistEditAccessDeniedError(access.reason);
  }

  // 5. Load chain head completions to inherit their snapshots verbatim.
  //    Per C.46 A6 + C.44: update path inherits chain head's snapshot rather
  //    than rebuilding from live template. The chain represents one logical
  //    submission for the date; pars/sections shouldn't drift mid-chain even
  //    if the C.44 admin tooling edits the live template between original
  //    submission and the update. Skips the loadTemplateItems +
  //    narrowPrepTemplateItem step entirely on update path — the head
  //    snapshot was already validated at original submission time.
  const { data: headCompletions, error: headCompErr } = await service
    .from("checklist_completions")
    .select("template_item_id, prep_data")
    .in("id", chainHeadRow.completion_ids);
  if (headCompErr) {
    throw new Error(`submitAmPrep: load chain head completions: ${headCompErr.message}`);
  }
  const headSnapshotsByItemId = new Map<string, PrepSnapshot>();
  for (const c of (headCompletions ?? []) as Array<{
    template_item_id: string;
    prep_data: unknown;
  }>) {
    if (!isPrepData(c.prep_data)) continue;
    headSnapshotsByItemId.set(c.template_item_id, c.prep_data.snapshot);
  }

  // Build rpcEntries using chain head snapshots. Any entry whose
  // template_item_id isn't in the chain head's completions is rejected here
  // (the RPC's C.44 alignment guard would catch it too, but we surface the
  // typed error early with better forensic detail).
  const rpcEntries = args.entries.map((entry) => {
    const headSnapshot = headSnapshotsByItemId.get(entry.templateItemId);
    if (!headSnapshot) {
      throw new PrepShapeError(
        entry.templateItemId,
        `template_item not found in chain head submission ${args.originalSubmissionId} (C.44 alignment)`,
      );
    }
    return {
      templateItemId: entry.templateItemId,
      inputs: entry.inputs,
      snapshot: headSnapshot,
    };
  });

  // 6. Compute changed_fields server-side against chain-resolved current.
  const changedFields = await computeChangedFields(
    service,
    args.originalSubmissionId,
    args.entries,
  );

  // 7. Invoke RPC with update params. Single transaction; failure rolls back.
  const { data: rpcData, error: rpcErr } = await service.rpc(
    "submit_am_prep_atomic",
    {
      p_prep_instance_id: args.instanceId,
      p_actor_id: args.actor.userId,
      p_entries: rpcEntries,
      p_closing_report_ref_item_id: null,
      p_is_update: true,
      p_original_submission_id: args.originalSubmissionId,
      p_changed_fields: changedFields,
      p_ip_address: args.ipAddress,
      p_user_agent: args.userAgent,
    },
  );

  if (rpcErr) {
    // Audit failure (RPC didn't get to write its own audit row).
    void audit({
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: "prep.submit",
      resourceTable: "checklist_instances",
      resourceId: args.instanceId,
      metadata: {
        outcome: "update_rpc_failed",
        original_submission_id: args.originalSubmissionId,
        rpc_error_code: rpcErr.code,
        rpc_error: rpcErr.message,
        report_type: "am_prep",
      },
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });

    // P0001 = application-defined exception — RPC raises this when the
    // post-lock cap check sees edit_count >= 3 (race past lib pre-check).
    if (rpcErr.code === "P0001") {
      throw new ChecklistEditLimitExceededError(
        args.originalSubmissionId,
        currentEditCount,
      );
    }
    // check_violation = chain shape violation OR template_item_id in entries
    // not present in chain head's completions (C.44 alignment guard).
    if (rpcErr.code === "23514") {
      throw new PrepShapeError(
        args.originalSubmissionId,
        `RPC chain validation failed: ${rpcErr.message}`,
      );
    }
    // foreign_key_violation = chain head not found (shouldn't happen since
    // we just loaded it; race with concurrent delete, which is impossible
    // under append-only philosophy).
    throw new Error(`submitAmPrep: update RPC failed: ${rpcErr.message}`);
  }

  if (!rpcData) {
    throw new Error(`submitAmPrep: update RPC returned no data`);
  }
  const result = rpcData as SubmitRpcResult;

  // 8. NO JS-side success audit on update path. RPC emitted report.update
  //    inside its transaction (per C.46 A7) atomically with the chain write.

  return {
    instance: rowToInstance(result.instance),
    submittedCompletionIds: result.completionIds,
    closingAutoCompleteId: null,  // per A4: update path doesn't touch closing auto-complete
    editCount: result.editCount,
    originalSubmissionId: result.originalSubmissionId,
  };
}

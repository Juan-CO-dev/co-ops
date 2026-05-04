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
 * Authorization note (per C.41 documented divergence): "KH+" in C.42 maps
 * to level >= 4 in current implementation (SL+) — same convention as the
 * closing finalize gate per C.26. When Module #2 reconciles per C.41,
 * both gates move together.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "./audit";
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

function isPrepInputs(value: unknown): value is PrepInputs {
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
    /** Looked up by caller from the closing template; null if absent. */
    closingReportRefItemId: string | null;
    /** Active assignment for the actor, if any (caller pre-resolves). */
    activeAssignmentId: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{
  instance: ChecklistInstance;
  submittedCompletionIds: string[];
  closingAutoCompleteId: string | null;
}> {
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
  };
}

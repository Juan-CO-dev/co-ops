/**
 * Opening Report Phase 1 lifecycle — Build #3 PR 2.
 *
 * Mirrors lib/prep.ts shape. Three primary public functions:
 *   - loadOpeningState         — Server Component data loader (page.tsx)
 *   - submitOpening            — invokes submit_opening_atomic RPC
 *   - resolveClosingOpeningVerifiedRefItemId — finds closing(N-1)'s
 *                                "Opening verified" item id for the
 *                                cross-reference auto-completion target
 *
 * Plus typed errors that route handlers translate to HTTP shapes via
 * mapOpeningError (app/api/opening/_helpers.ts).
 *
 * Design references:
 *   - BUILD_3_OPENING_REPORT_DESIGN.md §2 (Phase 1 verification)
 *   - SPEC_AMENDMENTS.md C.42 (auto-completion mechanic), C.49
 *     (closing v2 + opening v1 templates), C.46 (chained edit forward-
 *     compat; PR 2 doesn't ship edit UI but RPC supports it)
 *
 * Atomicity: submit_opening_atomic RPC handles 44 completion inserts +
 * submission row + instance status transition + closing auto-complete
 * in a single transaction. Failure at any step rolls everything back.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "./audit";
import {
  COMPLETION_COLUMNS,
  INSTANCE_COLUMNS,
  type CompletionRow,
  type InstanceRow,
  rowToCompletion,
  rowToInstance,
} from "./checklist-rows";
import type { RoleCode } from "./roles";
import type {
  ChecklistCompletion,
  ChecklistInstance,
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Actor + role gate
// ─────────────────────────────────────────────────────────────────────────────

export interface OpeningActor {
  userId: string;
  role: RoleCode;
  level: number;
}

/**
 * KH+ minimum per C.41 reconciliation. All opening template items have
 * min_role_level=3; this base level matches.
 */
export const OPENING_BASE_LEVEL = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Typed errors
// ─────────────────────────────────────────────────────────────────────────────

export class OpeningError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "OpeningError";
  }
}

export class OpeningRoleViolationError extends OpeningError {
  constructor(
    public readonly required: number,
    public readonly actual: number,
  ) {
    super(
      `Role level ${actual} is below required ${required} for opening submission.`,
      "role_level_insufficient",
    );
    this.name = "OpeningRoleViolationError";
  }
}

export class OpeningInstanceNotOpenError extends OpeningError {
  constructor(
    public readonly instanceId: string,
    public readonly status: string,
  ) {
    super(
      `Opening instance ${instanceId} is ${status}; only open instances accept submission.`,
      "instance_not_open",
    );
    this.name = "OpeningInstanceNotOpenError";
  }
}

export class OpeningAutoCompleteError extends OpeningError {
  constructor(
    public readonly openingInstanceId: string,
    public readonly closingReportRefItemId: string,
    public readonly cause: string,
  ) {
    super(
      `Opening auto-complete failed for opening instance ${openingInstanceId} → closing ref item ${closingReportRefItemId}: ${cause}`,
      "auto_complete_failed",
    );
    this.name = "OpeningAutoCompleteError";
  }
}

export class OpeningMissingCountError extends OpeningError {
  constructor(public readonly templateItemId: string) {
    super(
      `Item ${templateItemId} requires a count value (fridge temp reading).`,
      "missing_count",
    );
    this.name = "OpeningMissingCountError";
  }
}

export class OpeningEntryShapeError extends OpeningError {
  constructor(public readonly reason: string) {
    super(`Invalid opening entry shape: ${reason}`, "invalid_entry_shape");
    this.name = "OpeningEntryShapeError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry shape — what the form sends per item
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-item entry shape for opening Phase 1 submission. Top-level columns
 * (count_value, photo_id, notes) — no prep_data JSONB because opening
 * Phase 1 has nothing prep-shaped.
 *
 * Form state in opening-client.tsx tracks the same shape plus a `ticked`
 * boolean for the per-station gate; the `ticked` field stays client-side
 * (every entry sent to the RPC IS ticked, by definition of the submit
 * gate enforcing "all 44 ticked before submit enables").
 */
export interface OpeningEntry {
  templateItemId: string;
  /** Populated for the 8 fridge temp items (template_item.expects_count=true). NULL otherwise. */
  countValue: number | null;
  /** Optional discrepancy photo. Always null in PR 2 (Phase 6 wires the upload). */
  photoId: string | null;
  /** Optional discrepancy comment. NULL when none. */
  notes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapper helpers — opening-specific TemplateItemRow only.
// InstanceRow / CompletionRow / column constants are shared via
// lib/checklist-rows.ts (Build #3 cleanup PR consolidation).
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_ITEM_COLUMNS =
  "id, template_id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, vendor_item_id, active, translations, prep_meta, report_reference_type";

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
  report_reference_type: string | null;
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
    prepMeta: null, // opening items have no prep_meta
    reportReferenceType: null, // opening items don't reference other reports (closing references opening, not vice versa)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// loadOpeningState — Server Component data loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads everything an Opening page Server Component needs in one call.
 * Returns null when no Standard Opening template exists at the location
 * (empty-state handling at the page).
 *
 * Get-or-creates the opening instance for (template, location, date) —
 * same idempotent pattern as lib/prep.ts loadAmPrepState. Race-loss path
 * via 23505 unique-violation re-read.
 */
export async function loadOpeningState(
  service: SupabaseClient,
  args: {
    locationId: string;
    date: string;
    actor: OpeningActor;
  },
): Promise<{
  template: { id: string; name: string };
  templateItems: ChecklistTemplateItem[];
  instance: ChecklistInstance;
  completions: ChecklistCompletion[];
  authors: Record<string, string>;
} | null> {
  // Resolve active opening template (most-recent-active per Path A versioning).
  const { data: tmplRow, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id, name")
    .eq("location_id", args.locationId)
    .eq("type", "opening")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
  if (tmplErr) {
    throw new Error(`loadOpeningState: load template: ${tmplErr.message}`);
  }
  if (!tmplRow) return null;

  // Get-or-create the opening instance for today.
  let instanceRow: InstanceRow | null = null;
  const { data: existing, error: readErr } = await service
    .from("checklist_instances")
    .select(INSTANCE_COLUMNS)
    .eq("template_id", tmplRow.id)
    .eq("location_id", args.locationId)
    .eq("date", args.date)
    .maybeSingle<InstanceRow>();
  if (readErr) throw new Error(`loadOpeningState: read instance: ${readErr.message}`);

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
      // Race-loss path: another caller won the INSERT. Re-read.
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
            `loadOpeningState: race re-read failed: ${raceErr?.message ?? "no row"}`,
          );
        }
        instanceRow = race;
      } else {
        throw new Error(`loadOpeningState: insert instance: ${insertErr.message}`);
      }
    } else {
      if (!inserted) throw new Error(`loadOpeningState: insert returned no row`);
      instanceRow = inserted;

      // Audit the instance creation — symmetric with prep + checklists patterns.
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
          template_type: "opening",
        },
        ipAddress: null,
        userAgent: null,
      });
    }
  }

  if (!instanceRow) {
    throw new Error(`loadOpeningState: failed to resolve instance row`);
  }

  // Load template items (active, ordered).
  const { data: itemsRows, error: itemsErr } = await service
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("template_id", tmplRow.id)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (itemsErr) throw new Error(`loadOpeningState: load items: ${itemsErr.message}`);
  const templateItems = ((itemsRows ?? []) as TemplateItemRow[]).map(rowToTemplateItem);

  // Load live (non-superseded, non-revoked) completions for the instance.
  const { data: completionRows, error: compErr } = await service
    .from("checklist_completions")
    .select(COMPLETION_COLUMNS)
    .eq("instance_id", instanceRow.id)
    .is("superseded_at", null)
    .is("revoked_at", null);
  if (compErr) throw new Error(`loadOpeningState: load completions: ${compErr.message}`);
  const completions = ((completionRows ?? []) as CompletionRow[]).map(rowToCompletion);

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
    if (userErr) throw new Error(`loadOpeningState: load authors: ${userErr.message}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// resolveClosingOpeningVerifiedRefItemId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds the active closing template's "Opening verified" item id at this
 * location (the cross-reference auto-completion target). Used by submit
 * route to pass into submit_opening_atomic.
 *
 * Returns NULL when no closing template OR no opening_report report-reference
 * item exists. RPC handles NULL gracefully (skips the auto-complete block;
 * matches first-ever-at-location semantics).
 */
export async function resolveClosingOpeningVerifiedRefItemId(
  service: SupabaseClient,
  args: { locationId: string },
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
    throw new Error(`resolveClosingOpeningVerifiedRefItemId: load template: ${tmplErr.message}`);
  }
  if (!tmplRow) return null;

  const { data: itemRow, error: itemErr } = await service
    .from("checklist_template_items")
    .select("id")
    .eq("template_id", tmplRow.id)
    .eq("report_reference_type", "opening_report")
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (itemErr) {
    throw new Error(`resolveClosingOpeningVerifiedRefItemId: load item: ${itemErr.message}`);
  }
  return itemRow?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// submitOpening — invoke submit_opening_atomic RPC
// ─────────────────────────────────────────────────────────────────────────────

interface SubmitRpcResult {
  instance: InstanceRow;
  submissionId: string;
  completionIds: string[];
  autoCompleteId: string | null;
  editCount: number;
  originalSubmissionId: string | null;
}

/**
 * Submits an opening Phase 1 instance atomically via submit_opening_atomic.
 *
 * Pre-flight authorization:
 *   - actor.level >= OPENING_BASE_LEVEL (3, KH+)
 *
 * RPC handles atomicity: completions + submission + instance confirm +
 * closing(N-1) auto-complete all in one transaction. Failure at any step
 * rolls everything back.
 *
 * Audit emission (post-RPC, JS-side for IP/UA capture):
 *   - opening.submit with metadata.outcome = 'success' (or per error path)
 *   - On C.46 update path (forward-compat; PR 2 doesn't ship edit UI),
 *     RPC emits report.update inside the transaction; lib emits
 *     opening.submit with metadata.outcome ∈ {update_denied, update_rpc_failed}
 *     on failure paths (PR 4+).
 */
export async function submitOpening(
  service: SupabaseClient,
  args: {
    instanceId: string;
    actor: OpeningActor;
    entries: OpeningEntry[];
    /** Resolved by caller from closing template; NULL if no prior closing exists. */
    closingReportRefItemId: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    /** C.46 A6: when true, this is a chained update against an existing submission. PR 4+ wires UI. */
    isUpdate?: boolean;
    originalSubmissionId?: string;
  },
): Promise<{
  instance: ChecklistInstance;
  submittedCompletionIds: string[];
  closingAutoCompleteId: string | null;
  editCount: number;
  originalSubmissionId: string | null;
}> {
  // Authorization gate (original-submission path; update path uses canEditReport
  // and is not in PR 2 scope).
  if (!args.isUpdate && args.actor.level < OPENING_BASE_LEVEL) {
    void audit({
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: "opening.submit",
      resourceTable: "checklist_instances",
      resourceId: args.instanceId,
      metadata: {
        outcome: "role_insufficient",
        required_level: OPENING_BASE_LEVEL,
        actual_level: args.actor.level,
      },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
    throw new OpeningRoleViolationError(OPENING_BASE_LEVEL, args.actor.level);
  }

  // Per-entry validation: count_value required for items that expect count.
  // (Defense-in-depth; the form should also enforce this client-side.)
  // Server-side validation iterates the ENTRIES array, not the source-of-truth
  // template — so it doesn't catch missing entries. The form is the
  // source-of-truth gate ("all 44 ticked"); the RPC is the second layer.
  for (const entry of args.entries) {
    if (entry.countValue !== null && typeof entry.countValue !== "number") {
      throw new OpeningEntryShapeError(
        `entry ${entry.templateItemId} countValue must be number or null`,
      );
    }
  }

  // Marshal entries for the RPC. count_value, photo_id, notes pass through
  // as JSON strings (RPC casts to numeric / uuid / text via NULLIF + cast).
  const rpcEntries = args.entries.map((e) => ({
    templateItemId: e.templateItemId,
    countValue: e.countValue === null ? "" : String(e.countValue),
    photoId: e.photoId ?? "",
    notes: e.notes ?? "",
  }));

  let rpcResult: SubmitRpcResult;
  try {
    const { data, error } = await service.rpc("submit_opening_atomic", {
      p_opening_instance_id: args.instanceId,
      p_actor_id: args.actor.userId,
      p_entries: rpcEntries,
      p_closing_report_ref_item_id: args.closingReportRefItemId,
      p_is_update: args.isUpdate ?? false,
      p_original_submission_id: args.originalSubmissionId ?? null,
      p_changed_fields: null,
      p_ip_address: args.ipAddress ?? null,
      p_user_agent: args.userAgent ?? null,
    });
    if (error) {
      // Map known RPC errors to typed exceptions.
      if (error.code === "23514") {
        // check_violation — instance not 'open'
        const msg = error.message.includes("not open")
          ? "instance_not_open"
          : "check_violation";
        if (msg === "instance_not_open") {
          void audit({
            actorId: args.actor.userId,
            actorRole: args.actor.role,
            action: "opening.submit",
            resourceTable: "checklist_instances",
            resourceId: args.instanceId,
            metadata: {
              outcome: "instance_not_open",
              rpc_error: error.message,
            },
            ipAddress: args.ipAddress ?? null,
            userAgent: args.userAgent ?? null,
          });
          throw new OpeningInstanceNotOpenError(args.instanceId, "not_open");
        }
      }
      if (error.code === "23503") {
        // foreign_key_violation — auto-complete failed (no closing instance at N-1)
        void audit({
          actorId: args.actor.userId,
          actorRole: args.actor.role,
          action: "opening.submit",
          resourceTable: "checklist_instances",
          resourceId: args.instanceId,
          metadata: {
            outcome: "auto_complete_failed",
            rpc_error: error.message,
            closing_report_ref_item_id: args.closingReportRefItemId,
          },
          ipAddress: args.ipAddress ?? null,
          userAgent: args.userAgent ?? null,
        });
        throw new OpeningAutoCompleteError(
          args.instanceId,
          args.closingReportRefItemId ?? "<null>",
          error.message,
        );
      }
      throw new Error(`submit_opening_atomic rpc: ${error.message}`);
    }
    if (!data || typeof data !== "object") {
      throw new Error(`submit_opening_atomic rpc: empty result`);
    }
    rpcResult = data as SubmitRpcResult;
  } catch (err) {
    if (err instanceof OpeningError) throw err;
    void audit({
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: "opening.submit",
      resourceTable: "checklist_instances",
      resourceId: args.instanceId,
      metadata: {
        outcome: "rpc_failed",
        rpc_error: err instanceof Error ? err.message : String(err),
      },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
    throw err;
  }

  // Success — emit opening.submit audit row (original-submission path only;
  // update path emits report.update inside the RPC per C.46 A7).
  if (!args.isUpdate) {
    void audit({
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: "opening.submit",
      resourceTable: "checklist_instances",
      resourceId: args.instanceId,
      metadata: {
        outcome: "success",
        submission_id: rpcResult.submissionId,
        completion_count: rpcResult.completionIds.length,
        auto_complete_id: rpcResult.autoCompleteId,
        closing_report_ref_item_id: args.closingReportRefItemId,
      },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });
  }

  return {
    instance: rowToInstance(rpcResult.instance),
    submittedCompletionIds: rpcResult.completionIds,
    closingAutoCompleteId: rpcResult.autoCompleteId,
    editCount: rpcResult.editCount,
    originalSubmissionId: rpcResult.originalSubmissionId,
  };
}

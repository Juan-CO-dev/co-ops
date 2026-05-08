/**
 * Opening Report Phase 1 + Phase 2 lifecycle — Build #3 PR 2 + PR 3.
 *
 * Mirrors lib/prep.ts shape. Four primary public functions:
 *   - loadOpeningState         — Server Component data loader (page.tsx)
 *   - submitOpening            — invokes submit_opening_atomic RPC
 *   - resolveClosingOpeningVerifiedRefItemId — finds closing(N-1)'s
 *                                "Opening verified" item id for the
 *                                cross-reference auto-completion target
 *   - loadCloserEstimateSnapshots — Phase 2 closer-estimate resolver;
 *                                reads canonical (chain-resolved via
 *                                C.46 MAX(edit_count)) AM Prep snapshot
 *                                per opening Phase 2 item
 *
 * Plus typed errors that route handlers translate to HTTP shapes via
 * mapOpeningError (app/api/opening/_helpers.ts).
 *
 * Design references:
 *   - BUILD_3_OPENING_REPORT_DESIGN.md §2 (Phase 1 verification), §3 (Phase 2)
 *   - SPEC_AMENDMENTS.md C.42 (auto-completion mechanic), C.49
 *     (closing v2 + opening v1 templates), C.46 (chained edit forward-
 *     compat; PR 2 doesn't ship edit UI but RPC supports it),
 *     C.50 PENDING (Phase 2 join key, notifications.priority,
 *     prep_data.phase2 runtime narrowing, C.46 chain coexistence)
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
import { isPrepData } from "./prep";
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
// Entry shape — what the form sends per item (discriminated union)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 1 entry — verification ticks + optional fridge temp counts +
 * optional discrepancy photo/comment. Top-level checklist_completion
 * columns (count_value, photo_id, notes); no prep_data JSONB.
 *
 * Form state in opening-client.tsx tracks the same shape plus a `ticked`
 * boolean for the per-station gate; the `ticked` field stays client-side
 * (every entry sent to the RPC IS ticked, by definition of the submit
 * gate enforcing "all 44 ticked before submit enables").
 */
export interface OpeningEntryPhase1 {
  templateItemId: string;
  phase: "phase1";
  /** Populated for the 8 fridge temp items (template_item.expects_count=true). NULL otherwise. */
  countValue: number | null;
  /** Optional discrepancy photo. Always null in PR 2 (Phase 6 wires the upload). */
  photoId: string | null;
  /** Optional discrepancy comment. NULL when none. */
  notes: string | null;
}

/**
 * Phase 2 entry — three-values prep verification + optional over/under-par
 * capture + closer-estimate snapshot resolved at form-load time. Stored in
 * checklist_completions.prep_data.phase2 JSONB; count_value/photo_id/notes
 * stay NULL.
 *
 * Per locked Q3: closerEstimateSnapshot is trusted from the form's
 * loadCloserEstimateSnapshots resolution; the RPC does NOT re-resolve.
 * If the AM Prep gets edited (C.46 chain edit) between form-load and
 * submit, the form's snapshot is the operational truth at the moment
 * the opener saw it. The amPrepCompletionId in the snapshot lets future
 * audit consumers detect divergence without paying the per-submit
 * re-resolution cost.
 *
 * Per locked Q5: under-par fires one notification per entry (N-per-item
 * grain) inside the RPC transaction; recipients = KH+ at this location +
 * MoO + Owner.
 */
export interface OpeningEntryPhase2 {
  templateItemId: string;
  phase: "phase2";
  phase2: {
    /** Opener's count on arrival. Required. */
    openerActual: number;
    /** What opener actually prepped today. Required. */
    openerPrepped: number;
    /** Over-par capture: opener prepped > expected par. NULL when normal. */
    overPar: {
      reasonCategory:
        | "management_directive"
        | "clear_fridge_space"
        | "prevent_expiration"
        | "forecast_busy"
        | "bulk_efficiency"
        | "other";
      /** Required when reasonCategory='management_directive'; null otherwise. */
      directedBy: string | null;
      /** Optional free-text nuance; required when reasonCategory='other'. */
      freeText: string | null;
    } | null;
    /** Under-par capture: opener prepped < expected par. Triggers urgent notification. */
    underPar: {
      reasonCategory:
        | "ingredient_unavailable"
        | "equipment_issue"
        | "time_constraint"
        | "staff_shortage"
        | "other";
      /** REQUIRED for under-par per design doc §3.3. */
      freeText: string;
    } | null;
    /** Closer-estimate snapshot from prior-night AM Prep. NULL when no AM Prep yesterday OR par-null item. */
    closerEstimateSnapshot: CloserEstimateSnapshot | null;
  };
}

export type OpeningEntry = OpeningEntryPhase1 | OpeningEntryPhase2;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 closer-estimate snapshot — what the form reads to render the
// "closer's projection" column for each Phase 2 item
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closer's bring-to-par projection from prior-night AM Prep, snapshot-frozen
 * via C.44 + chain-resolved via C.46 MAX(edit_count) per template_item.
 *
 * The resolver (loadCloserEstimateSnapshots) returns Map<openingTemplateItemId,
 * CloserEstimateSnapshot | null>. NULL when:
 *   - no AM Prep template at this location
 *   - no AM Prep submission for prior operational date
 *   - opening template item has no references_template_item_id (not a Phase 2 item)
 *   - canonical AM Prep completion has no `inputs.total` (e.g., Misc YES/NO item)
 *   - chain fully revoked (no canonical row remains after revoked_at IS NULL filter)
 *   - prep_data shape mismatch (defensive; should not happen for AM Prep submissions)
 *
 * The snapshot is frozen INTO the opener's Phase 2 completion at submit time
 * (Step 4 RPC); this resolver reads what the form should render, not what
 * gets persisted.
 */
export interface CloserEstimateSnapshot {
  /** Closer's bring-to-par projection from prior-night AM Prep. */
  total: number;
  /** Par at AM Prep submission time (C.44 snapshot). */
  parValue: number | null;
  /** AM Prep item label at submission time (C.44 snapshot). */
  itemName: string;
  /** Forensic chain: the canonical AM Prep completion this snapshot reads from. */
  amPrepCompletionId: string;
  /** Forensic chain: the parent AM Prep instance. */
  amPrepInstanceId: string;
  /** "Submitted at [time]" attribution context. */
  amPrepCompletedAt: string;
  /** C.46 edit_count at the time of read (0 = original; 1-3 = post-edit). UI hint. */
  amPrepEditCount: number;
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
    // Pass prep_meta through. Pre-PR-3 era assumed opening items had no
    // prep_meta and hardcoded null here — that assumption became architecturally
    // stale when PR 3 Step 3 seeded 34 Phase 2 items carrying prep_meta.openingPhase2=true.
    // Stripping the field caused the OpeningClient phase split to never see
    // Phase 2 items → form rendered Phase 1 only → 34 bare-tick completions
    // landed without three-values capture. Fix surfaced via Juan's S1 smoke
    // 2026-05-08 (AGENTS.md "smoke-test as architectural finder").
    //
    // Type cast follows the same pragmatic pattern as lib/prep.ts:613 — the
    // shared ChecklistTemplateItem.prepMeta type is `PrepMeta | null` (AM
    // Prep-shaped). For opening Phase 2 items the runtime value is actually
    // OpeningPhase2Meta. Opening consumers (opening-client.tsx, OpeningPrepEntry,
    // page.tsx) narrow to `OpeningPhase2Meta` at use site. Future cleanup may
    // widen ChecklistTemplateItem.prepMeta to a discriminated union
    // (PrepMeta | OpeningPhase2Meta | null) — separate refactor.
    //
    // Forward note for Cleanup PR: integration test missing for loader →
    // OpeningClient round-trip; synthetic-templateItems unit tests masked the
    // gap during Step 6.
    prepMeta: (r.prep_meta ?? null) as ChecklistTemplateItem["prepMeta"],
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
// loadCloserEstimateSnapshots — Phase 2 closer-estimate resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves closer-estimate snapshots for a set of opening Phase 2 template
 * items. Returns a Map keyed by opening template_item_id; value is the
 * canonical AM Prep snapshot per the chain (MAX(edit_count)) OR null when
 * no AM Prep value resolves.
 *
 * Four-step resolution (per AGENTS.md "PostgREST embedded-select .eq() filter
 * on relation can fail unpredictably" lesson — multi-query over single JOIN):
 *   1. Read opening template items → openingId → amPrepTemplateItemId map
 *      (via references_template_item_id column added in migration 0049)
 *   2. Resolve active AM Prep template at this location (most-recent-active
 *      per C.43 sub-finding; refine alongside Mid-day Prep landing)
 *   3. Resolve AM Prep instance for prior operational date (single-per-day
 *      per the existing UNIQUE (template_id, location_id, date) constraint)
 *   4. Read completions for that instance + amPrep item filter; JS-side
 *      chain-resolve via MAX(edit_count) per template_item
 *
 * Chain semantic note (durable lesson captured in AGENTS.md alongside C.50):
 * C.46 chain edits do NOT supersede via superseded_at. All chain rows remain
 * `superseded_at IS NULL AND revoked_at IS NULL` simultaneously. The
 * chain-resolution discipline is MAX(edit_count) per template_item, NOT
 * `WHERE superseded_at IS NULL`. Mirrors lib/prep.ts:1146 computeChangedFields.
 *
 * Snapshot freeze pattern (C.44): the snapshot is captured INTO the opener's
 * Phase 2 completion at submit time (Step 4 RPC); THIS resolver reads what
 * the form should render at any moment, not what gets persisted.
 *
 * Cost: 4 queries; ~28 items per location × ≤4 chain rows = ~112 rows max
 * on the completion read. Negligible for Server Component render. If Phase 2
 * grows to hundreds of items, revisit single-query optimization.
 */
export async function loadCloserEstimateSnapshots(
  service: SupabaseClient,
  args: {
    locationId: string;
    /** Yesterday's operational date (YYYY-MM-DD); the date AM Prep was submitted. */
    priorOperationalDate: string;
    /** The Phase 2 template_item_ids to resolve. */
    openingTemplateItemIds: string[];
  },
): Promise<Map<string, CloserEstimateSnapshot | null>> {
  const result = new Map<string, CloserEstimateSnapshot | null>();
  if (args.openingTemplateItemIds.length === 0) return result;

  // Step 1: opening items → amPrep item IDs.
  const { data: refRows, error: refErr } = await service
    .from("checklist_template_items")
    .select("id, references_template_item_id")
    .in("id", args.openingTemplateItemIds);
  if (refErr) {
    throw new Error(
      `loadCloserEstimateSnapshots: load opening item refs: ${refErr.message}`,
    );
  }

  const openingToAmPrep = new Map<string, string>();
  const amPrepIds = new Set<string>();
  for (const r of (refRows ?? []) as Array<{
    id: string;
    references_template_item_id: string | null;
  }>) {
    if (r.references_template_item_id) {
      openingToAmPrep.set(r.id, r.references_template_item_id);
      amPrepIds.add(r.references_template_item_id);
    }
  }
  if (amPrepIds.size === 0) return result;

  // Step 2: resolve active AM Prep template at this location.
  // Single-prep-template assumption per C.43 sub-finding (lib/prep.ts loadAmPrepState
  // uses the same most-recent-active picker; refine alongside Mid-day Prep landing).
  const { data: amPrepTmpl, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", "prep")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (tmplErr) {
    throw new Error(
      `loadCloserEstimateSnapshots: load AM Prep template: ${tmplErr.message}`,
    );
  }
  if (!amPrepTmpl) {
    // No AM Prep template at this location → all openings get null per Q2 fallback.
    for (const openingId of openingToAmPrep.keys()) {
      result.set(openingId, null);
    }
    return result;
  }

  // Step 3: resolve AM Prep instance for prior operational date.
  const { data: amPrepInstance, error: instErr } = await service
    .from("checklist_instances")
    .select("id")
    .eq("template_id", amPrepTmpl.id)
    .eq("location_id", args.locationId)
    .eq("date", args.priorOperationalDate)
    .maybeSingle<{ id: string }>();
  if (instErr) {
    throw new Error(
      `loadCloserEstimateSnapshots: load AM Prep instance: ${instErr.message}`,
    );
  }
  if (!amPrepInstance) {
    // No AM Prep submission yesterday → all openings get null per Q2 fallback.
    for (const openingId of openingToAmPrep.keys()) {
      result.set(openingId, null);
    }
    return result;
  }

  // Step 4: read completions for that instance + amPrep item filter; JS-side
  // chain-resolve via MAX(edit_count) per template_item.
  const { data: compRows, error: compErr } = await service
    .from("checklist_completions")
    .select("id, template_item_id, instance_id, edit_count, completed_at, prep_data")
    .eq("instance_id", amPrepInstance.id)
    .in("template_item_id", Array.from(amPrepIds))
    .is("revoked_at", null);
  if (compErr) {
    throw new Error(
      `loadCloserEstimateSnapshots: load AM Prep completions: ${compErr.message}`,
    );
  }

  // Reduce: keep MAX(edit_count) per template_item.
  // Mirrors lib/prep.ts:1185 computeChangedFields chain-resolution pattern.
  interface CanonicalRow {
    id: string;
    instanceId: string;
    editCount: number;
    completedAt: string;
    prepData: unknown;
  }
  const canonicalByItem = new Map<string, CanonicalRow>();
  for (const c of (compRows ?? []) as Array<{
    id: string;
    template_item_id: string;
    instance_id: string;
    edit_count: number;
    completed_at: string;
    prep_data: unknown;
  }>) {
    const existing = canonicalByItem.get(c.template_item_id);
    if (!existing || c.edit_count > existing.editCount) {
      canonicalByItem.set(c.template_item_id, {
        id: c.id,
        instanceId: c.instance_id,
        editCount: c.edit_count,
        completedAt: c.completed_at,
        prepData: c.prep_data,
      });
    }
  }

  // Build result Map keyed by opening template_item_id.
  for (const [openingId, amPrepId] of openingToAmPrep.entries()) {
    const canonical = canonicalByItem.get(amPrepId);
    if (!canonical) {
      // No completion for this AM Prep item in yesterday's submission.
      result.set(openingId, null);
      continue;
    }
    if (!isPrepData(canonical.prepData)) {
      // Defensive: prep_data shape mismatch. Should not happen for AM Prep
      // submissions but never assume — narrow per the lib/prep.ts validator.
      result.set(openingId, null);
      continue;
    }
    const total = canonical.prepData.inputs.total;
    if (typeof total !== "number") {
      // Misc YES/NO items have no .total — return null per Q2 fallback. Phase 2
      // form skips Misc items entirely per Surface A scope-out, so this branch
      // should be unreachable in practice; defense-in-depth for if/when Misc
      // Phase 2 representation lands as a follow-up.
      result.set(openingId, null);
      continue;
    }
    result.set(openingId, {
      total,
      parValue: canonical.prepData.snapshot.parValue,
      itemName: canonical.prepData.snapshot.itemName,
      amPrepCompletionId: canonical.id,
      amPrepInstanceId: canonical.instanceId,
      amPrepCompletedAt: canonical.completedAt,
      amPrepEditCount: canonical.editCount,
    });
  }

  return result;
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
  /** Build #3 PR 3 Step 4 — IDs of notifications fired for under-par Phase 2 entries. */
  underParNotificationIds: string[];
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
  /** Build #3 PR 3 Step 4 — IDs of notifications fired for under-par Phase 2 entries. */
  underParNotificationIds: string[];
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

  // Per-entry validation (defense-in-depth; the form should also enforce
  // client-side). Server-side validation iterates the ENTRIES array, not the
  // source-of-truth template — so it doesn't catch missing entries. The form
  // is the source-of-truth gate; the RPC is the second layer.
  //
  // Discriminated union narrows on entry.phase ("phase1" | "phase2"); each
  // branch validates its own field shape.
  for (const entry of args.entries) {
    if (entry.phase === "phase1") {
      if (entry.countValue !== null && typeof entry.countValue !== "number") {
        throw new OpeningEntryShapeError(
          `phase1 entry ${entry.templateItemId} countValue must be number or null`,
        );
      }
    } else {
      // phase2 — validate the phase2 sub-object shape
      if (typeof entry.phase2.openerActual !== "number") {
        throw new OpeningEntryShapeError(
          `phase2 entry ${entry.templateItemId} openerActual must be number`,
        );
      }
      if (typeof entry.phase2.openerPrepped !== "number") {
        throw new OpeningEntryShapeError(
          `phase2 entry ${entry.templateItemId} openerPrepped must be number`,
        );
      }
      // Under-par requires non-empty freeText per design doc §3.3.
      if (entry.phase2.underPar !== null && !entry.phase2.underPar.freeText.trim()) {
        throw new OpeningEntryShapeError(
          `phase2 entry ${entry.templateItemId} underPar.freeText is required when under-par`,
        );
      }
      // Over-par with reasonCategory='other' requires freeText per design doc §3.2.
      if (
        entry.phase2.overPar !== null &&
        entry.phase2.overPar.reasonCategory === "other" &&
        (entry.phase2.overPar.freeText === null || !entry.phase2.overPar.freeText.trim())
      ) {
        throw new OpeningEntryShapeError(
          `phase2 entry ${entry.templateItemId} overPar.freeText is required when reasonCategory='other'`,
        );
      }
      // Over-par with reasonCategory='management_directive' requires directedBy
      // (architectural intent: accountability tagging — locked Surface D (a)).
      if (
        entry.phase2.overPar !== null &&
        entry.phase2.overPar.reasonCategory === "management_directive" &&
        entry.phase2.overPar.directedBy === null
      ) {
        throw new OpeningEntryShapeError(
          `phase2 entry ${entry.templateItemId} overPar.directedBy is required when reasonCategory='management_directive'`,
        );
      }
    }
  }

  // Marshal entries for the RPC, dispatching on phase. Phase 1 sends
  // count_value/photo_id/notes as JSON strings (RPC casts via NULLIF + cast);
  // Phase 2 sends the full phase2 sub-object as JSONB (RPC stores in
  // checklist_completions.prep_data.phase2 verbatim).
  const rpcEntries = args.entries.map((e) => {
    if (e.phase === "phase1") {
      return {
        templateItemId: e.templateItemId,
        phase: "phase1" as const,
        countValue: e.countValue === null ? "" : String(e.countValue),
        photoId: e.photoId ?? "",
        notes: e.notes ?? "",
      };
    }
    return {
      templateItemId: e.templateItemId,
      phase: "phase2" as const,
      phase2: e.phase2,
    };
  });

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
    underParNotificationIds: rpcResult.underParNotificationIds ?? [],
  };
}

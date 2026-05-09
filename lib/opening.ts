/**
 * Opening Report Phase 1 + Phase 2 lifecycle — Build #3 PR 2 + PR 3.
 *
 * Mirrors lib/prep.ts shape. Four primary public functions:
 *   - loadOpeningState         — Server Component data loader (page.tsx)
 *   - submitOpening            — invokes submit_opening_atomic RPC
 *   - resolveClosingOpeningVerifiedRefItemId — finds closing(N-1)'s
 *                                "Opening verified" item id for the
 *                                cross-reference auto-completion target
 *   - loadCloserCountSnapshots — Phase 2 closer-count resolver (renamed from
 *     loadCloserEstimateSnapshots in Step 11 per C.50 semantic correction);
 *   - loadOpeningCloserCountSnapshots — Step 11 helper reading the persisted
 *     closer-count snapshot table; consumed by Step 12 form rewrite;
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
  OpeningPhase2Meta,
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
 * Phase 2 entry — opener inputs for the C.50 corrected-calc model. Stored in
 * checklist_completions.prep_data.phase2 JSONB at submit time (Step 13 RPC
 * computes ground_truth + prep_need + delta_vs_prep_need server-side and
 * persists the full §8.4 invariant shape).
 *
 * Raw-inputs-only contract per §8.3 lock: client sends raw operator inputs
 * (openerRecount + openerPrepped + reason capture). Server reads
 * closer_count from the persisted opening_closer_count_snapshots table
 * (frozen at instance creation; not re-resolved at submit). Form computes
 * prep_need + delta live for display only; values discarded at submit.
 *
 * Per locked Concern 2 (notification dispatch): under-prep fires N-per-item
 * (one notification per under-par entry). Recipients = KH+ at this location
 * + MoO + Owner DISTINCT, per C.48 routing.
 *
 * **C.50 model shifts captured in this shape:**
 * - `openerActual` removed: closer_count IS the canonical count when the
 *   parent section is verified (no opener double-count). Replaced by
 *   `openerRecount` which is populated only when opener flags an item for
 *   per-item recount — exception path, not default.
 * - `closerEstimateSnapshot` removed from entry: closer_count is now read
 *   from the persisted snapshot table by the RPC (frozen at instance
 *   create per C.44 snapshot universe locking precedent). No need to ship
 *   the snapshot in the request payload.
 * - over/under capture now compares to prep_need, not par. Reason
 *   categories unchanged; semantic meaning shifts.
 */
export interface OpeningEntryPhase2 {
  templateItemId: string;
  phase: "phase2";
  phase2: {
    /**
     * Opener's recount value when this item was flagged for per-item recount
     * (exception path). NULL when opener relies on section-verify (parent
     * section's closer_count is canonical for this item). Server derives
     * ground_truth_count via: `opener_recount IF NOT NULL ELSE closer_count`.
     */
    openerRecount: number | null;
    /** What opener actually prepped today. Required. */
    openerPrepped: number;
    /**
     * Over-prep capture: opener prepped > prep_need. NULL when at par
     * (opener_prepped === prep_need) or under-prep. Reason category enum
     * unchanged from pre-C.50; semantic shifts from "vs par" to "vs prep_need."
     */
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
    /**
     * Under-prep capture: opener prepped < prep_need. Triggers urgent
     * N-per-item notification dispatch. Reason category enum unchanged;
     * semantic shifts from "vs par" to "vs prep_need."
     */
    underPar: {
      reasonCategory:
        | "ingredient_unavailable"
        | "equipment_issue"
        | "time_constraint"
        | "staff_shortage"
        | "other";
      /** REQUIRED for under-prep per design doc §3.3 + C.50 §4. */
      freeText: string;
    } | null;
  };
}

export type OpeningEntry = OpeningEntryPhase1 | OpeningEntryPhase2;

/**
 * Section verification entry per C.50 §2 — top-level field on the request
 * body alongside `entries`. Section verifications are independent of the
 * entries array (per-section, not per-item). Step 13 RPC writes one row
 * to opening_section_verifications per `verified=true` entry. Append-only
 * per CO-OPS convention; multi-toggle in client state collapses to final
 * value at submit.
 */
export interface OpeningSectionVerificationEntry {
  /** System-key match value (English `prep_meta.section`, e.g., "Cooks"). */
  sectionKey: string;
  /** True when opener tapped Verify Section; false otherwise. */
  verified: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 closer-count snapshot — what the form reads to render the
// "closer's count" column for each Phase 2 item
//
// Type renamed from CloserEstimateSnapshot in Step 11 per C.50 §1: the
// closer's value is a COUNT of remaining inventory at end of shift, NOT an
// estimate/forecast. Inner field name `total` stays for now and renames to
// `closerCount` in Step 13 RPC rewrite (RPC contract coupling).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closer's actual count of remaining inventory from prior-night AM Prep,
 * snapshot-frozen via C.44 + chain-resolved via C.46 MAX(edit_count) per
 * template_item.
 *
 * The resolver (loadCloserCountSnapshots) returns Map<openingTemplateItemId,
 * CloserCountSnapshot | null>. NULL when:
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
export interface CloserCountSnapshot {
  /**
   * Closer's actual count of remaining inventory from prior-night AM Prep.
   * Field name `total` retained for Step 11 to maintain RPC contract
   * compatibility; renames to `closerCount` in Step 13 alongside the outer
   * field rename `closerEstimateSnapshot → closerCountSnapshot` per C.50.
   */
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
  "id, template_id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, vendor_item_id, active, translations, prep_meta, report_reference_type, references_template_item_id";

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
  references_template_item_id: string | null;
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
    referencesTemplateItemId: r.references_template_item_id,
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

  // Load template items first (active, ordered). Needed before instance create
  // so we can pre-compute the closer-count snapshot data and pass it to the
  // atomic instance+snapshots RPC.
  const { data: itemsRows, error: itemsErr } = await service
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("template_id", tmplRow.id)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (itemsErr) throw new Error(`loadOpeningState: load items: ${itemsErr.message}`);
  const templateItems = ((itemsRows ?? []) as TemplateItemRow[]).map(rowToTemplateItem);

  // Compute yesterday for the closer-count snapshot lookup + audit metadata.
  // UTC anchor is fine because YYYY-MM-DD has no intrinsic TZ (same pattern as
  // dashboard/page.tsx + opening/page.tsx).
  const todayUtc = new Date(`${args.date}T00:00:00Z`);
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  const yesterday = todayUtc.toISOString().slice(0, 10);

  // C.50 §2 — pre-compute closer-count snapshot data for Phase 2 items. Empty
  // array when no Phase 2 items in template (defensive — current opening
  // template always has 34 Phase 2 items per Step 3 seed, but the pattern is
  // forward-compatible with future templates).
  //
  // Per Step 11 Lock 3 sentinel handling: closer_count NULL when AM Prep
  // missing for prior operational date OR references_template_item_id NULL on
  // opening item. Form behavior on NULL is Step 12 territory.
  //
  // Note `live?.total ?? null` reads the OLD inner field name `total` — Step 13
  // RPC rewrite renames `total → closerCount` on CloserCountSnapshot alongside
  // the outer field rename closerEstimateSnapshot → closerCountSnapshot.
  const phase2Items = templateItems.filter(
    (it) => (it.prepMeta as OpeningPhase2Meta | null)?.openingPhase2 === true,
  );
  let snapshotsJson: Array<{
    template_item_id: string;
    closing_instance_id: string | null;
    closer_count: number | null;
    par_value: number | null;
    par_unit: string | null;
  }> = [];
  if (phase2Items.length > 0) {
    const liveSnapshotMap = await loadCloserCountSnapshots(service, {
      locationId: args.locationId,
      priorOperationalDate: yesterday,
      openingTemplateItemIds: phase2Items.map((it) => it.id),
    });
    snapshotsJson = phase2Items.map((it) => {
      const live = liveSnapshotMap.get(it.id) ?? null;
      const meta = it.prepMeta as OpeningPhase2Meta | null;
      return {
        template_item_id: it.id,
        closing_instance_id: live?.amPrepInstanceId ?? null,
        closer_count: live?.total ?? null,
        par_value: meta?.parValue ?? null,
        par_unit: meta?.parUnit ?? null,
      };
    });
  }

  // Atomic instance + snapshots create via create_opening_instance_atomic
  // RPC (migration 0052). Single Postgres transaction commits both inserts;
  // if snapshot insert fails, instance insert rolls back too. Solves the
  // partial-state failure mode flagged in Step 11 review (Confirm 2). Race
  // handling is in the RPC: ON CONFLICT DO NOTHING on the instance INSERT;
  // race-loss returns was_created=false and skips snapshot insert.
  const { data: rpcData, error: rpcErr } = await service.rpc(
    "create_opening_instance_atomic",
    {
      p_template_id: tmplRow.id,
      p_location_id: args.locationId,
      p_date: args.date,
      p_actor_user_id: args.actor.userId,
      p_snapshots: snapshotsJson,
    },
  );
  if (rpcErr) {
    throw new Error(
      `loadOpeningState: atomic instance create failed: ${rpcErr.message}`,
    );
  }
  const rpcResult = rpcData as {
    instance_id: string;
    was_created: boolean;
    snapshot_count?: number;
    with_closer_count?: number;
    without_closer_count?: number;
  };

  // Follow-up SELECT for the full instance row (RPC returns id only).
  const { data: instanceData, error: instReadErr } = await service
    .from("checklist_instances")
    .select(INSTANCE_COLUMNS)
    .eq("id", rpcResult.instance_id)
    .maybeSingle<InstanceRow>();
  if (instReadErr || !instanceData) {
    throw new Error(
      `loadOpeningState: read instance after atomic create failed: ${instReadErr?.message ?? "no row"}`,
    );
  }
  const instanceRow: InstanceRow = instanceData;
  const wasCreated = rpcResult.was_created;

  // Audits fire only when this caller won the create. Race-loss path
  // (was_created=false) emits no audit because nothing happened in this call —
  // the winner already emitted theirs. Best-effort fire-and-forget per
  // existing audit() helper convention.
  if (wasCreated) {
    void audit({
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: "checklist_instance.create",
      resourceTable: "checklist_instances",
      resourceId: rpcResult.instance_id,
      metadata: {
        template_id: tmplRow.id,
        location_id: args.locationId,
        date: args.date,
        template_type: "opening",
      },
      ipAddress: null,
      userAgent: null,
    });

    if (snapshotsJson.length > 0) {
      void audit({
        actorId: args.actor.userId,
        actorRole: args.actor.role,
        action: "opening.snapshot_materialize",
        resourceTable: "opening_closer_count_snapshots",
        resourceId: rpcResult.instance_id,
        metadata: {
          opening_instance_id: rpcResult.instance_id,
          snapshot_count: rpcResult.snapshot_count ?? snapshotsJson.length,
          with_closer_count: rpcResult.with_closer_count ?? 0,
          without_closer_count:
            rpcResult.without_closer_count ?? snapshotsJson.length,
          prior_operational_date: yesterday,
        },
        ipAddress: null,
        userAgent: null,
      });
    }
  }

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
// loadCloserCountSnapshots — Phase 2 closer-count resolver (live)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves closer-count snapshots for a set of opening Phase 2 template
 * items. Returns a Map keyed by opening template_item_id; value is the
 * canonical AM Prep snapshot per the chain (MAX(edit_count)) OR null when
 * no AM Prep value resolves.
 *
 * **Renamed from `loadCloserEstimateSnapshots` in Step 11 (PR 3) per C.50
 * §1.** The closer's value is a COUNT of remaining inventory at end of
 * shift, NOT an estimate/forecast. Semantic correction locked in the type
 * system; inner field name `total` retained for now (RPC contract coupling
 * — old RPC reads `total`; rewrite ships in Step 13 migration 0052).
 *
 * **Architectural role post-Step-11:** this LIVE resolver remains in place
 * for callers that need fresh data without snapshot persistence (e.g., the
 * page.tsx form-load path until Step 12 form rewrite). New opening instances
 * created post-Step-11 ALSO get a persisted snapshot in
 * `opening_closer_count_snapshots` (materialized in `loadOpeningState`'s
 * create-path; read by `loadOpeningCloserCountSnapshots` helper). Persisted
 * snapshot is the canonical source for the Step 12 form rewrite; the live
 * resolver is the materialization source at create time.
 *
 * **AM Prep ↔ opening Phase 2 FK source:** column
 * `checklist_template_items.references_template_item_id` (added in
 * migration 0049, populated for all 68 Phase 2 items as of 2026-05-08).
 * No JSONB duplication on prep_meta — the column-level FK is canonical
 * per Step 11 architectural verification (Lock 1).
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
export async function loadCloserCountSnapshots(
  service: SupabaseClient,
  args: {
    locationId: string;
    /** Yesterday's operational date (YYYY-MM-DD); the date AM Prep was submitted. */
    priorOperationalDate: string;
    /** The Phase 2 template_item_ids to resolve. */
    openingTemplateItemIds: string[];
  },
): Promise<Map<string, CloserCountSnapshot | null>> {
  const result = new Map<string, CloserCountSnapshot | null>();
  if (args.openingTemplateItemIds.length === 0) return result;

  // Step 1: opening items → amPrep item IDs.
  const { data: refRows, error: refErr } = await service
    .from("checklist_template_items")
    .select("id, references_template_item_id")
    .in("id", args.openingTemplateItemIds);
  if (refErr) {
    throw new Error(
      `loadCloserCountSnapshots: load opening item refs: ${refErr.message}`,
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
      `loadCloserCountSnapshots: load AM Prep template: ${tmplErr.message}`,
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
      `loadCloserCountSnapshots: load AM Prep instance: ${instErr.message}`,
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
      `loadCloserCountSnapshots: load AM Prep completions: ${compErr.message}`,
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
// loadOpeningCloserCountSnapshots — Step 11 helper reading the persisted
// closer-count snapshot table (consumed by Step 12 form rewrite)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C.50 §2 — Step 11 helper. Reads the persisted closer-count snapshot rows
 * for an opening instance, returning a Map keyed by template_item_id.
 *
 * The snapshot is materialized at opening instance creation by
 * `loadOpeningState` (the create-path snapshot block above) — one row per
 * Phase 2 template item. This helper is the canonical READ path for the
 * Step 12 form rewrite (form reads closer counts from the persisted
 * snapshot, not from the live `loadCloserCountSnapshots` resolver, to
 * decouple from closing's C.46 edit window per C.44 snapshot universe
 * locking precedent).
 *
 * Result field naming uses the C.50 semantic (closerCount) directly — the
 * column on the snapshot table is `closer_count`. This is brand-new shape
 * (Step 11), no legacy contract to preserve. The live resolver's
 * CloserCountSnapshot type retains `.total` for now (Step 13 rename
 * alongside RPC rewrite); this new helper does NOT inherit that legacy.
 *
 * Existing instances created BEFORE migration 0051 (smoke artifacts on the
 * preview branch + production instances pre-merge) have no snapshot rows;
 * this helper returns an empty Map for those. The Step 12 form should fall
 * back to the live resolver in that case OR refuse to render Phase 2 (the
 * latter is cleaner — empty snapshot = "this instance pre-dates C.50; treat
 * as legacy").
 */
export interface OpeningCloserCountSnapshotRow {
  templateItemId: string;
  /** Forensic FK to the closing instance whose AM Prep submission provided the count. NULL = no closing yesterday. */
  closingInstanceId: string | null;
  /** Closer's count of remaining inventory at end-of-shift. NULL = sentinel (see Step 11 Lock 3 cases). */
  closerCount: number | null;
  parValue: number | null;
  parUnit: string | null;
  snapshotTakenAt: string;
}

export async function loadOpeningCloserCountSnapshots(
  service: SupabaseClient,
  instanceId: string,
): Promise<Map<string, OpeningCloserCountSnapshotRow>> {
  const { data, error } = await service
    .from("opening_closer_count_snapshots")
    .select(
      "template_item_id, closing_instance_id, closer_count, par_value, par_unit, snapshot_taken_at",
    )
    .eq("opening_instance_id", instanceId);
  if (error) {
    throw new Error(`loadOpeningCloserCountSnapshots: ${error.message}`);
  }
  const result = new Map<string, OpeningCloserCountSnapshotRow>();
  for (const row of (data ?? []) as Array<{
    template_item_id: string;
    closing_instance_id: string | null;
    closer_count: number | null;
    par_value: number | null;
    par_unit: string | null;
    snapshot_taken_at: string;
  }>) {
    result.set(row.template_item_id, {
      templateItemId: row.template_item_id,
      closingInstanceId: row.closing_instance_id,
      closerCount: row.closer_count,
      parValue: row.par_value,
      parUnit: row.par_unit,
      snapshotTakenAt: row.snapshot_taken_at,
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
  /** C.50 §4 result counters (added in migration 0053; consumed by JS-side opening.submit audit metadata). */
  phase2Count?: number;
  sectionVerifyCount?: number;
  recountCount?: number;
  atParCount?: number;
  overPrepCount?: number;
  underPrepCount?: number;
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
    /**
     * Section verifications (C.50 §2) — opener's section-level verify state
     * at submit time. Step 13 RPC inserts one row to
     * opening_section_verifications per `verified=true` entry. Phase 3
     * accepts the field; Phase 5 RPC rewrite consumes it.
     */
    sectionVerifications?: OpeningSectionVerificationEntry[];
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
      // phase2 — validate the phase2 sub-object shape (C.50 redesign)
      if (
        entry.phase2.openerRecount !== null &&
        typeof entry.phase2.openerRecount !== "number"
      ) {
        throw new OpeningEntryShapeError(
          `phase2 entry ${entry.templateItemId} openerRecount must be number or null`,
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
      // C.50 §2 — section verifications array (Phase 5). Server inserts one
      // row to opening_section_verifications per verified=true entry.
      p_section_verifications: args.sectionVerifications ?? null,
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
  // update path emits report.update inside the RPC per C.46 A7). Metadata
  // includes C.50 §4 counters from RPC result (phase2_count, section_verify_count,
  // recount_count, at_par_count, over_prep_count, under_prep_count) for forensic
  // visibility into the C.50 calc-redesign behavior at submit time.
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
        // C.50 counters
        phase2_count: rpcResult.phase2Count ?? 0,
        section_verify_count: rpcResult.sectionVerifyCount ?? 0,
        recount_count: rpcResult.recountCount ?? 0,
        at_par_count: rpcResult.atParCount ?? 0,
        over_prep_count: rpcResult.overPrepCount ?? 0,
        under_prep_count: rpcResult.underPrepCount ?? 0,
        under_par_notification_count: rpcResult.underParNotificationIds.length,
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

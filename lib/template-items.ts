// lib/template-items.ts
//
// Shared snake_case row shape + column constant + row-mapper for the
// checklist_template_items table — the 15-field "full" projection used by
// display/behavior consumers (loaders that render the form, not auth helpers).
//
// Step 15 wrap (2026-05-26) lifted these from three parallel sites that all
// declared byte-identical column lists and near-identical mappers:
//
//   - lib/prep.ts             (TemplateItemRow + TEMPLATE_ITEM_COLUMNS + rowToTemplateItem)
//   - lib/opening.ts          (TemplateItemRow + TEMPLATE_ITEM_COLUMNS + rowToTemplateItem)
//   - app/(authed)/operations/closing/page.tsx
//                             (TemplateItemRow + inlined column list + rowToTemplateItem)
//
// The three sites had one semantic divergence: lib/opening.ts hardcoded
// `reportReferenceType: null` in the mapper output (rationale: "opening items
// don't reference other reports; closing references opening, not vice versa").
// lib/prep.ts and closing/page.tsx pass through `r.report_reference_type`
// directly. Step 15 verification query confirmed 0 of 156 active opening
// template items carry a non-null `report_reference_type` in production, so
// pass-through is behavior-equivalent to the opening-side hardcoded null:
//
//   SELECT COUNT(*) FILTER (WHERE report_reference_type IS NOT NULL)
//   FROM checklist_template_items
//   WHERE template_id IN (
//     SELECT id FROM checklist_templates
//     WHERE type = 'opening' AND active = true
//   ) AND active = true;
//   -- result: 0 non-null / 156 null
//
// Canonical pass-through pattern adopted here. If a future bug introduces a
// non-null `report_reference_type` on an opening item, the form behavior
// would attempt to render report-reference UI for an opening item — a clear
// downstream bug surfaceable in smoke, not a silently-masked corruption. The
// data-layer invariant ("opening items have NULL report_reference_type") is
// enforced by seed-script discipline (and convention), not by this mapper.
//
// FORWARD NOTE — TemplateItemRow projection asymmetry:
// lib/checklists.ts retains its own 7-field TemplateItemRow shape (id,
// template_id, min_role_level, required, expects_count, expects_photo,
// active) for authorization-helper consumers that don't need the display-
// bearing fields. The asymmetry is intentional per the lib/checklist-rows.ts
// forward note from Build #3 cleanup PR: "Lift in a follow-up cleanup once
// a name for the projection is agreed (TemplateItemRowMinimal vs
// TemplateItemRow); not in scope for the Build #3 cleanup PR." That
// follow-up is still owed; until it happens, the 7-field shape stays local
// to lib/checklists.ts and this 15-field shape stays canonical here.
//
// FORWARD NOTE — prepMeta type:
// The shared `ChecklistTemplateItem.prepMeta` type is `PrepMeta | null` (AM
// Prep-shaped). For opening Phase 2 items the runtime value is actually
// `OpeningPhase2Meta`. Opening consumers (opening-client.tsx,
// OpeningPrepEntry, page.tsx) narrow to `OpeningPhase2Meta` at use site.
// The mapper passes through the JSONB pragmatically; future cleanup may
// widen the shared type to a discriminated union (PrepMeta |
// OpeningPhase2Meta | null) — separate refactor.
//
// Architectural note from PR 3 (preserved here so the lesson isn't lost
// with the consolidation): pre-PR-3 era lib/opening.ts hardcoded `prepMeta:
// null` rather than passing through. That assumption became architecturally
// stale when PR 3 Step 3 seeded 34 opening Phase 2 items carrying
// `prep_meta.openingPhase2=true`. Stripping the field caused the
// OpeningClient phase split to never see Phase 2 items → form rendered
// Phase 1 only → 34 bare-tick completions landed without three-values
// capture. Fix surfaced via Juan's S1 smoke 2026-05-08 (AGENTS.md
// "smoke-test as architectural finder"). Pass-through is canonical going
// forward; future mappers that hardcode field-strip-to-null introduce the
// same class of latent staleness.

import type {
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  PrepMeta,
  ReportType,
} from "./types";

/**
 * Column list for SELECTs against `checklist_template_items` — single source of truth.
 *
 * ⚠ `equipment_id` (migration 0181) is DELIBERATELY ABSENT, and adding it here would
 * be a production incident. This constant feeds seventeen `.select()` call sites
 * across opening, closing, prep, the templates admin and the builder. Migration 0181
 * is a NAMED LEAD GATE (M3) applied AFTER this code is reviewed, so the Vercel
 * PREVIEW runs this branch against a database that does not yet have the column —
 * and PostgREST answers an unknown column with an error, not a null. Naming it here
 * would 500 every checklist surface on the preview Juan is meant to smoke.
 *
 * The paths that genuinely need the link (the needs-link queue and the Template
 * Doctor) read it in their own small, PROBE-GUARDED query and merge it in. Everywhere
 * else `ChecklistTemplateItem.equipmentId` is null, which is byte-identical to
 * today's behaviour. Revisit only once 0181 is applied everywhere, and even then the
 * gain is one query, not correctness.
 */
export const TEMPLATE_ITEM_COLUMNS =
  "id, template_id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, vendor_item_id, active, translations, prep_meta, report_reference_type, references_template_item_id, item_id, hard_gate, ref_track_item_completion, input_type";

/**
 * Snake_case row shape returned by `SELECT TEMPLATE_ITEM_COLUMNS FROM
 * checklist_template_items`. Mirrors the DB column shape; downstream code
 * works in camelCase via `rowToTemplateItem` → `ChecklistTemplateItem`.
 */
export interface TemplateItemRow {
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
  references_template_item_id: string | null;
  item_id: string | null;
  /** PR-4 (migration 0163): owner-ruled per-line hard gate. Legacy rows = false. */
  hard_gate: boolean;
  /** PR-4 (migration 0163): auto-tick when the referenced item completes. Legacy = false. */
  ref_track_item_completion: boolean;
  /**
   * Fulledit PR-2 (migration 0165): explicit QUESTION input type for
   * closing/opening lines. NULL = legacy vocabulary (tick, or count via
   * expects_count). CHECK-constrained never to coexist with expects_count or
   * prep_meta. Answers store on existing completion columns (yes_no →
   * count_value 1/0, free_text → notes) — honest because versioned templates
   * pin the input_type a completion was answered under.
   */
  input_type: "yes_no" | "free_text" | null;
  /**
   * migration 0181. OPTIONAL because TEMPLATE_ITEM_COLUMNS deliberately does not
   * request it (see the comment there) — the key is simply absent on those rows,
   * and the mapper reads that absence as null.
   */
  equipment_id?: string | null;
}

/**
 * Maps a snake_case `TemplateItemRow` (DB) to a camelCase
 * `ChecklistTemplateItem` (application layer). Pass-through semantics for
 * all fields — no hardcoded nullification (see file-level architectural
 * note above for why pass-through is canonical and how a prior hardcoded
 * pattern produced a smoke incident).
 *
 * `prep_meta` cast to `ChecklistTemplateItem["prepMeta"]` (resolves to
 * `PrepMeta | null`) — the shared type is AM-Prep-shaped but the JSONB
 * carries different shapes per template type (AM Prep: `PrepMeta`; Opening
 * Phase 2: `OpeningPhase2Meta`). Consumers narrow at use site.
 */
export function rowToTemplateItem(r: TemplateItemRow): ChecklistTemplateItem {
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
    referencesTemplateItemId: r.references_template_item_id,
    itemId: r.item_id,
    hardGate: r.hard_gate,
    refTrackItemCompletion: r.ref_track_item_completion,
    inputType: r.input_type,
    // Absent key -> undefined -> null. A row selected without equipment_id reads
    // as "no equipment link", which is exactly what every pre-0181 row is.
    equipmentId: r.equipment_id ?? null,
  };
}

// lib/admin/template-builder-shared.ts
//
// Client-safe surface (zero I/O, no server imports) for the Template Builder —
// the reconciliation write layer (spec §2, "THE FLOOR"). The server module
// lib/admin/template-builder.ts re-exports everything here so server consumers
// keep a single import path.
//
// PR-0 scope: the pure mirror-item classifier + the readonly guard other libs
// import, the typed error class, and the two same-day content-fill input types.
// Structural writes (add/disable/reorder/gate) are LATER PRs — nothing for them
// lives here yet.
//
// Canonical spec: docs/superpowers/specs/2026-07-28-template-builder-design.md

import type {
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  GatePredicate,
  ReportType,
} from "@/lib/types";

/** Non-prep template types the builder governs. Prep has its own editor. */
export type TemplateBuilderType = "opening" | "closing" | "deep_cleaning";

/**
 * Typed error the routes map to jsonError(status, code). Mirrors the shape of
 * AdminTemplateError (lib/admin/templates.ts) so the two write layers surface
 * errors identically while they COEXIST (prep stays on its proven path this PR).
 */
export class TemplateBuilderError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "TemplateBuilderError";
  }
}

/**
 * TRUE when a template item is an Opening Phase-2 verification mirror — a row
 * auto-DERIVED by createOpeningMirror (lib/admin/templates.ts) from an AM-prep
 * item. The discriminator is `prep_meta.openingPhase2 === true` (the
 * OpeningPhase2Meta shape, lib/types.ts). Mirrors are managed by AM Prep and
 * MUST reject direct edits (spec §2.3, §5).
 *
 * Pure over the raw JSONB prep_meta value (unknown) — no assumption about
 * shape; a non-object / null / absent-key value is NOT a mirror.
 */
export function isMirrorItem(prepMeta: unknown): boolean {
  if (typeof prepMeta !== "object" || prepMeta === null) return false;
  return (prepMeta as { openingPhase2?: unknown }).openingPhase2 === true;
}

/**
 * Reject a write that targets an Opening Phase-2 mirror row. Throws
 * TemplateBuilderError(409, "mirror_item_readonly") when isMirrorItem is true;
 * returns void otherwise. Importable by any lib that needs the same guard
 * (spec §2.3 — "opening Phase-2 rows reject direct edits with a typed error").
 */
export function assertNotMirrorItem(prepMeta: unknown): void {
  if (isMirrorItem(prepMeta)) {
    throw new TemplateBuilderError(
      409,
      "mirror_item_readonly",
      "This item is an Opening verification mirror — edit it in AM Prep",
    );
  }
}

/**
 * The two spec-sanctioned SAME-DAY fills (spec §1): they fix missing DATA, in
 * place, immediately — they change no behavior and no capture, so they do NOT
 * version. Full content editing (relabels etc.) arrives with the draft/publish
 * engine in PR-3.
 *
 * Spanish-translation fill: `es` fields where missing/empty. Every field is
 * optional; only the present ones are written.
 */
export interface ItemTranslationFill {
  labelEs?: string | null;
  descriptionEs?: string | null;
  specialInstructionEs?: string | null;
}

/** The spine-link fill (spec §1, §4): set item_id OR vendor_item_id where null. */
export type SpineLinkTarget =
  | { kind: "item"; id: string }
  | { kind: "sku"; id: string }
  /** The third target (0181): the maintenance_equipment asset a line measures. */
  | { kind: "equipment"; id: string };

// ─────────────────────────────────────────────────────────────────────────────
// PR-4 (spec §5) — CROSS-LIST REFERENCES. The report_reference_type enum
// (report_type_enum in the DB) has 7 values; reconcileClosingReportRefs (lib/prep.ts)
// actually PULL-ticks 5 of them (opening_report / am_prep / mid_day_prep / cash_report /
// pm_report). training_report + special_report have NO reconcile writer, so exposing
// them in the builder picker would create a ref that never auto-ticks (a "reader of a
// contract nobody produces" — AGENTS.md). The builder exposes ONLY the 5 wired values
// (+ "none" = null) so every selectable ref is honestly auto-tickable. Verified against
// the live enum (project bgcvurheqzylyfehqgzh, 2026-07-28).
// ─────────────────────────────────────────────────────────────────────────────

/** The report-reference types the builder EXPOSES — exactly the ones
 *  reconcileClosingReportRefs pull-ticks (a picker value must be auto-tickable). */
export const RECONCILED_REPORT_REF_TYPES = [
  "opening_report",
  "am_prep",
  "mid_day_prep",
  "cash_report",
  "pm_report",
] as const satisfies readonly ReportType[];

export type ReconciledReportRefType = (typeof RECONCILED_REPORT_REF_TYPES)[number];

/** TRUE when a report-ref type is one the builder may expose (reconcile-backed). */
export function isReconciledReportRefType(v: unknown): v is ReconciledReportRefType {
  return typeof v === "string" && (RECONCILED_REPORT_REF_TYPES as readonly string[]).includes(v);
}

/**
 * Merge an es-translation fill into an existing translations blob — STRICT
 * FILL semantics (spec §1: fills "fix MISSING data"): a field writes ONLY when
 * it is currently missing/empty. An existing es value is NEVER overwritten and
 * NEVER deleted here — changing existing Spanish is a content edit, which
 * belongs to PR-3's draft/publish (versioning) engine. Blank incoming values
 * are no-ops. Pure; the server write persists the result.
 */
export function mergeEsFill(
  existing: ChecklistTemplateItemTranslations | null,
  fill: ItemTranslationFill,
): ChecklistTemplateItemTranslations {
  const next: ChecklistTemplateItemTranslations = { ...(existing ?? {}) };
  const es = { ...(next.es ?? {}) };
  const hasValue = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
  if (fill.labelEs !== undefined) {
    const v = fill.labelEs?.trim() || null;
    if (v && !hasValue(es.label)) es.label = v;
  }
  if (fill.descriptionEs !== undefined) {
    const v = fill.descriptionEs?.trim() || null;
    if (v && !hasValue(es.description)) es.description = v;
  }
  if (fill.specialInstructionEs !== undefined) {
    const v = fill.specialInstructionEs?.trim() || null;
    if (v && !hasValue(es.specialInstruction)) es.specialInstruction = v;
  }
  next.es = es;
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Doctor — PURE classifiers (spec §6). CI owns the truth-tables; these
// are the split-out reasoning bits the server doctor (lib/admin/template-builder.
// runTemplateDoctor) composes over batch-loaded rows. Zero I/O, no server import.
// ─────────────────────────────────────────────────────────────────────────────

/** The confirm floor for closing lists: KH+ finalize (level 4, lib/roles.ts —
 *  see closing-client.tsx canFinalize). Any confirmable-list type could pass a
 *  different floor; the classifier stays pure over it. */
export const CLOSING_CONFIRM_FLOOR_LEVEL = 4;

/** The confirm floor for opening lists: KH+ (level 4). This is `OPENING_BASE_LEVEL`
 *  in lib/opening.ts — the pre-flight gate on submitPhase1Atomic / submitPhase2Atomic
 *  / finalize (`actor.level >= OPENING_BASE_LEVEL`). Verified equal to closing's
 *  floor (both KH+), but named PER TYPE so the Doctor never silently applies
 *  closing's constant to opening — a future divergence stays a one-line change here
 *  (the C.54 "preserved from prior must be re-verified" lesson, applied forward). */
export const OPENING_CONFIRM_FLOOR_LEVEL = 4;

/**
 * Resolve the role-floor the Template Doctor uses for a confirmable list type.
 * closing / opening confirm at KH+ (level 4). deep_cleaning has NO confirm gate
 * (it is a placeholder type, no operator surface / no templates — Module #15,
 * unbuilt), so role-floor findings there are advisory-only; the floor is still
 * returned (the classifier only ever DOWN-grades findings to advisory when the
 * min_role exceeds it — an empty template yields no findings regardless).
 */
export function confirmFloorForType(type: TemplateBuilderType): number {
  switch (type) {
    case "opening":
      return OPENING_CONFIRM_FLOOR_LEVEL;
    case "closing":
      return CLOSING_CONFIRM_FLOOR_LEVEL;
    case "deep_cleaning":
      // No confirm gate; reuse the KH floor as a benign default (findings are
      // advisory-only and there are no templates to classify).
      return CLOSING_CONFIRM_FLOOR_LEVEL;
  }
}

/** The maximum role level in the product (CGS, lib/roles.ts). A required item
 *  whose min_role_level exceeds this can NEVER be completed → the list can never
 *  fully confirm. Kept here (not imported from roles.ts) so the classifier is a
 *  pure constant-over-input; roles.ts is the source-of-truth and this mirrors it. */
export const MAX_ROLE_LEVEL = 10;

/**
 * The Spanish fill-count for one template's items (Doctor invariant: "Spanish
 * 14/61"). `filled` = items whose es.label is a non-empty string (the label is
 * the operator-facing anchor; description/specialInstruction are secondary). A
 * mirror row counts toward total but is never "missing" — it's managed by AM
 * Prep, so it can't be filled here. Pure over the item list.
 */
export function esFillCount(
  items: Array<Pick<ChecklistTemplateItem, "label" | "translations" | "prepMeta">>,
): { filled: number; total: number } {
  let filled = 0;
  for (const it of items) {
    const es = it.translations?.es;
    const hasEs = typeof es?.label === "string" && es.label.trim() !== "";
    // Mirror rows are managed elsewhere → treat as "not a gap" (count as filled).
    if (hasEs || isMirrorItem(it.prepMeta)) filled += 1;
  }
  return { filled, total: items.length };
}

/**
 * TRUE when a template item needs a spine link: a count-bearing line
 * (expects_count) referencing NEITHER a registry item NOR a SKU. Mirror rows are
 * excluded — they're derived and never carry a link here. Pure; the caller
 * pre-filters to active lines. (Parity with needs-link-shared's `needsLink`, but
 * mirror-aware for the Doctor's per-template surface.)
 */
export function itemNeedsLink(
  item: Pick<ChecklistTemplateItem, "expectsCount" | "itemId" | "vendorItemId" | "equipmentId" | "prepMeta">,
): boolean {
  if (isMirrorItem(item.prepMeta)) return false;
  return (
    item.expectsCount &&
    item.itemId === null &&
    item.vendorItemId === null &&
    // The third arm (0181) — parity with needs-link-shared's `needsLink`. A
    // temperature line linked to its fridge is LINKED.
    item.equipmentId === null
  );
}

/**
 * PR-4 (spec §6): list every ACTIVE hard-gated item (the Doctor lists them so a manager
 * can see, at a glance, which lines can BLOCK a submission — the owner's guardrail). Not
 * an error; a standing inventory. Mirror rows are excluded (they can't be hard-gated —
 * the seal rejects gate edits). Pure over the item list.
 */
export function classifyHardGated(
  items: Array<Pick<ChecklistTemplateItem, "id" | "label" | "hardGate" | "active" | "prepMeta">>,
): Array<{ itemId: string; label: string }> {
  const out: Array<{ itemId: string; label: string }> = [];
  for (const it of items) {
    if (!it.active || !it.hardGate) continue;
    if (isMirrorItem(it.prepMeta)) continue;
    out.push({ itemId: it.id, label: it.label });
  }
  return out;
}

/**
 * PR-4 (spec §6): flag ref_track items whose referenced target is gone / inactive on
 * the referenced list — a dangling cross-list reference (the auto-tick can never fire).
 * `validTargetIds` is the set of currently-active reference-target item ids the OTHER
 * list still exposes (from ReferenceTargetsView). An item that tracks (refTrack=true +
 * a referencesTemplateItemId) whose target isn't in that set is dangling. Pure.
 */
export function classifyDanglingRefs(
  items: Array<Pick<ChecklistTemplateItem, "id" | "label" | "active" | "refTrackItemCompletion" | "referencesTemplateItemId" | "prepMeta">>,
  validTargetIds: ReadonlySet<string>,
): Array<{ itemId: string; label: string }> {
  const out: Array<{ itemId: string; label: string }> = [];
  for (const it of items) {
    if (!it.active || !it.refTrackItemCompletion) continue;
    if (isMirrorItem(it.prepMeta)) continue; // mirror ref is AM-Prep-managed, not tracked here
    if (it.referencesTemplateItemId === null || !validTargetIds.has(it.referencesTemplateItemId)) {
      out.push({ itemId: it.id, label: it.label });
    }
  }
  return out;
}

/**
 * ORPHANED-MIRROR check (Doctor, spec §6 — the check the doctor docstring promised).
 * An ACTIVE opening Phase-2 mirror row (isMirrorItem === true) whose AM-prep SOURCE item
 * (references_template_item_id) is INACTIVE or MISSING. In steady state deactivateOpeningMirror
 * removes a mirror when its source AM-prep item is removed; an orphan is a mirror that survived
 * (a partial-failure, a source deactivated by another path, or a null reference). It renders in
 * the opening list forever with no live source → ADVISORY (fixed by AM-prep edits, not builder
 * edits; the seal makes mirrors read-only here). Excluded from the actionable header total.
 *
 * `validAmPrepItemIds` = the set of currently-ACTIVE am_prep source item ids (the doctor batch-
 * loads them). A mirror is orphaned when its referencesTemplateItemId is null OR absent from
 * that set. Non-mirror rows are skipped (this is a mirror-only integrity check). Pure.
 */
export function classifyOrphanedMirrors(
  items: Array<Pick<ChecklistTemplateItem, "id" | "label" | "active" | "referencesTemplateItemId" | "prepMeta">>,
  validAmPrepItemIds: ReadonlySet<string>,
): Array<{ itemId: string; label: string }> {
  const out: Array<{ itemId: string; label: string }> = [];
  for (const it of items) {
    if (!it.active) continue;
    if (!isMirrorItem(it.prepMeta)) continue; // mirror-only check
    if (it.referencesTemplateItemId === null || !validAmPrepItemIds.has(it.referencesTemplateItemId)) {
      out.push({ itemId: it.id, label: it.label });
    }
  }
  return out;
}

/** One named location-drift finding (Doctor invariant: "P St has 'X' Cap Hill doesn't"). */
export interface DriftFinding {
  /** the location that HAS the label the other lacks. */
  presentLocationId: string;
  /** the location MISSING the label. */
  missingLocationId: string;
  /** the item's English label (the system key we diff on). */
  label: string;
}

/**
 * Diff two locations' active item sets by ENGLISH LABEL (the system key, per the
 * system-key-vs-display-string law — never diff translated strings). Returns one
 * finding per label present in exactly one location. Symmetric: A-only AND B-only
 * are both reported. Pure. Case-insensitive-trim on the label so "Fridge 1 " and
 * "fridge 1" don't read as drift (a whitespace/case typo isn't intentional drift).
 *
 * Two locations only (closing/opening are per-location single templates); the
 * caller passes the two location item lists. Duplicate labels within a location
 * collapse to one (a label is present-or-absent, not counted).
 */
export function diffLocationItems(
  a: { locationId: string; labels: string[] },
  b: { locationId: string; labels: string[] },
): DriftFinding[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const aByNorm = new Map<string, string>();
  for (const l of a.labels) aByNorm.set(norm(l), l);
  const bByNorm = new Map<string, string>();
  for (const l of b.labels) bByNorm.set(norm(l), l);

  const findings: DriftFinding[] = [];
  for (const [k, label] of aByNorm) {
    if (!bByNorm.has(k)) {
      findings.push({ presentLocationId: a.locationId, missingLocationId: b.locationId, label });
    }
  }
  for (const [k, label] of bByNorm) {
    if (!aByNorm.has(k)) {
      findings.push({ presentLocationId: b.locationId, missingLocationId: a.locationId, label });
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// PR-5 (spec §8) — LOCATION SYNC. Two pure constructions the client composes:
//  1. buildBothLocationAdds — the both-locations add fan-out (one authored add →
//     two draft adds, distinct tempIds, same content). Default-ON in QuickAdd.
//  2. buildReconcileAddEdit — the "Make <B> match <A>" reconcile: turn ONE drift
//     source row (A has 'X' that B lacks) into an {op:"add"} for B copying A's full
//     AUTHORABLE shape (label/description/es/station/role/required/hardGate + spine
//     link when count-bearing). ADDITIVE ONLY (append-only law, spec §8): no removal
//     reconcile. Cross-list CONNECTIONS (report-ref / ref-track) are deliberately NOT
//     copied — they are per-location references (a closing item references ITS location's
//     opening item by id); copying A's target id to B would dangle. Connections stay a
//     manual per-location step (the Doctor flags dangling refs). Zero I/O.
// ─────────────────────────────────────────────────────────────────────────────

/** A fresh client-side temp id for an added row (matches QuickAdd's shape). Pure over
 *  an injectable now/rand so tests are deterministic; the client passes real ones. */
export function makeTempId(now: number, rand: string): string {
  return `${now}-${rand}`;
}

/** The AUTHORABLE shape of a source item a reconcile add copies. This is exactly the
 *  set of fields "Make B match A" reproduces (spec §8 additive reconcile). Mirror rows
 *  and un-authorable derived state are excluded by the caller / the builder guard. */
export interface ReconcileSource {
  label: string;
  description: string | null;
  station: string | null;
  minRoleLevel: number;
  required: boolean;
  hardGate: boolean;
  expectsCount: boolean;
  expectsPhoto: boolean;
  /** Fulledit PR-2: the source's question input type — reconcile reproduces it
   *  (adversarial C3: "Make B match A" must not flatten a question to a tick). */
  inputType: "yes_no" | "free_text" | null;
  /** the source's registry item link (count-bearing rows). */
  itemId: string | null;
  /** the source's EQUIPMENT link (0181; count-bearing rows). Optional so callers
   *  built before the column existed still type-check. */
  equipmentId?: string | null;
  /** the source's SKU link (count-bearing rows). */
  vendorItemId: string | null;
  /** whether this row is an Opening Phase-2 mirror — a mirror is NEVER a reconcile
   *  source (the §5 seal): a mirror is derived by AM Prep, not authored per location. */
  isMirror: boolean;
  es: { label?: string | null; description?: string | null } | null;
}

/** Why a reconcile add was BLOCKED (never silently added). */
export type ReconcileBlockReason =
  /** the source is an Opening Phase-2 mirror — the seal (never reconcile a mirror). */
  | "mirror"
  /** the source is a count-bearing line with no spine link — the spine-link law (§4)
   *  would reject the publish; block EARLY in the UI ("link it first"). */
  | "unlinked_count";

export type ReconcileAddResult =
  | { ok: true; edit: Extract<TemplateItemEdit, { op: "add" }> }
  | { ok: false; reason: ReconcileBlockReason };

/**
 * Build the reconcile {op:"add"} that makes location B carry A's row `source`.
 * ADDITIVE (spec §8). Copies A's full authorable shape. BLOCKS (never silently adds):
 *   - a MIRROR source (the §5 seal — a mirror is AM-Prep-managed, not per-location
 *     authored; the caller also excludes mirror labels from drift so this is belt+braces);
 *   - a count-bearing source with NO spine link (spine-link law §4: the server publish
 *     would reject it → fail early with "link it first" in the UI).
 * `tempId` + `displayOrder` are supplied by the caller (B's own draft context — the add
 * lands at B's tail). Pure.
 */
export function buildReconcileAddEdit(
  source: ReconcileSource,
  ctx: { tempId: string; displayOrder: number },
): ReconcileAddResult {
  if (source.isMirror) return { ok: false, reason: "mirror" };
  if (
    source.expectsCount &&
    source.itemId === null &&
    source.vendorItemId === null &&
    (source.equipmentId ?? null) === null
  ) {
    return { ok: false, reason: "unlinked_count" };
  }
  const spineLink: SpineLinkTarget | null = !source.expectsCount
    ? null
    : source.itemId !== null
      ? { kind: "item", id: source.itemId }
      : source.vendorItemId !== null
        ? { kind: "sku", id: source.vendorItemId }
        : // "Make B match A" must carry an EQUIPMENT link too, or reconciling a
          // temp line would silently drop its referent and recreate the very
          // false positive 0181 exists to clear.
          (source.equipmentId ?? null) !== null
          ? { kind: "equipment", id: source.equipmentId! }
          : null;

  const edit: Extract<TemplateItemEdit, { op: "add" }> = {
    op: "add",
    tempId: ctx.tempId,
    label: source.label,
    description: source.description,
    station: source.station,
    displayOrder: ctx.displayOrder,
    minRoleLevel: source.minRoleLevel,
    required: source.required,
    expectsCount: source.expectsCount,
    expectsPhoto: source.expectsPhoto,
    spineLink,
    hardGate: source.hardGate,
    // Fulledit PR-2 (adversarial C3): carry the question input type so the
    // reconciled row matches A faithfully. Guarded: a legal source can't be
    // count/photo + question, but never emit the illegal combination anyway.
    ...(source.inputType && !source.expectsCount && !source.expectsPhoto
      ? { inputType: source.inputType }
      : {}),
    ...(source.es ? { es: source.es } : {}),
  };
  return { ok: true, edit };
}

/**
 * The both-locations fan-out (spec §8, default-ON): one authored add becomes TWO draft
 * adds (one per template), same content, DISTINCT tempIds + per-draft displayOrders.
 * Publishing stays PER TEMPLATE (two taps — honest about the two lineages). `mkTempId`
 * yields a fresh id per call (the caller passes a real time/rand generator). Pure over it.
 *
 * `base` is the authored add WITHOUT its tempId/displayOrder (those are per-template).
 * Returns [{ templateId, edit }] for exactly the templates given. Order preserved.
 */
export function buildBothLocationAdds(
  base: Omit<Extract<TemplateItemEdit, { op: "add" }>, "op" | "tempId" | "displayOrder">,
  templates: Array<{ templateId: string; nextDisplayOrder: number }>,
  mkTempId: () => string,
): Array<{ templateId: string; edit: Extract<TemplateItemEdit, { op: "add" }> }> {
  return templates.map((t) => ({
    templateId: t.templateId,
    edit: { op: "add", tempId: mkTempId(), displayOrder: t.nextDisplayOrder, ...base },
  }));
}

/** Severity of a role-floor finding for one required item. */
export type RoleFloorSeverity =
  /** min_role_level > MAX_ROLE_LEVEL → no one can ever complete it. */
  | "impossible"
  /** min_role_level > the confirming floor → a floor-level closer can't confirm
   *  a list that includes this completed item (a manager must). Advisory. */
  | "above_confirm_floor";

/** One role-floor finding (Doctor invariant: the never-confirmable trap). */
export interface RoleFloorFinding {
  itemId: string;
  label: string;
  minRoleLevel: number;
  severity: RoleFloorSeverity;
}

/**
 * Role-floor sanity (spec §6): for a confirmable list (confirmInstance requires
 * actor.level >= the highest completed min_role_level), flag REQUIRED items whose
 * min_role_level is too high:
 *   - "impossible"          — exceeds MAX_ROLE_LEVEL: uncompletable, list can
 *                             NEVER fully confirm;
 *   - "above_confirm_floor" — exceeds `confirmFloorLevel`: a floor-level closer
 *                             (e.g. a KH) can't confirm this list once the item is
 *                             done — only a higher role can. Advisory, not a break.
 * Non-required items are skipped (their incompletion is reason-able / optional).
 * Pure over the item list + the floor.
 */
export function classifyRoleFloor(
  items: Array<Pick<ChecklistTemplateItem, "id" | "label" | "required" | "minRoleLevel">>,
  confirmFloorLevel: number,
): RoleFloorFinding[] {
  const out: RoleFloorFinding[] = [];
  for (const it of items) {
    if (!it.required) continue;
    if (it.minRoleLevel > MAX_ROLE_LEVEL) {
      out.push({ itemId: it.id, label: it.label, minRoleLevel: it.minRoleLevel, severity: "impossible" });
    } else if (it.minRoleLevel > confirmFloorLevel) {
      out.push({ itemId: it.id, label: it.label, minRoleLevel: it.minRoleLevel, severity: "above_confirm_floor" });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// View + Doctor report SHAPES (client-safe types the server module fills and the
// client component renders). Pure interfaces — no I/O; live here so the client
// imports them without any server-only proximity.
// ─────────────────────────────────────────────────────────────────────────────

/** One template (a location's lineage-latest template of a type) with its items. */
export interface TemplateBuilderTemplate {
  id: string;
  name: string;
  type: string;
  locationId: string;
  items: ChecklistTemplateItem[];
  /** PR-3: the loaded version's effective date (null = legacy always-effective). */
  effectiveFrom?: string | null;
  /** PR-3: true when effective_from > today — the "live tomorrow morning" banner. */
  isPending?: boolean;
  /** PR-4 (spec §5): the template-level submission gate predicate ("this list requires
   *  <other artifact> submitted"). NULL = no gate. Editing it rides the publish flow
   *  (templatePatch). Optional so PR-1/PR-2 loads that predate this field still type. */
  submissionGatePredicate?: GatePredicate | null;
}

/** Every active template of a type at the actor's visible locations. */
export interface TemplateBuilderView {
  type: TemplateBuilderType;
  templates: TemplateBuilderTemplate[];
}

/**
 * PR-4 (spec §5): a candidate item on the OTHER list (the referenceable lineage) that
 * a ref_track item may point at. The picker offers these per LOCATION (a closing item
 * references its own location's opening item). `templateId` scopes the candidates to a
 * location's current-version reference lineage so the client filters by the active
 * template's location.
 */
export interface ReferenceTarget {
  itemId: string;
  label: string;
  locationId: string;
}

/** PR-4: the reference-target set keyed by location (the OTHER list's current items).
 *  Empty when the referenceable type has no templates (e.g. deep_cleaning). */
export interface ReferenceTargetsView {
  /** the type these targets belong to (opening when the builder is closing, etc). */
  referencedType: TemplateBuilderType;
  targets: ReferenceTarget[];
}

/** Per-template Doctor findings (one per location's active template of the type). */
export interface TemplateDoctorTemplate {
  templateId: string;
  templateName: string;
  locationId: string;
  locationName: string | null;
  /** count-bearing lines still unlinked (spec §4 campaign) — item ids + labels. */
  needsLink: Array<{ itemId: string; label: string }>;
  /** Spanish fill progress for the operator-facing label (spec §6). */
  esFill: { filled: number; total: number };
  /** role-floor sanity (the never-confirmable trap + advisory above-floor). */
  roleFloor: RoleFloorFinding[];
  /** PR-4 (spec §6): every hard-gated item LISTED (was SKIPPED in PR-1, no column). */
  hardGated: Array<{ itemId: string; label: string }>;
  /** PR-4 (spec §6): ref_track items whose referenced target no longer exists / is
   *  inactive on the referenced list — a dangling reference (fail-loud, advisory). */
  danglingRefs: Array<{ itemId: string; label: string }>;
  /** ACTIVE opening Phase-2 mirrors whose AM-prep source item is inactive/missing — an
   *  orphaned mirror (spec §6). ADVISORY: fixed by AM-prep edits, not builder edits, so
   *  NOT counted in the actionable header total. Only ever non-empty for opening. */
  orphanedMirrors: Array<{ itemId: string; label: string }>;
}

/** The whole Doctor report for a type across the actor's visible locations. */
export interface TemplateDoctorReport {
  type: TemplateBuilderType;
  templates: TemplateDoctorTemplate[];
  /** location drift NAMED per item (spec §6). */
  drift: DriftFinding[];
  /** the confirm floor used for role-floor sanity (KH=4 for closing). */
  confirmFloorLevel: number;
  /** convenience rollups for the header chip (D2/D3). */
  totals: {
    needsLink: number;
    esMissing: number;
    roleFloorImpossible: number;
    drift: number;
    /** PR-4: total ACTIVE hard-gated items across the visible templates (inventory,
     *  not an issue — surfaced but never counted into issueCount). */
    hardGated: number;
    /** PR-4: dangling ref_track references (an actionable fail-loud finding). */
    danglingRefs: number;
    /** Orphaned opening Phase-2 mirrors (source AM-prep item inactive/missing). ADVISORY —
     *  surfaced but never counted into issueCount (fixed via AM Prep, not the builder). */
    orphanedMirrors: number;
  };
  /**
   * PR-3 publish signals for this type's active lineages (per location's current
   * template). openInstancesToday powers the apply-now gate message (spec §1);
   * pending surfaces the "changes go live tomorrow" state of an existing pending
   * version. Empty in PR-1/PR-2 loads (the server fills these in PR-3). Keyed by
   * templateId = the CURRENTLY-EFFECTIVE version the builder view loaded.
   */
  publish?: {
    /** count of TODAY's checklist_instances across the whole lineage (all versions). */
    openInstancesToday: number;
    /** a pending (effective_from > today) version exists for a lineage in this view. */
    hasPendingVersion: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PR-3 — THE PUBLISH ENGINE (spec §1 + §10). The pure surface: the edit vocabulary,
// the diff classifier (confirm-modal + audit metadata only — NEVER gates the write
// path; everything versions), and the date primitives + the date-aware resolution
// applicator the 9 resolver sites chain onto their checklist_templates select.
// Zero I/O, no server import — CI owns the truth-tables here.
// ─────────────────────────────────────────────────────────────────────────────

/** apply_now = live TODAY (Tier-A step-up, gated on no open instance); the default
 *  is next-day (spec §1: "Publish — live tomorrow morning"). */
export type PublishEffectiveMode = "apply_now" | "next_day";

/**
 * One structural edit the manager drafted, addressed to a SOURCE item by id (or a
 * fresh add). The publish transaction applies these while copying the source
 * version → the new version. Every edit VERSIONS (spec §1) — the classifier below
 * only summarizes them for the confirm modal + audit; it never decides the write.
 *
 *  - relabel/describe/station/reorder/role/required → mutate the copied row;
 *  - disable → the copied row lands active=false (append-only: the version's row
 *    set is TOTAL — a disabled row renders nowhere but keeps the lineage honest);
 *  - add → a fresh row (spine link REQUIRED at write when expectsCount — the PR-0
 *    guard, re-enforced server-side).
 */
export type TemplateItemEdit =
  | { op: "relabel"; itemId: string; label: string }
  | { op: "describe"; itemId: string; description: string | null }
  | { op: "translate"; itemId: string; es: { label?: string | null; description?: string | null; specialInstruction?: string | null } }
  | { op: "station"; itemId: string; station: string | null }
  | { op: "reorder"; itemId: string; displayOrder: number }
  | { op: "role"; itemId: string; minRoleLevel: number }
  | { op: "required"; itemId: string; required: boolean }
  // PR-4 (spec §3): the 3-way gate tier as ONE op. `required` = the "must complete —
  // or explain" tier; `hardGate` = the owner-ruled NO-OVERRIDE tier. Optional = both
  // false. Mutually-consistent by construction at the UI (hardGate implies the item is
  // effectively must-complete, but the two columns are written independently server-side).
  | { op: "gate_tier"; itemId: string; required: boolean; hardGate: boolean }
  // PR-4 (spec §5): the report_reference_type picker in the drawer Connections section —
  // STRUCTURAL (changes submit/reconcile behavior) → versions. null clears the ref.
  | { op: "set_report_ref"; itemId: string; refType: ReconciledReportRefType | null }
  // PR-4 (spec §5): the ONE new mechanism — auto-tick this item when a specific OTHER
  // item completes. `targetItemId` = the referenced item (references_template_item_id);
  // null both clears the target and turns tracking off.
  | { op: "ref_track"; itemId: string; targetItemId: string | null }
  // Fulledit PR-2 (migration 0165): the per-line QUESTION input type — yes_no /
  // free_text / null (= plain tick). STRUCTURAL (changes what the operator form
  // asks + what a completion means) → versions. Never legal on a count line
  // (expects_count) — the server + DB CHECK both reject; switching TO count is
  // not an op (count needs a spine link → add-time-only, like today's drawer).
  | { op: "input_type"; itemId: string; inputType: "yes_no" | "free_text" | null }
  | { op: "disable"; itemId: string }
  | { op: "enable"; itemId: string }
  | {
      op: "add";
      /** client-side temp id so reorder/other edits in the same draft can target it. */
      tempId: string;
      label: string;
      description?: string | null;
      station?: string | null;
      displayOrder: number;
      minRoleLevel: number;
      required: boolean;
      expectsCount: boolean;
      expectsPhoto?: boolean;
      /** REQUIRED when expectsCount (spine-link law §4) — set exactly one. */
      spineLink?: SpineLinkTarget | null;
      es?: { label?: string | null; description?: string | null };
      /** PR-5 (spec §8): the owner-ruled hard gate carried on the add. A plain quick-add
       *  is always false; a RECONCILE add (buildReconcileAddEdit) copies the source row's
       *  hard-gate so "Make B match A" reproduces A's gate faithfully. `undefined` = false. */
      hardGate?: boolean;
      /** Fulledit PR-2: the question input type on a fresh add (undefined = plain
       *  tick). Mutually exclusive with expectsCount (server + DB CHECK reject). */
      inputType?: "yes_no" | "free_text";
    };

/**
 * The pure diff summary the confirm modal + audit metadata read (spec §1: "3 added ·
 * 1 removed · 2 renamed"). NEVER gates the write path — everything versions. Reorder
 * is a COUNT (which items moved is noise for the manager); the rest are id/label
 * lists so the modal + audit can name them.
 */
export interface TemplateDiffSummary {
  added: Array<{ tempId: string; label: string }>;
  removed: Array<{ itemId: string; label: string }>;
  relabeled: Array<{ itemId: string; from: string; to: string }>;
  reordered: number;
  roleChanged: Array<{ itemId: string; label: string; from: number; to: number }>;
  requiredChanged: Array<{ itemId: string; label: string; to: boolean }>;
  /** PR-4: gate-tier changes (Optional / must-complete / hard gate) — reports the
   *  RESOLVED tier so the confirm modal + audit name the transition per item. */
  gateChanged: Array<{ itemId: string; label: string; to: "optional" | "must_complete" | "hard_gate" }>;
  /** PR-4: report-reference / ref-track changes — a count for the confirm modal
   *  (which items are noise; the connection kind is what the manager cares about). */
  referenceChanged: number;
  /** Fulledit PR-2: input-type changes (tick / yes_no / free_text) — reported per
   *  item, only when the resolved type differs from the source. */
  inputTypeChanged: Array<{ itemId: string; label: string; to: "tick" | "yes_no" | "free_text" }>;
}

/** PR-4: the RESOLVED gate tier for one item (Optional / must-complete / hard gate).
 *  Pure derivation from the two boolean columns. hardGate wins (a hard gate is by
 *  definition also must-complete; the label reflects the strongest tier). */
export function resolveGateTier(
  item: Pick<ChecklistTemplateItem, "required" | "hardGate">,
): "optional" | "must_complete" | "hard_gate" {
  if (item.hardGate) return "hard_gate";
  if (item.required) return "must_complete";
  return "optional";
}

/**
 * PR-4 (spec §5) — the TEMPLATE-LEVEL patch that rides the SAME publish flow as the
 * item edits (orchestrator ruling): editing the submission gate predicate is a
 * template-level structural change, so it versions via the publish mint. `undefined`
 * = no change (the source predicate copies verbatim); an explicit `null` clears the
 * gate; a GatePredicate sets it. Only submissionGatePredicate is builder-editable this
 * PR (edit_gate_predicate stays whatever the source carried).
 */
export interface TemplatePatch {
  submissionGatePredicate?: GatePredicate | null;
}

/**
 * classifyEdits — pure over (source items, draft edits). Deterministic, order-
 * independent, and coalescing: the LAST edit of a given op for an item wins (a
 * relabel A→B→C summarizes as A→C; a disable then enable nets to no removal).
 * "removed" = a disable with no later enable. "relabeled" only when the label
 * actually differs from the source. Used by the modal + audit ONLY.
 */
export function classifyEdits(
  srcItems: Array<Pick<ChecklistTemplateItem, "id" | "label" | "minRoleLevel" | "required" | "active" | "hardGate" | "inputType">>,
  edits: readonly TemplateItemEdit[],
): TemplateDiffSummary {
  const srcById = new Map(srcItems.map((it) => [it.id, it]));

  // Coalesce per item: last-write-wins on each mutable field.
  const label = new Map<string, string>();
  const role = new Map<string, number>();
  const required = new Map<string, boolean>();
  const disabled = new Map<string, boolean>(); // true=disable, false=enable
  const reorderedIds = new Set<string>();
  const adds: Array<{ tempId: string; label: string }> = [];
  const gateAddSignposts: TemplateDiffSummary["gateChanged"] = [];
  // PR-4: coalesced final gate tier (required + hardGate) per item, and the set of
  // items whose reference/ref-track changed.
  const gate = new Map<string, { required: boolean; hardGate: boolean }>();
  const referenceIds = new Set<string>();
  const inputType = new Map<string, "yes_no" | "free_text" | null>();

  for (const e of edits) {
    switch (e.op) {
      case "relabel":
        label.set(e.itemId, e.label);
        break;
      case "role":
        role.set(e.itemId, e.minRoleLevel);
        break;
      case "required":
        required.set(e.itemId, e.required);
        break;
      case "gate_tier":
        // gate_tier carries BOTH booleans — it's the authoritative tier setter. Also
        // reflect its `required` into the required map so a plain requiredChanged is
        // still surfaced when only the reason-tier flipped.
        gate.set(e.itemId, { required: e.required, hardGate: e.hardGate });
        required.set(e.itemId, e.required);
        break;
      case "set_report_ref":
      case "ref_track":
        referenceIds.add(e.itemId);
        break;
      case "input_type":
        inputType.set(e.itemId, e.inputType);
        break;
      case "reorder":
        reorderedIds.add(e.itemId);
        break;
      case "disable":
        disabled.set(e.itemId, true);
        break;
      case "enable":
        disabled.set(e.itemId, false);
        break;
      case "add":
        adds.push({ tempId: e.tempId, label: e.label });
        // A hard-gated ADD must be signposted in the confirm modal like any other
        // gate change (PR-5 review L3b) — a hard gate never ships silently.
        if (e.hardGate === true) {
          gateAddSignposts.push({ itemId: `draft-${e.tempId}`, label: e.label, to: "hard_gate" });
        }
        break;
      // describe / station / translate don't appear in the manager-facing summary.
      default:
        break;
    }
  }

  const removed: TemplateDiffSummary["removed"] = [];
  for (const [id, isDisabled] of disabled) {
    if (!isDisabled) continue; // netted back to enabled
    const src = srcById.get(id);
    // Only a currently-active source row that ends disabled counts as "removed".
    if (src && src.active) removed.push({ itemId: id, label: src.label });
  }

  const relabeled: TemplateDiffSummary["relabeled"] = [];
  for (const [id, to] of label) {
    const src = srcById.get(id);
    if (src && src.label !== to) relabeled.push({ itemId: id, from: src.label, to });
  }

  const roleChanged: TemplateDiffSummary["roleChanged"] = [];
  for (const [id, to] of role) {
    const src = srcById.get(id);
    if (src && src.minRoleLevel !== to) {
      roleChanged.push({ itemId: id, label: src.label, from: src.minRoleLevel, to });
    }
  }

  const requiredChanged: TemplateDiffSummary["requiredChanged"] = [];
  for (const [id, to] of required) {
    const src = srcById.get(id);
    if (src && src.required !== to) requiredChanged.push({ itemId: id, label: src.label, to });
  }

  // A reorder only "counts" if the item isn't already removed (a disabled row's
  // order is irrelevant) and its position genuinely differs is enforced client-side;
  // here we count the distinct reordered ids that survive.
  let reordered = 0;
  for (const id of reorderedIds) {
    if (disabled.get(id) === true) continue;
    reordered += 1;
  }

  // PR-4: gate-tier changes — the RESOLVED tier per item, reported only when it
  // differs from the source tier (hardGate wins). A bare `required` flip is ALSO a
  // tier change (Optional↔must-complete), so fold required-only changes in too.
  const gateChanged: TemplateDiffSummary["gateChanged"] = [...gateAddSignposts];
  const gateTouched = new Set<string>([...gate.keys(), ...required.keys()]);
  for (const id of gateTouched) {
    const src = srcById.get(id);
    if (!src) continue;
    const g = gate.get(id);
    const nextRequired = g ? g.required : (required.get(id) ?? src.required);
    const nextHard = g ? g.hardGate : src.hardGate;
    const to = resolveGateTier({ required: nextRequired, hardGate: nextHard });
    const from = resolveGateTier({ required: src.required, hardGate: src.hardGate });
    if (to !== from) gateChanged.push({ itemId: id, label: src.label, to });
  }

  // PR-4: reference/ref-track changes — count the distinct surviving (non-removed) ids.
  let referenceChanged = 0;
  for (const id of referenceIds) {
    if (disabled.get(id) === true) continue;
    referenceChanged += 1;
  }

  // Fulledit PR-2: input-type changes — resolved per item, only when differing
  // from the source (coalesced last-write-wins like every other classifier map).
  const inputTypeChanged: TemplateDiffSummary["inputTypeChanged"] = [];
  for (const [id, to] of inputType) {
    if (disabled.get(id) === true) continue;
    const src = srcById.get(id);
    if (src && (src.inputType ?? null) !== to) {
      inputTypeChanged.push({ itemId: id, label: src.label, to: to ?? "tick" });
    }
  }

  return {
    added: adds,
    removed,
    relabeled,
    reordered,
    roleChanged,
    requiredChanged,
    gateChanged,
    referenceChanged,
    inputTypeChanged,
  };
}

/**
 * Apply the draft edits to the source items IN MEMORY, producing the drafted item
 * list the phone preview + the builder list render (the manager sees exactly what
 * will publish). Pure — no I/O. MIRROR ROWS ARE NEVER EDITED (spec §5 seal): edits
 * addressed to a mirror are ignored. "add" edits become synthetic items with a
 * `draft-<tempId>` id; "disable" flips active=false (kept in the array so the list
 * can render it struck-through — the preview filters inactive out). Result is sorted
 * by the (possibly-reordered) displayOrder, stable on ties. The same coalescing rule
 * as classifyEdits (last-write-wins per field per item).
 */
export function applyEditsToItems(
  srcItems: ChecklistTemplateItem[],
  edits: readonly TemplateItemEdit[],
): ChecklistTemplateItem[] {
  const byId = new Map(srcItems.map((it) => [it.id, { ...it }]));
  const added: ChecklistTemplateItem[] = [];

  for (const e of edits) {
    if (e.op === "add") {
      added.push({
        id: `draft-${e.tempId}`,
        templateId: srcItems[0]?.templateId ?? "",
        station: e.station ?? null,
        displayOrder: e.displayOrder,
        label: e.label,
        description: e.description ?? null,
        minRoleLevel: e.minRoleLevel,
        required: e.required,
        expectsCount: e.expectsCount,
        expectsPhoto: e.expectsPhoto ?? false,
        vendorItemId: e.expectsCount && e.spineLink?.kind === "sku" ? e.spineLink.id : null,
        active: true,
        translations: e.es ? { es: { label: e.es.label ?? undefined, description: e.es.description ?? null } } : null,
        prepMeta: null,
        reportReferenceType: null,
        referencesTemplateItemId: null,
        itemId: e.expectsCount && e.spineLink?.kind === "item" ? e.spineLink.id : null,
        equipmentId: e.expectsCount && e.spineLink?.kind === "equipment" ? e.spineLink.id : null,
        // A quick-add row is a plain new line — ref-track defaults off (set later via a
        // set_report_ref / ref_track op on the persisted row). PR-5: a RECONCILE add
        // carries the source's hard gate so the drafted preview mirrors A faithfully.
        hardGate: e.hardGate === true,
        refTrackItemCompletion: false,
        inputType: e.inputType ?? null,
      });
      continue;
    }
    const target = byId.get(e.itemId);
    if (!target) continue;
    if (isMirrorItem(target.prepMeta)) continue; // mirror rows never edited (seal)
    switch (e.op) {
      case "relabel":
        target.label = e.label;
        break;
      case "describe":
        target.description = e.description;
        break;
      case "station":
        target.station = e.station;
        break;
      case "reorder":
        target.displayOrder = e.displayOrder;
        break;
      case "role":
        target.minRoleLevel = e.minRoleLevel;
        break;
      case "required":
        target.required = e.required;
        break;
      case "gate_tier":
        target.required = e.required;
        target.hardGate = e.hardGate;
        break;
      case "set_report_ref":
        target.reportReferenceType = e.refType;
        break;
      case "ref_track":
        // The target item + the tracking flag move together: a null target turns
        // tracking off, a set target turns it on (the persisted write mirrors this).
        target.referencesTemplateItemId = e.targetItemId;
        target.refTrackItemCompletion = e.targetItemId !== null;
        break;
      case "input_type":
        // Count lines never take a question type (server + DB CHECK reject); the
        // drafted preview just doesn't apply the illegal shape.
        if (!target.expectsCount) target.inputType = e.inputType;
        break;
      case "disable":
        target.active = false;
        break;
      case "enable":
        target.active = true;
        break;
      case "translate": {
        const cur = target.translations ?? {};
        const es = { ...(cur.es ?? {}) };
        if (e.es.label !== undefined) es.label = e.es.label ?? undefined;
        if (e.es.description !== undefined) es.description = e.es.description;
        if (e.es.specialInstruction !== undefined) es.specialInstruction = e.es.specialInstruction;
        target.translations = { ...cur, es };
        break;
      }
    }
  }

  const all = [...byId.values(), ...added];
  return all.sort((a, b) => (a.displayOrder !== b.displayOrder ? a.displayOrder - b.displayOrder : 0));
}

// ── Operational-date primitives (pure; UTC-anchored YYYY-MM-DD arithmetic, the
//    same idiom as lib/checklists.ts shiftDateByDays / lib/opening.ts yesterday). A
//    YYYY-MM-DD string has no intrinsic TZ, so day-shifting via a UTC anchor is
//    exact. The CALLER supplies "today" in the operational TZ (server:
//    operationalNow(new Date()).date). ─────────────────────────────────────────────

/** Shift a YYYY-MM-DD operational date by whole days (UTC-anchored, exact). */
export function shiftOperationalDay(yyyymmdd: string, offsetDays: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** The next operational day after `today` (spec §1: default publish effect). */
export function nextOperationalDay(today: string): string {
  return shiftOperationalDay(today, 1);
}

/** Minimal lineage row for the pure resolution rule (id + version-sort keys). */
export interface LineageVersionRow {
  id: string;
  active: boolean;
  effective_from: string | null;
  created_at: string;
}

/**
 * `a` outranks `b` under the resolution order — effective_from DESC NULLS LAST, then
 * created_at DESC. THE ONE comparator both the SQL resolver (applyEffectiveResolution)
 * and the in-memory pickers (loader lineage-latest + publish currently-effective)
 * agree on. Pure. Returns true when a should sort BEFORE b (a wins).
 */
export function versionOutranks(a: LineageVersionRow, b: LineageVersionRow): boolean {
  if (a.effective_from !== b.effective_from) {
    if (a.effective_from === null) return false; // NULL sorts LAST
    if (b.effective_from === null) return true;
    return a.effective_from > b.effective_from;
  }
  return a.created_at > b.created_at;
}

/**
 * The CURRENTLY-EFFECTIVE version on `opDate` from a lineage's rows — the newest
 * ACTIVE row whose effective_from is NULL or <= opDate (pending rows invisible),
 * ordered by versionOutranks. Returns null when only pending versions exist (a fresh
 * lineage). Mirrors applyEffectiveResolution's SQL exactly; pure + CI-testable.
 */
export function resolveEffectiveVersionId(rows: LineageVersionRow[], opDate: string): string | null {
  let best: LineageVersionRow | null = null;
  for (const r of rows) {
    if (!r.active) continue;
    if (r.effective_from !== null && r.effective_from > opDate) continue; // pending
    if (best === null || versionOutranks(r, best)) best = r;
  }
  return best?.id ?? null;
}

/** Minimal structural view of the PostgREST filter/transform builder methods
 *  applyEffectiveResolution chains — declared NON-recursively (each method returns
 *  this same interface, not the caller's deep generic) to avoid TS2589
 *  "excessively deep" instantiation when applied to a fully-typed supabase-js
 *  builder. Includes the terminal `maybeSingle<T>()` so callers await the resolved
 *  builder directly with a single `as unknown as` cast on the way in. */
export interface EffectiveResolvableBuilder {
  eq(column: string, value: unknown): EffectiveResolvableBuilder;
  is(column: string, value: null): EffectiveResolvableBuilder;
  or(filters: string): EffectiveResolvableBuilder;
  order(column: string, opts: { ascending: boolean; nullsFirst?: boolean }): EffectiveResolvableBuilder;
  limit(n: number): EffectiveResolvableBuilder;
  maybeSingle<T>(): Promise<{ data: T | null; error: { message: string } | null }>;
}

/**
 * The date-aware resolution filter (adjudication a — the ONLY correctness
 * mechanism). Chain this onto any `from("checklist_templates").select(...)` that
 * already carries the site's own `.eq("type", ...)` / `.eq("prep_subtype", ...)` /
 * `.eq("location_id", ...)` scoping. It adds:
 *   active = true
 *   AND (effective_from IS NULL OR effective_from <= opDate)
 *   ORDER BY effective_from DESC NULLS LAST, created_at DESC
 *   LIMIT 1  (caller adds .maybeSingle())
 * so the newest active version whose effective date has arrived wins; a pending
 * (effective_from > opDate) version is invisible until its day. Legacy NULL rows
 * sort last but win when they're the only active row (identical to the pre-0162
 * most-recent-active pick). PostgREST `.or()` string form — opDate is a plain
 * YYYY-MM-DD (regex-validated at the callers), never user free-text.
 *
 * Non-generic (see EffectiveResolvableBuilder) — callers pass their builder with a
 * single `as unknown as` cast and cast the return back to the concrete builder so
 * `.maybeSingle<Row>()` keeps its row typing. Pure query-shape; zero I/O.
 */
export function applyEffectiveResolution(
  query: EffectiveResolvableBuilder,
  opDate: string,
): EffectiveResolvableBuilder {
  return query
    .eq("active", true)
    .or(`effective_from.is.null,effective_from.lte.${opDate}`)
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
}

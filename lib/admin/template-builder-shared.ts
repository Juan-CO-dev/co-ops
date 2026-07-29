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

import type { ChecklistTemplateItem, ChecklistTemplateItemTranslations } from "@/lib/types";

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
  | { kind: "sku"; id: string };

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
  item: Pick<ChecklistTemplateItem, "expectsCount" | "itemId" | "vendorItemId" | "prepMeta">,
): boolean {
  if (isMirrorItem(item.prepMeta)) return false;
  return item.expectsCount && item.itemId === null && item.vendorItemId === null;
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

/** One template (a location's active template of a type) with its display items. */
export interface TemplateBuilderTemplate {
  id: string;
  name: string;
  type: string;
  locationId: string;
  items: ChecklistTemplateItem[];
}

/** Every active template of a type at the actor's visible locations. */
export interface TemplateBuilderView {
  type: TemplateBuilderType;
  templates: TemplateBuilderTemplate[];
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
  totals: { needsLink: number; esMissing: number; roleFloorImpossible: number; drift: number };
}

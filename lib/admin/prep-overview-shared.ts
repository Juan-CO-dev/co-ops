// lib/admin/prep-overview-shared.ts
//
// Client-safe surface (zero I/O, no server imports) for the READ-ONLY prep
// overview + prep Doctor that mounts on the closing/opening Template Builder
// (PR-3/4 of the checklist full-edit arc). The server module
// lib/admin/prep-overview.ts fills the projection via the READ LAW and composes
// these classifiers; the client component renders the compact projection.
//
// Prep evolves IN ITS OWN EDITOR (unanimous council ruling — prep never gets
// publish-versioning). This surface is READ-ONLY: every fix deep-links to the
// prep editor. Prep findings are ADVISORY and NEVER folded into the
// closing/opening TemplateDoctorReport totals (mirrors how orphanedMirrors stays
// out of issueCount).
//
// Canonical spec: docs/superpowers/specs/2026-07-30-prep-builder-view-design.md

import type { LineInputType } from "@/lib/types";

/** The prep subtypes the overview lists (both — no reconcile between them). */
export type PrepSubtypeKey = "am_prep" | "mid_day_prep";

export const PREP_SUBTYPES = ["am_prep", "mid_day_prep"] as const satisfies readonly PrepSubtypeKey[];

/**
 * One ACTIVE prep line as the overview projects it (the server fills `displayLabel`
 * via THE READ LAW — resolveLineDefinition + loadItemDefns — so a linked live
 * inventory line shows the registry name, a question / unlinked / deactivated-item
 * line shows its own label). Zero I/O; pure data.
 */
export interface PrepOverviewLine {
  /** checklist_template_items.id — the deep-link/deduplication anchor. */
  lineId: string;
  /** THE READ LAW display name (never the raw label for a linked live inventory line). */
  displayLabel: string;
  /** the raw line label (the English system key the drift classifier diffs on when unlinked). */
  rawLabel: string;
  /** prep_meta.section slug. */
  section: string;
  /** shapeFromColumns(prep_meta.columns). */
  inputType: LineInputType;
  /** item_id non-null. */
  linked: boolean;
  /** the linked item's id (drift identity when linked), else null. */
  itemId: string | null;
  /** isQuestionShapedColumns(prep_meta.columns). */
  questionShaped: boolean;
  /** no translations.es.label AND — for linked inventory lines — no items.name_es. */
  esMissing: boolean;
  /** display_order (lines render ordered by this within a section). */
  displayOrder: number;
}

/** One location's ACTIVE prep template of a subtype, projected to its active lines. */
export interface PrepOverviewTemplate {
  templateId: string;
  templateName: string;
  locationId: string;
  locationName: string | null;
  subtype: PrepSubtypeKey;
  lines: PrepOverviewLine[];
}

/** One prep-Doctor input-type drift finding (same identity, different input type). */
export interface PrepInputTypeDriftFinding {
  subtype: PrepSubtypeKey;
  /** the identity's human label (the linked item's resolved label, else the raw label). */
  identityLabel: string;
  /** the per-location derived input type — one entry per location that carries the identity. */
  perLocation: Array<{ locationId: string; inputType: LineInputType }>;
}

/** The whole prep overview + Doctor for the actor's visible locations (both subtypes). */
export interface PrepOverviewReport {
  /** every projected (location × subtype) template with active lines. */
  templates: PrepOverviewTemplate[];
  /** input-type drift across locations for the SAME subtype (a Doctor finding). */
  inputTypeDrift: PrepInputTypeDriftFinding[];
  /** convenience rollups for the collapsed-header badge. */
  totals: {
    needsLink: number;
    esMissing: number;
    inputTypeDrift: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE classifiers (spec §"The three classifiers"). Zero I/O; CI owns the truth-
// tables. The server module composes these over the READ-LAW-filled projection.
// ─────────────────────────────────────────────────────────────────────────────

/** The drift identity of a line: item_id when linked (beats label), else the
 *  normalized-lowercase raw label. A whitespace/case label typo isn't drift. */
export function prepLineIdentity(line: Pick<PrepOverviewLine, "itemId" | "rawLabel">): string {
  if (line.itemId !== null) return `item:${line.itemId}`;
  return `label:${line.rawLabel.trim().toLowerCase()}`;
}

/**
 * classifyPrepInputTypeDrift — the SAME line identity present at BOTH locations for
 * the same subtype (identity = item_id when linked, else normalized-lowercase label)
 * with DIFFERENT derived input types → one finding per drifting identity. Pure.
 *
 * Only reports an identity that appears at ≥2 DISTINCT locations for the subtype AND
 * whose input types are not all equal (a genuine cross-location conflict). Two lines
 * at the SAME location with the same identity collapse (a location is present-or-
 * absent for an identity; the first line at that location wins its input type — a
 * within-location duplication is a prep-editor concern, not cross-location drift).
 */
export function classifyPrepInputTypeDrift(
  templates: readonly PrepOverviewTemplate[],
): PrepInputTypeDriftFinding[] {
  const findings: PrepInputTypeDriftFinding[] = [];

  // Group templates by subtype.
  const bySubtype = new Map<PrepSubtypeKey, PrepOverviewTemplate[]>();
  for (const tpl of templates) {
    const arr = bySubtype.get(tpl.subtype) ?? [];
    arr.push(tpl);
    bySubtype.set(tpl.subtype, arr);
  }

  for (const subtype of PREP_SUBTYPES) {
    const subTemplates = bySubtype.get(subtype) ?? [];
    if (subTemplates.length < 2) continue; // need ≥2 locations to have cross-location drift

    // identity → { locationId → { inputType, label } } (first line per location wins).
    const byIdentity = new Map<
      string,
      Map<string, { inputType: LineInputType; label: string }>
    >();
    for (const tpl of subTemplates) {
      for (const line of tpl.lines) {
        const id = prepLineIdentity(line);
        const perLoc = byIdentity.get(id) ?? new Map();
        if (!perLoc.has(tpl.locationId)) {
          perLoc.set(tpl.locationId, { inputType: line.inputType, label: line.displayLabel });
        }
        byIdentity.set(id, perLoc);
      }
    }

    for (const perLoc of byIdentity.values()) {
      if (perLoc.size < 2) continue; // present at only one location → no drift
      const entries = [...perLoc.entries()];
      const first = entries[0];
      if (!first) continue;
      const allSame = entries.every(([, v]) => v.inputType === first[1].inputType);
      if (allSame) continue; // consistent input type across locations → not drift
      findings.push({
        subtype,
        identityLabel: first[1].label,
        perLocation: entries.map(([locationId, v]) => ({ locationId, inputType: v.inputType })),
      });
    }
  }

  return findings;
}

/**
 * classifyPrepNeedsLink — active INVENTORY-shaped (non-question) lines with no item
 * link → the needs-link list for one template. Question lines are EXCLUDED (a question
 * carries no par/link; its label IS the question). Pure over the projected lines.
 */
export function classifyPrepNeedsLink(
  template: Pick<PrepOverviewTemplate, "lines">,
): Array<{ lineId: string; label: string }> {
  const out: Array<{ lineId: string; label: string }> = [];
  for (const line of template.lines) {
    if (line.questionShaped) continue; // a question carries no link
    if (line.linked) continue;
    out.push({ lineId: line.lineId, label: line.displayLabel });
  }
  return out;
}

/**
 * prepEsFill — {filled, total} over one template's active lines (mirrors the closing
 * Doctor's esFillCount convention). A line is "filled" when its resolved es label
 * exists — the server sets `esMissing` via THE READ LAW (line translations.es.label,
 * or the registry items.name_es for a linked inventory line). Pure.
 */
export function prepEsFill(
  template: Pick<PrepOverviewTemplate, "lines">,
): { filled: number; total: number } {
  let filled = 0;
  for (const line of template.lines) {
    if (!line.esMissing) filled += 1;
  }
  return { filled, total: template.lines.length };
}

/** Roll the per-template + drift findings into the collapsed-header badge totals. Pure. */
export function prepOverviewTotals(
  templates: readonly PrepOverviewTemplate[],
  inputTypeDrift: readonly PrepInputTypeDriftFinding[],
): PrepOverviewReport["totals"] {
  let needsLink = 0;
  let esMissing = 0;
  for (const tpl of templates) {
    needsLink += classifyPrepNeedsLink(tpl).length;
    const fill = prepEsFill(tpl);
    esMissing += fill.total - fill.filled;
  }
  return { needsLink, esMissing, inputTypeDrift: inputTypeDrift.length };
}

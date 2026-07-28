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

import type { ChecklistTemplateItemTranslations } from "@/lib/types";

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
 * Merge an es-translation fill into an existing translations blob — shape-
 * agnostic, only touches the `es` bucket, only writes present keys. Empty
 * strings normalize to null (label to undefined-drop so an empty label never
 * clobbers a real one). Pure; the server write persists the result.
 */
export function mergeEsFill(
  existing: ChecklistTemplateItemTranslations | null,
  fill: ItemTranslationFill,
): ChecklistTemplateItemTranslations {
  const next: ChecklistTemplateItemTranslations = { ...(existing ?? {}) };
  const es = { ...(next.es ?? {}) };
  if (fill.labelEs !== undefined) {
    const v = fill.labelEs?.trim() || null;
    if (v) es.label = v;
    else delete es.label;
  }
  if (fill.descriptionEs !== undefined) es.description = fill.descriptionEs?.trim() || null;
  if (fill.specialInstructionEs !== undefined) es.specialInstruction = fill.specialInstructionEs?.trim() || null;
  next.es = es;
  return next;
}

/**
 * Ops-health PURE surface (Ops guardrails NOW #3) — client-safe, zero I/O, no server
 * imports. The server module lib/admin/ops-health.ts re-exports these so consumers keep
 * one import path; the adoption card renders the shapes here.
 *
 * The adoption map is deliberately CURATED and SMALL (a handful of surfaces) — this
 * answers "is anyone using it this week?", not analytics. Each surface names a set of
 * audit actions that mean "someone used that surface". Counts are raw event counts over
 * the window (not distinct actors) — a coarse activity pulse.
 */
import type { TranslationKey } from "@/lib/i18n/types";

/** One curated adoption surface: an i18n label + the audit actions that mean "used". */
export interface AdoptionSurface {
  /** stable id (React key + test anchor). */
  id: string;
  /** i18n key for the surface's display name. */
  labelKey: TranslationKey;
  /** the audit action string(s) that count as "this surface was used". */
  actions: readonly string[];
}

/** One rolled-up surface count (the card row shape). */
export interface AdoptionSurfaceCount {
  id: string;
  labelKey: TranslationKey;
  count: number;
}

/**
 * THE CURATED MAP (8 surfaces, capped). Each surface's `actions` are real audit action
 * names (verified against lib/ emitters, 2026-07-29). Keep this short — a growing map
 * turns a pulse into analytics, which is a different (and unbuilt) feature.
 */
export const ADOPTION_SURFACES: readonly AdoptionSurface[] = [
  { id: "checklists", labelKey: "admin.hub.adoption.checklists", actions: ["checklist.confirm", "checklist_submission.create"] },
  { id: "counts", labelKey: "admin.hub.adoption.counts", actions: ["sku_count.recorded"] },
  { id: "receiving", labelKey: "admin.hub.adoption.receiving", actions: ["delivery.received"] },
  { id: "prep", labelKey: "admin.hub.adoption.prep", actions: ["prep.submit", "prep.mid_day.item_saved"] },
  { id: "reports", labelKey: "admin.hub.adoption.reports", actions: ["written_report.submit", "pm_report.submit"] },
  { id: "photos", labelKey: "admin.hub.adoption.photos", actions: ["photo.upload"] },
  { id: "production", labelKey: "admin.hub.adoption.production", actions: ["production.recorded"] },
  { id: "catering", labelKey: "admin.hub.adoption.catering", actions: ["catering.quote.create", "catering.quote.send"] },
] as const;

/**
 * Roll a raw per-action count map into the curated surfaces (declaration order preserved).
 * Pure — the server fn hands it the GROUP-BY result. A surface's count sums every one of
 * its mapped actions. Surfaces with zero activity are returned too (the card mutes them),
 * so the card always renders the full, stable roster.
 */
export function bucketAdoptionCounts(countsByAction: ReadonlyMap<string, number>): AdoptionSurfaceCount[] {
  return ADOPTION_SURFACES.map((s) => ({
    id: s.id,
    labelKey: s.labelKey,
    count: s.actions.reduce((n, a) => n + (countsByAction.get(a) ?? 0), 0),
  }));
}

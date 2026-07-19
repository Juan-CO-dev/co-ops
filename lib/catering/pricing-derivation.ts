/**
 * Catering price derivation — PURE, server/client-agnostic, no I/O (W1a).
 *
 * Catering price = regular price × portion fraction × catering rate. The rate is bps
 * (10000 = 100% = regular; < 10000 = wholesale discount; > 10000 = raise). Rounding is
 * nearest-cent (Math.round), consistent with lib/catering/quotes.ts bpsOf/lineTotalCents.
 */

export type Portion = "quarter" | "half" | "whole";
export const PORTION_FRACTION: Record<Portion, number> = { quarter: 0.25, half: 0.5, whole: 1 };
export const RATE_BPS_MIN = 0;
export const RATE_BPS_MAX = 30000;
export const DEFAULT_RATE_BPS = 10000;

/** Forward: recommended catering unit price for a portion. */
export function cateringUnitPriceCents(regularCents: number, portion: Portion, rateBps: number): number {
  return Math.round((regularCents * PORTION_FRACTION[portion] * rateBps) / 10000);
}

/** Reverse: implied effective rate (bps) from a chosen price vs a baseline. null if baseline ≤ 0. */
export function impliedRateBps(chosenCents: number, baselineCents: number): number | null {
  if (!Number.isFinite(baselineCents) || baselineCents <= 0) return null;
  return Math.round((chosenCents / baselineCents) * 10000);
}

/** Auto-sum primitive for combos/packages (W1b consumes this). */
export function sumComponentsCents(lines: Array<{ unitCents: number; qty: number }>): number {
  return lines.reduce((s, l) => s + Math.round(l.unitCents * l.qty), 0);
}

export interface RateRule {
  scope: "location" | "section" | "item" | "menu_item";
  scopeRef: string | null;
  rateBps: number;
}

/**
 * Most-specific-wins rate resolution: entity (item/menu_item) → section → location → default 10000.
 * Only pass ACTIVE rules. `kind` selects which entity scope matches `entityId`.
 */
export function resolveRateBps(
  rules: RateRule[],
  target: { kind: "item" | "menu_item"; entityId: string; section: string | null },
): number {
  const entity = rules.find((r) => r.scope === target.kind && r.scopeRef === target.entityId);
  if (entity) return entity.rateBps;
  if (target.section != null) {
    const section = rules.find((r) => r.scope === "section" && r.scopeRef === target.section);
    if (section) return section.rateBps;
  }
  const loc = rules.find((r) => r.scope === "location");
  if (loc) return loc.rateBps;
  return DEFAULT_RATE_BPS;
}

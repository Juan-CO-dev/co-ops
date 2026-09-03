/**
 * At-a-glance coverage — pure helpers (zero I/O, client-safe).
 *
 * The order builder shows "who's covered" in three places: the full panel (bars + guest input +
 * nudge), the desktop side column, and the COLLAPSED mobile bar. Juan (2026-09-03): the collapsed
 * bar must show what is being filled before it expands, not a rotating hint. These helpers give
 * every surface the same numbers.
 */

export interface Coverage { main: number; side: number; sweet: number; drink: number }

export interface CoverageSegment {
  key: keyof Coverage;
  label: string;
  /** People served, rounded to a whole person. */
  served: number;
  headcount: number;
  /** Fill percentage for a mini bar, 0–100 (capped). */
  pct: number;
  /** True when served ≥ headcount (and headcount > 0). */
  covered: boolean;
}

const ORDER: Array<{ key: keyof Coverage; label: string }> = [
  { key: "main", label: "Mains" },
  { key: "side", label: "Sides" },
  { key: "sweet", label: "Sweets" },
  { key: "drink", label: "Drinks" },
];

export function coverageSegments(coverage: Coverage, headcount: number): CoverageSegment[] {
  const H = Math.max(0, Math.floor(headcount));
  return ORDER.map(({ key, label }) => {
    const served = Math.round(coverage[key]);
    const pct = H > 0 ? Math.min(100, Math.round((served / H) * 100)) : 0;
    return { key, label, served, headcount: H, pct, covered: H > 0 && served >= H };
  });
}

/** "Mains 12/35 · Sides 20/35 · Sweets 0/35 · Drinks 36/35" */
export function coverageStripText(coverage: Coverage, headcount: number): string {
  return coverageSegments(coverage, headcount).map((s) => `${s.label} ${s.served}/${s.headcount}`).join(" · ");
}

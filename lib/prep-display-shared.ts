/**
 * Prep forms — CLIENT-SAFE pure display helpers shared by the opening and mid-day prep forms
 * (B1, guide-testing triage 2026-10-13). Zero I/O, no server imports.
 *
 * DISPLAY ONLY: nothing here changes a stored value or a comparison. A par of 5 in a unit
 * named "1/3 Pan" is still the number 5; this module only decides how it reads on screen.
 */

/** Round to at most 2 decimals (float noise like 0.33000000000000007 → 0.33); never -0. */
export function roundQty(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

export interface PrepQtyParts {
  /** The rounded quantity as text, or "—" when there is no number. */
  qty: string;
  /** The unit tail ("× 1/3 Pan", "Bottle"), or null when nothing should follow the number. */
  unit: string | null;
}

/**
 * #3 — a unit that starts with a digit ("1/3 Pan", "6 Pan") is a container SIZE, so the count
 * is joined with "×": 5 → "5 × 1/3 Pan" (five third-pans), never "5 1/3 Pan" (five and a third).
 * A word unit reads as written ("3 Bottle"). Zero reads as just "0" ("0 1/3 Pan" read as a third).
 */
export function prepQtyParts(n: number | null | undefined, unit: string | null | undefined): PrepQtyParts {
  if (n === null || n === undefined || !Number.isFinite(n)) return { qty: "—", unit: null };
  const r = roundQty(n);
  const u = (unit ?? "").trim();
  if (r === 0 || u === "") return { qty: String(r), unit: null };
  return { qty: String(r), unit: /^\d/.test(u) ? `× ${u}` : u };
}

/** `prepQtyParts` joined into one string: "5 × 1/3 Pan", "3 Bottle", "0", "—". */
export function formatPrepQty(n: number | null | undefined, unit: string | null | undefined): string {
  const { qty, unit: tail } = prepQtyParts(n, unit);
  return tail ? `${qty} ${tail}` : qty;
}

export type DecimalDraft =
  | { kind: "empty" }
  /** A number still being typed ("5.", "."): shown as typed; `value` is what it already means. */
  | { kind: "partial"; value: number | null }
  | { kind: "number"; value: number }
  /** Not a non-negative decimal ("5 1/3", "-1", "abc"): never committed; the box says so. */
  | { kind: "invalid" };

/**
 * #5 — classify what is in a decimal box. Digits with at most one decimal point; a decimal
 * comma (Spanish keypads) reads as a point. Fractions, signs and exponents are invalid.
 */
export function parseDecimalDraft(raw: string): DecimalDraft {
  const s = raw.trim().replace(",", ".");
  if (s === "") return { kind: "empty" };
  if (s === ".") return { kind: "partial", value: null };
  // Astra review: a digit string past ~1.8e308 is Number() → Infinity. It is NOT a number the
  // box may commit (the save would serialise it as null): invalid, the hint shows, and the
  // parent keeps its last valid value. Checked on both numeric branches (point and comma alike,
  // the comma is normalised above).
  if (/^\d+\.$/.test(s)) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) ? { kind: "partial", value: n } : { kind: "invalid" };
  }
  if (/^(\d+(\.\d+)?|\.\d+)$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? { kind: "number", value: n } : { kind: "invalid" };
  }
  return { kind: "invalid" };
}

/**
 * #6 — why a row has no prep need yet. A row with no par never gets one, however the section
 * is verified ("no par set — type what you made"); a row with a par waits for ground truth.
 */
export function prepNeedLabel(args: { parValue: number | null; groundTruth: number | null }): "no_par" | "pending" | "ready" {
  if (args.parValue === null) return "no_par";
  if (args.groundTruth === null) return "pending";
  return "ready";
}

export interface OpeningFooterState {
  activePhase: "verification" | "prep";
  /** The sticky-footer button is live. */
  submitEnabled: boolean;
  /** The actor may submit Phase 1 themselves (else the button hands off). */
  roleCanSubmit: boolean;
  /** Phase 1 tick-items not yet ticked. */
  remainingTicks: number;
  /** The first ticked station item still missing its temp reading, and its station. */
  firstMissingTemp: { label: string; station: string } | null;
  spotCheckBlockReason: "template_misconfigured" | "verify_sections" | null;
  /** A no-prior-closing-data recount was entered and the reason is still unpicked. */
  attestationMissing: boolean;
  phase2AlreadyFinalized: boolean;
  /** Phase 2 prep rows not yet saved. */
  outstandingCount: number;
}

export type OpeningFooterHint =
  | { kind: "ready" }
  | { kind: "role" }
  | { kind: "items_remaining"; remaining: number }
  | { kind: "temps_required"; item: string; station: string }
  | { kind: "template_misconfigured" }
  | { kind: "verify_sections" }
  | { kind: "reason_required" }
  | { kind: "already_finalized" }
  | { kind: "outstanding"; count: number }
  | { kind: "generic" };

/**
 * #10 — the one line under the opening counters: the FIRST thing still blocking the button on
 * the active tab. "Submit disabled" (generic) only when no blocker is known (e.g. submitting).
 */
export function openingFooterHint(s: OpeningFooterState): OpeningFooterHint {
  if (s.submitEnabled) return s.roleCanSubmit ? { kind: "ready" } : { kind: "role" };
  if (s.activePhase === "verification") {
    if (s.remainingTicks > 0) return { kind: "items_remaining", remaining: s.remainingTicks };
    if (s.firstMissingTemp) return { kind: "temps_required", item: s.firstMissingTemp.label, station: s.firstMissingTemp.station };
    if (s.spotCheckBlockReason !== null) return { kind: s.spotCheckBlockReason };
    if (s.attestationMissing) return { kind: "reason_required" };
    return { kind: "generic" };
  }
  if (s.phase2AlreadyFinalized) return { kind: "already_finalized" };
  if (s.outstandingCount > 0) return { kind: "outstanding", count: s.outstandingCount };
  return { kind: "generic" };
}

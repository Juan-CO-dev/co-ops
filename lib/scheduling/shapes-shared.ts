/**
 * THE PERSISTED SHAPES — the TS twins of 0275's `valid_schedule_segments` and `valid_gap_certificate` (Scheduling
 * Phase 2, Task 14). Pure, total, never throws. Both run the shared case files tests/fixtures/schedule/segment-cases.json
 * and certificate-cases.json (vitest: tests/schedule-shapes.test.ts; SQL: scripts/sql-harness-0275.mjs), so the lib
 * refuses before the RPC exactly what the SQL would refuse after it.
 *
 * A certificate's SHAPE is not its proof: whether it VERIFIES is `checkCertificate` (rules-shared), replayed against
 * the revision's own context snapshot. These only say "this is a certificate of that cause at all".
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v) && Number.isInteger(v) && v >= lo && v <= hi;
const isQ = (v: unknown): v is number => isInt(v, 0, 96);
const nonneg = (v: unknown) => isNum(v) && v >= 0;
const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
const exact = (o: unknown, keys: readonly string[]): o is Record<string, unknown> =>
  isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SEGMENT_KEYS = ["positionId", "startQ", "endQ", "lastResort", "coverFor", "reasonKey"];

/**
 * A shift's segments: a non-empty array, contiguous, spanning [startQ, endQ) exactly, each at least one quarter, each
 * position a uuid or "mod"; the optional flags lastResort (boolean), coverFor and reasonKey (strings).
 */
export function validScheduleSegments(segments: unknown, startQ: unknown, endQ: unknown): boolean {
  if (!Array.isArray(segments) || segments.length === 0 || !isNum(startQ) || !isNum(endQ) || startQ >= endQ) return false;
  let at = startQ;
  for (const g of segments) {
    if (!isObj(g) || !("positionId" in g) || !("startQ" in g) || !("endQ" in g)) return false;
    if (Object.keys(g).some((k) => !SEGMENT_KEYS.includes(k))) return false;
    if (typeof g.positionId !== "string" || !(g.positionId === "mod" || UUID.test(g.positionId))) return false;
    if (!isQ(g.startQ) || !isQ(g.endQ)) return false;
    if (g.startQ !== at || g.endQ <= g.startQ) return false;
    if (("lastResort" in g && typeof g.lastResort !== "boolean") || ("coverFor" in g && typeof g.coverFor !== "string")
      || ("reasonKey" in g && typeof g.reasonKey !== "string")) return false;
    at = g.endQ;
  }
  return at === endQ;
}

const STEP_KEYS: Record<string, readonly string[]> = {
  relabel: ["kind", "userId", "shiftStartQ", "fromPositionId", "positionId", "fromQ", "toQ"],
  extend: ["kind", "userId", "shiftStartQ", "positionId", "fromQ", "toQ", "hours"],
  new_block: ["kind", "userId", "positionId", "fromQ", "toQ", "hours"],
};

/** One step of a budget_limited witness (rules-shared FillStep): its exact keys, ids as strings, a window on the grid. */
function validFillStep(v: unknown): boolean {
  if (!isObj(v) || typeof v.kind !== "string" || !Object.hasOwn(STEP_KEYS, v.kind)) return false;
  if (!exact(v, STEP_KEYS[v.kind]!) || typeof v.userId !== "string" || typeof v.positionId !== "string") return false;
  if (!isQ(v.fromQ) || !isQ(v.toQ) || v.fromQ >= v.toQ) return false;
  if ("shiftStartQ" in v && !isQ(v.shiftStartQ)) return false;
  if ("fromPositionId" in v && typeof v.fromPositionId !== "string") return false;
  return !("hours" in v) || nonneg(v.hours);
}

export const GAP_CAUSES = ["budget_limited", "floor_limit", "eligibility", "availability", "capacity", "structure", "unresolved_search"] as const;
const STRUCTURE_RULES = ["primary_window_closed", "no_mod_member", "no_closing_role", "max_shift"];
/** The floor_limit exclusions (rules-shared FloorExclusion), spelled here so the shape stays dependency-free like the SQL twin. */
const FLOOR_EXCLUSIONS = ["flex_exhausted", "ineligible", "unavailable", "day_at_max"];

/** A gap certificate's SHAPE per cause: the exact key set, strings where ids go, non-negative numbers where numbers go. */
export function validGapCertificateShape(cause: unknown, c: unknown): boolean {
  if (!isObj(c)) return false;
  switch (cause) {
    case "budget_limited":
      // CC chunk D design ruling: R (remainingHours, may be negative) < W (fillHours), with the witness fill's steps.
      return exact(c, ["budgetedDates", "budgetHours", "usedHours", "essentialHours", "remainingHours", "fillHours", "witness"]) && strings(c.budgetedDates)
        && nonneg(c.budgetHours) && nonneg(c.usedHours) && nonneg(c.essentialHours) && isNum(c.remainingHours) && nonneg(c.fillHours)
        && Array.isArray(c.witness) && c.witness.length > 0 && c.witness.every(validFillStep);
    case "floor_limit":
      // CC chunk H4 / H5 / H6: the CONSERVATIVE certificate — the four limits, the eligible hourly people (each "unavailable": at no
      // quarter of the window), and per salaried manager the condition that excluded them (flex_exhausted / ineligible / unavailable /
      // day_at_max) with their flex and floor hours.
      return exact(c, ["limitH", "targetWeekH", "salariedFlexH", "maxShiftH", "hourlyExcluded", "excludedBy", "flexHoursUsed", "floorHoursUsed"])
        && nonneg(c.limitH) && nonneg(c.targetWeekH) && nonneg(c.salariedFlexH) && nonneg(c.maxShiftH)
        && isObj(c.hourlyExcluded) && Object.values(c.hourlyExcluded).every((v) => v === "unavailable")
        && isObj(c.excludedBy) && Object.values(c.excludedBy).every((v) => typeof v === "string" && FLOOR_EXCLUSIONS.includes(v))
        && isObj(c.flexHoursUsed) && Object.values(c.flexHoursUsed).every(nonneg) && isObj(c.floorHoursUsed) && Object.values(c.floorHoursUsed).every(nonneg);
    case "eligibility":
      return exact(c, ["positionId", "eligibleCount"]) && (typeof c.positionId === "string" || c.positionId === null) && c.eligibleCount === 0;
    case "availability":
      return exact(c, ["eligibleIds", "unavailableIds"]) && strings(c.eligibleIds) && strings(c.unavailableIds);
    case "capacity":
      return exact(c, ["fromQ", "toQ", "positionIds", "requiredHeads", "peopleIds", "people", "shortBy"]) && isQ(c.fromQ) && isQ(c.toQ)
        && c.fromQ < c.toQ && strings(c.positionIds) && strings(c.peopleIds) && isInt(c.requiredHeads, 0, 1000) && isInt(c.people, 0, 1000)
        && isInt(c.shortBy, 1, 1000);
    case "structure":
      return exact(c, ["rule", "detail"]) && typeof c.rule === "string" && STRUCTURE_RULES.includes(c.rule) && isObj(c.detail);
    case "unresolved_search": {
      if (!exact(c, ["searched", "limits", "candidateIds"]) || !strings(c.candidateIds)) return false;
      const s = c.searched;
      const l = c.limits;
      return exact(s, ["steps", "donorsTried", "chainDepth"]) && isInt(s.steps, 0, 1e6) && isInt(s.donorsTried, 0, 1e6) && isInt(s.chainDepth, 0, 1e6)
        && exact(l, ["REPAIR_MAX_STEPS", "maxDonors", "maxChainDepth"]) && isInt(l.REPAIR_MAX_STEPS, 0, 1e6) && isInt(l.maxDonors, 0, 1e6)
        && isInt(l.maxChainDepth, 0, 1e6);
    }
    default:
      return false;
  }
}

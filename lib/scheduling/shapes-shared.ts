import { compareCodePoint } from "./order-shared";
/**
 * THE PERSISTED SHAPES — the TS twins of 0275's `valid_schedule_segments` and `valid_gap_certificate` (Scheduling
 * Phase 2, Task 14). Pure, total, never throws. Both run the shared case files tests/fixtures/schedule/segment-cases.json
 * and certificate-cases.json (vitest: tests/schedule-shapes.test.ts; SQL: scripts/sql-harness-0275.mjs), so the lib
 * refuses before the RPC exactly what the SQL would refuse after it.
 *
 * A certificate's SHAPE is not its proof: whether it VERIFIES is `checkCertificate` (rules-shared), replayed against
 * the revision's own context snapshot. These only say "this is a certificate of that cause at all".
 */

import type { CrewGapCertificate } from "./crew-contracts-shared";

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

export const GAP_CAUSES = ["budget_limited", "floor_limit", "eligibility", "availability", "capacity", "structure", "unresolved_search", "crew_shortfall"] as const;
const STRUCTURE_RULES = ["primary_window_closed", "no_mod_member", "no_closing_role", "max_shift"];
/** The floor_limit exclusions (rules-shared FloorExclusion), spelled here so the shape stays dependency-free like the SQL twin. */
/** The floor_limit reasons (rules-shared FloorReason), spelled here so the shape stays dependency-free like the SQL twin. */
const FLOOR_REASONS = ["unavailable", "flex_exhausted", "day_at_max", "never_generated"];

/** A gap certificate's SHAPE per cause: the exact key set, strings where ids go, non-negative numbers where numbers go. */
export function validGapCertificateShape(cause: unknown, c: unknown): boolean {
  if (!isObj(c)) return false;
  switch (cause) {
    case "crew_shortfall": return validCrewGapCertificateShape(c);
    case "budget_limited":
      // CC chunk D design ruling: R (remainingHours, may be negative) < W (fillHours), with the witness fill's steps.
      return exact(c, ["budgetedDates", "budgetHours", "usedHours", "essentialHours", "remainingHours", "fillHours", "witness"]) && strings(c.budgetedDates)
        && nonneg(c.budgetHours) && nonneg(c.usedHours) && nonneg(c.essentialHours) && isNum(c.remainingHours) && nonneg(c.fillHours)
        && Array.isArray(c.witness) && c.witness.length > 0 && c.witness.every(validFillStep);
    case "floor_limit":
      // CC chunk H4–H8: the CONSERVATIVE certificate — the four limits, EVERY candidate (whoever may legally hold the position by any
      // path the validator accepts) → the reason they are excluded (unavailable / flex_exhausted / day_at_max / never_generated), and
      // the salaried candidates' flex and floor hours. "on_shift_legal" is not a reason: it means no certificate.
      return exact(c, ["limitH", "targetWeekH", "salariedFlexH", "maxShiftH", "excludedBy", "flexHoursUsed", "floorHoursUsed"])
        && nonneg(c.limitH) && nonneg(c.targetWeekH) && nonneg(c.salariedFlexH) && nonneg(c.maxShiftH)
        && isObj(c.excludedBy) && Object.values(c.excludedBy).every((v) => typeof v === "string" && FLOOR_REASONS.includes(v))
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

/** 0284's strict crew certificate shape; proof is replayed separately against the snapshot. */
export function validCrewGapCertificateShape(c: unknown): c is CrewGapCertificate {
  // Kept dependency-free for Node's native TS SQL harness; parity is pinned in crew-contract tests.
  const codes = ["off", "time_off", "unavailable", "already_scheduled", "position", "leader_setting",
    "minimum_length", "maximum_length", "day_limit", "soft_max", "overtime", "budget", "manager_limit", "backup_cover_cap"];
  const sortedStrings = (v: unknown): v is string[] => Array.isArray(v)
    && v.every((x, i) => typeof x === "string" && x.length > 0 && (i === 0 || compareCodePoint(v[i - 1], x) < 0));
  if (!isObj(c)) return false;
  if (c.kind === "station_short") {
    return exact(c, ["kind", "required", "assigned", "onShiftUserIds"])
      && isInt(c.required, 1, 1000) && isInt(c.assigned, 0, 1000) && c.assigned < c.required
      && sortedStrings(c.onShiftUserIds);
  }
  if (c.kind !== "open_shifts" || !exact(c, ["kind", "items"]) || !Array.isArray(c.items) || !c.items.length) return false;
  let start: number | undefined;
  let previous = "";
  for (const item of c.items) {
    if (!exact(item, ["typeId", "fromQ", "toQ", "required", "placed", "missing", "rejected"])
      || typeof item.typeId !== "string" || compareCodePoint(item.typeId, previous) <= 0 || !isQ(item.fromQ) || !isQ(item.toQ)
      || item.fromQ >= item.toQ || (start !== undefined && item.fromQ !== start)
      || !isInt(item.required, 1, 1000) || !isInt(item.placed, 0, 1000) || !isInt(item.missing, 1, 1000)
      || item.required - item.placed !== item.missing || !Array.isArray(item.rejected)) return false;
    start = item.fromQ;
    previous = item.typeId;
    let lastUser = "";
    for (const rejection of item.rejected) {
      if (!exact(rejection, ["userId", "codes"]) || typeof rejection.userId !== "string" || compareCodePoint(rejection.userId, lastUser) <= 0
        || !Array.isArray(rejection.codes) || !rejection.codes.length
        || new Set(rejection.codes).size !== rejection.codes.length
        || rejection.codes.some((code) => !codes.includes(code))) return false;
      lastUser = rejection.userId;
    }
  }
  return true;
}

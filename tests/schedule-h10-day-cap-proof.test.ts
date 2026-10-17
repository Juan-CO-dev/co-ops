/**
 * CC chunk H10 P1 ruling (2026-10-17, Astra H9 P1, BC-042 / BC-060) — being at the day cap is NEVER an exclusion in any proof.
 * A person's other assigned dates are MUTABLE: Astra's case — A works Mon–Fri, B works Tue–Fri and is unavailable Saturday —
 * certified Saturday's gap as floor_limit, capacity AND availability, yet "B takes A's Monday, A takes Saturday" is valid (both
 * on 5 dates, `checkScheduleRules` = []). The 5-date rule stays a hard GENERATION constraint and a validator warning; it never
 * proves a gap. Whatever the generator cannot fill under the cap is `unresolved_search`. The inverse holds: a person whose
 * availability truly excludes the window still excludes.
 */
import { describe, expect, it } from "vitest";
import {
  capacityBound, checkCertificate, checkScheduleRules, floorCandidateStatus, floorLimitCertificate, generatorRefuses, proveGap, type DeclaredGap,
} from "@/lib/scheduling/rules-shared";
import type { RuleContext } from "@/lib/scheduling/context-shared";
import { DATES, FRI, MON, P, SAT, THU, TUE, U, WED, context, setNeed, shift, week } from "./fixtures/schedule/rules-fixture";

/** Only A (U.ben) and B (U.maya) on the roster; B is unavailable on Saturday (and A too when `aOffSat`). */
function abContext(aOffSat = false): RuleContext {
  const ctx = context({ built: [...DATES] });
  const a = { ...ctx.people[U.ben]!, availability: aOffSat ? { [SAT]: null } : {} };
  const b = { ...ctx.people[U.maya]!, availability: { [SAT]: null } };
  ctx.people = { [a.userId]: a, [b.userId]: b };
  for (const d of [MON, TUE, WED, THU, FRI, SAT]) setNeed(ctx, d, P.REG, 44, 60);
  return ctx;
}
const A_WEEK = [MON, TUE, WED, THU, FRI].map((d) => shift(U.ben, d, 44, 60, P.REG));
const B_WEEK = [TUE, WED, THU, FRI].map((d) => shift(U.maya, d, 44, 60, P.WALKON));
const SAT_GAP = { code: "coverage_gap" as const, date: SAT, positionId: P.REG, fromQ: 44, toQ: 60 };

describe("H10 P1: the day cap never proves a gap", () => {
  it("Astra's case: Saturday does NOT certify — not floor_limit, not capacity, not availability, no cause at all", () => {
    const ctx = abContext();
    const s = week([...A_WEEK, ...B_WEEK]);
    expect(floorCandidateStatus(ctx.people[U.ben]!, SAT_GAP, s, ctx)).toBeNull();
    expect(floorLimitCertificate(SAT_GAP, s, ctx)).toBeNull();
    expect(capacityBound(SAT_GAP, s, ctx)).toBeNull();
    const availability = { ...SAT_GAP, cause: "availability", certificate: { eligibleIds: [U.ben, U.maya].sort(), unavailableIds: [U.ben, U.maya].sort() } } as DeclaredGap;
    expect(checkCertificate(availability, s, ctx)).toBe(false);
    expect(proveGap(SAT_GAP, s, ctx)).toBeNull();
  });

  it("…and the reassignment the proof would have denied is valid: B takes A's Monday, A takes Saturday (both on 5 dates)", () => {
    const ctx = abContext();
    const swapped = week([
      ...[TUE, WED, THU, FRI, SAT].map((d) => shift(U.ben, d, 44, 60, P.REG)),
      shift(U.maya, MON, 44, 60, P.REG), ...B_WEEK,
    ]);
    expect(checkScheduleRules(swapped, ctx).filter((p) => generatorRefuses(p) || p.severity === "gap")).toEqual([]);
  });

  it("the inverse: when A's availability truly excludes Saturday too, the gap certifies (availability) and A is unavailable", () => {
    const ctx = abContext(true);
    const s = week([...A_WEEK, ...B_WEEK]);
    expect(floorCandidateStatus(ctx.people[U.ben]!, SAT_GAP, s, ctx)).toBe("unavailable");
    // capacity comes first in the cause order (nobody available in the window), and availability verifies on its own too.
    expect(proveGap(SAT_GAP, s, ctx)?.cause).toBe("capacity");
    const availability = { ...SAT_GAP, cause: "availability", certificate: { eligibleIds: [U.ben, U.maya].sort(), unavailableIds: [U.ben, U.maya].sort() } } as DeclaredGap;
    expect(checkCertificate(availability, s, ctx)).toBe(true);
  });
});

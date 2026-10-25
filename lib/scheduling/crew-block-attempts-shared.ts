import type { DayContext, RulePerson } from "./context-shared";
import type { CrewRejectionCode, CrewShiftMeta } from "./crew-contracts-shared";
import type { ShiftType } from "./structure-shared";
import { leaderSettingAllows } from "./people-rules-shared";
import { crewLegalityCache } from "./crew-legality-cache-shared";
import { compareCodePoint } from "./order-shared";

export type CrewBlockAttempt = readonly [number, number];
export const crewMinimumQ = (p: RulePerson, t: ShiftType, day: DayContext) => Math.max(t.minLengthQ, day.structure.limits.minimumShiftQ,
  p.salaried ? (p.role === "gm" ? day.structure.limits.gmMinimumH * 4 : p.role === "agm" ? day.structure.limits.agmMinimumH * 4 : 0) : 0);

/** One replay for both allocation and proof. Hours refusals unlock fix-F trims;
 * usual blocks retain their end. The callback supplies the current week/allocation limits. */
export function crewBlockAttempts(p: RulePerson, t: ShiftType, date: string, day: DayContext,
  source: CrewShiftMeta["source"], reject: (a: number, z: number) => CrewRejectionCode | null,
  options: { holes?: readonly number[]; required?: readonly number[]; shorten?: boolean;
    legality?: ReturnType<typeof crewLegalityCache> } = {}) {
  const { legalHoldPath, modCountsOn } = options.legality ?? crewLegalityCache();
  const st = day.structure, av = p.availability[date];
  const own = p.usualShift?.value?.typeId === t.id ? p.usualShift.value : null;
  const usualBlock = source === "usual" || (source === "salaried" && own !== null);
  const anchorStart = own?.fromQ ?? t.fromQ, anchorEnd = own?.toQ ?? t.toQ;
  const lo = Math.max(st.shopDay.prepStartQ, av?.fromQ ?? 0), hi = Math.min(day.scheduledOutQ, av?.toQ ?? 96);
  const baseStart = Math.max(lo, anchorStart), baseEnd = Math.min(hi, anchorEnd);
  const minimum = crewMinimumQ(p, t, day);
  function* offsets() {
    yield 0;
    for (let n = 1; n <= t.startFlexQ; n++) { yield n; yield -n; }
  }
  function* attempts(): Generator<CrewBlockAttempt> {
    yield [baseStart, baseEnd];
    for (const o of offsets()) yield [anchorStart + o, baseEnd];
    if (usualBlock) return;
    for (const o of offsets()) yield [baseStart, anchorEnd + o];
    // The old pair sort: Manhattan distance, then numeric start, then numeric end.
    // Enumerate that order directly; no quadratic pair array or sort on ordinary calls.
    for (let distance = 2; distance <= 2 * t.startFlexQ; distance++) {
      for (let a = -t.startFlexQ; a <= t.startFlexQ; a++) {
        const z = distance - Math.abs(a);
        if (a === 0 || z < 1 || z > t.startFlexQ) continue;
        for (const end of [-z, z]) {
          const block: CrewBlockAttempt = [anchorStart + a, anchorEnd + end];
          if (block[1] - block[0] <= st.limits.maxShiftH * 4) yield block;
        }
      }
    }
  }
  function* ordered(): Generator<CrewBlockAttempt> {
    if (!options.holes?.length || !t.countsTowardMod) { yield* attempts(); return; }
    const required = (options.required ?? []).filter((q) => modCountsOn(p, day, q));
    const holes = options.holes.filter((q) => modCountsOn(p, day, q));
    if (!required.length && !holes.length) { yield* attempts(); return; }
    const coverage = ([a, z]: CrewBlockAttempt, qs: readonly number[]) => qs.filter((q) => a <= q && q < z).length;
    // Only coverage-prioritized searches need all candidates. Score each once;
    // stable sorting preserves the original attempt order on equal coverage.
    const scored = Array.from(attempts(), (block) => ({ block, required: coverage(block, required), holes: coverage(block, holes) }));
    scored.sort((a, b) => b.required - a.required || b.holes - a.holes);
    for (const { block } of scored) yield block;
  }
  const tried: Array<{ block: CrewBlockAttempt; code: CrewRejectionCode | null }> = [];
  const hoursFailed: CrewBlockAttempt[] = [];
  const fit = t.stations.length ? t.stations : Object.keys(st.positions).sort(compareCodePoint);
  const accepts = (block: CrewBlockAttempt) => {
    const [a, z] = block;
    let code: CrewRejectionCode | null = null;
    if (av === null || a < lo || z > hi || (usualBlock && baseEnd < anchorEnd)) code = "unavailable";
    else if (z - a < minimum) code = "minimum_length";
    else if (!leaderSettingAllows(p, st, a, z)) code = "leader_setting";
    else {
      let canHold = false;
      for (let q = a; q < z && !canHold; q++) canHold = fit.some((id) => (!p.backupCover || p.coverPositions.includes(id)) && legalHoldPath(p, id, day, date, q))
        || (!p.backupCover && t.countsTowardMod && modCountsOn(p, day, q));
      code = !canHold ? "position" : z - a > st.limits.maxShiftH * 4 ? "maximum_length" : reject(a, z);
    }
    tried.push({ block, code });
    if (code && ["maximum_length", "soft_max", "overtime", "budget"].includes(code)) hoursFailed.push(block);
    return code === null;
  };
  function firstAccepted(blocks: Iterable<CrewBlockAttempt>) {
    const seen = new Set<string>();
    for (const block of blocks) {
      const key = `${block[0]}|${block[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (accepts(block)) return block;
    }
  }
  let match = firstAccepted(ordered());
  if (options.shorten && !p.salaried && hoursFailed.length) {
    const accepted = match;
    // accepts records further refusals: freeze the pre-trim sources, as before.
    const failed = hoursFailed.slice();
    function* trims(): Generator<CrewBlockAttempt> {
      const longest = failed.reduce((n, [a, z]) => Math.max(n, z - a - 1), accepted ? accepted[1] - accepted[0] : minimum - 1);
      for (let length = longest; length >= minimum; length--) {
        if (accepted && accepted[1] - accepted[0] === length) yield accepted;
        for (const [a, z] of failed) if (z - a > length) {
          yield [z - length, z]; yield [a, a + length];
        }
      }
    }
    match = firstAccepted(trims());
  }
  return { match, tried, rejection: tried.at(-1)?.code ?? "minimum_length" };
}

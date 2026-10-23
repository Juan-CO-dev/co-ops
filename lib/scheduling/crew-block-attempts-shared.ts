import type { DayContext, RulePerson } from "./context-shared";
import type { CrewRejectionCode, CrewShiftMeta } from "./crew-contracts-shared";
import type { ShiftType } from "./structure-shared";
import { leaderSettingAllows, legalHoldPath, modCountsOn } from "./rules-shared";
import { compareCodePoint } from "./order-shared";

export type CrewBlockAttempt = readonly [number, number];
export const crewMinimumQ = (p: RulePerson, t: ShiftType, day: DayContext) => Math.max(t.minLengthQ, day.structure.limits.minimumShiftQ,
  p.salaried ? (p.role === "gm" ? day.structure.limits.gmMinimumH * 4 : p.role === "agm" ? day.structure.limits.agmMinimumH * 4 : 0) : 0);

/** One replay for both allocation and proof. Hours refusals unlock fix-F trims;
 * usual blocks retain their end. The callback supplies the current week/allocation limits. */
export function crewBlockAttempts(p: RulePerson, t: ShiftType, date: string, day: DayContext,
  source: CrewShiftMeta["source"], reject: (a: number, z: number) => CrewRejectionCode | null,
  options: { holes?: readonly number[]; required?: readonly number[]; shorten?: boolean } = {}) {
  const st = day.structure, av = p.availability[date];
  const own = p.usualShift?.value?.typeId === t.id ? p.usualShift.value : null;
  const usualBlock = source === "usual" || (source === "salaried" && own !== null);
  const anchorStart = own?.fromQ ?? t.fromQ, anchorEnd = own?.toQ ?? t.toQ;
  const lo = Math.max(st.shopDay.prepStartQ, av?.fromQ ?? 0), hi = Math.min(day.scheduledOutQ, av?.toQ ?? 96);
  const baseStart = Math.max(lo, anchorStart), baseEnd = Math.min(hi, anchorEnd);
  const minimum = crewMinimumQ(p, t, day);
  const offsets = [0, ...Array.from({ length: t.startFlexQ }, (_, n) => [n + 1, -n - 1]).flat()];
  const pairs = usualBlock ? [] : offsets.flatMap((a) => offsets.filter((z) => a !== 0 && z !== 0).map((z) => [a, z] as const))
    .sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]) || a[0] - b[0] || a[1] - b[1]
      || compareCodePoint(`${a[0]}|${a[1]}`, `${b[0]}|${b[1]}`));
  const attempts: CrewBlockAttempt[] = [[baseStart, baseEnd], ...offsets.map((o) => [anchorStart + o, baseEnd] as const),
    ...(usualBlock ? [] : offsets.map((o) => [baseStart, anchorEnd + o] as const)),
    ...pairs.map(([a, z]) => [anchorStart + a, anchorEnd + z] as const).filter(([a, z]) => z - a <= st.limits.maxShiftH * 4)];
  const coverage = ([a, z]: CrewBlockAttempt, qs: readonly number[]) => t.countsTowardMod
    ? qs.filter((q) => a <= q && q < z && modCountsOn(p, day, q)).length : 0;
  if (options.holes?.length) attempts.sort((a, b) => coverage(b, options.required ?? []) - coverage(a, options.required ?? [])
    || coverage(b, options.holes!) - coverage(a, options.holes!));
  const tried: Array<{ block: CrewBlockAttempt; code: CrewRejectionCode | null }> = [];
  const hoursFailed: CrewBlockAttempt[] = [];
  const accepts = (block: CrewBlockAttempt) => {
    const [a, z] = block;
    let code: CrewRejectionCode | null = null;
    if (av === null || a < lo || z > hi || (usualBlock && baseEnd < anchorEnd)) code = "unavailable";
    else if (z - a < minimum) code = "minimum_length";
    else if (!leaderSettingAllows(p, st, a, z)) code = "leader_setting";
    else {
      const fit = t.stations.length ? t.stations : Object.keys(st.positions).sort(compareCodePoint);
      let canHold = false;
      for (let q = a; q < z && !canHold; q++) canHold = fit.some((id) => legalHoldPath(p, id, day, date, q))
        || (t.countsTowardMod && modCountsOn(p, day, q));
      code = !canHold ? "position" : z - a > st.limits.maxShiftH * 4 ? "maximum_length" : reject(a, z);
    }
    tried.push({ block, code });
    if (code && ["maximum_length", "soft_max", "overtime", "budget"].includes(code)) hoursFailed.push(block);
    return code === null;
  };
  let match = [...new Map(attempts.map((b) => [`${b[0]}|${b[1]}`, b])).values()].find(accepts);
  if (options.shorten && !p.salaried && hoursFailed.length) {
    const trims: CrewBlockAttempt[] = match ? [match] : [];
    for (const [a, z] of hoursFailed) for (let length = z - a - 1; length >= minimum; length--) trims.push([z - length, z], [a, a + length]);
    const unique = [...new Map(trims.map((b) => [`${b[0]}|${b[1]}`, b])).values()].sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
    match = unique.find(accepts);
  }
  return { match, tried, rejection: tried.at(-1)?.code ?? "minimum_length" };
}

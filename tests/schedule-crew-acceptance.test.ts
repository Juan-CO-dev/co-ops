import { beforeAll, describe, expect, it } from "vitest";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { crewOpenItems, verifyCrewGap, shiftCountsAsMod } from "@/lib/scheduling/crew-gap-verifier-shared";
import { checkScheduleRules } from "@/lib/scheduling/rules-shared";
import { acceptanceInputs, DATES, WEEK, personId } from "./fixtures/schedule/crew-p-street-2026-10-19";

const run = (inputs = acceptanceInputs()) => generateWeek(generatorInputFor(inputs, WEEK, { today: WEEK }));
const clock = (q: number) => `${String(Math.floor(q / 4)).padStart(2, "0")}:${String(q % 4 * 15).padStart(2, "0")}`;
function schedule(out: ReturnType<typeof run>) { return { locationId: "shop-p-street", weekStart: WEEK, shifts: out.shifts, days: out.days, gaps: out.gaps }; }
export function weekTable(out: ReturnType<typeof run>): string {
  return ["Person | Mon 19 | Tue 20 | Wed 21 | Thu 22 | Fri 23 | Sat 24 | Sun 25", ...acceptanceInputs().members.map((p) =>
    [p.name, ...DATES.map((date) => out.shifts.filter((s) => s.userId === p.userId && s.date === date).map((s) =>
      `${clock(s.startQ)}-${clock(s.endQ)} ${out.context.days[date]!.crew!.shifts.find((m) => m.userId === s.userId && m.startQ === s.startQ)?.typeId}`).join(", ") || "-")].join(" | "))].join("\n");
}
let out: ReturnType<typeof run>;
beforeAll(() => {
  const start = performance.now(); out = run();
  process.stdout.write(`P STREET build: ${(performance.now() - start).toFixed(1)} ms\n${weekTable(out)}\n`);
}, 60000);
const shifts = (name: string, result = out) => result.shifts.filter((s) => s.userId === personId(name));
function exact(name: string, days: number[], fromQ: number, toQ: number) {
  expect(shifts(name).map((s) => [s.date, s.startQ, s.endQ])).toEqual(days.map((d) => [DATES[d - 1], fromQ, toQ]));
}
describe("P Street crew acceptance, 2026-10-19 (snapshot + R14)", () => {
  it("explains every day outside 7-8 distinct people with honest whole open-shift evidence", () => {
    const counts = DATES.map((date) => new Set(out.shifts.filter((s) => s.date === date).map((s) => s.userId)).size);
    expect(out.gaps.filter((g) => g.cause === "unresolved_search")).toEqual([]);
    for (const [i, date] of DATES.entries()) {
      const open = crewOpenItems(date, schedule(out), out.context);
      process.stdout.write(`${date}: ${counts[i]} people\n`);
      if (!open.length) { expect(counts[i]).toBeGreaterThanOrEqual(7); continue; }
      expect(open.length).toBeGreaterThan(0);
      expect(open.every((x) => x.typeId === "mid" && x.missing > 0)).toBe(true);
      for (const item of open) {
        const gap = out.gaps.find((g) => g.date === date && g.code === "open_shift" && g.fromQ <= item.fromQ && g.toQ >= item.toQ);
        expect(gap?.cause).toBe("crew_shortfall");
        expect(verifyCrewGap(gap!, schedule(out), out.context)).toBe(true);
      }
      process.stdout.write(`${date}: ${counts[i]} people; ${open.map((x) => `${x.typeId} ${x.placed}/${x.required}, ${x.missing} open`).join("; ")}; ${out.gaps.find((g) => g.date === date && g.code === "open_shift")!.cause}.\n`);
      process.stdout.write(`  Candidate evidence: ${open.flatMap((x) => x.rejected.map((r) => `${r.userId.replace("person-", "")}: ${r.codes.join("+") || "unproven"}`)).join("; ")}\n`);
    }
  });
  it("keeps the busiest Mid seats ahead of optional weekday fill", () => {
    const akia = shifts("Akia");
    expect(akia.filter((s) => DATES.slice(4).includes(s.date)).map((s) => [s.date, s.startQ, s.endQ]))
      .toEqual(DATES.slice(4).map((date) => [date, 40, 82]));
    expect(akia.reduce((n, s) => n + (s.endQ - s.startQ) / 4, 0)).toBeLessThanOrEqual(40);
  });
  it("reports the hourly Mid capacity separately from leadership reservations and unresolved seats", () => {
    const input = generatorInputFor(acceptanceInputs(), WEEK, { today: WEEK });
    const mids = input.people.filter((p) => !p.salaried && !p.presenceOnly && p.usualShift?.value?.typeId === "mid");
    const available = mids.reduce((n, p) => n + Math.min(p.softMaxH ?? Infinity, input.structure.limits.overtimeH), 0);
    const midShifts = out.shifts.filter((s) => out.context.days[s.date]!.crew!.shifts.some((m) => m.userId === s.userId && m.startQ === s.startQ && m.typeId === "mid"));
    const hours = (ss: typeof out.shifts) => ss.reduce((n, s) => n + (s.endQ - s.startQ) / 4, 0);
    const reserved = hours(out.shifts.filter((s) => mids.some((p) => p.userId === s.userId) && !midShifts.includes(s)));
    const salaried = hours(midShifts.filter((s) => out.context.people[s.userId]!.salaried));
    const needed = DATES.reduce((n, date) => {
      const d = out.context.days[date]!, t = d.structure.shiftTypes!.find((t) => t.id === "mid")!;
      return n + t.headcount[d.dayType] * (t.toQ - t.fromQ) / 4;
    }, 0);
    expect(needed).toBeGreaterThan(0);
    expect(hours(midShifts)).toBeLessThanOrEqual(available - reserved + salaried);
    process.stdout.write(`Mid hours: ${mids.length} hourly people x 40 = ${available}; ${reserved} reserved as openers; ${available - reserved} left for Mid + ${salaried} salaried Mid; ${needed} full seat-hours needed; unavoidable deficit ${needed - (available - reserved + salaried)} h. Actual Mid ${hours(midShifts)} h; ${needed - hours(midShifts)} h short, unused hourly capacity ${available - reserved - (hours(midShifts) - salaried)} h.\n`);
  });
  it("keeps every shift above type minimum with one contiguous shift per person/day, no fragments", () => {
    const seen = new Set<string>();
    for (const s of out.shifts) {
      const day = out.context.days[s.date]!;
      const meta = day.crew!.shifts.find((m) => m.userId === s.userId && m.startQ === s.startQ)!;
      const type = day.structure.shiftTypes!.find((t) => t.id === meta.typeId)!;
      expect(s.endQ - s.startQ).toBeGreaterThanOrEqual(type.minLengthQ);
      expect(seen.has(`${s.date}|${s.userId}`)).toBe(false); seen.add(`${s.date}|${s.userId}`);
      for (let q = s.startQ; q < s.endQ; q++) expect(s.segments.filter((seg) => seg.startQ <= q && q < seg.endQ)).toHaveLength(1);
    }
  });
  it("keeps Henry Tue-Sat 7:30-4 and honestly warns on his 42.5 hour usual week", () => {
    exact("Henry", [2, 3, 4, 5, 6], 30, 64);
    expect(out.notes).toContainEqual(expect.objectContaining({ code: "overtime_used", userId: personId("Henry") }));
  });
  it("keeps Daniela Thu-Mon 4-8:30, never Tue/Wed, and Josselin Tue/Wed PM", () => {
    exact("Daniela", [1, 4, 5, 6, 7], 64, 82); exact("Josselin", [2, 3], 64, 82);
  });
  it("keeps Santos/Veronica on weekends and Tio Mon-Fri", () => {
    exact("Santos", [6, 7], 30, 64); exact("Veronica", [6, 7], 30, 64); exact("Tio", [1, 2, 3, 4, 5], 32, 64);
  });
  it("uses Friday if-needed openers only when a shortage is introduced", () => {
    const input = acceptanceInputs();
    for (const name of ["Henry", "Tio"]) input.personSettings.find((p) => p.userId === personId(name))!.availability![5] = { mode: "off" };
    const shortage = run(input);
    for (const name of ["Santos", "Veronica"]) {
      expect(shifts(name).some((s) => s.date === DATES[4])).toBe(false);
      expect(shifts(name, shortage).some((s) => s.date === DATES[4])).toBe(true);
    }
  });
  it("covers every required MoD quarter or requires a proven approvable structure gap", () => {
    for (const date of DATES) {
      const day = out.context.days[date]!;
      for (let q = day.structure.shopDay.prepStartQ; q < day.scheduledOutQ; q++) {
        if (out.shifts.some((s) => s.date === date && shiftCountsAsMod(s, out.context.people[s.userId]!, day, q))) continue;
        expect(out.gaps.some((g) => g.date === date && g.code === "mod_missing" && g.fromQ <= q && q < g.toQ && g.cause === "structure")).toBe(true);
      }
    }
    expect(checkScheduleRules(schedule(out), out.context).filter((p) => p.code === "mod_missing" && p.params?.proven !== true)).toEqual([]);
    expect(out.gaps.filter((g) => g.code === "mod_missing")).toEqual([]);
  });
  it("keeps J inside target plus flex, assigns no Off-day or excluded person", () => {
    const h = shifts("J").reduce((n, s) => n + (s.endQ - s.startQ) / 4, 0);
    const limits = acceptanceInputs().structure.structure.limits;
    expect(h).toBeLessThanOrEqual(limits.salariedTargetWeekH + limits.salariedFlexH);
    expect(h).toBeGreaterThanOrEqual(limits.salariedTargetWeekH);
    for (const s of out.shifts) expect(out.context.people[s.userId]!.workModes?.[s.date]).not.toBe("off");
    for (const name of ["Quinn", "Lucas", "Cristian", "Pete", "Keith"]) expect(shifts(name)).toEqual([]);
  });
  it("is byte-identical on repeat and shuffled unordered arrays", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(out));
    const input = acceptanceInputs();
    input.members.reverse(); input.personSettings.reverse(); input.budget.rows.reverse(); input.dayTypes.reverse();
    if (input.demand.kind !== "unavailable") input.demand.days.reverse();
    expect(JSON.stringify(run(input))).toBe(JSON.stringify(out));
    const assembled = generatorInputFor(input, WEEK, { today: WEEK });
    assembled.people.reverse(); assembled.days.reverse(); assembled.pins.reverse();
    expect(JSON.stringify(generateWeek(assembled))).toBe(JSON.stringify(out));
  }, 120000);
  it("measures a 43-person assembled week without weakening correctness", () => {
    const input = acceptanceInputs();
    const base = input.personSettings.find((p) => p.userId === personId("Akia"))!;
    while (generatorInputFor(input, WEEK, { today: WEEK }).people.length < 43) {
      const userId = `person-extra-${String(input.members.length).padStart(2, "0")}`;
      input.members.push({ userId, name: userId, role: "employee", memberSince: null });
      input.personSettings.push({ ...structuredClone(base), userId });
    }
    const g = generatorInputFor(input, WEEK, { today: WEEK }); expect(g.people).toHaveLength(43);
    const start = performance.now(); const result = generateWeek(g); const ms = performance.now() - start;
    process.stdout.write(`43-person crew week: ${ms.toFixed(1)} ms; ${result.shifts.length} shifts\n`);
    expect(result.days).toHaveLength(7);
    expect(result.shifts.every((s) => s.endQ > s.startQ)).toBe(true);
  }, 60000);
});

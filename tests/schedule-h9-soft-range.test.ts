/**
 * CC chunk H9 fix 3 (2026-10-17) — overtime AND the soft range are LAST RESORTS (spec §6.2: "Overtime is avoided"; "each
 * person's soft range is respected"). The sim walk (p2.12) put 10 of 12 hourly people at 42 h, people with a usual 12–20 h
 * among them, while the key holder sat at 28 h. The plan's rule (line ~457 / ~809, "a candidate whose week would exceed
 * overtimeH is skipped") held for overtime only inside one run; nothing kept the soft max.
 *  - The generator's candidate order skips anyone whose week would pass `overtimeH` OR their soft max while another legal
 *    candidate fits: tiers (none past either, then an off day, then past a soft max, then overtime), each over EVERY date.
 *  - The property: over random weeks where a legal non-exceeding fill EXISTS (a roster with room for twice the need), no
 *    hourly person ends past overtime or their soft max.
 */
import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/lib/roles";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { DATES, I, day, fixture, normalCurve, structure, type PersonSpec } from "./fixtures/schedule/fixtures";
import { perPersonWeek, simShapeInput } from "./fixtures/schedule/sim-shape";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINE = [I.$REG, I.$EXPO, I.$WALKON, I.$WALK, I.$BOI, I.$THIRD];

/** A roster with room for about twice the week's need: 30 hourly people, everyone available every day, soft max 28–40 h. */
function roomyCase(seed: number) {
  const r = mulberry32(seed);
  const s = structure((x) => { x.leadership.modRequired = false; });
  const roles: RoleCode[] = ["employee", "employee", "trainer", "trainee", "key_holder"];
  const specs: PersonSpec[] = [];
  for (let i = 0; i < 30; i++) {
    const role = roles[Math.floor(r() * roles.length)]!;
    const skills: Record<string, [number, number]> = {};
    for (const id of [...LINE, I.$PREP, I.$DISH]) if (r() < 0.6) skills[id] = [Math.round(r() * 100) / 100, 0.7];
    specs.push({
      id: `u-${String(i).padStart(2, "0")}`, role, workType: "foh", alsoAllowed: ["boh"],
      leader: role === "key_holder" ? "closes" : null, softMin: 0, softMax: [28, 32, 40][Math.floor(r() * 3)]!, skills, close: role === "key_holder" ? r() : undefined,
    });
  }
  const days = DATES.map((d, i) => day(d, { hourlyCents: normalCurve(0.8 + r() * 0.6), dayCents: null, dayType: i >= 5 ? "weekend" : "normal" }, s))
    .map((d) => ({ ...d, dayCents: d.hourlyCents!.reduce((a, b) => a + b, 0) }));
  return fixture({ structure: s, specs, days });
}

describe("H9 fix 3: overtime and the soft max are the last resort", () => {
  it("property: with room for a legal non-exceeding fill, no hourly person ends past overtime or their soft max", { timeout: 600_000 }, () => {
    for (let seed = 1; seed <= 6; seed++) {
      const input = roomyCase(seed);
      const out = buildWeek(input);
      for (const row of perPersonWeek(input, out.shifts)) {
        expect(row.hours, `seed ${seed} ${row.userId} overtime`).toBeLessThanOrEqual(input.structure.limits.overtimeH);
        if (row.softMax !== null) expect(row.hours, `seed ${seed} ${row.userId} soft max ${row.softMax}`).toBeLessThanOrEqual(row.softMax);
      }
      expect(out.notes.filter((n) => n.code === "overtime_used"), `seed ${seed}`).toEqual([]);
      expect(out.problems.filter((p) => p.code === "overtime" || (p.code === "soft_range" && Number(p.params.hours) > Number(p.params.max))), `seed ${seed}`).toEqual([]);
    }
  });

  it("the sim-shaped week: nobody ends in overtime (no stale overtime note), the openers and closers carry hours, the trainees no longer soak up the week", () => {
    const input = simShapeInput();
    const out = buildWeek(input);
    const rows = perPersonWeek(input, out.shifts);
    const h = (id: string) => rows.find((x) => x.userId === id)!.hours;
    for (const row of rows) expect(row.hours, row.userId).toBeLessThanOrEqual(input.structure.limits.overtimeH);
    // A note names overtime only for a week that ends past the threshold (a later repair move can take the hours away again).
    expect(out.notes.filter((n) => n.code === "overtime_used")).toEqual([]);
    // p2.12 had the trainees at 47.5 / 50 h and a closer at 0 h. They still carry the blocks only an all-day person can hold
    // (the openers / closers / mids are outside those windows or on their 5th date) — the soft range is passed only there.
    for (const id of ["u-s14-trainee", "u-s15-trainee"]) expect(h(id), id).toBeLessThan(40);
    expect(h("u-s08-emp-close")).toBeGreaterThan(0);
  });
});

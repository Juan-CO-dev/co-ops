/**
 * CC chunk H9 (2026-10-17): a fixture SHAPED LIKE the sim's P Street week that CC walked (generated p2.12): the seed's
 * Toast patterns (scripts/sim/seed-scheduling-shared.ts — openers Mon–Fri 7–3, closers Wed–Sun 1–9, BOH Mon–Sat 6–2, mids
 * Tue/Thu/Sat/Sun 10–6, one never punched, two new hires with < 3 observed weeks = assumed available EVERY day), the
 * trainees / trainers carrying a usual 12–20 h, one key holder who closes (usual 24–32 h), a GM, and NO demand history
 * (the cron said `no_history`). Ids only; no names in logic, never a shop code.
 */
import type { BuildDayInput, GeneratorInput } from "@/lib/scheduling/generator/build-shared";
import type { SchedPerson } from "@/lib/scheduling/people-input-shared";
import { DATES, I, day, fixture, structure, type PersonSpec } from "./fixtures";

const OPEN = { fromQ: 28, toQ: 62 };
const CLOSE = { fromQ: 50, toQ: 84 };
const BOH = { fromQ: 28, toQ: 58 };
const MID = { fromQ: 38, toQ: 74 };
const R = { REG: I.$REG, EXPO: I.$EXPO, WALKON: I.$WALKON, WALK: I.$WALK };

/** The roster: 15 hourly people + a GM. `off` = the ISO weekdays the punch pattern says they do not work. */
export const SIM_SHAPE_SPECS: PersonSpec[] = [
  { id: "u-s01-sl-open", role: "shift_lead", leader: "opens", cover: [R.REG, R.EXPO], off: [6, 7], window: OPEN, softMin: 36, softMax: 44 },
  { id: "u-s02-kh-close", role: "key_holder", leader: "closes", off: [1, 2], window: CLOSE, softMin: 24, softMax: 32, close: 0.9 },
  { id: "u-s03-emp-open", role: "employee", off: [6, 7], window: OPEN, softMin: 36, softMax: 44 },
  { id: "u-s04-trainer-open", role: "trainer", off: [6, 7], window: OPEN, softMin: 12, softMax: 20 },
  { id: "u-s05-sl-close", role: "shift_lead", leader: "mix", cover: [R.REG, R.EXPO], off: [1, 2], window: CLOSE, softMin: 36, softMax: 44 },
  { id: "u-s06-emp-close", role: "employee", off: [1, 2], window: CLOSE, softMin: 36, softMax: 44 },
  { id: "u-s07-emp-close", role: "employee", off: [1, 2], window: CLOSE, softMin: 36, softMax: 44 },
  { id: "u-s08-emp-close", role: "employee", off: [1, 2], window: CLOSE, softMin: 36, softMax: 44 },
  { id: "u-s09-boh", role: "employee", workType: "boh", off: [7], window: BOH, softMin: 36, softMax: 40 },
  { id: "u-s10-emp-mid", role: "employee", off: [1, 3, 5], window: MID, softMin: 28, softMax: 36 },
  { id: "u-s11-trainer-mid", role: "trainer", off: [1, 3, 5], window: MID, softMin: 12, softMax: 20 },
  { id: "u-s12-emp-mid", role: "employee", off: [1, 3, 5], window: MID, softMin: 28, softMax: 36 },
  { id: "u-s13-no-history", role: "employee", softMin: 0, softMax: 40 },
  { id: "u-s14-trainee", role: "trainee", softMin: 12, softMax: 20 },
  { id: "u-s15-trainee", role: "trainee", softMin: 12, softMax: 20 },
  { id: "u-s16-gm", role: "gm", leader: "opens", cover: [R.EXPO, R.REG] },
];

/** The sim-shaped week: no demand history, weekends on Sat / Sun, every date built from Monday. */
export function simShapeInput(): GeneratorInput {
  const s = structure();
  const days: BuildDayInput[] = DATES.map((d, i) => day(d, {
    dayType: s.dayTypes.weekendIsoDows.includes(i + 1) ? "weekend" : "normal", dayTypeSource: s.dayTypes.weekendIsoDows.includes(i + 1) ? "weekend" : "forecast",
    demandKind: "no_history", hourlyCents: null, dayCents: null,
  }, s));
  return fixture({ structure: s, specs: SIM_SHAPE_SPECS, days });
}

/** Per hourly person: the days worked and the hours, for the handback's before / after table. */
export function perPersonWeek(input: GeneratorInput, shifts: ReadonlyArray<{ userId: string; date: string; startQ: number; endQ: number }>): Array<{ userId: string; days: number; hours: number; softMax: number | null }> {
  const hourly = input.people.filter((p: SchedPerson) => !p.salaried && !p.presenceOnly);
  return hourly.map((p) => {
    const mine = shifts.filter((x) => x.userId === p.userId);
    return { userId: p.userId, days: new Set(mine.map((x) => x.date)).size, hours: mine.reduce((n, x) => n + (x.endQ - x.startQ), 0) / 4, softMax: p.softMaxH };
  });
}

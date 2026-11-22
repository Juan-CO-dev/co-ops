/**
 * PR SCH (plan r5, sections 12.4 and 12.5; r1 8.4): the fixture weeks whose "before" outputs are frozen on main's code
 * (`golden-SCH-before.json`, commit 1, no lib change) so every later commit can prove which dates changed and which did not.
 *
 *  - `schStationsWeek`: a stations week from the v17 roster (ample, so weekly caps do not bind), no budget, the r1 8.4 order
 *    table (Mon 25 @ 12:00; Tue 20 @ 9:00 + 20 @ 11:00 + 20 @ 12:30; Wed 120 @ 9:00; Thu 40 @ 13:00; Fri 0 @ 10:00 + 20 @ 12:00;
 *    Sat none; Sun 12 @ 9:00 + 25 @ 11:00). Shipped catering settings: 30 guests, 1 extra head, 210 min lead.
 *  - `schTightWeek`: the same orders on the small roster with a tight per-date budget (the F0b style): weekly coupling.
 *  - `schCrewInputs`: the P Street crew acceptance inputs with two heavy days (3 × 20 at 9:00 on Tuesday, 120 at 9:00 on
 *    Thursday) in the LIVE configuration (`crewShift` absent, mode manual).
 *
 * `schSlices` cuts an output into per-date slices (shifts, gaps, reasons, notes, the day record and a digest of the date's
 * context) so a test can say "this date is byte-identical" without storing every need grid.
 */
import { canonicalJson, digest64 } from "@/lib/scheduling/context-shared";
import type { BuildDayInput, GeneratorInput, GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import type { SchedulingInputs } from "@/lib/scheduling/inputs-shared";
import { acceptanceInputs, DATES as CREW_DATES } from "./crew-p-street-2026-10-19";
import { DATES, H9_EXTRA, SMALL_SPECS, V17_SPECS, day, fixture, structure, v17Days } from "./fixtures";

/** [headcount, eventQ] per order, by weekday index (0 = Monday). */
export const SCH_ORDERS: ReadonlyArray<ReadonlyArray<readonly [number, number | null]>> = [
  [[25, 48]],
  [[20, 36], [20, 44], [20, 50]],
  [[120, 36]],
  [[40, 52]],
  [[0, 40], [20, 48]],
  [],
  [[12, 36], [25, 44]],
];

export function schCatering(i: number): BuildDayInput["catering"] {
  return (SCH_ORDERS[i] ?? []).map(([headcount, eventQ], k) => ({ id: `ev-${i}-${k}`, headcount, eventQ }));
}

export function schStationsWeek(): GeneratorInput {
  const s = structure();
  const days = v17Days(s).map((d, i) => ({ ...d, catering: schCatering(i) }));
  return fixture({ structure: s, specs: [...V17_SPECS, ...H9_EXTRA], days });
}

export function schTightWeek(): GeneratorInput {
  const s = structure();
  const days = DATES.map((d, i) => day(d, { catering: schCatering(i) }, s));
  return fixture({ structure: s, specs: [...SMALL_SPECS, ...H9_EXTRA], days, budgetByDate: Object.fromEntries(DATES.map((d) => [d, 40])) });
}

/** The crew orders: 3 × 20 at 9:00 on Tuesday (heavy by total only), 120 at 9:00 on Thursday. */
export function schCrewInputs(): SchedulingInputs {
  const inputs = acceptanceInputs();
  inputs.catering = [
    ...[0, 1, 2].map((k) => ({ id: `crew-ev-tue-${k}`, date: CREW_DATES[1]!, name: "Order", headcount: 20, valueCents: null, eventQ: 36 })),
    { id: "crew-ev-thu-0", date: CREW_DATES[3]!, name: "Order", headcount: 120, valueCents: null, eventQ: 36 },
  ];
  return inputs;
}

export interface DateSlice { shifts: unknown[]; gaps: unknown[]; reasons: Record<string, unknown>; notes: unknown[]; day: unknown; context: string | null }
export interface WeekSlices { byDate: Record<string, DateSlice>; weekNotes: unknown[]; stats: unknown; people: string }

export function schSlices(out: GeneratorOutput): WeekSlices {
  const byDate: Record<string, DateSlice> = {};
  for (const d of out.context.dates) {
    const ctx = out.context.days[d];
    byDate[d] = {
      shifts: out.shifts.filter((s) => s.date === d),
      gaps: out.gaps.filter((g) => g.date === d),
      reasons: Object.fromEntries(Object.entries(out.reasons).filter(([k]) => k.startsWith(`${d}|`))),
      notes: out.notes.filter((n) => n.date === d),
      day: out.days.find((x) => x.date === d) ?? null,
      context: ctx ? digest64(canonicalJson(ctx)) : null,
    };
  }
  return JSON.parse(canonicalJson({ byDate, weekNotes: out.notes.filter((n) => n.date === null), stats: out.stats, people: digest64(canonicalJson(out.context.people)) })) as WeekSlices;
}

/** The dates whose slice differs between two cuts. */
export function changedDates(a: WeekSlices, b: WeekSlices): string[] {
  return Object.keys(a.byDate).filter((d) => canonicalJson(a.byDate[d]) !== canonicalJson(b.byDate[d])).sort();
}

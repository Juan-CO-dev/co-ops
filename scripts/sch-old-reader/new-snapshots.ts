/**
 * PR SCH (plan r5 20.9, ruling D9) — DEV ONLY, offline: the POST-SCH snapshot fixtures for the old-reader check
 * (scripts/sch-old-reader-check.mjs). Built with the CURRENT code from the SCH test fixtures; no database, no network.
 * Usage (the orchestrator runs it): npx tsx scripts/sch-old-reader/new-snapshots.ts <out.json>
 */
import { writeFileSync } from "node:fs";
import { referenceStructureOf, structureDeltaHours } from "@/lib/scheduling/budget-shared";
import { canonicalJson, digest64, ruleContextFromSnapshot, toContextSnapshot } from "@/lib/scheduling/context-shared";
import { buildWeek, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import { baseStructureOf } from "@/lib/scheduling/opening-shared";
import { checkScheduleRules } from "@/lib/scheduling/rules-shared";
import { DATES as CREW_DATES, WEEK as CREW_WEEK } from "../../tests/fixtures/schedule/crew-p-street-2026-10-19";
import { DATES } from "../../tests/fixtures/schedule/fixtures";
import { schCrewInputs, schStationsWeek } from "../../tests/fixtures/schedule/sch-fixtures";

function snapshotCase(name: string, out: GeneratorOutput, refDate: string) {
  const schedule = { locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days };
  const stored = toContextSnapshot(out.context).context;
  const ctx = ruleContextFromSnapshot(stored);
  const day = ctx.days[refDate]!;
  const days = Object.fromEntries(Object.entries(ctx.days).filter(([d]) => d >= refDate));
  const ref = referenceStructureOf({ revision: { structureVersionId: day.structureVersionId }, context: { days } }, {})!;
  const live = baseStructureOf(day);
  const needDay = { dayType: day.dayType, scheduledOutQ: day.scheduledOutQ, hourlyCents: day.inputs.hourlyCents, demandKind: day.inputs.demandKind, catering: day.inputs.cateringEvents };
  return {
    name, refDate, schedule, stored, live, needDay,
    newReplay: checkScheduleRules(schedule, ctx), recorded: out.problems,
    newRefDigest: digest64(canonicalJson(ref)), liveDigest: digest64(canonicalJson(live)), newDelta: structureDeltaHours({ live, ref, day: needDay }),
  };
}

const stations = schStationsWeek();
stations.days.find((d) => d.date === DATES[2])!.decision = { kind: "accepted", startQ: 22 };
const tue = CREW_DATES[1]!;
const crewOpened = schCrewInputs();
const crewOn = schCrewInputs();
crewOn.structure.structure.catering.crewShift = { enabled: true, typeId: "opener", extraHeads: 1 };

const cases = [
  snapshotCase("(a) stations, heavy and opened (Wed: 120 guests at 9:00, an accepted 5:30 opening)", buildWeek(stations), DATES[2]!),
  snapshotCase("(b) crew, crewShift off, opened (Tue: 3 x 20, an accepted 5:30 opening)",
    generateWeek(generatorInputFor(crewOpened, CREW_WEEK, { today: CREW_WEEK, openingOverride: { date: tue, decision: { kind: "accepted", startQ: 22 } } })), tue),
  snapshotCase("(c) crew, crewShift on, a day heavy only by total (Tue: 3 x 20)", generateWeek(generatorInputFor(crewOn, CREW_WEEK, { today: CREW_WEEK })), tue),
];
writeFileSync(process.argv[2]!, JSON.stringify(cases));

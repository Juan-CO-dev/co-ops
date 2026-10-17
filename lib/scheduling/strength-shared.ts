/**
 * TEAM STRENGTH — the minute-weighted mean skill of who is on the clock for what, per window
 * (Scheduling Phase 2, Task 7 Step 3; plan "Team strength").
 *
 * Windows come from the structure: BOH open [prep start, service start), setup [setup wave, service
 * start), lunch rush [rush wave, rush + 2 h), afternoon [rush + 2 h, service close), close + checklist
 * [service close, scheduled out). MoD minutes are excluded. Words: strong ≥ `labor.strong`, watch ≥
 * `labor.watch`, thin below (thresholds in the structure). r2: minutes of UNPROVEN people are reported
 * separately and are never averaged in as 0; the mean runs over the evidence-backed minutes, and a
 * window whose every minute is unproven reads `unknown` ("Strength unknown — no worked data yet").
 */
import type { RulePerson } from "./context-shared";
import { skillOf, type SkillLookup } from "./people-input-shared";
import { MOD, type Shift } from "./rules-shared";
import type { CrewType, ScheduleStructure } from "./structure-shared";
import { Q_MINUTES } from "./time-shared";

export type StrengthWindowKey = "boh_open" | "setup" | "lunch_rush" | "afternoon" | "close";
export interface StrengthWindow { key: StrengthWindowKey; fromQ: number; toQ: number }
export type StrengthWord = "strong" | "watch" | "thin" | "unknown" | "empty";
export interface WindowStrength extends StrengthWindow {
  minutes: number;
  evidenceMinutes: number;
  unprovenMinutes: number;
  /** The minute-weighted mean over the evidence-backed minutes; null when there are none. */
  mean: number | null;
  word: StrengthWord;
  /** Who is unproven in this window (ids, canonical). */
  unprovenIds: string[];
}

const RUSH_LENGTH_Q = 8;

export function strengthWindows(s: ScheduleStructure, dayType: CrewType, scheduledOutQ: number): StrengthWindow[] {
  const { prepStartQ, serviceStartQ, serviceCloseQ } = s.shopDay;
  const crew = s.crews[dayType];
  const rushEnd = Math.min(serviceCloseQ, crew.waves.rush.atQ + RUSH_LENGTH_Q);
  const windows: StrengthWindow[] = [
    { key: "boh_open", fromQ: prepStartQ, toQ: serviceStartQ },
    { key: "setup", fromQ: Math.min(crew.waves.setup.atQ, serviceStartQ), toQ: serviceStartQ },
    { key: "lunch_rush", fromQ: Math.min(crew.waves.rush.atQ, rushEnd), toQ: rushEnd },
    { key: "afternoon", fromQ: rushEnd, toQ: serviceCloseQ },
    { key: "close", fromQ: serviceCloseQ, toQ: scheduledOutQ },
  ];
  return windows.filter((w) => w.toQ > w.fromQ);
}

export function teamStrength(
  shifts: readonly Shift[], date: string, people: Readonly<Record<string, RulePerson>>, s: ScheduleStructure, lookup: SkillLookup,
  dayType: CrewType, scheduledOutQ: number,
): WindowStrength[] {
  return strengthWindows(s, dayType, scheduledOutQ).map((w) => {
    let minutes = 0;
    let evidence = 0;
    let unproven = 0;
    let weighted = 0;
    const unprovenIds = new Set<string>();
    for (const sh of shifts) {
      if (sh.date !== date) continue;
      const p = people[sh.userId];
      if (!p) continue;
      for (const g of sh.segments) {
        if (g.positionId === MOD) continue;
        const overlap = Math.max(0, Math.min(g.endQ, w.toQ) - Math.max(g.startQ, w.fromQ)) * Q_MINUTES;
        if (overlap === 0) continue;
        minutes += overlap;
        const sk = skillOf(lookup, p, g.positionId, s.positions[g.positionId]);
        if (sk.band === "unproven") { unproven += overlap; unprovenIds.add(p.userId); } else { evidence += overlap; weighted += overlap * sk.value; }
      }
    }
    const mean = evidence > 0 ? Math.round((weighted / evidence) * 1000) / 1000 : null;
    const word: StrengthWord = minutes === 0 ? "empty" : mean === null ? "unknown" : mean >= s.labor.strong ? "strong" : mean >= s.labor.watch ? "watch" : "thin";
    return { ...w, minutes, evidenceMinutes: evidence, unprovenMinutes: unproven, mean, word, unprovenIds: [...unprovenIds].sort() };
  });
}

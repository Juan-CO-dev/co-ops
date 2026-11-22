/**
 * Nav PR 5, group 15 (plan r4, 8): the midnight fixture, moved here verbatim from tests/day-plan-plan-date.test.ts (nav PR 7
 * plan r2 2.13, Astra F4) so the engine test and the Dashboard's rendered midnight cases share ONE fixture.
 */
import type { ShopFacts } from "@/lib/day-plan-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { checklist, hm, ok, PLAN_DATE } from "./build";
import { NO_EVENTS, pStreet } from "./p-street";

export const D = PLAN_DATE;
export const D1 = addDaysEt(D, 1);

/** The early hours of D+1 while D's closing is still open (the station day is still D). */
export function earlyNextDay(t: string, yesterdayStatus: "open" | "confirmed", stations: ShopFacts["stations"], holds = false): ShopFacts {
  const today = pStreet(hm(t), { planDate: D1, timeline: NO_EVENTS });
  return { ...today, stations, yesterdayClosing: ok(checklist(D, { status: yesterdayStatus })), holdsStationOnStationDay: holds };
}

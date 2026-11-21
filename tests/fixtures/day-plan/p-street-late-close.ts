/**
 * P Street, the live-data day (plan r4, 11.3; the lead's 2026-11-21 data checks): section taps land in bursts after the
 * close, so no station-close event exists before 20:15. The live station shape: Crunchy Boi's usual close is 14:00 and no
 * other floor station has one; Prep Area is a floor station; no station is marked. Under Juan's ruling the afternoon runs
 * on the clock. Two variants for Closing Manager (`floor: false`, ruling B1's data rule; `floor: true`, today's
 * isFloorStation verdict) and two for Mid-day prep (submitted at 14:50, or never).
 */
import type { ShopFacts } from "@/lib/day-plan-shared";
import { hm, iso, ok, PLAN_DATE, station } from "./build";
import { pStreet, STATION_IDS, TIMELINE } from "./p-street";

export interface LateCloseOptions {
  closingManagerFloor?: boolean;
  midDaySubmitted?: boolean;
}

const EVENTS: Partial<Record<keyof typeof STATION_IDS, string>> = {
  crunchy: "20:15", third: "20:15", walk: "20:16", expo: "21:21", prepArea: "21:24",
};

export function lateClose(min: number, opts: LateCloseOptions = {}): ShopFacts {
  const submitted = opts.midDaySubmitted ?? true;
  const base = pStreet(min, { timeline: { ...TIMELINE, midDayPrep: submitted ? "14:50" : null, closingFinished: null, stationClose: {} } });
  const closeAt = (k: keyof typeof STATION_IDS) => {
    const t = EVENTS[k];
    return t !== undefined && min >= hm(t) ? iso(PLAN_DATE, t) : null;
  };
  const s = (k: keyof typeof STATION_IDS, name: string, sort: number, floor: boolean, usual: string | null = null) =>
    station({ id: STATION_IDS[k], name, sort, floor, usuallyClosesAt: usual, closedAt: closeAt(k) });
  return {
    ...base,
    stations: ok({ stationDate: PLAN_DATE, stations: [
      s("crunchy", "Crunchy Boi Station", 1, true, "14:00:00"),
      s("third", "3rd Party Station", 2, true),
      s("walk", "Walk Ins Station", 3, true),
      s("expo", "Expo Station", 4, true),
      s("prepFridge", "Prep Fridge", 5, false),
      s("backLine", "Shut Down Back Line", 6, false),
      s("frontHouse", "Clean front of house", 7, false),
      s("prepArea", "Prep Area", 8, true),
      s("closingManager", "Closing Manager", 9, opts.closingManagerFloor ?? false),
      s("walkOut", "Walk-Out Verification", 10, false),
    ] }),
  };
}

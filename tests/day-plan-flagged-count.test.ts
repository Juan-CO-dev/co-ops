/**
 * Nav PR 6 (plan r3, 8.6; PR 5 group 17's other half): the Dashboard's flagged-line count and the Prep demand page's
 * `overPar` lines come from ONE rule (`lib/catering/prep-demand-shared.ts`), so they are equal for the same rows: on a
 * small varied shape, across a page boundary (ruling 9), and at scale with the bounded item readers (ruling B4). The page's
 * own output is pinned to what it rendered at eb8bbc3a, before the extraction.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadCateringPrepDemand, type PrepDemandDay } from "@/lib/catering/prep-demand";
import { defaultDayFactDeps } from "@/lib/day-plan";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { itemId, prepDemandClient, PREP_SHOP, smallDb, type PrepDemandDb, type Row } from "./fixtures/day-plan/prep-demand-rows";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn(async () => null) }));

const TODAY = "2026-11-18"; // a Wednesday (dow 3)
const TOMORROW = "2026-11-19"; // dow 4
const ACTOR = { user: { role: "cgs" }, locations: [] } as unknown as AuthContext;

async function page(db: PrepDemandDb): Promise<PrepDemandDay[]> {
  const { client } = prepDemandClient(db);
  vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
  return loadCateringPrepDemand(ACTOR, { locationId: PREP_SHOP, from: TODAY, to: TOMORROW });
}
const pageCounts = (days: PrepDemandDay[]) => Object.fromEntries(days.map((d) => [d.needDate, d.lines.filter((l) => l.overPar).length]).filter(([, n]) => n !== 0));

/** The Dashboard's side: the day loader's own F1 read (lib/day-plan.ts), on the same rows. */
async function dashboardCounts(db: PrepDemandDb): Promise<Record<string, number>> {
  const { client, calls } = prepDemandClient(db);
  const counts = await defaultDayFactDeps.flaggedLines(client as never, PREP_SHOP, [TODAY, TOMORROW]);
  expect(calls.filter((c) => c.table === "catering_prep_demand").every((c) => c.has("in", "need_date", [TODAY, TOMORROW]) && c.has("eq", "status", "reserved"))).toBe(true);
  return counts;
}

describe("the flag rule, one function", () => {
  it("no par, at par, under par, one item in two portions, a manual weekday override, an auto override: counts equal", async () => {
    const db = smallDb(TODAY, TOMORROW);
    const days = await page(db);
    expect(pageCounts(days)).toEqual({ [TODAY]: 2, [TOMORROW]: 2 });
    expect(await dashboardCounts(db)).toEqual(pageCounts(days));
  });

  it("the page is unchanged: its output deep-equals what it rendered at eb8bbc3a for the same rows", async () => {
    const before = JSON.parse(readFileSync("tests/fixtures/day-plan/prep-demand-page-eb8bbc3a.json", "utf8")) as PrepDemandDay[];
    expect(await page(smallDb(TODAY, TOMORROW))).toEqual(before);
  });

  it("across a page boundary (ruling 9): 1,200 reserved rows, flagged lines on both sides of row 1,000", async () => {
    const db = smallDb(TODAY, TOMORROW);
    const [a, b] = [itemId(2), itemId(5)]; // Ham (par 10 today) and Lettuce (manual 5 tomorrow)
    db.catering_prep_demand = Array.from({ length: 1200 }, (_, i): Row => ({
      id: `d-${String(i).padStart(6, "0")}`, pipeline_id: `lead-${i % 3}`, location_id: PREP_SHOP, status: "reserved",
      need_date: i < 1000 ? TODAY : TOMORROW, item_id: i < 1000 ? a : b, menu_item_id: null, choice_package_item_id: null, portion: null, qty: 1,
    }));
    const days = await page(db);
    // Ham today: 1,000 ≥ 10. Lettuce tomorrow (rows 1,000-1,199, page two only): 200 ≥ 5.
    expect(pageCounts(days)).toEqual({ [TODAY]: 1, [TOMORROW]: 1 });
    expect(days.find((d) => d.needDate === TOMORROW)?.lines[0]?.qty).toBe(200);
    expect(await dashboardCounts(db)).toEqual(pageCounts(days));
  });
});

describe("at scale (ruling B4): 1,250 demand rows, 250 items, 2,750 override rows", () => {
  const N = 250;
  const dow = { [TODAY]: 3, [TOMORROW]: 4 } as const;
  // The data, as plain numbers the test owns.
  const defaultPar = (i: number): number | null => (i % 10 === 0 ? null : (i % 7) + 5);
  const BASE = 100; // the all-days manual override: under it nothing is flagged, so a LOST weekday row changes the answer
  const weekdayPar = (i: number, d: 3 | 4): { mode: "manual" | "auto"; par: number } =>
    d === 3 ? { mode: "manual", par: (i % 4) + 2 } : i % 3 === 0 ? { mode: "auto", par: 999 } : { mode: "manual", par: (i % 5) + 3 };
  const todayQty = (i: number) => [1, (i % 6), 2] as const; // three rows, whole portions
  const tomorrowHalf = (i: number) => i % 2 === 0; // two half-portion rows, else two whole rows
  const tomorrowQty = (i: number) => [(i % 4) + 1, (i % 3) + 1] as const;

  function db(): PrepDemandDb {
    const demand: Row[] = [];
    let n = 0;
    for (let i = 0; i < N; i++) {
      for (const q of todayQty(i)) if (q > 0) demand.push({ id: `d-${String(n++).padStart(6, "0")}`, pipeline_id: `lead-${i % 7}`, location_id: PREP_SHOP, status: "reserved", need_date: TODAY, item_id: itemId(1000 + i), menu_item_id: null, choice_package_item_id: null, portion: null, qty: q });
      for (const q of tomorrowQty(i)) demand.push({ id: `d-${String(n++).padStart(6, "0")}`, pipeline_id: `lead-${i % 5}`, location_id: PREP_SHOP, status: "reserved", need_date: TOMORROW, item_id: itemId(1000 + i), menu_item_id: null, choice_package_item_id: null, portion: tomorrowHalf(i) ? "half" : null, qty: q });
    }
    const pars: Row[] = [];
    let p = 0;
    const par = (prefix: string, i: number, day: number | null, value: number, mode: string) =>
      pars.push({ id: `${prefix}-${String(p++).padStart(6, "0")}`, item_id: itemId(1000 + i), location_id: PREP_SHOP, active: true, day_of_week: day, par_value: value, par_unit: null, par_mode: mode });
    for (let i = 0; i < N; i++) {
      par("p", i, null, BASE, "manual");
      for (const d of [0, 1, 2, 5, 6]) par("p", i, d, BASE, "manual");
      for (let k = 0; k < 3; k++) par("p", i, 0, 1, "auto"); // filler rows for an irrelevant day
      // The deciding weekday rows sort LAST (prefix z): within a 100-item chunk (1,100 rows) the last 100 sit on page two.
      for (const d of [3, 4] as const) { const w = weekdayPar(i, d); par("z", i, d, w.par, w.mode); }
    }
    const items = Array.from({ length: N }, (_, i) => ({ id: itemId(1000 + i), name: `Item ${String(i).padStart(3, "0")}`, name_es: null, default_par: defaultPar(i), default_par_unit: null, active: true }));
    return { catering_prep_demand: demand, items, item_par_levels: pars };
  }

  /** The expected flags, computed here by hand: par = the weekday's manual row, else (auto) the default; flag = no par or demand ≥ par. */
  function expected(): Record<string, number> {
    const out: Record<string, number> = { [TODAY]: 0, [TOMORROW]: 0 };
    for (let i = 0; i < N; i++) {
      for (const date of [TODAY, TOMORROW] as const) {
        const w = weekdayPar(i, dow[date]);
        const parValue = w.mode === "manual" ? w.par : defaultPar(i);
        const demand = date === TODAY ? todayQty(i).reduce((a, b) => a + b, 0) : tomorrowQty(i).reduce((a, b) => a + b, 0) * (tomorrowHalf(i) ? 0.5 : 1);
        if (parValue === null || demand >= parValue) out[date] = out[date]! + 1;
      }
    }
    return out;
  }

  it("the shape is what it claims: >1,200 demand rows, 250 items, >1,000 override rows per 100-item chunk", () => {
    const d = db();
    expect(d.catering_prep_demand.length).toBeGreaterThan(1200);
    expect(new Set(d.catering_prep_demand.map((r) => r.item_id)).size).toBe(250);
    expect(d.item_par_levels.filter((r) => [itemId(1000), itemId(1099)].includes(r.item_id as string)).length * 100 / 2).toBeGreaterThan(1000);
  });

  it("the Dashboard count and the page's overPar lines both equal the hand-computed table", async () => {
    const want = expected();
    expect(want[TODAY]).toBeGreaterThan(0);
    expect(want[TOMORROW]).toBeGreaterThan(0);
    const days = await page(db());
    expect(pageCounts(days)).toEqual(want);
    expect(await dashboardCounts(db())).toEqual(want);
  });
});

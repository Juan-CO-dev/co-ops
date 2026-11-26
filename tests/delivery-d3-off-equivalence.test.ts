/**
 * Catering delivery D3: THE OFF-EQUIVALENCE PIN (permanent).
 *
 * With delivery tracking off (`DELIVERY_TRACKING` unset: the state of every environment until a person turns it on), the
 * day engine, the day loader's facts and its queries, the catering block, "Needs you", the mid-shift catering strip and
 * the pulse's catering section are BYTE-IDENTICAL to what they were before D3.
 *
 * The golden (`tests/fixtures/delivery/d3-off-golden.json`, one sha-256 of the full JSON or markup per case) was frozen
 * from the UNCHANGED base (PR #633's head, a4400272) in its own commit, before any D3 code was written. It is
 * regenerated only with a written reason in the commit (`WRITE_D3_OFF_GOLDEN=1`).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { CateringBlock } from "@/components/dashboard/CateringBlock";
import { NeedsYou } from "@/components/dashboard/NeedsYou";
import { CateringToday } from "@/components/midshift/CateringToday";
import type { InboxWaiting, NeedsYouCells, NotRungScoped } from "@/lib/dashboard-blocks";
import { assignmentsKnown, cateringBlockIndex, nextUpInBlock } from "@/lib/dashboard-blocks-shared";
import type { Settled } from "@/lib/dashboard-day";
import { aggregateFailure } from "@/lib/dashboard-day-shared";
import { loadDayFacts } from "@/lib/day-plan";
import { buildDay, planDay, type DayPlan, type DayViewer, type ShopFacts } from "@/lib/day-plan-shared";
import { loadPulseSection, type PulseCtx, type PulseDeps } from "@/lib/pulse/sections";
import type { AuthContext } from "@/lib/session";
import { ALL_VIEWERS, ANA, CATERING_MEMBER, GM, LUIS, MOO, hm, ok, order, PLAN_DATE, withFailed } from "./fixtures/day-plan/build";
import { args as loaderArgs, at, NO_CLIENT, okDeps } from "./fixtures/day-plan/loader-deps";
import { pStreet, type PStreetOptions } from "./fixtures/day-plan/p-street";
import { shopDay } from "./fixtures/delivery/shop-day-reads";
import { fakeSupabase } from "./helpers/fake-supabase";

const GOLDEN = resolve(__dirname, "fixtures/delivery/d3-off-golden.json");
const sha = (v: unknown): string => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

const TIMES = ["05:00", "06:00", "08:00", "08:55", "09:10", "10:00", "11:45", "12:10", "13:00", "15:30", "20:30", "23:00"];
const OPTS: Record<string, PStreetOptions> = {
  normal: {}, heavy: { heavy: true }, heavyOpening: { heavy: true, opening: true }, nightBefore: { nightBefore: true },
};
const VARIANTS: Record<string, (f: ShopFacts) => ShopFacts> = {
  asIs: (f) => f,
  cateringFailed: (f) => withFailed(f, ["cateringToday"]),
  mixed: (f) => ({ ...f, cateringToday: ok({ forDate: PLAN_DATE, orders: [
    order({ id: "u1", source: "ezcater", eventQ: null, headcount: 60, state: "not_tracked" }),
    order({ id: "t1", eventQ: 44, headcount: 10 }),
    order({ id: "t2", eventQ: 52, headcount: 35, state: "out", outAt: "2026-11-18T17:40:00.000Z" }),
    order({ id: "t3", eventQ: 60, headcount: null, state: "completed", outAt: "2026-11-18T18:40:00.000Z" }),
    order({ id: "c1", eventQ: 40, headcount: 200, state: "cancelled" }),
  ] }) }),
  none: (f) => ({ ...f, cateringToday: ok({ forDate: PLAN_DATE, orders: [] }) }),
};
const dateOf = (o: PStreetOptions) => (o.nightBefore ? "2026-11-17" : PLAN_DATE);
const shopPlan = (v: DayViewer, min: number, facts: ShopFacts, date: string): DayPlan => {
  const p = planDay({ planDate: date, nowMin: min, viewer: v, facts });
  if (p.kind !== "shop") throw new Error("expected a shop plan");
  return p;
};

// ── The engine: the whole DayModel and every viewer's whole plan ──
function engineCases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [on, o] of Object.entries(OPTS)) for (const [vn, vf] of Object.entries(VARIANTS)) for (const t of TIMES) {
    const facts = vf(pStreet(hm(t), o));
    const perViewer = Object.fromEntries(Object.entries(ALL_VIEWERS).map(([name, v]) => [name, planDay({ planDate: dateOf(o), nowMin: hm(t), viewer: v, facts })]));
    out[`engine/${on}/${vn}/${t}`] = sha({ model: buildDay(dateOf(o), hm(t), facts), perViewer });
  }
  return out;
}

// ── The markup: the catering block and "Needs you", en and es ──
const okS = <T,>(value: T): Settled<T> => ({ kind: "ok", value });
const EXTRAS = { inbox: okS<InboxWaiting>({ shop: 2, unplaced: 1 }), notRung: okS<NotRungScoped>({ count: 0, house: "on" }) };
const CELLS: NeedsYouCells = { vendorMail: okS(3), recipes: okS(0), inbox: okS<InboxWaiting>({ shop: 1, unplaced: null }) };
function markupCases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [on, o] of Object.entries(OPTS)) for (const [vn, vf] of Object.entries(VARIANTS)) for (const t of ["08:00", "10:00", "12:10", "20:30"]) for (const language of ["en", "es"] as const) {
    const facts = vf(pStreet(hm(t), o));
    const cat = shopPlan(CATERING_MEMBER, hm(t), facts, dateOf(o));
    const i = cateringBlockIndex(cat);
    const block = i < 0 ? "" : renderToStaticMarkup(createElement(CateringBlock, { item: cat.items[i]!, block: cat.cateringBlock!, heavyToday: cat.heavyToday,
      headsUp: cat.headsUp, extras: EXTRAS, nextUp: nextUpInBlock(cat), shopId: "shop-p", language }));
    const input = { planDate: dateOf(o), nowMin: hm(t), viewer: GM, facts };
    const gm = shopPlan(GM, hm(t), facts, dateOf(o));
    const needs = renderToStaticMarkup(createElement(NeedsYou, { cells: CELLS, plan: gm, tasksKnown: assignmentsKnown(input) && !aggregateFailure(gm), shopId: "shop-p", language }));
    out[`markup/${on}/${vn}/${t}/${language}`] = sha(`${block}\n${needs}`);
  }
  return out;
}

// ── The mid-shift strip and the pulse's catering section ──
const DUE = [
  { id: "c1", timeWindow: "10:30 AM", name: "Acme lunch", headcount: 20, isDelivery: true, stage: "confirmed" as const, source: "ezcater" },
  { id: "c2", timeWindow: "1:00 PM", name: "Board meeting", headcount: 1, isDelivery: false, stage: "out" as const, source: null },
];
const LOC = "11111111-1111-4111-8111-111111111111";
const auth = (level: number): AuthContext => ({
  user: { id: "me", role: level >= 7 ? "gm" : level >= 4 ? "key_holder" : "employee", language: "en", active: true } as AuthContext["user"],
  session: {} as AuthContext["session"], role: level >= 7 ? "gm" : level >= 4 ? "key_holder" : "employee", level, locations: [LOC],
});
const pulseCtx = (level: number): PulseCtx => ({ auth: auth(level), locationId: LOC, date: "2026-10-09", now: new Date("2026-10-09T19:30:00Z") });
const never = async (): Promise<never> => { throw new Error("not read in this test"); };
const pulseDeps = (): PulseDeps => ({
  board: never, fridges: never, unlinkedClockIns: never, lastParPass: never, deliveries: never, cutoffs: never, sales: never, handoff: never, layout: never,
  reports: async () => ({ rows: [{ key: "am_prep" as const, progress: "not_started" as const, doneAt: null, doneByName: null }], closingDone: false, midDayDoneCount: 0 }),
  cateringToday: async () => DUE,
  cateringTomorrow: async () => ({ count: 1, firstWindow: "11:00 AM" }),
  notRung: async () => [],
  priorAmPrep: async () => null,
});
async function midShiftCases(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const language of ["en", "es"] as const) {
    out[`midshift/strip/${language}`] = sha(renderToStaticMarkup(createElement(CateringToday, { items: DUE, tomorrow: { count: 1, firstWindow: "11:00 AM" }, language })));
  }
  for (const level of [4, 5, 7]) out[`pulse/catering/level${level}`] = sha(await loadPulseSection(pulseDeps(), pulseCtx(level), "catering"));
  return out;
}

// ── The loader: its facts, and every query it sends ──
const KH = { ...ANA, userId: "33333333-3333-4333-8333-333333333333" };
const CREW = { ...LUIS, userId: "44444444-4444-4444-8444-444444444444" };
const GM_V = { ...GM, userId: "55555555-5555-4555-8555-555555555555" };
const CAT_V = { ...CATERING_MEMBER, userId: "66666666-6666-4666-8666-666666666666" };
const MOO_V = { ...MOO, userId: "77777777-7777-4777-8777-777777777777" };
async function loaderCases(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries({ KH, CREW, GM_V, CAT_V, MOO_V })) {
    // The fixture reads (every lane answered by the fake deps).
    out[`loader/fixture/${name}`] = sha(await loadDayFacts(NO_CLIENT, loaderArgs(v), okDeps()));
    // The REAL reads on the recording client: the facts, and every query in the order sent (table, select, filters).
    const f = fakeSupabase(shopDay, () => ({ data: PLAN_DATE }));
    const now = at("13:45", PLAN_DATE);
    const input = await loadDayFacts(f.client as never, { viewer: v, shop: { id: LOC, code: "P" }, now, locations: [LOC],
      board: async () => ({ stationDate: PLAN_DATE, locationId: LOC, date: PLAN_DATE, viewerId: v.userId, viewerLevel: v.level, stations: [], people: [], events: [], tasks: [] }) });
    out[`loader/real/${name}/facts`] = sha(input);
    out[`loader/real/${name}/queries`] = sha([...f.calls.map((c) => `${c.table}|${JSON.stringify(c.ops)}`), ...f.rpcs.map((r) => `rpc:${r.name}`)].sort());
    out[`loader/real/${name}/count`] = String(f.calls.length + f.rpcs.length);
  }
  return out;
}

describe("D3 off-equivalence: with delivery tracking off, nothing changed", () => {
  beforeEach(() => { vi.stubEnv("DELIVERY_TRACKING", ""); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at("13:45", PLAN_DATE)); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("the engine, the loader (facts and queries), the block, Needs you, mid-shift and the pulse match the golden frozen from the unchanged base", async () => {
    const now: Record<string, string> = { ...engineCases(), ...markupCases(), ...(await midShiftCases()), ...(await loaderCases()) };
    if (process.env.WRITE_D3_OFF_GOLDEN === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
      if (process.env.WRITE_D3_OFF_GOLDEN !== "1") throw new Error("golden was missing: written; re-run");
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());
    const moved = Object.keys(golden).filter((k) => golden[k] !== now[k]);
    expect(moved).toEqual([]);
    expect(Object.keys(golden).length).toBeGreaterThan(300);
  });
});

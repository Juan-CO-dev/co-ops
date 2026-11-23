/**
 * Catering delivery D3 — the status wiring (plan r6 section 6.2): the day plan's ONE delivery lane, placement through the
 * one row rule, the catering block, "Needs you", mid-shift and the pulse.
 *
 *  - `cateringOrders()` attaches the state by lead id; `cateringOrderRows` passes it through: no second row rule, no new
 *    ordering, no band moved. `to_book` inside the shop's catering lead window reads `to_book_soon`.
 *  - A lead with NO order row (a rejected order whose courier is still booked) is an alert line, never a row.
 *  - A failed delivery read is "Couldn't load delivery" on every surface and "at least" in the counts: never "to book",
 *    never 0. Off = nothing is added anywhere (the off-equivalence goldens pin the bytes).
 *  - Roles: the delivery lines are the catering manager's block's only; the social media manager's page starts no
 *    delivery read; below key holder nothing is read; "Needs you" shows it only to its own roles.
 *  - Read counts: the day loader's pinned budget moves by exactly this lane's queries, and only when delivery is on.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));

import { CateringBlock } from "@/components/dashboard/CateringBlock";
import { NeedsYou } from "@/components/dashboard/NeedsYou";
import { CateringToday } from "@/components/midshift/CateringToday";
import type { InboxWaiting, NeedsYouCells, NotRungScoped } from "@/lib/dashboard-blocks";
import { assignmentsKnown, cateringBlockIndex, needsYouFor, NEEDS_YOU_ROLES, needsYouSummary, nextUpInBlock } from "@/lib/dashboard-blocks-shared";
import type { Settled } from "@/lib/dashboard-day";
import { aggregateFailure } from "@/lib/dashboard-day-shared";
import { defaultDayFactDeps, loadDayFacts } from "@/lib/day-plan";
import { cateringDeliveryAlerts, cateringOrders, deliveryInput } from "@/lib/day-plan-load-shared";
import { buildDay, cateringOrderRows, deliveryNeedsOf, EMITTED_KEYS, planDay, type CateringOrder, type DayPlan, type DayPlanInput, type DayViewer, type ShopFacts } from "@/lib/day-plan-shared";
import { DELIVERY_UNKNOWN, type DeliveryAlert, type DeliveryDayLead, type DeliveryDayResult, type DeliveryRowState } from "@/lib/delivery/day-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { loadPulseSection, memoDeps, cachedPulseDeps, type PulseCtx, type PulseDeps } from "@/lib/pulse/sections";
import type { CateringData } from "@/lib/pulse/types";
import type { AuthContext } from "@/lib/session";
import { ALL_VIEWERS, ANA, CATERING_MEMBER, CGS, failed, GM, hm, LUIS, MOO, ok, order, PLAN_DATE, viewer, withFailed } from "./fixtures/day-plan/build";
import { args as loaderArgs, at, NO_CLIENT, PLAN, SHOP as P_SHOP, TOMORROW, withDeps } from "./fixtures/day-plan/loader-deps";
import { pStreet } from "./fixtures/day-plan/p-street";
import { job, lead as leadRow, on, quote, SENTINELS, worldResponder, type World } from "./fixtures/delivery/day-world";
import { shopDay } from "./fixtures/delivery/shop-day-reads";
import { text } from "./helpers/day-render";
import { fakeSupabase } from "./helpers/fake-supabase";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const SHOP = "shop-p";
const row = (state: DeliveryRowState["state"], over: Partial<DeliveryRowState> = {}): DeliveryRowState => ({ state, at: null, status: null, ...over });
const okAlerts = (alerts: DeliveryAlert[] = []) => ok({ forDate: PLAN_DATE, alerts });
/** P Street at `t` with these orders today; `alerts` undefined = delivery off. */
function facts(t: string, orders: CateringOrder[], alerts?: ShopFacts["deliveryAlerts"]): ShopFacts {
  return { ...pStreet(hm(t)), cateringToday: ok({ forDate: PLAN_DATE, orders }), ...(alerts ? { deliveryAlerts: alerts } : {}) };
}
const plan = (v: DayViewer, t: string, f: ShopFacts): DayPlan => {
  const p = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: f });
  if (p.kind !== "shop") throw new Error("shop plan expected");
  return p;
};
const okS = <T,>(value: T): Settled<T> => ({ kind: "ok", value });
const EXTRAS = { inbox: okS<InboxWaiting>({ shop: 0, unplaced: 0 }), notRung: okS<NotRungScoped>({ count: 0, house: "on" }) };
function renderBlock(p: DayPlan, language: "en" | "es" = "en"): string {
  const i = cateringBlockIndex(p);
  if (i < 0) return "";
  return renderToStaticMarkup(createElement(CateringBlock, { item: p.items[i]!, block: p.cateringBlock!, heavyToday: p.heavyToday, headsUp: p.headsUp, extras: EXTRAS,
    nextUp: nextUpInBlock(p), shopId: SHOP, language }));
}
const deliveryKeys = (p: DayPlan, id = "catering_today") => p.items.find((i) => i.id === id)?.reasons.filter((r) => r.key.startsWith("day.reason.catering.delivery_")).map((r) => `${r.key.split(".").pop()}=${(r.params.n as { v: number }).v}`) ?? [];

// The lead window: P Street's leadMinutes is 210, so a 15:00 order's window opens at 11:30.
const AT_3PM = 60;

beforeEach(() => { vi.stubEnv("DELIVERY_TRACKING", "1"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

// ══ The loader's pure half ══════════════════════════════════════════════════
const dayLead = (leadId: string, over: Partial<DeliveryDayLead> = {}): DeliveryDayLead =>
  ({ leadId, stage: "confirmed", currentShopId: SHOP, orderQuote: { kind: "accepted", isDelivery: true }, isEzcater: false, jobs: [], ...over });
const openJob = (over: Partial<DeliveryDayLead["jobs"][number]> = {}) => ({ attemptNo: 1, status: "accepted" as const, open: true, pickupShopId: SHOP, keptForCurrentShop: false, at: "2026-11-18T15:00:00.000Z", pickupAt: "2026-11-18T15:40:00.000Z", ...over });
const RULES = { eventQFromWindow: () => 48, etWallQ: () => 48, ezcaterCancelled: () => false };
const BOOKED = [{ id: "p1", eventDate: PLAN, timeWindow: "noon", headcount: 9, stage: "confirmed" }, { id: "p2", eventDate: PLAN, timeWindow: "noon", headcount: 9, stage: "out" },
  { id: "p3", eventDate: TOMORROW, timeWindow: "noon", headcount: 9, stage: "confirmed" }];
const EZ = [{ id: "e1", event_date: PLAN, event_timestamp: null, handoff_time: null, headcount: 3, status: null }];

describe("cateringOrders(): the state is attached by lead id", () => {
  it("without a delivery input the orders are exactly the pre-D3 orders (no key)", () => {
    for (const o of cateringOrders(PLAN, BOOKED, EZ, new Map(), RULES)) expect(Object.keys(o)).toEqual(["id", "source", "eventQ", "headcount", "state", "outAt"]);
    expect(deliveryInput({ off: true })).toBeUndefined();
  });

  it("ok: a pipeline order carries its lead's state; a lead the fact lacks reads null; an unlinked ezCater order carries nothing", () => {
    const delivery = deliveryInput({ ok: true, leads: [dayLead("p1"), dayLead("p2", { jobs: [openJob({ status: "picked_up" })] })] })!;
    const orders = cateringOrders(PLAN, [...BOOKED, { id: "p4", eventDate: PLAN, timeWindow: null, headcount: 1, stage: "confirmed" }], EZ, new Map(), RULES, delivery);
    expect(orders.map((o) => [o.id, o.delivery])).toEqual([
      ["p1", { state: "to_book", at: null, status: null }], ["p2", { state: "on_the_way", at: "2026-11-18T15:00:00.000Z", status: "picked_up" }],
      ["p4", null], ["e1", undefined],
    ]);
    expect("delivery" in orders.at(-1)!).toBe(false);
  });

  it("a failed read (an answer of { ok: false }, or a lane that threw or timed out): every pipeline order reads unknown, never to book", () => {
    for (const input of [deliveryInput({ ok: false }), deliveryInput(null)]) {
      expect(input).toEqual({ kind: "failed" });
      const orders = cateringOrders(PLAN, BOOKED, EZ, new Map(), RULES, input);
      expect(orders.filter((o) => o.source === "pipeline").map((o) => o.delivery)).toEqual([DELIVERY_UNKNOWN, DELIVERY_UNKNOWN]);
      expect(orders.find((o) => o.source === "ezcater")!.delivery).toBeUndefined();
    }
  });

  it("the alerts are the fact's leads with no PIPELINE order row today", () => {
    const leads = [dayLead("p1", { orderQuote: { kind: "rejected", isDelivery: false }, jobs: [openJob()] }), dayLead("gone", { stage: "lost", jobs: [openJob()] }),
      dayLead("moved", { jobs: [openJob({ pickupShopId: "other", pickupAt: null })] }), dayLead("fine", { jobs: [openJob()] }), dayLead("e1", { stage: "lost", jobs: [openJob()] })];
    const orders = cateringOrders(PLAN, BOOKED, EZ, new Map(), RULES, { kind: "ok", leads });
    // p1 is a ROW (the lead is still confirmed; its quote was declined): the row reads cancel_needed.
    expect(orders.find((o) => o.id === "p1")!.delivery!.state).toBe("cancel_needed");
    // An ezCater order id is not a lead id: a lead that happens to share it is still order-less.
    expect(cateringDeliveryAlerts(orders, { kind: "ok", leads })).toEqual([
      { leadId: "gone", state: "cancel_needed", at: "2026-11-18T15:40:00.000Z" }, { leadId: "moved", state: "pickup_mismatch", at: null }, { leadId: "e1", state: "cancel_needed", at: "2026-11-18T15:40:00.000Z" },
    ]);
  });
});

// ══ loadDayFacts: ONE lane ══════════════════════════════════════════════════
describe("loadDayFacts: the delivery lane", () => {
  const booked = async () => [{ id: "lead-1", eventDate: PLAN, timeWindow: "3:00 PM", headcount: 20, stage: "confirmed" }, { id: "lead-2", eventDate: TOMORROW, timeWindow: "11:00 AM", headcount: 40, stage: "confirmed" }];
  const load = async (delivery: () => Promise<DeliveryDayResult>, v: DayViewer = ANA, over = {}) => {
    const input = await loadDayFacts(NO_CLIENT, loaderArgs(v), withDeps({ booked, delivery, ...over }));
    if (input.facts.kind !== "shop") throw new Error("shop facts expected");
    return input.facts;
  };
  const today = (f: ShopFacts) => (f.cateringToday.kind === "ok" ? f.cateringToday.value.orders : []);
  const tomorrow = (f: ShopFacts) => (f.cateringTomorrow.kind === "ok" ? f.cateringTomorrow.value.orders : []);
  const LEADS = [dayLead("lead-1", { currentShopId: P_SHOP.id }), dayLead("lead-9", { stage: "lost", currentShopId: P_SHOP.id, jobs: [openJob({ pickupShopId: P_SHOP.id })] })];

  it("the lane is asked ONCE, for the shop, the plan date, and the viewer's real role and memberships", async () => {
    const seen: unknown[] = [];
    await load(async (...a: unknown[]) => { seen.push(a[1]); return { off: true }; });
    expect(seen).toEqual([{ actor: { role: "key_holder", active: true, locations: [P_SHOP.id] }, shopId: P_SHOP.id, date: PLAN }]);
  });

  it("ok: today's order carries its state, the order-less lead is an alert; tomorrow's orders carry nothing", async () => {
    const f = await load(async () => ({ ok: true, leads: LEADS }));
    expect(today(f).find((o) => o.id === "lead-1")!.delivery).toEqual({ state: "to_book", at: null, status: null });
    expect(f.deliveryAlerts).toEqual(ok({ forDate: PLAN, alerts: [{ leadId: "lead-9", state: "cancel_needed", at: "2026-11-18T15:40:00.000Z" }] }));
    for (const o of tomorrow(f)) expect("delivery" in o).toBe(false);
  });

  it("off: no key anywhere in the facts", async () => {
    const f = await load(async () => ({ off: true }));
    expect("deliveryAlerts" in f).toBe(false);
    expect(JSON.stringify(f)).not.toContain("delivery");
  });

  it.each([
    ["answers { ok: false }", async (): Promise<DeliveryDayResult> => ({ ok: false })],
    ["throws", async (): Promise<DeliveryDayResult> => { throw new Error("down"); }],
  ])("a delivery read that %s: every order reads unknown and the alerts failed; no other fact is touched", async (_n, delivery) => {
    const good = await load(async () => ({ off: true }));
    const f = await load(delivery);
    expect(today(f).filter((o) => o.source === "pipeline").map((o) => o.delivery)).toEqual([DELIVERY_UNKNOWN]);
    expect(f.deliveryAlerts).toEqual(failed());
    const strip = (x: ShopFacts) => JSON.stringify({ ...x, cateringToday: null, deliveryAlerts: undefined });
    expect(strip(f)).toBe(strip(good));
  });

  it("a delivery read that hangs past the deadline is a failure, and holds nothing else back", async () => {
    const f = await load(() => new Promise<DeliveryDayResult>(() => undefined), ANA, {});
    expect(f.deliveryAlerts).toEqual(failed());
    expect(today(f)[0]!.delivery).toEqual(DELIVERY_UNKNOWN);
    expect(f.opening.kind).toBe("ok");
  }, 20_000);

  it("the catering read failed and the delivery read loaded: no row is known, so every lead that needs a person is an alert", async () => {
    const f = await load(async () => ({ ok: true, leads: [...LEADS, dayLead("lead-1b", { currentShopId: P_SHOP.id, orderQuote: { kind: "rejected", isDelivery: false }, jobs: [openJob({ pickupShopId: P_SHOP.id })] })] }),
      ANA, { booked: async () => { throw new Error("down"); } });
    expect(f.cateringToday).toEqual(failed());
    expect(f.deliveryAlerts!.kind === "ok" && f.deliveryAlerts!.value.alerts.map((a) => a.leadId)).toEqual(["lead-9", "lead-1b"]);
  });

  it("the social media manager: the delivery lane is never started", async () => {
    const delivery = vi.fn(async (): Promise<DeliveryDayResult> => ({ ok: true, leads: LEADS }));
    const input = await loadDayFacts(NO_CLIENT, loaderArgs(viewer("social_media_mgr", "u-smm")), withDeps({ delivery }));
    expect(input.facts.kind).toBe("smm");
    expect(delivery).not.toHaveBeenCalled();
    expect(JSON.stringify(input)).not.toContain("delivery");
  });
});

// ══ The engine: placement through the one row rule ══════════════════════════
describe("the engine: no second row rule", () => {
  const ORDERS = (d: Record<string, DeliveryRowState | null>): CateringOrder[] => [
    order({ id: "a", eventQ: AT_3PM, headcount: 20, delivery: d.a ?? null }), order({ id: "b", eventQ: 44, headcount: 10, state: "out", outAt: "2026-11-18T15:40:00.000Z", delivery: d.b ?? null }),
    order({ id: "c", eventQ: null, headcount: 5, delivery: d.c ?? null }), order({ id: "ez", source: "ezcater", eventQ: 50, headcount: 8, state: "not_tracked" }),
  ];
  const STATES = { a: row("to_book"), b: row("on_the_way", { at: "2026-11-18T15:42:00.000Z", status: "picked_up" }), c: row("booked", { at: "2026-11-18T19:00:00.000Z", status: "accepted" }) };

  it("cateringOrderRows passes the order through unchanged: same rows, same order, with or without a state", () => {
    const setting = { leadMinutes: 210, defaultStartQ: 34, defaultEndQ: 52 };
    const bare = cateringOrderRows(ORDERS({}).map(({ delivery: _d, ...o }) => o), setting, hm("10:00"));
    const withState = cateringOrderRows(ORDERS(STATES), setting, hm("10:00"));
    expect(withState.map((r) => [r.o.id, r.from, r.time, r.tracked, r.out, r.open])).toEqual(bare.map((r) => [r.o.id, r.from, r.time, r.tracked, r.out, r.open]));
    expect(withState.find((r) => r.o.id === "a")!.o.delivery).toBe(STATES.a);
  });

  it("delivery moves no band, no time, no order, no Next up: every viewer's plan differs from the off plan only by the delivery fields", () => {
    for (const t of ["06:00", "10:00", "11:45", "13:00", "15:30", "20:30"]) {
      const off = facts(t, ORDERS({}).map(({ delivery: _d, ...o }) => o));
      const onF = facts(t, ORDERS(STATES), okAlerts([{ leadId: "gone", state: "cancel_needed", at: null }]));
      for (const v of Object.values(ALL_VIEWERS)) {
        const a = plan(v, t, off), b = plan(v, t, onF);
        const stripped = { ...b, items: b.items.map((i) => ({ ...i, reasons: i.reasons.filter((r) => !r.key.startsWith("day.reason.catering.delivery_")) })),
          cateringBlock: b.cateringBlock && { ...b.cateringBlock, deliveryAlerts: undefined,
            today: b.cateringBlock.today === "unknown" ? "unknown" : b.cateringBlock.today.map(({ delivery: _d, ...o }) => o) } };
        expect(JSON.stringify(stripped), `${v.role} ${t}`).toBe(JSON.stringify(a));
      }
    }
  });

  it("to_book becomes to_book_soon inside the shop's catering lead window (the row's own `from`), and only to_book", () => {
    const at = (t: string) => plan(CATERING_MEMBER, t, facts(t, ORDERS(STATES), okAlerts())).cateringBlock!;
    const state = (b: ReturnType<typeof at>, id: string) => (b.today === "unknown" ? null : b.today.find((o) => o.id === id)?.delivery?.state);
    // A 15:00 order with 210 minutes of lead: the window opens at 11:30.
    expect(state(at("11:29"), "a")).toBe("to_book");
    expect(state(at("11:30"), "a")).toBe("to_book_soon");
    expect(state(at("16:00"), "a")).toBe("to_book_soon");
    expect(state(at("16:00"), "b")).toBe("on_the_way");
    expect(state(at("16:00"), "c")).toBe("booked");
    expect(state(at("16:00"), "ez")).toBeUndefined();
  });

  it("the block carries each order's state (none included) and the alerts; off = neither key", () => {
    const b = plan(CATERING_MEMBER, "10:00", facts("10:00", ORDERS({ ...STATES, c: row("none") }), okAlerts([{ leadId: "gone", state: "cancel_needed", at: null }]))).cateringBlock!;
    expect(b.deliveryAlerts).toEqual([{ leadId: "gone", state: "cancel_needed", at: null }]);
    expect((b.today as ReadonlyArray<{ id: string; delivery?: DeliveryRowState }>).map((o) => [o.id, o.delivery?.state])).toEqual([["b", "on_the_way"], ["ez", undefined], ["a", "to_book"], ["c", "none"]]);
    const off = plan(CATERING_MEMBER, "10:00", facts("10:00", ORDERS({}).map(({ delivery: _d, ...o }) => o))).cateringBlock!;
    expect("deliveryAlerts" in off).toBe(false);
    for (const o of off.today as object[]) expect("delivery" in o).toBe(false);
  });

  it("rejected after booking: the row (a declined quote, the lead still confirmed) and the alert (the lead is lost) both read cancel_needed", () => {
    const f = facts("10:00", [order({ id: "a", eventQ: AT_3PM, headcount: 20, delivery: row("cancel_needed", { status: "accepted" }) })], okAlerts([{ leadId: "lost-lead", state: "cancel_needed", at: "2026-11-18T19:00:00.000Z" }]));
    const p = plan(CATERING_MEMBER, "10:00", f);
    expect(deliveryKeys(p)).toEqual(["delivery_cancel_needed=2"]);
    const html = renderBlock(p);
    expect(html).toContain('data-delivery-alert="cancel_needed"');
    expect(html).toContain('data-delivery-state="cancel_needed"');
    expect(text(html)).toContain(EN["catering.delivery_state.cancel_needed"]);
    // The alert line is above the rows.
    expect(html.indexOf("data-delivery-alerts")).toBeLessThan(html.indexOf("data-orders"));
  });

  it("an alert day with no order at all: the alert is drawn and counted, though the day reads 'no catering order today'", () => {
    const p = plan(CATERING_MEMBER, "10:00", facts("10:00", [], okAlerts([{ leadId: "x", state: "pickup_mismatch", at: null }])));
    expect(deliveryKeys(p)).toEqual(["delivery_pickup_mismatch=1"]);
    expect(text(renderBlock(p))).toContain(EN["dashboard.catering_block.delivery_alert.pickup_mismatch"]);
    expect(deliveryNeedsOf({ planDate: PLAN_DATE, nowMin: hm("10:00"), facts: facts("10:00", [], okAlerts([{ leadId: "x", state: "pickup_mismatch", at: null }])) })).toEqual({ count: 1 });
  });
});

describe("the four reasons: the catering manager's block only", () => {
  const ORDERS = [
    order({ id: "a", eventQ: AT_3PM, headcount: 20, delivery: row("to_book") }), order({ id: "b", eventQ: 62, headcount: 10, delivery: row("to_book") }),
    order({ id: "c", eventQ: 64, headcount: 10, delivery: row("problem", { status: "failed" }) }), order({ id: "d", eventQ: 66, headcount: 10, delivery: row("pickup_mismatch", { status: "accepted" }) }),
    order({ id: "e", eventQ: 68, headcount: 10, delivery: row("delivered", { status: "delivered" }) }), order({ id: "f", eventQ: 70, headcount: 10, delivery: row("provider_managed") }),
  ];
  const F = facts("10:00", ORDERS, okAlerts([{ leadId: "g", state: "cancel_needed", at: null }]));

  it("they are in EMITTED_KEYS with exactly {n}, en and es", () => {
    for (const k of ["day.reason.catering.delivery_to_book", "day.reason.catering.delivery_cancel_needed", "day.reason.catering.delivery_problem", "day.reason.catering.delivery_pickup_mismatch"] as const) {
      expect(EMITTED_KEYS[k]).toEqual(["n"]);
      for (const d of [EN, ES]) expect([...d[k]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(["n"]);
    }
  });

  it("the catering manager's item carries them, after its own reasons, each with its count", () => {
    const p = plan(CATERING_MEMBER, "10:00", F);
    expect(p.items.find((i) => i.id === "catering_today")!.placement).toBe("block");
    expect(deliveryKeys(p)).toEqual(["delivery_cancel_needed=1", "delivery_problem=1", "delivery_pickup_mismatch=1", "delivery_to_book=2"]);
    const reasons = p.items.find((i) => i.id === "catering_today")!.reasons;
    expect(reasons[0]!.key.startsWith("day.reason.catering.delivery_")).toBe(false);
    expect(text(renderBlock(p))).toContain(EN["day.reason.catering.delivery_to_book"]!.replace("{n}", "2"));
    expect(text(renderBlock(p, "es"))).toContain(ES["day.reason.catering.delivery_cancel_needed"]!.replace("{n}", "1"));
  });

  it("no other viewer's row carries one (key holder, shift lead, AGM, GM, MoO, owner, CGS, crew)", () => {
    for (const [name, v] of Object.entries(ALL_VIEWERS)) {
      if (v.role === "catering_mgr") continue;
      const p = plan(v, "10:00", F);
      expect(p.items.flatMap((i) => i.reasons).filter((r) => r.key.startsWith("day.reason.catering.delivery_")), name).toEqual([]);
      expect(p.cateringBlock, name).toBeNull();
    }
  });

  it("the viewer-independent model holds them once (the lens decides who sees them)", () => {
    const d = buildDay(PLAN_DATE, hm("10:00"), F);
    expect(d.items.find((i) => i.id === "catering_today")!.reasons.filter((r) => r.key.startsWith("day.reason.catering.delivery_"))).toHaveLength(4);
  });
});

// ══ A failed delivery read is never "to book" ═══════════════════════════════
describe("failed source: the day plan and the block", () => {
  const ORDERS = [order({ id: "a", eventQ: AT_3PM, headcount: 20, delivery: DELIVERY_UNKNOWN }), order({ id: "ez", source: "ezcater", eventQ: 50, headcount: 8, state: "not_tracked" })];
  const F = facts("13:00", ORDERS, failed());

  it("rows read unknown, the alerts are unknown, no delivery reason is emitted, nothing says to book", () => {
    const p = plan(CATERING_MEMBER, "13:00", F);
    expect(p.cateringBlock!.deliveryAlerts).toBe("unknown");
    expect(deliveryKeys(p)).toEqual([]);
    for (const language of ["en", "es"] as const) {
      const L = language === "en" ? EN : ES;
      const html = renderBlock(p, language);
      expect(html).toContain('data-delivery-state="unknown"');
      expect(text(html)).toContain(L["catering.delivery_state.unknown"]);
      for (const k of ["catering.delivery_state.to_book", "catering.delivery_state.to_book_soon", "catering.delivery_state.booked"]) expect(text(html)).not.toContain(L[k]);
      // A row says it itself: the block does not repeat it above the rows.
      expect(html).not.toContain("data-delivery-alerts");
    }
  });

  it("with no row to say it (no order today, or the catering read failed too), the block says it once above the rows", () => {
    for (const f of [facts("13:00", [], failed()), withFailed(F, ["cateringToday"])]) {
      const html = renderBlock(plan(CATERING_MEMBER, "13:00", f));
      expect(html).toContain('data-delivery-alerts="unknown"');
      expect(text(html)).toContain(EN["dashboard.catering_block.delivery_unknown"]);
    }
  });

  it("alerts recorded for another day are not today's: unknown", () => {
    const stale = facts("13:00", [], ok({ forDate: "2026-11-17", alerts: [{ leadId: "x", state: "cancel_needed", at: null }] }));
    expect(plan(CATERING_MEMBER, "13:00", stale).cateringBlock!.deliveryAlerts).toBe("unknown");
    expect(deliveryNeedsOf({ planDate: PLAN_DATE, nowMin: hm("13:00"), facts: stale })).toEqual({ count: null });
    // Rows that DID load say nothing about the alerts: the block still says the alerts could not load.
    const mixed = facts("13:00", [order({ id: "a", eventQ: AT_3PM, headcount: 20, delivery: row("booked", { status: "accepted" }) })], failed());
    const html = renderBlock(plan(CATERING_MEMBER, "13:00", mixed));
    expect(html).toContain('data-delivery-alerts="unknown"');
    expect(html).toContain('data-delivery-state="booked"');
  });
});

// ══ "Needs you" ═════════════════════════════════════════════════════════════
describe("Needs you: one more cell, through needsYouSummary", () => {
  const CELLS: NeedsYouCells = { vendorMail: okS(0), recipes: okS(0), inbox: okS<InboxWaiting>({ shop: 0, unplaced: 0 }) };
  const NIGHT = "13:00";
  const input = (f: ShopFacts, v: DayViewer = GM): DayPlanInput => ({ planDate: PLAN_DATE, nowMin: hm(NIGHT), viewer: v, facts: { ...f, assignments: ok({ forDate: PLAN_DATE, scope: "all_tasks", rows: [] }) } });
  const render = (inp: DayPlanInput, language: "en" | "es" = "en") => {
    const p = planDay(inp) as DayPlan;
    const d = deliveryNeedsOf(inp);
    return renderToStaticMarkup(createElement(NeedsYou, { cells: CELLS, plan: { items: [] }, tasksKnown: assignmentsKnown(inp) && !aggregateFailure(p), shopId: SHOP, language, ...(d ? { delivery: d } : {}) }));
  };
  const ORDERS = [
    order({ id: "soon", eventQ: 56, headcount: 20, delivery: row("to_book") }),     // 14:00: inside its window at 13:00
    order({ id: "later", eventQ: 80, headcount: 20, delivery: row("to_book") }),    // 20:00: its window opens at 16:30
    order({ id: "fail", eventQ: 60, headcount: 20, delivery: row("problem", { status: "failed" }) }),
    order({ id: "fine", eventQ: 62, headcount: 20, delivery: row("booked", { status: "accepted" }) }),
    order({ id: "ezc", eventQ: 64, headcount: 20, delivery: row("provider_managed") }),
  ];

  it("counts to_book_soon, cancel_needed, problem and pickup_mismatch: rows and alerts; to_book outside the window is not counted yet", () => {
    const f = facts(NIGHT, ORDERS, okAlerts([{ leadId: "x", state: "cancel_needed", at: null }, { leadId: "y", state: "pickup_mismatch", at: null }]));
    expect(deliveryNeedsOf(input(f))).toEqual({ count: 4 });
    for (const language of ["en", "es"] as const) {
      const html = render(input(f), language);
      expect(html).toContain('data-needs-you-line="count"');
      expect(html).toContain('data-needs-you="delivery"');
      expect(text(html)).toContain((language === "en" ? EN : ES)["dashboard.needs_you.delivery_other"]!.replace("{n}", "4"));
      expect(html).toContain('href="/catering/pipeline"');
    }
    const one = facts(NIGHT, [ORDERS[2]!], okAlerts());
    expect(text(render(input(one)))).toContain(EN["dashboard.needs_you.delivery_one"]);
  });

  it("every source loaded at 0: 'Nothing needs you', and no delivery row", () => {
    const html = render(input(facts(NIGHT, [ORDERS[3]!, ORDERS[1]!], okAlerts())));
    expect(html).toContain('data-needs-you-line="none"');
    expect(html).not.toContain('data-needs-you="delivery"');
  });

  it.each([
    ["the delivery read failed", facts(NIGHT, [order({ id: "a", eventQ: 56, delivery: DELIVERY_UNKNOWN })], failed())],
    ["the catering read failed, the delivery read loaded", withFailed(facts(NIGHT, [], okAlerts([{ leadId: "x", state: "cancel_needed", at: null }])), ["cateringToday"])],
    ["one row is unknown beside a loaded alert", facts(NIGHT, [order({ id: "a", eventQ: 56, delivery: DELIVERY_UNKNOWN })], okAlerts([{ leadId: "x", state: "cancel_needed", at: null }]))],
  ])("%s: the cell is null = 'at least', the source is named, never 'nothing' and never 0", (_n, f) => {
    expect(deliveryNeedsOf(input(f))).toEqual({ count: null });
    expect(needsYouSummary([{ count: 0 }, { count: null }])).toEqual({ kind: "at_least", n: 0 });
    for (const language of ["en", "es"] as const) {
      const L = language === "en" ? EN : ES;
      const html = render(input(f), language);
      expect(html).toContain('data-needs-you-line="at_least"');
      expect(html).toContain('data-needs-you="delivery"');
      expect(text(html)).toContain(L["dashboard.needs_you.unavailable"]!.replace("{name}", L["dashboard.needs_you.delivery_name"]!));
      expect(text(html)).not.toContain(L["dashboard.needs_you.none"]);
    }
  });

  it("off: not applicable — no cell, no row, and the line is what it was", () => {
    const off = facts(NIGHT, ORDERS.map(({ delivery: _d, ...o }) => o));
    expect(deliveryNeedsOf(input(off))).toBeNull();
    const html = render(input(off));
    expect(html).not.toContain("delivery");
    expect(html).toContain('data-needs-you-line="none"');
  });

  it("only its roles: GM, MoO, Owner, CGS get 'Needs you'; the others never render it, whatever the facts hold", () => {
    expect([...NEEDS_YOU_ROLES].sort()).toEqual(["cgs", "gm", "moo", "owner"]);
    for (const v of Object.values(ALL_VIEWERS)) expect([v.role, needsYouFor(v.role)]).toEqual([v.role, ["gm", "moo", "owner", "cgs"].includes(v.role)]);
    expect(needsYouFor("social_media_mgr")).toBe(false);
    // The cell is the same number for each of its roles (it reads the facts, not the lens).
    const f = facts(NIGHT, ORDERS, okAlerts());
    for (const v of [GM, MOO, CGS]) expect(deliveryNeedsOf(input(f, v))).toEqual({ count: 2 });
    expect(deliveryNeedsOf({ planDate: PLAN_DATE, nowMin: 0, viewer: GM, facts: { kind: "smm", ownTasks: failed(), ownStation: failed() } } as DayPlanInput)).toBeNull();
  });
});

// ══ Mid-shift and the pulse ═════════════════════════════════════════════════
describe("mid-shift: the status-only line", () => {
  const item = (id: string, delivery?: DeliveryRowState) => ({ id, timeWindow: "10:30 AM", name: "Acme lunch", headcount: 20, isDelivery: true, stage: "confirmed" as const, source: null, ...(delivery ? { delivery } : {}) });
  const strip = (items: ReturnType<typeof item>[], language: "en" | "es" = "en") =>
    renderToStaticMarkup(createElement(CateringToday, { items, tomorrow: { count: 0, firstWindow: null }, language }));

  it("Courier booked · pick-up 10:40, Picked up, Delivered — from the one label rule, in en and es", () => {
    const html = strip([
      item("a", row("booked", { at: "2026-11-18T15:40:00.000Z", status: "accepted" })), item("b", row("on_the_way", { status: "picked_up" })), item("c", row("delivered", { status: "delivered" })),
    ]);
    expect(text(html)).toContain("Courier booked · pick-up 10:40");
    expect(text(html)).toContain("Picked up");
    expect(text(html)).toContain("Delivered");
    expect([...html.matchAll(/data-delivery-state="(\w+)"/g)].map((m) => m[1])).toEqual(["booked", "on_the_way", "delivered"]);
    expect(text(strip([item("a", row("booked", { status: "accepted" }))], "es"))).toContain(ES["catering.delivery_state.booked"]);
  });

  it("nothing when off; 'Couldn't load delivery' on a failed read, never a booked or to-book line", () => {
    expect(strip([item("a")])).not.toContain("data-delivery-state");
    const html = strip([item("a", DELIVERY_UNKNOWN)]);
    expect(text(html)).toContain(EN["catering.delivery_state.unknown"]);
    expect(text(html)).not.toContain(EN["catering.delivery_state.to_book"]);
  });
});

describe("the pulse's catering section: the same lane, gated before the read", () => {
  const LOC = "11111111-1111-4111-8111-111111111111";
  const auth = (role: string, level: number, locations = [LOC], active = true): AuthContext => ({
    user: { id: "me", role, language: "en", active } as AuthContext["user"], session: {} as AuthContext["session"], role, level, locations } as AuthContext);
  const ctx = (a: AuthContext): PulseCtx => ({ auth: a, locationId: LOC, date: "2026-10-09", now: new Date("2026-10-09T19:30:00Z") });
  const never = async (): Promise<never> => { throw new Error("not read in this test"); };
  const DUE = [{ id: "c1", timeWindow: "4:00 PM", name: "Acme lunch", headcount: 20, isDelivery: true, stage: "confirmed" as const, source: "website" },
    { id: "c2", timeWindow: "5:00 PM", name: "Pickup co", headcount: 5, isDelivery: false, stage: "out" as const, source: null }];
  const deps = (cateringDelivery?: PulseDeps["cateringDelivery"]): PulseDeps => ({
    board: never, fridges: never, unlinkedClockIns: never, lastParPass: never, deliveries: never, cutoffs: never, sales: never, handoff: never, layout: never,
    reports: async () => ({ rows: [], closingDone: false, midDayDoneCount: 0 }), cateringToday: async () => DUE, cateringTomorrow: async () => ({ count: 0, firstWindow: null }),
    notRung: async () => [], priorAmPrep: async () => null, ...(cateringDelivery ? { cateringDelivery } : {}),
  });
  const FACT: DeliveryDayResult = { ok: true, leads: [dayLead("c1", { currentShopId: LOC, jobs: [openJob({ pickupShopId: LOC })] }),
    dayLead("c2", { currentShopId: LOC, orderQuote: { kind: "accepted", isDelivery: false } })] };
  const today = async (d: PulseDeps, a: AuthContext) => ((await loadPulseSection(d, ctx(a), "catering")) as { data: CateringData }).data.today;

  it("a key holder at the shop: the status DTO only (state, instant, status) on the rows that have one", async () => {
    const got = await today(deps(async () => FACT), auth("key_holder", 4));
    expect(got[0]!.delivery).toEqual({ state: "booked", at: "2026-11-18T15:40:00.000Z", status: "accepted" });
    expect("delivery" in got[1]!).toBe(false);
    expect(Object.keys(got[0]!.delivery!).sort()).toEqual(["at", "state", "status"]);
  });

  it.each([
    ["the social media manager", auth("social_media_mgr", 6)], ["a key holder who is not a member of the shop", auth("key_holder", 4, [])], ["an inactive key holder", auth("key_holder", 4, [LOC], false)],
  ])("%s: the delivery read is never started and the rows carry nothing", async (_n, a) => {
    const cateringDelivery = vi.fn(async () => FACT);
    // The section's own floor may refuse first; either way no delivery read.
    const got = await today(deps(cateringDelivery), a).catch(() => []);
    expect(cateringDelivery).not.toHaveBeenCalled();
    for (const r of got) expect("delivery" in r).toBe(false);
  });

  it("below key holder: crew get the section's redacted timing as before — the delivery read is never started, and no row carries a state", async () => {
    const cateringDelivery = vi.fn(async () => FACT);
    const r = (await loadPulseSection(deps(cateringDelivery), ctx(auth("employee", 3)), "catering")) as { state: string; data: CateringData };
    expect(r.state).toBe("ok");
    expect(r.data.redacted).toBe(true);
    expect(cateringDelivery).not.toHaveBeenCalled();
    for (const row of r.data.today) expect("delivery" in row).toBe(false);
    expect(JSON.stringify(r)).not.toContain("delivery");
  });

  it("a failed or rejected delivery read: 'unknown' on every row, never to book; the section itself still loads", async () => {
    for (const d of [async (): Promise<DeliveryDayResult> => ({ ok: false }), async (): Promise<DeliveryDayResult> => { throw new Error("down"); }]) {
      const got = await today(deps(d), auth("gm", 7));
      expect(got.map((r) => r.delivery)).toEqual([DELIVERY_UNKNOWN, DELIVERY_UNKNOWN]);
    }
  });

  it("off, or not wired: the rows are exactly the pre-D3 rows", async () => {
    const bare = await today(deps(), auth("gm", 7));
    expect(await today(deps(async () => ({ off: true })), auth("gm", 7))).toEqual(bare);
    for (const r of bare) expect(Object.keys(r)).toEqual(["id", "name", "timeWindow", "headcount", "isDelivery", "stage", "source"]);
  });

  it("the request memo and the shop cache carry the lane only when it is wired", () => {
    expect("cateringDelivery" in memoDeps(deps())).toBe(false);
    expect("cateringDelivery" in cachedPulseDeps(deps())).toBe(false);
    expect(typeof memoDeps(deps(async () => FACT)).cateringDelivery).toBe("function");
    expect(typeof cachedPulseDeps(deps(async () => FACT)).cateringDelivery).toBe("function");
  });
});

// ══ The day loader's REAL reads: the budget, and no money in the facts ══════
describe("the day loader's pinned read counts move by exactly the delivery lane's queries", () => {
  const LOC = "11111111-1111-4111-8111-111111111111";
  const KH = { ...ANA, userId: "33333333-3333-4333-8333-333333333333" };
  const CREW = { ...LUIS, userId: "44444444-4444-4444-8444-444444444444" };
  const NOW = at("13:45", PLAN_DATE);
  const count = async (v: DayViewer, world: World) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
    const f = fakeSupabase(worldResponder(world, shopDay), () => ({ data: PLAN_DATE }));
    const input = await loadDayFacts(f.client as never, { viewer: v, shop: { id: LOC, code: "P" }, now: NOW, locations: [LOC],
      board: async () => ({ stationDate: PLAN_DATE, locationId: LOC, date: PLAN_DATE, viewerId: v.userId, viewerLevel: v.level, stations: [], people: [], events: [], tasks: [] }) }, defaultDayFactDeps);
    vi.useRealTimers();
    const DELIVERY = ["delivery_settings", "delivery_job_current", "delivery_pickup_decisions"];
    return { input, n: f.calls.length + f.rpcs.length, delivery: f.calls.filter((c) => DELIVERY.includes(c.table)).map((c) => c.table).sort(), calls: f.calls };
  };
  // THE SAME DAY the off-equivalence golden counts (tests/fixtures/delivery/shop-day-reads.ts): one booked delivery lead
  // with an accepted quote. The pre-D3 budget on it is 34 queries for a key holder and 24 for crew (the golden's
  // `loader/real/KH/count` and `/CREW/count`, frozen from the unchanged base).
  const dayWorld = (over: Partial<World> = {}): World => ({ settings: [on(LOC)], leads: [leadRow("lead", { location_id: LOC, event_date: PLAN_DATE })], jobs: [], decisions: [],
    quotes: [quote("lead", "accepted")], ezcater: [], ...over });
  const PRE_D3 = { kh: 34, crew: 24 };

  it("off (the switch unset): 34 for a key holder, 24 for crew — the pre-D3 budget, not one query more", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const [kh, crew] = [await count(KH, dayWorld()), await count(CREW, dayWorld())];
    expect({ kh: kh.n, crew: crew.n }).toEqual(PRE_D3);
    expect(kh.delivery).toEqual([]);
  });

  it("on, the shop off (no settings row): 35 = 34 + 1 (the shop's own switch), and nothing after it", async () => {
    const kh = await count(KH, dayWorld({ settings: [] }));
    expect(kh.n).toBe(35);
    expect(kh.delivery).toEqual(["delivery_settings"]);
  });

  it("on, crew: the status gate refuses before any query — still 24", async () => {
    const crew = await count(CREW, dayWorld());
    expect(crew.n).toBe(PRE_D3.crew);
    expect(crew.delivery).toEqual([]);
  });

  it("on, the shop on, a key holder: 41 = 34 + 7 — the shop's switch, the open jobs, the day's leads, then the lead's jobs, quotes, ezCater rows and the shop re-check", async () => {
    // WHY THE COUNT MOVED (D3): the delivery lane (`deps.delivery` → loadDeliveryDay) is the ONLY new reader in the day
    // loader. With delivery on for the shop it sends exactly these 7 queries on this day (1 lead, no job: no decision
    // read), and the day's other 34 are untouched. Nothing else in the loader gained or lost a query.
    const kh = await count(KH, dayWorld());
    expect(kh.n).toBe(PRE_D3.kh + 7);
    expect(kh.delivery).toEqual(["delivery_job_current", "delivery_job_current", "delivery_settings"]);
    const added = kh.calls.map((c) => `${c.table}:${String(c.arg("select"))}`).filter((q) => [
      "delivery_settings:location_id,enabled", "delivery_job_current:id,pipeline_id", "catering_pipeline:id,location_id,stage,lead_source",
      "delivery_job_current:id,pipeline_id,location_id,attempt_no,closed_at,status,status_at,pickup_at", "catering_quotes:id,pipeline_id,status,is_delivery,created_at",
      "ezcater_orders:id,lead_id", "catering_pipeline:id,location_id"].includes(q));
    expect(added).toHaveLength(7);
    expect(new Set(added).size).toBe(7);
  });

  it("on, a day with no lead and nothing open: + 3 only (the switch, the open jobs, the day's leads)", async () => {
    const empty = dayWorld({ leads: [], quotes: [] });
    const quietOn = await count(KH, empty);
    vi.stubEnv("DELIVERY_TRACKING", "");
    const quietOff = await count(KH, empty);
    expect(quietOn.n - quietOff.n).toBe(3);
    expect(quietOn.delivery).toEqual(["delivery_job_current", "delivery_settings"]);
  });

  it("the same number of delivery queries at 3 leads and at 90 (no per-lead read)", async () => {
    const leads = (n: number) => dayWorld({ leads: Array.from({ length: n }, (_, i) => leadRow(`lead-${i}`, { location_id: LOC, event_date: PLAN_DATE })),
      jobs: Array.from({ length: n }, (_, i) => job(`lead-${i}`, 1, "accepted", { location_id: LOC })) });
    const [few, many] = [await count(KH, leads(3)), await count(KH, leads(90))];
    expect(many.n).toBe(few.n);
    expect(many.delivery).toEqual(few.delivery);
    expect(many.delivery).toEqual(["delivery_job_current", "delivery_job_current", "delivery_pickup_decisions", "delivery_settings"]);
  });

  it("the sentinel test, over the delivery fact: no money, name, address, courier, reference or note reaches the day's facts", async () => {
    const w = dayWorld({ leads: [leadRow("lead", { location_id: LOC, event_date: PLAN_DATE }), leadRow("gone", { location_id: LOC, stage: "lost", event_date: "2026-11-01" })],
      jobs: [job("lead", 1, "accepted", { location_id: LOC, pickup_at: "2026-11-18T19:00:00.000Z" }), job("gone", 1, "accepted", { location_id: LOC })],
      quotes: [quote("lead", "accepted"), quote("gone", "accepted")] });
    const { input, calls } = await count(KH, w);
    const textOf = JSON.stringify(input);
    for (const s of SENTINELS) expect(textOf).not.toContain(String(s));
    const f = input.facts as ShopFacts;
    expect(f.cateringToday.kind === "ok" && f.cateringToday.value.orders.find((o) => o.id === "lead")!.delivery).toEqual({ state: "booked", at: "2026-11-18T19:00:00.000Z", status: "accepted" });
    expect(f.deliveryAlerts).toEqual(ok({ forDate: PLAN_DATE, alerts: [{ leadId: "gone", state: "cancel_needed", at: null }] }));
    // The delivery lane's own reads name no such column (the reused booked-events reader keeps its projection, ruling B6).
    for (const c of calls.filter((x) => ["delivery_settings", "delivery_job_current", "delivery_pickup_decisions"].includes(x.table))) {
      expect(String(c.arg("select"))).not.toMatch(/\*|_cents|contact|company|address|provider|external|note/);
    }
  });
});

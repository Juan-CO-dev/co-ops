/**
 * Nav PR 8: the catering manager's block (plan r2 2.5, 7.1; lead rulings r1 A6, Q4, Q5; r2 B1).
 *
 * T-R5   The block only where `catering` is held: the catering manager with member surfaces gets it; without `catering`
 *        no block and no row; KH, GM and MoO never. (That the block item is not ALSO drawn as a row is pinned with the
 *        page wiring, tests/dashboard-blocks-payload.test.ts.)
 * T-R6   An untracked ezCater order is never "out" (group 16 fixtures): its own words, the untracked reason line,
 *        cancelled orders absent.
 * T-R10  The not-rung lines speak only for what is checked (A6) and only for the reconciliation LIST (B1): never
 *        "Every order is in Toast", in either language; the reader-to-render test with a `no_ring_expected` house order.
 * T-R11  The block carries the "Next up" badge when Next up is the block item; never under the aggregate failure.
 * T-G11  The heavy-day and flagged lines and the night-before line are drawn in the block.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { CateringBlock, notRungLines, orderStateText } from "@/components/dashboard/CateringBlock";
import type { InboxWaiting, NotRungScoped } from "@/lib/dashboard-blocks";
import { cateringBlockIndex, nextUpInBlock } from "@/lib/dashboard-blocks-shared";
import type { Settled } from "@/lib/dashboard-day";
import { planDay, type CateringOrder, type DayPlan, type DayViewer, type ShopFacts } from "@/lib/day-plan-shared";
import { readNotInToastScoped } from "@/lib/catering/not-in-toast";
import { renderDayReason } from "@/lib/day-plan-render";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { ANA, CATERING_MEMBER, CATERING_NON_MEMBER, GM, MOO, hm, iso, ok, order, PLAN_DATE, viewer, withFailed } from "./fixtures/day-plan/build";
import { pStreet, type PStreetOptions } from "./fixtures/day-plan/p-street";
import { text } from "./helpers/day-render";
import { ezRow, houseRow, notInToastClient, toastSettings } from "./helpers/not-in-toast-fake";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const SHOP = "shop-p";
const plan = (v: DayViewer, t: string, facts: ShopFacts, date = PLAN_DATE): DayPlan => {
  const p = planDay({ planDate: date, nowMin: hm(t), viewer: v, facts });
  if (p.kind !== "shop") throw new Error("shop plan expected");
  return p;
};
const okS = <T>(value: T): Settled<T> => ({ kind: "ok", value });
const EXTRAS = { inbox: okS<InboxWaiting>({ shop: 2, unplaced: 1 }), notRung: okS<NotRungScoped>({ count: 0, house: "on" }) };
function renderBlock(p: DayPlan, o: { extras?: typeof EXTRAS | null; language?: "en" | "es" } = {}): string {
  const i = cateringBlockIndex(p);
  if (i < 0) return "";
  return renderToStaticMarkup(createElement(CateringBlock, {
    item: p.items[i]!, block: p.cateringBlock!, heavyToday: p.heavyToday, headsUp: p.headsUp,
    extras: o.extras === undefined ? EXTRAS : o.extras, nextUp: nextUpInBlock(p), shopId: SHOP, language: o.language ?? "en",
  }));
}
const withOrders = (t: string, orders: CateringOrder[], opts: PStreetOptions = {}): ShopFacts => ({ ...pStreet(hm(t), opts), cateringToday: ok({ forDate: PLAN_DATE, orders }) });

describe("T-R5: the block only where catering is held", () => {
  it("the catering manager (member surfaces) gets the block, with the engine's one block item", () => {
    const p = plan(CATERING_MEMBER, "10:00", pStreet(hm("10:00")));
    expect(p.items.filter((i) => i.placement === "block")).toHaveLength(1);
    expect(renderBlock(p)).toContain("data-catering-block");
  });
  it("the non-member catering manager (tasks, catering, schedule) still gets it (the path to access PR 4)", () => {
    expect(renderBlock(plan(CATERING_NON_MEMBER, "10:00", pStreet(hm("10:00"))))).toContain("data-catering-block");
  });
  it("without catering: no block and no catering row", () => {
    const p = plan(viewer("catering_mgr", "u-x", new Set(["tasks", "schedule"])), "10:00", pStreet(hm("10:00")));
    expect(cateringBlockIndex(p)).toBe(-1);
    expect(p.items.some((i) => i.id === "catering_today")).toBe(false);
  });
  it("KH, GM and MoO: never a block", () => {
    for (const v of [ANA, GM, MOO]) {
      const p = plan(v, "10:00", pStreet(hm("10:00")));
      expect(cateringBlockIndex(p)).toBe(-1);
      expect(p.cateringBlock).toBeNull();
    }
  });
});

const tracked = (id: string, eventQ: number, headcount: number, outT: string | null = null) =>
  order({ id, eventQ, headcount, ...(outT ? { state: "out" as const, outAt: iso(PLAN_DATE, outT) } : {}) });
const untracked = (id: string, eventQ: number | null, headcount: number | null) => order({ id, source: "ezcater", eventQ, headcount, state: "not_tracked" });
const li = (html: string, state: string) => [...html.matchAll(new RegExp(`<li[^>]*data-order-state="${state}"[\\s\\S]*?</li>`, "g"))].map((m) => text(m[0]));

describe("T-R6: an untracked ezCater order is never out", () => {
  it.each([
    ["before its time", "11:00", [untracked("u1", 48, 40)]],
    ["after its time", "15:00", [untracked("u1", 48, 40)]],
    ["mixed with a tracked order that went out", "13:00", [tracked("t", 48, 25, "11:40"), untracked("u", 60, 20)]],
    ["all untracked", "16:00", [untracked("u", 60, 20), untracked("v", 52, 15)]],
  ] as const)("%s", (_n, t, orders) => {
    for (const lang of ["en", "es"] as const) {
      const html = renderBlock(plan(CATERING_MEMBER, t, withOrders(t, [...orders, order({ id: "gone", eventQ: 44, headcount: 99, state: "cancelled" })])), { language: lang });
      const L = lang === "en" ? EN : ES;
      const rows = li(html, "not_tracked");
      expect(rows.length).toBe(orders.filter((o) => o.state === "not_tracked").length);
      for (const r of rows) {
        expect(r).toContain(L["dashboard.catering_block.state.not_tracked"]);
        expect(r).not.toMatch(lang === "en" ? /\bOut\b/ : /Salió/);
      }
      expect(html.match(/data-order-state=/g)?.length).toBe(orders.length); // the cancelled order is absent
    }
  });
  it("orderStateText: not_tracked reaches no out key", () => {
    for (const lang of ["en", "es"] as const) {
      const L = lang === "en" ? EN : ES;
      const words = orderStateText({ state: "not_tracked", outAt: iso(PLAN_DATE, "12:00") }, lang);
      expect(words).toBe(L["dashboard.catering_block.state.not_tracked"]);
      expect(words).not.toContain(L["dashboard.catering_block.state.out_no_time"]!);
    }
  });
  it("the untracked reason line from the engine is in the block", () => {
    const html = renderBlock(plan(CATERING_MEMBER, "11:00", withOrders("11:00", [untracked("u1", 48, 40)])));
    expect(text(html)).toContain(EN["day.reason.catering.untracked_one"]);
  });
  it("today unknown: the unavailable line, no orders, no none", () => {
    const html = renderBlock(plan(CATERING_MEMBER, "11:00", withFailed(pStreet(hm("11:00")), ["cateringToday"])));
    expect(html).toContain('data-orders="unknown"');
    expect(text(html)).toContain(EN["day.reason.catering.unavailable"]);
    expect(text(html)).not.toContain(EN["day.reason.catering.none"]);
  });
});

describe("T-R10 (A6, B1): the not-rung lines", () => {
  it.each([
    [{ count: 0, house: "on" }, ["dashboard.catering_block.not_rung_none"]],
    [{ count: 0, house: "off" }, ["dashboard.catering_block.not_rung_none_ezcater", "dashboard.catering_block.house_not_checked"]],
    [{ count: 0, house: "not_installed" }, ["dashboard.catering_block.not_rung_none_ezcater", "dashboard.catering_block.house_not_checked"]],
    [{ count: 2, house: "off" }, ["dashboard.catering_block.not_rung_other", "dashboard.catering_block.house_not_checked"]],
    [{ count: 1, house: "on" }, ["dashboard.catering_block.not_rung_one"]],
  ] as const)("%j", (r, keys) => {
    expect(notRungLines(r)).toEqual(keys);
  });
  it("rendered: house off says ezCater only + not checked; a failure says Couldn't load, never a clear line", () => {
    const p = plan(CATERING_MEMBER, "10:00", pStreet(hm("10:00")));
    const off = text(renderBlock(p, { extras: { ...EXTRAS, notRung: okS<NotRungScoped>({ count: 0, house: "off" }) } }));
    expect(off).toContain(EN["dashboard.catering_block.not_rung_none_ezcater"]);
    expect(off).toContain(EN["dashboard.catering_block.house_not_checked"]);
    expect(off).not.toContain(EN["dashboard.catering_block.not_rung_none"]);
    for (const kind of ["failed", "timed_out"] as const) {
      const html = renderBlock(p, { extras: { ...EXTRAS, notRung: { kind } } });
      expect(html).toContain('data-not-rung="failed"');
      for (const k of ["not_rung_none", "not_rung_none_ezcater", "house_not_checked"]) expect(text(html)).not.toContain(EN[`dashboard.catering_block.${k}`]);
    }
    const rows = renderBlock(p, { extras: { ...EXTRAS, notRung: okS<NotRungScoped>({ count: 2, house: "on" }) } });
    expect(rows).toContain('href="/catering/pipeline"');
    expect(text(rows)).toContain(EN["dashboard.catering_block.not_rung_other"]!.replace("{n}", "2"));
  });
  it("B1, reader to render: house on, ezCater clear, one no_ring_expected house order with no Toast link: the scoped wording", async () => {
    const f = notInToastClient({ ezcater_reconciliation_status: [ezRow({ status: "rung" })], catering_toast_settings: [toastSettings()],
      catering_reconciliation_status: [houseRow({ lead_id: "exempt", status: "no_ring_expected", ring_code: null })] });
    const r = await readNotInToastScoped(f.client, "shop", { through: PLAN_DATE });
    const scoped: NotRungScoped = { count: r.rows.length, house: r.house };
    expect(scoped).toEqual({ count: 0, house: "on" });
    for (const lang of ["en", "es"] as const) {
      const L = lang === "en" ? EN : ES;
      const html = text(renderBlock(plan(CATERING_MEMBER, "10:00", pStreet(hm("10:00"))), { extras: { ...EXTRAS, notRung: okS(scoped) }, language: lang }));
      expect(html).toContain(L["dashboard.catering_block.not_rung_none"]);
      expect(html).not.toMatch(/Every order is in Toast|Todos los pedidos están en Toast/i);
    }
  });
  it("B1: the universal wording appears in neither locale's keys", () => {
    for (const d of [EN, ES]) {
      const values = Object.values(d);
      expect(values.filter((v) => /every order is in toast/i.test(v))).toEqual([]);
      expect(values.filter((v) => /todos los pedidos están en toast/i.test(v))).toEqual([]);
    }
    expect(EN["dashboard.catering_block.not_rung_none"]).toBe("No orders are waiting to be rung in Toast.");
    expect(EN["dashboard.catering_block.not_rung_none_ezcater"]).toBe("No ezCater orders are waiting to be rung in Toast.");
  });
});

describe("the inbox line", () => {
  it("shop count, unplaced on its own line, none only when both are 0, failure named", () => {
    const p = plan(CATERING_MEMBER, "10:00", pStreet(hm("10:00")));
    const both = text(renderBlock(p));
    expect(both).toContain(EN["dashboard.catering_block.inbox_other"]!.replace("{n}", "2"));
    expect(both).toContain(EN["dashboard.catering_block.inbox_unplaced"]!.replace("{n}", "1"));
    expect(both).not.toContain(EN["dashboard.catering_block.inbox_none"]);
    expect(text(renderBlock(p, { extras: { ...EXTRAS, inbox: okS({ shop: 0, unplaced: 0 }) } }))).toContain(EN["dashboard.catering_block.inbox_none"]);
    expect(text(renderBlock(p, { extras: { ...EXTRAS, inbox: okS({ shop: 0, unplaced: 3 }) } }))).not.toContain(EN["dashboard.catering_block.inbox_none"]);
    const failed = text(renderBlock(p, { extras: { ...EXTRAS, inbox: { kind: "failed" } } }));
    expect(failed).toContain(EN["dashboard.needs_you.unavailable"]!.replace("{name}", EN["catering.inbox.title"]!));
    expect(failed).not.toContain(EN["dashboard.catering_block.inbox_none"]);
  });
  it("no money, no names, no order numbers in the block", () => {
    const html = renderBlock(plan(CATERING_MEMBER, "10:00", pStreet(hm("10:00"), { heavy: true })));
    expect(html).not.toMatch(/\$\d/);
  });
});

describe("T-R11 (Q4): the Next up badge", () => {
  const times = ["06:00", "08:00", "09:00", "10:00", "11:00", "11:35", "12:30", "14:00", "16:00", "20:30"];
  it("shown exactly when Next up is the block item", () => {
    let seen = false;
    for (const t of times) {
      for (const opts of [{}, { heavy: true }] as PStreetOptions[]) {
        const p = plan(CATERING_MEMBER, t, pStreet(hm(t), opts));
        const html = renderBlock(p);
        const onBlock = p.nextUp.kind === "item" && p.items[p.nextUp.index]!.placement === "block";
        seen ||= onBlock;
        expect(html.includes("data-next-up-badge"), `${t} ${JSON.stringify(opts)}`).toBe(onBlock);
      }
    }
    expect(seen).toBe(true);
  });
  it("under day.fail.all: no badge", () => {
    const facts = withFailed(pStreet(hm("11:35")), ["hours", "stations", "opening", "closing", "amPrep", "midDay", "cash", "pm", "ordering", "rhythm", "receiving",
      "cateringToday", "cateringTomorrow", "flaggedLines", "yesterdayClosing"]);
    const p = plan(CATERING_MEMBER, "11:35", facts);
    expect(nextUpInBlock(p)).toBe(false);
    expect(renderBlock(p)).not.toContain("data-next-up-badge");
  });
});

describe("T-G11 (group 11): the heavy-day lines in the block", () => {
  it("the heavy fixture: heavyToday.heavy (5:30 AM start) and the flagged line", () => {
    const p = plan(CATERING_MEMBER, "06:00", pStreet(hm("06:00"), { heavy: true, opening: true }));
    const html = renderBlock(p);
    expect(html).toContain('data-heavy-line="day.reason.heavy.today"');
    expect(html).toContain('data-heavy-line="day.reason.heavy.flagged_other"');
    expect(text(html)).toContain("5:30");
  });
  it("20:30 the night before: the block draws the night-before line", () => {
    const p = plan(CATERING_MEMBER, "20:30", pStreet(hm("20:30"), { nightBefore: true }), "2026-11-17");
    expect(p.headsUp).not.toBeNull();
    expect(renderBlock(p)).toContain(`data-heavy-line="${p.headsUp!.key}"`);
  });
});

describe("T-G11 (Q5): PhaseLine leaves the night-before line out only when told", () => {
  it("omitHeadsUp drops it; without it (a key holder, or no block) it stays; with headsUp null nothing changes", async () => {
    const { PhaseLine } = await import("@/components/dashboard/PhaseLine");
    const p = plan(CATERING_MEMBER, "20:30", pStreet(hm("20:30"), { nightBefore: true }), "2026-11-17");
    const line = renderDayReasonText(p);
    expect(renderToStaticMarkup(createElement(PhaseLine, { plan: p, language: "en" }))).toContain(line);
    expect(renderToStaticMarkup(createElement(PhaseLine, { plan: p, language: "en", omitHeadsUp: true }))).not.toContain(line);
    const kh = plan(ANA, "20:30", pStreet(hm("20:30"), { nightBefore: true }), "2026-11-17");
    expect(renderToStaticMarkup(createElement(PhaseLine, { plan: kh, language: "en" }))).toContain(line);
    const quiet = plan(CATERING_MEMBER, "13:00", pStreet(hm("13:00")));
    expect(quiet.headsUp).toBeNull();
    expect(renderToStaticMarkup(createElement(PhaseLine, { plan: quiet, language: "en", omitHeadsUp: true })))
      .toBe(renderToStaticMarkup(createElement(PhaseLine, { plan: quiet, language: "en" })));
  });
});
function renderDayReasonText(p: DayPlan): string {
  return renderDayReason(p.headsUp!, "en").replace(/&/g, "&amp;");
}

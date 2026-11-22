/**
 * Nav PR 8, T-E4 (plan r2 2.3, declared amendment E4 to PR 5's engine): the catering block's plan and `heavyToday`.
 *
 * - `cateringBlock` is null for every viewer except a catering manager holding `catering` (the lens's `block` item).
 * - `heavyToday` is computed once and gated like `headsUp`; its `flagged` is null when `flaggedLines` failed.
 * - Opening's reasons and the catering row (band, at, reasons), per viewer, are byte-identical to the pre-E4 engine over a
 *   sweep of the heavy and catering fixtures (golden frozen from the unchanged code: `tests/fixtures/day-plan/e4-golden.json`,
 *   one sha-256 of the full JSON per case).
 * - The block's `today` sorts untimed last (the row's own order does not); `next` is the earliest OPEN timed order;
 *   `tomorrow` is "unknown" when its fact failed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDay, cateringOrderRows, planDay, type DayPlan, type DayViewer, type ShopFacts } from "@/lib/day-plan-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import {
  ALL_VIEWERS, ANA, CATERING_MEMBER, CATERING_NON_MEMBER, GM, MOO, failed, hm, iso, ok, order, PLAN_DATE, reasonText, viewer, withFailed,
} from "./fixtures/day-plan/build";
import { pStreet, type PStreetOptions } from "./fixtures/day-plan/p-street";

const plan = (v: DayViewer, min: number, facts: ShopFacts, date = PLAN_DATE): DayPlan => {
  const p = planDay({ planDate: date, nowMin: min, viewer: v, facts });
  if (p.kind !== "shop") throw new Error("expected a shop plan");
  return p;
};

// ── The golden: Opening and the catering row, frozen from the pre-E4 engine ──
const GOLDEN = resolve(__dirname, "fixtures/day-plan/e4-golden.json");
const TIMES = ["05:00", "05:45", "06:00", "07:00", "08:00", "08:30", "08:55", "09:10", "10:00", "11:30", "11:45", "12:10", "13:00", "15:30", "20:30", "23:00"];
const OPTS: Record<string, PStreetOptions> = {
  normal: {}, heavy: { heavy: true }, heavyOpening: { heavy: true, opening: true }, nightBefore: { nightBefore: true },
  nightBeforeOpening: { nightBefore: true, opening: true },
  heavyUnknownStart: { heavy: true, dayStarts: { [PLAN_DATE]: { kind: "unknown" } } },
};
const VARIANTS: Record<string, (f: ShopFacts) => ShopFacts> = {
  asIs: (f) => f,
  flaggedFailed: (f) => withFailed(f, ["flaggedLines"]),
  cateringFailed: (f) => withFailed(f, ["cateringToday"]),
  untimed: (f) => ({ ...f, cateringToday: ok({ forDate: PLAN_DATE, orders: [
    order({ id: "u1", source: "ezcater", eventQ: null, headcount: 60, state: "not_tracked" }),
    order({ id: "t1", eventQ: 44, headcount: 10 }),
    order({ id: "c1", eventQ: 40, headcount: 200, state: "cancelled" }),
  ] }) }),
};
function snapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [on, o] of Object.entries(OPTS)) {
    for (const [vn, vf] of Object.entries(VARIANTS)) {
      for (const t of TIMES) {
        const date = o.nightBefore ? "2026-11-17" : PLAN_DATE;
        const facts = vf(pStreet(hm(t), o));
        const d = buildDay(date, hm(t), facts);
        const pick = (items: readonly { id: string; band: string; at: number | null; reasons: readonly unknown[] }[], id: string) => {
          const i = items.find((x) => x.id === id);
          return i ? { band: i.band, at: i.at, reasons: i.reasons } : null;
        };
        const perViewer: Record<string, unknown> = {};
        for (const [name, v] of Object.entries(ALL_VIEWERS)) {
          const p = plan(v, hm(t), facts, date);
          perViewer[name] = { opening: pick(p.items, "opening"), catering: pick(p.items, "catering_today"), headsUp: p.headsUp };
        }
        const full = JSON.stringify({ opening: pick(d.items, "opening"), catering: pick(d.items, "catering_today"), headsUp: d.headsUp, perViewer });
        // One sha-256 per case over the FULL JSON (every key and parameter): exact, and small enough to keep in the repo.
        out[`${on}/${vn}/${t}`] = createHash("sha256").update(full).digest("hex");
      }
    }
  }
  return out;
}

describe("E4 parity: Opening and the catering row are byte-identical to the pre-E4 engine", () => {
  it("matches the golden frozen from the unchanged code", () => {
    const now = JSON.parse(JSON.stringify(snapshot())) as Record<string, unknown>;
    if (process.env.WRITE_E4_GOLDEN === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
      if (process.env.WRITE_E4_GOLDEN !== "1") throw new Error("golden was missing: written; re-run");
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
    expect(Object.keys(now).length).toBe(Object.keys(golden).length);
    expect(now).toEqual(golden);
  });
});

describe("heavyToday (E4, A7)", () => {
  it("is the heavy line and the flagged line, the same reasons Opening carries, in the same order", () => {
    const d = buildDay(PLAN_DATE, hm("06:00"), pStreet(hm("06:00"), { heavy: true, opening: true }));
    expect(d.heavyToday).not.toBeNull();
    expect(reasonText(d.heavyToday!.heavy)).toBe("heavy.today{guests=145,time=09:00,start=05:30}");
    expect(reasonText(d.heavyToday!.flagged)).toBe("heavy.flagged_other{n=4}");
    const opening = d.items.find((i) => i.id === "opening")!;
    expect(opening.reasons.slice(1)).toEqual([d.heavyToday!.heavy, d.heavyToday!.flagged]);
  });

  it("flagged is null when flaggedLines failed; null on a normal day", () => {
    const f = withFailed(pStreet(hm("06:00"), { heavy: true }), ["flaggedLines"]);
    const d = buildDay(PLAN_DATE, hm("06:00"), f);
    expect(d.heavyToday!.flagged).toBeNull();
    expect(buildDay(PLAN_DATE, hm("06:00"), pStreet(hm("06:00"))).heavyToday).toBeNull();
  });

  it("is gated like headsUp: KH+ holding catering only", () => {
    const f = pStreet(hm("06:00"), { heavy: true });
    for (const [name, v] of Object.entries(ALL_VIEWERS)) {
      const p = plan(v, hm("06:00"), f);
      const expected = v.level >= 4 && v.surfaces.has("catering");
      expect(p.heavyToday !== null, name).toBe(expected);
    }
    const noCatering = viewer("key_holder", "u-x", new Set(["tasks", "ops"]));
    expect(plan(noCatering, hm("06:00"), f).heavyToday).toBeNull();
  });
});

describe("cateringBlock (E4)", () => {
  it("is null for every viewer except a catering manager holding catering", () => {
    const f = pStreet(hm("10:00"), { heavy: true });
    for (const [name, v] of Object.entries(ALL_VIEWERS)) {
      const p = plan(v, hm("10:00"), f);
      const isBlock = v.role === "catering_mgr";
      expect(p.cateringBlock !== null, name).toBe(isBlock);
      const cat = p.items.find((i) => i.id === "catering_today");
      if (isBlock) expect(cat?.placement).toBe("block");
      else if (cat) expect(cat.placement).toBe("list");
    }
    // A catering manager without the catering surface: no item, no block.
    const noSurface = viewer("catering_mgr", "u-cat-y", new Set(["tasks", "schedule"]));
    const p = plan(noSurface, hm("10:00"), f);
    expect(p.cateringBlock).toBeNull();
    expect(p.items.some((i) => i.id === "catering_today")).toBe(false);
    // The non-member catering manager (surfaces tasks, catering, schedule) still gets the block (the path to access PR 4).
    expect(plan(CATERING_NON_MEMBER, hm("10:00"), f).cateringBlock).not.toBeNull();
    for (const v of [ANA, GM, MOO]) expect(plan(v, hm("10:00"), f).cateringBlock).toBeNull();
  });

  it("today: the block sorts untimed last while the row's own order puts the untimed order by its default window end", () => {
    const orders = [
      order({ id: "late", eventQ: 60, headcount: 10 }),
      order({ id: "untimed", eventQ: null, headcount: 12 }), // default window [34, 52): time = 13:00
      order({ id: "early", eventQ: 40, headcount: 8, state: "out", outAt: iso(PLAN_DATE, "09:40") }),
      order({ id: "gone", eventQ: 44, headcount: 99, state: "cancelled" }),
      order({ id: "ez", source: "ezcater", eventQ: 50, headcount: 20, state: "not_tracked" }),
    ];
    const f: ShopFacts = { ...pStreet(hm("11:00")), cateringToday: ok({ forDate: PLAN_DATE, orders }) };
    const rows = cateringOrderRows(orders.filter((o) => o.state !== "cancelled"), SCHEDULE_STRUCTURE_DEFAULTS.catering, hm("11:00"));
    expect(rows.map((r) => r.o.id)).toEqual(["early", "ez", "untimed", "late"]);
    const p = plan(CATERING_MEMBER, hm("11:00"), f);
    const today = p.cateringBlock!.today;
    expect(today).not.toBe("unknown");
    if (today === "unknown") return;
    expect(today.map((o) => o.id)).toEqual(["early", "ez", "late", "untimed"]);
    expect(today.find((o) => o.id === "gone")).toBeUndefined();
    expect(today.find((o) => o.id === "early")).toMatchObject({ state: "out", outAt: iso(PLAN_DATE, "09:40"), open: false, guests: 8 });
    expect(today.find((o) => o.id === "ez")).toMatchObject({ state: "not_tracked", open: true });
    expect(p.cateringBlock!.untracked).toBe(1);
    // next = the earliest OPEN timed order: "early" is out, so 12:30 (the ezCater order, open until its time).
    expect(p.cateringBlock!.next).toEqual({ atMin: hm("12:30") });
    expect(buildDay(PLAN_DATE, hm("13:00"), f).cateringBlock.next).toEqual({ atMin: hm("15:00") });
  });

  it("today is unknown when the fact failed or is for another day; tomorrow is unknown when its fact failed", () => {
    const base = pStreet(hm("10:00"));
    expect(buildDay(PLAN_DATE, hm("10:00"), withFailed(base, ["cateringToday"])).cateringBlock).toMatchObject({ today: "unknown", next: null });
    const other: ShopFacts = { ...base, cateringToday: ok({ forDate: "2026-11-17", orders: [] }) };
    expect(buildDay(PLAN_DATE, hm("10:00"), other).cateringBlock.today).toBe("unknown");
    expect(buildDay(PLAN_DATE, hm("10:00"), { ...base, cateringTomorrow: failed() }).cateringBlock.tomorrow).toBe("unknown");
    expect(buildDay("2026-11-17", hm("20:30"), pStreet(hm("20:30"), { nightBefore: true })).cateringBlock.tomorrow)
      .toEqual({ heavy: true, guests: 145, orders: 2, missingCounts: 0 });
  });

  it("under day.fail.all the catering manager's block is unknown today and tomorrow", () => {
    const allFailed = withFailed(pStreet(hm("10:00")), ["hours", "stations", "opening", "closing", "amPrep", "midDay", "cash", "pm",
      "ordering", "rhythm", "receiving", "cateringToday", "cateringTomorrow", "flaggedLines", "yesterdayClosing"]);
    const p = plan(CATERING_MEMBER, hm("10:00"), allFailed);
    expect(p.notes.map((n) => n.reason.key)).toContain("day.fail.all");
    expect(p.cateringBlock).toMatchObject({ today: "unknown", tomorrow: "unknown" });
    // SmmFacts handed to a catering manager: the all-failed shop, same answer.
    const wrong = planDay({ planDate: PLAN_DATE, nowMin: hm("10:00"), viewer: CATERING_MEMBER,
      facts: { kind: "smm", ownTasks: failed(), ownStation: failed() } });
    expect(wrong.kind === "shop" && wrong.cateringBlock).toMatchObject({ today: "unknown", tomorrow: "unknown" });
  });

  it("an untracked order is never an out state in the block (group 16)", () => {
    for (const t of ["11:00", "12:30", "15:00"]) {
      const f: ShopFacts = { ...pStreet(hm(t)), cateringToday: ok({ forDate: PLAN_DATE, orders: [
        order({ id: "ez", source: "ezcater", eventQ: 48, headcount: 40, state: "not_tracked" }),
      ] }) };
      const today = plan(CATERING_MEMBER, hm(t), f).cateringBlock!.today;
      expect(today !== "unknown" && today.map((o) => o.state)).toEqual(["not_tracked"]);
    }
  });
});

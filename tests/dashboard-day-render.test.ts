/**
 * Nav PR 7 (plan r2 T1, T6, T7 component half, T10 render half, T20 render half): the Dashboard's day section rendered
 * from REAL engine plans (PR 5's fixtures), in English and Spanish. The renderer draws the engine's order and nothing else.
 */
import { describe, expect, it } from "vitest";
import { itemHref } from "@/lib/dashboard-day-shared";
import { planDay, type DayItem, type DayPlan, type ShopFacts } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import { taskHref } from "@/lib/assignments-shared";
import {
  ALL_VIEWERS, ANA, CATERING_MEMBER, CATERING_NON_MEMBER, FACT_FIELDS, forViewer, GM, hm, item, LUIS, MOO, PLAN_DATE, withFailed,
} from "./fixtures/day-plan/build";
import { capitolHill } from "./fixtures/day-plan/capitol-hill";
import { P_SHOP, P_STATION_BY_USER, pStreet, pStreetPlan, TIMELINE } from "./fixtures/day-plan/p-street";
import { D, D1, earlyNextDay } from "./fixtures/day-plan/plan-date";
import { renderDay, rows, text } from "./helpers/day-render";

const SHOP = P_SHOP.id;
const LANGS = ["en", "es"] as const;
const plan = (v: typeof ANA, t: string, facts: ShopFacts = pStreet(hm(t)), planDate = PLAN_DATE): DayPlan =>
  planDay({ planDate, nowMin: hm(t), viewer: v, facts: forViewer(facts, P_STATION_BY_USER, v.userId) }) as DayPlan;
const phaseText = (p: DayPlan, lang: "en" | "es") =>
  [serverT(lang, `day.phase.${p.phase.id}`), ...(p.phase.heavy ? [serverT(lang, "day.phase.heavy_suffix")] : []),
    ...(p.phase.since ? [renderDayReason(p.phase.since, lang)] : [])].join(" · ");
const rowOf = (html: string, id: DayItem["id"]) => {
  const r = rows(html).find((x) => x.id === id);
  if (!r) throw new Error(`no ${id} row`);
  return r;
};

describe("T1: P Street at six times, for Ana (KH), the GM and Luis (crew)", () => {
  const TIMES = ["07:00", "11:30", "13:35", "13:45", "15:45", "20:30"];
  for (const [label, v] of [["Ana", ANA], ["GM", GM], ["Luis", LUIS]] as const) {
    for (const t of TIMES) {
      for (const lang of LANGS) {
        it(`${label} ${t} ${lang}: the engine's rows in order, each once; the phase line; every reason rendered`, () => {
          const p = plan(v, t);
          const html = renderDay(p, { shopId: SHOP, language: lang });
          // (a) DOM order = plan.items, each once (full pin first, Next up next, compact pin second, done, then tools).
          expect(rows(html).map((r) => r.id)).toEqual(p.items.map((i) => i.id));
          // Done rows sit under "Done today", tools under "Audit tools".
          const done = p.items.filter((i) => i.band === "done");
          if (done.length > 0) expect(text(html)).toContain(serverT(lang, "dashboard.day.done_heading"));
          if (p.items.some((i) => i.band === "tool")) expect(html.indexOf(serverT(lang, "dashboard.day.tools_heading"))).toBeLessThan(html.indexOf('data-day-item="counts"'));
          // (b) the phase line.
          expect(text(html)).toContain(phaseText(p, lang));
          // (c) every reason, through renderDayReason, on its own row.
          for (const i of p.items) for (const r of i.reasons) expect(rowOf(html, i.id).text).toContain(text(renderDayReason(r, lang)));
          // Every row's name opens its page.
          for (const i of p.items) expect(rowOf(html, i.id).links[0]!.href).toBe(itemHref(i, SHOP));
        });
      }
    }
  }

  it("(d) the GM and Ana: Luis holds Mid-day prep (name linked, no buttons); Nobody yet has Do it → the task and Assign → Team today", () => {
    for (const v of [ANA, GM]) {
      for (const t of ["11:30", "13:45", "15:45"]) {
        const html = renderDay(plan(v, t), { shopId: SHOP, language: "en" });
        const mid = rowOf(html, "mid_day_prep");
        expect(mid.text).toContain("Luis has it.");
        expect(mid.links.map((l) => l.href)).toEqual([taskHref("mid_day_prep", SHOP)]);
        expect(mid.links.some((l) => l.action)).toBe(false);
        const ordering = rowOf(html, "ordering");
        expect(ordering.text).toContain("Nobody yet");
        expect(ordering.links.find((l) => l.action === "do")!.href).toBe(taskHref("ordering", SHOP));
        expect(ordering.links.find((l) => l.action === "assign")!.href).toBe("/assignments?location=shop-p");
        expect(ordering.links.find((l) => l.action === "do")!.aria).toBe("Do it: Ordering");
      }
    }
    // Ana's own: "Yours" with Do it, never Assign.
    const cash = rowOf(renderDay(plan(ANA, "20:30"), { shopId: SHOP, language: "en" }), "cash");
    expect(cash.text).toContain("Yours");
    expect(cash.links.filter((l) => l.action).map((l) => l.action)).toEqual(["do"]);
  });

  it("(e) Luis: his station card, the closing pin and his Mid-day prep only; no other person's name", () => {
    for (const t of TIMES) {
      const html = renderDay(plan(LUIS, t), { shopId: SHOP, language: "en" });
      expect(rows(html).map((r) => r.id).sort()).toEqual(["closing", "mid_day_prep", "station"]);
      expect(rowOf(html, "station").text).toContain("My station: Walk Ins Station");
      expect(rowOf(html, "station").links[0]!.href).toBe("/operations/closing?location=shop-p#closing-station-Walk%20Ins%20Station");
      for (const other of ["Ana has it", "Rosa", "Nobody yet", "Assign"]) expect(text(html), `${t} ${other}`).not.toContain(other);
    }
  });

  it("the station card in Spanish is titled by the station's Spanish name", () => {
    const rosa = { ...LUIS, userId: "u-rosa" };
    expect(rowOf(renderDay(plan(rosa, "11:30"), { shopId: SHOP, language: "es" }), "station").text).toContain("Estación Crunchy Boi");
  });

  it("1:35 PM (C1): Mid-day by the clock, Crunchy Boi past due; full pin first with the past-due line for Ana and the GM, not Luis", () => {
    for (const v of [ANA, GM]) {
      const p = plan(v, "13:35");
      const html = renderDay(p, { shopId: SHOP, language: "en" });
      expect(text(html)).toContain("Mid-day · Crunchy Boi Station usually closes by 1:30 PM");
      const r = rows(html);
      expect(r[0]).toMatchObject({ id: "closing", variant: "full" });
      expect(r[0]!.text).toContain("1 station is past its usual close: Crunchy Boi Station.");
      expect(rowOf(html, "ordering").band).toBe("urgent");
      expect(rowOf(html, "mid_day_prep").band).toBe("now");
    }
    const luis = renderDay(plan(LUIS, "13:35"), { shopId: SHOP, language: "en" });
    expect(rows(luis)[0]).toMatchObject({ id: "closing", variant: "full" });
    expect(text(luis)).not.toContain("past its usual close");
  });

  it("parity (groups 2, 9): every viewer, 05:00-23:00 hourly: the rendered rows are exactly plan.items", () => {
    for (const v of Object.values(ALL_VIEWERS)) {
      for (let h = 5; h <= 23; h++) {
        const p = plan(v, `${String(h).padStart(2, "0")}:00`);
        expect(rows(renderDay(p, { shopId: SHOP, language: "en" })).map((r) => r.id), `${v.userId} ${h}`).toEqual(p.items.map((i) => i.id));
      }
    }
  });

  it("heavy (F5): 05:45 with the earlier opening: Opening check · heavy · since 5:30 AM; Opening first with the heavy lines; 08:30 urgent", () => {
    const early = pStreetPlan(ANA, hm("05:45"), { heavy: true, opening: true });
    const html = renderDay(early, { shopId: SHOP, language: "en" });
    expect(text(html)).toContain("Opening check · heavy catering day · since prep start at 5:30 AM");
    expect(rows(html)[0]!.id).toBe("opening");
    const opening = rowOf(html, "opening").text;
    expect(opening).toContain("Heavy catering day: 145 guests");
    expect(opening).toContain("4 catering prep lines are flagged on Prep demand");
    const late = renderDay(pStreetPlan(ANA, hm("08:30"), { heavy: true, opening: true }), { shopId: SHOP, language: "en" });
    expect(rowOf(late, "opening").band).toBe("urgent");
    expect(rowOf(late, "opening").text).toContain("The first catering order goes out at 9:00 AM and opening is not finished.");
    // Control: heaviness alone (no earlier opening) keeps 05:45 before opening.
    expect(text(renderDay(pStreetPlan(ANA, hm("05:45"), { heavy: true }), { shopId: SHOP, language: "en" }))).toContain("Before opening");
  });
});

describe("T6: midnight, on the group-15 fixture (tests/fixtures/day-plan/plan-date.ts)", () => {
  const dLabel = formatDateLabel(D, "en");
  const alertLink = `/operations/closing?location=${SHOP}&date=${D}`;
  const ctaLinks = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

  it("23:59 on D: Night, plan date D, no alert", () => {
    const p = plan(ANA, "23:59", pStreet(hm("23:59"), { timeline: { ...TIMELINE, closingFinished: null } }), D);
    const html = renderDay(p, { shopId: SHOP, language: "en" });
    expect(p.planDate).toBe(D);
    expect(text(html)).toContain("Night");
    expect(html).not.toContain('role="alert"');
  });

  it("00:30 on D+1, stations another_day(D), yesterday open: Before opening, no station line or note; Ana and a holding closer get the alert", () => {
    const facts = earlyNextDay("00:30", "open", { kind: "another_day", stationDate: D });
    const p = plan(ANA, "00:30", facts, D1);
    const html = renderDay(p, { shopId: SHOP, language: "en" });
    expect(text(html)).toContain("Before opening");
    expect(html).not.toContain("data-note");
    expect(text(html)).toContain("Yesterday's closing at P was not confirmed.");
    expect(text(html)).toContain(dLabel);
    expect(ctaLinks(html)).toContain(alertLink);
    expect(renderDay(plan(LUIS, "00:30", earlyNextDay("00:30", "open", { kind: "another_day", stationDate: D }, true), D1), { shopId: SHOP, language: "en" })).toContain('role="alert"');
    expect(renderDay(plan(LUIS, "00:30", earlyNextDay("00:30", "open", { kind: "another_day", stationDate: D }, false), D1), { shopId: SHOP, language: "en" })).not.toContain('role="alert"');
  });

  it("00:30 with yesterday confirmed: no alert", () => {
    const today = pStreet(hm("00:30"), { planDate: D1 });
    const p = plan(ANA, "00:30", { ...today, yesterdayClosing: earlyNextDay("00:30", "confirmed", today.stations).yesterdayClosing }, D1);
    expect(p.stations.length).toBeGreaterThan(0);
    expect(renderDay(p, { shopId: SHOP, language: "en" })).not.toContain('role="alert"');
  });

  it("01:00, yesterday still open: today's station facts (none closed) AND the alert for Ana; Luis without a station none; confirmed none", () => {
    const open = (holds: boolean) => ({ ...pStreet(hm("01:00"), { planDate: D1 }), ...pick(earlyNextDay("01:00", "open", { kind: "failed" }, holds)) });
    const pick = (f: ShopFacts) => ({ yesterdayClosing: f.yesterdayClosing, holdsStationOnStationDay: f.holdsStationOnStationDay });
    const p = plan(ANA, "01:00", open(false), D1);
    expect(p.stations.length).toBeGreaterThan(0);
    expect(p.stations.every((s) => s.close === null)).toBe(true);
    const html = renderDay(p, { shopId: SHOP, language: "en" });
    expect(html).toContain('role="alert"');
    expect(ctaLinks(html)).toContain(alertLink);
    const noStation = { ...LUIS, userId: "u-nobody" };
    expect(renderDay(plan(noStation, "01:00", open(false), D1), { shopId: SHOP, language: "en" })).not.toContain('role="alert"');
    const confirmed = { ...pStreet(hm("01:00"), { planDate: D1 }), ...pick(earlyNextDay("01:00", "confirmed", { kind: "failed" })) };
    expect(renderDay(plan(ANA, "01:00", confirmed, D1), { shopId: SHOP, language: "en" })).not.toContain('role="alert"');
  });

  it("dates: no row link carries date=, no D date label outside the alert; every non-station fact is for D+1, yesterday's closing for D", () => {
    for (const t of ["00:30", "01:00"]) {
      const facts = earlyNextDay(t, "open", { kind: "another_day", stationDate: D });
      const html = renderDay(plan(ANA, t, facts, D1), { shopId: SHOP, language: "en" });
      for (const r of rows(html)) {
        for (const l of r.links) expect(l.href, `${t} ${r.id}`).not.toContain("date=");
        expect(r.text).not.toContain(dLabel);
      }
      const dated = [facts.opening, facts.closing, facts.amPrep, facts.midDay, facts.cash, facts.pm, facts.ordering, facts.receiving, facts.cateringToday, facts.assignments];
      for (const f of dated) expect(f.kind === "ok" && "forDate" in f.value ? f.value.forDate : null).toBe(D1);
      expect(facts.yesterdayClosing.kind === "ok" && facts.yesterdayClosing.value.forDate).toBe(D);
    }
  });
});

describe("T7: one fact failed (the outputs it affects, and nothing else), rendered from the real engine", () => {
  // From tests/day-plan-could-not-load.test.ts: the rows each failed fact may change (by id). Every other row's item is
  // unchanged, and renders byte-identical when it keeps its place in the list.
  const HOLDER = ["opening", "mid_day_prep", "am_prep", "cash", "pm_report", "ordering", "receiving"] as const;
  // "phase" in that test's lists: the rows whose band follows the phase (Night makes AM prep, cash, PM "now"; ordering's
  // tonight line) move with it.
  const PHASE = ["am_prep", "cash", "pm_report", "ordering"] as const;
  const AFFECTED: Record<(typeof FACT_FIELDS)[number], readonly DayItem["id"][]> = {
    hours: ["opening", ...PHASE],
    stations: ["closing", "mid_day_prep", "station", ...PHASE],
    opening: ["opening", ...PHASE],
    closing: ["closing", ...PHASE],
    amPrep: ["am_prep"], midDay: ["mid_day_prep"], cash: ["cash"], pm: ["pm_report"], ordering: ["ordering"], receiving: ["receiving"],
    rhythm: ["ordering", "receiving"],
    cateringToday: ["catering_today", "opening"],
    cateringTomorrow: ["am_prep"],
    flaggedLines: ["opening", "am_prep"],
    assignments: [...HOLDER],
    myStation: ["station"],
    yesterdayClosing: [],
    counts: ["counts"],
  };
  const NOTE: Partial<Record<(typeof FACT_FIELDS)[number], string>> = {
    hours: "day.fail.shop_day", stations: "day.fail.stations", myStation: "day.fail.own_station",
  };
  for (const field of FACT_FIELDS) {
    it(`${field}`, () => {
      for (const v of [ANA, LUIS]) {
        for (const t of ["07:00", "13:45", "20:30"]) {
          const baseFacts = forViewer(pStreet(hm(t)), P_STATION_BY_USER, v.userId);
          const base = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: baseFacts }) as DayPlan;
          const failed = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: withFailed(baseFacts, [field]) }) as DayPlan;
          const baseHtml = renderDay(base, { shopId: SHOP, language: "en" });
          const html = renderDay(failed, { shopId: SHOP, language: "en" });
          // (a) faithful: the failed render is the failed plan's rows, in order.
          expect(rows(html).map((r) => r.id), `${v.userId} ${t}`).toEqual(failed.items.map((i) => i.id));
          // (b) the listed outputs.
          if (NOTE[field]) expect(html, `${field} note`).toContain(`data-note="${NOTE[field]}"`);
          for (const i of failed.items) if (i.state === "unknown") expect(rowOf(html, i.id).text).toContain("Couldn't load right now");
          // (c) every row not in the affected set: the same item, and (in the same place) byte-identical.
          const baseRows = rows(baseHtml);
          for (const i of failed.items) {
            if (AFFECTED[field].includes(i.id)) continue;
            const b = base.items.find((x) => x.id === i.id);
            expect(i, `${field} ${v.userId} ${t} ${i.id}`).toEqual(b);
            const r = rowOf(html, i.id);
            const br = baseRows.find((x) => x.id === i.id);
            if (br && br.variant === r.variant) expect(r.html, `${field} ${v.userId} ${t} ${i.id}`).toBe(br.html);
          }
          for (const b of base.items) if (!AFFECTED[field].includes(b.id)) expect(failed.items.some((i) => i.id === b.id), `${field} kept ${b.id}`).toBe(true);
        }
      }
    });
  }

  it("specific outputs: closing failed is never Closed; assignments failed: KH holders unknown, crew get the closing, the card and the note", () => {
    const closing = plan(ANA, "22:00", withFailed(pStreet(hm("22:00")), ["closing"]));
    expect(text(renderDay(closing, { shopId: SHOP, language: "en" }))).not.toContain("Closed for the day");
    const kh = renderDay(plan(ANA, "13:45", withFailed(pStreet(hm("13:45")), ["assignments"])), { shopId: SHOP, language: "en" });
    expect(rowOf(kh, "ordering").text).toContain("Couldn't load who has it.");
    expect(kh).not.toContain("Nobody yet");
    expect(kh).not.toContain('data-action="assign"');
    const crewFacts = withFailed(forViewer(pStreet(hm("13:45")), P_STATION_BY_USER, LUIS.userId), ["assignments"]);
    const crew = renderDay(planDay({ planDate: PLAN_DATE, nowMin: hm("13:45"), viewer: LUIS, facts: crewFacts }) as DayPlan, { shopId: SHOP, language: "en" });
    expect(rows(crew).map((r) => r.id).sort()).toEqual(["closing", "station"]);
    expect(crew).toContain('data-note="day.fail.assignments"');
  });

  it("F2: every fact failed: day.fail.all, rows in DAY_ORDER, every state unknown; no phase line, no Next up, no empty claim", () => {
    for (const v of [ANA, LUIS, GM]) {
      for (const t of ["07:00", "13:45", "20:30"]) {
        const facts = withFailed(pStreet(hm(t)), [...FACT_FIELDS]);
        const p = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts }) as DayPlan;
        for (const lang of LANGS) {
          const html = renderDay(p, { shopId: SHOP, language: lang });
          expect(html).toContain('data-note="day.fail.all"');
          expect(html).not.toContain("data-phase");
          expect(html).not.toContain("data-next-up");
          expect(text(html)).not.toContain(serverT(lang, "dashboard.day.next_up"));
          for (const k of ["dashboard.day.nothing_due_none", "day.next.closed"] as const) expect(text(html)).not.toContain(serverT(lang, k));
          expect(text(html)).not.toContain(serverT(lang, "day.next.nothing_due").split("{")[0]!.trim());
          for (const r of rows(html)) if (r.id !== "closing" && r.id !== "station") expect(r.text, `${v.userId} ${r.id}`).toContain(serverT(lang, "dashboard.tile.unavailable"));
          expect(rows(html).map((r) => r.id)).toEqual(p.items.map((i) => i.id));
          expect(rows(html).some((r) => r.variant === "next")).toBe(false);
        }
      }
    }
  });
});

describe("T10 (render half): surfaces", () => {
  it("CATERING_NON_MEMBER at 13:45: the four checklist tasks and catering; who has it is not shown; no Nobody yet, Assign or Team today link", () => {
    // As the loader fills it for a viewer without ops here: no board, so assignments and stations are not shown.
    const facts: ShopFacts = { ...pStreet(hm("13:45")), assignments: { kind: "not_shown" }, stations: { kind: "not_shown" } };
    const html = renderDay(plan(CATERING_NON_MEMBER, "13:45", facts), { shopId: SHOP, language: "en" });
    const ids = rows(html).map((r) => r.id);
    expect(ids.sort()).toEqual(["am_prep", "catering_today", "closing", "mid_day_prep", "opening"].sort());
    expect(text(html)).toContain("Who has it is not shown here.");
    expect(text(html)).not.toContain("Nobody yet");
    expect(html).not.toContain('data-action="assign"');
    expect(html).not.toContain("/assignments");
    expect(html).toContain('data-note="day.note.stations_not_shown"');
  });

  it("CATERING_MEMBER: the AGM list, the catering item drawn as a row (Q9); MoO: everything at both fixture shops", () => {
    const p = plan(CATERING_MEMBER, "13:45");
    expect(item(p, "catering_today").placement).toBe("block");
    expect(rows(renderDay(p, { shopId: SHOP, language: "en" })).map((r) => r.id)).toContain("catering_today");
    const agmIds = plan({ ...CATERING_MEMBER, role: "agm" }, "13:45").items.map((i) => i.id).sort();
    expect(p.items.map((i) => i.id).sort()).toEqual(agmIds);
    for (const facts of [pStreet(hm("13:45")), capitolHill(hm("13:45"))]) {
      const m = plan(MOO, "13:45", facts);
      expect(rows(renderDay(m, { shopId: facts.shop.id, language: "en" })).map((r) => r.id)).toEqual(m.items.map((i) => i.id));
      expect(m.items.map((i) => i.id)).toEqual(expect.arrayContaining(["opening", "mid_day_prep", "ordering", "receiving", "am_prep", "cash", "pm_report", "closing", "counts"]));
    }
  });
});

describe("T20 (render half): the AM prep submitter's Edit (Q2 carve-out, C.46 A2)", () => {
  const amDone = (t: string) => ({ ...pStreet(hm(t)), amPrep: { kind: "ok" as const, value: { forDate: PLAN_DATE, status: "confirmed", phase1At: null,
    finishedAt: `${PLAN_DATE}T23:00:00.000Z`, finishedByName: "Ana", sectionsLeft: null, finishedById: "u-ana" } } });
  const EDIT = "/operations/am-prep?location=shop-p&edit=true";
  it("the submitter (the page passes editHref) sees Edit on the done AM prep row, to the page whose own gate decides", () => {
    const html = renderDay(plan(ANA, "20:30", amDone("20:30")), { shopId: SHOP, language: "en", editHref: EDIT });
    const am = rowOf(html, "am_prep");
    const edit = am.links.find((l) => l.action === "edit")!;
    expect(edit.href).toBe(EDIT);
    expect(edit.text).toBe("Edit");
    expect(edit.aria).toBe(`Edit your ${serverT("en", "am_prep.page.title")}`);
    expect(rowOf(renderDay(plan(ANA, "20:30", amDone("20:30")), { shopId: SHOP, language: "es", editHref: EDIT }), "am_prep").links.find((l) => l.action === "edit")!.text).toBe("Editar");
  });
  it("someone else (no editHref, KH included), a row not done, and only the AM prep row: no Edit", () => {
    expect(renderDay(plan(GM, "20:30", amDone("20:30")), { shopId: SHOP, language: "en" })).not.toContain('data-action="edit"');
    const notDone = renderDay(plan(ANA, "20:30"), { shopId: SHOP, language: "en", editHref: EDIT });
    expect(notDone).not.toContain('data-action="edit"');
    const html = renderDay(plan(ANA, "20:30", amDone("20:30")), { shopId: SHOP, language: "en", editHref: EDIT });
    expect([...html.matchAll(/data-action="edit"/g)]).toHaveLength(1);
  });
});

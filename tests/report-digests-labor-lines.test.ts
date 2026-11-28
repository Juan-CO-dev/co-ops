/**
 * Digests round 3, PR 4: the labor-money LINES F1–F5 (plan §3.3 / §3.6 / §3.7 as amended by §11.2), en + es, HTML and
 * text. Every state of the contract's types prints its exact sentence; an unknown is never a 0, a $0.00 or a 0%; the
 * tones; the order of the Labor section; the targets; the cap; and the figure census (the compose file prints only
 * through `figureText`, the view formats nothing).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import { composeShopSections, renderShopDigest, type DigestLine, type DigestSection } from "@/lib/report-digests-compose";
import { laborMoneyLines, laborNotConnectedLine, type LaborMoneyLines } from "@/lib/report-digests-labor-compose";
import type { HourlyLaborFacts, LaborMoneyStore, RoleLaborFacts } from "@/lib/report-digests-labor-shared";
import { laborSectionWithMoney, translator } from "@/lib/report-digests-v2-compose";
import { failed, ok as loaded, unavailable, type ShopV2Facts } from "@/lib/report-digests-v2-shared";
import { cutLines, finishSection } from "@/lib/report-digests-layout-shared";
import type { DigestCapability } from "@/lib/report-digests-access-shared";
import { A, B, BASE, D, D1, fullDay, labor, schedule, SHOP_A, shopFacts, tomorrowDay } from "./fixtures/digest-staffing";
import {
  businessOf, dayFigures, hourlyFacts, LAST_FROM, LAST_TO, LATEST, laborStore, ok, overTargetDay, rangeFigures, recipient, roleFacts, UNAVAILABLE, UPDATING, WEEK_START,
} from "./fixtures/digest-labor";

const LANGS = ["en", "es"] as const;
const ctx = (language: Language) => ({ language, baseUrl: BASE, locationId: A, day: D });
const lines = (language: Language, h: HourlyLaborFacts | null, r: RoleLaborFacts | null = roleFacts()): LaborMoneyLines =>
  laborMoneyLines(ctx(language), laborStore(h, r))!;
const w = (language: Language) => ({
  na: serverT(language, "digest.labor_money.not_available"),
  rolesNa: serverT(language, "digest.labor_money.roles_not_available"),
  updating: serverT(language, "digest.labor_money.updating"),
  weekUpdating: serverT(language, "digest.labor_money.week_updating"),
  noFinal: serverT(language, "digest.labor_money.no_final_day"),
  noFinalWeek: serverT(language, "digest.labor_money.no_final_day_this_week"),
  loaded: serverT(language, "reports.business.card.fully_loaded"),
  latest: serverT(language, "digest.labor_money.latest_label_plain"),
  week: serverT(language, "digest.labor_money.week_so_far_label_plain"),
  last: serverT(language, "digest.labor_money.last_week_label_plain"),
  roles: serverT(language, "digest.labor_money.roles_label_plain"),
});
/** No digit at all: a failure sentence carries no number (never a 0, $0.00 or 0%). */
const NO_DIGIT = /^[^0-9]*$/;

describe("F1–F5 in every state: the exact sentence, the needs, never a zero for an unknown", () => {
  for (const language of LANGS) {
    const x = w(language);
    it(`not a labor-money run: no line at all (${language})`, () => {
      expect(laborMoneyLines(ctx(language), undefined)).toBeNull();
      expect(laborMoneyLines(ctx(language), null)).toBeNull();
    });

    it(`no hourly entry: ONE line per capability, and F5's own sentence (${language})`, () => {
      const m = lines(language, null);
      expect(m.f1).toMatchObject({ text: x.na, needs: "labor_hourly", unknown: true, tone: "info" });
      expect(m.f2).toBeNull();
      expect(m.f3).toBeNull();
      expect(m.f4).toMatchObject({ label: x.loaded, text: x.na, needs: "labor_loaded", unknown: true, tone: "info" });
      expect(m.f5).toMatchObject({ label: x.roles, text: x.rolesNa, needs: "labor_cost_by_role", unknown: true });
      for (const l of [m.f1, m.f4, m.f5!]) expect(l.text).toMatch(NO_DIGIT);
    });

    it(`healthy facts: each line names its dates and prints only figures (${language})`, () => {
      const m = lines(language, hourlyFacts());
      const date = (d: string) => formatDateLabel(d, language);
      expect(m.f1.label).toBe(serverT(language, "digest.labor_money.latest_label", { date: date(LATEST) }));
      expect(m.f2!.label).toBe(serverT(language, "digest.labor_money.week_so_far_label", { from: date(WEEK_START), to: date(LATEST) }));
      expect(m.f3!.label).toBe(serverT(language, "digest.labor_money.last_week_label", { from: date(LAST_FROM), to: date(LAST_TO) }));
      expect(m.f5!.label).toBe(serverT(language, "digest.labor_money.roles_label", { date: date(LATEST) }));
      expect(m.f1.text).toContain("$180.00");
      expect(m.f1.text).toContain(serverT(language, "digest.labor_money.pct_of_net", { pct: "18%", target: serverT(language, "reports.business.target", { pct: 18 }) }));
      expect(m.f2!.text).toContain(serverT(language, "digest.labor_money.hours", { hours: "30 h" }));
      expect(m.f2!.text).toContain("$540.00");
      expect(m.f4.text).toContain("$257.60");
      expect(m.f4.text).toContain(serverT(language, "reports.business.qual.burden_estimated"));
      const other = serverT(language, "digest.labor_money.role_other"), pool = serverT(language, "digest.labor_money.role_pool");
      expect(m.f5!.text).toBe(`Line $90.00, Prep $60.00, ${other} $20.00, ${pool} $10.00`);
      for (const l of [m.f1, m.f2!, m.f3!, m.f4, m.f5!]) expect(l.unknown, l.label).toBeUndefined();
      expect([m.f1, m.f2!, m.f3!].map((l) => l.needs)).toEqual(["labor_hourly", "labor_hourly", "labor_hourly"]);
      expect(m.f4.needs).toBe("labor_loaded");
      expect(m.f5!.needs).toBe("labor_cost_by_role");
    });

    it(`each of F1 / F2 / F3 is judged from its OWN part (${language})`, () => {
      const base = lines(language, hourlyFacts());
      for (const [part, sentenceOf] of [["unavailable", x.na], ["updating", x.updating]] as const) {
        const p = part === "unavailable" ? UNAVAILABLE : UPDATING;
        const a = lines(language, hourlyFacts({ latestFinalDay: p }));
        expect(a.f1).toMatchObject({ label: x.latest, text: sentenceOf, unknown: true });
        expect([a.f2, a.f3]).toEqual([base.f2, base.f3]);
        // F5 stands on F1's day: a day part not available = "Cost by role not available"; a day part UPDATING has no
        // F5 line at all (Opus R-2, plan §11.2.2).
        if (part === "unavailable") expect(a.f5).toMatchObject({ text: x.rolesNa, unknown: true });
        else expect(a.f5).toBeNull();
        const b = lines(language, hourlyFacts({ weekSoFar: p }));
        expect(b.f2).toMatchObject({ label: x.week, text: part === "updating" ? x.weekUpdating : x.na, unknown: true });
        expect([b.f1, b.f3, b.f4, b.f5]).toEqual([base.f1, base.f3, base.f4, base.f5]);
        const c = lines(language, hourlyFacts({ lastFullWeek: p }));
        expect(c.f3).toMatchObject({ label: x.last, text: sentenceOf, unknown: true });
        expect([c.f1, c.f2, c.f5]).toEqual([base.f1, base.f2, base.f5]);
        for (const l of [a.f1, b.f2!, c.f3!]) expect(l.text).toMatch(NO_DIGIT);
      }
    });

    it(`none / no final day this week (${language})`, () => {
      const m = lines(language, hourlyFacts({ latestFinalDay: { kind: "none" }, weekSoFar: { kind: "no_final_day_this_week" } }));
      expect(m.f1).toMatchObject({ label: x.latest, text: x.noFinal, unknown: true, tone: "info" });
      // "No final day this week yet" is information, not an unknown.
      expect(m.f2).toMatchObject({ label: x.week, text: x.noFinalWeek, tone: "info" });
      expect(m.f2!.unknown).toBeUndefined();
      expect(m.f4.text).toContain(x.noFinal);
      expect(m.f4.unknown).toBe(true);
      // Opus R-2: no final day = no F5 line.
      expect(m.f5).toBeNull();
    });

    it(`Opus R-2: F5 for every day state × role state (${language})`, () => {
      const DAY_STATES = [["ok", hourlyFacts().latestFinalDay], ["unavailable", UNAVAILABLE], ["updating", UPDATING], ["none", { kind: "none" } as const]] as const;
      const ROLE_STATES: Array<[string, RoleLaborFacts | null]> = [["ok", roleFacts()], ["omitted", { kind: "omitted" }], ["unavailable", { kind: "unavailable" }], ["absent", null]];
      for (const [dayState, dayPart] of DAY_STATES) {
        for (const [roleState, r] of ROLE_STATES) {
          const f5 = lines(language, hourlyFacts({ latestFinalDay: dayPart }), r).f5;
          const name = `${dayState} × ${roleState}`;
          if (dayState === "updating" || dayState === "none") expect(f5, name).toBeNull();
          else if (dayState === "unavailable") expect(f5, name).toMatchObject({ text: x.rolesNa, unknown: true, needs: "labor_cost_by_role" });
          else if (roleState === "omitted") expect(f5, name).toBeNull();
          else if (roleState === "ok") expect(f5, name).toMatchObject({ needs: "labor_cost_by_role", label: serverT(language, "digest.labor_money.roles_label", { date: formatDateLabel(LATEST, language) }) });
          else expect(f5, name).toMatchObject({ text: x.rolesNa, unknown: true, needs: "labor_cost_by_role" });
        }
      }
      // No hourly entry at all keeps "Cost by role not available".
      for (const [, r] of ROLE_STATES) expect(lines(language, null, r).f5).toMatchObject({ text: x.rolesNa, unknown: true });
    });

    it(`Opus R-1: a day part "updating" renders "Labor figures are updating", never "No final labor day" (${language})`, () => {
      const r = recipient("owner", [], { kind: "gm_shop", shops: [A] }, businessOf("owner"));
      const mail = renderShopDigest(shopFacts(SHOP_A, { labor: loaded(labor()) }), { language, baseUrl: BASE, viewer: r.viewer, access: r.access,
        laborMoney: laborStore(hourlyFacts({ latestFinalDay: UPDATING }), roleFacts()) });
      for (const out of [mail.text, mail.html]) {
        expect(out).toContain(x.updating);
        expect(out).not.toContain(x.noFinal);
      }
      const m = lines(language, hourlyFacts({ latestFinalDay: UPDATING }));
      expect(m.f1).toMatchObject({ label: x.latest, text: x.updating, unknown: true });
    });

    it(`F4: a part that is not ok is said with its own sentence; both missing = one "not available" (${language})`, () => {
      const day = lines(language, hourlyFacts({ latestFinalDay: UPDATING }));
      expect(day.f4.text).toContain(serverT(language, "digest.labor_money.part", { what: x.latest, sentence: x.updating }));
      expect(day.f4.text).toContain("25.8%");
      expect(day.f4.unknown).toBe(true);
      const both = lines(language, hourlyFacts({ latestFinalDay: UNAVAILABLE, lastFullWeek: UNAVAILABLE }));
      expect(both.f4).toMatchObject({ label: x.loaded, text: x.na, unknown: true });
    });

    it(`F4: a missing salary is the pricer's dash WITH its reason; payroll gaps named (${language})`, () => {
      const m = lines(language, hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({ salaried_cents: null, salary_basis: "unknown" })) }));
      expect(m.f4.text).toContain(`— (${serverT(language, "reports.business.labor.state.salary_unknown")})`);
      expect(m.f4.unknown).toBe(true);
      const gaps = lines(language, hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({ salaried_cents: null, salary_basis: "incomplete", salary_unplaced_people: 2 })) }));
      expect(gaps.f4.text).toContain(serverT(language, "reports.business.qual.salary_gaps", { n: 2 }));
      // F1 (pure hourly) is untouched by a salary.
      expect(m.f1).toEqual(lines(language, hourlyFacts()).f1);
    });

    it(`a figure that is not whole: "so far", a dash with its reason, the line unknown, never 0% (${language})`, () => {
      const open = lines(language, hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({ open_punches: 1 })) }));
      expect(open.f1.text).toContain(serverT(language, "reports.business.hours_so_far", { h: "$180.00" }));
      expect(open.f1.text).toContain(`— ${serverT(language, "digest.labor_money.pct_of_net", { pct: "", target: "" }).split(" ")[1]}`);
      expect(open.f1.text).toContain(serverT(language, "reports.business.labor.state.hours_unknown"));
      expect(open.f1.text).not.toMatch(/(^|\s)0(\.0)?%/);
      expect(open.f1.unknown).toBe(true);
      const noSales = lines(language, hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({}, { captured: false })) }));
      expect(noSales.f1.text).toContain(serverT(language, "reports.business.labor.state.sales_not_covered"));
      expect(noSales.f1.text).not.toMatch(/(^|\s)0(\.0)?%/);
      expect(noSales.f1.unknown).toBe(true);
    });

    it(`qualifiers come from the figures (wage estimated, Toast hours) in the report's own words (${language})`, () => {
      const m = lines(language, hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({ estimated_rate_minutes: 60, days_fallback: 1 })) }));
      expect(m.f1.text).toContain(serverT(language, "reports.business.qual.wage_estimated"));
      expect(m.f1.text).toContain(serverT(language, "reports.business.qual.hours_unverified"));
    });

    it(`F5 in every state (${language})`, () => {
      expect(lines(language, hourlyFacts(), { kind: "omitted" }).f5).toBeNull();
      for (const r of [{ kind: "unavailable" } as const, null]) expect(lines(language, hourlyFacts(), r).f5).toMatchObject({ text: x.rolesNa, unknown: true, needs: "labor_cost_by_role" });
      // A role entry about another day than F1's: not the same rows, withheld.
      expect(lines(language, hourlyFacts(), roleFacts({ date: "2026-10-05" })).f5).toMatchObject({ text: x.rolesNa });
      const notes = lines(language, hourlyFacts(), roleFacts({ roundedSeparately: true, wageEstimated: true })).f5!;
      expect(notes.text).toContain(`(${serverT(language, "digest.labor_money.roles_rounded")}; ${serverT(language, "reports.business.qual.wage_estimated")})`);
      expect(lines(language, hourlyFacts(), roleFacts({ roundedSeparately: true })).f5!.text).not.toContain(serverT(language, "reports.business.qual.wage_estimated"));
      // The role facts hold no person: the line names roles only.
      expect(notes.text).not.toMatch(/Person/);
    });
  }
});

describe("Opus R-2: a holder's Labor section on an updating night has no F5 line and one fewer unknown", () => {
  const r = recipient("owner", [], { kind: "gm_shop", shops: [A] }, businessOf("owner"));
  const f = shopFacts(SHOP_A, { labor: loaded(labor()) });
  const title = serverT("en", "digest.v2.section.labor");
  const section = (store: LaborMoneyStore) => composeShopSections(f, "en", BASE, false, r.viewer, r.access, store).find((s) => s.title === title)!;
  it("updating: no F5, and one unknown fewer than the same night with the day part unavailable", () => {
    const upd = section(laborStore(hourlyFacts({ latestFinalDay: UPDATING }), { kind: "unavailable" }));
    const na = section(laborStore(hourlyFacts({ latestFinalDay: UNAVAILABLE }), { kind: "unavailable" }));
    const rolesNa = serverT("en", "digest.labor_money.roles_not_available");
    const texts = (s: DigestSection) => s.lines.map((l) => `${l.label} ${l.text}`).join("\n");
    expect(texts(upd)).not.toContain(rolesNa);
    expect(texts(na)).toContain(rolesNa);
    expect(upd.status!.unknowns).toBe(na.status!.unknowns - 1);
  });
});

describe("Fable F8: an undefined figure never prints a bare dash", () => {
  it("a view missing a money figure says the part's own not-available sentence and the line is unknown", async () => {
    vi.resetModules();
    vi.doMock("@/lib/report-digests-labor-view", async (orig) => {
      const real = await orig<typeof import("@/lib/report-digests-labor-view")>();
      return {
        ...real,
        laborMoneyView: (h: HourlyLaborFacts | null, r: RoleLaborFacts | null) => {
          const v = real.laborMoneyView(h, r);
          for (const p of [v.hourly?.latestFinalDay, v.hourly?.weekSoFar, v.hourly?.lastFullWeek]) {
            if (p?.kind === "ok") { delete p.span.labor.pureCost; delete p.span.labor.purePct; delete p.span.labor.loadedCost; delete p.span.labor.loadedPct; }
          }
          return v;
        },
      };
    });
    try {
      const mod = await import("@/lib/report-digests-labor-compose");
      const i18n = await import("@/lib/i18n/server");
      const m = mod.laborMoneyLines(ctx("en"), laborStore(hourlyFacts(), roleFacts()))!;
      const na = i18n.serverT("en", "digest.labor_money.not_available");
      for (const l of [m.f1, m.f2!, m.f3!, m.f4]) {
        expect(l.text, l.label).not.toMatch(/(^|\s|·)—(\s|·|$)/);
        expect(l.text, l.label).toContain(na);
        expect(l.unknown, l.label).toBe(true);
      }
    } finally {
      vi.doUnmock("@/lib/report-digests-labor-view");
      vi.resetModules();
    }
  });
});

describe("tones: over target is an issue on F1 / F3 only; weeks that differ print no tone", () => {
  it("F1 over target → issue; F3 over target → issue; F2 / F4 / F5 never", () => {
    const over = rangeFigures(LAST_FROM, LAST_TO, { hourly_straight_cents: 25_000 * 7 });
    const m = lines("en", hourlyFacts({
      latestFinalDay: overTargetDay(), lastFullWeek: ok(LAST_FROM, LAST_TO, over),
      weekSoFar: ok(WEEK_START, LATEST, rangeFigures(WEEK_START, LATEST, { hourly_straight_cents: 40_000 * 3 })),
    }));
    expect(m.f1.tone).toBe("issue");
    expect(m.f3!.tone).toBe("issue");
    expect(m.f2!.tone).toBe("info");
    expect(m.f4.tone).toBe("info");
    expect(m.f5!.tone).toBe("info");
  });
  it("a target that varies prints no tone, never an issue, and says so", () => {
    const m = lines("en", hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({ hourly_straight_cents: 40_000 }), "target_varies") }));
    expect(m.f1.tone).toBe("info");
    expect(m.f1.text).toContain(serverT("en", "reports.business.target_varies"));
  });
  it("the section status counts the over-target issue (and the preheader with it)", () => {
    const r = recipient("owner", [], { kind: "gm_shop", shops: [A] }, businessOf("owner"));
    const f = shopFacts(SHOP_A, { labor: loaded(labor()) });
    const title = serverT("en", "digest.v2.section.labor");
    const status = (store: LaborMoneyStore) => composeShopSections(f, "en", BASE, false, r.viewer, r.access, store).find((s) => s.title === title)!.status!;
    expect(status(laborStore(hourlyFacts(), roleFacts())).issues).toBe(0);
    expect(status(laborStore(hourlyFacts({ latestFinalDay: overTargetDay() }), roleFacts())).issues).toBe(1);
    const a = renderShopDigest(f, { language: "en", baseUrl: BASE, viewer: r.viewer, access: r.access, laborMoney: laborStore(hourlyFacts(), roleFacts()) });
    const b = renderShopDigest(f, { language: "en", baseUrl: BASE, viewer: r.viewer, access: r.access, laborMoney: laborStore(hourlyFacts({ latestFinalDay: overTargetDay() }), roleFacts()) });
    expect(b.html).not.toBe(a.html);
    expect(b.text).toContain(`! ${serverT("en", "digest.labor_money.latest_label", { date: formatDateLabel(LATEST, "en") })}`);
  });
});

describe("targets: a structure's own targets print; the loaded target has its own", () => {
  it("hourly target 22, loaded target 30", () => {
    const m = lines("en", hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({}, {}, 22, 30), 22, 30) }));
    expect(m.f1.text).toContain("(Target 22%)");
    expect(m.f4.text).toContain("(Target at most 30%)");
    // The last full week keeps its own (28).
    expect(m.f4.text).toContain("(Target at most 28%)");
  });
  it("es: the report's own words", () => {
    const m = lines("es", hourlyFacts({ latestFinalDay: ok(LATEST, LATEST, dayFigures({}, {}, 22, 30), 22, 30) }));
    expect(m.f1.text).toContain(`(${serverT("es", "reports.business.target", { pct: 22 })})`);
    expect(m.f4.text).toContain(`(${serverT("es", "reports.business.target_le", { pct: 30 })})`);
  });
});

// ── Order of the Labor section ─────────────────────────────────────────────────────────────────

const c = (language: Language = "en") => ({ t: translator(language), language, baseUrl: BASE, locationId: A, day: D });
const fullV = (over: Partial<ShopV2Facts> = {}) => shopFacts(SHOP_A, { labor: loaded(labor({ weekOvertimeAssessed: true })), ...over }, schedule(fullDay(D), tomorrowDay(D1, 1))).v2!;

describe("the order inside the Labor section (plan §3.7 as amended)", () => {
  for (const language of LANGS) {
    const t = translator(language);
    const store = laborStore(hourlyFacts(), roleFacts());
    const m = laborMoneyLines(ctx(language), store)!;
    it(`every line present: status · F1 · scheduled vs worked · F2 · hours by job · who worked · overtime · F3 · F4 · F5 (${language})`, () => {
      const got = laborSectionWithMoney(c(language), fullV(), store).map((l) => l.label);
      expect(got).toEqual([
        t("digest.v2.labor.label"), m.f1.label, t("digest.staffing.vs_label"), m.f2!.label, t("digest.v2.labor.by_job_label"),
        t("digest.v2.labor.people_label"), t("digest.v2.labor.overtime_label"), m.f3!.label, m.f4.label, m.f5!.label,
      ]);
    });
    it(`Toast labor absent / failed / no schedule: the same list with the missing ones removed (${language})`, () => {
      const noLabor = laborSectionWithMoney(c(language), { ...fullV(), labor: undefined }, store).map((l) => l.label);
      expect(noLabor).toEqual([m.f1.label, t("digest.staffing.vs_label"), m.f2!.label, m.f3!.label, m.f4.label, m.f5!.label]);
      const failedPull = laborSectionWithMoney(c(language), { ...fullV(), labor: failed() }, store);
      expect(failedPull.map((l) => l.label)).toEqual([t("digest.v2.labor.label"), m.f1.label, t("digest.staffing.vs_label"), m.f2!.label, m.f3!.label, m.f4.label, m.f5!.label]);
      const noSchedule = shopFacts(SHOP_A, { labor: loaded(labor()) }).v2!;
      expect(laborSectionWithMoney(c(language), noSchedule, store).map((l) => l.label)).toEqual([
        t("digest.v2.labor.label"), m.f1.label, m.f2!.label, t("digest.v2.labor.by_job_label"), t("digest.v2.labor.people_label"), t("digest.v2.labor.overtime_label"),
        m.f3!.label, m.f4.label, m.f5!.label]);
      const nobody = shopFacts(SHOP_A, { labor: loaded(labor({ people: [], totalHours: 0, byJob: [] })) }).v2!;
      expect(laborSectionWithMoney(c(language), nobody, store).map((l) => l.label)).toEqual([t("digest.v2.labor.label"), m.f1.label, m.f2!.label, m.f3!.label, m.f4.label, m.f5!.label]);
    });
    it(`the existing lines keep their text and relative order; the money lines do not depend on D's Toast state (${language})`, () => {
      const variants: ShopV2Facts[] = [fullV(), { ...fullV(), labor: undefined }, { ...fullV(), labor: failed() }, { ...fullV(), labor: unavailable("no_labor") }];
      for (const v of variants) {
        const withMoney = laborSectionWithMoney(c(language), v, store);
        const without = laborSectionWithMoney(c(language), v, undefined);
        const money = new Set<DigestLine>([m.f1, m.f2!, m.f3!, m.f4, m.f5!].map((l) => withMoney.find((x) => x.label === l.label)!));
        expect(withMoney.filter((l) => !money.has(l))).toEqual(without);
        expect([...money]).toEqual([m.f1, m.f2, m.f3, m.f4, m.f5]);
      }
    });
  }
  for (const language of LANGS) {
    it(`GLM part 4 F-1: the exact order for {Toast labor present / absent} × {schedule for D loaded / not}, every money line present (${language})`, () => {
      const t = translator(language);
      const store = laborStore(hourlyFacts(), roleFacts());
      const m = laborMoneyLines(ctx(language), store)!;
      const withLabor = loaded(labor({ weekOvertimeAssessed: true }));
      const sched = schedule(fullDay(D), tomorrowDay(D1, 1));
      const CASES: Array<[string, ShopV2Facts, string[]]> = [
        ["labor + schedule", shopFacts(SHOP_A, { labor: withLabor }, sched).v2!, [
          t("digest.v2.labor.label"), m.f1.label, t("digest.staffing.vs_label"), m.f2!.label, t("digest.v2.labor.by_job_label"),
          t("digest.v2.labor.people_label"), t("digest.v2.labor.overtime_label"), m.f3!.label, m.f4.label, m.f5!.label]],
        ["labor, no schedule", shopFacts(SHOP_A, { labor: withLabor }).v2!, [
          t("digest.v2.labor.label"), m.f1.label, m.f2!.label, t("digest.v2.labor.by_job_label"),
          t("digest.v2.labor.people_label"), t("digest.v2.labor.overtime_label"), m.f3!.label, m.f4.label, m.f5!.label]],
        ["no labor + schedule", { ...shopFacts(SHOP_A, {}, sched).v2!, labor: undefined }, [
          m.f1.label, t("digest.staffing.vs_label"), m.f2!.label, m.f3!.label, m.f4.label, m.f5!.label]],
        ["no labor, no schedule", { ...shopFacts(SHOP_A, {}).v2!, labor: undefined }, [
          m.f1.label, m.f2!.label, m.f3!.label, m.f4.label, m.f5!.label]],
      ];
      for (const [name, v, want] of CASES) {
        const got = laborSectionWithMoney(c(language), v, store);
        expect(got.map((l) => l.label), name).toEqual(want);
        // The existing ungated lines keep their text and relative order.
        const without = laborSectionWithMoney(c(language), v, undefined);
        const moneyLines = new Set<DigestLine>([m.f1, m.f2!, m.f3!, m.f4, m.f5!].map((l) => got.find((x) => x.label === l.label)!));
        expect(got.filter((l) => !moneyLines.has(l)), name).toEqual(without);
      }
    });
  }
  it("PR 2's scheduled-vs-worked line keeps needs: published_staffing", () => {
    const got = laborSectionWithMoney(c(), fullV(), laborStore(hourlyFacts(), roleFacts()));
    expect(got.find((l) => l.label === translator("en")("digest.staffing.vs_label"))!.needs).toBe("published_staffing");
  });
});

// ── The cap ──────────────────────────────────────────────────────────────────────────────────

describe("the cap: \"and N more\" counts only lines this recipient may see; issues always print; unknowns first", () => {
  const section = (can: (cap: DigestCapability) => boolean, store: LaborMoneyStore): DigestSection =>
    finishSection({ title: "Labor", lines: laborSectionWithMoney(c(), fullV(), store), href: null, cap: 6 }, { t: translator("en"), can })!;
  const all = () => true;
  const hourlyOnly = (cap: DigestCapability) => cap === "labor_hourly" || cap === "published_staffing";
  const more = (s: DigestSection) => s.lines.find((l) => /^and \d+ more$|^and 1 more$/.test(l.label));
  it("a full section folds routine lines; N is the allowed count minus what printed", () => {
    const store = laborStore(hourlyFacts(), roleFacts());
    const full = section(all, store), gm = section(hourlyOnly, store);
    expect(full.lines.length).toBe(7);
    expect(more(full)!.label).toBe("and 4 more");
    // Without fully loaded and cost by role: two fewer allowed lines, so two fewer folded.
    expect(more(gm)!.label).toBe("and 2 more");
    const allowed = cutLines(laborSectionWithMoney(c(), fullV(), store), hourlyOnly).length;
    expect(allowed - 6).toBe(2);
    expect(more(gm)!.text).not.toContain("Fully loaded");
    expect(more(gm)!.text).not.toContain("Cost by role");
  });
  it("an over-target F1 and F3 always print (issues are not capped); an unknown sorts ahead of routine lines", () => {
    const over = rangeFigures(LAST_FROM, LAST_TO, { hourly_straight_cents: 25_000 * 7 });
    const s = section(all, laborStore(hourlyFacts({ latestFinalDay: overTargetDay(), lastFullWeek: ok(LAST_FROM, LAST_TO, over) }), { kind: "unavailable" }));
    expect(s.lines.slice(0, 2).map((l) => l.tone)).toEqual(["issue", "issue"]);
    expect(s.lines[2]!.text).toBe(serverT("en", "digest.labor_money.roles_not_available"));
    expect(s.status).toMatchObject({ issues: 2, unknowns: 1 });
  });
});

// ── The figure census ────────────────────────────────────────────────────────────────────────

describe("no number is formatted by hand", () => {
  const ROOT = path.resolve(__dirname, "..");
  const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  for (const f of ["lib/report-digests-labor-compose.ts", "lib/report-digests-labor-view.ts"]) {
    it(`${f}: no formatCents, toFixed, Intl.NumberFormat, formatQuantity, hand-built %`, () => {
      const code = src(f);
      expect(code).not.toMatch(/\bformatCents\b|\btoFixed\b|Intl\.NumberFormat|\bformatQuantity\b|toLocaleString/);
      expect(code).not.toMatch(/\}%|"%"|'%'|`%`|\* ?100\b|\/ ?100\b/);
    });
  }
  it("the compose file prints figures only through figureText (and imports no figure builder)", () => {
    const code = src("lib/report-digests-labor-compose.ts");
    expect(code).toMatch(/figureText\(/);
    expect(code).not.toMatch(/\b(exactFigure|purePctFigure|pureCentsFigure|loadedPctFigure|loadedCentsFigure|figureDisplay|figureCells)\b/);
  });
});

describe("Opus R-7: the samples script writes under a relative, git-ignored tmp/ by default", () => {
  it("no absolute user path; the default is tmp/digest-labor-samples; .gitignore covers tmp/", () => {
    const ROOT = path.resolve(__dirname, "..");
    const script = readFileSync(path.join(ROOT, "scripts/render-digest-labor-samples.ts"), "utf8");
    expect(script).not.toMatch(/[A-Za-z]:[\\/]|\/Users\/|\/home\//);
    expect(script).toMatch(/const DEFAULT_OUT = path\.join\("tmp", "digest-labor-samples"\);/);
    expect(readFileSync(path.join(ROOT, ".gitignore"), "utf8").split(/\r?\n/)).toContain("tmp/");
  });
});

describe("rendered: HTML and text carry the same lines (en + es)", () => {
  for (const language of LANGS) {
    it(`owner, every line (${language})`, () => {
      const r = recipient("owner", [], { kind: "gm_shop", shops: [A] }, businessOf("owner"));
      const mail = renderShopDigest(shopFacts(SHOP_A, { labor: loaded(labor()) }), { language, baseUrl: BASE, viewer: r.viewer, access: r.access, laborMoney: laborStore(hourlyFacts(), roleFacts()) });
      const m = lines(language, hourlyFacts());
      for (const l of [m.f1, m.f2!, m.f3!, m.f4, m.f5!]) {
        expect(mail.text, l.label).toContain(l.label);
        expect(mail.html, l.label).toContain(l.label);
      }
    });
  }
});

// ── fix round 2 (CC addendum 2026-11-28): D-4 ───────────────────────────────────────────────────

describe("D-4: a shop with no Toast connection has ONE labor-money line that says so; it is not an unknown", () => {
  const notConnectedV = (): ShopV2Facts => ({ ...fullV(), labor: unavailable("labor_not_connected") });

  for (const language of LANGS) {
    const said = serverT(language, "digest.labor_money.not_connected");
    it(`the line, its needs and its place: right after the status line, every other line as it is (${language})`, () => {
      // The store holds healthy facts for the shop on purpose: not connected wins, no figure is printed for it.
      const store = laborStore(hourlyFacts(), roleFacts(), {}, [A]);
      expect(laborMoneyLines(ctx(language), store)).toBeNull();
      const line = laborNotConnectedLine(ctx(language), store)!;
      expect(line).toMatchObject({ label: serverT(language, "digest.labor_money.label"), text: said, tone: "info", needs: "labor_hourly" });
      expect(line.unknown).toBeUndefined();
      expect(line.text).toMatch(NO_DIGIT);
      const withLine = laborSectionWithMoney(c(language), notConnectedV(), store);
      const without = laborSectionWithMoney(c(language), notConnectedV(), undefined);
      expect(withLine.filter((l) => l.text === said)).toHaveLength(1);
      expect(withLine.filter((l) => l.text !== said)).toEqual(without);
      expect(withLine[0]!.label).toBe(translator(language)("digest.v2.labor.label"));
      expect(withLine[1]).toEqual(line);
      // No F1-F5 sentence of any kind for this shop.
      const x = w(language);
      for (const l of withLine) for (const s of [x.na, x.rolesNa, x.updating, x.weekUpdating, x.noFinal]) expect(l.text, l.label).not.toBe(s);
      // No status line at all (no Toast labor fact): the line comes first.
      const bare = laborSectionWithMoney(c(language), { ...fullV(), labor: undefined }, store);
      expect(bare[0]).toEqual(line);
    });

    it(`the other shop of the same run is untouched: its lines are exactly what they are with nobody unconnected (${language})`, () => {
      const store = laborStore(hourlyFacts(), roleFacts(), {}, [B]);
      expect(laborNotConnectedLine(ctx(language), store)).toBeNull();
      expect(laborMoneyLines(ctx(language), store)).toEqual(laborMoneyLines(ctx(language), laborStore(hourlyFacts(), roleFacts())));
    });

    it(`rendered for a holder: said once, never "not available", never counted as an unknown (${language})`, () => {
      const r = recipient("owner", [], { kind: "gm_shop", shops: [A] }, businessOf("owner"));
      const f = shopFacts(SHOP_A, { labor: unavailable("labor_not_connected") });
      const title = serverT(language, "digest.v2.section.labor");
      const section = (store: LaborMoneyStore | undefined) => composeShopSections(f, language, BASE, false, r.viewer, r.access, store).find((s) => s.title === title)!;
      const on = section(laborStore(hourlyFacts(), roleFacts(), {}, [A]));
      const off = section(undefined);
      expect(on.lines.filter((l) => l.text === said)).toHaveLength(1);
      // The line adds no unknown and no issue to the section: the count is the switch-off count.
      expect(on.status!.unknowns).toBe(off.status!.unknowns);
      expect(on.status!.issues).toBe(off.status!.issues);
      const mail = renderShopDigest(f, { language, baseUrl: BASE, viewer: r.viewer, access: r.access, laborMoney: laborStore(hourlyFacts(), roleFacts(), {}, [A]) });
      expect(mail.text).toContain(said);
      expect(mail.html).toContain(said);
      expect(mail.text).not.toContain(serverT(language, "digest.labor_money.not_available"));
      expect(mail.text).not.toContain(serverT(language, "digest.labor_money.roles_not_available"));
      expect(mail.text).not.toContain("$180.00");
    });

    it(`rendered for someone who holds no labor money: the bytes are the switch-off bytes (${language})`, () => {
      const agm = recipient("agm", [A], { kind: "gm_shop", shops: [A] }, null);
      const f = shopFacts(SHOP_A, { labor: unavailable("labor_not_connected") });
      const offMail = renderShopDigest(f, { language, baseUrl: BASE, viewer: agm.viewer, access: agm.access });
      const onMail = renderShopDigest(f, { language, baseUrl: BASE, viewer: agm.viewer, access: agm.access, laborMoney: laborStore(hourlyFacts(), roleFacts(), {}, [A]) });
      expect(onMail.text).not.toContain(said);
      expect(onMail.html).not.toContain(said);
      expect(onMail.text).toBe(offMail.text);
    });

    it(`the digest's own Toast line reads the same for a shop that is not connected as for a failed pull: the switch-off bytes do not move (${language})`, () => {
      const r = recipient("owner", [], { kind: "gm_shop", shops: [A] }, null);
      const render = (reason: string) => renderShopDigest(shopFacts(SHOP_A, { labor: unavailable(reason) }), { language, baseUrl: BASE, viewer: r.viewer, access: r.access });
      const a = render("labor_not_connected"), b = render("labor_pull_failed");
      expect(a.subject).toBe(b.subject);
      expect(a.html).toBe(b.html);
      expect(a.text).toBe(b.text);
      expect(a.text).toContain(serverT(language, "digest.v2.labor.no_entries"));
    });
  }

  it("not a labor-money run: no such line", () => {
    expect(laborNotConnectedLine(ctx("en"), undefined)).toBeNull();
    expect(laborNotConnectedLine(ctx("en"), null)).toBeNull();
    expect(laborNotConnectedLine(ctx("en"), laborStore(hourlyFacts(), roleFacts()))).toBeNull();
  });

  it("en + es both carry the sentence, and they differ", () => {
    expect(serverT("en", "digest.labor_money.not_connected")).toBe("Toast is not connected for this shop");
    expect(serverT("es", "digest.labor_money.not_connected")).not.toBe(serverT("en", "digest.labor_money.not_connected"));
    expect(serverT("es", "digest.labor_money.not_connected")).toContain("Toast");
  });
});

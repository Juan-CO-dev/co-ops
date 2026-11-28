/**
 * Digests round 3, PR 2: the staffing lines themselves (lib/report-digests-staffing-compose.ts) and where the two
 * composers put them, for a PERMITTED viewer: "Staff scheduled" (shop Tomorrow, catering Today / Tomorrow),
 * "Scheduled vs worked" (shop Labor, finding S5), the ONE "Schedule not available" line per shop per digest, the
 * stations suffix (§2.5), the links (§2.4), and that every existing ungated line keeps its text and order.
 * Pure composers over fact fixtures, en + es, HTML and text. The refused-recipient byte equality is in
 * tests/report-digests-staffing-recipients.test.ts.
 */
import { describe, expect, it } from "vitest";
import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { digestAccessFor, type DigestAccess, type DigestDelivery } from "@/lib/report-digests-access-shared";
import { composeCateringSections, composeShopSections, renderCateringDigest, renderShopDigest, type DigestSection, type Envelope } from "@/lib/report-digests-compose";
import { digestCounts } from "@/lib/report-digests-layout-shared";
import { NO_ACCESS_VIEWER, type LinkViewer } from "@/lib/report-digests-links";
import { publishedRoster, type ShopSchedule } from "@/lib/report-digests-schedule-shared";
import { scheduledVsWorkedLine, scheduleNotAvailableLine, staffingHours, staffScheduledLine } from "@/lib/report-digests-staffing-compose";
import { laborLines, laborSectionLines, tomorrowLines, translator } from "@/lib/report-digests-v2-compose";
import { failed, ok, unavailable, type Loaded } from "@/lib/report-digests-v2-shared";
import {
  A, B, BASE, cateringFacts, D, D1, fullDay, labor, lead, person, roster, schedule, SCHEDULE_VARIANTS, SHOP_A, SHOP_B, shopFacts, tomorrowDay,
} from "./fixtures/digest-staffing";

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const AGM_A: LinkViewer = { role: "agm", level: 6, locations: [A] };
const CAT_A: LinkViewer = { role: "catering_mgr", level: 6, locations: [A] };
const SL_A: LinkViewer = { role: "shift_lead", level: 5, locations: [A] };
const MOO: LinkViewer = { role: "moo", level: 8, locations: [] };

const shopDigest = (shops: string[] = [A]): DigestDelivery => ({ kind: "gm_shop", shops });
const cateringDigest = (shops: string[] = [A, B]): DigestDelivery => ({ kind: "catering", shops });
const env = (viewer: LinkViewer | null, digest?: DigestDelivery, language: Language = "en"): Envelope =>
  ({ language, baseUrl: BASE, viewer, access: digestAccessFor(viewer, digest) });
const tr = (language: Language) => (key: TranslationKey, params?: Record<string, string | number>) => serverT(language, key, params);
const ft = (iso: string, language: Language = "en") => formatTime(iso, language);
const sc = (language: Language = "en") => ({ t: tr(language), language });

const shopSections = (f: ReturnType<typeof shopFacts>, e: Envelope) => composeShopSections(f, e.language, BASE, false, e.viewer, e.access);
const tomorrowOf = (sections: DigestSection[], language: Language = "en") =>
  sections.find((s) => s.title.startsWith(language === "en" ? "Tomorrow ·" : serverT(language, "digest.v2.section.tomorrow", { date: "" }).trim()))!;
const laborOf = (sections: DigestSection[], language: Language = "en") => sections.find((s) => s.title === serverT(language, "digest.v2.section.labor"));
const cateringOf = (f: ReturnType<typeof cateringFacts>, e: Envelope, shops = [SHOP_A, SHOP_B]) =>
  composeCateringSections(f, { locations: shops, includeUnassigned: false }, e.language, BASE, e.viewer, e.access);
const titled = (sections: DigestSection[], prefix: string) => sections.find((s) => s.title.startsWith(prefix));
const staffLabel = (language: Language = "en") => serverT(language, "digest.staffing.label");

// ── 1. Staff scheduled ────────────────────────────────────────────────────────────────────────

describe("Staff scheduled: one line for one shop and one day", () => {
  it("the full line: count · span · five people with their first shift, role and extra shifts, then +N", () => {
    const day = fullDay(D);
    const l = staffScheduledLine(sc(), day, null);
    const p = day.people;
    expect(l).toEqual({
      label: "Staff scheduled", tone: "info", href: null, needs: "published_staffing",
      text: [
        "6 people",
        `${ft(day.firstStart!)} to ${ft(day.lastEnd!)}`,
        `Person A ${ft(p[0]!.startAt)} to ${ft(p[0]!.endAt)} (Line), Person B ${ft(p[1]!.startAt)} to ${ft(p[1]!.endAt)} +1 shift, `
          + `Person C ${ft(p[2]!.startAt)} to ${ft(p[2]!.endAt)} (Prep), Person D ${ft(p[3]!.startAt)} to ${ft(p[3]!.endAt)}, `
          + `Person E ${ft(p[4]!.startAt)} to ${ft(p[4]!.endAt)} +1`,
      ].join(" · "),
    });
    // 6 people → 5 named and " +1"; the sixth name never prints.
    expect(l.text).not.toContain("Person F");
    expect(ft(day.firstStart!)).toMatch(/^7:00\sAM$/);
    expect(ft(day.lastEnd!)).toMatch(/^9:30\sPM$/);
  });

  it("two shifts for one person: +1 shift / +2 shifts; a null first name prints the word for 'unnamed'; no role = no parentheses", () => {
    const two = roster(D, [person("1", "Person A", D, [7], [11], { extraShifts: 2, roleName: "Line" }), person("2", null, D, [8], [12])]);
    const en = staffScheduledLine(sc("en"), two, null).text;
    expect(en).toContain(`Person A ${ft(two.people[0]!.startAt)} to ${ft(two.people[0]!.endAt)} (Line) +2 shifts`);
    expect(en).toContain(`unnamed ${ft(two.people[1]!.startAt)} to ${ft(two.people[1]!.endAt)}`);
    expect(en).not.toMatch(/unnamed [^,]*\(/);
    expect(en.startsWith("2 people · ")).toBe(true);
    const es = staffScheduledLine(sc("es"), two, null).text;
    expect(es).toContain(`Person A ${ft(two.people[0]!.startAt, "es")} a ${ft(two.people[0]!.endAt, "es")} (Line) +2 turnos`);
    expect(es).toContain("sin nombre");
    expect(es.startsWith("2 personas · ")).toBe(true);
    expect(staffScheduledLine(sc("es"), roster(D, [person("1", "Person A", D, [7], [11], { extraShifts: 1 })]), null).text).toContain("+1 turno");
    expect(staffScheduledLine(sc("es"), roster(D, [person("1", "Person A", D, [7], [11])]), null).text.startsWith("1 persona · ")).toBe(true);
  });

  it("an open shift: counted, never named, tone attention; the section reads '1 to do' for a permitted viewer", () => {
    const day = roster(D1, [person("1", "Person A", D1, [7], [15])], { openShifts: 1 });
    const l = staffScheduledLine(sc(), day, null);
    expect(l.tone).toBe("attention");
    expect(l.text.endsWith(" · 1 open shift")).toBe(true);
    expect(staffScheduledLine(sc(), roster(D1, [person("1", "Person A", D1, [7], [15])], { openShifts: 3 }), null).text.endsWith(" · 3 open shifts")).toBe(true);
    const s = tomorrowOf(shopSections(shopFacts(SHOP_A, {}, schedule(fullDay(D), day)), env(GM_A, shopDigest())));
    expect(s.status).toMatchObject({ tone: "todo", text: "1 to do", todos: 1 });
    const es = tomorrowOf(shopSections(shopFacts(SHOP_A, {}, schedule(fullDay(D), day)), env(GM_A, shopDigest(), "es")), "es");
    expect(es.status).toMatchObject({ tone: "todo", text: "1 pendiente" });
    expect(es.lines.find((x) => x.label === "Personal programado")!.text.endsWith(" · 1 turno abierto")).toBe(true);
  });

  it("'No one scheduled', and 'No one scheduled · 1 open shift' (then attention)", () => {
    expect(staffScheduledLine(sc(), roster(D, []), null)).toMatchObject({ text: "No one scheduled", tone: "info" });
    expect(staffScheduledLine(sc(), roster(D, [], { openShifts: 1 }), null)).toMatchObject({ text: "No one scheduled · 1 open shift", tone: "attention" });
    expect(staffScheduledLine(sc("es"), roster(D, [], { openShifts: 1 }), null).text).toBe("Nadie programado · 1 turno abierto");
  });

  it("an overnight shift prints its end time and is counted on its START day only", () => {
    const names = { firstNames: new Map([["7", "Person A"]]), roleNames: new Map<string, string | null>() };
    const shift = { id: "1", locationId: "501", userId: "7", open: false, roleId: null, startAt: "2026-10-08T02:00:00Z", endAt: "2026-10-08T06:00:00Z" }; // 10 PM → 2 AM ET
    const sched: ShopSchedule = publishedRoster([shift], "501", [D, D1], names);
    expect(sched.days.map((d) => [d.day, d.people.length, d.scheduledMinutes])).toEqual([[D, 1, 240], [D1, 0, 0]]);
    const text = staffScheduledLine(sc(), sched.days[0]!, null).text;
    expect(ft(shift.endAt)).toMatch(/^2:00\sAM$/);
    expect(text).toContain(`Person A ${ft(shift.startAt)} to ${ft(shift.endAt)}`);
    expect(scheduledVsWorkedLine(sc(), sched.days[0]!, ok(labor({ totalHours: 4 })), null).text.startsWith("Scheduled 4.0 h ")).toBe(true);
    expect(staffScheduledLine(sc(), sched.days[1]!, null).text).toBe("No one scheduled");
  });
});

// ── 2. Schedule not available: ONE line per shop per digest ───────────────────────────────────

describe("'Schedule not available': one plain unknown line per shop per digest", () => {
  const notAvail = { label: "Staff scheduled", text: "Schedule not available", tone: "info", href: null, unknown: true, needs: "published_staffing" };

  it("the line itself: no detail, no reason, no link; Spanish too", () => {
    expect(scheduleNotAvailableLine(sc())).toEqual(notAvail);
    expect(scheduleNotAvailableLine(sc("es")).text).toBe("Horario no disponible");
  });

  for (const [what, fact] of [["unavailable", unavailable<ShopSchedule>("not_linked")], ["error", failed<ShopSchedule>()], ["a day missing from the answer", schedule(fullDay(D))]] as const) {
    it(`shop digest, ${what}: in Tomorrow, once; no comparison line in Labor; the section shows ? and the counts take it`, () => {
      const e = env(GM_A, shopDigest());
      const facts = shopFacts(SHOP_A, { labor: ok(labor()) }, fact);
      const sections = shopSections(facts, e);
      const all = sections.flatMap((s) => s.lines);
      expect(all.filter((l) => l.label === "Staff scheduled")).toEqual([notAvail]);
      expect(all.some((l) => l.label === "Scheduled vs worked")).toBe(false);
      expect(tomorrowOf(sections).lines).toContainEqual(notAvail);
      expect(tomorrowOf(sections).status).toMatchObject({ tone: "unknown", unknowns: 1, text: "1 not available" });
      const without = shopSections(shopFacts(SHOP_A, { labor: ok(labor()) }), e);
      expect(digestCounts(sections).unknowns).toBe(digestCounts(without).unknowns + 1);
      // Labor stays as it was (no comparison line), byte for byte.
      expect(laborOf(sections)).toEqual(laborOf(without));
      for (const body of [renderShopDigest(facts, e).text, renderShopDigest(facts, e).html]) expect(body.match(/Schedule not available/g)?.length).toBe(1);
    });
  }

  it("the preheader's counts take it: one more unknown, no other count moves", () => {
    const e = env(GM_A, shopDigest());
    const pre = (sched?: Loaded<ShopSchedule>) => {
      const sections = shopSections(shopFacts(SHOP_A, {}, sched), e);
      return digestCounts(sections);
    };
    expect(pre(failed()).unknowns - pre().unknowns).toBe(1);
    expect(pre(failed()).issues).toBe(pre().issues);
  });

  const notAvailIn = (sections: DigestSection[], prefix: string) => (titled(sections, prefix)?.lines ?? []).filter((l) => l.text === "Schedule not available").length;
  for (const [what, fact] of [["unavailable", unavailable<ShopSchedule>("not_ready")], ["error", failed<ShopSchedule>()]] as const) {
    it(`catering digest, ${what}: orders today and tomorrow → Today only; tomorrow only → Tomorrow; no orders → none`, () => {
      const e = env(CAT_A, cateringDigest([A]));
      const both = cateringOf(cateringFacts([lead("l1", A, D), lead("l2", A, D1)], { [A]: fact }), e, [SHOP_A]);
      expect(notAvailIn(both, "Shop A · Today")).toBe(1);
      expect(notAvailIn(both, "Shop A · Early tomorrow")).toBe(0);
      expect(titled(both, "Shop A · Today")!.status).toMatchObject({ tone: "unknown", unknowns: 1 });
      const tomorrowOnly = cateringOf(cateringFacts([lead("l2", A, D1)], { [A]: fact }), e, [SHOP_A]);
      expect(notAvailIn(tomorrowOnly, "Shop A · Today")).toBe(0);
      expect(notAvailIn(tomorrowOnly, "Shop A · Early tomorrow")).toBe(1);
      const none = cateringOf(cateringFacts([], { [A]: fact }), e, [SHOP_A]);
      expect(none.flatMap((s) => s.lines).some((l) => l.label === "Staff scheduled")).toBe(false);
      const mail = renderCateringDigest(cateringFacts([lead("l1", A, D), lead("l2", A, D1)], { [A]: fact }), { locations: [SHOP_A], includeUnassigned: false }, e);
      expect(mail.text.match(/Schedule not available/g)?.length).toBe(1);
    });
  }

  it("catering: a shop with no entry, or facts with no schedule key → no staffing line at all; the 'no shop set' group never", () => {
    const e = env(MOO, cateringDigest([A, B]));
    const leads = [lead("l1", A, D), lead("l2", B, D), lead("l3", null, D)];
    const s = composeCateringSections(cateringFacts(leads, { [A]: schedule(fullDay(D), tomorrowDay(D1)) }), { locations: [SHOP_A, SHOP_B], includeUnassigned: true }, "en", BASE, MOO, e.access);
    expect(titled(s, "Shop A · Today")!.lines.some((l) => l.label === "Staff scheduled")).toBe(true);
    expect(titled(s, "Shop B · Today")!.lines.some((l) => l.label === "Staff scheduled")).toBe(false);
    expect(s.filter((x) => x.title.startsWith("No shop set")).flatMap((x) => x.lines).some((l) => l.label === "Staff scheduled")).toBe(false);
    const noKey = composeCateringSections(cateringFacts(leads), { locations: [SHOP_A, SHOP_B], includeUnassigned: true }, "en", BASE, MOO, e.access);
    expect(noKey.flatMap((x) => x.lines).some((l) => l.label === "Staff scheduled")).toBe(false);
  });
});

// ── 3. Scheduled vs worked ────────────────────────────────────────────────────────────────────

describe("Scheduled vs worked (Labor, day D), composed on its own (S5)", () => {
  const day58 = roster(D, [person("1", "Person A", D, [7], [15])], { scheduledMinutes: 58 * 60 });
  const SCHED = "Scheduled 58.0 h (published 7shifts: assigned shifts starting this day, before breaks)";

  it("form 1: both known → the signed difference, clocked − scheduled, one decimal (+, true minus, 0.0)", () => {
    expect(scheduledVsWorkedLine(sc(), day58, ok(labor({ totalHours: 62.5 })), null)).toEqual({
      label: "Scheduled vs worked", tone: "info", href: null, needs: "published_staffing",
      text: `${SCHED} · Clocked 62.5 h (Toast business day) (+4.5 h)`,
    });
    expect(scheduledVsWorkedLine(sc(), day58, ok(labor({ totalHours: 57 })), null).text).toBe(`${SCHED} · Clocked 57.0 h (Toast business day) (−1.0 h)`);
    expect(scheduledVsWorkedLine(sc(), day58, ok(labor({ totalHours: 58 })), null).text).toBe(`${SCHED} · Clocked 58.0 h (Toast business day) (0.0 h)`);
    // The difference is of the printed figures: 58.04 → 58.0 and 62.56 → 62.6 give +4.6, never +4.5.
    const odd = roster(D, [], { scheduledMinutes: 58.04 * 60 });
    expect(scheduledVsWorkedLine(sc(), odd, ok(labor({ totalHours: 62.56 })), null).text).toContain("Clocked 62.6 h (Toast business day) (+4.6 h)");
    expect(scheduledVsWorkedLine(sc("es"), day58, ok(labor({ totalHours: 62.5 })), null).text)
      .toBe("Programado 58.0 h (7shifts publicado: turnos asignados que empiezan este día, antes de descansos) · Marcado 62.5 h (día de negocio de Toast) (+4.5 h)");
    expect(staffingHours("en", 1234.56)).toBe("1,234.6");
    expect(staffingHours("en", 7)).toBe("7.0");
  });

  it("form 2: an open clock-in or a shift of unknown hours → 'so far', no difference", () => {
    for (const over of [{ openEntries: 1 }, { unknownHoursEntries: 2 }]) {
      const l = scheduledVsWorkedLine(sc(), day58, ok(labor({ totalHours: 40, ...over })), null);
      expect(l.text).toBe(`${SCHED} · Clocked 40.0 h so far (Toast business day)`);
      expect(l.unknown).toBeUndefined();
    }
    expect(scheduledVsWorkedLine(sc("es"), day58, ok(labor({ openEntries: 1 })), null).text).toContain("Marcado 62.5 h hasta ahora (día de negocio de Toast)");
  });

  it("form 3: labor absent, unavailable or failed → 'clocked hours not available', unknown", () => {
    for (const l of [undefined, unavailable<never>("no_labor"), unavailable<never>("labor_off"), failed<never>()]) {
      expect(scheduledVsWorkedLine(sc(), day58, l, null)).toEqual({
        label: "Scheduled vs worked", tone: "info", href: null, unknown: true, needs: "published_staffing", text: `${SCHED} · clocked hours not available`,
      });
    }
    expect(scheduledVsWorkedLine(sc("es"), day58, undefined, null).text).toContain("horas marcadas no disponibles");
  });

  it("placed right after the status line; laborLines itself is unchanged; the ungated lines keep text and order", () => {
    const c = { t: translator("en"), language: "en" as const, baseUrl: BASE, locationId: A, day: D, viewer: GM_A };
    const v = shopFacts(SHOP_A, { labor: ok(labor()) }, schedule(day58, tomorrowDay())).v2!;
    const lines = laborSectionLines(c, v);
    expect(lines.map((l) => l.label)).toEqual(["Labor (Toast)", "Scheduled vs worked", ...laborLines(c, v).slice(1).map((l) => l.label)]);
    expect(lines.filter((l) => !l.needs)).toEqual(laborLines(c, v));
    expect(laborLines(c, v)).toEqual(laborLines(c, { ...v, schedule: undefined }));
  });

  it("a schedule that loaded with NO Toast rows (unavailable('no_labor')): the unknown Labor line, then the comparison", () => {
    const e = env(GM_A, shopDigest());
    const s = laborOf(shopSections(shopFacts(SHOP_A, { labor: unavailable("no_labor") }, schedule(day58, tomorrowDay())), e))!;
    expect(s.lines.map((l) => [l.label, l.text])).toEqual([
      ["Labor (Toast)", serverT("en", "digest.v2.labor.no_entries")],
      ["Scheduled vs worked", `${SCHED} · clocked hours not available`],
    ]);
    expect(s.status).toMatchObject({ tone: "unknown", unknowns: 2 });
  });

  it("v.labor absent: the Labor section exists for a permitted viewer with just this line (and in Spanish)", () => {
    for (const language of ["en", "es"] as const) {
      const s = laborOf(shopSections(shopFacts(SHOP_A, {}, schedule(day58, tomorrowDay())), env(GM_A, shopDigest(), language)), language)!;
      expect(s.lines.map((l) => l.label)).toEqual([serverT(language, "digest.staffing.vs_label")]);
      expect(s.lines[0]!.unknown).toBe(true);
    }
    // Without the schedule there is no Labor section at all (as before PR 2).
    expect(laborOf(shopSections(shopFacts(SHOP_A), env(GM_A, shopDigest())))).toBeUndefined();
  });

  it("the shop digest renders it in HTML and text", () => {
    const mail = renderShopDigest(shopFacts(SHOP_A, { labor: ok(labor()) }, schedule(day58, tomorrowDay())), env(GM_A, shopDigest()));
    for (const body of [mail.text, mail.html]) expect(body).toContain("Clocked 62.5 h (Toast business day) (+4.5 h)");
  });
});

// ── 4. The stations suffix (§2.5) ─────────────────────────────────────────────────────────────

describe("the stations line: 'schedule not connected' is dropped only for a recipient the gate admits at that shop", () => {
  const stationsText = (sections: DigestSection[], language: Language = "en") =>
    sections.flatMap((s) => s.lines).find((l) => l.label === serverT(language, "digest.catering.staff_label"));

  it("admitted (GM own shop, catering digest): no suffix, with the schedule present, absent or failed; tone kept", () => {
    for (const [, fact] of SCHEDULE_VARIANTS) {
      const s = cateringOf(cateringFacts([lead("l1", A, D)], fact ? { [A]: fact } : undefined), env(GM_A, cateringDigest([A])), [SHOP_A]);
      expect(stationsText(s)).toMatchObject({ text: "Person A (Grill)", tone: "attention" });
    }
  });

  it("refused (the same GM with no delivery, a social media manager, another shop's GM): the line byte for byte, any schedule fact", () => {
    const refused: Array<[LinkViewer, DigestDelivery | undefined]> = [
      [GM_A, undefined], [{ role: "social_media_mgr", level: 6, locations: [A] }, cateringDigest([A])], [{ role: "gm", level: 7, locations: [B] }, cateringDigest([B])],
    ];
    for (const [viewer, digest] of refused) {
      for (const language of ["en", "es"] as const) {
        const e = env(viewer, digest, language);
        const base = renderCateringDigest(cateringFacts([lead("l1", A, D)]), { locations: [SHOP_A], includeUnassigned: false }, e);
        for (const [, fact] of SCHEDULE_VARIANTS) {
          const f = cateringFacts([lead("l1", A, D)], fact ? { [A]: fact } : undefined);
          expect(renderCateringDigest(f, { locations: [SHOP_A], includeUnassigned: false }, e)).toEqual(base);
        }
        expect(base.text).toContain(serverT(language, "digest.catering.schedule_not_connected"));
      }
    }
  });

  it("the suffix depends on the gate only: an admitted recipient with NO schedule fact still has no suffix", () => {
    const s = cateringOf(cateringFacts([lead("l1", A, D)]), env(SL_A, cateringDigest([A])), [SHOP_A]);
    expect(stationsText(s)).toMatchObject({ text: "Person A (Grill)" });
  });
});

// ── 5. Links (§2.4) ───────────────────────────────────────────────────────────────────────────

describe("links: today's lines open reconcile → stations → nothing; tomorrow's roster is never a link", () => {
  const reconcile = `${BASE}/admin/people-reconcile?loc=${A}`;
  const stations = `${BASE}/stations?loc=${A}`;
  const sched = { [A]: schedule(fullDay(D), tomorrowDay(D1)) };
  const todayLine = (viewer: LinkViewer, access: DigestAccess | null) =>
    titled(composeCateringSections(cateringFacts([lead("l1", A, D)], sched), { locations: [SHOP_A], includeUnassigned: false }, "en", BASE, viewer, access), "Shop A · Today")!
      .lines.find((l) => l.label === "Staff scheduled")!;

  it("catering Today: GM at own shop and MoO → reconcile; AGM, catering manager, shift lead → stations", () => {
    for (const v of [GM_A, MOO]) expect(todayLine(v, digestAccessFor(v, cateringDigest([A]))).href).toBe(reconcile);
    for (const v of [AGM_A, CAT_A, SL_A]) expect(todayLine(v, digestAccessFor(v, cateringDigest([A]))).href).toBe(stations);
  });

  it("an admitted recipient whose link viewer can open neither screen gets the line with no link", () => {
    const l = todayLine(NO_ACCESS_VIEWER, digestAccessFor(SL_A, cateringDigest([A])));
    expect(l.href).toBeNull();
    expect(l.text.startsWith("6 people · ")).toBe(true);
  });

  it("Labor comparison: GM → reconcile; flagged AGM → stations", () => {
    const f = shopFacts(SHOP_A, { labor: ok(labor()) }, schedule(fullDay(D), tomorrowDay(D1)));
    expect(laborOf(shopSections(f, env(GM_A, shopDigest())))!.lines.find((l) => l.label === "Scheduled vs worked")!.href).toBe(reconcile);
    expect(laborOf(shopSections(f, env(AGM_A, shopDigest())))!.lines.find((l) => l.label === "Scheduled vs worked")!.href).toBe(stations);
  });

  it("tomorrow's label is never a link (shop Tomorrow, catering Tomorrow), in HTML", () => {
    const shopMail = renderShopDigest(shopFacts(SHOP_A, {}, schedule(fullDay(D), tomorrowDay(D1))), env(MOO, shopDigest()));
    expect(shopMail.html).toContain("<strong>Staff scheduled</strong>");
    expect(shopMail.html).not.toMatch(/<a [^>]*>Staff scheduled<\/a>/);
    const cat = renderCateringDigest(cateringFacts([lead("l2", A, D1)], sched), { locations: [SHOP_A], includeUnassigned: false }, env(MOO, cateringDigest([A])));
    expect(cat.html).toContain("<strong>Staff scheduled</strong>");
    expect(cat.html).not.toMatch(/<a [^>]*>Staff scheduled<\/a>/);
    // Today's IS a link for MoO.
    const today = renderCateringDigest(cateringFacts([lead("l1", A, D)], sched), { locations: [SHOP_A], includeUnassigned: false }, env(MOO, cateringDigest([A])));
    expect(today.html).toContain(`<a href="${reconcile}"`);
  });
});

// ── 6. Placement and the ungated lines ────────────────────────────────────────────────────────

describe("placement, and every existing ungated line keeps its text and relative order", () => {
  const sched = schedule(fullDay(D), tomorrowDay(D1));

  it("shop Tomorrow: the roster of D+1 after the catering line", () => {
    const c = { t: translator("en"), language: "en" as const, baseUrl: BASE, locationId: A, day: D, viewer: GM_A };
    const v = shopFacts(SHOP_A, {}, sched).v2!;
    const lines = tomorrowLines(c, v);
    expect(lines.at(-1)).toMatchObject({ label: "Staff scheduled", needs: "published_staffing", href: null });
    expect(lines.at(-2)!.label).toBe(serverT("en", "digest.v2.tomorrow.catering_label"));
    expect(lines.at(-1)!.text).toContain("2 people");
    expect(lines.filter((l) => !l.needs)).toEqual(tomorrowLines(c, { ...v, schedule: undefined }));
  });

  it("catering Today: after the readiness lines, before the stations line; Tomorrow: after the order lines", () => {
    const f = cateringFacts([lead("l1", A, D), lead("l2", A, D1)], { [A]: sched }, {
      readiness: { [A]: ok({ rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 }) },
      // Nobody on a station: every line is routine, so the finished order IS the composer's order.
      staff: { [A]: ok({ source: "stations", scheduleConnected: false, onStation: [] }) },
    });
    const access = digestAccessFor(MOO, cateringDigest([A]));
    const s = composeCateringSections(f, { locations: [SHOP_A], includeUnassigned: false }, "en", BASE, MOO, access);
    expect(titled(s, "Shop A · Today")!.lines.map((l) => l.label)).toEqual(["Customer l1", "Inventory for today", "Staff scheduled", "Staff today", "Today"]);
    expect(titled(s, "Shop A · Early tomorrow")!.lines.map((l) => l.label)).toEqual(["Customer l2", "Staff scheduled", "Tomorrow"]);
    // The same email without the schedule: the ungated lines, same text, same order.
    const without = composeCateringSections({ ...f, schedule: undefined }, { locations: [SHOP_A], includeUnassigned: false }, "en", BASE, MOO, access);
    for (let i = 0; i < s.length; i++) {
      expect(s[i]!.lines.filter((l) => !l.needs)).toEqual(without[i]!.lines.filter((l) => !l.needs));
    }
    expect(s.map((x) => x.title)).toEqual(without.map((x) => x.title));
  });

  it("the shop digest's sections: titles and ungated lines identical with and without the schedule, for a permitted viewer", () => {
    for (const language of ["en", "es"] as const) {
      const e = env(GM_A, shopDigest(), language);
      const withS = shopSections(shopFacts(SHOP_A, { labor: ok(labor()) }, sched), e);
      const without = shopSections(shopFacts(SHOP_A, { labor: ok(labor()) }), e);
      expect(withS.map((x) => x.title)).toEqual(without.map((x) => x.title));
      for (let i = 0; i < withS.length; i++) {
        const ungated = (sec: DigestSection) => sec.lines.filter((l) => !l.needs && !/^(and \d+ more|y \d+ más|and 1 more|y 1 más)$/.test(l.label));
        // Before any overflow line, the ungated lines keep their order (the cap may fold the last of them).
        const a = ungated(withS[i]!).map((l) => l.label);
        const b = ungated(without[i]!).map((l) => l.label);
        expect(b.slice(0, a.length)).toEqual(a);
      }
    }
  });

  it("es: the labels and words are Spanish", () => {
    const mail = renderShopDigest(shopFacts(SHOP_A, { labor: ok(labor()) }, sched), env(GM_A, shopDigest(), "es"));
    expect(mail.text).toContain(`${staffLabel("es")}: 2 personas`);
    expect(mail.text).toContain("Programado vs. trabajado: Programado ");
  });
});

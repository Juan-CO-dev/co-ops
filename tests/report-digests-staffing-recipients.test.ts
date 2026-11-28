/**
 * Digests round 3, PR 2: WHO gets the published staffing (plan §1.2), proven on rendered HTML and text.
 *
 * THE HEART OF THE PR: a recipient Juan has not approved gets NOTHING. Their email (subject, preheader, every section
 * status, HTML, text, the "and N more" fold) is BYTE-IDENTICAL whether the schedule facts are absent, present,
 * present with an open shift, unavailable or failed (the 1a F4 form): cut first, then count. A composer never asks
 * a role or a level; it tags the line `needs: "published_staffing"` and `finishSection` cuts it.
 *
 * Then: one email, two shops (§2.5); resolution → render through `resolveDigestRecipients` and the engine (S4); the
 * (b) sales grant through the engine; and the §1.2 matrix row by row.
 */
import { describe, expect, it } from "vitest";
import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { digestAccessFor, type DigestAccess, type DigestDelivery } from "@/lib/report-digests-access-shared";
import {
  composeCateringSections, composeShopSections, renderCateringDigest, renderShopDigest, renderUnifiedDigest,
  type CateringFacts, type DigestSection, type Envelope, type ShopDayFacts,
} from "@/lib/report-digests-compose";
import { runClosingDigestsWith, runDigestTickWith, type ClaimRow, type DigestIO } from "@/lib/report-digests-engine";
import { NO_ACCESS_VIEWER, type LinkViewer } from "@/lib/report-digests-links";
import type { ShopSchedule } from "@/lib/report-digests-schedule-shared";
import { DEFAULT_DIGEST_SETTINGS, resolveDigestRecipients, type DigestDirectory, type RecipientOverride } from "@/lib/report-digests-shared";
import { ok, salesDetailTotals, unavailable, type Loaded, type SalesDetailFacts, type ShopV2Facts } from "@/lib/report-digests-v2-shared";
import type { CutoffTomorrow } from "@/lib/report-digests-v2-shared";
import type { DailyRaw } from "@/lib/sales-reports-shared";
import {
  A, B, BASE, cateringFacts, D, D1, fullDay, labor, lead, person, roster, schedule, SCHEDULE_VARIANTS, SHOP_A, SHOP_B, shopFacts, tomorrowDay,
} from "./fixtures/digest-staffing";

const C = "cccccccc-0000-4000-8000-000000000003";
const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };

const words = (language: Language) => ({
  staff: serverT(language, "digest.staffing.label"),
  vs: serverT(language, "digest.staffing.vs_label"),
  notConnected: serverT(language, "digest.catering.schedule_not_connected"),
  net: language === "en" ? "Toast net" : "neto de Toast",
});

// ── facts long enough to fold ("and N more") ────────────────────────────────────────────────────

/** Eight vendors with a cutoff tomorrow: the Tomorrow section folds. One with no draft (an issue). */
function busyTomorrow(): Partial<ShopV2Facts> {
  const cutoffs: CutoffTomorrow[] = Array.from({ length: 8 }, (_, i) => ({ vendorId: `v${i}`, vendorName: `Vendor ${i}`, cutoffTime: "10:00:00", ordered: i > 0, hasDraft: false }));
  const base = shopFacts(SHOP_A).v2!;
  if (base.ordering.kind !== "ok") throw new Error("fixture");
  return { ordering: ok({ ...base.ordering.value, cutoffsTomorrow: cutoffs }) };
}
const LABOR_BASELINES: Array<[string, Partial<ShopV2Facts>]> = [
  ["Toast labor ok", { labor: ok(labor()) }],
  ["S9 (i) v.labor absent", {}],
  ["S9 (ii) unavailable('no_labor')", { labor: unavailable("no_labor") }],
];
/** Seven orders today and seven tomorrow at a shop: Today and Tomorrow fold. */
const manyLeads = (shop: string) => [
  ...Array.from({ length: 7 }, (_, i) => lead(`${shop.slice(0, 1)}t${i}`, shop, D)),
  ...Array.from({ length: 7 }, (_, i) => lead(`${shop.slice(0, 1)}m${i}`, shop, D1)),
];

const shopWith = (shop: { id: string; name: string }, over: Partial<ShopV2Facts>, sched?: Loaded<ShopSchedule>) =>
  shopFacts(shop, { ...busyTomorrow(), ...over }, sched);
const cateringWith = (sched?: Loaded<ShopSchedule>) =>
  cateringFacts([...manyLeads(A), ...manyLeads(B)], sched ? { [A]: sched, [B]: sched } : undefined);

// ── 1. Byte equality for refused recipients ───────────────────────────────────────────────────

/** Every refused recipient, as the envelope the engine (or a direct compose) would hand the renderer. */
function refused(kind: DigestDelivery["kind"]): Array<[string, LinkViewer | null, DigestAccess | null]> {
  const shops = kind === "gm_shop" ? [A] : [A, B];
  const smm: LinkViewer = { role: "social_media_mgr", level: 6, locations: [A, B] };
  const other: LinkViewer = { role: "gm", level: 7, locations: [C] };
  const unknownRole: LinkViewer = { role: "regional_wizard", level: 9, locations: [A, B] };
  return [
    ["a flagged social media manager", smm, digestAccessFor(smm, { kind, shops })],
    ["a recipient at another shop", other, digestAccessFor(other, { kind, shops: [C] })],
    ["an unknown role", unknownRole, digestAccessFor(unknownRole, { kind, shops })],
    ["a null viewer", null, null],
    ["a null access (GM viewer)", GM_A, null],
    ["an access WITHOUT digest (a GM composed directly)", GM_A, digestAccessFor(GM_A)],
    ["no access viewer", NO_ACCESS_VIEWER, digestAccessFor(NO_ACCESS_VIEWER, { kind, shops })],
  ];
}
const envOf = (viewer: LinkViewer | null, access: DigestAccess | null, language: Language): Envelope => ({ language, baseUrl: BASE, viewer, access });
const statuses = (sections: DigestSection[]) => sections.map((s) => [s.title, s.status ?? null, s.lines.length]);

describe("byte equality: a refused recipient's email is identical whatever the schedule facts", () => {
  for (const language of ["en", "es"] as const) {
    it(`shop digest (${language}): subject, preheader, statuses, HTML, text; every labor baseline; folds`, () => {
      for (const [who, viewer, access] of refused("gm_shop")) {
        for (const [baseline, over] of LABOR_BASELINES) {
          const e = envOf(viewer, access, language);
          const base = renderShopDigest(shopWith(SHOP_A, over), e);
          const baseSections = composeShopSections(shopWith(SHOP_A, over), language, BASE, false, viewer, access);
          expect(baseSections.some((s) => s.lines.some((l) => /^(and \d+ more|and 1 more|y \d+ más|y 1 más)$/.test(l.label))), "the fixture folds").toBe(true);
          for (const [what, sched] of SCHEDULE_VARIANTS) {
            const f = shopWith(SHOP_A, over, sched);
            const label = `${who} · ${baseline} · ${what}`;
            expect(renderShopDigest(f, e), label).toEqual(base);
            const sections = composeShopSections(f, language, BASE, false, viewer, access);
            expect(statuses(sections), label).toEqual(statuses(baseSections));
            expect(sections, label).toEqual(baseSections);
            expect(renderShopDigest(f, e).text).not.toContain(words(language).staff);
            expect(renderShopDigest(f, e).html).not.toContain(words(language).vs);
          }
          // S9: the Labor section is absent for them when it was absent (i), and the unknown line stays as it is (ii).
          const laborTitle = serverT(language, "digest.v2.section.labor");
          const has = baseSections.some((s) => s.title === laborTitle);
          expect(has, `${who} · ${baseline}`).toBe(baseline !== "S9 (i) v.labor absent");
        }
      }
    });

    it(`unified digest (${language}): both shops carry schedule facts; nothing moves`, () => {
      for (const [who, viewer, access] of refused("unified")) {
        for (const [baseline, over] of LABOR_BASELINES) {
          const e = envOf(viewer, access, language);
          const shops = (sched?: Loaded<ShopSchedule>) => [shopWith(SHOP_A, over, sched), shopWith(SHOP_B, over, sched)];
          const base = renderUnifiedDigest({ day: D, shops: shops(), notFinalized: [] }, e);
          for (const [what, sched] of SCHEDULE_VARIANTS) {
            expect(renderUnifiedDigest({ day: D, shops: shops(sched), notFinalized: [] }, e), `${who} · ${baseline} · ${what}`).toEqual(base);
          }
        }
      }
    });

    it(`catering digest (${language}): two shops with folds, stations line kept, nothing moves`, () => {
      for (const [who, viewer, access] of refused("catering")) {
        const e = envOf(viewer, access, language);
        const scope = { locations: [SHOP_A, SHOP_B], includeUnassigned: false };
        const base = renderCateringDigest(cateringWith(), scope, e);
        const baseSections = composeCateringSections(cateringWith(), scope, language, BASE, viewer, access);
        expect(baseSections.some((s) => s.lines.some((l) => /^(and \d+ more|y \d+ más)$/.test(l.label))), "the fixture folds").toBe(true);
        for (const [what, sched] of SCHEDULE_VARIANTS) {
          const label = `${who} · ${what}`;
          expect(renderCateringDigest(cateringWith(sched), scope, e), label).toEqual(base);
          expect(composeCateringSections(cateringWith(sched), scope, language, BASE, viewer, access), label).toEqual(baseSections);
        }
        expect(base.text).toContain(words(language).notConnected);
        expect(base.text).not.toContain(words(language).staff);
      }
    });
  }

  it("the open-shift day and the not-available day DO move a permitted viewer (so the equality above is not vacuous)", () => {
    const e = envOf(GM_A, digestAccessFor(GM_A, { kind: "gm_shop", shops: [A] }), "en");
    const base = renderShopDigest(shopWith(SHOP_A, { labor: ok(labor()) }), e);
    for (const [what, sched] of SCHEDULE_VARIANTS.slice(1)) {
      expect(renderShopDigest(shopWith(SHOP_A, { labor: ok(labor()) }, sched), e).text, what).not.toBe(base.text);
    }
    const moo: LinkViewer = { role: "moo", level: 8, locations: [] };
    const ce = envOf(moo, digestAccessFor(moo, { kind: "catering", shops: [A, B] }), "en");
    const scope = { locations: [SHOP_A, SHOP_B], includeUnassigned: false };
    const cBase = renderCateringDigest(cateringWith(), scope, ce);
    for (const [what, sched] of SCHEDULE_VARIANTS.slice(1)) {
      expect(renderCateringDigest(cateringWith(sched), scope, ce).text, what).not.toBe(cBase.text);
    }
  });
});

// ── 2. One email, two shops (§2.5) ────────────────────────────────────────────────────────────

describe("one catering email, admitted at Shop A and refused at Shop B", () => {
  const agm: LinkViewer = { role: "agm", level: 6, locations: [A] };
  const access: DigestAccess = { viewer: agm, digest: { kind: "catering", shops: [A, B] } };
  const scope = { locations: [SHOP_A, SHOP_B], includeUnassigned: false };
  const schedA = schedule(fullDay(D), tomorrowDay(D1, 1));
  const schedB = schedule(roster(D, [person("301", "Person G", D, [6], [14])], { openShifts: 1 }), roster(D1, [person("302", "Person H", D1, [6], [14])]));

  for (const language of ["en", "es"] as const) {
    it(`A shows the roster and no suffix; B is byte-identical to the email without schedule facts (${language})`, () => {
      const w = words(language);
      const withS = composeCateringSections(cateringWith(), scope, language, BASE, agm, access);
      const f = { ...cateringWith(), schedule: { [A]: schedA, [B]: schedB } } satisfies CateringFacts;
      const sections = composeCateringSections(f, scope, language, BASE, agm, access);
      const ofShop = (s: DigestSection[], name: string) => s.filter((x) => x.title.startsWith(`${name} · `));
      // B: identical, statuses and folds included.
      expect(ofShop(sections, "Shop B")).toEqual(ofShop(withS, "Shop B"));
      // A: the staffing line in Today and Tomorrow, the stations line without the suffix.
      const aLines = ofShop(sections, "Shop A").flatMap((s) => s.lines);
      // Seven orders a day: the routine roster line may fold into "and N more", which then names it. Either way it
      // is there for A, once in Today and once in Tomorrow.
      for (const title of [
        `Shop A · ${serverT(language, "digest.catering.today", { date: formatDateLabel(D, language) })}`,
        `Shop A · ${serverT(language, "digest.catering.tomorrow", { date: formatDateLabel(D1, language) })}`,
      ]) {
        const sec = sections.find((x) => x.title === title)!;
        expect(sec.lines.some((l) => l.label === w.staff || (l.needs === undefined && l.text.includes(w.staff))), title).toBe(true);
      }
      expect(aLines.find((l) => l.label === serverT(language, "digest.catering.staff_label"))!.text).toBe("Person A (Grill)");
      const mail = renderCateringDigest(f, scope, envOf(agm, access, language));
      for (const body of [mail.text, mail.html]) {
        expect(body).toContain(w.staff);
        expect(body).not.toContain("Person G");
        expect(body).not.toContain("Person H");
      }
      // The whole email differs from the no-schedule email only inside Shop A's sections.
      const base = renderCateringDigest(cateringWith(), scope, envOf(agm, access, language));
      expect(mail.subject).toBe(base.subject);
      const tailOf = (text: string) => text.slice(text.indexOf("Shop B · "));
      expect(tailOf(mail.text)).toBe(tailOf(base.text));
    });
  }
});

// ── 3. Resolution → render through the engine (S4) ───────────────────────────────────────────

function dailyRaw(): DailyRaw {
  return {
    classes: [{ business_date: D, sale_class: "sale", checks: 40, amount_cents: 600000, tax_cents: 64200, amount_missing: 0, tax_missing: 0,
      gross_cents: 665500, discounts_comps_cents: 31000, voids_cents: 4500, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [{ business_date: D, tip_cents: 61200, tip_missing: 0 }],
    discounts: [{ business_date: D, count: 5, cents: 31000, amount_missing: 0 }],
    refunds: [{ business_date: D, count: 3, refund_cents: 12000, refund_tip_cents: 0, sales_refund_cents: 12000, sales_refund_missing: 0 }],
    captured_days: [D],
    ezcater: [],
  };
}
const salesDetail = (): SalesDetailFacts => ({ totals: ok(salesDetailTotals(dailyRaw(), D)), channels: ok([]), hours: ok([]), servers: ok([]) });

const SCHED_A = () => schedule(fullDay(D), tomorrowDay(D1, 1));
const SCHED_B = () => schedule(roster(D, [person("301", "Person G", D, [6], [14])]), roster(D1, [person("302", "Person H", D1, [6], [14])]));

const ov = (userId: string, over: Partial<RecipientOverride>): RecipientOverride =>
  ({ id: `o-${userId}`, kind: "internal", userId, email: null, displayName: userId, active: true, cateringDigest: false, shopDigest: false, locationIds: null, ...over });

const DIR: DigestDirectory = {
  users: [
    { id: "agm-u", name: "U1", email: "agm-u@example.com", role: "agm", language: "en", active: true },
    { id: "agm-f", name: "U2", email: "agm-f@example.com", role: "agm", language: "en", active: true },
    { id: "prep-f", name: "U3", email: "prep-f@example.com", role: "prep_mgr", language: "es", active: true },
    { id: "cat-a", name: "U4", email: "cat-a@example.com", role: "catering_mgr", language: "en", active: true },
    { id: "cat-x", name: "U5", email: "cat-x@example.com", role: "catering_mgr", language: "es", active: true },
    { id: "sl-a", name: "U6", email: "sl-a@example.com", role: "shift_lead", language: "es", active: true },
    { id: "gm-ab", name: "U7", email: "gm-ab@example.com", role: "gm", language: "en", active: true },
    { id: "gm-a", name: "U8", email: "gm-a@example.com", role: "gm", language: "es", active: true },
    { id: "moo", name: "U9", email: "moo@example.com", role: "moo", language: "en", active: true },
    { id: "smm", name: "U10", email: "smm@example.com", role: "social_media_mgr", language: "en", active: true },
    { id: "kh", name: "U11", email: "kh@example.com", role: "key_holder", language: "en", active: true },
  ],
  memberships: [
    { userId: "agm-u", locationId: A }, { userId: "agm-f", locationId: A }, { userId: "prep-f", locationId: A },
    { userId: "cat-a", locationId: A }, { userId: "sl-a", locationId: A },
    { userId: "gm-ab", locationId: A }, { userId: "gm-ab", locationId: B }, { userId: "gm-a", locationId: A },
    { userId: "smm", locationId: A }, { userId: "kh", locationId: A },
  ],
  overrides: [
    ov("agm-f", { shopDigest: true, cateringDigest: true }),
    ov("prep-f", { shopDigest: true, cateringDigest: true }),
    ov("cat-a", { shopDigest: true }),
    ov("sl-a", { cateringDigest: true }),
    ov("gm-ab", { cateringDigest: true, shopDigest: true, locationIds: [A] }),
    ov("smm", { shopDigest: true, cateringDigest: true }),
    ov("kh", { shopDigest: true, cateringDigest: true }),
  ],
  locationIds: [A, B],
};

interface Mail { to: string; subject: string; html: string; text: string }
async function runEngine(): Promise<Mail[]> {
  const sent: Mail[] = [];
  let seq = 0;
  const held = new Set<string>();
  const store = {
    claim: async (row: ClaimRow) => {
      const key = [row.recipient_ref, row.kind, row.business_day, row.location_id ?? ""].join("|");
      if (held.has(key)) return "duplicate" as const;
      held.add(key);
      return { id: `row-${++seq}` };
    },
    reclaim: async () => false, markAttempt: async () => true, recordAccepted: async () => true, finish: async () => true, skip: async () => {},
  };
  const io = (now: string): DigestIO => ({
    now: new Date(now), baseUrl: BASE,
    previewRecipient: async () => null,
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live" }),
    directory: async () => ({ dir: DIR, locations: [SHOP_A, SHOP_B] }),
    sendLog: async () => [],
    finalizedClosings: async (days) => new Map(days.map((d) => [d, d === D ? new Set([A, B]) : new Set<string>()])),
    shopFacts: async (l, day): Promise<ShopDayFacts> => ({
      ...shopFacts(l, { labor: ok(labor()), salesDetail: salesDetail() }, l.id === A ? SCHED_A() : SCHED_B()), day,
    }),
    cateringFacts: async (today) => ({ ...cateringFacts([lead("a1", A, D), lead("a2", A, D1), lead("b1", B, D), lead("b2", B, D1)], { [A]: SCHED_A(), [B]: SCHED_B() }), today }),
    store,
    sendEmail: async (m) => { sent.push({ to: m.to, subject: m.subject, html: m.html, text: m.text }); return { id: `mail-${sent.length}` }; },
    sha: (c) => String(c.length),
    alert: async () => false,
    recordRun: async () => {},
  });
  // The closing of each shop on D (shop digests + the unified one), then the 07:00 catering digest of D.
  await runClosingDigestsWith(io("2026-10-08T02:30:00Z"), A, D);
  await runClosingDigestsWith(io("2026-10-08T02:30:00Z"), B, D);
  await runDigestTickWith(io("2026-10-07T11:00:00Z"));
  return sent;
}

describe("resolution → render through resolveDigestRecipients and the engine", () => {
  const kindOf = (m: Mail) => m.subject.startsWith("Catering") ? "catering" : /^(All shops|Resumen de todas)/.test(m.subject) ? "unified"
    : m.subject.includes("Shop A") ? "shop_a" : m.subject.includes("Shop B") ? "shop_b" : "other";
  /** One recipient's emails of a kind (only day D's, never another day's fallback). */
  const mails = async () => {
    const all = await runEngine();
    return (to: string, kind: string) => all.filter((m) => m.to === to && kindOf(m) === kind && !m.subject.includes("Oct 6") && !m.subject.includes("6 oct"));
  };
  const one = (list: Mail[]) => { expect(list.length).toBe(1); return list[0]!; };
  const both = (m: { text: string; html: string }) => [m.text, m.html];

  it("who resolves at all", () => {
    const shop = resolveDigestRecipients("gm_shop", DIR).filter((r) => !r.skip).map((r) => r.userId).sort();
    // A MoO gets no shop digest (the unified one instead); the unflagged AGM and the flagged key holder get none.
    expect(shop).toEqual(["agm-f", "cat-a", "gm-a", "gm-ab", "prep-f", "smm"]);
    expect(resolveDigestRecipients("gm_shop", DIR).find((r) => r.userId === "gm-ab")!.locationIds).toEqual([A]);
    const cat = resolveDigestRecipients("catering", DIR).filter((r) => !r.skip).map((r) => r.userId).sort();
    expect(cat).toEqual(["agm-f", "cat-a", "cat-x", "gm-a", "gm-ab", "moo", "prep-f", "sl-a", "smm"]);
    expect(resolveDigestRecipients("catering", DIR).find((r) => r.userId === "cat-x")!.locationIds).toEqual([A, B]);
  });

  it("an unflagged AGM is not a recipient; a direct compose with her viewer and no digest shows nothing", async () => {
    const get = await mails();
    for (const k of ["shop_a", "catering", "unified"]) expect(get("agm-u@example.com", k)).toEqual([]);
    const viewer: LinkViewer = { role: "agm", level: 6, locations: [A] };
    const f = shopFacts(SHOP_A, { labor: ok(labor()), salesDetail: salesDetail() }, SCHED_A());
    const mail = renderShopDigest(f, { language: "en", baseUrl: BASE, viewer, access: digestAccessFor(viewer) });
    for (const body of both(mail)) for (const w of ["Staff scheduled", "Scheduled vs worked", "Toast net"]) expect(body).not.toContain(w);
  });

  it("a flagged AGM (en) and prep manager (es): staffing + hours + sales detail at their shop; staffing in the catering digest", async () => {
    const get = await mails();
    for (const [to, language] of [["agm-f@example.com", "en"], ["prep-f@example.com", "es"]] as const) {
      const w = words(language);
      const shop = one(get(to, "shop_a"));
      for (const body of both(shop)) for (const x of [w.staff, w.vs, w.net]) expect(body, `${to} ${x}`).toContain(x);
      expect(get(to, "shop_b")).toEqual([]);
      const cat = one(get(to, "catering"));
      for (const body of both(cat)) {
        expect(body).toContain(w.staff);
        expect(body).not.toContain("Person G");
        // Sales detail is a shop-digest grant only.
        expect(body).not.toContain(w.net);
      }
      expect(cat.text).not.toContain(`Person A (Grill) · ${w.notConnected}`);
    }
  });

  it("a catering-only flagged shift lead (es): staffing in the catering digest, nothing in any shop digest", async () => {
    const get = await mails();
    const w = words("es");
    for (const body of both(one(get("sl-a@example.com", "catering")))) {
      expect(body).toContain(w.staff);
      expect(body).not.toContain("Person G");
    }
    for (const k of ["shop_a", "shop_b", "unified"]) expect(get("sl-a@example.com", k)).toEqual([]);
  });

  it("a GM narrowed by an override to Shop A of her two shops: staffing for Shop A only", async () => {
    const get = await mails();
    const shop = one(get("gm-ab@example.com", "shop_a"));
    for (const body of both(shop)) for (const x of ["Staff scheduled", "Scheduled vs worked", "Toast net"]) expect(body).toContain(x);
    expect(get("gm-ab@example.com", "shop_b")).toEqual([]);
    const cat = one(get("gm-ab@example.com", "catering"));
    for (const body of both(cat)) { expect(body).toContain("Staff scheduled"); expect(body).not.toContain("Shop B"); expect(body).not.toContain("Person G"); }
  });

  it("a catering manager with NO membership (es): the catering digest for all shops with NO staffing line anywhere", async () => {
    const get = await mails();
    const w = words("es");
    const cat = one(get("cat-x@example.com", "catering"));
    for (const body of both(cat)) {
      expect(body).toContain("Shop A");
      expect(body).toContain("Shop B");
      expect(body).not.toContain(w.staff);
      expect(body).toContain(w.notConnected);
    }
  });

  it("a catering manager at her shop, shop-digest flag: staffing + hours, never sales detail; staffing in catering", async () => {
    const get = await mails();
    const shop = one(get("cat-a@example.com", "shop_a"));
    for (const body of both(shop)) { expect(body).toContain("Staff scheduled"); expect(body).toContain("Scheduled vs worked"); expect(body).not.toContain("Toast net"); }
    for (const body of both(one(get("cat-a@example.com", "catering")))) { expect(body).toContain("Staff scheduled"); expect(body).not.toContain("Person G"); }
  });

  it("a level-8 recipient: staffing for every shop in the unified digest (and the catering digest), with hours and sales", async () => {
    const get = await mails();
    const uni = one(get("moo@example.com", "unified"));
    for (const body of both(uni)) {
      expect(body.match(/Staff scheduled/g)?.length).toBe(2);
      expect(body.match(/Scheduled vs worked/g)?.length).toBe(2);
      // Each shop's TOMORROW roster (D+1): Person A at Shop A, Person H at Shop B.
      expect(body).toContain("Person H");
      expect(body).toContain("Person A");
      expect(body.match(/Toast net/g)?.length).toBe(2);
    }
    for (const body of both(one(get("moo@example.com", "catering")))) { expect(body).toContain("Person G"); expect(body).toContain("Person A"); }
  });

  it("a GM at her own shop (es): staffing, hours and sales in the shop digest; staffing in catering", async () => {
    const get = await mails();
    const w = words("es");
    for (const body of both(one(get("gm-a@example.com", "shop_a")))) for (const x of [w.staff, w.vs, w.net]) expect(body).toContain(x);
    for (const body of both(one(get("gm-a@example.com", "catering")))) expect(body).toContain(w.staff);
  });

  it("a flagged social media manager: none of it, anywhere; a flagged key holder is not a recipient", async () => {
    const get = await mails();
    const shop = one(get("smm@example.com", "shop_a"));
    for (const body of [...both(shop), ...both(one(get("smm@example.com", "catering")))]) {
      for (const x of ["Staff scheduled", "Scheduled vs worked", "Toast net", "Person A 7"]) expect(body).not.toContain(x);
    }
    for (const k of ["shop_a", "catering", "unified"]) expect(get("kh@example.com", k)).toEqual([]);
  });
});

// ── 4. (b): the sales grant ───────────────────────────────────────────────────────────────────

describe("(b): flagged AGM and prep manager on the SHOP digest see sales detail; everyone else's Sales section is unchanged", () => {
  const salesTitle = (language: Language) => serverT(language, "digest.v2.section.sales");
  const salesOf = (f: ShopDayFacts, viewer: LinkViewer | null, access: DigestAccess | null, language: Language = "en") =>
    composeShopSections(f, language, BASE, false, viewer, access).find((s) => s.title === salesTitle(language));
  const withDetail = shopFacts(SHOP_A, { salesDetail: salesDetail() });
  const without = shopFacts(SHOP_A);

  it("through the engine: the flagged AGM's and prep manager's shop digests carry Toast net (see also the engine test above)", async () => {
    const all = await runEngine();
    for (const [to, net] of [["agm-f@example.com", "Toast net $6,180.00"], ["prep-f@example.com", "neto de Toast $6,180.00"]] as const) {
      const shop = all.filter((m) => m.to === to && m.subject.includes("Shop A"));
      expect(shop.length).toBe(1);
      expect(shop[0]!.text).toContain(net);
      expect(shop[0]!.html).toContain(net);
    }
    // A flagged catering manager and a flagged social media manager: no Toast net in their shop digests.
    for (const to of ["cat-a@example.com", "smm@example.com"]) {
      const shop = all.filter((m) => m.to === to && m.subject.includes("Shop A"));
      expect(shop.length).toBe(1);
      expect(shop[0]!.text).not.toContain("Toast net");
    }
  });

  it("refused: catering manager, social media manager, an AGM at another shop, an AGM on a catering digest, no access, a null viewer", () => {
    const cat: LinkViewer = { role: "catering_mgr", level: 6, locations: [A] };
    const smm: LinkViewer = { role: "social_media_mgr", level: 6, locations: [A] };
    const agmB: LinkViewer = { role: "agm", level: 6, locations: [B] };
    const agmA: LinkViewer = { role: "agm", level: 6, locations: [A] };
    const cases: Array<[LinkViewer | null, DigestAccess | null]> = [
      [cat, digestAccessFor(cat, { kind: "gm_shop", shops: [A] })],
      [smm, digestAccessFor(smm, { kind: "gm_shop", shops: [A] })],
      [agmB, digestAccessFor(agmB, { kind: "gm_shop", shops: [A] })],
      [agmA, digestAccessFor(agmA, { kind: "catering", shops: [A] })],
      [NO_ACCESS_VIEWER, null],
      [null, null],
    ];
    for (const [viewer, access] of cases) {
      for (const language of ["en", "es"] as const) {
        expect(salesOf(withDetail, viewer, access, language)).toEqual(salesOf(without, viewer, access, language));
      }
    }
  });

  it("permitted on the shop digest at their own delivered shop only", () => {
    for (const role of ["agm", "prep_mgr"]) {
      const v: LinkViewer = { role, level: 6, locations: [A] };
      expect(salesOf(withDetail, v, digestAccessFor(v, { kind: "gm_shop", shops: [A] }))!.lines.some((l) => l.text.includes("Toast net"))).toBe(true);
      expect(salesOf(withDetail, v, digestAccessFor(v))).toEqual(salesOf(without, v, digestAccessFor(v)));
    }
  });
});

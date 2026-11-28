/**
 * Digests round 3, PR 4: WHO gets the labor money (contract §1, plan §11.3), proven on RENDERED shop and unified
 * digests, en + es, HTML and text.
 *
 * THE TWO FAILURES THIS FILE EXISTS FOR:
 *   1. a recipient sees a money group their business-report access does not hold → the access matrix, every coherent
 *      GM setting, asserted by the lines' labels;
 *   2. a recipient's email changes by one byte, count or status mark because of a line they cannot see → byte
 *      equality (subject, preheader, every section status, HTML, text, "and N more") across every labor-money fact
 *      shape, for every refused recipient, for a GM whose settings hide the only over-target line, and for a GM with
 *      hourly cost and without cost by role (capability isolation, L7).
 * And the switch-off identity against goldens rendered BEFORE PR 4's composer edits (tests/fixtures/digest-labor-goldens).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gmVisibilityCombinations, type BusinessAccess } from "@/lib/business-access-shared";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { digestAccessFor, type DigestAccess, type DigestCapability } from "@/lib/report-digests-access-shared";
import { composeShopSections, renderShopDigest, renderUnifiedDigest, type DigestSection, type Envelope, type ShopDayFacts } from "@/lib/report-digests-compose";
import { laborBusinessAccess, type LaborMoneyStore } from "@/lib/report-digests-labor-shared";
import type { LinkViewer } from "@/lib/report-digests-links";
import { finishSection } from "@/lib/report-digests-layout-shared";
import { laborSectionWithMoney, translator } from "@/lib/report-digests-v2-compose";
import { failed, ok, type CutoffTomorrow, type ShopV2Facts } from "@/lib/report-digests-v2-shared";
import { A, B, BASE, D, D1, fullDay, labor, schedule, SHOP_A, SHOP_B, shopFacts, tomorrowDay } from "./fixtures/digest-staffing";
import { dayFigures, hourlyFacts, LATEST, laborStore, ok as span, overTargetDay, recipient, roleFacts, UNAVAILABLE } from "./fixtures/digest-labor";
import { GOLDEN_CASES, goldenEnvelope, goldenShop, goldenUnified, preheaderOf, type GoldenMail } from "./fixtures/digest-labor-goldens/cases";

const C = "cccccccc-0000-4000-8000-000000000003";
const LANGS = ["en", "es"] as const;

// ── Facts long enough to fold ─────────────────────────────────────────────────────────────────

function busyTomorrow(): Partial<ShopV2Facts> {
  const cutoffs: CutoffTomorrow[] = Array.from({ length: 8 }, (_, i) => ({ vendorId: `v${i}`, vendorName: `Vendor ${i}`, cutoffTime: "10:00:00", ordered: i > 0, hasDraft: false }));
  const base = shopFacts(SHOP_A).v2!;
  if (base.ordering.kind !== "ok") throw new Error("fixture");
  return { ordering: ok({ ...base.ordering.value, cutoffsTomorrow: cutoffs }) };
}
const facts = (shop: { id: string; name: string }, over: Partial<ShopV2Facts> = {}): ShopDayFacts =>
  shopFacts(shop, { ...busyTomorrow(), labor: ok(labor()), ...over }, schedule(fullDay(D), tomorrowDay(D1, 1)));
const unified = (over: Partial<ShopV2Facts> = {}) => ({ day: D, shops: [facts(SHOP_A, over), facts(SHOP_B, over)], notFinalized: [] });

/** Every labor-money fact shape a run can seal (absent = the key omitted from the envelope). */
const STORES: Array<[string, LaborMoneyStore | null | undefined]> = [
  ["absent (no key)", undefined],
  ["null", null],
  ["present", laborStore(hourlyFacts(), roleFacts())],
  ["no entries (pre-load did not run / cut)", laborStore(null, null)],
  ["every part unavailable", laborStore(hourlyFacts({ latestFinalDay: UNAVAILABLE, weekSoFar: UNAVAILABLE, lastFullWeek: UNAVAILABLE }), { kind: "unavailable" })],
  ["a final figure over target (a hidden issue)", laborStore(hourlyFacts({ latestFinalDay: overTargetDay() }), roleFacts())],
  ["a hidden unknown line (open punch)", laborStore(hourlyFacts({ latestFinalDay: span(LATEST, LATEST, dayFigures({ open_punches: 1 })) }), roleFacts())],
];
const env = (viewer: LinkViewer | null, access: DigestAccess | null, language: Language, laborMoney?: LaborMoneyStore | null): Envelope =>
  ({ language, baseUrl: BASE, viewer, access, ...(laborMoney !== undefined ? { laborMoney } : {}) });
const statuses = (s: DigestSection[]) => s.map((x) => [x.title, x.status ?? null, x.lines.length]);
const folds = (s: DigestSection[]) => s.some((x) => x.lines.some((l) => /^(and \d+ more|and 1 more|y \d+ más|y 1 más)$/.test(l.label)));

/** The label of each money group, as it appears in a line or in an "and N more" fold. */
const groupWords = (language: Language) => ({
  hourly: [serverT(language, "digest.labor_money.latest_label_plain"), serverT(language, "digest.labor_money.week_so_far_label_plain"), serverT(language, "digest.labor_money.last_week_label_plain")],
  loaded: [serverT(language, "reports.business.card.fully_loaded")],
  roles: [serverT(language, "digest.labor_money.roles_label_plain")],
});
const holds = (body: string, words: string[]) => words.every((x) => body.includes(x));
const holdsNone = (body: string, words: string[]) => words.every((x) => !body.includes(x));
const allWords = (language: Language) => Object.values(groupWords(language)).flat();

// ── 1. The access matrix ──────────────────────────────────────────────────────────────────────

describe("access matrix on rendered shop and unified digests", () => {
  const store = laborStore(hourlyFacts(), roleFacts());
  for (const language of LANGS) {
    const g = groupWords(language);
    it(`MoO / Owner / CGS: F1–F5 in the shop digest and for each shop of the unified digest (${language})`, () => {
      for (const role of ["moo", "owner", "cgs"]) {
        const shop = recipient(role, [], { kind: "gm_shop", shops: [A] }, laborBusinessAccess(role, null));
        const mail = renderShopDigest(facts(SHOP_A), env(shop.viewer, shop.access, language, store));
        for (const body of [mail.text, mail.html]) for (const words of Object.values(g)) expect(holds(body, words), `${role} ${words}`).toBe(true);
        const uni = recipient(role, [], { kind: "unified", shops: [A, B] }, laborBusinessAccess(role, null));
        const u = renderUnifiedDigest(unified(), env(uni.viewer, uni.access, language, store));
        for (const x of allWords(language)) expect(u.text.split(x).length - 1, `${role} unified ${x}`).toBe(2);
      }
    });

    it(`GM at her own shop, EVERY coherent setting: the groups that are on, and none that is off (${language})`, () => {
      const combos = gmVisibilityCombinations();
      expect(combos.length).toBeGreaterThan(100);
      for (const s of combos) {
        const business = laborBusinessAccess("gm", { kind: "settings", settings: s });
        const r = recipient("gm", [A], { kind: "gm_shop", shops: [A] }, business);
        const mail = renderShopDigest(facts(SHOP_A), env(r.viewer, r.access, language, store));
        const on = { hourly: s.report && s.hourly_cost, loaded: s.report && s.hourly_cost && s.loaded, roles: s.report && s.hourly_cost && s.people && s.person_cost };
        for (const body of [mail.text, mail.html]) {
          for (const k of ["hourly", "loaded", "roles"] as const) {
            expect(on[k] ? holds(body, g[k]) : holdsNone(body, g[k]), `${k} ${JSON.stringify(s)}`).toBe(true);
          }
        }
      }
    });
  }
});

// ── 2. Refused recipients: nothing, and not one byte moves ───────────────────────────────────

function refused(kind: "gm_shop" | "unified"): Array<[string, LinkViewer | null, DigestAccess | null]> {
  const shops = kind === "gm_shop" ? [A] : [A, B];
  const full = laborBusinessAccess("owner", null)!;
  const as = (role: string, level: number, locations: string[], business: BusinessAccess | null = full) => {
    const v: LinkViewer = { role, level, locations, business: { access: full, finishedThrough: LATEST, enabled: true } };
    return [v, digestAccessFor(v, { kind, shops }, business)] as const;
  };
  const gmA: LinkViewer = { role: "gm", level: 7, locations: [A] };
  const gmOther = recipient("gm", [C], { kind, shops: [C] }, laborBusinessAccess("gm", { kind: "settings", settings: null }));
  return [
    ["a GM at another shop", gmOther.viewer, digestAccessFor(gmOther.viewer, { kind, shops }, gmOther.access?.business)],
    ["an AGM (carrying a full access)", ...as("agm", 6, [A, B])],
    ["a prep manager", ...as("prep_mgr", 6, [A, B])],
    ["a catering manager", ...as("catering_mgr", 6, [A, B])],
    ["a social media manager", ...as("social_media_mgr", 6, [A, B])],
    ["a shift lead", ...as("shift_lead", 5, [A, B])],
    ["an unknown role", ...as("regional_wizard", 9, [A, B])],
    ["a null viewer", null, null],
    ["a null access (GM viewer)", gmA, null],
    ["an access without digest", gmA, digestAccessFor(gmA, null, laborBusinessAccess("gm", { kind: "settings", settings: null }))],
    ["an access with business: null", gmA, digestAccessFor(gmA, { kind, shops }, null)],
    ["an owner on a CATERING delivery", ...(() => { const o = recipient("owner", [], { kind: "catering", shops }, full); return [o.viewer, o.access] as const; })()],
  ];
}

describe("refused recipients: none of F1–F5, and the email is byte-identical whatever the labor-money facts", () => {
  for (const language of LANGS) {
    it(`shop digest (${language}): subject, preheader, statuses, HTML, text, folds`, () => {
      for (const [who, viewer, access] of refused("gm_shop")) {
        for (const over of [{}, { labor: undefined }, { labor: failed() }] as Array<Partial<ShopV2Facts>>) {
          const f = facts(SHOP_A, over);
          const base = renderShopDigest(f, env(viewer, access, language));
          const baseSections = composeShopSections(f, language, BASE, false, viewer, access);
          expect(folds(baseSections), "the fixture folds").toBe(true);
          for (const [what, store] of STORES) {
            const label = `${who} · ${what}`;
            const mail = renderShopDigest(f, env(viewer, access, language, store));
            expect(mail, label).toEqual(base);
            expect(preheaderOf(mail.html), label).toBe(preheaderOf(base.html));
            const sections = composeShopSections(f, language, BASE, false, viewer, access, store);
            expect(statuses(sections), label).toEqual(statuses(baseSections));
            expect(sections, label).toEqual(baseSections);
            for (const body of [mail.text, mail.html]) expect(holdsNone(body, allWords(language)), label).toBe(true);
          }
        }
      }
    });
    it(`unified digest (${language}): both shops, nothing moves`, () => {
      for (const [who, viewer, access] of refused("unified")) {
        const base = renderUnifiedDigest(unified(), env(viewer, access, language));
        for (const [what, store] of STORES) {
          const mail = renderUnifiedDigest(unified(), env(viewer, access, language, store));
          expect(mail, `${who} · ${what}`).toEqual(base);
          expect(holdsNone(mail.text, allWords(language)), `${who} · ${what}`).toBe(true);
        }
      }
    });
  }
  it("the equality is not vacuous: the same fact shapes DO move an owner's email", () => {
    const o = recipient("owner", [], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("owner", null));
    const base = renderShopDigest(facts(SHOP_A), env(o.viewer, o.access, "en"));
    for (const [what, store] of STORES.slice(2)) expect(renderShopDigest(facts(SHOP_A), env(o.viewer, o.access, "en", store)).text, what).not.toBe(base.text);
  });
});

// ── 3. The switch off: byte-identical to the goldens rendered before PR 4's composer edits ───

describe("switch off = byte-identical (goldens from the head before PR 4's composer edits)", () => {
  const file = JSON.parse(readFileSync(path.join(__dirname, "fixtures/digest-labor-goldens/goldens.json"), "utf8")) as { headSha: string; cases: Record<string, GoldenMail> };
  it("the goldens record the head they were rendered from", () => {
    expect(file.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(file.cases).sort()).toEqual(GOLDEN_CASES.map((c) => c.name).sort());
  });
  for (const c of GOLDEN_CASES) {
    it(`${c.name}: laborMoney absent and null`, () => {
      const golden = file.cases[c.name]!;
      for (const laborMoney of [undefined, null]) {
        const e = { ...goldenEnvelope(c), ...(laborMoney === null ? { laborMoney } : {}) };
        const m = c.digest === "shop" ? renderShopDigest(goldenShop(SHOP_A), e) : renderUnifiedDigest(goldenUnified(), e);
        expect({ subject: m.subject, preheader: preheaderOf(m.html), html: m.html, text: m.text }).toEqual(golden);
      }
    });
  }
});

// ── 4. A GM whose settings hide the only over-target line ─────────────────────────────────────

describe("a GM whose settings hide the only over-target line shows no issue for it", () => {
  const over = laborStore(hourlyFacts({ latestFinalDay: overTargetDay() }), roleFacts());
  for (const language of LANGS) {
    it(`hourly cost off: subject, preheader, statuses, HTML and text are the email without labor money (${language})`, () => {
      const s = { ...gmVisibilityCombinations().find((x) => x.report && !x.hourly_cost && x.people)! };
      const r = recipient("gm", [A], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("gm", { kind: "settings", settings: s }));
      const f = facts(SHOP_A);
      expect(renderShopDigest(f, env(r.viewer, r.access, language, over))).toEqual(renderShopDigest(f, env(r.viewer, r.access, language)));
      expect(statuses(composeShopSections(f, language, BASE, false, r.viewer, r.access, over))).toEqual(statuses(composeShopSections(f, language, BASE, false, r.viewer, r.access)));
    });
  }
  it("and with hourly cost on (the defaults) the same facts DO raise the issue (not vacuous)", () => {
    const r = recipient("gm", [A], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("gm", { kind: "settings", settings: null }));
    const title = serverT("en", "digest.v2.section.labor");
    const labor = (store: LaborMoneyStore) => composeShopSections(facts(SHOP_A), "en", BASE, false, r.viewer, r.access, store).find((s) => s.title === title)!.status!;
    expect(labor(over).issues).toBe(1);
    expect(labor(laborStore(hourlyFacts(), roleFacts())).issues).toBe(0);
  });
});

// ── 5. Capability isolation (L7) ─────────────────────────────────────────────────────────────

describe("capability isolation: hourly cost on, cost by role off", () => {
  const s = { ...gmVisibilityCombinations().find((x) => x.report && x.hourly_cost && x.people && !x.person_cost && !x.loaded)! };
  const r = recipient("gm", [A], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("gm", { kind: "settings", settings: s }));
  const ROLES: Array<[string, Parameters<typeof laborStore>[1]]> = [["absent", null], ["ok", roleFacts()], ["unavailable", { kind: "unavailable" }],
    ["omitted", { kind: "omitted" }], ["ok, rounded + estimated", roleFacts({ roundedSeparately: true, wageEstimated: true })]];
  for (const language of LANGS) {
    it(`the whole email is byte-identical with the role facts absent, ok, unavailable, omitted (never settling = absent); overflow included (${language})`, () => {
      const f = facts(SHOP_A);
      const base = renderShopDigest(f, env(r.viewer, r.access, language, laborStore(hourlyFacts(), null)));
      const sections = composeShopSections(f, language, BASE, false, r.viewer, r.access, laborStore(hourlyFacts(), null));
      // The Labor section itself folds for this GM (so "and N more" is part of what must not move).
      expect(sections.find((x) => x.title === serverT(language, "digest.v2.section.labor"))!.lines.some((l) => /^(and \d+ more|y \d+ más)$/.test(l.label))).toBe(true);
      expect(holds(base.text, groupWords(language).hourly)).toBe(true);
      for (const [what, roles] of ROLES) {
        expect(renderShopDigest(f, env(r.viewer, r.access, language, laborStore(hourlyFacts(), roles))), what).toEqual(base);
        expect(composeShopSections(f, language, BASE, false, r.viewer, r.access, laborStore(hourlyFacts(), roles)), what).toEqual(sections);
      }
    });
  }
  it("a failed week-so-far part leaves F1 and F3 as they are", () => {
    const owner = recipient("owner", [], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("owner", null));
    const title = serverT("en", "digest.v2.section.labor");
    const big = (store: LaborMoneyStore) => finishSection({ title, lines: laborSectionWithMoney(
      { t: translator("en"), language: "en", baseUrl: BASE, locationId: A, day: D, viewer: owner.viewer }, facts(SHOP_A).v2!, store), cap: 99 },
    { t: translator("en"), can: () => true })!.lines;
    const ok1 = big(laborStore(hourlyFacts(), roleFacts())), bad = big(laborStore(hourlyFacts({ weekSoFar: UNAVAILABLE }), roleFacts()));
    const named = (ls: typeof ok1, key: "digest.labor_money.latest_label_plain" | "digest.labor_money.last_week_label_plain") =>
      ls.find((l) => l.label.startsWith(serverT("en", key)));
    expect(named(bad, "digest.labor_money.latest_label_plain")).toEqual(named(ok1, "digest.labor_money.latest_label_plain"));
    expect(named(bad, "digest.labor_money.last_week_label_plain")).toEqual(named(ok1, "digest.labor_money.last_week_label_plain"));
  });
  it("Toast labor for D absent or failed leaves every money line", () => {
    const owner = recipient("owner", [], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("owner", null));
    const store = laborStore(hourlyFacts(), roleFacts());
    const money = (over: Partial<ShopV2Facts>) => laborSectionWithMoney({ t: translator("en"), language: "en", baseUrl: BASE, locationId: A, day: D, viewer: owner.viewer },
      facts(SHOP_A, over).v2!, store).filter((l) => l.needs?.startsWith("labor_"));
    const base = money({});
    expect(base.length).toBe(5);
    expect(money({ labor: undefined })).toEqual(base);
    expect(money({ labor: failed() })).toEqual(base);
    // And with no Toast labor and no schedule at all, the Labor section still exists for a holder.
    const bare = shopFacts(SHOP_A, { labor: undefined });
    const titles = composeShopSections(bare, "en", BASE, false, owner.viewer, owner.access, store).map((x) => x.title);
    expect(titles).toContain(serverT("en", "digest.v2.section.labor"));
    expect(composeShopSections(bare, "en", BASE, false, owner.viewer, owner.access).map((x) => x.title)).not.toContain(serverT("en", "digest.v2.section.labor"));
  });
});

// ── 6. PR 2's staffing line keeps its gate and its place ──────────────────────────────────────

describe("PR 2's staffing line keeps needs: published_staffing and its place", () => {
  const owner = recipient("owner", [], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("owner", null));
  const lines = () => laborSectionWithMoney({ t: translator("en"), language: "en", baseUrl: BASE, locationId: A, day: D, viewer: owner.viewer },
    facts(SHOP_A).v2!, laborStore(hourlyFacts(), roleFacts()));
  const vs = serverT("en", "digest.staffing.vs_label");
  it("labor money without staffing: no staffing line (the cut is by needs, not by role)", () => {
    const can = (cap: DigestCapability) => cap.startsWith("labor_");
    const s = finishSection({ title: "Labor", lines: lines(), cap: 99 }, { t: translator("en"), can })!;
    expect(s.lines.some((l) => l.label === vs)).toBe(false);
    expect(s.lines.length).toBe(9);
  });
  for (const language of LANGS) {
    it(`staffing without labor money (a GM with the report off): PR 2's Labor section byte for byte (${language})`, () => {
      const off = gmVisibilityCombinations().find((x) => !x.report)!;
      const r = recipient("gm", [A], { kind: "gm_shop", shops: [A] }, laborBusinessAccess("gm", { kind: "settings", settings: off }));
      expect(r.access!.business ?? null).toBeNull();
      const f = facts(SHOP_A);
      expect(renderShopDigest(f, env(r.viewer, r.access, language, laborStore(hourlyFacts(), roleFacts())))).toEqual(renderShopDigest(f, env(r.viewer, r.access, language)));
      expect(renderShopDigest(f, env(r.viewer, r.access, language)).text).toContain(serverT(language, "digest.staffing.vs_label"));
    });
  }
});

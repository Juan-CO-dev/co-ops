/**
 * Digests round 3, PR 1b (plan §3.1, §3.3, §3.5): the deep links that depend on a screen change — the pipeline
 * filtered to a day and shop, the pipeline's follow-ups / stage board, Prep demand by shop / tab / day, Ordering's
 * parts and counts on hand — each with its path and the gate of the page it opens; the section → link maps of both
 * digests; the "live" label on a section whose screen shows the current day; and the sign-in fragment rule accepting
 * every new anchor.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  composeCateringSections,
  composeShopSections,
  renderShopDigest,
  type CateringFacts,
  type CateringLeadFact,
  type DigestSection,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";
import { canOpen, digestLink, isLiveTarget, NO_ACCESS_VIEWER, sectionLink, targetPath, type DigestTarget, type LinkViewer } from "@/lib/report-digests-links";
import { DIGEST_ANCHORS } from "@/lib/report-digests-anchors-shared";
import { withReturnFragment } from "@/lib/nav-redirect";
import { ok } from "@/lib/report-digests-v2-shared";
import { v2Fixture } from "./fixtures/digest-v2";

const BASE = "https://ops.example.com";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = "2026-10-07";
const TOMORROW = "2026-10-08";

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const AGM_A: LinkViewer = { role: "agm", level: 6, locations: [A] };
const MOO: LinkViewer = { role: "moo", level: 8, locations: [] };
const OWNER: LinkViewer = { role: "owner", level: 9, locations: [] };
const CATERING_MGR_A: LinkViewer = { role: "catering_mgr", level: 6, locations: [A] };
const SHIFT_LEAD_A: LinkViewer = { role: "shift_lead", level: 5, locations: [A] };
const SMM_A: LinkViewer = { role: "social_media_mgr", level: 6, locations: [A] };
const KEY_HOLDER_A: LinkViewer = { role: "key_holder", level: 4, locations: [A] };

const booked = (location: string, day = DAY): DigestTarget => ({ to: "pipeline", day, location, view: "booked" });

describe("paths", () => {
  const cases: Array<[DigestTarget, string]> = [
    [booked(A), `/catering/pipeline?day=${DAY}&location=${A}&view=booked`],
    [booked("none"), `/catering/pipeline?day=${DAY}&location=none&view=booked`],
    [{ to: "pipeline", anchor: "follow_ups" }, "/catering/pipeline#follow-ups"],
    [{ to: "pipeline", anchor: "stages" }, "/catering/pipeline#pipeline-stages"],
    [{ to: "pipeline", anchor: "to_ring" }, "/catering/pipeline#to-ring-in-toast"],
    [{ to: "prep_demand", location: A, tab: "sku" }, `/admin/catering/prep-demand?location=${A}&tab=sku`],
    [{ to: "prep_demand", location: A, tab: "prep", day: DAY }, `/admin/catering/prep-demand?location=${A}&tab=prep#prep-day-${DAY}`],
    [{ to: "prep_demand", location: A, day: DAY }, `/admin/catering/prep-demand?location=${A}#prep-day-${DAY}`],
    // The day sections live on the Prep tab: no day anchor on another tab.
    [{ to: "prep_demand", location: A, tab: "sku", day: DAY }, `/admin/catering/prep-demand?location=${A}&tab=sku`],
    [{ to: "prep_demand" }, "/admin/catering/prep-demand"],
    [{ to: "ordering", location: A, anchor: "today" }, `/ordering?location=${A}#todays-orders`],
    [{ to: "ordering", location: A, anchor: "missed" }, `/ordering?location=${A}#missed-cutoffs`],
    [{ to: "ordering", location: A, anchor: "cutoffs" }, `/ordering?location=${A}#order-cutoffs`],
    [{ to: "ordering", location: A, anchor: "walk" }, `/ordering?location=${A}#order-walk`],
    // A PO is its own dated panel; an anchor never rides with it.
    [{ to: "ordering", location: A, po: "po-1", anchor: "walk" }, `/ordering?location=${A}&po=po-1`],
    [{ to: "counts", location: A, anchor: "on_hand" }, `/operations/counts?location=${A}#on-hand`],
  ];
  it.each(cases)("%j → %s", (t, path) => expect(targetPath(t)).toBe(path));

  it("the day filter is all three params or no link; the day must be a real calendar day", () => {
    expect(digestLink({ baseUrl: BASE }, { to: "pipeline", day: DAY })).toBeNull();
    expect(digestLink({ baseUrl: BASE }, { to: "pipeline", location: A, view: "booked" })).toBeNull();
    expect(digestLink({ baseUrl: BASE }, { to: "pipeline", day: DAY, location: A })).toBeNull();
    expect(digestLink({ baseUrl: BASE }, booked(A, "2026-02-31"))).toBeNull();
    expect(digestLink({ baseUrl: BASE }, booked("Shop A"))).toBeNull();
    expect(digestLink({ baseUrl: BASE }, { to: "prep_demand", location: A, day: "2026-02-31" })).toBeNull();
    expect(digestLink({ baseUrl: BASE }, booked(A, "2026-02-31"), { to: "pipeline" })).toBe(`${BASE}/catering/pipeline`);
  });
});

describe("gates: the page's own rule, for every recipient kind", () => {
  // [viewer, pipeline filtered to shop A, to shop B, to `none`, prep demand at A, at B, ordering #walk at A, counts #on-hand at A]
  const rows: Array<[string, LinkViewer | null, boolean, boolean, boolean, boolean, boolean, boolean, boolean]> = [
    ["GM, own shop A", GM_A, true, false, true, true, false, true, true],
    ["AGM, own shop A", AGM_A, true, false, true, true, false, true, true],
    // Level 8 reads every shop's pipeline; Prep demand lists every shop only at 9+; the floor screens need a membership below 9.
    ["MoO, no membership", MOO, true, true, true, false, false, false, false],
    ["owner", OWNER, true, true, true, true, true, true, true],
    // The catering manager reads every shop's pipeline; Prep demand lists only their own shops.
    ["catering manager, member of A", CATERING_MGR_A, true, true, true, true, false, true, true],
    ["shift lead (level 5), A", SHIFT_LEAD_A, true, false, true, false, false, true, false],
    // Level 6 opens the board and the admin shell; mirrored as the pages decide.
    ["social media manager, A", SMM_A, true, false, true, true, false, true, true],
    ["key holder (level 4)", KEY_HOLDER_A, false, false, false, false, false, true, false],
    ["unknown recipient", NO_ACCESS_VIEWER, false, false, false, false, false, false, false],
    ["null viewer", null, false, false, false, false, false, false, false],
  ];
  it.each(rows)("%s", (_name, v, pA, pB, pNone, prepA, prepB, walkA, onHandA) => {
    expect(canOpen(v, booked(A))).toBe(pA);
    expect(canOpen(v, booked(B))).toBe(pB);
    expect(canOpen(v, booked("none"))).toBe(pNone);
    expect(canOpen(v, { to: "prep_demand", location: A, tab: "sku" })).toBe(prepA);
    expect(canOpen(v, { to: "prep_demand", location: B, tab: "prep", day: DAY })).toBe(prepB);
    expect(canOpen(v, { to: "ordering", location: A, anchor: "walk" })).toBe(walkA);
    expect(canOpen(v, { to: "counts", location: A, anchor: "on_hand" })).toBe(onHandA);
  });

  it("a pipeline link for a shop outside the reader's scope is not built (the chain falls back to the plain board)", () => {
    expect(digestLink({ baseUrl: BASE, viewer: GM_A }, booked(B))).toBeNull();
    expect(digestLink({ baseUrl: BASE, viewer: GM_A }, booked(B), { to: "pipeline" })).toBe(`${BASE}/catering/pipeline`);
    // A Prep demand link for an unlisted shop is no link at all (the page would show another shop).
    expect(digestLink({ baseUrl: BASE, viewer: CATERING_MGR_A }, { to: "prep_demand", location: B, tab: "sku" })).toBeNull();
  });

  it("the anchors never widen a gate: same answer with and without them", () => {
    for (const v of [GM_A, AGM_A, MOO, OWNER, CATERING_MGR_A, SHIFT_LEAD_A, SMM_A, KEY_HOLDER_A, NO_ACCESS_VIEWER]) {
      expect(canOpen(v, { to: "pipeline", anchor: "follow_ups" })).toBe(canOpen(v, { to: "pipeline" }));
      expect(canOpen(v, { to: "pipeline", anchor: "stages" })).toBe(canOpen(v, { to: "pipeline" }));
      for (const anchor of ["today", "missed", "cutoffs", "walk"] as const) expect(canOpen(v, { to: "ordering", location: A, anchor })).toBe(canOpen(v, { to: "ordering", location: A }));
      expect(canOpen(v, { to: "counts", location: A, anchor: "on_hand" })).toBe(canOpen(v, { to: "counts", location: A }));
    }
  });
});

describe("live vs dated (plan §3.3)", () => {
  it("live: ordering (not a PO), counts, prep demand, stations, the mid-shift pulse; everything else dated", () => {
    expect(isLiveTarget({ to: "ordering", location: A, anchor: "walk" })).toBe(true);
    expect(isLiveTarget({ to: "ordering", location: A, po: "p" })).toBe(false);
    expect(isLiveTarget({ to: "counts", location: A, anchor: "on_hand" })).toBe(true);
    expect(isLiveTarget({ to: "prep_demand", location: A })).toBe(true);
    expect(isLiveTarget({ to: "stations", location: A })).toBe(true);
    expect(isLiveTarget({ to: "mid_shift", location: A })).toBe(true);
    expect(isLiveTarget(booked(A))).toBe(false);
    expect(isLiveTarget({ to: "sales", location: A, day: DAY })).toBe(false);
  });
  it("a section's live flag follows the target the recipient actually gets", () => {
    // A GM gets Sales for the day (dated); an AGM, below the Sales floor, gets the live pulse.
    const chain: DigestTarget[] = [{ to: "sales", location: A, day: DAY }, { to: "mid_shift", location: A }];
    expect(sectionLink({ baseUrl: BASE, viewer: GM_A }, ...chain).live).toBe(false);
    expect(sectionLink({ baseUrl: BASE, viewer: AGM_A }, ...chain).live).toBe(true);
    expect(sectionLink({ baseUrl: BASE, viewer: NO_ACCESS_VIEWER }, ...chain)).toEqual({ href: null, live: false });
  });
});

// ── The shop digest's map ─────────────────────────────────────────────────────────────────────
function shop(loc: string, name: string): ShopDayFacts {
  return {
    location: { id: loc, name }, day: DAY, reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 },
    tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null,
    v2: v2Fixture({
      ordering: ok({
        day: {
          placed: [], unsent: [], late: [], unverified: [],
          missed: [{ vendorId: "v", vendorName: "Baldor", cutoffTime: "10:00:00", suggestedLines: 3 }],
        },
        deliveries: { due: [], overdue: [], undated: [] },
        cutoffsTomorrow: [{ vendorId: "v", vendorName: "Sysco", cutoffTime: "11:00:00", ordered: false, hasDraft: false }],
        vendorNames: { v: "Vendor" },
      }),
      inventory: ok({ walk: { out: [{ name: "Ham" }], belowPar: [{ name: "Rolls" }] }, waste: [], storeRuns: { runs: 0, cents: 0, unknownCents: 0 } }),
      catering: ok({ day: { orders: 0, completedCents: 0, confirmedCents: 0 }, tomorrow: [{ id: "l1", name: "Party", timeWindow: "12:00", headcount: 20, isDelivery: false }] }),
    } as never),
  };
}
const line = (s: DigestSection[], section: string, label: string) =>
  s.find((x) => x.title.startsWith(section))!.lines.find((l) => l.label === label)!;
const sectionMap = (s: DigestSection[]) => Object.fromEntries(s.map((x) => [x.title.replace(/ · .*| \(.*/, ""), [x.href ?? null, x.live ?? false]]));

describe("shop digest: section and line map (plan §3.5)", () => {
  it("GM, own shop: each section's link and whether it is live", () => {
    expect(sectionMap(composeShopSections(shop(A, "Shop A"), "en", BASE, false, GM_A))).toEqual({
      Headline: [`${BASE}/reports/sales?location=${A}&range=custom&from=${DAY}&to=${DAY}`, false],
      Ordering: [`${BASE}/ordering?location=${A}#todays-orders`, true],
      Receiving: [`${BASE}/operations/receiving?location=${A}#recent-deliveries`, false],
      Inventory: [`${BASE}/operations/counts?location=${A}#on-hand`, true],
      Operations: [`${BASE}/reports/operations?location=${A}&range=custom&from=${DAY}&to=${DAY}`, false],
      "Sales detail": [`${BASE}/reports/sales?location=${A}&range=custom&from=${DAY}&to=${DAY}`, false],
      People: [`${BASE}/reports/trends/team?location=${A}`, false],
      Tomorrow: [`${BASE}/ordering?location=${A}#order-cutoffs`, true],
    });
  });

  it("GM, own shop: the lines open their own part of the screen", () => {
    const s = composeShopSections(shop(A, "Shop A"), "en", BASE, false, GM_A);
    expect(line(s, "Ordering", "Baldor").href).toBe(`${BASE}/ordering?location=${A}#missed-cutoffs`);
    expect(line(s, "Ordering", "POs placed").href).toBe(`${BASE}/ordering?location=${A}#todays-orders`);
    expect(line(s, "Inventory", "Out (walk)").href).toBe(`${BASE}/ordering?location=${A}#order-walk`);
    expect(line(s, "Inventory", "Below par (walk)").href).toBe(`${BASE}/ordering?location=${A}#order-walk`);
    // Tosses keep the counts page (the AM prep report is not confirmed to show batch tosses).
    expect(line(s, "Inventory", "Tosses / waste").href).toBe(`${BASE}/operations/counts?location=${A}`);
    expect(line(s, "Tomorrow", "Sysco").href).toBe(`${BASE}/ordering?location=${A}#order-cutoffs`);
    expect(line(s, "Tomorrow", "Catering tomorrow").href).toBe(`${BASE}/catering/pipeline?day=${TOMORROW}&location=${A}&view=booked`);
    // With no missed cutoff, the "no missed" line opens today's orders.
    const calm = shop(A, "Shop A");
    (calm.v2!.ordering as { value: { day: { missed: unknown[] } } }).value.day.missed = [];
    expect(line(composeShopSections(calm, "en", BASE, false, GM_A), "Ordering", "Order cutoffs").href).toBe(`${BASE}/ordering?location=${A}#todays-orders`);
  });

  it("an AGM (own shop): the same floor screens; the headline is the live pulse", () => {
    const m = sectionMap(composeShopSections(shop(A, "Shop A"), "en", BASE, false, AGM_A));
    expect(m.Headline).toEqual([`${BASE}/mid-shift?location=${A}`, true]);
    expect(m.Ordering).toEqual([`${BASE}/ordering?location=${A}#todays-orders`, true]);
    expect(m.Inventory).toEqual([`${BASE}/operations/counts?location=${A}#on-hand`, true]);
  });

  it("a MoO with no membership: no floor-screen links, but tomorrow's catering opens the filtered board", () => {
    const s = composeShopSections(shop(A, "Shop A"), "en", BASE, false, MOO);
    const m = sectionMap(s);
    expect(m.Ordering).toEqual([null, false]);
    expect(m.Inventory).toEqual([null, false]);
    expect(m.Tomorrow).toEqual([null, false]);
    expect(line(s, "Tomorrow", "Catering tomorrow").href).toBe(`${BASE}/catering/pipeline?day=${TOMORROW}&location=${A}&view=booked`);
  });

  it("a shop outside the reader's pipeline scope: tomorrow's catering is the plain board, never that shop's filter", () => {
    const s = composeShopSections(shop(B, "Shop B"), "en", BASE, false, GM_A);
    expect(line(s, "Tomorrow", "Catering tomorrow").href).toBe(`${BASE}/catering/pipeline`);
  });

  it("the email labels a live section's link, in English and Spanish; text and HTML", () => {
    for (const [lang, dated, live] of [
      ["en", "Open this in the app →", "Open this in the app (live: shows the current day) →"],
      ["es", "Abrir esto en la app →", "Abrir esto en la app (en vivo: muestra el día actual) →"],
    ] as const) {
      const mail = renderShopDigest(shop(A, "Shop A"), { language: lang, baseUrl: BASE, viewer: GM_A });
      expect(mail.html.split(live).length - 1).toBe(3);
      expect(mail.html.split(dated).length - 1).toBe(5);
      expect(mail.text).toContain(`${live} ${BASE}/ordering?location=${A}#todays-orders`);
      expect(mail.text).toContain(`${dated} ${BASE}/reports/operations?location=${A}&range=custom&from=${DAY}&to=${DAY}`);
    }
  });
});

// ── The catering digest's map ─────────────────────────────────────────────────────────────────
const TODAY = DAY;
const lead = (over: Partial<CateringLeadFact>): CateringLeadFact => ({
  id: "lead-1", contactName: "Jane", company: null, eventDate: TODAY, timeWindow: "11:30", headcount: 20,
  stage: "confirmed", leadSource: "phone", locationId: A, createdDay: "2026-10-01", followUpDate: null, externalRef: null,
  isDelivery: false, valueCents: 50000, dueCents: 0, prep: null, ...over,
});
const facts = (leads: CateringLeadFact[]): CateringFacts => ({
  today: TODAY, leads, lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [],
  readiness: { [A]: ok({ rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 }) as never, [B]: ok({ rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 }) as never },
  staff: { [A]: ok({ onStation: [] }) as never, [B]: ok({ onStation: [] }) as never },
});
const both = { locations: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }], includeUnassigned: true };
const cateringMap = (s: DigestSection[]) => s.map((x) => [x.title.replace(/ \(.*/, ""), x.href ?? null, x.live ?? false]);

describe("catering digest: section and line map (plan §3.5)", () => {
  it("catering manager (member of A, reads every shop): today / tomorrow filtered per shop, `none` for no shop", () => {
    const s = composeCateringSections(facts([lead({}), lead({ id: "lead-2", locationId: null })]), both, "en", BASE, CATERING_MGR_A);
    const map = cateringMap(s);
    expect(map.filter(([t]) => String(t).includes("Today") || String(t).includes("tomorrow"))).toEqual([
      ["Shop A · Today", `${BASE}/catering/pipeline?day=${TODAY}&location=${A}&view=booked`, false],
      ["Shop A · Early tomorrow", `${BASE}/catering/pipeline?day=${TOMORROW}&location=${A}&view=booked`, false],
      ["Shop B · Today", `${BASE}/catering/pipeline?day=${TODAY}&location=${B}&view=booked`, false],
      ["Shop B · Early tomorrow", `${BASE}/catering/pipeline?day=${TOMORROW}&location=${B}&view=booked`, false],
      ["No shop set · Today", `${BASE}/catering/pipeline?day=${TODAY}&location=none&view=booked`, false],
      ["No shop set · Early tomorrow", `${BASE}/catering/pipeline?day=${TOMORROW}&location=none&view=booked`, false],
    ]);
    // The empty day's line opens the same filtered board.
    const bToday = s.find((x) => x.title.startsWith("Shop B · Today"))!;
    expect(bToday.lines[0]!.href).toBe(`${BASE}/catering/pipeline?day=${TODAY}&location=${B}&view=booked`);
  });

  it("readiness → the shop's SKU tab; the no-prep footnote → that day's Prep section; only for a shop the page lists", () => {
    const s = composeCateringSections(facts([lead({}), lead({ id: "lead-b", locationId: B })]), both, "en", BASE, CATERING_MGR_A);
    const lines = (title: string) => s.find((x) => x.title.startsWith(title))!.lines;
    expect(lines("Shop A · Today").find((l) => l.label === "Inventory for today")!.href).toBe(`${BASE}/admin/catering/prep-demand?location=${A}&tab=sku`);
    expect(lines("Shop A · Today").find((l) => l.label === "Today")!.href).toBe(`${BASE}/admin/catering/prep-demand?location=${A}&tab=prep#prep-day-${TODAY}`);
    // Shop B is not one Prep demand would list for this catering manager: readiness unlinked, the footnote keeps the board.
    expect(lines("Shop B · Today").find((l) => l.label === "Inventory for today")!.href).toBeNull();
    expect(lines("Shop B · Today").find((l) => l.label === "Today")!.href).toBe(`${BASE}/catering/pipeline`);
  });

  it("new inquiries → the stage board; overdue follow-ups and 'Needs action' → the follow-ups list (else the stage board)", () => {
    const yesterday = "2026-10-06";
    const s = composeCateringSections(facts([
      lead({ id: "new", stage: "inquiry", createdDay: yesterday, eventDate: null }),
      lead({ id: "late", stage: "quote_sent", followUpDate: "2026-10-01", eventDate: null }),
    ]), { locations: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }], includeUnassigned: false }, "en", BASE, GM_A);
    const y = s.find((x) => x.title.startsWith("Shop A · Yesterday"))!.lines;
    expect(y.find((l) => l.label === "Inquiries")!.href).toBe(`${BASE}/catering/pipeline#pipeline-stages`);
    expect(y.find((l) => l.text.includes("follow-up"))!.href).toBe(`${BASE}/catering/pipeline#follow-ups`);
    expect(s.find((x) => x.title === "Shop A · Needs action")!.href).toBe(`${BASE}/catering/pipeline#follow-ups`);
    // Shop B has no follow-up due: its "Needs action" opens the stage board.
    expect(s.find((x) => x.title === "Shop B · Needs action")!.href).toBe(`${BASE}/catering/pipeline#pipeline-stages`);
  });

  it("a GM of A reading shop B's sections (outside their scope): never shop B's filter, never its Prep demand", () => {
    const s = composeCateringSections(facts([lead({ locationId: B })]), { locations: [{ id: B, name: "Shop B" }], includeUnassigned: false }, "en", BASE, GM_A);
    const hrefs = s.flatMap((x) => [x.href, ...x.lines.map((l) => l.href)]).filter((h): h is string => !!h);
    for (const h of hrefs) {
      expect(h).not.toContain(`location=${B}&view=booked`);
      expect(h).not.toContain("/admin/catering/prep-demand");
    }
    expect(s.find((x) => x.title.startsWith("Shop B · Today"))!.href).toBe(`${BASE}/catering/pipeline`);
  });

  it("a level-5 recipient: the filtered board for their shop, no Prep demand link", () => {
    const s = composeCateringSections(facts([lead({})]), { locations: [{ id: A, name: "Shop A" }], includeUnassigned: false }, "en", BASE, SHIFT_LEAD_A);
    expect(s.find((x) => x.title.startsWith("Shop A · Today"))!.href).toBe(`${BASE}/catering/pipeline?day=${TODAY}&location=${A}&view=booked`);
    const hrefs = s.flatMap((x) => [x.href, ...x.lines.map((l) => l.href)]).filter((h): h is string => !!h);
    expect(hrefs.some((h) => h.includes("/admin/catering/prep-demand"))).toBe(false);
  });

  it("no PII in any URL, in both languages", () => {
    for (const lang of ["en", "es"] as const) {
      const s = composeCateringSections(facts([lead({ contactName: "Jane Doe", company: "Acme" })]), both, lang, BASE, OWNER);
      for (const h of s.flatMap((x) => [x.href, ...x.lines.map((l) => l.href)]).filter((x): x is string => !!x)) {
        for (const pii of ["Jane", "Doe", "Acme"]) expect(h).not.toContain(pii);
      }
    }
  });
});

describe("the sign-in fragment rule accepts every new anchor (lib/nav-redirect.ts withReturnFragment)", () => {
  const ids = [
    DIGEST_ANCHORS.pipelineFollowUps, DIGEST_ANCHORS.pipelineStages, DIGEST_ANCHORS.pipelineToRing, DIGEST_ANCHORS.lead("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    DIGEST_ANCHORS.orderingToday, DIGEST_ANCHORS.orderingMissed, DIGEST_ANCHORS.orderingCutoffs, DIGEST_ANCHORS.orderingWalk,
    DIGEST_ANCHORS.countsOnHand, DIGEST_ANCHORS.prepDay("2026-11-27"), DIGEST_ANCHORS.receivingRecent, DIGEST_ANCHORS.receivingCredits,
  ];
  it.each(ids)("#%s survives the sign-in round trip", (id) => {
    expect(withReturnFragment("/x?location=y&tab=prep", `#${id}`)).toBe(`/x?location=y&tab=prep#${id}`);
  });
  it("every anchor the link builder emits is one of them", () => {
    const emitted: DigestTarget[] = [
      { to: "pipeline", anchor: "follow_ups" }, { to: "pipeline", anchor: "stages" }, { to: "pipeline", anchor: "to_ring" },
      { to: "ordering", location: A, anchor: "today" }, { to: "ordering", location: A, anchor: "missed" },
      { to: "ordering", location: A, anchor: "cutoffs" }, { to: "ordering", location: A, anchor: "walk" },
      { to: "counts", location: A, anchor: "on_hand" }, { to: "prep_demand", location: A, tab: "prep", day: "2026-11-27" },
    ];
    for (const t of emitted) {
      const hash = targetPath(t).split("#")[1]!;
      expect(ids).toContain(hash);
      expect(withReturnFragment("/next", `#${hash}`)).toBe(`/next#${hash}`);
    }
  });
});

describe("i18n: the new strings ship en + es together, with the same {params}", () => {
  const keys = ["digest.section.open_live", "catering.pipeline.day_filter.showing", "catering.pipeline.day_filter.showing_none", "catering.pipeline.day_filter.show_all"];
  it.each(keys)("%s", (key) => {
    const e = (en as Record<string, string>)[key];
    const s = (es as Record<string, string>)[key];
    expect(e, key).toBeTruthy();
    expect(s, key).toBeTruthy();
    const params = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort();
    expect(params(s!)).toEqual(params(e!));
    expect(s).not.toBe(e);
  });
});

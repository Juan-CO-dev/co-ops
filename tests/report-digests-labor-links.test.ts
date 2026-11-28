/**
 * Digests round 3, PR 4: the `business` link target (plan §3.3 "Links", contract §7). The path and query the business
 * report page reads; the gate per role and per setting; no link for a span that is not finished at send time, for a
 * recipient without the report, with the switches off or without `viewer.business`; F5's People tab and its Team
 * fallback; the chain down to Team and then to no link.
 */
import { describe, expect, it } from "vitest";
import { GM_VISIBILITY_DEFAULTS, gmVisibilityCombinations, type GmVisibility } from "@/lib/business-access-shared";
import { parseBusinessRangeRequest, businessTab } from "@/lib/business-report-shared";
import { laborMoneyLines } from "@/lib/report-digests-labor-compose";
import { canOpen, digestLink, isLiveTarget, targetPath, type DigestTarget, type LinkViewer } from "@/lib/report-digests-links";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { A, B, BASE, D } from "./fixtures/digest-staffing";
import { businessOf, FINISHED_THROUGH, hourlyFacts, LAST_FROM, LAST_TO, LATEST, laborStore, recipient, roleFacts, WEEK_START } from "./fixtures/digest-labor";

const span = (from: string, through: string, tab?: "people"): DigestTarget => ({ to: "business", location: A, from, through, ...(tab ? { tab } : {}) });
const viewerOf = (role: string, locations: string[], settings: GmVisibility | null = null, o: { enabled?: boolean; finishedThrough?: string } = {}) =>
  recipient(role, locations, { kind: "gm_shop", shops: [A] }, businessOf(role as "gm", settings), o).viewer;
const TEAM = `${BASE}/reports/trends/team?location=${A}&range=custom&from=${D}&to=${D}`;

describe("the business target: the page's own path and query", () => {
  it("path, range and tab are what the page parses back to the same span", () => {
    const p = targetPath(span(LAST_FROM, LAST_TO));
    expect(p).toBe(`/reports/business?location=${A}&range=custom&from=${LAST_FROM}&to=${LAST_TO}`);
    const q = Object.fromEntries(new URLSearchParams(p.split("?")[1]));
    // The page: ?location= (SHOP_PARAMS_BY_PATH), parseBusinessRangeRequest, businessTab.
    expect(shopParamFor("/reports/business", searchParamValues(q))).toBe(A);
    const r = parseBusinessRangeRequest(q, D);
    expect(r.kind === "range" && [r.range.from, r.range.to]).toEqual([LAST_FROM, LAST_TO]);
    expect(businessTab(q.tab)).toBe("overview");
    const people = Object.fromEntries(new URLSearchParams(targetPath(span(LATEST, LATEST, "people")).split("?")[1]));
    expect(businessTab(people.tab)).toBe("people");
  });
  it("a dated screen (never live); ids and real days only", () => {
    expect(isLiveTarget(span(LATEST, LATEST))).toBe(false);
    const v = viewerOf("owner", []);
    expect(digestLink({ baseUrl: BASE, viewer: v }, span("2026-02-30", "2026-02-30"))).toBeNull();
    expect(digestLink({ baseUrl: BASE, viewer: v }, span(LAST_TO, LAST_FROM))).toBeNull();
    expect(digestLink({ baseUrl: BASE, viewer: v }, { to: "business", location: "not an id!", from: LATEST, through: LATEST })).toBeNull();
    expect(digestLink({ baseUrl: BASE, viewer: v }, span(LATEST, LATEST))).toBe(`${BASE}/reports/business?location=${A}&range=custom&from=${LATEST}&to=${LATEST}`);
  });
  it("an UNSCOPED viewer (fixtures) keeps the house rule: every target opens", () => {
    expect(canOpen(undefined, span(LATEST, LATEST))).toBe(true);
    expect(canOpen(null, span(LATEST, LATEST))).toBe(false);
  });
});

describe("the gate: per role, per setting, finished spans only", () => {
  it("MoO / Owner / CGS: any shop; a GM only a shop they belong to", () => {
    for (const role of ["moo", "owner", "cgs"]) {
      expect(canOpen(viewerOf(role, []), span(LATEST, LATEST)), role).toBe(true);
      expect(canOpen(viewerOf(role, []), { ...span(LATEST, LATEST), location: B } as DigestTarget), role).toBe(true);
    }
    expect(canOpen(viewerOf("gm", [A]), span(LATEST, LATEST))).toBe(true);
    expect(canOpen(viewerOf("gm", [B]), span(LATEST, LATEST))).toBe(false);
    expect(canOpen(viewerOf("owner", []), { ...span(LATEST, LATEST), location: "all" } as DigestTarget)).toBe(false);
  });
  it("every other role is refused even with a full business access carried (by ROLE, never by level)", () => {
    const full = businessOf("owner");
    for (const role of ["agm", "prep_mgr", "catering_mgr", "social_media_mgr", "shift_lead", "key_holder", "employee", "regional_wizard"]) {
      const v: LinkViewer = { role, level: 9, locations: [A], business: { access: full, finishedThrough: FINISHED_THROUGH, enabled: true } };
      expect(canOpen(v, span(LATEST, LATEST)), role).toBe(false);
    }
  });
  it("no viewer.business, the switches off, the report off: no link", () => {
    expect(canOpen({ role: "owner", level: 9, locations: [] }, span(LATEST, LATEST))).toBe(false);
    expect(canOpen(viewerOf("owner", [], null, { enabled: false }), span(LATEST, LATEST))).toBe(false);
    expect(canOpen(viewerOf("gm", [A], { ...GM_VISIBILITY_DEFAULTS, report: false, hourly_cost: false, quarters: false, quarter_cost: false, channels: false,
      people: false, person_cost: false, servers: false, compare: false, export: false }), span(LATEST, LATEST))).toBe(false);
  });
  it("a span that ends after the last finished day is no link (today, a future day)", () => {
    const v = viewerOf("owner", []);
    expect(canOpen(v, span(LATEST, LATEST))).toBe(true);
    expect(canOpen(v, span(LATEST, D))).toBe(false);
    expect(canOpen(v, span(D, D))).toBe(false);
    expect(canOpen(viewerOf("owner", [], null, { finishedThrough: LAST_TO }), span(WEEK_START, LATEST))).toBe(false);
    expect(canOpen(viewerOf("owner", [], null, { finishedThrough: "garbage" }), span(LATEST, LATEST))).toBe(false);
  });
  it("for every coherent GM setting: overview opens iff the report is on; People iff people or servers is on", () => {
    for (const s of gmVisibilityCombinations()) {
      const v = viewerOf("gm", [A], s);
      expect(canOpen(v, span(LATEST, LATEST)), JSON.stringify(s)).toBe(s.report);
      expect(canOpen(v, span(LATEST, LATEST, "people")), JSON.stringify(s)).toBe(s.report && (s.people || s.servers));
    }
  });
});

describe("the lines' links: business for that span, else Team, else none", () => {
  const linksOf = (viewer: LinkViewer | undefined) => {
    const m = laborMoneyLines({ language: "en", baseUrl: BASE, locationId: A, day: D, viewer }, laborStore(hourlyFacts(), roleFacts()))!;
    return { f1: m.f1.href, f2: m.f2!.href, f3: m.f3!.href, f4: m.f4.href, f5: m.f5!.href };
  };
  const biz = (from: string, to: string, tab = "") => `${BASE}/reports/business?location=${A}&range=custom&from=${from}&to=${to}${tab}`;
  it("an owner: each line opens its own finished span; F5 the People tab", () => {
    expect(linksOf(viewerOf("owner", []))).toEqual({
      f1: biz(LATEST, LATEST), f2: biz(WEEK_START, LATEST), f3: biz(LAST_FROM, LAST_TO), f4: biz(LATEST, LATEST), f5: biz(LATEST, LATEST, "&tab=people"),
    });
  });
  it("F5 falls back to Team when the People tab is off for the recipient", () => {
    const v = viewerOf("gm", [A], { ...GM_VISIBILITY_DEFAULTS, people: false, person_cost: false, servers: false });
    expect(linksOf(v).f5).toBe(TEAM);
    expect(linksOf(v).f1).toBe(biz(LATEST, LATEST));
  });
  it("no business access on the viewer: Team; a viewer who cannot open Team either: no link", () => {
    expect(Object.values(linksOf({ role: "gm", level: 7, locations: [A] }))).toEqual([TEAM, TEAM, TEAM, TEAM, TEAM]);
    expect(Object.values(linksOf({ role: "key_holder", level: 4, locations: [A] }))).toEqual([null, null, null, null, null]);
  });
  it("a failure line has no span: Team", () => {
    const m = laborMoneyLines({ language: "en", baseUrl: BASE, locationId: A, day: D, viewer: viewerOf("owner", []) }, laborStore(null, null))!;
    expect([m.f1.href, m.f4.href, m.f5!.href]).toEqual([TEAM, TEAM, TEAM]);
  });
});

/**
 * Digest deep links (Juan 2026-11-23): every section and line links to the exact screen it summarizes,
 * for the right shop and business day, absolute from the base URL, ids only, and only to a screen the
 * recipient can open. The link map per section and per digest kind is pinned here, in both languages.
 */
import { describe, expect, it } from "vitest";
import type { ReportListItem } from "@/lib/reports-hub";
import {
  renderCateringDigest,
  renderShopDigest,
  renderUnifiedDigest,
  composeCateringSections,
  composeShopSections,
  type CateringFacts,
  type CateringLeadFact,
  type DigestSection,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";
import { canOpen, digestLink, NO_ACCESS_VIEWER, targetPath, type DigestTarget, type LinkViewer } from "@/lib/report-digests-links";
import { DIGEST_ANCHORS } from "@/lib/report-digests-anchors-shared";
import { withReturnFragment } from "@/lib/nav-redirect";
import { ok } from "@/lib/report-digests-v2-shared";
import { v2Fixture } from "./fixtures/digest-v2";

const BASE = "https://ops.example.com";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-10-07";
const q = (loc: string, day = DAY, extra = "") => `location=${loc}&range=custom&from=${day}&to=${day}${extra}`;

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const AGM_A: LinkViewer = { role: "agm", level: 6, locations: [A] };
const MOO_NO_MEMBERSHIP: LinkViewer = { role: "moo", level: 8, locations: [] };
const OWNER: LinkViewer = { role: "owner", level: 9, locations: [] };
const CATERING_MGR: LinkViewer = { role: "catering_mgr", level: 6, locations: [A] };
const SHIFT_LEAD_A: LinkViewer = { role: "shift_lead", level: 5, locations: [A] };
const SMM: LinkViewer = { role: "social_media_mgr", level: 6, locations: [A] };

const clean: NonNullable<ReportListItem["signalSummary"]> = { underPar: 0, overPar: 0, skipped: 0, tempFlags: 0, cashOverShortCents: null };
const report = (loc: string, type: ReportListItem["type"], status: string, id = `${type}-${loc.slice(0, 4)}`): ReportListItem =>
  ({ type, id, date: DAY, locationId: loc, submitterName: "Ana", status, signalSummary: { ...clean } });

function shop(loc: string, name: string, over: Partial<ShopDayFacts> = {}): ShopDayFacts {
  return {
    location: { id: loc, name }, day: DAY,
    reports: [report(loc, "opening", "phase2_complete"), report(loc, "closing", "confirmed"), report(loc, "pm", "submitted")],
    receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: { evaluations: 1, needsWork: 0 },
    v2: v2Fixture({
      receiving: ok({ deliveries: [{ id: "dlv-1", vendorName: "Baldor", sourceKind: "vendor", cents: 1000, poDisplayCode: "MEP-1", matchState: "matched", hasReceipt: true, discrepancies: { short: 0, over: 0, damaged: 0, substitution: 0 } }], credits: [], invoicesPendingReview: 2 }),
    } as never),
    ...over,
  };
}

const allHrefs = (sections: DigestSection[]) => sections.flatMap((s) => [s.href ?? null, ...s.lines.flatMap((l) => [l.href, ...(l.items ?? []).map((x) => x.href)])]);

describe("the link map (targetPath)", () => {
  const cases: Array<[DigestTarget, string]> = [
    [{ to: "reports_hub", location: A, day: DAY }, `/reports?${q(A)}`],
    [{ to: "reports_hub", location: "all", day: DAY }, `/reports?${q("all")}`],
    [{ to: "reports_list", location: A, day: DAY, type: "closing" }, `/reports/operations?${q(A, DAY, "&type=closing")}`],
    [{ to: "reports_list", location: A, day: DAY, type: "am_prep", filter: "sf_skipped" }, `/reports/operations?${q(A, DAY, "&type=am_prep&sf_skipped=true")}`],
    [{ to: "report", type: "closing", id: "r1", location: A, day: DAY }, `/reports/closing/r1?${q(A)}`],
    [{ to: "sales", location: A, day: DAY }, `/reports/sales?${q(A)}`],
    [{ to: "sales", location: A, day: DAY, view: "items" }, `/reports/sales?${q(A, DAY, "&view=items")}`],
    [{ to: "sales_catering", location: A, day: DAY }, `/reports/sales/catering?${q(A)}`],
    [{ to: "mid_shift", location: A }, `/mid-shift?location=${A}`],
    [{ to: "ordering", location: A, po: "po-9" }, `/ordering?location=${A}&po=po-9`],
    [{ to: "receiving", location: A, anchor: "recent" }, `/operations/receiving?location=${A}#${DIGEST_ANCHORS.receivingRecent}`],
    [{ to: "receiving", location: A, anchor: "credits" }, `/operations/receiving?location=${A}#${DIGEST_ANCHORS.receivingCredits}`],
    [{ to: "delivery", location: A, id: "dlv-1" }, "/operations/receiving/dlv-1"],
    [{ to: "counts", location: A }, `/operations/counts?location=${A}`],
    [{ to: "vendor_mail", location: A }, `/operations/vendor-mail?location=${A}`],
    [{ to: "team", location: A }, `/reports/trends/team?location=${A}`],
    [{ to: "yield", location: A }, `/operations/production/yield?location=${A}`],
    [{ to: "pipeline" }, "/catering/pipeline"],
    [{ to: "pipeline", lead: "lead-7" }, "/catering/pipeline#lead-lead-7"],
    [{ to: "pipeline", anchor: "to_ring" }, `/catering/pipeline#${DIGEST_ANCHORS.pipelineToRing}`],
    [{ to: "quotes", quote: "qt-1" }, "/catering/quotes?quote=qt-1"],
    [{ to: "prep_demand" }, "/admin/catering/prep-demand"],
    // The stations page reads ?loc=, not ?location= (the old digest link silently opened the default shop).
    [{ to: "stations", location: A }, `/stations?loc=${A}`],
  ];
  it.each(cases)("%j → %s", (target, path) => expect(targetPath(target)).toBe(path));

  it("links are absolute from the base URL (a trailing slash is not doubled)", () => {
    expect(digestLink({ baseUrl: `${BASE}/` }, { to: "pipeline" })).toBe(`${BASE}/catering/pipeline`);
  });

  it("anything that is not an id or a day never rides in a URL", () => {
    expect(digestLink({ baseUrl: BASE }, { to: "pipeline", lead: "Jane Doe" })).toBeNull();
    expect(digestLink({ baseUrl: BASE }, { to: "pipeline", lead: "jane@example.com" }, { to: "pipeline" })).toBe(`${BASE}/catering/pipeline`);
    expect(digestLink({ baseUrl: BASE }, { to: "reports_hub", location: A, day: "yesterday" })).toBeNull();
  });
});

describe("a link the recipient can open (each page's own gate)", () => {
  it("a GM: own shop everywhere, never another shop, never all shops", () => {
    expect(canOpen(GM_A, { to: "sales", location: A, day: DAY })).toBe(true);
    expect(canOpen(GM_A, { to: "sales", location: B, day: DAY })).toBe(false);
    expect(canOpen(GM_A, { to: "reports_hub", location: "all", day: DAY })).toBe(false);
    expect(canOpen(GM_A, { to: "ordering", location: A })).toBe(true);
    expect(canOpen(GM_A, { to: "team", location: A })).toBe(true);
    expect(canOpen(GM_A, { to: "vendor_mail", location: A })).toBe(true);
  });

  it("an AGM below the Sales floor gets the live pulse instead; vendor mail falls back to receiving", () => {
    expect(digestLink({ baseUrl: BASE, viewer: AGM_A }, { to: "sales", location: A, day: DAY }, { to: "mid_shift", location: A })).toBe(`${BASE}/mid-shift?location=${A}`);
    expect(canOpen(AGM_A, { to: "vendor_mail", location: A })).toBe(false);
    expect(canOpen(AGM_A, { to: "counts", location: A })).toBe(true);
  });

  it("a MoO with no membership reads every shop's reports but not the floor screens (lock = membership or 9+)", () => {
    expect(canOpen(MOO_NO_MEMBERSHIP, { to: "reports_hub", location: "all", day: DAY })).toBe(true);
    expect(canOpen(MOO_NO_MEMBERSHIP, { to: "report", type: "closing", id: "r", location: A, day: DAY })).toBe(true);
    expect(canOpen(MOO_NO_MEMBERSHIP, { to: "sales", location: A, day: DAY })).toBe(true);
    expect(canOpen(MOO_NO_MEMBERSHIP, { to: "ordering", location: A })).toBe(false);
    expect(canOpen(MOO_NO_MEMBERSHIP, { to: "receiving", location: A })).toBe(false);
    expect(canOpen(MOO_NO_MEMBERSHIP, { to: "stations", location: A })).toBe(true);
    expect(canOpen(OWNER, { to: "ordering", location: A })).toBe(true);
  });

  it("catering: a level-5 recipient never gets the admin prep-demand link; the catering manager does", () => {
    expect(canOpen(SHIFT_LEAD_A, { to: "pipeline" })).toBe(true);
    expect(canOpen(SHIFT_LEAD_A, { to: "prep_demand" })).toBe(false);
    expect(canOpen(CATERING_MGR, { to: "prep_demand" })).toBe(true);
    expect(canOpen(CATERING_MGR, { to: "sales_catering", location: A, day: DAY })).toBe(false);
  });

  it("the social media manager is refused every report surface by role; an unknown recipient opens nothing", () => {
    expect(canOpen(SMM, { to: "reports_hub", location: A, day: DAY })).toBe(false);
    expect(canOpen(SMM, { to: "team", location: A })).toBe(false);
    for (const t of [{ to: "pipeline" }, { to: "reports_hub", location: A, day: DAY }] as DigestTarget[]) expect(canOpen(NO_ACCESS_VIEWER, t)).toBe(false);
  });
});

describe("GM shop digest: every section links to its own screen", () => {
  const sections = (viewer: LinkViewer | undefined, lang: "en" | "es" = "en") => composeShopSections(shop(A, "Shop A"), lang, BASE, false, viewer);

  it("section → link map (GM, own shop)", () => {
    const map = Object.fromEntries(sections(GM_A).map((s) => [s.title.replace(/ · .*/, ""), s.href]));
    expect(map).toEqual({
      Headline: `${BASE}/reports/sales?${q(A)}`,
      Ordering: `${BASE}/ordering?location=${A}`,
      Receiving: `${BASE}/operations/receiving?location=${A}#recent-deliveries`,
      Inventory: `${BASE}/operations/counts?location=${A}`,
      Operations: `${BASE}/reports/operations?${q(A)}`,
      "Sales detail": `${BASE}/reports/sales?${q(A)}`,
      People: `${BASE}/reports/trends/team?location=${A}`,
      Tomorrow: `${BASE}/ordering?location=${A}`,
    });
  });

  it("line links: a delivery opens its own page, a PO its panel, a report its detail for the day, sales lines their view", () => {
    const s = sections(GM_A);
    const line = (section: string, label: string) => s.find((x) => x.title.startsWith(section))!.lines.find((l) => l.label === label)!;
    expect(line("Receiving", "Baldor").href).toBe(`${BASE}/operations/receiving/dlv-1`);
    expect(line("Ordering", "Vendor").href).toBe(`${BASE}/ordering?location=${A}&po=p`);
    expect(line("Operations", "Closing").href).toBe(`${BASE}/reports/closing/closing-1111?${q(A)}`);
    expect(line("Sales detail", "Top items (units)").href).toBe(`${BASE}/reports/sales?${q(A, DAY, "&view=items")}`);
    expect(line("Sales detail", "Channel mix").href).toBe(`${BASE}/reports/sales?${q(A, DAY, "&view=channels")}`);
    expect(s.find((x) => x.title.startsWith("Receiving"))!.lines.find((l) => l.label.startsWith("Invoices"))!.href).toBe(`${BASE}/operations/vendor-mail?location=${A}`);
  });

  it("an AGM recipient is never linked to a page that bounces them (Sales → the live pulse, vendor mail → receiving)", () => {
    const s = sections(AGM_A);
    expect(s.find((x) => x.title.startsWith("Headline"))!.href).toBe(`${BASE}/mid-shift?location=${A}`);
    for (const href of allHrefs(s)) {
      expect(href ?? "").not.toContain("/reports/sales");
      expect(href ?? "").not.toContain("/operations/vendor-mail");
    }
  });

  it("every href is absolute from the base URL, for both languages", () => {
    for (const lang of ["en", "es"] as const) for (const href of allHrefs(sections(GM_A, lang))) if (href) expect(href.startsWith(`${BASE}/`)).toBe(true);
  });

  it("the email shows a visible link per section, the line labels as links, and keeps the general link at the bottom", () => {
    for (const [lang, open, cta] of [["en", "Open this in the app →", "Open reports"], ["es", "Abrir esto en la app →", "Abrir reportes"]] as const) {
      const mail = renderShopDigest(shop(A, "Shop A"), { language: lang, baseUrl: BASE, viewer: GM_A });
      expect(mail.html.split(open).length - 1).toBe(8);
      expect(mail.html).toContain(`href="${BASE}/operations/receiving/dlv-1"`);
      expect(mail.html).toContain("text-decoration:underline");
      expect(mail.html).toContain(cta);
      expect(mail.html).toContain(`${BASE}/reports?${q(A).replace(/&/g, "&amp;")}`);
      expect(mail.text).toContain(`${open} ${BASE}/reports/sales?${q(A)}`);
    }
  });
});

describe("unified digest: each not-finalized shop links to that shop's closing", () => {
  const shops = [shop(A, "Shop A"), shop(B, "Shop B", { reports: [] })];
  const mail = (viewer: LinkViewer | undefined, lang: "en" | "es" = "en") =>
    renderUnifiedDigest({ day: DAY, shops, notFinalized: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }] }, { language: lang, baseUrl: BASE, viewer });

  it("Shop A → its closing report; Shop B (none) → the day's closing list; each its own link", () => {
    const { html, text } = mail(MOO_NO_MEMBERSHIP);
    expect(html).toContain(`<a href="${BASE}/reports/closing/closing-1111?${q(A).replace(/&/g, "&amp;")}"`);
    expect(html).toContain(`<a href="${BASE}/reports/operations?${q(B, DAY, "&type=closing").replace(/&/g, "&amp;")}"`);
    expect(text).toContain(`  Shop A: ${BASE}/reports/closing/closing-1111?${q(A)}`);
  });

  it("the all-shops section opens the hub for every shop on the day; the shop sections carry the shop's own links", () => {
    const { html } = mail(OWNER);
    expect(html).toContain(`${BASE}/reports?${q("all").replace(/&/g, "&amp;")}`);
    expect(html).toContain(`${BASE}/reports/sales?${q("all").replace(/&/g, "&amp;")}`);
    expect(html).toContain(`${BASE}/ordering?location=${B}`);
  });

  it("a MoO who belongs to no shop gets no ordering / receiving links (those pages need a membership below level 9)", () => {
    const { html } = mail(MOO_NO_MEMBERSHIP);
    expect(html).not.toContain("/ordering?");
    expect(html).not.toContain("/operations/receiving");
    expect(html).toContain("/reports/sales?");
  });

  it("Spanish renders the same links", () => {
    const es = mail(OWNER, "es");
    expect(es.html).toContain("Abrir esto en la app →");
    expect(es.html).toContain(`${BASE}/reports/closing/closing-1111?`);
  });
});

describe("catering digest: lead lines open the lead by id, never a name in the URL", () => {
  const TODAY = "2026-10-07";
  const YESTERDAY = "2026-10-06";
  const lead = (over: Partial<CateringLeadFact>): CateringLeadFact => ({
    id: "lead-1", contactName: "Jane Doe", company: "Acme Law", eventDate: TODAY, timeWindow: "11:30", headcount: 20,
    stage: "confirmed", leadSource: "phone", locationId: A, createdDay: "2026-10-01", followUpDate: null, externalRef: null,
    isDelivery: false, valueCents: 50000, dueCents: 0, prep: null, ...over,
  });
  const facts: CateringFacts = {
    today: TODAY, leads: [lead({}), lead({ id: "lead-2", contactName: "John Roe", eventDate: YESTERDAY, stage: "completed" })],
    lostYesterdayIds: [], quotesSentYesterday: [{ id: "qt-1", locationId: A, totalCents: 1000 }], openQuotes: [], refundsYesterday: [],
    toRingInToast: [{ order_id: "o1", lead_id: "lead-1", location_id: A, event_date: TODAY, order_number: "AB12", headcount: 20, total_cents: 5000, source: "ezcater" } as never],
    readiness: { [A]: ok({ rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 }) as never },
    staff: { [A]: ok({ onStation: [] }) as never },
  };
  const scope = { locations: [{ id: A, name: "Shop A" }], includeUnassigned: false };

  it("section → link map (catering manager)", () => {
    const map = composeCateringSections(facts, scope, "en", BASE, CATERING_MGR).map((s) => [s.title.replace(/^Shop A · /, "").replace(/ ·.*| \(.*|,.*/, ""), s.href]);
    expect(map).toEqual([
      // Below the Sales floor: yesterday's catering slice of Sales is not theirs → the pipeline.
      ["Yesterday", `${BASE}/catering/pipeline`],
      ["Today", `${BASE}/catering/pipeline`],
      ["Early tomorrow", `${BASE}/catering/pipeline`],
      ["Needs action", `${BASE}/catering/pipeline`],
      [expect.any(String), `${BASE}/catering/pipeline#${DIGEST_ANCHORS.pipelineToRing}`],
    ]);
  });

  it("a GM's 'yesterday' section opens the day's catering sales for the shop", () => {
    expect(composeCateringSections(facts, scope, "en", BASE, GM_A)[0]!.href).toBe(`${BASE}/reports/sales/catering?${q(A, YESTERDAY)}`);
  });

  it("each order line opens its own card; the to-ring line opens its lead; no contact name or company in any URL", () => {
    for (const lang of ["en", "es"] as const) {
      const sections = composeCateringSections(facts, scope, lang, BASE, CATERING_MGR);
      const hrefs = allHrefs(sections).filter((h): h is string => !!h);
      expect(hrefs).toContain(`${BASE}/catering/pipeline#lead-lead-1`);
      expect(hrefs).toContain(`${BASE}/catering/pipeline#lead-lead-2`);
      expect(hrefs).toContain(`${BASE}/catering/quotes?quote=qt-1`);
      expect(hrefs).toContain(`${BASE}/admin/catering/prep-demand`);
      expect(hrefs).toContain(`${BASE}/stations?loc=${A}`);
      for (const h of hrefs) for (const pii of ["Jane", "Doe", "John", "Roe", "Acme", "q="]) expect(h).not.toContain(pii);
    }
  });

  it("a level-5 recipient gets no link to the admin prep-demand page (the line stays, unlinked)", () => {
    const sections = composeCateringSections(facts, scope, "en", BASE, SHIFT_LEAD_A);
    const readiness = sections.flatMap((s) => s.lines).find((l) => l.label === "Inventory for today")!;
    expect(readiness.href).toBeNull();
    const html = renderCateringDigest(facts, scope, { language: "en", baseUrl: BASE, viewer: SHIFT_LEAD_A }).html;
    expect(html).not.toContain("/admin/catering/prep-demand");
    expect(html).toContain("<strong>Inventory for today</strong>");
  });

  it("the email keeps the general pipeline link at the bottom, in both languages", () => {
    expect(renderCateringDigest(facts, scope, { language: "en", baseUrl: BASE, viewer: CATERING_MGR }).html).toContain("Open catering pipeline");
    expect(renderCateringDigest(facts, scope, { language: "es", baseUrl: BASE, viewer: CATERING_MGR }).html).toContain("Abrir esto en la app →");
  });
});

describe("the sign-in round trip keeps a deep link's anchor", () => {
  it("re-attaches a plain id fragment to the sanitized next", () => {
    expect(withReturnFragment("/catering/pipeline", "#lead-abc")).toBe("/catering/pipeline#lead-abc");
    expect(withReturnFragment("/operations/receiving?location=x", "#recent-deliveries")).toBe("/operations/receiving?location=x#recent-deliveries");
  });
  it("never carries anything but a plain id, never onto the default landing or an existing fragment", () => {
    expect(withReturnFragment("/catering/pipeline", "#a b")).toBe("/catering/pipeline");
    expect(withReturnFragment("/catering/pipeline", "#javascript:alert(1)")).toBe("/catering/pipeline");
    expect(withReturnFragment("/dashboard", "#lead-x")).toBe("/dashboard");
    expect(withReturnFragment("/x#y", "#z")).toBe("/x#y");
    expect(withReturnFragment("/x", "")).toBe("/x");
  });
});


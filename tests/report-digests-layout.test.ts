/**
 * Digests round 3, PR 1a: the layout rule (lib/report-digests-layout-shared.ts) — cut → count → sort → cap — and
 * how the email shell prints it (renderDigest: the section status beside the title, the `?` and `→` marks, the
 * preheader chosen issues → unknowns → to-dos → all good). Every "hidden" case is checked on RENDERED html and text.
 */
import { describe, expect, it } from "vitest";
import type { ReportListItem } from "@/lib/reports-hub";
import {
  composeCateringSections,
  composeShopSections,
  digestPreheader,
  renderCateringDigest,
  renderDigest,
  renderShopDigest,
  renderUnifiedDigest,
  type CateringFacts,
  type CateringLeadFact,
  type ComposedEmail,
  type DigestLine,
  type DigestSection,
  type Envelope,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";
import { capItems, digestCounts, finishIntro, finishSection, finishSections, lineCounts, prioritize, SECTION_CAP_WIDE, type FinishCtx, type SectionDraft } from "@/lib/report-digests-layout-shared";
import { digestAccessFor, digestCan } from "@/lib/report-digests-access-shared";
import type { LinkViewer } from "@/lib/report-digests-links";
import { translator } from "@/lib/report-digests-v2-compose";
import { failed, ok, type ShopV2Facts } from "@/lib/report-digests-v2-shared";
import type { NotInToastOrder } from "@/lib/catering/not-in-toast-shared";
import { summarizeLabor } from "@/lib/toast/labor-shared";
import { po, v2Fixture } from "./fixtures/digest-v2";

const BASE = "https://ops.example.com";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-10-07";
const HREF = `${BASE}/section`;
const t = translator("en");

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const AGM_A: LinkViewer = { role: "agm", level: 6, locations: [A] };

const plain = (label: string, tone: DigestLine["tone"] = "ok"): DigestLine => ({ label, text: `${label} text`, tone, href: `${BASE}/${label}` });
const issue = (label: string): DigestLine => ({ label, text: `${label} problem`, tone: "issue", href: `${BASE}/${label}` });
const unknown = (label: string): DigestLine => ({ label, text: "Could not load — check the app", tone: "info", href: null, unknown: true });
const gated = (l: DigestLine): DigestLine => ({ ...l, needs: "sales_detail" });

/** A recipient bound to one shop and day, as the composers bind it. */
const ctxFor = (viewer: LinkViewer | null | undefined, locationId: string | null = A): FinishCtx =>
  ({ t, can: (cap) => digestCan(digestAccessFor(viewer), cap, { locationId, day: DAY }) });
const NOBODY: FinishCtx = ctxFor(null);
const draft = (lines: DigestLine[], cap?: number): SectionDraft => ({ title: "Section", lines, href: HREF, ...(cap ? { cap } : {}) });

describe("cut → count → cap", () => {
  it("a gated issue line is removed BEFORE the count; a capped line is still counted", () => {
    const s = finishSection(draft([gated(issue("Hidden")), ...Array.from({ length: 8 }, (_, i) => plain(`P${i}`))]), NOBODY)!;
    expect(s.lines.map((l) => l.label)).not.toContain("Hidden");
    expect(s.status).toMatchObject({ tone: "ok", issues: 0, unknowns: 0, text: "All good" });
    // The same section for someone who may see it counts the issue, and the 8 plain lines still cap at 5.
    const seen = finishSection(draft([gated(issue("Hidden")), ...Array.from({ length: 8 }, (_, i) => plain(`P${i}`))]), ctxFor(GM_A))!;
    expect(seen.status).toMatchObject({ tone: "issue", issues: 1, text: "1 issue" });
    expect(seen.lines.map((l) => l.label)).toEqual(["Hidden", "P0", "P1", "P2", "P3", "P4", "and 3 more"]);
    // A capped issue is impossible (issues never cap), so every counted issue prints.
    expect(lineCounts(seen.lines)).toEqual({ issues: seen.status!.issues, unknowns: seen.status!.unknowns, todos: seen.status!.todos });
  });

  it("11 issue lines all print, in order, and the status says 11", () => {
    const lines = Array.from({ length: 11 }, (_, i) => issue(`I${i}`));
    const s = finishSection(draft(lines), NOBODY)!;
    expect(s.lines.map((l) => l.label)).toEqual(lines.map((l) => l.label));
    expect(s.status).toMatchObject({ tone: "issue", text: "11 issues", issues: 11 });
  });

  it("F3 (plan §2.3): unknown lines count against the cap; the status still counts EVERY unknown (before the cap)", () => {
    const lines = [...Array.from({ length: 6 }, (_, i) => plain(`P${i}`)), ...Array.from({ length: 7 }, (_, i) => unknown(`U${i}`))];
    const s = finishSection(draft(lines), NOBODY)!;
    // Unknowns sort ahead of routine lines, so the 5 that print are unknowns; the rest fold into ONE line.
    expect(s.lines.map((l) => l.label)).toEqual(["U0", "U1", "U2", "U3", "U4", "and 8 more"]);
    expect(s.lines[5]).toMatchObject({ text: "U5, U6, P0, P1, P2 +3", tone: "info", href: HREF });
    expect(s.status).toMatchObject({ tone: "unknown", text: "7 not available", unknowns: 7 });
    // The preheader counts all 7 too.
    expect(renderDrafts([draft(lines)], env(GM_A)).html).toContain("7 lines could not be checked.");
  });

  it("8 plain lines, cap 5: 5 print + ONE 'and 3 more' line naming the 3 with the section link", () => {
    const s = finishSection(draft(Array.from({ length: 8 }, (_, i) => plain(`P${i}`))), NOBODY)!;
    expect(s.lines).toHaveLength(6);
    expect(s.lines[5]).toEqual({ label: "and 3 more", text: "P5, P6, P7", tone: "info", href: HREF });
    expect(s.status).toMatchObject({ tone: "ok", text: "All good" });
  });

  it("the wide cap (sales, labor) is 6", () => {
    const s = finishSection(draft(Array.from({ length: 8 }, (_, i) => plain(`P${i}`)), SECTION_CAP_WIDE), NOBODY)!;
    expect(s.lines.map((l) => l.label)).toEqual(["P0", "P1", "P2", "P3", "P4", "P5", "and 2 more"]);
  });

  it("'and N more' counts only permitted lines: a gated plain line is neither printed nor counted", () => {
    const lines = [...Array.from({ length: 7 }, (_, i) => plain(`P${i}`)), gated(plain("Secret"))];
    const s = finishSection(draft(lines), NOBODY)!;
    expect(s.lines[5]).toMatchObject({ label: "and 2 more", text: "P5, P6" });
    expect(JSON.stringify(s)).not.toContain("Secret");
    const seen = finishSection(draft(lines), ctxFor(GM_A))!;
    expect(seen.lines[5]).toMatchObject({ label: "and 3 more", text: "P5, P6, Secret" });
  });

  it("F4: presence is decided from the ALLOWED lines: every line cut and an empty draft are the same — no section", () => {
    expect(finishSection(draft([gated(issue("X")), gated(plain("Y"))]), NOBODY)).toBeNull();
    expect(finishSections([draft([gated(plain("Y"))]), draft([plain("Z")])], NOBODY)).toHaveLength(1);
    expect(finishSection(draft([]), NOBODY)).toBeNull();
  });

  it("1b rebase: a section's `live` flag survives the rule; a live section with every line cut is still no section", () => {
    const live = (lines: DigestLine[]): SectionDraft => ({ ...draft(lines), live: true });
    expect(finishSection(live([plain("A")]), NOBODY)).toMatchObject({ href: HREF, live: true });
    expect(finishSection(draft([plain("A")]), NOBODY)).not.toHaveProperty("live");
    expect(finishSection(live([gated(issue("X"))]), NOBODY)).toBeNull();
    // Byte-identical for a refused recipient (the AGM cannot open Sales): a live draft whose lines are all cut
    // renders exactly as if it was never composed — no heading, no "live" link label.
    const refused = renderDrafts([draft([plain("Z")]), { ...live([gated(plain("Y"))]), title: "Live section" }], env(AGM_A));
    expect(refused).toEqual(renderDrafts([draft([plain("Z")])], env(AGM_A)));
    expect(refused.html).not.toContain("live: shows the current day");
    // The same draft for a GM who may see the line prints it with the live label.
    expect(renderDrafts([draft([plain("Z")]), { ...live([gated(plain("Y"))]), title: "Live section" }], env(GM_A)).html).toContain("live: shows the current day");
  });
});

describe("three statuses: a failed read is `?`, never All good", () => {
  it("a section with one unknown and no issue is never ok", () => {
    const s = finishSection(draft([plain("A"), unknown("B")]), NOBODY)!;
    expect(s.status).toMatchObject({ tone: "unknown", text: "1 not available", issues: 0, unknowns: 1 });
  });

  it("a line that is both issue and unknown counts in both; the status names both", () => {
    const both: DigestLine = { ...issue("Late"), unknown: true };
    const s = finishSection(draft([both, unknown("U")]), NOBODY)!;
    expect(s.status).toMatchObject({ tone: "issue", issues: 1, unknowns: 2, text: "1 issue · 2 not available" });
  });

  it("a v2 failed read renders `? 1 not available` beside the title and the `?` mark on the line — never `!` and never All good", () => {
    const f: ShopDayFacts = { ...shopFacts(), v2: v2Fixture({ receiving: failed() }) };
    const mail = renderShopDigest(f, { language: "en", baseUrl: BASE, viewer: GM_A, access: digestAccessFor(GM_A) });
    expect(mail.text).toContain("\nReceiving — ? 1 not available\n");
    expect(mail.text).toContain("\n? Receiving: Could not load — check the app\n");
    expect(mail.text).not.toMatch(/\nReceiving — (!|✓)/);
    expect(mail.html).toMatch(/>Receiving <span style="[^"]*color:#8A5700;[^"]*">— \? 1 not available<\/span><\/h2>/);
    expect(mail.html).toContain('color:#8A5700;">?</td>');
  });

  it("Spanish statuses", () => {
    const es = translator("es");
    const s = finishSection(draft([issue("A"), unknown("B"), unknown("C")]), { ...NOBODY, t: es })!;
    expect(s.status!.text).toBe("1 problema · 2 no disponibles");
    expect(finishSection(draft([plain("A")]), { ...NOBODY, t: es })!.status!.text).toBe("Todo bien");
    expect(finishSection(draft(Array.from({ length: 6 }, (_, i) => plain(`P${i}`))), { ...NOBODY, t: es })!.lines[5]!.label).toBe("y 1 más");
  });
});

// ── Rendered: a hidden line changes nothing a recipient can see ─────────────────────────────────

const env = (viewer: LinkViewer | null): Envelope => ({ language: "en", baseUrl: BASE, viewer, access: digestAccessFor(viewer) });

/** The shop email pipeline over hand-built drafts: finish for the recipient (sections AND intro), choose the preheader, render. */
function renderDrafts(drafts: SectionDraft[], e: Envelope, composedIntro: DigestLine[] = []): ComposedEmail {
  const can = (cap: Parameters<FinishCtx["can"]>[0]) => digestCan(e.access, cap, { locationId: A, day: DAY });
  const sections = finishSections(drafts, { t, can });
  const intro = finishIntro(composedIntro, { can });
  return renderDigest(e, {
    subject: "Closing digest — Shop A", heading: "Shop A", intro, sections,
    preheader: digestPreheader(t, sections, intro, "All good across Shop A's reports."),
    cta: { label: "Open reports", url: `${BASE}/reports` },
  });
}

describe("a hidden line changes neither status, preheader nor subject (rendered html + text, byte-identical)", () => {
  const visible: SectionDraft[] = [
    { title: "Sales", href: HREF, cap: SECTION_CAP_WIDE, lines: [plain("Top items"), plain("Channels")] },
    { title: "Ordering", href: HREF, lines: Array.from({ length: 7 }, (_, i) => plain(`PO ${i}`)) },
  ];
  const withGated = (l: DigestLine): SectionDraft[] => [{ ...visible[0]!, lines: [...visible[0]!.lines, gated(l)] }, visible[1]!];

  it("a gated ISSUE line: the refused recipient's email equals the email without the line", () => {
    const refused = renderDrafts(withGated(issue("Ladder")), env(AGM_A));
    const absent = renderDrafts(visible, env(AGM_A));
    expect(refused).toEqual(absent);
    expect(refused.html).not.toContain("Ladder");
    expect(refused.text).not.toContain("Ladder");
    expect(refused.html).toContain("All good across Shop A&#039;s reports.");
    // The permitted recipient sees it, and it moves their status and preheader.
    const seen = renderDrafts(withGated(issue("Ladder")), env(GM_A));
    expect(seen.text).toContain("\nSales — ! 1 issue\n");
    expect(seen.html).toContain("1 line needs a look.");
    expect(seen.subject).toBe(absent.subject);
  });

  it("a gated plain line hidden from an absent access, a null access and NO_ACCESS: identical to it never existing", () => {
    for (const e of [{ language: "en" as const, baseUrl: BASE }, { ...env(GM_A), access: null }, env({ role: "", level: -1, locations: [] })]) {
      const sansViewer = { ...e, viewer: GM_A };
      expect(renderDrafts(withGated(plain("Ladder")), sansViewer)).toEqual(renderDrafts(visible, sansViewer));
    }
  });
});

describe("preheader: issues → unknowns → all good, counted after the cut and before the cap", () => {

  it("hand-built: issues win; unknown-only says the unknown text and never the ok text; all clear says ok", () => {
    const issueMail = renderDrafts([draft([issue("I"), unknown("U")])], env(GM_A));
    expect(issueMail.html).toContain("1 line needs a look.");
    const unknownMail = renderDrafts([draft([plain("P"), unknown("U"), unknown("V")])], env(GM_A));
    expect(unknownMail.html).toContain("2 lines could not be checked.");
    expect(unknownMail.html).not.toContain("All good across");
    expect(renderDrafts([draft([plain("P")])], env(GM_A)).html).toContain("All good across Shop A&#039;s reports.");
    // A capped plain line never hides an issue from the count (issues are never capped).
    expect(renderDrafts([draft([...Array.from({ length: 9 }, (_, i) => plain(`P${i}`)), issue("Last")])], env(GM_A)).html).toContain("1 line needs a look.");
  });

  it("a VISIBLE failed read → the unknown preheader; the SAME failed read on a line hidden from the recipient → ok, no trace", () => {
    const failedRead = { ...unknown("Ladder"), text: "Could not load — check the app" };
    const seen = renderDrafts([{ ...draft([plain("P")]), lines: [plain("P"), gated(failedRead)] }], env(GM_A));
    expect(seen.html).toContain("1 line could not be checked.");
    const hidden = renderDrafts([{ ...draft([plain("P")]), lines: [plain("P"), gated(failedRead)] }], env(AGM_A));
    expect(hidden.html).toContain("All good across Shop A&#039;s reports.");
    expect(hidden.html).not.toContain("Ladder");
    expect(hidden.text).not.toContain("Ladder");
    expect(hidden.html).not.toContain("Could not load");
    expect(hidden.text).not.toContain("not available");
    expect(hidden).toEqual(renderDrafts([draft([plain("P")])], env(AGM_A)));
  });

  it("shop digest (real composer): issues win; a failed read alone → unknown preheader; clean → ok", () => {
    const e = env(GM_A);
    expect(renderShopDigest({ ...shopFacts(), reports: [] }, e).html).toMatch(/\d+ lines need a look\./);
    const unknownOnly = renderShopDigest({ ...shopFacts(), v2: v2Fixture({ receiving: failed() }) }, e);
    expect(unknownOnly.html).toContain("1 line could not be checked.");
    expect(unknownOnly.html).not.toContain("All good across");
    expect(unknownOnly.subject).toBe(renderShopDigest(shopFacts(), e).subject);
    expect(renderShopDigest(shopFacts(), e).html).toContain("All good across Shop A&#039;s reports.");
  });

  it("unified digest (real composer): issues (incl. the closing-not-finalized intro) win; unknown-only → unknown; clean → ok", () => {
    const owner: LinkViewer = { role: "owner", level: 9, locations: [] };
    const e = env(owner);
    const b = (v2 = v2Fixture()): ShopDayFacts => ({ ...shopFacts(), location: { id: B, name: "Shop B" }, v2 });
    expect(renderUnifiedDigest({ day: DAY, shops: [shopFacts(), b()], notFinalized: [{ id: B, name: "Shop B" }] }, e).html).toContain("1 line needs a look.");
    const unknownOnly = renderUnifiedDigest({ day: DAY, shops: [shopFacts(), b(v2Fixture({ people: failed() }))], notFinalized: [] }, e);
    expect(unknownOnly.html).toContain("1 line could not be checked.");
    expect(unknownOnly.html).not.toContain("All good across every shop.");
    expect(renderUnifiedDigest({ day: DAY, shops: [shopFacts(), b()], notFinalized: [] }, e).html).toContain("All good across every shop.");
  });
});

describe("digestCounts over finished sections", () => {
  it("reads each section's status (after the cut) plus the intro lines", () => {
    const sections: DigestSection[] = finishSections([draft([issue("I"), gated(issue("Hidden"))]), draft([unknown("U")])], NOBODY);
    expect(digestCounts(sections, [issue("Intro")])).toEqual({ issues: 2, unknowns: 1, todos: 0 });
  });
});

// ── Fix round 1 (CC rulings, PR 1a #641) ────────────────────────────────────────────────────────────

const todo = (label: string): DigestLine => ({ label, text: `${label} to do`, tone: "attention", href: `${BASE}/${label}` });
/** A section's title line in the text email ("<title> — <mark> <status>"), never the email heading. */
const statusLine = (mail: ComposedEmail, title: string) =>
  mail.text.split("\n").find((l) => l.startsWith(`${title} — `) && /^[!?→✓] /.test(l.slice(title.length + 3)));
const ringOrder = (over: Partial<NotInToastOrder> = {}): NotInToastOrder => ({
  order_id: "order-a", lead_id: null, location_id: A, event_date: "2026-10-08", order_number: "CODE-A",
  handoff_time: "2026-10-08T15:30:00Z", event_timestamp: null, headcount: 12, total_cents: 12345, ...over,
});
const withV2 = (over: Partial<ShopV2Facts>): ShopDayFacts => ({ ...shopFacts(), v2: v2Fixture({ people: ok({ retrains: { assignedToday: 0, open: 0 } }), ...over }) });
const cateringLead = (over: Partial<CateringLeadFact>): CateringLeadFact => ({
  id: "lead-1", contactName: "Customer A", company: null, eventDate: DAY, timeWindow: "11:00", headcount: 10,
  stage: "confirmed", leadSource: "phone", locationId: A, createdDay: "2026-09-01", followUpDate: null, externalRef: null,
  isDelivery: false, valueCents: 0, dueCents: 0, prep: null, ...over,
});
const cateringFacts = (extra: Partial<CateringFacts> = {}, leads: CateringLeadFact[] = [cateringLead({})]): CateringFacts =>
  ({ today: DAY, leads, lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [], ...extra });
const cateringScope = { locations: [{ id: A, name: "Shop A" }], includeUnassigned: false };
const todaySection = (f: CateringFacts) => composeCateringSections(f, cateringScope, "en", BASE).find((s) => s.title.startsWith("Shop A · Today"))!;

describe("F1: every 'could not be checked' line is UNKNOWN — its section and the shop preheader never read All good", () => {
  it("Tasks unverified (a task nothing in the day's data can prove): Operations reads `? 1 not available`; preheader unknown", () => {
    const mail = renderShopDigest({ ...shopFacts(), tasks: ["counts"] }, env(GM_A));
    expect(statusLine(mail, "Operations")).toBe("Operations — ? 1 not available");
    expect(mail.text).toContain("\n? Assigned tasks: 1 not verified: Inventory count\n");
    expect(mail.html).toContain("1 line could not be checked.");
    expect(mail.html).not.toContain("All good across");
    // A not-done task beside the unverified one is both: an issue AND an unknown.
    const both = composeShopSections({ ...shopFacts(), reports: shopFacts().reports.filter((r) => r.type !== "am_prep"), tasks: ["counts", "am_prep"] }, "en", BASE, false, GM_A, digestAccessFor(GM_A))
      .find((s) => s.title === "Operations")!.lines.find((l) => l.label === "Assigned tasks")!;
    expect(both).toMatchObject({ tone: "issue", unknown: true });
  });

  it("ordering: a cutoff that passed with nothing to check against is unknown", () => {
    const mail = renderShopDigest(withV2({
      ordering: ok({ day: { placed: [], unsent: [], missed: [], unverified: [{ vendorId: "y", vendorName: "Vendor Y", cutoffTime: "14:30:00" }], late: [] }, deliveries: { due: [], overdue: [], undated: [] }, cutoffsTomorrow: [], vendorNames: {} }),
    }), env(GM_A));
    expect(statusLine(mail, "Ordering")).toBe("Ordering — ? 1 not available");
    expect(mail.text).toContain("\n? Vendor Y: 2:30 PM cutoff passed with no order and no walk to check against\n");
    expect(mail.html).toContain("1 line could not be checked.");
  });

  it("headline: no completed capture for the same weekday last week = the comparison is unknown", () => {
    const f = withV2({});
    const sales = f.v2!.sales.kind === "ok" ? f.v2!.sales.value : null;
    const mail = renderShopDigest(withV2({ sales: ok({ today: sales!.today, lastWeek: null }) }), env(GM_A));
    expect(statusLine(mail, "Headline")).toBe("Headline — ? 1 not available");
    expect(mail.text).toMatch(/\n\? Register sales \(pre-tax, excl\. ezCater\): \$100\.00 · last week not available/);
    expect(mail.html).toContain("1 line could not be checked.");
    // With last week's capture the same line is plain information, as before.
    expect(statusLine(renderShopDigest(withV2({}), env(GM_A)), "Headline")).toBe("Headline — ✓ All good");
  });

  it.each([
    ["not counted yet", { skuName: "Mayo", needOz: 8, onHandOz: null, shortOz: null, orderPacks: null, counted: false }, 0, "Mayo"],
    ["no pack size to compare", { skuName: "Ham", needOz: 8, onHandOz: 4, shortOz: null, orderPacks: null, counted: true }, 0, "Inventory for today"],
    ["an order line that cannot be checked", null, 1, "Inventory for today"],
  ] as const)("catering readiness — %s — is unknown; the Today section reads `? 1 not available`", (_name, row, unchecked, label) => {
    const s = todaySection(cateringFacts({ readiness: { [A]: { kind: "ok", value: { rows: row ? [row] : [], unresolvedChoiceLines: unchecked, noRecipeLines: 0 } } } }));
    expect(s.status).toMatchObject({ tone: "unknown", text: "1 not available", issues: 0, unknowns: 1 });
    expect(s.lines.find((l) => l.unknown)).toMatchObject({ label });
  });
});

describe("F2: the all-shops section with partial coverage is unknown", () => {
  const owner: LinkViewer = { role: "owner", level: 9, locations: [] };
  const b = (v2: ShopV2Facts): ShopDayFacts => ({ ...shopFacts(), location: { id: B, name: "Shop B" }, v2 });

  it("one shop's receiving failed: `partial (1 of 2 shops)` is a `?` line and the section is never All good", () => {
    const mail = renderUnifiedDigest({ day: DAY, shops: [shopFacts(), b(v2Fixture({ people: ok({ retrains: { assignedToday: 0, open: 0 } }), receiving: failed() }))], notFinalized: [] }, env(owner));
    expect(mail.text).toContain("\n? Receiving: 0 deliveries received · $0.00 · partial (1 of 2 shops)\n");
    expect(statusLine(mail, "All shops")).toBe("All shops — ? 1 not available");
    // Every shop covered: no partial note, the line is plain, the section is All good.
    const full = renderUnifiedDigest({ day: DAY, shops: [shopFacts(), b(v2Fixture({ people: ok({ retrains: { assignedToday: 0, open: 0 } }) }))], notFinalized: [] }, env(owner));
    expect(statusLine(full, "All shops")).toBe("All shops — ✓ All good");
  });
});

describe("F3 + F9: sort before the cap — issues, unknowns, to-dos, routine; stable inside a tier", () => {
  it("prioritize is a stable tier sort", () => {
    const lines = [plain("R1"), todo("T1"), unknown("U1"), issue("I1"), plain("R2"), todo("T2"), unknown("U2"), issue("I2"), { ...issue("IU"), unknown: true }];
    expect(prioritize(lines).map((l) => l.label)).toEqual(["I1", "I2", "IU", "U1", "U2", "T1", "T2", "R1", "R2"]);
  });

  it("a to-do composed after five routine lines is never folded behind them", () => {
    const s = finishSection(draft([...Array.from({ length: 5 }, (_, i) => plain(`R${i}`)), todo("Late order")]), NOBODY)!;
    expect(s.lines.map((l) => l.label)).toEqual(["Late order", "R0", "R1", "R2", "R3", "and 1 more"]);
    expect(s.status).toMatchObject({ tone: "todo", text: "1 to do", todos: 1 });
  });

  it("ordering (real composer): 5 POs placed + 1 late order — the late order prints, a routine PO folds", () => {
    const placed = Array.from({ length: 5 }, (_, i) => po(`p${i}`, "v", { placedAt: "2026-10-07T13:00:00Z", totalCents: 1000 }));
    const s = composeShopSections(withV2({
      ordering: ok({ day: { placed, unsent: [], missed: [], unverified: [], late: [{ vendorId: "v", vendorName: "Vendor", cutoffTime: "10:00:00", displayCode: "MEP-p4" }] }, deliveries: { due: [], overdue: [], undated: [] }, cutoffsTomorrow: [], vendorNames: { v: "Vendor" } }),
    }), "en", BASE, false, GM_A, digestAccessFor(GM_A)).find((x) => x.title === "Ordering")!;
    expect(s.lines[0]).toMatchObject({ tone: "attention", label: "Vendor", text: "Ordered after the 10:00 AM cutoff (MEP-p4)" });
    // 7 routine lines (the summary, 5 POs, "No missed cutoffs") + 1 to-do, cap 5: the to-do and 4 routine print.
    expect(s.lines.at(-1)).toMatchObject({ label: "and 3 more" });
    expect(s.status).toMatchObject({ tone: "todo", text: "1 to do" });
  });

  it("catering Today (real composer): 6 orders + someone on a station — 'Staff today' prints, a routine order folds", () => {
    const leads = Array.from({ length: 6 }, (_, i) => cateringLead({ id: `l${i}`, contactName: `Customer ${i}`, timeWindow: `1${i}:00`, prep: [] }));
    const s = todaySection(cateringFacts({ staff: { [A]: { kind: "ok", value: { source: "stations", scheduleConnected: false, onStation: [{ firstName: "Person A", station: "Grill", source: "claimed" }] } } } }, leads));
    expect(s.lines[0]).toMatchObject({ tone: "attention", label: "Staff today" });
    expect(s.lines.map((l) => l.label)).toEqual(["Staff today", "Customer 0", "Customer 1", "Customer 2", "Customer 3", "and 3 more"]);
    expect(s.status).toMatchObject({ tone: "todo", text: "1 to do" });
  });
});

describe("F4: a section whose allowed lines are empty renders exactly as if the hidden lines never existed", () => {
  const other: SectionDraft = { title: "Receiving", href: `${BASE}/receiving`, lines: [plain("Deliveries")] };
  const hidden = gated(issue("Ladder"));
  it.each([
    ["an EMPTY draft", [] as DigestLine[]],
    ["a NON-EMPTY draft", [plain("Top items"), unknown("Channels")]],
  ])("%s + one hidden line ≡ the draft without it (subject, html, text byte-equal)", (_name, lines) => {
    for (const viewer of [AGM_A, null, { role: "", level: -1, locations: [] } as LinkViewer]) {
      const e = { ...env(viewer), viewer: GM_A };
      const withHidden = renderDrafts([other, { title: "Sales", href: HREF, lines: [...lines, hidden] }], e);
      const without = renderDrafts([other, { title: "Sales", href: HREF, lines }], e);
      expect(withHidden.subject).toBe(without.subject);
      expect(withHidden.html).toBe(without.html);
      expect(withHidden.text).toBe(without.text);
      expect(withHidden.text).not.toContain("Ladder");
    }
    // Heading-or-nothing: an empty section prints NOTHING (no heading, no link), whether it was empty or cut.
    if (lines.length === 0) {
      const e = env(AGM_A);
      expect(renderDrafts([other, { title: "Sales", href: HREF, lines: [hidden] }], e)).toEqual(renderDrafts([other], e));
      expect(renderDrafts([other, { title: "Sales", href: HREF, lines: [] }], e).text).not.toContain("Sales");
    }
  });

  it("the to-ring section (composer) is decided from the allowed lines: none = no section", () => {
    const titles = composeCateringSections(cateringFacts({ toRingInToast: [] }), cateringScope, "en", BASE).map((s) => s.title);
    expect(titles.some((x) => x.includes("To ring into Toast"))).toBe(false);
  });
});

describe("F5: intro lines go through the same cut, and are counted after it", () => {
  const closing: DigestLine = { label: "Closing", text: "All finalized", tone: "ok", href: `${BASE}/reports` };
  const gatedIntro = gated(issue("Ladder"));

  it("a gated intro line for a recipient refused it changes nothing (byte equality)", () => {
    for (const viewer of [AGM_A, null]) {
      const e = { ...env(viewer), viewer: GM_A };
      expect(renderDrafts([draft([plain("P")])], e, [closing, gatedIntro])).toEqual(renderDrafts([draft([plain("P")])], e, [closing]));
    }
  });

  it("for an allowed recipient the gated intro line prints and counts", () => {
    const mail = renderDrafts([draft([plain("P")])], env(GM_A), [closing, gatedIntro]);
    expect(mail.text).toContain("\n! Ladder: Ladder problem\n");
    expect(mail.html).toContain("1 line needs a look.");
  });

  it("fail closed: a gated intro line that skipped finishIntro is neither shown nor counted", () => {
    const e = env(GM_A);
    const sections = finishSections([draft([plain("P")])], { t, can: () => true });
    const raw = [closing, gatedIntro];
    const mail = renderDigest(e, { subject: "S", heading: "H", intro: raw, sections, preheader: digestPreheader(t, sections, raw, "OK"), cta: { label: "Open", url: BASE } });
    expect(mail.text).not.toContain("Ladder");
    expect(mail.html).not.toContain("Ladder");
    expect(mail.html).toContain(">OK<");
  });
});

describe("F6: a to-ring line is a TO-DO — `N to do`, never All good, never an issue", () => {
  it("statuses: to-dos alone read `N to do`; with an issue or unknown they are listed after them", () => {
    expect(finishSection(draft([todo("A"), todo("B"), plain("C")]), NOBODY)!.status).toMatchObject({ tone: "todo", text: "2 to do", issues: 0, unknowns: 0, todos: 2 });
    expect(finishSection(draft([issue("I"), unknown("U"), todo("A")]), NOBODY)!.status).toMatchObject({ tone: "issue", text: "1 issue · 1 not available · 1 to do" });
    expect(finishSection(draft([todo("A")]), { ...NOBODY, t: translator("es") })!.status!.text).toBe("1 pendiente");
    expect(finishSection(draft([todo("A"), todo("B")]), { ...NOBODY, t: translator("es") })!.status!.text).toBe("2 pendientes");
  });

  it("the shop digest's 'Ring into Toast tomorrow' section reads `→ 1 to do`; the preheader says 1 thing to do", () => {
    const mail = renderShopDigest(withV2({ catering: ok({ day: { orders: 1, completedCents: 5000, confirmedCents: 0 }, tomorrow: [], toRingInToast: [ringOrder()] }) }), env(GM_A));
    expect(statusLine(mail, "Ring into Toast tomorrow")).toBe("Ring into Toast tomorrow — → 1 to do");
    expect(mail.text).toContain("\n→ ezCater CODE-A: Ready 11:30 AM · 12 guests · $123.45\n");
    expect(mail.text).not.toMatch(/Ring into Toast tomorrow — (✓|!)/);
    expect(mail.html).toContain("1 thing to do.");
    expect(mail.html).not.toContain("All good across");
    expect(mail.html).toMatch(/>Ring into Toast tomorrow <span style="[^"]*color:#1F4E79;[^"]*">— → 1 to do<\/span><\/h2>/);
  });

  it("the catering digest's 'To ring into Toast' section reads `→ N to do` (en + es)", () => {
    const f = cateringFacts({ toRingInToast: [ringOrder({ event_date: DAY }), ringOrder({ order_id: "o2", order_number: "CODE-B", event_date: DAY })] }, []);
    const en = renderCateringDigest(f, cateringScope, env(GM_A));
    expect(statusLine(en, "Shop A · To ring into Toast")).toBe("Shop A · To ring into Toast — → 2 to do");
    const es = renderCateringDigest(f, cateringScope, { ...env(GM_A), language: "es" });
    expect(statusLine(es, "Shop A · Por registrar en Toast")).toBe("Shop A · Por registrar en Toast — → 2 pendientes");
  });

  it("preheader order: issues → unknowns → to-dos → all good", () => {
    expect(renderDrafts([draft([issue("I"), unknown("U"), todo("T")])], env(GM_A)).html).toContain("1 line needs a look.");
    expect(renderDrafts([draft([unknown("U"), todo("T")])], env(GM_A)).html).toContain("1 line could not be checked.");
    expect(renderDrafts([draft([todo("T"), todo("T2"), plain("P")])], env(GM_A)).html).toContain("2 things to do.");
    expect(renderDrafts([draft([plain("P")])], env(GM_A)).html).toContain("All good across Shop A&#039;s reports.");
  });

  it("unified digest: a to-ring line alone gives the to-do preheader", () => {
    const owner: LinkViewer = { role: "owner", level: 9, locations: [] };
    const mail = renderUnifiedDigest({ day: DAY, shops: [withV2({ catering: ok({ day: { orders: 1, completedCents: 5000, confirmedCents: 0 }, tomorrow: [], toRingInToast: [ringOrder()] }) })], notFinalized: [] }, env(owner));
    expect(mail.html).toContain("1 thing to do.");
    expect(mail.html).not.toContain("All good across every shop.");
  });
});

describe("F7: at most 5 names or items inside a line, then +N (plan §2.6)", () => {
  it("capItems", () => {
    expect(capItems(["a", "b", "c"])).toBe("a, b, c");
    expect(capItems(["a", "b", "c", "d", "e"])).toBe("a, b, c, d, e");
    expect(capItems(["a", "b", "c", "d", "e", "f", "g"])).toBe("a, b, c, d, e +2");
  });

  it("Labor 'Who worked': 7 people → 5 names +2", () => {
    const entries = ["Ana", "Bo", "Cy", "Dee", "Eve", "Fay", "Gus"].map((n, i) => ({ employeeGuid: n, firstName: n, jobName: "Line Cook", businessDate: DAY, hours: 8 - i * 0.5, overtimeHours: 0, open: false }));
    const s = composeShopSections(withV2({ labor: ok(summarizeLabor(DAY, entries, 100_000)) }), "en", BASE, false, GM_A, digestAccessFor(GM_A)).find((x) => x.title === "Labor")!;
    expect(s.lines.find((l) => l.label === "Who worked")!.text).toBe("Ana 8 h, Bo 7.5 h, Cy 7 h, Dee 6.5 h, Eve 6 h +2");
  });

  it("Sales discounts: 8 discounts → 5 +3", () => {
    const f = withV2({});
    const sales = f.v2!.sales.kind === "ok" ? f.v2!.sales.value : null;
    const discounts = Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, count: 1, cents: 800 - i * 100 }));
    const s = composeShopSections(withV2({ sales: ok({ today: { ...sales!.today, discounts }, lastWeek: sales!.lastWeek }) }), "en", BASE, false, GM_A, digestAccessFor(GM_A)).find((x) => x.title === "Sales detail")!;
    expect(s.lines.find((l) => l.label === "Discounts")!.text).toBe("D0 ×1 $8.00, D1 ×1 $7.00, D2 ×1 $6.00, D3 ×1 $5.00, D4 ×1 $4.00 +3");
  });
});

describe("F10: 'and N more' names agree with N", () => {
  it("three folded lines with one label read 'Inventory for today ×3'", () => {
    const lines = [...Array.from({ length: 5 }, (_, i) => plain(`P${i}`)), ...Array.from({ length: 3 }, () => plain("Inventory for today"))];
    const s = finishSection(draft(lines), NOBODY)!;
    expect(s.lines[5]).toMatchObject({ label: "and 3 more", text: "Inventory for today ×3" });
  });

  it("more than five labels: five named (with their counts), then +N counts the folded LINES not named", () => {
    const folded = ["A", "A", "B", "C", "D", "E", "F", "F", "G"];
    const s = finishSection(draft([...Array.from({ length: 5 }, (_, i) => plain(`P${i}`)), ...folded.map((x) => plain(x))]), NOBODY)!;
    expect(s.lines[5]).toMatchObject({ label: "and 9 more", text: "A ×2, B, C, D, E +3" });
  });
});

describe("F11: a full Spanish digest with an unknown-only preheader", () => {
  it("renderShopDigest in Spanish: the preheader is `digest.shop.preheader_unknown_*`, never Todo bien", () => {
    const es = { ...env(GM_A), language: "es" as const };
    const one = renderShopDigest(withV2({ receiving: failed() }), es);
    expect(one.html).toContain("1 línea no se pudo revisar.");
    expect(one.html).not.toContain("Todo bien en los reportes");
    expect(statusLine(one, "Recepción")).toBe("Recepción — ? 1 no disponible");
    const two = renderShopDigest(withV2({ receiving: failed(), people: failed() }), es);
    expect(two.html).toContain("2 líneas no se pudieron revisar.");
    // Tasks unverified, in Spanish, is never Todo bien either.
    const tasks = renderShopDigest({ ...shopFacts(), tasks: ["counts"] }, es);
    expect(statusLine(tasks, "Operaciones")).toBe("Operaciones — ? 1 no disponible");
    // A to-do-only Spanish digest.
    const ring = renderShopDigest(withV2({ catering: ok({ day: { orders: 1, completedCents: 5000, confirmedCents: 0 }, tomorrow: [], toRingInToast: [ringOrder()] }) }), es);
    expect(ring.html).toContain("1 cosa por hacer.");
  });
});

function shopFacts(): ShopDayFacts {
  const clean: NonNullable<ReportListItem["signalSummary"]> = { underPar: 0, overPar: 0, skipped: 0, tempFlags: 0, cashOverShortCents: null };
  const report = (type: ReportListItem["type"], status: string): ReportListItem =>
    ({ type, id: `${type}-1`, date: DAY, locationId: A, submitterName: "Person A", status, signalSummary: { ...clean } });
  return {
    location: { id: A, name: "Shop A" }, day: DAY,
    reports: [report("opening", "phase2_complete"), report("am_prep", "submitted"), report("mid_day", "phase2_complete"), report("closing", "confirmed"), report("cash", "ok"), report("pm", "submitted"), report("maintenance", "ok")],
    receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: { evaluations: 2, needsWork: 0 },
    v2: v2Fixture({ people: ok({ retrains: { assignedToday: 0, open: 0 } }) }),
  };
}

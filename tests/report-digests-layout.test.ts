/**
 * Digests round 3, PR 1a: the layout rule (lib/report-digests-layout-shared.ts) — cut → count → cap — and how
 * the email shell prints it (renderDigest: the section status beside the title, the `?` mark, the preheader
 * chosen issues → unknowns → all good). Every "hidden" case is checked on RENDERED html and text.
 */
import { describe, expect, it } from "vitest";
import type { ReportListItem } from "@/lib/reports-hub";
import {
  digestPreheader,
  renderDigest,
  renderShopDigest,
  renderUnifiedDigest,
  type ComposedEmail,
  type DigestLine,
  type DigestSection,
  type Envelope,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";
import { digestCounts, finishSection, finishSections, lineCounts, SECTION_CAP, SECTION_CAP_WIDE, type FinishCtx, type SectionDraft } from "@/lib/report-digests-layout-shared";
import { digestAccessFor, digestCan } from "@/lib/report-digests-access-shared";
import type { LinkViewer } from "@/lib/report-digests-links";
import { translator } from "@/lib/report-digests-v2-compose";
import { failed, ok } from "@/lib/report-digests-v2-shared";
import { v2Fixture } from "./fixtures/digest-v2";

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
    // A capped line that is an issue is impossible (issues never cap); a capped unknown is impossible too —
    // so every counted line prints: the counts equal the lines' own counts before the cap.
    expect(lineCounts(seen.lines)).toEqual({ issues: seen.status!.issues, unknowns: seen.status!.unknowns });
  });

  it("11 issue lines all print, in order, and the status says 11", () => {
    const lines = Array.from({ length: 11 }, (_, i) => issue(`I${i}`));
    const s = finishSection(draft(lines), NOBODY)!;
    expect(s.lines.map((l) => l.label)).toEqual(lines.map((l) => l.label));
    expect(s.status).toMatchObject({ tone: "issue", text: "11 issues", issues: 11 });
  });

  it("unknown lines are never capped", () => {
    const lines = [...Array.from({ length: 7 }, (_, i) => unknown(`U${i}`)), ...Array.from({ length: 6 }, (_, i) => plain(`P${i}`))];
    const s = finishSection(draft(lines), NOBODY)!;
    expect(s.lines.filter((l) => l.unknown).map((l) => l.label)).toEqual(["U0", "U1", "U2", "U3", "U4", "U5", "U6"]);
    expect(s.lines.filter((l) => !l.unknown && !/more$/.test(l.label))).toHaveLength(SECTION_CAP);
    expect(s.status).toMatchObject({ tone: "unknown", text: "7 not available" });
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

  it("a section whose every line is cut does not exist for that recipient; an empty draft has no status", () => {
    expect(finishSection(draft([gated(issue("X")), gated(plain("Y"))]), NOBODY)).toBeNull();
    expect(finishSections([draft([gated(plain("Y"))]), draft([plain("Z")])], NOBODY)).toHaveLength(1);
    expect(finishSection(draft([]), NOBODY)!.status).toBeUndefined();
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

/** The shop email pipeline over hand-built drafts: finish for the recipient, choose the preheader, render. */
function renderDrafts(drafts: SectionDraft[], e: Envelope, intro: DigestLine[] = []): ComposedEmail {
  const sections = finishSections(drafts, { t, can: (cap) => digestCan(e.access, cap, { locationId: A, day: DAY }) });
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
    expect(digestCounts(sections, [issue("Intro")])).toEqual({ issues: 2, unknowns: 1 });
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

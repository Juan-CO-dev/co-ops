import { describe, expect, it } from "vitest";
import type { ReportListItem } from "@/lib/reports-hub";
import {
  composeShopLines,
  renderShopDigest,
  renderUnifiedDigest,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";

const BASE = "https://ops.example.com";
const LOC = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-10-07";
const clean: NonNullable<ReportListItem["signalSummary"]> = { underPar: 0, overPar: 0, skipped: 0, tempFlags: 0, cashOverShortCents: null };
const report = (type: ReportListItem["type"], status: string, signals = clean, id = `${type}-1`): ReportListItem =>
  ({ type, id, date: DAY, locationId: LOC, submitterName: "x", status, signalSummary: { ...signals } });

function facts(over: Partial<ShopDayFacts> = {}): ShopDayFacts {
  return {
    location: { id: LOC, name: "Shop A" }, day: DAY,
    reports: [
      report("opening", "phase2_complete"), report("am_prep", "submitted"), report("mid_day", "phase2_complete"),
      report("closing", "confirmed"), report("cash", "ok"), report("pm", "submitted"), report("maintenance", "ok"),
    ],
    receiving: { deliveries: 2, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: { evaluations: 3, needsWork: 0 },
    ...over,
  };
}

describe("shop digest lines", () => {
  it("a clean day is All good on every report family, with deep links carrying shop + day + type", () => {
    const lines = composeShopLines(facts(), "en", BASE);
    expect(lines.map((l) => l.label)).toEqual([
      "Opening", "AM Prep", "Mid-Day Prep", "Closing", "Cash", "PM Report", "Maintenance",
      "Receiving", "Tosses / waste", "Store runs pending review", "Assigned tasks",
    ]);
    expect(lines.filter((l) => l.tone === "issue")).toEqual([]);
    expect(lines[0]).toEqual({
      label: "Opening", text: "All good", tone: "ok",
      href: `${BASE}/reports/opening/opening-1?location=${LOC}&range=custom&from=${DAY}&to=${DAY}`,
    });
  });

  it("missing, unfinalized and signalled reports are issues, each linking where to drill in", () => {
    const lines = composeShopLines(facts({
      reports: [
        report("closing", "open"),
        report("am_prep", "submitted", { ...clean, underPar: 2, tempFlags: 1 }),
        report("cash", "ok", { ...clean, cashOverShortCents: -1250 }),
      ],
    }), "en", BASE);
    const by = (label: string) => lines.find((l) => l.label === label)!;
    expect(by("Opening")).toMatchObject({ text: "Not submitted", tone: "issue", href: `${BASE}/reports/operations?location=${LOC}&range=custom&from=${DAY}&to=${DAY}&type=opening` });
    expect(by("Closing")).toMatchObject({ text: "Not finalized", tone: "issue" });
    expect(by("AM Prep")).toMatchObject({ text: "3 issues: 2 under par, 1 temperature flags", tone: "issue" });
    expect(by("Cash")).toMatchObject({ text: "1 issues: cash short $12.50", tone: "issue" });
    expect(by("Maintenance")).toMatchObject({ text: "Nothing logged", tone: "info" });
  });

  it("two reports of one family link to the filtered operations list, not to one of them", () => {
    const lines = composeShopLines(facts({ reports: [report("am_prep", "submitted", { ...clean, skipped: 1 }, "a"), report("am_prep", "submitted", clean, "b")] }), "en", BASE);
    expect(lines.find((l) => l.label === "AM Prep")?.href).toBe(`${BASE}/reports/operations?location=${LOC}&range=custom&from=${DAY}&to=${DAY}&type=am_prep&sf_skipped=true`);
  });

  it("receiving, tosses, store runs and assigned tasks speak explicitly", () => {
    const lines = composeShopLines(facts({
      receiving: { deliveries: 3, discrepant: 1, missingReceipt: 2 }, tosses: 4, storeRunsPending: 2,
      reports: [report("cash", "ok")], tasks: ["cash_report", "am_prep", "counts"],
    }), "en", BASE);
    const by = (label: string) => lines.find((l) => l.label === label)!;
    expect(by("Receiving")).toMatchObject({ text: "1 with discrepancies, 2 without a receipt photo", tone: "issue", href: `${BASE}/operations/receiving?location=${LOC}` });
    expect(by("Tosses / waste")).toMatchObject({ text: "4 items tossed", tone: "issue" });
    expect(by("Store runs pending review")).toMatchObject({ text: "2 items pending review", tone: "issue" });
    // counts leaves no report to prove it, so it is never called "not done"
    expect(by("Assigned tasks")).toMatchObject({ text: "1 not done: AM prep; 1 not verified: Counts; 1 done", tone: "issue" });
  });

  it("empty receiving and no tasks are info lines, never silence", () => {
    const lines = composeShopLines(facts({ receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 } }), "en", BASE);
    expect(lines.find((l) => l.label === "Receiving")).toMatchObject({ text: "No deliveries", tone: "info" });
    expect(lines.find((l) => l.label === "Assigned tasks")).toMatchObject({ text: "None assigned", tone: "info" });
  });

  it("speaks Spanish to a Spanish-preference recipient", () => {
    const lines = composeShopLines(facts({ reports: [] }), "es", BASE);
    expect(lines.find((l) => l.href.includes("type=closing"))?.text).toBe("No enviado");
    const mail = renderShopDigest(facts(), { language: "es", baseUrl: BASE });
    expect(mail.subject).toContain("Resumen de cierre de Shop A");
    expect(mail.text).toContain("Todo bien");
  });
});

describe("shop + unified emails", () => {
  it("escapes shop names and carries every link in html and text", () => {
    const mail = renderShopDigest(facts({ location: { id: LOC, name: "<b>A&B</b>" } }), { language: "en", baseUrl: BASE });
    expect(mail.html).not.toContain("<b>A&B</b>");
    expect(mail.html).toContain("&lt;b&gt;A&amp;B&lt;/b&gt;");
    expect(mail.text).toContain(`${BASE}/reports/opening/opening-1?location=`);
  });

  it("the unified fallback names every unfinalized shop as an issue", () => {
    const mail = renderUnifiedDigest({
      day: DAY, shops: [facts(), facts({ location: { id: "l2", name: "Shop B" }, reports: [] })],
      notFinalized: [{ id: "l2", name: "Shop B" }],
    }, { language: "en", baseUrl: BASE });
    expect(mail.subject).toBe("All shops digest — Wed, Oct 7");
    expect(mail.text).toContain("! Closing: Closing not finalized: Shop B");
    expect(mail.text).toContain("Shop A");
  });

  it("preview mode labels the subject and names the real recipient", () => {
    const mail = renderShopDigest(facts(), { language: "en", baseUrl: BASE, previewFor: { name: "Alex", email: "alex@example.com" } });
    expect(mail.subject.startsWith("[Preview] ")).toBe(true);
    expect(mail.text).toContain("PREVIEW of the digest for Alex (alex@example.com)");
  });
});

describe("P2 (Astra): never All good without evidence", () => {
  const byLabel = (f: ShopDayFacts, label: string) => composeShopLines(f, "en", BASE).find((l) => l.label === label)!;

  it("PM: the list carries no PM signals, so the evaluations decide — or the line says not assessed", () => {
    expect(byLabel(facts({ pmFindings: null }), "PM Report")).toMatchObject({ text: "Submitted · PM issues not assessed", tone: "info" });
    expect(byLabel(facts({ pmFindings: { evaluations: 4, needsWork: 3 } }), "PM Report")).toMatchObject({ text: "3 needs-work ratings across 4 evaluations", tone: "issue" });
    expect(byLabel(facts({ pmFindings: { evaluations: 0, needsWork: 0 } }), "PM Report")).toMatchObject({ text: "Submitted · no evaluations recorded", tone: "info" });
    expect(byLabel(facts({ pmFindings: { evaluations: 4, needsWork: 0 } }), "PM Report")).toMatchObject({ text: "All good (4 evaluations)", tone: "ok" });
  });

  it("a report whose signals were never computed is not assessed, not All good", () => {
    const unsignalled = { ...report("opening", "phase2_complete"), signalSummary: undefined };
    expect(byLabel(facts({ reports: [unsignalled] }), "Opening")).toMatchObject({ text: "Submitted · issues not assessed", tone: "info" });
  });

  it("tasks: counts + ordering with no evidence are NOT 'All done (2)' (the reproduced case)", () => {
    expect(byLabel(facts({ tasks: ["counts", "ordering"] }), "Assigned tasks")).toMatchObject({ text: "2 not verified: Counts, Ordering", tone: "info" });
  });

  it("tasks: All done only when every task has evidence", () => {
    const f = facts({ tasks: ["cash_report", "receiving"] });
    expect(byLabel(f, "Assigned tasks")).toMatchObject({ text: "All done (2)", tone: "ok" });
    const noTruck = facts({ tasks: ["cash_report", "receiving"], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 } });
    expect(byLabel(noTruck, "Assigned tasks")).toMatchObject({ text: "1 not verified: Receiving; 1 done", tone: "info" });
  });
});

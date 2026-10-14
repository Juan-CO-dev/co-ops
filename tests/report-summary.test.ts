import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { composeLastClose, composeReportSummary, lastCloseDate } from "@/lib/report-summary";
import type { ReportListItem } from "@/lib/reports-hub";
const row = (type: ReportListItem["type"], status: string): ReportListItem => ({ type, status, id: type, date: "2026-10-06", locationId: "shop", submitterName: null });
describe("last close", () => {
  it("distinguishes done, unfinished, missing and an entirely empty shop", () => {
    const summary = composeLastClose([row("opening", "confirmed"), row("closing", "in_progress")], 4);
    expect(summary.reports.find((r) => r.type === "opening")?.state).toBe("done");
    expect(summary.reports.find((r) => r.type === "closing")?.state).toBe("not_finalized");
    expect(summary.reports.find((r) => r.type === "cash")?.state).toBe("missing");
    expect(composeLastClose([], 4).noActivity).toBe(true);
  });
  it("labels employees own scope and omits cash", () => {
    const summary = composeLastClose([row("opening", "confirmed")], 3);
    expect(summary.ownScope).toBe(true);
    expect(summary.reports.some((r) => r.type === "cash")).toBe(false);
  });
  it("counts finalized history and individual signal totals", () => {
    const item = { ...row("opening", "auto_finalized"), signalSummary: { underPar: 3, overPar: 0, skipped: 2, tempFlags: 1, cashOverShortCents: null } };
    expect(composeReportSummary([item, row("closing", "open")])).toMatchObject({ total: 2, finalized: 1, signals: { underPar: 3, skipped: 2, tempFlags: 1 } });
  });
});

describe("D-62 last close = the most recent closed day", () => {
  const on = (type: ReportListItem["type"], status: string, date: string): ReportListItem => ({ ...row(type, status), id: `${type}-${date}`, date });
  it("is today once tonight's closing is confirmed", () => {
    expect(lastCloseDate([on("closing", "confirmed", "2026-10-12"), on("closing", "confirmed", "2026-10-13")], "2026-10-12")).toBe("2026-10-13");
  });
  it("ignores an unfinished closing and other report types (an opening confirmed today is not a close)", () => {
    expect(lastCloseDate([on("closing", "confirmed", "2026-10-11"), on("closing", "in_progress", "2026-10-13"), on("opening", "confirmed", "2026-10-13")], "2026-10-12")).toBe("2026-10-11");
  });
  it("an auto-closed closing still marks its day closed (the card says auto closed on it)", () => {
    expect(lastCloseDate([on("closing", "auto_finalized", "2026-10-12")], "2026-10-12")).toBe("2026-10-12");
    expect(lastCloseDate([on("closing", "incomplete_confirmed", "2026-10-10")], "2026-10-12")).toBe("2026-10-10");
  });
  it("falls back (yesterday) when nothing closed in the window", () => {
    expect(lastCloseDate([], "2026-10-12")).toBe("2026-10-12");
  });
  it("the hub reads the window through today and filters the panel to the chosen day", () => {
    const page = readFileSync("app/(authed)/reports/page.tsx", "utf8");
    expect(page).toMatch(/dateFrom: shiftReportDate\(today, -\(LAST_CLOSE_LOOKBACK_DAYS - 1\)\), dateTo: today/);
    expect(page).toContain("lastCloseDate(recent, yesterday)");
    expect(page).toContain("formatDateLabel(closeDay, language)");
  });
});

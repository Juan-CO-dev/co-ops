import { describe, expect, it } from "vitest";
import { composeLastClose, composeReportSummary } from "@/lib/report-summary";
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

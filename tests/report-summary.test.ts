import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { composeLastClose, composeReportSummary } from "@/lib/report-summary";
import { FINALIZED_REPORT_STATUSES, LAST_CLOSE_MAX_LOOKBACK_DAYS, latestFinalizedClosingDate } from "@/lib/reports-hub";
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
    expect(composeReportSummary([item, row("closing", "open")], 1)).toMatchObject({ total: 2, finalized: 1, signals: { underPar: 3, skipped: 2, tempFlags: 1 } });
  });
});

describe("D-62 / review #4: last close = the newest finalized closing, found by a bounded newest-first read", () => {
  type Call = { table: string; ops: Array<[string, unknown[]]> };
  // A recording fake: checklist_templates returns the closing templates; checklist_instances honours the
  // filters the reader sends (status set, date bounds, newest-first, limit) over the given rows.
  function fakeClient(instances: Array<{ date: string; status: string; template_id: string; location_id: string }>) {
    const calls: Call[] = [];
    const from = (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "lte", "gte", "order", "limit"]) q[m] = (...args: unknown[]) => { call.ops.push([m, args]); return q; };
      q.then = (res: (v: unknown) => unknown) => {
        if (table === "checklist_templates") return Promise.resolve({ data: [{ id: "close-v1" }, { id: "close-v2" }], error: null }).then(res);
        let rows = [...instances];
        let limit = Infinity;
        for (const [m, args] of call.ops) {
          const [col, val] = args as [string, unknown];
          if (m === "eq") rows = rows.filter((r) => (r as Record<string, unknown>)[col] === val);
          if (m === "in") rows = rows.filter((r) => (val as unknown[]).includes((r as Record<string, unknown>)[col]));
          if (m === "lte") rows = rows.filter((r) => String((r as Record<string, unknown>)[col]) <= String(val));
          if (m === "gte") rows = rows.filter((r) => String((r as Record<string, unknown>)[col]) >= String(val));
          if (m === "order") rows.sort((a, b) => ((args[1] as { ascending: boolean }).ascending ? 1 : -1) * a.date.localeCompare(b.date));
          if (m === "limit") limit = Number(col);
        }
        return Promise.resolve({ data: rows.slice(0, limit).map((r) => ({ date: r.date })), error: null }).then(res);
      };
      return q;
    };
    return { client: { from } as never, calls };
  }
  const viewer = { userId: "gm", level: 7, locations: ["shop"] };
  const inst = (date: string, status: string, template_id = "close-v2", location_id = "shop") => ({ date, status, template_id, location_id });

  it("Oct 14 with the last finalized closing on Oct 6 shows Oct 6 (no 7-day window, no fake 'yesterday')", async () => {
    const { client } = fakeClient([inst("2026-10-06", "confirmed", "close-v1"), inst("2026-10-13", "in_progress")]);
    expect(await latestFinalizedClosingDate(client, { viewer, locationId: "shop", onOrBefore: "2026-10-14" })).toBe("2026-10-06");
  });
  it("is today once tonight's closing is confirmed, and never a future-dated row", async () => {
    const { client } = fakeClient([inst("2026-10-13", "confirmed"), inst("2026-10-14", "confirmed"), inst("2026-10-15", "confirmed")]);
    expect(await latestFinalizedClosingDate(client, { viewer, locationId: "shop", onOrBefore: "2026-10-14" })).toBe("2026-10-14");
  });
  it("an auto-closed closing counts as the close (labelled auto closed on the card); unfinished and other shops do not", async () => {
    const { client } = fakeClient([inst("2026-10-12", "auto_finalized"), inst("2026-10-13", "in_progress"), inst("2026-10-14", "confirmed", "close-v2", "other")]);
    expect(await latestFinalizedClosingDate(client, { viewer, locationId: "shop", onOrBefore: "2026-10-14" })).toBe("2026-10-12");
  });
  it("is null when nothing closed in the bounded window (the page then shows yesterday)", async () => {
    const { client } = fakeClient([inst("2026-01-01", "confirmed")]);
    expect(await latestFinalizedClosingDate(client, { viewer, locationId: "shop", onOrBefore: "2026-10-14" })).toBeNull();
  });
  it("the read is bounded: closing templates only, finalized statuses, today and the 92 days back, newest first, limit 1", async () => {
    const { client, calls } = fakeClient([]);
    await latestFinalizedClosingDate(client, { viewer, locationId: "shop", onOrBefore: "2026-10-14" });
    expect(calls[0]).toMatchObject({ table: "checklist_templates", ops: expect.arrayContaining([["eq", ["type", "closing"]]]) });
    const ops = calls[1]!.ops;
    expect(calls[1]!.table).toBe("checklist_instances");
    expect(ops).toContainEqual(["in", ["template_id", ["close-v1", "close-v2"]]]);
    expect(ops).toContainEqual(["in", ["status", [...FINALIZED_REPORT_STATUSES]]]);
    expect(ops).toContainEqual(["lte", ["date", "2026-10-14"]]);
    expect(ops).toContainEqual(["gte", ["date", "2026-07-15"]]);
    expect(ops).toContainEqual(["order", ["date", { ascending: false }]]);
    expect(ops).toContainEqual(["limit", [1]]);
    expect(LAST_CLOSE_MAX_LOOKBACK_DAYS).toBe(92);
  });
  it("refuses an out-of-scope shop before any read", async () => {
    const { client, calls } = fakeClient([]);
    await expect(latestFinalizedClosingDate(client, { viewer, locationId: "elsewhere", onOrBefore: "2026-10-14" })).rejects.toThrow("report_scope_forbidden");
    expect(calls).toHaveLength(0);
  });
  it("the hub uses it for managers and loads only that day's reports", () => {
    const page = readFileSync("app/(authed)/reports/page.tsx", "utf8");
    expect(page).toContain("latestFinalizedClosingDate(service, { viewer, locationId: shop.id, onOrBefore: today })) ?? yesterday");
    expect(page).toContain("listReportSkeleton(service, { viewer, locationId: shop.id, dateFrom: closeDay, dateTo: closeDay })");
    expect(page).toContain("formatDateLabel(closeDay, language)");
  });
});

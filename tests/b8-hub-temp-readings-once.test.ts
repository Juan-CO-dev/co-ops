import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listReports, type ReportListItem } from "@/lib/reports-hub";
import { composeReportSummary, summaryTempReadings } from "@/lib/report-summary";

// B8 #4 r2 (Astra P1 on c373615e): dropping every maintenance row's flags from the hub summary
// zeroed a hot fridge on TODAY's unfinished opening (its report is not listed until finalized,
// but the maintenance day row carries its live reading). Each out-of-range reading now counts
// exactly once: a day's maintenance reading count replaces that day's listed reports.

type Row = Record<string, unknown>;
function fake(tables: Record<string, Row[]>) {
  return { from(table: string) {
    let rows = [...(tables[table] ?? [])]; let columns = ""; let start = 0; let end = Infinity;
    const q = {
      select(c: string) { columns = c; return q; },
      eq(k: string, v: unknown) { rows = rows.filter((r) => r[k] === v); return q; },
      match(m: Row) { for (const [k, v] of Object.entries(m)) q.eq(k, v); return q; },
      in(k: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[k])); return q; },
      is(k: string, v: unknown) { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
      gte(k: string, v: string) { rows = rows.filter((r) => String(r[k]) >= v); return q; },
      lte(k: string, v: string) { rows = rows.filter((r) => String(r[k]) <= v); return q; },
      lt(k: string, v: string) { rows = rows.filter((r) => String(r[k]) < v); return q; },
      not(k: string, _op: string, v: unknown) { rows = rows.filter((r) => (r[k] ?? null) !== v); return q; },
      or(filter: string) {
        const m = /^status\.in\.\(([^)]+)\),report_date\.lt\.(.+)$/.exec(filter);
        if (!m) throw new Error(`Unsupported OR: ${filter}`);
        rows = rows.filter((r) => m[1]!.split(",").includes(String(r.status)) || String(r.report_date) < m[2]!);
        return q;
      },
      order() { return q; }, limit(n: number) { end = n - 1; return q; }, returns() { return q; },
      range(a: number, b: number) { start = a; end = b; return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(resolve: (v: unknown) => unknown) {
        const data = rows.slice(start, end === Infinity ? undefined : end + 1)
          .map((r) => Object.fromEntries(columns.split(",").map((k) => [k.trim(), r[k.trim()]])));
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return q;
  } } as unknown as SupabaseClient;
}

const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const viewer = { userId: "gm", level: 7, locations: ["shop"] };
const inst = (id: string, date: string, template: "t-open" | "t-close", status: string) =>
  ({ id, location_id: "shop", date, template_id: template, status, confirmed_by: "gm", confirmed_at: status === "open" ? null : `${date}T21:00:00Z` });
const reading = (id: string, instanceId: string, item: "am-temp" | "pm-temp", value: number) =>
  ({ id, instance_id: instanceId, template_item_id: item, completed_by: "kh", count_value: value, notes: null, prep_data: null });
function tables(instances: Row[], completions: Row[]): Record<string, Row[]> {
  return {
    checklist_instances: instances,
    checklist_templates: [{ id: "t-open", type: "opening", prep_subtype: null }, { id: "t-close", type: "closing", prep_subtype: null }],
    checklist_template_items: [
      { id: "am-temp", template_id: "t-open", label: "Walk-in AM", station: "Kitchen", required: true, active: true },
      { id: "pm-temp", template_id: "t-close", label: "Walk-in PM", station: "Kitchen", required: true, active: true },
    ],
    checklist_completions: completions,
    maintenance_equipment: [{ id: "walkin", kind: "fridge", name: "Walk-in", active: true, location_id: "shop", opening_temp_item_id: "am-temp", closing_temp_item_id: "pm-temp", safe_max_f: 41, sort_order: 1 }],
    users: [{ id: "gm", name: "GM" }, { id: "kh", name: "KH" }],
  };
}
async function hubTempFlags(instances: Row[], completions: Row[], from = YESTERDAY): Promise<number> {
  const items = await listReports(fake(tables(instances, completions)), { viewer, locationId: "shop", dateFrom: from, dateTo: TODAY });
  return composeReportSummary(items).signals.tempFlags;
}

afterEach(() => { vi.useRealTimers(); });
const atToday = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T16:00:00Z`)); };

describe("B8 #4 r2 hub summary counts each hot reading once", () => {
  it("an UNFINISHED opening today with a hot reading counts 1 (its report is not listed yet)", async () => {
    atToday();
    expect(await hubTempFlags([inst("o-today", TODAY, "t-open", "open")], [reading("r1", "o-today", "am-temp", 45)])).toBe(1);
  });
  it("a finalized report plus its maintenance day row counts once, not twice", async () => {
    atToday();
    expect(await hubTempFlags([inst("o-y", YESTERDAY, "t-open", "confirmed")], [reading("r1", "o-y", "am-temp", 45)])).toBe(1);
  });
  it("a mixed day (finalized opening, unfinished closing) counts both hot readings once each", async () => {
    atToday();
    expect(await hubTempFlags(
      [inst("o-today", TODAY, "t-open", "confirmed"), inst("c-today", TODAY, "t-close", "open"), inst("o-y", YESTERDAY, "t-open", "confirmed")],
      [reading("r1", "o-today", "am-temp", 45), reading("r2", "c-today", "pm-temp", 44), reading("r3", "o-y", "am-temp", 38)],
    )).toBe(2);
  });
  it("in-range readings never count", async () => {
    atToday();
    expect(await hubTempFlags([inst("o-today", TODAY, "t-open", "open")], [reading("r1", "o-today", "am-temp", 37)])).toBe(0);
  });
});

describe("B8 #4 r2 the pure per-day rule", () => {
  const sig = (tempFlags: number, tempReadings?: number) =>
    ({ underPar: 0, overPar: 0, skipped: 0, notStarted: 0, tempFlags, ...(tempReadings === undefined ? {} : { tempReadings }), cashOverShortCents: null });
  const row = (type: ReportListItem["type"], date: string, tempFlags: number, tempReadings?: number) =>
    ({ type, id: `${type}-${date}`, date, locationId: "shop", submitterName: null, status: "ok", signalSummary: sig(tempFlags, tempReadings) }) as ReportListItem;
  it("a maintenance reading count replaces that day's reports; other days keep theirs", () => {
    expect(summaryTempReadings([row("opening", YESTERDAY, 1), row("maintenance", YESTERDAY, 1, 1), row("closing", TODAY, 2)])).toBe(3);
  });
  it("maintenance alone (unfinished reports) still counts", () => {
    expect(summaryTempReadings([row("maintenance", TODAY, 1, 2)])).toBe(2);
  });
});

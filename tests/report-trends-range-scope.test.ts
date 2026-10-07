import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clippedBucketKeys, loadTrendSeries, resolveTrendRange } from "@/lib/reports-trends";
import { loadPersonDetail, loadTeamOperatingHealth } from "@/lib/team-metrics";
import { parseReportRange } from "@/lib/report-range";

type Row = Record<string, unknown>;
function fake(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  return { reads, service: { from(table: string) {
    reads.push(table);
    let rows = [...(tables[table] ?? [])];
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
      is: (key: string, value: unknown) => { rows = rows.filter(r => (r[key] ?? null) === value); return q; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[key])); return q; },
      gte: (key: string, value: string) => { rows = rows.filter(r => String(r[key]) >= value); return q; },
      lte: (key: string, value: string) => { rows = rows.filter(r => String(r[key]) <= value); return q; },
      lt: (key: string, value: string) => { rows = rows.filter(r => String(r[key]) < value); return q; },
      range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
    };
    return q;
  } } as unknown as SupabaseClient };
}

describe("trends loader scope and independent clipped windows", () => {
  const args = { locationId: "mine", granularity: "month" as const, compare: false, today: "2026-10-07" };
  it("refuses employee aggregates, forged all scope and unassigned locations before reading data", async () => {
    const f = fake({ cash_reports: [{ over_short_cents: 9999 }] });
    await expect(loadTrendSeries(f.service, { ...args, viewer: { userId: "reader", level: 3, locations: ["mine"] } })).rejects.toThrow("Forbidden");
    for (const locations of [[], "all"] as const) {
      const viewer = { userId: "reader", level: 7, locations };
      await expect(loadTrendSeries(f.service, { ...args, viewer })).rejects.toThrow("Forbidden");
      expect(await loadTeamOperatingHealth(f.service, { ...args, viewer })).toBeNull();
      expect(await loadPersonDetail(f.service, { ...args, viewer, personId: "someone" })).toBeNull();
    }
    expect(await loadTeamOperatingHealth(f.service, { ...args, viewer: { userId: "reader", level: 5, locations: ["mine"] } })).toBeNull();
    expect(f.reads).toEqual([]);
  });
  it("does not merge overlapping month bucket keys or leak the other shop's cash", async () => {
    const f = fake({ cash_reports: [
      { id: "a", location_id: "mine", report_date: "2026-10-06", over_short_cents: 120 },
      { id: "b", location_id: "mine", report_date: "2026-10-03", over_short_cents: 30 },
      { id: "c", location_id: "other", report_date: "2026-10-06", over_short_cents: 9999 },
      { id: "d", location_id: "mine", report_date: "2026-10-01", over_short_cents: 9999 },
    ] });
    const range = parseReportRange({ range: "custom", from: "2026-10-05", to: "2026-10-07", compare: "1" }, args.today, "month");
    const result = await loadTrendSeries(f.service, { ...args, range, viewer: { userId: "kh", level: 4, locations: ["mine"] } });
    expect(result.totals.cash).toEqual({ current: 120, previous: 30, delta: 90 });
    expect(result.current[0]?.key).toBe("2026-10-01");
    expect(result.previous?.[0]?.key).toBe("2026-10-01");
    expect(result.current[0]?.cashOverShortCents).toBe(120);
  });
  it("preserves six-month defaults and bounds grain-specific bucket counts", () => {
    const defaults = resolveTrendRange({}, args.today, "month");
    expect(defaults.from).toBe("2026-05-01");
    for (const [grain, cap] of [["day", 92], ["week", 26], ["month", 12]] as const) {
      const r = resolveTrendRange({ from: "2020-01-01", to: args.today, compare: "1" }, args.today, grain);
      expect(clippedBucketKeys(r.from, r.to, grain)).toHaveLength(cap);
      expect(clippedBucketKeys(r.previous.from, r.previous.to, grain).length).toBeLessThanOrEqual(cap);
    }
  });
  it("keeps historical unfinished instances but excludes today's unfinished work", async () => {
    const f = fake({
      checklist_instances: [
        { id: "past", location_id: "mine", date: "2026-10-06", status: "open", template_id: "opening" },
        { id: "today", location_id: "mine", date: "2026-10-07", status: "open", template_id: "opening" },
      ],
      checklist_templates: [{ id: "opening", type: "opening", prep_subtype: null }],
    });
    const result = await loadTrendSeries(f.service, { ...args, granularity: "day", viewer: { userId: "kh", level: 4, locations: ["mine"] } });
    expect(result.current.find(b => b.key === "2026-10-06")?.hasData).toBe(true);
    expect(result.current.find(b => b.key === "2026-10-07")?.hasData).toBe(false);
  });
});

import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMyPerformance, loadPersonDetail } from "@/lib/team-metrics";

type Row = Record<string, unknown>;

it("chunks person completion IDs and retains current activity on an older instance", async () => {
  const ids = Array.from({ length: 225 }, (_, i) => `instance-${i}`);
  const chunkSizes: number[] = [];
  const tables: Record<string, Row[]> = {
    user_locations: [{ user_id: "employee", location_id: "shop", active: true }],
    users: [{ id: "employee", name: "Employee", role: "employee", active: true, created_at: "2026-01-01T00:00:00Z" }],
    checklist_instances: ids.map((id, i) => ({ id, location_id: "shop", date: i === 0 ? "2026-01-01" : "2026-10-07", confirmed_by: null, confirmed_at: null })),
    checklist_completions: ids.map((id, i) => ({ instance_id: id, completed_by: "employee", completed_at: "2026-10-07T16:00:00Z", notes: i === 0 ? "late work" : null, superseded_at: null, revoked_at: null })),
  };
  const service = { from(table: string) {
    let rows = [...(tables[table] ?? [])];
    let start = 0, end = Infinity;
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return q; },
      in: (key: string, values: unknown[]) => {
        if (key === "instance_id") chunkSizes.push(values.length);
        if (values.length > 50) throw new Error("request too long");
        rows = rows.filter(row => values.includes(row[key])); return q;
      },
      gte: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) >= value); return q; },
      lte: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) <= value); return q; },
      lt: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) < value); return q; },
      is: (key: string, value: unknown) => { rows = rows.filter(row => (row[key] ?? null) === value); return q; },
      not: (key: string, operator: string, value: unknown) => {
        if (operator === "is") rows = rows.filter(row => (row[key] ?? null) !== value);
        return q;
      },
      range: (from: number, to: number) => { start = from; end = to; return q; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows.slice(start, end === Infinity ? undefined : end + 1), error: null })),
    };
    return q;
  } } as unknown as SupabaseClient;

  const common = { locationId: "shop", granularity: "day" as const, compare: false, today: "2026-10-07" };
  const self = await loadMyPerformance(service, { ...common, viewer: { userId: "employee", level: 3, locations: ["shop"] } });
  const detail = await loadPersonDetail(service, { ...common, personId: "employee", viewer: { userId: "manager", level: 6, locations: ["shop"] } });
  expect(chunkSizes).toEqual([50, 50, 50, 50, 25, 50, 50, 50, 50, 25]);
  expect(self?.score).toBeGreaterThan(0);
  expect(detail?.counts.tasks).toBe(225);
  expect(detail?.counts.notes).toBe(1);
});

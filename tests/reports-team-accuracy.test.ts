import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMyPerformance, loadPersonDetail, loadTeamOperatingHealth } from "@/lib/team-metrics";
import { loadShiftWrapUp } from "@/lib/pm-report";
import { listMaintenanceReportDates } from "@/lib/maintenance";
import { buildSearchCorpus } from "@/lib/reports-search";
import type { ReportListItem } from "@/lib/reports-hub";

type Row = Record<string, unknown>;
function fixture() {
  const users = ["employee", "other"].map(id => ({ id, name: `${id} Lastname`, role: "employee", active: true, created_at: "2026-01-01T00:00:00Z" }));
  const tables: Record<string, Row[]> = {
    users,
    user_locations: users.map(u => ({ user_id: u.id, location_id: "shop", active: true })),
    checklist_instances: ["opening", "closing"].map(id => ({ id, template_id: "template", location_id: "shop", date: "2026-10-07", confirmed_by: null, confirmed_at: null })),
    checklist_completions: [
      { id: "b", instance_id: "opening", template_item_id: "item", completed_by: "employee", completed_at: "2026-10-07T16:00:00Z", notes: "phase two" },
      { id: "a", instance_id: "opening", template_item_id: "item", completed_by: "employee", completed_at: "2026-10-06T16:00:00Z", notes: "phase one" },
      { id: "c", instance_id: "opening", template_item_id: "item", completed_by: "other", completed_at: "2026-10-07T16:00:00Z", notes: null },
      { id: "d", instance_id: "closing", template_item_id: "item", completed_by: "employee", completed_at: "2026-10-07T16:00:00Z", notes: null },
      { id: "e", instance_id: "closing", template_item_id: "another", completed_by: "employee", completed_at: "2026-10-07T16:00:00Z", notes: null },
    ],
    pm_reports: ["open", "in_progress", "submitted", "incomplete_confirmed", "auto_finalized"].map(status => ({ id: status, status, location_id: "shop", report_date: "2026-10-07", mvp_user_id: "employee", submitted_by: "manager", submitted_at: null })),
    pm_employee_evals: ["open", "in_progress", "submitted", "incomplete_confirmed", "auto_finalized"].map(id => ({ id, pm_report_id: id, employee_id: "employee", arrived_ready: "great", attitude: "good", production: "good", team_player: "needs_work", area_to_improve: "Practice" })),
    maintenance_equipment: [{ id: "fridge", location_id: "shop", active: true, kind: "fridge", name: "Fridge", opening_temp_item_id: "item", safe_max_f: 41 }],
  };
  const orders: { table: string; columns: string[] }[] = [];
  const service = { from(table: string) {
    let rows = [...(tables[table] ?? [])], start = 0, end = Infinity;
    const columns: string[] = [];
    orders.push({ table, columns });
    const q = {
      select: () => q, returns: () => q,
      eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
      match: (values: Row) => { rows = rows.filter(r => Object.entries(values).every(([k, v]) => r[k] === v)); return q; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[key])); return q; },
      gte: (key: string, value: string) => { rows = rows.filter(r => typeof r[key] === "string" && r[key] >= value); return q; },
      lte: (key: string, value: string) => { rows = rows.filter(r => typeof r[key] === "string" && r[key] <= value); return q; },
      lt: (key: string, value: string) => { rows = rows.filter(r => typeof r[key] === "string" && r[key] < value); return q; },
      is: (key: string, value: unknown) => { rows = rows.filter(r => (r[key] ?? null) === value); return q; },
      not: (key: string, _operator: string, value: unknown) => { rows = rows.filter(r => (r[key] ?? null) !== value); return q; },
      order: (key: string) => { columns.push(key); return q; },
      range: (from: number, to: number) => { start = from; end = to; return q; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        rows.sort((a, b) => { for (const key of columns) { const n = String(a[key]).localeCompare(String(b[key])); if (n) return n; } return 0; });
        return Promise.resolve(resolve({ data: rows.slice(start, end === Infinity ? undefined : end + 1), error: null }));
      },
    };
    return q;
  } } as unknown as SupabaseClient;
  return { service, orders, tables };
}
const common = { locationId: "shop", granularity: "day" as const, compare: false, today: "2026-10-07" };
const viewer = { userId: "manager", level: 6, locations: ["shop"] };

it("counts distinct instance/items per contributor in roster, person and wrap-up while preserving notes", async () => {
  const { service, orders } = fixture();
  const team = await loadTeamOperatingHealth(service, { ...common, viewer });
  const detail = await loadPersonDetail(service, { ...common, viewer, personId: "employee" });
  const wrap = await loadShiftWrapUp(service, { locationId: "shop", date: "2026-10-07" });
  expect(team?.members.find(m => m.userId === "employee")?.counts).toMatchObject({ tasks: 3, notes: 2 });
  expect(team?.members.find(m => m.userId === "other")?.counts.tasks).toBe(1);
  expect(detail?.counts).toMatchObject({ tasks: 3, notes: 2 });
  expect(detail?.streaks.personalBest).toBe(2);
  expect(wrap.find(r => r.userId === "employee")).toMatchObject({ itemsCompleted: 3, name: "employee Lastname" });
  expect(wrap.find(r => r.userId === "other")?.itemsCompleted).toBe(1);
  expect(orders.filter(o => o.table === "checklist_completions" && o.columns.length).map(o => o.columns)).toEqual([["completed_at", "id"], ["completed_at", "id"]]);
});

it("excludes draft feedback and MVPs from both person and self views", async () => {
  const { service } = fixture();
  const detail = await loadPersonDetail(service, { ...common, viewer, personId: "employee" });
  const self = await loadMyPerformance(service, { ...common, viewer: { ...viewer, userId: "employee", level: 3 } });
  for (const result of [detail, self]) {
    expect(result?.gradientTally).toEqual({ great: 3, good: 6, needsWork: 3 });
    expect(result?.signals).toMatchObject({ mvpAwards: 3, flaggedToImprove: 3 });
  }
});

it("orders paged search/maintenance completions and roster evaluations by a unique tiebreaker", async () => {
  const { service, orders, tables } = fixture();
  tables.pm_reports!.push({ id: "authored", location_id: "shop", submitted_by: "employee", submitted_at: "2026-10-07T16:00:00Z" });
  await loadTeamOperatingHealth(service, { ...common, viewer });
  await listMaintenanceReportDates(service, "shop", "2026-10-01", "2026-10-07");
  await buildSearchCorpus(service, { viewer, locationId: "shop", items: [{ id: "opening", type: "opening" } as ReportListItem] });
  expect(orders.filter(o => o.table === "pm_employee_evals").map(o => o.columns)).toContainEqual(["pm_report_id", "id"]);
  expect(orders.filter(o => o.table === "checklist_completions").map(o => o.columns)).toEqual([["completed_at", "id"], ["instance_id", "id"], ["instance_id", "id"]]);
});

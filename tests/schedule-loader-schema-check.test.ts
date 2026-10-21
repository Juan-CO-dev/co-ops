/**
 * Scheduling Phase 2, Task 16 — every query `loadSchedulingInputs` builds names only columns that EXIST (the in-memory
 * fake accepts any column). The loader runs against a RECORDING client (canned rows walk it past each first read, and
 * 7shifts is switched `ready` so the wage reads are captured too); PGlite applies the scheduling stub, the REAL level
 * helpers, 0243, 0268, 0269, 0270, the 0272 posture, the REAL 0274 and 0275, the real 0224 table, and the columns the
 * station / membership reads need (0230 / 0238 / the membership's assigned_at); every captured query on a table that
 * schema defines is EXECUTED with `limit 0`.
 *
 * Foundation tables with no DDL in this repo (checklists, catering, audit_log, ezcater_orders' parent) cannot be
 * executed here; their captured column lists are PINNED instead, so a change to them is a reviewed act.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Captured { table: string; select: string[]; filters: string[]; order: string[] }
const captured: Captured[] = [];
const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];

function recordingClient(canned: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const rec: Captured = { table, select: [], filters: [], order: [] };
      captured.push(rec);
      const q: Record<string, unknown> = {};
      const col = (c: string) => { rec.filters.push(c.split(".")[0]!); return q; };
      Object.assign(q, {
        select: (cols: string) => { rec.select = cols.split(",").map((c) => c.trim()).filter(Boolean); return q; },
        eq: col, neq: col, is: col, in: col, gt: col, gte: col, lt: col, lte: col, not: col,
        or: (expr: string) => { for (const alt of expr.split(",")) rec.filters.push(alt.split(".")[0]!); return q; },
        order: (c: string) => { rec.order.push(c); return q; },
        range: () => q, limit: () => q, abortSignal: () => q,
        maybeSingle: async () => ({ data: canned[table]?.[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: canned[table] ?? [], error: null }).then(resolve),
      });
      return q;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      const p = Promise.resolve({ data: { hours: [], captured_days: [] }, error: null });
      return Object.assign(p, { abortSignal: () => p });
    },
  } as unknown as SupabaseClient;
}

import { loadSchedulingInputs } from "@/lib/scheduling/inputs";

const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
const WEEK = "2026-10-26";
const REV = "6f1d2c3e-0000-4000-8000-0000000000b1";
const read = (p: string) => readFileSync(p, "utf8");
function extract(sql: string, start: string, end = "end $$;"): string {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start}`);
  const j = sql.indexOf(end, i);
  return sql.slice(i, j + end.length);
}

/** Tables whose DDL lives in this repo's migrations (or the stub), so their queries EXECUTE. */
const EXECUTED = new Set([
  "schedule_shop_settings", "schedule_structures", "schedule_person_settings", "schedule_budget_entries", "schedule_budget_days", "schedule_day_types", "schedule_pins",
  "schedule_weeks", "schedule_revisions", "schedule_revision_shifts", "schedule_revision_days", "schedule_revision_gaps", "schedule_revision_contexts",
  "toast_time_entries", "sevenshifts_user_links", "sevenshifts_wages", "sevenshifts_labor_settings", "users", "user_locations", "stations", "station_positions",
  "people_skill_tunables", "people_skill_adjustments", "people_skill_ratings", "people_shop_settings", "station_events",
]);
/** Foundation tables (no DDL here): the columns each new Phase 2 read names, pinned. */
const PINNED: Record<string, string[]> = {
  catering_pipeline: ["id", "contact_name", "company", "event_date", "time_window", "headcount", "stage", "delivery_address", "estimated_revenue_cents"],
  catering_quotes: ["pipeline_id", "total_cents", "is_delivery", "version"],
  ezcater_orders: ["id", "event_date", "event_timestamp", "handoff_time", "headcount", "total_cents", "status"],
  audit_log: ["metadata"],
  checklist_submissions: ["instance_id"],
};

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("tests/fixtures/scheduling-pglite-stub.sql"));
  await db.exec([
    extract(read("supabase/migrations/0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
    extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
    extract(read("supabase/migrations/0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
  ].join("\n"));
  for (const m of ["0243_cron_route_leases", "0268_sevenshifts_sync", "0269_sevenshifts_links", "0270_people_layer"]) await db.exec(read(`supabase/migrations/${m}.sql`));
  await db.exec("revoke insert, update, delete, truncate on public.locations, public.user_locations from anon, authenticated;");
  await db.exec(read("supabase/migrations/0274_schedule_settings.sql"));
  await db.exec(read("supabase/migrations/0275_schedule_weeks.sql"));
  await db.exec(extract(read("supabase/migrations/0224_toast_time_entries.sql"), "create table public.toast_time_entries (", ");"));
  // Staff separations (0279): the employment read (0279's pre-flight needs the user-admin columns the stub does not model).
  await db.exec(read("tests/fixtures/user-admin-columns-stub.sql"));
  await db.exec(read("supabase/migrations/0279_user_employment_events.sql"));
  // Production columns the stub does not model: 0230 / 0238 station closing settings and the membership's assigned_at
  // (user management spec, docs/superpowers/specs/2026-06-20-user-management-design.md).
  await db.exec(`alter table public.stations add column usually_closes_at time, add column trims jsonb;
    alter table public.station_positions add column usually_trims_at time;
    alter table public.user_locations add column assigned_at timestamptz;`);
  const prev = { t: process.env.SEVENSHIFTS_ACCESS_TOKEN, s: process.env.SEVENSHIFTS_SYNC };
  process.env.SEVENSHIFTS_ACCESS_TOKEN = "test-token-not-real";
  process.env.SEVENSHIFTS_SYNC = "1";
  try {
    const svc = recordingClient({
      schedule_weeks: [{ id: "w1", week_start: WEEK, head_revision_id: REV, approved_revision_id: null }],
      schedule_revisions: [{ id: REV, kind: "generated", based_on_revision_id: null, structure_version_id: null, inputs_digest: "d", generator_version: "p2.4", created_by: null, actor_context: "cron", created_at: "2026-10-21T10:15:00Z" }],
      schedule_revision_contexts: [{ context: { version: 1, locationId: LOC, weekStart: WEEK, today: "2026-10-21", dates: [], days: {}, budgetByDate: {}, closingWindowByDate: {}, people: {} } }],
      user_locations: [{ user_id: "u1", assigned_at: null }],
      users: [{ id: "u1", name: "Eli", role: "employee" }],
      schedule_budget_days: [{ entry_id: "e1", business_date: WEEK, hours: 8 }],
      catering_pipeline: [{ id: "cp1", contact_name: "Pat", company: null, event_date: WEEK, time_window: null, headcount: 10, stage: "confirmed", delivery_address: null, estimated_revenue_cents: 1 }],
      checklist_templates: [{ id: "t1" }],
      checklist_instances: [{ id: "i1", date: "2026-10-20", template_id: "t1", shift_start_at: null, triggered_at: null }],
      sevenshifts_user_links: [{ sevenshifts_user_id: "77", user_id: "u1" }],
    });
    await loadSchedulingInputs(svc, { locationId: LOC, weekStarts: [WEEK], now: new Date("2026-10-21T16:00:00Z") });
    // Chunk F: the board's own two reads (position labels; an edited head's origin contexts).
    const board = await import("@/lib/scheduling/board");
    await board.loadPositionLabelRows(svc, LOC);
    await board.loadOriginContexts(svc, LOC, [REV]);
    // Task 24: the settings page's own reads (the station seed columns, the MoO / Owner presence list).
    const inputsMod = await import("@/lib/scheduling/inputs");
    await inputsMod.loadStationSeedRows(svc, LOC);
    const settingsView = await import("@/lib/scheduling/settings-view");
    await settingsView.loadPresencePeople(svc);
    // Juan 2026-10-20: the Toast primary suggestion's hours-by-job read (settings page + the admin user screen).
    const suggest = await import("@/lib/scheduling/position-suggest");
    await suggest.loadToastJobHours(svc, LOC, "2026-10-21");
    // Astra BC-007: the save path's one-person latest-row read (the merge and the stale check) and the card's row ids.
    await inputsMod.loadLatestPersonSettings(svc, LOC, "6f1d2c3e-0000-4000-8000-0000000000c1");
    await inputsMod.loadPersonSettingsWithIds(svc, LOC);
  } finally {
    if (prev.t === undefined) delete process.env.SEVENSHIFTS_ACCESS_TOKEN; else process.env.SEVENSHIFTS_ACCESS_TOKEN = prev.t;
    if (prev.s === undefined) delete process.env.SEVENSHIFTS_SYNC; else process.env.SEVENSHIFTS_SYNC = prev.s;
  }
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("loadSchedulingInputs against the real schema", () => {
  it("captured a read of every 0274 / 0275 table it needs, the punches, the 7shifts wages and labor line", () => {
    const tables = new Set(captured.map((c) => c.table));
    for (const t of ["schedule_shop_settings", "schedule_structures", "schedule_person_settings", "schedule_budget_entries", "schedule_budget_days", "schedule_day_types",
      "schedule_pins", "schedule_weeks", "schedule_revisions", "schedule_revision_shifts", "schedule_revision_days", "schedule_revision_gaps", "schedule_revision_contexts",
      "toast_time_entries", "sevenshifts_user_links", "sevenshifts_wages", "sevenshifts_labor_settings", "catering_pipeline", "catering_quotes", "ezcater_orders", "audit_log",
      "checklist_submissions", "user_employment_events"]) expect(tables, t).toContain(t);
  });

  it("every captured query on a table with DDL here executes against it (limit 0)", async () => {
    const mine = captured.filter((c) => EXECUTED.has(c.table));
    expect(mine.length).toBeGreaterThanOrEqual(25);
    for (const c of mine) {
      const where = [...new Set(c.filters)].map((f) => `${f} is not distinct from ${f}`).join(" and ") || "true";
      const order = c.order.length ? ` order by ${c.order.join(", ")}` : "";
      const sql = `select ${c.select.join(", ")} from public.${c.table} where ${where}${order} limit 0`;
      await expect(db.query(sql), sql).resolves.toBeDefined();
    }
  });

  it("the foundation-table reads name exactly the pinned columns; the demand read is ONE RPC with the 0242 named args", () => {
    for (const [t, cols] of Object.entries(PINNED)) {
      for (const c of captured.filter((x) => x.table === t)) expect(c.select, t).toEqual(cols);
    }
    expect(rpcs.filter((r) => r.name === "pulse_sales_baseline")).toEqual([{ name: "pulse_sales_baseline", args: { p_location_id: LOC, p_from: "2026-09-23", p_to: "2026-10-20" } }]);
    expect(captured.every((c) => !c.select.some((s) => s.includes("*")))).toBe(true);
  });

  it("the Toast suggestion read: linked rows only, not deleted, in a date window — hours by job, never a name or a wage", () => {
    const reads = captured.filter((c) => c.table === "toast_time_entries" && c.select.includes("job_name"));
    expect(reads).toHaveLength(1);
    expect(new Set(reads[0]!.filters)).toEqual(new Set(["location_id", "deleted", "user_id", "business_date"]));
    expect(reads[0]!.select).toEqual(["time_entry_guid", "user_id", "job_name", "hours"]);
  });

  it("the latest-row read for one person is filtered by shop AND person, newest first", () => {
    const one = captured.filter((c) => c.table === "schedule_person_settings" && c.filters.includes("user_id"));
    expect(one).toHaveLength(1);
    expect(new Set(one[0]!.filters)).toEqual(new Set(["location_id", "user_id"]));
  });

  it("the punch read is linked rows only, not deleted, in a date window; the wage read is current hourly rows of linked users", () => {
    const punch = captured.find((c) => c.table === "toast_time_entries")!;
    expect(new Set(punch.filters)).toEqual(new Set(["location_id", "deleted", "user_id", "business_date"]));
    expect(punch.select).not.toContain("employee_first_name");
    const wage = captured.find((c) => c.table === "sevenshifts_wages")!;
    expect(new Set(wage.filters)).toEqual(new Set(["user_id", "active", "upcoming"]));
  });
});

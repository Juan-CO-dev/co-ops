/**
 * Scheduling Phase 2, chunk G, Task 25 — every query `loadReconciliation` builds names only columns that EXIST (the
 * in-memory fake accepts any column). The loader runs against a RECORDING client with 7shifts switched `ready` and canned
 * rows that walk it past each first read; PGlite applies the scheduling stub, the REAL 0233 link table, 0224, 0268, 0269,
 * 0274 and 0275 (the same setup as tests/schedule-loader-schema-check.test.ts); every captured query is EXECUTED with
 * `limit 0`. The loader calls no RPC and never selects `*`.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

interface Captured { table: string; select: string[]; filters: string[]; order: string[] }
const captured: Captured[] = [];
const rpcs: string[] = [];

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
        order: (c: string) => { rec.order.push(c); return q; },
        range: () => q, limit: () => q, abortSignal: () => q,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: canned[table] ?? [], error: null }).then(resolve),
      });
      return q;
    },
    rpc: (name: string) => { rpcs.push(name); return Promise.resolve({ data: null, error: null }); },
  } as unknown as SupabaseClient;
}

const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
const read = (p: string) => readFileSync(p, "utf8");
function extract(sql: string, start: string, end = "end $$;"): string {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start}`);
  const j = sql.indexOf(end, i);
  return sql.slice(i, j + end.length);
}

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
  await db.exec(read("supabase/migrations/0278_schedule_person_settings_guarded.sql"));
  await db.exec(read("supabase/migrations/0280_schedule_person_works_as.sql"));
  await db.exec(read("supabase/migrations/0281_schedule_person_availability.sql"));
  await db.exec(extract(read("supabase/migrations/0224_toast_time_entries.sql"), "create table public.toast_time_entries (", ");"));
  await db.exec(extract(read("supabase/migrations/0233_whos_here.sql"), "create table public.toast_employee_links (", ");"));
  // Staff separations (0279): the employment read (0279's pre-flight needs the user-admin columns the stub does not model).
  await db.exec(read("tests/fixtures/user-admin-columns-stub.sql"));
  await db.exec(read("supabase/migrations/0279_user_employment_events.sql"));
  const prev = { t: process.env.SEVENSHIFTS_ACCESS_TOKEN, s: process.env.SEVENSHIFTS_SYNC };
  try {
    const { loadReconciliation } = await import("@/lib/scheduling/reconcile");
    const svc = recordingClient({
      user_locations: [{ user_id: "u1" }],
      users: [{ id: "u1", name: "Eli", role: "employee", active: true }],
      schedule_weeks: [{ week_start: "2026-10-19", head_revision_id: "6f1d2c3e-0000-4000-8000-0000000000b1" }],
      sevenshifts_location_links: [{ sevenshifts_location_id: 9001 }],
      sevenshifts_user_assignments: [{ user_id: 701 }],
    });
    await loadReconciliation({ service: svc, now: new Date("2026-10-28T16:00:00Z") },
      { actor: { userId: "g", role: "gm", level: 7, locations: [LOC] }, locationId: LOC },
      { SEVENSHIFTS_ACCESS_TOKEN: "test-token-not-real", SEVENSHIFTS_SYNC: "1" });
  } finally {
    if (prev.t === undefined) delete process.env.SEVENSHIFTS_ACCESS_TOKEN; else process.env.SEVENSHIFTS_ACCESS_TOKEN = prev.t;
    if (prev.s === undefined) delete process.env.SEVENSHIFTS_SYNC; else process.env.SEVENSHIFTS_SYNC = prev.s;
  }
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("loadReconciliation against the real schema", () => {
  it("captured a read of every table it needs", () => {
    const tables = new Set(captured.map((c) => c.table));
    for (const t of ["user_locations", "users", "toast_employee_links", "toast_time_entries", "schedule_weeks", "schedule_revision_shifts",
      "sevenshifts_location_links", "sevenshifts_user_links", "sevenshifts_user_assignments", "sevenshifts_users", "sevenshifts_shifts", "sevenshifts_time_punches"]) {
      expect(tables, t).toContain(t);
    }
  });

  it("every captured query executes against the real tables (limit 0); no RPC; never select *", async () => {
    expect(rpcs).toEqual([]);
    for (const c of captured) {
      expect(c.select.some((s) => s.includes("*")), c.table).toBe(false);
      const where = [...new Set(c.filters)].map((f) => `${f} is not distinct from ${f}`).join(" and ") || "true";
      const order = c.order.length ? ` order by ${c.order.join(", ")}` : "";
      const sql = `select ${c.select.join(", ")} from public.${c.table} where ${where}${order} limit 0`;
      await expect(db.query(sql), sql).resolves.toBeDefined();
    }
  });

  it("the Toast read takes the FIRST name only and no wage; the 7shifts user read never returns a full name to the page", () => {
    const punch = captured.find((c) => c.table === "toast_time_entries")!;
    expect(punch.select).toEqual(["employee_guid", "employee_first_name", "business_date", "in_at", "out_at", "hours"]);
    expect(captured.some((c) => c.table === "sevenshifts_wages")).toBe(false);
  });
});

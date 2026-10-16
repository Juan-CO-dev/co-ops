/**
 * Scheduling Phase 1, Task 16 Step 2 — every query the skills loaders build on a 0270 table names only
 * columns that EXIST (the in-memory fake accepts any column). And (r1 P2-6) the skill model's production
 * read IS the yield-stats read: same table, same columns, same filters (the window bound excepted).
 *
 *   1. the loaders run against a RECORDING client that captures each query (table, selected columns,
 *      filter columns, order columns); for the PM v2 loaders (Task 20) the client answers CANNED rows so
 *      the loaders walk past their first read and every query they build is captured;
 *   2. PGlite applies the scheduling stub + the REAL PM v1 tables (0072/0073) and 0267, then the REAL 0243,
 *      0268, 0269, 0270 and 0271 (with the real 0217 / 0228 / 0233 level helpers);
 *   3. every captured query on a 0270 or 0271 table (and the station reads the PM v2 lib makes) is EXECUTED
 *      there with `limit 0` — a misspelled column is a Postgres error here, not in prod.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Captured { table: string; select: string[]; filters: string[]; order: string[]; via: string }
const captured: Captured[] = [];
let via = "";

function recordingClient(canned: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    from(table: string) {
      const rec: Captured = { table, select: [], filters: [], order: [], via };
      captured.push(rec);
      const q: Record<string, unknown> = {};
      const col = (c: string) => { rec.filters.push(c.split(".")[0]!); return q; };
      Object.assign(q, {
        select: (cols: string) => { rec.select = cols.split(",").map((c) => c.trim()).filter(Boolean); return q; },
        eq: col, neq: col, is: col, in: col, gt: col, gte: col, lt: col, lte: col, not: col,
        or: (expr: string) => { for (const alt of expr.split(",")) rec.filters.push(alt.split(".")[0]!); return q; },
        order: (c: string) => { rec.order.push(c); return q; },
        range: () => q, limit: () => q,
        maybeSingle: async () => ({ data: canned[table]?.[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: canned[table] ?? [], error: null }).then(resolve),
      });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    update: () => ({}),
  } as unknown as SupabaseClient;
}

import { loadMySkills, loadSkillMatrix } from "@/lib/people/skills";
import { loadPeopleShopSettings } from "@/lib/people/settings";
import { loadBatches } from "@/lib/yield-stats";
import { loadDayResults, loadMyCopy, loadMyFeedbackV2 } from "@/lib/pm-report-v2";
import { loadCriteriaEditor } from "@/lib/pm-criteria";
import { applyPmV1Tables } from "../scripts/pm-v2-pglite-base.mjs";

const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
const owner = { userId: "6f1d2c3e-0000-4000-8000-0000000000c1", role: "owner" as const, level: 9, locations: [LOC] };
const PEOPLE_TABLES = new Set(["people_shop_settings", "people_skill_adjustments", "people_skill_ratings", "people_skill_tunables"]);
const PM_V2_TABLES = new Set(["pm_reports", "pm_report_copies", "pm_copy_grades", "pm_copy_notes", "pm_copy_positions", "pm_criteria", "station_events", "station_positions", "stations"]);
const PM_V2_VIA = new Set(["loadMyCopy", "loadDayResults", "loadMyFeedbackV2", "loadCriteriaEditor"]);
const PM_DAY = "6f1d2c3e-0000-4000-8000-0000000000d1";
const PM_COPY = "6f1d2c3e-0000-4000-8000-0000000000d2";
const SUBJECT = "6f1d2c3e-0000-4000-8000-0000000000e1";

const read = (p: string) => readFileSync(p, "utf8");
function extract(sql: string, start: string): string {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start}`);
  const j = sql.indexOf("end $$;", i);
  return sql.slice(i, j + "end $$;".length);
}

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("tests/fixtures/scheduling-pglite-stub.sql"));
  await applyPmV1Tables(db);
  await db.exec(read("supabase/migrations/0267_pm_evals_privacy.sql"));
  await db.exec([
    extract(read("supabase/migrations/0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
    extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
    extract(read("supabase/migrations/0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
  ].join("\n"));
  for (const m of ["0243_cron_route_leases", "0268_sevenshifts_sync", "0269_sevenshifts_links", "0270_people_layer", "0271_pm_reports_v2"]) {
    await db.exec(read(`supabase/migrations/${m}.sql`));
  }
  const svc = recordingClient();
  const run = async (name: string, fn: () => Promise<unknown>) => { via = name; try { await fn(); } catch { /* refusals after the read are fine */ } };
  await run("loadSkillMatrix", () => loadSkillMatrix(svc, { actor: owner, locationId: LOC }));
  await run("loadMySkills", () => loadMySkills(svc, { actor: owner, locationId: LOC }));
  await run("loadPeopleShopSettings", () => loadPeopleShopSettings(svc, LOC));
  await run("loadBatches", () => loadBatches(svc as never, LOC, null, new Date("2026-10-15T20:00:00Z")));
  // PM v2 (Task 20): canned rows walk each loader past its first read.
  const day = (status: string) => ({ id: PM_DAY, location_id: LOC, report_date: "2026-10-15", status, format: "v2", submitted_by: null, submitted_at: null, mvp_user_id: null });
  const copy = (status: string) => ({ id: PM_COPY, pm_report_id: PM_DAY, location_id: LOC, author_id: owner.userId, status, observed_from: "2026-10-15T20:00:00Z", observed_to: null, created_at: "2026-10-15T20:00:00Z", sealed_at: null });
  const grade = { id: "g1", copy_id: PM_COPY, location_id: LOC, subject_id: SUBJECT, position_id: null, criterion_id: "c1", grade: "good" };
  const openSvc = recordingClient({ pm_reports: [day("open")], pm_report_copies: [copy("open")] });
  await run("loadMyCopy", () => loadMyCopy(openSvc, { actor: owner, locationId: LOC, date: "2026-10-15", presenceRoster: [{ id: SUBJECT, name: "Eli" }] }));
  const doneSvc = recordingClient({ pm_reports: [day("submitted")], pm_report_copies: [copy("sealed")], pm_copy_grades: [grade] });
  await run("loadDayResults", () => loadDayResults(doneSvc, { actor: owner, locationId: LOC, date: "2026-10-15" }));
  await run("loadMyFeedbackV2", () => loadMyFeedbackV2(doneSvc, { userId: SUBJECT }));
  await run("loadCriteriaEditor", () => loadCriteriaEditor(openSvc, { actor: owner, locationId: LOC }));
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("the skills loaders against the real 0270 schema", () => {
  it("captured a read of every 0270 table", () => {
    const tables = new Set(captured.map((c) => c.table));
    for (const t of PEOPLE_TABLES) expect(tables, t).toContain(t);
  });

  it("every captured query on a 0270 table executes against the real schema", async () => {
    const people = captured.filter((c) => PEOPLE_TABLES.has(c.table));
    expect(people.length).toBeGreaterThanOrEqual(5);
    for (const c of people) {
      const where = [...new Set(c.filters)].map((f) => `${f} is not distinct from ${f}`).join(" and ") || "true";
      const order = c.order.length ? ` order by ${c.order.join(", ")}` : "";
      const sql = `select ${c.select.join(", ")} from public.${c.table} where ${where}${order} limit 0`;
      await expect(db.query(sql), `${c.via}: ${sql}`).resolves.toBeDefined();
    }
  });

  it("Task 20: every PM v2 loader query (0271 tables, station reads) executes against the real 0271 schema", async () => {
    const pm = captured.filter((c) => PM_V2_VIA.has(c.via) && PM_V2_TABLES.has(c.table));
    for (const t of ["pm_reports", "pm_report_copies", "pm_copy_grades", "pm_copy_notes", "pm_copy_positions", "pm_criteria", "station_events"]) {
      expect(pm.map((c) => c.table), t).toContain(t);
    }
    for (const via of PM_V2_VIA) expect(pm.some((c) => c.via === via), via).toBe(true);
    for (const c of pm) {
      const where = [...new Set(c.filters)].map((f) => `${f} is not distinct from ${f}`).join(" and ") || "true";
      const order = c.order.length ? ` order by ${c.order.join(", ")}` : "";
      const sql = `select ${c.select.join(", ")} from public.${c.table} where ${where}${order} limit 0`;
      await expect(db.query(sql), `${c.via}: ${sql}`).resolves.toBeDefined();
    }
    // The criteria editor's UPDATE (rename / deactivate / move) names these columns (Task 22).
    await expect(db.query("update public.pm_criteria set label = label, label_es = label_es, sort = sort, active = active, updated_by = updated_by, updated_at = updated_at where false"))
      .resolves.toBeDefined();
  });

  it("(r1 P2-6) the production read IS loadBatches' read: same table, columns and filters, the window bound excepted", () => {
    const mine = captured.find((c) => c.via === "loadSkillMatrix" && c.table === "productions")!;
    const theirs = captured.find((c) => c.via === "loadBatches" && c.table === "productions")!;
    expect(mine.select).toEqual(theirs.select);
    const bound = (fs: string[]) => [...new Set(fs.filter((f) => f !== "produced_at"))].sort();
    expect(bound(mine.filters)).toEqual(bound(theirs.filters));
    expect(bound(mine.filters)).toEqual(["batches_made", "came_out_to", "location_id", "revoked_at", "superseded_at", "yield_at_time"]);
    expect(captured.some((c) => c.table === "prep_batch_sessions")).toBe(false);
  });
});

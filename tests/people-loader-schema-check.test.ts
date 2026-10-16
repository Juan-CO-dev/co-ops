/**
 * Scheduling Phase 1, Task 16 Step 2 — every query the skills loaders build on a 0270 table names only
 * columns that EXIST (the in-memory fake accepts any column). And (r1 P2-6) the skill model's production
 * read IS the yield-stats read: same table, same columns, same filters (the window bound excepted).
 *
 *   1. the loaders run against a RECORDING client that captures each query (table, selected columns,
 *      filter columns, order columns);
 *   2. PGlite applies the scheduling stub + the REAL 0243, 0268, 0269 and 0270 (with the real 0217 / 0228 /
 *      0233 level helpers);
 *   3. every captured query on a 0270 table is EXECUTED there with `limit 0` — a misspelled column is a
 *      Postgres error here, not in prod.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Captured { table: string; select: string[]; filters: string[]; order: string[]; via: string }
const captured: Captured[] = [];
let via = "";

function recordingClient() {
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
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient;
}

import { loadMySkills, loadSkillMatrix } from "@/lib/people/skills";
import { loadPeopleShopSettings } from "@/lib/people/settings";
import { loadBatches } from "@/lib/yield-stats";

const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
const owner = { userId: "6f1d2c3e-0000-4000-8000-0000000000c1", role: "owner" as const, level: 9, locations: [LOC] };
const PEOPLE_TABLES = new Set(["people_shop_settings", "people_skill_adjustments", "people_skill_ratings", "people_skill_tunables"]);

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
  await db.exec([
    extract(read("supabase/migrations/0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
    extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
    extract(read("supabase/migrations/0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
  ].join("\n"));
  for (const m of ["0243_cron_route_leases", "0268_sevenshifts_sync", "0269_sevenshifts_links", "0270_people_layer"]) {
    await db.exec(read(`supabase/migrations/${m}.sql`));
  }
  const svc = recordingClient();
  const run = async (name: string, fn: () => Promise<unknown>) => { via = name; try { await fn(); } catch { /* refusals after the read are fine */ } };
  await run("loadSkillMatrix", () => loadSkillMatrix(svc, { actor: owner, locationId: LOC }));
  await run("loadMySkills", () => loadMySkills(svc, { actor: owner, locationId: LOC }));
  await run("loadPeopleShopSettings", () => loadPeopleShopSettings(svc, LOC));
  await run("loadBatches", () => loadBatches(svc as never, LOC, null, new Date("2026-10-15T20:00:00Z")));
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

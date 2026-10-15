/**
 * Catalog Phase 3a — every loader that reads a 0262 / 0263 table names only columns that EXIST in the real schema
 * (the 2a lesson: the in-memory fake DB accepts any column). The loaders run against a RECORDING client that
 * captures each query (table, selected / filtered / ordered columns, paged or not) and answers the version read with
 * one canned shop version, so the line read behind it is reached too; then every captured query on a 0262/0263 table
 * is EXECUTED in PGlite over the REAL 0258 → 0263 (tests/fixtures/recipe-versions-pglite.ts) with `limit 0`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

interface Captured { table: string; select: string[]; filters: string[]; order: string[]; ranged: boolean; via: string }
const captured: Captured[] = [];
let via = "";
const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
/** One live SHOP version (not the live global head), so the overlay goes on to read its lines. */
const CANNED: Record<string, unknown[]> = {
  recipe_versions: [{ id: "6f1d2c3e-0000-4000-8000-0000000000c1", recipe_id: "6f1d2c3e-0000-4000-8000-0000000000d1", location_id: LOC,
    valid_from: "2026-10-01T00:00:00.000Z", valid_to: null, active: true }],
};

function recordingClient() {
  return {
    from(table: string) {
      const rec: Captured = { table, select: [], filters: [], order: [], ranged: false, via };
      captured.push(rec);
      const q: Record<string, unknown> = {};
      const col = (c: string) => { rec.filters.push(c.split(".")[0]!); return q; };
      Object.assign(q, {
        select: (cols: string) => {
          rec.select = cols.split(",").map((c) => c.trim()).filter((c) => c !== "" && !c.includes("(") && !c.includes("!"));
          return q;
        },
        eq: (c: string) => col(c), neq: (c: string) => col(c), is: (c: string) => col(c), in: (c: string) => col(c),
        gt: (c: string) => col(c), gte: (c: string) => col(c), lt: (c: string) => col(c), lte: (c: string) => col(c),
        not: (c: string) => col(c),
        or: (expr: string) => { for (const alt of expr.split(",")) rec.filters.push(alt.split(".")[0]!); return q; },
        order: (c: string) => { rec.order.push(c); return q; },
        range: () => { rec.ranged = true; return q; },
        limit: () => q, returns: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: CANNED[table] ?? [], error: null, count: 0 }).then(resolve),
      });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => recordingClient() }));

import { createDatedGraphs, loadRecipeBoundaries, loadRecipeGraph, loadRecipeInputsAcrossScopes, loadRecipeLineOverlay, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import { loadLiveMenuItemShopSettings } from "@/lib/menu-item-shop";
import { migratedRecipeDb } from "./fixtures/recipe-versions-pglite";

/** The 0262 / 0263 tables, defined fully by the real migrations in PGlite. */
const FULLY_DEFINED = new Set(["recipe_versions", "recipe_version_lines", "recipe_notice_dismissals", "menu_item_shop_settings"]);

let db: PGlite;
beforeAll(async () => {
  db = await migratedRecipeDb();
  const run = async (name: string, fn: () => Promise<unknown>) => { via = name; try { await fn(); } catch { /* failures after the read are fine */ } };
  await run("loadRecipeLineOverlay(shop, live)", () => loadRecipeLineOverlay(LOC, null));
  await run("loadRecipeLineOverlay(global, asOf)", () => loadRecipeLineOverlay(null, "2026-10-15T03:59:59.999Z"));
  await run("loadRecipeLineOverlay(shop, asOf)", () => loadRecipeLineOverlay(LOC, "2026-10-15T03:59:59.999Z"));
  await run("loadRecipeBoundaries(global)", () => loadRecipeBoundaries(null));
  await run("loadRecipeBoundaries(shop)", () => loadRecipeBoundaries(LOC));
  await run("loadRecipeGraph(shop)", () => loadRecipeGraph({ locationId: LOC }));
  await run("createDatedGraphs(shop)", () => createDatedGraphs({ locationId: LOC })("2026-09-01"));
  // Task 6b: the line resolvers every direct reader now goes through.
  await run("loadResolvedRecipeInputs(shop)", () => loadResolvedRecipeInputs(LOC));
  await run("loadRecipeInputsAcrossScopes", () => loadRecipeInputsAcrossScopes());
  // 0263: the menu overlay loader (the costing board's shop view, the Toast matcher pool).
  await run("loadLiveMenuItemShopSettings", () => loadLiveMenuItemShopSettings(LOC));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("every query a loader builds on a 0262 / 0263 table runs against the REAL schema", () => {
  it("captured the reads, including the version-line read behind a shop version (the check is not vacuous)", () => {
    const tables = new Set(captured.map((c) => c.table));
    expect(tables).toContain("recipe_versions");
    expect(tables).toContain("recipe_version_lines");
    expect(tables).toContain("menu_item_shop_settings");
  });

  it("each executes in Postgres: every selected, filtered and ordered column exists", async () => {
    const failures: string[] = [];
    for (const c of captured.filter((x) => FULLY_DEFINED.has(x.table))) {
      const sql = `select ${c.select.length > 0 ? c.select.join(", ") : "1"} from public.${c.table}`
        + (c.filters.length > 0 ? ` where ${[...new Set(c.filters)].map((f) => `${f} is not distinct from ${f}`).join(" and ")}` : "")
        + (c.order.length > 0 ? ` order by ${c.order.join(", ")}` : "") + " limit 0";
      try { await db.query(sql); } catch (e) { failures.push(`${c.via} → ${c.table}: ${(e as Error).message}`); }
    }
    expect(failures).toEqual([]);
  });

  it("every PAGED read is ordered (a page boundary without a total order reshuffles rows)", () => {
    const unordered = captured.filter((c) => FULLY_DEFINED.has(c.table) && c.ranged && c.order.length === 0).map((c) => `${c.via} → ${c.table}`);
    expect(unordered).toEqual([]);
    expect(captured.filter((c) => FULLY_DEFINED.has(c.table)).every((c) => c.ranged)).toBe(true);
  });
});

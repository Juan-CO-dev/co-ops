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
const upserts: Array<{ table: string; columns: string[]; onConflict: string | null; via: string }> = [];
let via = "";
const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
/** One live SHOP version (not the live global head), so the overlay goes on to read its lines. */
const CANNED: Record<string, unknown[]> = {
  recipe_versions: [{ id: "6f1d2c3e-0000-4000-8000-0000000000c1", recipe_id: "6f1d2c3e-0000-4000-8000-0000000000d1", location_id: LOC,
    valid_from: "2026-10-01T00:00:00.000Z", valid_to: null, active: true }],
  recipes: [{ id: "6f1d2c3e-0000-4000-8000-0000000000d1", name: "Slaw", active: true }],
  // 3b: the page views check the shop is an active one before reading on.
  locations: [{ id: LOC, name: "Shop one", active: true }],
  menu_items: [{ id: "6f1d2c3e-0000-4000-8000-0000000000d1", name: "Italian", name_es: null, menu_price: 12.5, section: null, active: true }],
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
        // Catalog Phase 3b: an UPSERT's written columns and its conflict target are checked like a read's columns
        // (the notice answer writes recipe_notice_dismissals); `upserts` keeps them for the ON CONFLICT check.
        upsert: (rows: Array<Record<string, unknown>>, opts: { onConflict?: string } = {}) => {
          rec.select = Object.keys(rows[0] ?? {});
          rec.filters.push(...(opts.onConflict ?? "").split(",").filter((c) => c !== ""));
          upserts.push({ table, columns: rec.select, onConflict: opts.onConflict ?? null, via });
          return q;
        },
        maybeSingle: async () => ({ data: (CANNED[table] ?? [])[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: CANNED[table] ?? [], error: null, count: 0 }).then(resolve),
      });
      return q;
    },
    // A snapshot function answers an (empty) snapshot so a 3b preview goes on past it to the reads behind it.
    rpc: async (fn: string) => ({ data: fn.endsWith("_snapshot") ? {} : null, error: null }),
  };
}
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => recordingClient() }));

import { createDatedGraphs, loadRecipeBoundaries, loadRecipeGraph, loadRecipeInputsAcrossScopes, loadRecipeLineOverlay, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import { loadLiveMenuItemShopSettings } from "@/lib/menu-item-shop";
import { loadSkuDataReadiness } from "@/lib/sku-data-readiness-load";
import { loadMenuItemShopHistory, promoteMenuItemShopSetting, retireMenuItemShopSetting } from "@/lib/admin/menu-item-shop";
import {
  adoptRecipeVersion, dismissRecipeNotice, loadRecipeLiveSet, loadRecipeVersionHistory, promoteRecipeVersion, restoreRecipeVersion,
  retireShopRecipeVersion,
} from "@/lib/admin/recipe-versions";
import { computeRecipePreview, loadRecipeItemView } from "@/lib/catalog/recipe-item";
import { computeMenuPreview, loadMenuItemPageView } from "@/lib/catalog/menu-item-page";
import { loadShopChanges, loadShopNotices } from "@/lib/catalog/shop-changes";
import type { AuthContext } from "@/lib/session";
import { migratedRecipeDb } from "./fixtures/recipe-versions-pglite";

const OWNER = { user: { id: "u", role: "owner" }, role: "owner", level: 9, locations: [LOC] } as unknown as AuthContext;
const RECIPE = "6f1d2c3e-0000-4000-8000-0000000000d1";
const OTHER = "6f1d2c3e-0000-4000-8000-0000000000a2";
const SOURCE = "6f1d2c3e-0000-4000-8000-0000000000c1";

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
  // Task 7: the gated recipe writers' own reads.
  await run("loadRecipeLiveSet(shop)", () => loadRecipeLiveSet(RECIPE, LOC));
  await run("loadRecipeLiveSet(global)", () => loadRecipeLiveSet(RECIPE, null));
  await run("loadRecipeVersionHistory", () => loadRecipeVersionHistory(OWNER, RECIPE, LOC));
  await run("restoreRecipeVersion", () => restoreRecipeVersion(OWNER, { recipeId: RECIPE, scope: LOC, fromVersionId: RECIPE, expectedVersionId: null, basedOnVersionId: null }));
  await run("retireShopRecipeVersion", () => retireShopRecipeVersion(OWNER, { recipeId: RECIPE, versionId: RECIPE, locationId: LOC }));
  // 0263: the menu overlay loader (the costing board's shop view, the Toast matcher pool).
  await run("loadLiveMenuItemShopSettings", () => loadLiveMenuItemShopSettings(LOC));
  // Chunk-2 review P2: the /admin/skus per-shop data panel reads the live shop recipe versions and their lines.
  await run("loadSkuDataReadiness", () => loadSkuDataReadiness(OWNER));
  // Task 8: the menu-overlay writers' own reads.
  await run("loadMenuItemShopHistory", () => loadMenuItemShopHistory(OWNER, RECIPE, LOC));
  await run("retireMenuItemShopSetting", () => retireMenuItemShopSetting(OWNER, { menuItemId: RECIPE, locationId: LOC, settingId: RECIPE }));
  // Catalog Phase 3b (Task 4): adopt / promote / the notice answer / the menu promote — their own reads and the
  // writer's reads behind them (the canned version is LOC's live one, so OTHER adopts it and a MoO promotes it).
  await run("adoptRecipeVersion", () => adoptRecipeVersion(OWNER, { recipeId: RECIPE, locationId: OTHER, sourceVersionId: SOURCE, expectedVersionId: null, snapshot: {} }));
  await run("promoteRecipeVersion", () => promoteRecipeVersion(OWNER, { recipeId: RECIPE, sourceVersionId: SOURCE, expectedGlobalVersionId: null, snapshot: {} }));
  await run("dismissRecipeNotice", () => dismissRecipeNotice(OWNER, { locationId: LOC, recipeId: RECIPE, kind: "new_default", seenVersionId: SOURCE }));
  await run("promoteMenuItemShopSetting", () => promoteMenuItemShopSetting(OWNER, { menuItemId: RECIPE, settingId: RECIPE, fields: ["price"], expected: { price: 1, name: "x", nameEs: null }, snapshot: {} }));
  // Catalog Phase 3b (Task 5): the page views, the previews, the Shop changes list and the notices read.
  await run("loadRecipeItemView", () => loadRecipeItemView(OWNER, RECIPE, LOC));
  await run("computeRecipePreview(restore)", () => computeRecipePreview(OWNER, RECIPE, { kind: "restore", target: { kind: "shop", shopId: LOC }, fromVersionId: SOURCE }));
  await run("computeRecipePreview(promote)", () => computeRecipePreview(OWNER, RECIPE, { kind: "promote", sourceVersionId: SOURCE }));
  await run("loadMenuItemPageView", () => loadMenuItemPageView(OWNER, RECIPE, LOC));
  await run("computeMenuPreview(save)", () => computeMenuPreview(OWNER, RECIPE, { kind: "save", shopId: LOC, patch: { price: 1, soldHere: true, nameOverride: null, nameOverrideEs: null } }));
  await run("computeMenuPreview(promote)", () => computeMenuPreview(OWNER, RECIPE, { kind: "promote", settingId: RECIPE, fields: ["price"] }));
  await run("loadShopChanges", () => loadShopChanges(OWNER));
  await run("loadShopNotices", () => loadShopNotices(OWNER, LOC));
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
    // Unpaged reads only where a unique key bounds the result: one recipe's LIVE versions (≤ 2: the one-live index per
    // scope) and a single version by id (the restore / retire source). Every other read on these tables pages.
    const BOUNDED = new Set(["loadRecipeLiveSet(shop)", "loadRecipeLiveSet(global)", "restoreRecipeVersion", "retireShopRecipeVersion", "retireMenuItemShopSetting",
      // 3b Task 4: a single source / seen version or setting by id, plus the writer's one-recipe live read.
      "adoptRecipeVersion", "promoteRecipeVersion", "dismissRecipeNotice", "promoteMenuItemShopSetting",
      // 3b Task 5: loadRecipeLiveSet (≤ 2 live rows) and single versions / settings by id inside the views and previews.
      "loadRecipeItemView", "computeRecipePreview(restore)", "computeRecipePreview(promote)", "loadMenuItemPageView",
      "computeMenuPreview(save)", "computeMenuPreview(promote)"]);
    const unpaged = captured.filter((c) => FULLY_DEFINED.has(c.table) && !c.ranged && !((c.table === "recipe_versions" || c.table === "menu_item_shop_settings") && BOUNDED.has(c.via)))
      .filter((c) => !upserts.some((u) => u.table === c.table && u.via === c.via)) // a write is not a page
      .map((c) => `${c.via} → ${c.table}`);
    expect(unpaged).toEqual([]);
  });

  it("the recipe page's line-lineage read (Astra chunks 3-4 P2 #1) was reached, paged, and runs on the real columns above", () => {
    const lineage = captured.filter((c) => c.via === "loadRecipeItemView" && c.table === "recipe_version_lines" && c.select.includes("source_line_id"));
    expect(lineage.length).toBeGreaterThan(0);
    expect(lineage.every((c) => c.ranged && c.order.length > 0)).toBe(true);
  });

  it("3b Task 4 reached every new read, and the source read of each act", () => {
    for (const v of ["adoptRecipeVersion", "promoteRecipeVersion", "dismissRecipeNotice"]) {
      expect(captured.some((c) => c.via === v && c.table === "recipe_versions"), v).toBe(true);
    }
    // adopt and promote go on into the one writer: the copied version's lines are read too
    expect(captured.some((c) => c.via === "adoptRecipeVersion" && c.table === "recipe_version_lines")).toBe(true);
    expect(captured.some((c) => c.via === "promoteMenuItemShopSetting" && c.table === "menu_item_shop_settings")).toBe(true);
  });

  it("3b Task 5 reached every new read: the views, the previews, the Shop changes list and the notices", () => {
    const reached = (v: string, t: string) => captured.some((c) => c.via === v && c.table === t);
    expect(reached("loadRecipeItemView", "recipe_versions"), "loadRecipeItemView → recipe_versions").toBe(true);
    expect(reached("computeRecipePreview(restore)", "recipe_version_lines"), "computeRecipePreview(restore) → recipe_version_lines").toBe(true);
    expect(reached("computeRecipePreview(promote)", "recipe_versions"), "computeRecipePreview(promote) → recipe_versions").toBe(true);
    expect(reached("computeMenuPreview(promote)", "menu_item_shop_settings"), "computeMenuPreview(promote) → menu_item_shop_settings").toBe(true);
    expect(reached("loadShopChanges", "recipe_version_lines"), "loadShopChanges → recipe_version_lines").toBe(true);
    expect(reached("loadShopChanges", "menu_item_shop_settings"), "loadShopChanges → menu_item_shop_settings").toBe(true);
    expect(reached("loadShopNotices", "recipe_notice_dismissals"), "loadShopNotices → recipe_notice_dismissals").toBe(true);
    expect(reached("loadShopNotices", "recipe_versions"), "loadShopNotices → recipe_versions").toBe(true);
  });

  it("the notice answer's UPSERT names real columns and a conflict target 0262 has a unique index for", async () => {
    const u = upserts.find((x) => x.via === "dismissRecipeNotice");
    expect(u).toMatchObject({ table: "recipe_notice_dismissals", onConflict: "location_id,recipe_id,kind,seen_version_id" });
    const placeholders = u!.columns.map((_, i) => `$${i + 1}`).join(", ");
    const values = u!.columns.map((c) => (c === "kind" ? "new_default" : SOURCE));
    // EXPLAIN plans the insert without running it: a missing column or an ON CONFLICT target with no matching
    // unique index is an error here, exactly as it would be in Postgres.
    await db.query(`explain insert into public.recipe_notice_dismissals (${u!.columns.join(", ")}) values (${placeholders})
      on conflict (${u!.onConflict}) do nothing`, values);
  });
});

import { readFileSync } from "node:fs";
import { afterAll, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { migratedShopOwnedDb, persistedCatalogRows, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
let db: PGlite;
let snapshot: ReturnType<typeof createFakeDb>;
const actor = { user: { id: ID.actor, role: "gm", language: "en" }, level: 7, locations: [ID.shopA] } as unknown as AuthContext;
vi.mock("@/lib/session", () => ({ requireSession: async () => actor }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: () => ({ ok: true }) }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
// Transport only: every RPC executes the real migration; every read projects
// persisted SQL rows using the existing predicate-aware PostgREST fake.
const client = {
  from: (table: string) => snapshot.client.from(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (!/^[a-z_]+$/.test(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error("invalid test RPC identifier");
    try {
      const keys = Object.keys(args);
      const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) result`,
        keys.map(key => typeof args[key] === "object" && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
      snapshot = createFakeDb(await persistedCatalogRows(db));
      return { data: result.rows[0]?.result, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } };
    }
  },
};
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => client }));
import { POST } from "@/app/api/admin/recipes/full/route";
import { addRecipeInput, updateRecipeInput, removeRecipeEdge, updateRecipe, updateRecipeOutputYield } from "@/lib/recipes";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { rollupItemCost } from "@/lib/menu-costing-shared";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
afterAll(async () => { await db?.close(); });
it("creates inline prep through HTTP and real SQL, then edits and costs its owned default", async () => {
  db = await migratedShopOwnedDb();
  await db.exec("alter table recipes add column updated_at timestamptz not null default now(), add column updated_by uuid references users(id)");
  for (const [file, name] of [["0215_batch_vs_bottle", "update_recipe_atomic"], ["0218_yield_retrain_notes", "update_recipe_output_yield"]]) {
    const sql = readFileSync(`supabase/migrations/${file}.sql`, "utf8");
    const start = sql.indexOf(`create or replace function public.${name}(`);
    await db.exec(sql.slice(start, sql.indexOf("end $$;", start) + 7));
  }
  const globalPack = (await db.query<{ result: { version_id: string } }>("select save_sku_pack_version($1,null,$2::jsonb,null,null,null,$3,false) result",
    [ID.sharedSku, JSON.stringify([{ label: "case", containsQty: 16, containsMeasureUnit: "oz" }]), ID.actor])).rows[0]!.result.version_id;
  await db.query("select save_sku_pack_version($1,$2,$3::jsonb,null,$4,null,$5,false)", [ID.sharedSku, ID.shopA,
    JSON.stringify([{ label: "case", containsQty: 32, containsMeasureUnit: "oz" }]), globalPack, ID.actor]);
  await db.query("select save_sku_global_price($1,8,'2020-01-01',$2,false)", [ID.sharedSku, ID.actor]);
  await db.query("select save_sku_shop_price($1,$2,24,'2020-01-01',$3,'manual',null)", [ID.sharedSku, ID.shopA, ID.actor]);
  snapshot = createFakeDb(await persistedCatalogRows(db));
  const response = await POST(new NextRequest("http://localhost/api/admin/recipes/full", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    locationId: ID.shopA, name: "Owned preparation", recipeType: "production", batchYield: 1, batchMode: true,
    inputs: [{ componentSkuId: ID.sharedSku, quantity: 2, unit: "oz" }],
    outputs: [{ newItem: { name: "New owned output", nameEs: "Preparado", section: "prep", recommendedPar: null, recommendedParUnit: null }, yield: 1 }],
  }) }));
  expect(response.status).toBe(201);
  const result = await response.json() as { id: string; outputItemIds: string[] };
  expect(result.outputItemIds).toHaveLength(1);
  const item = result.outputItemIds[0]!;
  expect((await db.query("select location_id, is_default from items where id=$1", [item])).rows).toEqual([{ location_id: ID.shopA, is_default: false }]);
  await updateRecipe(actor, result.id, { name: "Edited owned preparation" });
  const added = await addRecipeInput(actor, { recipeId: result.id, componentSkuId: ID.sharedSku, quantity: 1, unit: "oz" });
  const line = { componentSkuId: ID.sharedSku, componentItemId: null, componentProductId: null, quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false };
  await updateRecipeInput(actor, { recipeId: result.id, inputId: added.id, line: { ...line, quantity: 3 }, expected: line });
  await removeRecipeEdge(actor, { table: "recipe_inputs", id: added.id });
  await updateRecipeOutputYield(actor, { recipeId: result.id, outputItemId: item, yield: 2,
    context: { locationId: ID.shopA, source: "yield_nudge", observedSignedDrift: .2, batchesInWindow: 6 } });
  const graph = await loadRecipeGraph({ locationId: ID.shopA });
  const prices = await loadCurrentSkuPrices([ID.sharedSku], ID.shopA);
  expect(rollupItemCost(graph, item, costPerOzFromGraph(graph, prices)).cost).toBe(.75);
  const readiness = await loadGraphReadiness(actor, ID.shopA);
  expect(readiness.recipeReadiness.get(result.id)).toEqual({ status: "upstream_gaps", reasons: [{ code: "not_ready_skus", count: 1 }] });
  expect(readiness.recipeReadiness.get(result.id)!.reasons.map(reason => reason.code)).not.toContain("no_inputs");
  expect((await loadGraphReadiness(actor, ID.shopB)).recipeReadiness.has(result.id)).toBe(false);
}, 120_000);

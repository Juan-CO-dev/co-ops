import { afterEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { applyShopOwnership, migratedShopOwnedDb, SHOP_OWNED_ID as ID, seedOperationalBaseline, persistedCatalogRows } from "./fixtures/shop-owned-pglite";
import { computeOutputs, liveApi } from "./fixtures/shop-versions-harness";
import { loadCountReferenceData, loadCountsTileState } from "@/lib/counts";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { resolvePerSkuAnchors } from "@/lib/counts-shared";

let current: ReturnType<typeof createFakeDb>;
let db: PGlite | undefined;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
afterEach(async () => { await db?.close(); db = undefined; });

it("real 0264 preserves persisted costing/depletion/ordering/count outputs byte for byte", async () => {
  db = await migratedShopOwnedDb(false);
  await seedOperationalBaseline(db);
  const capture = async () => {
    const rows = await persistedCatalogRows(db!);
    current = createFakeDb(rows);
    const resolved = await computeOutputs(liveApi, rows, [ID.shopA, ID.shopB], "2099-01-02");
    const counts = await Promise.all([ID.shopA, ID.shopB].map(async shop => ({
      catalog: await loadCountReferenceData(OWNER_ACTOR, shop),
      state: await loadCountsTileState(OWNER_ACTOR, shop),
      // The same production census composition used by loadOnHand, fed only
      // persisted event/line rows. No handwritten expected anchors enter it.
      anchors: [...resolvePerSkuAnchors((rows.sku_count_lines ?? []).flatMap(line => {
        const event = rows.sku_count_events!.find(e => e.id === line.count_event_id && e.location_id === shop && e.active);
        return event ? [{ countEventId: String(event.id), eventCountedAt: String(event.counted_at),
          skuId: String(line.sku_id), resolvedOz: Number(line.resolved_oz), isLoose: Boolean(line.is_loose),
          partialFraction: line.partial_fraction == null ? null : Number(line.partial_fraction) }] : [];
      }))],
    })));
    return { resolved, counts };
  };
  const before = await capture();
  expect(before.resolved.global!.orderUnitOz[ID.sharedSku]).toBe(16);
  expect(before.resolved[ID.shopA]!.orderUnitOz[ID.sharedSku]).toBe(32);
  expect(before.resolved.global!.prices[ID.sharedSku]).toBe(8);
  expect(before.resolved[ID.shopA]!.prices[ID.sharedSku]).toBe(24);
  expect(before.resolved.global!.graph.menuOz[ID.sharedMenu]![ID.sharedSku]).toBe(4);
  expect(before.resolved[ID.shopA]!.graph.menuOz[ID.sharedMenu]![ID.sharedSku]).toBe(6);
  expect(before.counts.map(c => c.state.anchoredSkuCount)).toEqual([1, 1]);
  expect(before.counts[0]!.anchors[0]![1].anchorOz).toBe(32);
  await applyShopOwnership(db);
  // Pin table + name, not just a positive count: every installation surface is
  // required, and a disabled or missing trigger must fail this persisted-row gate.
  const triggers = (await db.query<{ table_name: string; trigger_name: string }>(`
    select c.relname as table_name, t.tgname as trigger_name
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and t.tgname like 'shop_owned%' and t.tgenabled <> 'D'
  `)).rows.map(row => `${row.table_name}.${row.trigger_name}`).sort();
  const graphTables = ["recipes", "recipe_inputs", "recipe_outputs", "recipe_versions",
    "recipe_version_lines", "items", "vendor_items", "menu_items", "menu_item_shop_settings",
    "toast_menu_map", "toast_map_effects", "toast_open_item_aliases"];
  const expectedTriggers = [
    ...graphTables.flatMap(table => [`${table}.shop_owned_lock`, `${table}.shop_owned_integrity`]),
    ...["recipes", "menu_items", "items", "vendor_items"].map(table => `${table}.shop_owned_owner_guard`),
  ].sort();
  expect(triggers).toHaveLength(28);
  expect(triggers).toEqual(expectedTriggers);
  expect(JSON.stringify(await capture())).toBe(JSON.stringify(before));
}, 120_000);

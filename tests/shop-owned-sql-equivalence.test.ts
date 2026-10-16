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
  expect((await db.query<{ n: number }>("select count(*)::int n from pg_trigger where tgname like 'shop_owned%' and tgenabled <> 'D'")).rows[0]!.n).toBeGreaterThan(0);
  expect(JSON.stringify(await capture())).toBe(JSON.stringify(before));
}, 120_000);

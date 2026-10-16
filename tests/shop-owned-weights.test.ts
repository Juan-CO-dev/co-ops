import { expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, OWNED } from "./fixtures/shop-owned-fixture";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { loadWeightBoard } from "@/lib/weights";

let current: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));

it("the global weight audit costs owned prep items through their owner's graph", async () => {
  const tables = buildShopOwnedFixture();
  tables.audit_log = [];
  tables.sku_count_lines = [];
  tables.vendor_delivery_items = [];
  current = createFakeDb(tables);
  const board = await loadWeightBoard(OWNER_ACTOR);
  for (const own of OWNED) {
    const row = board.rows.find(r => r.belief.subjectId === own.item);
    expect(row).toBeDefined();
    expect(row!.belief.costPerOz).toBe(0.25);
  }
});

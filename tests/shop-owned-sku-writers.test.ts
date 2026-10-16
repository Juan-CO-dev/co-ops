import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
let current: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { createSku, updateSku, deactivateSku } from "@/lib/admin/skus";
import { setSkuPriceBasis } from "@/lib/catalog/sku-item";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const gm = { user: { id: "gm", role: "gm" }, role: "gm", level: 7, locations: [A] } as AuthContext;
const owner = { user: { id: "owner", role: "owner" }, role: "owner", level: 9, locations: [] } as unknown as AuthContext;
let tables: Tables;
beforeEach(() => {
  tables = { vendor_items: [{ id: "sku", name: "Before", active: true, location_id: A, price_basis: "per_case", pack_format: "case" }], locations: [A, B].map(id => ({ id, active: true })), vendors: [], sku_pack_versions: [] };
  current = createFakeDb(tables);
});

it.each([undefined, A])("GM creation binds scope %s to the authorized shop", async locationId => {
  await createSku(gm, { name: "New", packFormat: "case", locationId });
  expect(tables.vendor_items!.at(-1)).toMatchObject({ name: "New", location_id: A });
});
it.each([[null, "global_requires_moo"], [B, "not_found"]] as const)("GM creation refuses %s", async (locationId, code) => {
  await expect(createSku(gm, { name: "New", packFormat: "case", locationId })).rejects.toMatchObject({ code });
  expect(current.writes).toEqual([]);
});
it("multi-shop omission requires a choice; MoO+ may explicitly create globally", async () => {
  await expect(createSku({ ...gm, locations: [A, B] }, { name: "New", packFormat: "case" })).rejects.toMatchObject({ code: "location_required" });
  await createSku(owner, { name: "New", packFormat: "case", locationId: null });
  expect(tables.vendor_items!.at(-1)!.location_id).toBeNull();
});
it("a GM cannot move an owned SKU even between its memberships", async () => {
  await expect(updateSku({ ...gm, locations: [A, B] }, { id: "sku", changes: { locationId: B } })).rejects.toMatchObject({ code: "global_requires_moo" });
  expect(current.writes).toEqual([]);
});
it("owning GM can edit its own pack identity and existing price basis", async () => {
  await updateSku(gm, { id: "sku", changes: { packFormat: "box" } });
  await setSkuPriceBasis(gm, "sku", "per_each");
  expect(tables.vendor_items![0]).toMatchObject({ pack_format: "box", price_basis: "per_each" });
});

/** Move the persisted row after authorization's snapshot, just before constructing its UPDATE. */
function raceOwner(nextOwner: string | null) {
  const from = current.client.from.bind(current.client);
  current.client.from = ((table: string) => {
    const q = from(table);
    const update = q.update.bind(q);
    q.update = ((...args: Parameters<typeof update>) => {
      if (table === "vendor_items") tables.vendor_items![0]!.location_id = nextOwner;
      return update(...args);
    }) as typeof q.update;
    return q;
  }) as typeof current.client.from;
}
for (const operation of ["update", "deactivate", "basis"] as const) {
  it.each([null, A])(`${operation} refuses owner changed after read (was %s)`, async before => {
    tables.vendor_items![0]!.location_id = before;
    raceOwner(B);
    const call = operation === "update" ? updateSku(owner, { id: "sku", changes: { name: "After" } })
      : operation === "deactivate" ? deactivateSku(owner, { id: "sku", active: false })
      : setSkuPriceBasis(owner, "sku", "per_each");
    await expect(call).rejects.toMatchObject({ status: 409 });
    expect(tables.vendor_items![0]).toMatchObject({ name: "Before", active: true, price_basis: "per_case" });
    expect(current.writes.flatMap(w => w.rows)).toEqual([]);
  });
}

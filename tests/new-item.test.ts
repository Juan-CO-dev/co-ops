import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn(), par: vi.fn(), rhythm: vi.fn(), recipe: vi.fn(), barcode: vi.fn(), loadGuide: vi.fn(), createGuide: vi.fn(), saveGuide: vi.fn() }));
let db: ReturnType<typeof createFakeDb>;
let tables: Tables;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ ...db.client, rpc: mocks.rpc }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/admin/skus", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/admin/skus")>(), upsertLocationSkuSettings: mocks.par }));
vi.mock("@/lib/vendor-rhythm", () => ({ setVendorRhythmPair: mocks.rhythm }));
vi.mock("@/lib/barcodes", () => ({ teachBarcode: mocks.barcode }));
vi.mock("@/lib/admin/recipe-versions", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/admin/recipe-versions")>(), saveRecipeLines: mocks.recipe }));
vi.mock("@/lib/order-guides", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/order-guides")>(), loadOrderGuide: mocks.loadGuide, createEmptyGuide: mocks.createGuide, saveOrderGuide: mocks.saveGuide }));
import { newItemFormRequest, parseNewItemRequest, parseSetupStep } from "@/lib/catalog/new-item-shared";
import { createCatalogItem, setUpItemAtShop } from "@/lib/catalog/new-item";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", SKU = "33333333-3333-4333-8333-333333333333", VENDOR = "44444444-4444-4444-8444-444444444444", RECIPE = "55555555-5555-4555-8555-555555555555";
const gm = { user: { id: A, role: "gm" }, role: "gm", level: 7, locations: [A] } as AuthContext;
const raw = () => ({ request_id: A, scope: A, vendorId: VENDOR, name: " New item ", itemNumber: " 42 ", levels: [{ label: "case", containsQty: 16, containsIndex: null, containsMeasureUnit: "oz" }], unitPrice: 12, priceDate: "2026-10-16" });
function request() { const p = parseNewItemRequest(raw()); if (!p.ok) throw new Error(p.field); return p.request; }
beforeEach(() => {
  vi.clearAllMocks();
  tables = { vendor_items: [{ id: SKU, name: "New", vendor_id: VENDOR, location_id: A, item_number: "42", active: true }], recipes: [{ id: RECIPE, location_id: A, active: true }], measure_units: [{ label: "oz", dimension: "weight", to_base_factor: 1, active: true }] };
  db = createFakeDb(tables);
  mocks.rpc.mockResolvedValue({ data: { id: SKU }, error: null }); mocks.audit.mockResolvedValue(undefined);
  mocks.par.mockResolvedValue(undefined); mocks.recipe.mockResolvedValue({ versionId: "version", changed: true }); mocks.barcode.mockResolvedValue({ created: true });
  mocks.rhythm.mockImplementation(async (_actor, input) => ({ id: `day-${input.orderDow}` }));
});
describe("new item parser and atomic consumer", () => {
  it.each([null, [], 1, { ...raw(), scope: "bad" }, { ...raw(), vendorId: "bad" }, { ...raw(), levels: [] }, { ...raw(), unitPrice: null }, { ...raw(), unitPrice: NaN }, { ...raw(), priceDate: "2026-02-30" }, { ...raw(), avgOzPerEach: -1 }])("refuses malformed input %j", value => expect(parseNewItemRequest(value).ok).toBe(false));
  it("normalizes values and preserves omitted versus explicit global scope", () => {
    expect(request()).toMatchObject({ name: "New item", itemNumber: "42", avgOzPerEach: null });
    const { scope: _scope, ...omitted } = raw();
    expect(parseNewItemRequest(omitted)).toMatchObject({ ok: true, request: { scope: undefined } });
    expect(parseNewItemRequest({ ...raw(), scope: null })).toMatchObject({ ok: true, request: { scope: null } });
  });
  it("uses the actual atomic RPC and audits committed facts without fabricated history IDs", async () => {
    expect(await createCatalogItem(gm, request())).toEqual({ skuId: SKU, ownerLocationId: A, replayed: false });
    expect(mocks.rpc).toHaveBeenCalledWith("create_catalog_sku", { p_sku: { request_id: A, name: "New item", vendorId: VENDOR, itemNumber: "42", skuClass: "raw", avgOzPerEach: null }, p_pack: { levels: raw().levels }, p_price: { unitPrice: 12, effectiveDate: "2026-10-16" }, p_actor: A, p_location_id: A });
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "vendor_item.create", resourceId: SKU, metadata: expect.objectContaining({ job: "new_item", initial_price: { unitPrice: 12, effectiveDate: "2026-10-16" } }) }));
  });
  it.each([[{ ...gm, role: "social_media_mgr", user: { ...gm.user, role: "social_media_mgr" } }, A, "forbidden"], [gm, B, "not_found"], [gm, null, "global_requires_moo"], [{ ...gm, locations: [A, B] }, undefined, "location_required"]] as const)("binds authorization before I/O", async (actor, scope, code) => {
    await expect(createCatalogItem(actor as AuthContext, { ...request(), scope })).rejects.toMatchObject({ code });
    expect(db.log).toEqual([]); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates typed callers too before any mutation", async () => {
    await expect(createCatalogItem(gm, { ...request(), unitPrice: NaN })).rejects.toMatchObject({ code: "invalid_price" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("names an invalid null body even for a multi-shop actor", async () => {
    await expect(createCatalogItem({ ...gm, locations: [A, B] }, null as unknown as ReturnType<typeof request>)).rejects.toMatchObject({ code: "invalid_payload" });
    expect(db.log).toEqual([]);
  });
  it.each([["shop_owned:item_number_taken", "item_number_taken", 409], ["sku_pack_version:invalid_levels", "invalid_levels", 400], ["recipe_version:dependencies_busy", "dependencies_busy", 409]])("preserves %s refusal", async (message, code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(createCatalogItem(gm, request())).rejects.toMatchObject({ code, status }); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
describe("independent shop setup", () => {
  it.each([{ kind: "order_days", days: [{ orderDow: 1, leadDays: 1 }, { orderDow: 1, leadDays: 2 }] }, { kind: "use_in", recipeId: RECIPE, quantity: 1, unit: "oz", expectedVersionId: "bad" }, { kind: "guide_line", sectionId: A, newSectionName: "Both" }, { kind: "par", weekdayPar: -1 }, { kind: "barcode", code: "123456", level: "bad" }])("refuses malformed step %j", step => expect(parseSetupStep({ shopId: A, step }).ok).toBe(false));
  it("delegates par with a first-write compare baseline", async () => {
    await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "par", weekdayPar: 2, weekendPar: 4 } });
    expect(mocks.par).toHaveBeenCalledWith(gm, expect.objectContaining({ skuId: SKU, locationId: A, expected: { activeOverride: null, weekdayPar: null, weekendPar: null } }));
  });
  it("reports per-day commits and refusals, and retries only the failed day independently", async () => {
    mocks.rhythm.mockImplementation(async (_actor, input) => { if (input.orderDow === 2) throw Object.assign(new Error("stale"), { code: "rhythm_pair_conflict", status: 409 }); return { id: `day-${input.orderDow}` }; });
    const result = await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "order_days", days: [{ orderDow: 1, leadDays: 0 }, { orderDow: 2, leadDays: 1 }, { orderDow: 3, leadDays: 2 }] } });
    expect(result).toMatchObject({ step: "order_days", ok: false, detail: { outcomes: [{ orderDow: 1, ok: true, pairId: "day-1" }, { orderDow: 2, ok: false, code: "rhythm_pair_conflict", status: 409, messageKey: "admin.vendors.error.rhythm_pair_conflict" }, { orderDow: 3, ok: true, pairId: "day-3" }] } });
    mocks.rhythm.mockResolvedValueOnce({ id: "retry" });
    expect(await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "order_days", days: [{ orderDow: 2, leadDays: 1 }] } })).toMatchObject({ ok: true });
    expect(tables.vendor_items).toHaveLength(1);
  });
  it.each([A, null])("uses owned default / shared shop recipe scope for owner %s", async owner => {
    tables.recipes![0]!.location_id = owner;
    await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "use_in", recipeId: RECIPE, quantity: 2, unit: "oz", expectedVersionId: B, basedOnVersionId: A } });
    expect(mocks.recipe).toHaveBeenCalledWith(gm, expect.objectContaining({ scope: owner === A ? null : A, expectedVersionId: B, basedOnVersionId: A, op: expect.objectContaining({ kind: "add" }) }));
  });
  it("refuses foreign SKU and recipe without delegation", async () => {
    tables.vendor_items![0]!.location_id = B;
    await expect(setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "barcode", code: "123456789012", level: "case" } })).rejects.toMatchObject({ code: "sku_not_found" });
    tables.vendor_items![0]!.location_id = A; tables.recipes![0]!.location_id = B;
    await expect(setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "use_in", recipeId: RECIPE, quantity: 1, unit: "oz", expectedVersionId: null, basedOnVersionId: null } })).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.barcode).not.toHaveBeenCalled(); expect(mocks.recipe).not.toHaveBeenCalled();
  });
  it("delegates barcode and preserves its refusal while leaving the SKU committed", async () => {
    mocks.barcode.mockRejectedValue(Object.assign(new Error("taken"), { status: 409, code: "barcode_taken" }));
    await expect(setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "barcode", code: "123456789012", level: "case" } })).rejects.toMatchObject({ code: "barcode_taken" });
    expect(tables.vendor_items).toHaveLength(1);
  });
  it("edits the complete guide with its baseline token, preserving foreign existing lines", async () => {
    const guide = { guideId: A, vendorId: VENDOR, name: "Guide", updatedAt: "token", sections: [{ id: B, name: "Existing", position: 1, lines: [{ id: RECIPE, skuId: B, label: "Foreign", itemNumber: null, note: null, position: 1 }] }] };
    mocks.loadGuide.mockResolvedValue(guide); mocks.saveGuide.mockImplementation(async (_actor, _vendor, model) => model);
    await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "guide_line", sectionId: B, newSectionName: null } });
    expect(mocks.loadGuide).toHaveBeenCalledWith(VENDOR);
    expect(mocks.saveGuide).toHaveBeenCalledWith(gm, VENDOR, expect.objectContaining({ sections: [expect.objectContaining({ lines: [guide.sections[0]!.lines[0], expect.objectContaining({ skuId: SKU })] })] }), "token");
  });
  it("reports a committed empty guide when the subsequent line save fails", async () => {
    mocks.loadGuide.mockResolvedValue(null);
    mocks.createGuide.mockResolvedValue({ guideId: A, vendorId: VENDOR, name: "Guide", updatedAt: "token", sections: [] });
    mocks.saveGuide.mockRejectedValue(Object.assign(new Error("stale"), { status: 409, code: "guide_stale" }));
    expect(await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "guide_line", sectionId: null, newSectionName: "New" } })).toMatchObject({ ok: false, detail: { guideId: A, guideCreated: true, lineSaved: false, code: "guide_stale", status: 409 } });
  });
});

it("marks an unknown post-save failure as unconfirmed instead of claiming no line was saved", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.loadGuide.mockResolvedValue(null);
  mocks.createGuide.mockResolvedValue({ guideId: A, vendorId: VENDOR, name: "Guide", updatedAt: "token", sections: [] });
  mocks.saveGuide.mockRejectedValue(new Error("Read failed after save"));
  expect(await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "guide_line", sectionId: null, newSectionName: "New" } })).toMatchObject({ ok: false, detail: { guideId: A, guideCreated: true, lineSaved: null, refreshRequired: true, code: "generic", status: 500 } });
  expect(logged).toHaveBeenCalledWith("catalog request failed", { errorClass: "Error", message: "unexpected catalog failure" });
  expect(JSON.stringify(logged.mock.calls)).not.toContain("Read failed after save");
  logged.mockRestore();
});

it("logs and names an unknown per-day failure without exposing its message", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.rhythm.mockRejectedValue(new Error("customer@example.com private SQL"));
  const result = await setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "order_days", days: [{ orderDow: 2, leadDays: 1 }] } });
  expect(result).toMatchObject({ ok: false, detail: { outcomes: [{ ok: false, status: 500, code: "generic", messageKey: "catalog.error.generic", refreshRequired: true }] } });
  expect(logged).toHaveBeenCalledWith("catalog request failed", { errorClass: "Error", message: "unexpected catalog failure" });
  expect(JSON.stringify(logged.mock.calls)).not.toContain("customer@example.com");
  logged.mockRestore();
});

it("does not create a guide for a forged existing section when this vendor has no guide", async () => {
  mocks.loadGuide.mockResolvedValue(null);
  mocks.createGuide.mockResolvedValue({ guideId: A, vendorId: VENDOR, name: "Guide", updatedAt: "token", sections: [] });
  await expect(setUpItemAtShop(gm, { skuId: SKU, shopId: A, step: { kind: "guide_line", sectionId: B, newSectionName: null } })).rejects.toMatchObject({ status: 404, code: "section_not_found" });
  expect(mocks.createGuide).not.toHaveBeenCalled();
});

it("creates one request identity per form open and retains it across retries", () => {
  const form = newItemFormRequest();
  const one = form.request(raw());
  const retry = form.request({ ...raw(), name: "Edited" });
  expect(one.request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(retry.request_id).toBe(one.request_id);
  expect(newItemFormRequest().request(raw()).request_id).not.toBe(one.request_id);
});
it.each([undefined, null, "bad", 42])("requires a valid client request identity %j", request_id => {
  expect(parseNewItemRequest({ ...raw(), request_id })).toEqual({ ok: false, code: "invalid_payload", field: "request_id" });
});

it("passes replay identity through without auditing an earlier creation again", async () => {
  mocks.rpc.mockResolvedValue({ data: { id: SKU, location_id: null, replayed: true }, error: null });
  expect(await createCatalogItem(gm, { ...request(), name: "Latest edits" })).toEqual({ skuId: SKU, ownerLocationId: null, replayed: true });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("re-mints the factory after acknowledged success so a second create has a fresh identity", async () => {
  let form = newItemFormRequest();
  const first = form.request(request());
  await createCatalogItem(gm, first);
  form = newItemFormRequest();
  const second = form.request({ ...request(), name: "Second item" });
  expect(second.request_id).not.toBe(first.request_id);
  expect(form.request(second).request_id).toBe(second.request_id);
  await createCatalogItem(gm, second);
  expect(mocks.rpc.mock.calls.map(call => call[1].p_sku.request_id)).toEqual([first.request_id, second.request_id]);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { materializeEzcaterShadow } from "@/lib/ezcater/pass2";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { loadRawToastSalesRows } from "@/lib/toast/effective-depletion";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";
import { parseShadowArgs } from "../scripts/ezcater-shadow-backfill";
import { loadKnownToastOrderCodes, toastCodeSelectionKey } from "@/lib/ezcater/toast-codes";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: vi.fn() }));
vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn() }));
vi.mock("@/lib/toast/effective-depletion", () => ({ loadRawToastSalesRows: vi.fn() }));
vi.mock("@/lib/ezcater/toast-codes", () => ({ loadKnownToastOrderCodes: vi.fn(), toastCodeSelectionKey: (...ids: string[]) => JSON.stringify(ids) }));
let rows: Record<string, unknown[]>;
let errors: Record<string, { code: string; message: string }>;
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  errors = {};
  rows = {
    ezcater_orders: [{ id: "ez", lead_id: "lead", location_id: "L", event_date: "2026-10-08", order_number: "AB1234", snapshot_id: "ez-snapshot", status: "ACCEPTED" }],
    catering_pipeline: [{ id: "lead", location_id: "L", stage: "confirmed" }],
    toast_menu_map: [{ location_id: "L", toast_item_guid: "guid", toast_item_name: "Salad", item_id: "prep", menu_item_id: null }],
    productions: [{ location_id: "L", output_item_id: "prep", produced_at: "2026-10-07T20:00:00Z" }],
    toast_catering_orders: [{ location_id: "L", order_guid: "ring", lead_id: "house-lead" }],
    ezcater_order_items: [{ ordinal: 1, provider_item_uuid: "item", menu_item_size_id: "size", pos_item_id: "guid", name: "Salad", quantity: 2, options: [] }],
  };
  const from = (table: string) => {
    const q = { select: () => q, not: () => q, gte: () => q, lte: () => q, lt: () => q, eq: () => q, is: () => q, order: () => q,
      in: () => q, range: () => q, abortSignal: async () => ({ data: rows[table], error: errors[table] ?? null }) };
    return q;
  };
  rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: null }) });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(loadRecipeGraph).mockResolvedValue(buildRecipeGraph([{ recipeId: "r", batchYield: 1,
    inputs: [{ componentSkuId: "sku", componentItemId: null, quantity: 4, unit: "oz" }],
    outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 1, ozPerParUnit: null }] }],
  new Map([["sku", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }]]),
  new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]])));
  vi.mocked(loadRawToastSalesRows).mockResolvedValue([{ location_id: "L", business_date: "2026-10-08", sku_id: "sku", direct_oz: 25, flattened_oz: 0 }]);
  vi.mocked(loadCapturedToastDay).mockImplementation(async (_shop, day) => ({
    coverage: { runId: "run", finishedAt: "now", orderCount: 1, missingPointerCount: 0, absenceRemovalApplied: false, configDegraded: false },
    orders: day === "2026-10-08" ? [{ snapshotId: "toast-snapshot", orderGuid: "ring", modifiedAt: null, diningOptionGuid: null, diningOption: null, salesChannel: null,
      deleted: false, voided: false, excessFood: false, checks: [], selections: [{ check_guid: "check", selection_guid: "selection", parent_selection_guid: null,
        item_guid: "ring-item", name: "ezCater AB-1234", quantity: 1, voided: false, deleted: false }] }] : [],
  }));
});
describe("shadow materializer", () => {
  it.each(["item", "menu_item", "package"])("uses direct %s decisions with options and no Toast base row", async (kind) => {
    rows.toast_menu_map = [];
    rows.ezcater_order_items = [{ ordinal: 1, provider_item_uuid: "new-line", menu_item_size_id: "size", pos_item_id: null,
      name: "Salad", quantity: 2, options: [{ customizationId: "salad", quantity: 1 }] }];
    rows.ezcater_customization_map = [{ location_id: "L", customization_id: "salad", status: "ignored", effects: [], pick_menu_item_id: null }];
    rows.ezcater_item_map = [{ location_id: "L", identity_key: '["size",[["salad",1]]]', status: "confirmed",
      evidence: "reviewed_direct", toast_map_id: null, toast_item_guid: null,
      item_id: kind === "item" ? "prep" : null, menu_item_id: kind === "menu_item" ? "menu" : null, package_id: kind === "package" ? "package" : null }];
    rows.catering_package_items = [{ id: "line", package_id: "package", slot_type: "fixed", item_id: "prep", menu_item_id: null, quantity: 1 }];
    if (kind === "menu_item") {
      vi.mocked(loadRecipeGraph).mockResolvedValue(buildRecipeGraph([{ recipeId: "menu-recipe", batchYield: 1,
        inputs: [{ componentSkuId: "sku", componentItemId: null, quantity: 4, unit: "oz" }],
        outputs: [{ outputItemId: null, outputMenuItemId: "menu", yield: 1, ozPerParUnit: null }] }],
      new Map([["sku", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }]]),
      new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]])));
    }
    expect(await materializeEzcaterShadow("2026-10-08", "2026-10-08")).toMatchObject({ processed: 1, failed: 0 });
    const payload = rpc.mock.calls[0]![1].p_payload;
    expect(payload.maps[0]).toMatchObject({ evidence: "reviewed_direct", toast_map_id: null, toast_item_guid: null });
    expect(payload.shadow[0]).toMatchObject({ sales_oz: 8, shadow_oz: kind === "menu_item" ? 8 : 0 });
    expect(payload.reviews.filter((row: { source: string }) => row.source === "ezcater")).toEqual([]);
    expect(payload.links[0]).toMatchObject({ selection_guid: "selection" });
  });
  it("keeps decisions at their own shop", async () => {
    rows.toast_menu_map = [];
    rows.ezcater_item_map = [{ location_id: "other", identity_key: '["size",[]]', status: "confirmed", evidence: "reviewed_direct", item_id: "prep" }];
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(rpc.mock.calls[0]![1].p_payload.shadow).toEqual([]);
  });
  it("does not review options or load customization data for an ignored base item", async () => {
    rows.ezcater_order_items = [{ ordinal: 1, provider_item_uuid: "ignored-line", menu_item_size_id: "size", pos_item_id: null,
      name: "Ignored", quantity: 2, options: [{ customizationId: "option", quantity: 2 }] }];
    rows.ezcater_item_map = [{ location_id: "L", identity_key: '["size",[["option",2]]]', status: "ignored" }];
    errors.ezcater_customization_map = { code: "503", message: "must not be loaded" };
    expect(await materializeEzcaterShadow("2026-10-08", "2026-10-08")).toMatchObject({ processed: 1, failed: 0 });
    const payload = rpc.mock.calls[0]![1].p_payload;
    expect(payload).toMatchObject({ maps: [], shadow: [] });
    expect(payload.reviews.filter((row: { source: string }) => row.source === "ezcater")).toEqual([]);
  });
  it("queues an unmapped customization even after the parent was explicitly reviewed", async () => {
    rows.ezcater_order_items = [{ ordinal: 1, provider_item_uuid: "new-line", menu_item_size_id: "size", pos_item_id: null,
      name: "Salad", quantity: 2, options: [{ customizationId: "option", quantity: 2 }] }];
    rows.ezcater_item_map = [{ location_id: "L", identity_key: '["size",[["option",2]]]', status: "confirmed",
      evidence: "reviewed_direct", item_id: "prep", menu_item_id: null, package_id: null }];
    expect(await materializeEzcaterShadow("2026-10-08", "2026-10-08")).toMatchObject({ processed: 1, failed: 0 });
    expect(rpc.mock.calls[0]![1].p_payload).toMatchObject({ shadow: [expect.objectContaining({ sales_oz: 8, suppressed_oz: 8, shadow_oz: 0 })], reviews: expect.arrayContaining([
      { source: "ezcater", code: "customization_unmapped", identity_key: "option", candidates: [] },
    ]) });
    expect(rpc.mock.calls[0]![1].p_payload.reviews.filter((row: { code: string }) => row.code === "customization_unmapped")).toHaveLength(1);
  });
  it("applies mapped effects to shadow using the shop graph and line-level selected count", async () => {
    rows.ezcater_order_items = [{ ordinal: 1, provider_item_uuid: "line", menu_item_size_id: "size", pos_item_id: "guid",
      name: "Salad", quantity: 2, options: [{ customizationId: "extra", quantity: 3 }] }];
    rows.ezcater_customization_map = [{ location_id: "L", customization_id: "extra", status: "confirmed", pick_menu_item_id: null,
      effects: [{ targetKind: "sku", targetId: "extra-sku", disposition: "deplete", portionQty: 2, portionUnit: "each", parentOnly: false }] }];
    rows.vendor_items = [{ id: "extra-sku", avg_oz_per_each: 4 }];
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(loadRecipeGraph).toHaveBeenCalledWith({ locationId: "L" });
    expect(rpc.mock.calls[0]![1].p_payload.shadow).toContainEqual(expect.objectContaining({ sku_id: "extra-sku", sales_oz: 24, shadow_oz: 24 }));
  });
  it("resolves product-backed prep through each shop graph instead of a global primary", async () => {
    rows.ezcater_orders = [
      { id: "ez", lead_id: "lead", location_id: "L", event_date: "2026-10-08", order_number: "AB1234", snapshot_id: "s1", status: "ACCEPTED" },
      { id: "ez2", lead_id: "lead2", location_id: "L2", event_date: "2026-10-08", order_number: "AB5678", snapshot_id: "s2", status: "ACCEPTED" },
    ];
    rows.catering_pipeline = [{ id: "lead", location_id: "L", stage: "confirmed" }, { id: "lead2", location_id: "L2", stage: "confirmed" }];
    rows.toast_menu_map = ["L", "L2"].map((location_id) => ({ location_id, toast_item_guid: "guid", toast_item_name: "Salad", item_id: "prep", menu_item_id: null }));
    rows.productions = [];
    vi.mocked(loadRecipeGraph).mockImplementation(async (options) => {
      const skuId = `sku-${options?.locationId}`;
      return buildRecipeGraph([{ recipeId: "recipe", batchYield: 1,
        inputs: [{ componentSkuId: skuId, componentItemId: null, quantity: 4, unit: "oz" }],
        outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 1, ozPerParUnit: null }] }],
      new Map([[skuId, { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }]]),
      new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]));
    });
    expect(await materializeEzcaterShadow("2026-10-08", "2026-10-08")).toMatchObject({ processed: 2, failed: 0 });
    expect(vi.mocked(loadRecipeGraph).mock.calls).toEqual([[{ locationId: "L" }], [{ locationId: "L2" }]]);
    expect(rpc.mock.calls.map((call) => call[1].p_payload.shadow[0].sku_id)).toEqual(["sku-L", "sku-L2"]);
  });
  it("skips with a code before 0225 and does not load graph or publish", async () => {
    errors.ezcater_item_map = { code: "42P01", message: "missing" };
    expect(await materializeEzcaterShadow("2026-10-08", "2026-10-08")).toEqual({ processed: 0, failed: 0, deferred: false, skipped: "ezcater_schema_missing" });
    expect(loadRecipeGraph).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("consumes reviewed mappings across different order line UUIDs, and respects ignore", async () => {
    rows.toast_menu_map = [{ id: "map", location_id: "L", toast_item_guid: "guid", toast_item_name: "Salad", item_id: "prep", menu_item_id: null }];
    rows.ezcater_order_items = [{ ordinal: 1, provider_item_uuid: "new-line-uuid", menu_item_size_id: "size", pos_item_id: "", name: "Salad", quantity: 2, options: [] }];
    rows.ezcater_item_map = [{ location_id: "L", identity_key: '["size",[]]', status: "confirmed", evidence: "reviewed", toast_map_id: "map", toast_item_guid: "guid", item_id: "prep", menu_item_id: null, package_id: null }];
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(rpc.mock.calls[0]![1].p_payload.maps[0]).toMatchObject({ evidence: "reviewed", pos_item_id: null });
    expect(rpc.mock.calls[0]![1].p_payload.shadow[0]).toMatchObject({ sales_oz: 8, shadow_oz: 0 });
    rows.ezcater_item_map = [{ location_id: "L", identity_key: '["size",[]]', status: "ignored", toast_map_id: null }];
    rpc.mockClear();
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(rpc.mock.calls[0]![1].p_payload).toMatchObject({ maps: [], shadow: [] });
  });
  it("checks D-1/D production at both shops with PASS-3 flag enabled and refuses missing audit evidence", async () => {
    vi.stubEnv("EZCATER_DEPLETION_ENABLED", "1");
    rows.productions = [{ location_id: "old", output_item_id: "prep", produced_at: "2026-10-07T20:00:00Z" }];
    rows.audit_log = [{ resource_id: "lead", occurred_at: "2026-10-08T12:00:00Z", metadata: { from_location_id: "old", to_location_id: "L" } },
      { resource_id: "lead", occurred_at: "2026-10-08T12:01:00Z", metadata: { result: "manual_location_kept" } }];
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(rpc.mock.calls[0]![1].p_payload.shadow[0]).toMatchObject({ sales_oz: 8, suppressed_oz: 8, shadow_oz: 0 });
    errors.audit_log = { code: "503", message: "not available" };
    rpc.mockClear();
    await expect(materializeEzcaterShadow("2026-10-08", "2026-10-08")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    delete errors.audit_log;
    rows.audit_log = [{ resource_id: "lead", occurred_at: "2026-10-08T12:00:00Z", metadata: {} }];
    await expect(materializeEzcaterShadow("2026-10-08", "2026-10-08")).rejects.toThrow("ezcater_transfer_evidence_incomplete");
    vi.unstubAllEnvs();
  });
  it("uses transient known codes only for scoped catering snapshots without changing capture", async () => {
    rows.locations = [{ id: "L", toast_restaurant_guid: "restaurant" }];
    const day = await loadCapturedToastDay("L", "2026-10-08");
    const ring = day!.orders[0]!;
    ring.salesChannel = "Catering"; ring.modifiedAt = "2026-10-08T10:00:00Z";
    ring.selections[0]!.name = "Catering order";
    vi.mocked(loadCapturedToastDay).mockResolvedValue(day);
    vi.mocked(loadKnownToastOrderCodes).mockResolvedValue(new Map([[toastCodeSelectionKey("ring", "check", "selection"), ["AB1234"]]]));
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(loadKnownToastOrderCodes).toHaveBeenCalledWith("restaurant", expect.any(String), ["AB1234"], expect.objectContaining({ expectedVersions: new Map([["ring", "2026-10-08T10:00:00Z"]]) }));
    expect(rpc.mock.calls[0]![1].p_payload.links.length).toBeGreaterThan(0);
    expect(ring.selections[0]).not.toHaveProperty("ezcater_codes");
    ring.salesChannel = "In Store";
    vi.mocked(loadKnownToastOrderCodes).mockClear(); rpc.mockClear();
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(loadKnownToastOrderCodes).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0]![1].p_payload.links).toEqual([]);
  });
  it("publishes selection proof, duplicate lead review and D-1 suppression atomically to shadow only", async () => {
    expect(await materializeEzcaterShadow("2026-10-08", "2026-10-08")).toEqual({ processed: 1, failed: 0, deferred: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("publish_ezcater_shadow");
    expect(args).toMatchObject({ p_order_id: "ez", p_snapshot_id: "ez-snapshot", p_location_id: "L" });
    expect(args.p_payload.links[0]).toMatchObject({ selection_guid: "selection", toast_snapshot_id: "toast-snapshot" });
    expect(args.p_payload.reviews).toContainEqual({ source: "toast", code: "duplicate_lead", identity_key: "house-lead", candidates: ["house-lead"] });
    expect(args.p_payload.shadow[0]).toMatchObject({ sales_oz: 8, suppressed_oz: 8, shadow_oz: 0, current_day_sales_oz: 25 });
  });
  it("lost leads retire stale links/shadow by publishing an empty generation", async () => {
    rows.catering_pipeline = [{ id: "lead", location_id: "L", stage: "lost" }];
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    expect(rpc.mock.calls[0]![1].p_payload).toMatchObject({ links: [], shadow: [] });
  });
  it("name-only maps remain review-only and missing capture is disclosed", async () => {
    rows.ezcater_order_items = [{ ordinal: 1, provider_item_uuid: "item", menu_item_size_id: "size", pos_item_id: null, name: "Salad", quantity: 2, options: [] }];
    vi.mocked(loadCapturedToastDay).mockResolvedValue(null);
    await materializeEzcaterShadow("2026-10-08", "2026-10-08");
    const payload = rpc.mock.calls[0]![1].p_payload;
    expect(payload.shadow).toEqual([]);
    expect(payload.maps[0]).toMatchObject({ status: "review", evidence: null, pos_item_id: null });
    expect(payload.reviews.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(["capture_missing", "name_candidate"]));
  });
  it("refuses failed publication and does no work with an exhausted deadline", async () => {
    rpc.mockReturnValue({ abortSignal: async () => ({ error: { message: "failed" } }) });
    expect((await materializeEzcaterShadow("2026-10-08", "2026-10-08")).failed).toBe(1);
    rpc.mockClear();
    expect(await materializeEzcaterShadow("2026-10-08", "2026-10-08", 1)).toMatchObject({ deferred: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("operator backfill defaults dry, guards historical window and expected count", () => {
    expect(parseShadowArgs(["--from", "2026-09-04", "--to", "2026-10-08"]).execute).toBe(false);
    expect(() => parseShadowArgs(["--from", "2026-09-03", "--to", "2026-10-08"])).toThrow();
    expect(() => parseShadowArgs(["--execute", "--from", "2026-09-04", "--to", "2026-10-08"])).toThrow("shadow_expected_count_required");
  });
});

// Pin: prod audit_log's timestamp column is occurred_at (there is no created_at). A wrong
// name fails every nightly shadow run with 42703 while mocked unit tests stay green.
import { readFileSync } from "node:fs";
describe("audit_log column pin", () => {
  it("transfer evidence reads audit_log.occurred_at, never created_at", () => {
    const src = readFileSync("lib/ezcater/pass2.ts", "utf8");
    const block = src.slice(src.indexOf('from("audit_log")'), src.indexOf('from("audit_log")') + 400);
    expect(block).toContain("occurred_at");
    expect(block).not.toContain("created_at");
  });
});

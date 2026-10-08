import { beforeEach, describe, expect, it, vi } from "vitest";
import { materializeEzcaterShadow } from "@/lib/ezcater/pass2";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { loadEffectiveSalesRows } from "@/lib/toast/effective-depletion";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";
import { parseShadowArgs } from "../scripts/ezcater-shadow-backfill";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: vi.fn() }));
vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn() }));
vi.mock("@/lib/toast/effective-depletion", () => ({ loadEffectiveSalesRows: vi.fn() }));
let rows: Record<string, unknown[]>;
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
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
      range: () => q, abortSignal: async () => ({ data: rows[table], error: null }) };
    return q;
  };
  rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: null }) });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(loadRecipeGraph).mockResolvedValue(buildRecipeGraph([{ recipeId: "r", batchYield: 1,
    inputs: [{ componentSkuId: "sku", componentItemId: null, quantity: 4, unit: "oz" }],
    outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 1, ozPerParUnit: null }] }],
  new Map([["sku", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }]]),
  new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]])));
  vi.mocked(loadEffectiveSalesRows).mockResolvedValue([{ location_id: "L", business_date: "2026-10-08", sku_id: "sku", direct_oz: 25, flattened_oz: 0 }]);
  vi.mocked(loadCapturedToastDay).mockImplementation(async (_shop, day) => ({
    coverage: { runId: "run", finishedAt: "now", orderCount: 1, missingPointerCount: 0, absenceRemovalApplied: false, configDegraded: false },
    orders: day === "2026-10-08" ? [{ snapshotId: "toast-snapshot", orderGuid: "ring", modifiedAt: null, diningOptionGuid: null, diningOption: null, salesChannel: null,
      deleted: false, voided: false, excessFood: false, checks: [], selections: [{ check_guid: "check", selection_guid: "selection", parent_selection_guid: null,
        item_guid: "ring-item", name: "ezCater AB-1234", quantity: 1, voided: false, deleted: false }] }] : [],
  }));
});
describe("shadow materializer", () => {
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

import { beforeEach, expect, it, vi } from "vitest";
import { materializeCapturedDepletion } from "@/lib/catering/toast-sales";
import { loadCapturedToastDay, type CapturedToastDay } from "@/lib/toast/captured-day";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import { recordResolutionFlipsForLocation } from "@/lib/products";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: vi.fn() }));
vi.mock("@/lib/products", () => ({ recordResolutionFlipsForLocation: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

let day: CapturedToastDay;
let tables: Record<string, Record<string, unknown>[]>;
let reads: string[];
const rpc = vi.fn();
function graph(recipes: GraphRecipe[]) {
  return buildRecipeGraph(recipes, new Map([["sku", {
    packFormat: null, eachContainerLabel: null, unitsPerPack: null,
    eachSize: null, eachMeasure: null, avgOzPerEach: null,
  }]]), new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]));
}

beforeEach(() => {
  vi.clearAllMocks(); reads = [];
  day = { coverage: { runId: "run", finishedAt: "2026-10-07T05:00:00Z", orderCount: 1,
    missingPointerCount: 2, absenceRemovalApplied: false, configDegraded: false },
    orders: [{ snapshotId: "snap", orderGuid: "order", modifiedAt: null, diningOptionGuid: null,
      diningOption: null, salesChannel: null, deleted: false, voided: false, excessFood: false,
      checks: [{ checkGuid: "check", amountCents: 200, voided: false, deleted: false }],
      selections: [
        { selection_guid: "sold", check_guid: "check", parent_selection_guid: null, item_guid: "mapped", name: "Sub", quantity: 30, voided: false, deleted: false },
        { selection_guid: "unmapped", check_guid: "check", parent_selection_guid: null, item_guid: "unknown", name: "Unknown", quantity: 3, voided: false, deleted: false },
        { selection_guid: "excluded", check_guid: "check", parent_selection_guid: null, item_guid: "excluded", name: "Excluded", quantity: 4, voided: false, deleted: false },
      ] }] };
  tables = {
    toast_ingest_exclusions: [{ id: "exclusion", location_id: "shop", kind: "toast_item_guid", value: "excluded", note: null, created_at: "2026-10-01" }],
    toast_menu_map: [{ toast_item_guid: "mapped", item_id: "item", menu_item_id: null,
      package_id: null, sku_id: null, is_modifier: false, disposition: "deplete", portion_qty: null, portion_unit: null }],
    items: [{ id: "item", name: "Prep" }], vendor_items: [{ id: "sku", name: "Ingredient", avg_oz_per_each: null }],
    productions: [],
  };
  vi.mocked(loadRecipeGraph).mockResolvedValue(graph([{ recipeId: "recipe", batchYield: 1,
    inputs: [{ quantity: 2, unit: "oz", componentSkuId: "sku", componentItemId: null }],
    outputs: [{ outputItemId: "item", outputMenuItemId: null, yield: 1, ozPerParUnit: null }] }]));
  vi.mocked(loadCapturedToastDay).mockImplementation(async () => day);
  rpc.mockResolvedValue({ data: { aggregate_count: 1, attribution_count: 1, coverage_count: 1 }, error: null });
  const from = (table: string) => {
    reads.push(table);
    const q = { select: () => q, eq: () => q, is: () => q, gte: () => q, lt: () => q,
      order: () => q, in: () => q, range: () => q,
      returns: async () => ({ data: tables[table] ?? [], error: null }) };
    return q;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});

it("publishes the legacy-equivalent signals and diagnostics atomically with depletion", async () => {
  await expect(materializeCapturedDepletion("shop", "2026-10-06"))
    .resolves.toMatchObject({ rows: 1, status: "success", reason: null });
  expect(rpc).toHaveBeenCalledWith("replace_toast_depletion_day", expect.objectContaining({
    p_run_id: "run", p_suspect_check_count: 1, p_suspect_qty: 33, p_counted_qty: 30,
    p_status: "success", p_reason: null,
    p_aggregates: [{ sku_id: "sku", direct_oz: 0, flattened_oz: 60 }],
    p_attributions: [{ item_id: "item", item_path: ["item"], sku_id: "sku", sales_oz: 60 }],
    p_diagnostics: { unmapped_units: 3, excluded_units: 4, poisoned_recipes: [],
      unresolved_prep_items: [], mapping_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), deletion_by_absence_count: 2 },
  }));
  expect(reads).not.toContain("toast_daily_sales_signals");
  expect(reads).not.toContain("toast_sales_events");
  expect(recordResolutionFlipsForLocation).toHaveBeenCalledWith("shop");
});

it("publishes stale configuration as degraded with a reason instead of retaining an older success", async () => {
  day.coverage.configDegraded = true;
  await expect(materializeCapturedDepletion("shop", "2026-10-06"))
    .resolves.toMatchObject({ status: "degraded", reason: "toast_capture_config_degraded" });
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_status: "degraded", p_reason: "toast_capture_config_degraded", p_counted_qty: 30 });
});

it("replaces a genuinely empty day with explicit zero signals and empty aggregates", async () => {
  day.orders = []; day.coverage.orderCount = 0;
  await materializeCapturedDepletion("shop", "2026-10-06");
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_aggregates: [], p_attributions: [],
    p_suspect_check_count: 0, p_suspect_qty: 0, p_counted_qty: 0, p_status: "success" });
});

it("includes reviewed catering exclusions in diagnostic units without counting them as sales", async () => {
  day.orders[0]!.salesChannel = "catering";
  await materializeCapturedDepletion("shop", "2026-10-06");
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_counted_qty: 0, p_suspect_check_count: 0,
    p_aggregates: [], p_diagnostics: { excluded_units: 37, unmapped_units: 0 } });
});

it("keeps poisoned menu recipes diagnostic without degrading coverage", async () => {
  tables.toast_menu_map![0]!.item_id = null;
  tables.toast_menu_map![0]!.menu_item_id = "menu";
  vi.mocked(loadRecipeGraph).mockResolvedValue(graph([{ recipeId: "poisoned-recipe", batchYield: 1,
    inputs: [{ quantity: 2, unit: "unresolvable", componentSkuId: "sku", componentItemId: null }],
    outputs: [{ outputItemId: null, outputMenuItemId: "menu", yield: 1, ozPerParUnit: null }] }]));
  await materializeCapturedDepletion("shop", "2026-10-06");
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_status: "success",
    p_diagnostics: { poisoned_recipes: ["poisoned-recipe"] } });
});

it("does not run post-publication effects after a refused RPC", async () => {
  rpc.mockResolvedValue({ error: { message: "toast_depletion_obsolete_run" } });
  await expect(materializeCapturedDepletion("shop", "2026-10-06")).rejects.toThrow("toast_depletion_obsolete_run");
  expect(recordResolutionFlipsForLocation).not.toHaveBeenCalled();
});

it("preserves independent aggregate amounts so SQL can diagnose attribution mismatch", async () => {
  const initial = await loadRecipeGraph({ locationId: "shop" });
  const changed = graph([{ recipeId: "recipe", batchYield: 1,
    inputs: [{ quantity: 4, unit: "oz", componentSkuId: "sku", componentItemId: null }],
    outputs: [{ outputItemId: "item", outputMenuItemId: null, yield: 1, ozPerParUnit: null }] }]);
  vi.mocked(loadRecipeGraph).mockResolvedValueOnce(initial).mockResolvedValueOnce(changed);
  await materializeCapturedDepletion("shop", "2026-10-06");
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({
    p_aggregates: [{ flattened_oz: 60 }], p_attributions: [{ sales_oz: 120 }],
  });
});

it("publishes unresolved prep attribution as a diagnostic instead of dropping the day", async () => {
  const initial = await loadRecipeGraph({ locationId: "shop" });
  vi.mocked(loadRecipeGraph).mockResolvedValueOnce(initial).mockResolvedValueOnce(graph([]));
  await expect(materializeCapturedDepletion("shop", "2026-10-06")).resolves.toMatchObject({ status: "success" });
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_attributions: [], p_diagnostics: { unresolved_prep_items: ["item"] } });
});
it("excludes gift-card channel units from depletion", async () => {
  day.orders[0]!.salesChannel = "gift_card";
  await materializeCapturedDepletion("shop", "2026-10-06");
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_counted_qty: 0, p_aggregates: [], p_diagnostics: { excluded_units: 37 } });
});

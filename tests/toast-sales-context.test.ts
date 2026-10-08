/** A-D integration over the real shared projection and graph math, with DB I/O mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import { deriveSalesConsumptionFrom, loadSalesConsumptionContext, type LedgerRow } from "@/lib/catering/toast-sales";
import type { RecipeInputSku, MeasureUnitFactor } from "@/lib/recipe-math";
import { loadReconciledSalesWindow } from "@/lib/ezcater/depletion";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: vi.fn() }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failedTable: string | undefined;
let reads: string[];
const sku = (id: string, oz = 1): GraphRecipe["inputs"][number] => ({ quantity: oz, unit: "oz", componentSkuId: id, componentItemId: null });
const item = (id: string, qty = 1): GraphRecipe["inputs"][number] => ({ quantity: qty, unit: null, componentSkuId: null, componentItemId: id });
function recipe(id: string, inputs: GraphRecipe["inputs"], isItem = false): GraphRecipe {
  return { recipeId: `recipe-${id}`, batchYield: 1, inputs,
    outputs: [{ outputItemId: isItem ? id : null, outputMenuItemId: isItem ? null : id, yield: 1, ozPerParUnit: isItem ? 1 : null }] };
}
const skuIds = ["raw-prov", "raw-mozz", "raw-gf", "roll", "raw-a", "raw-b", "raw-c", "raw-d"];
const pack: RecipeInputSku = { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 3 };
const graph = buildRecipeGraph([
  recipe("prov", [sku("raw-prov")], true), recipe("mozz", [sku("raw-mozz")], true), recipe("gf", [sku("raw-gf", 2)], true),
  recipe("a", [sku("raw-a"), item("prov", 2), sku("roll", 6)]),
  recipe("b", [sku("raw-b"), item("mozz", 3)]),
  recipe("c", [sku("raw-c")]), recipe("d", [sku("raw-d")]),
  recipe("pm", [item("prov", 1), item("mozz", 1)]),
], new Map(skuIds.map((id) => [id, pack])), new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["each", { dimension: "count", toBaseFactor: 1 }]]));

function mapping(guid: string, values: Row = {}): Row {
  return { id: `map-${guid}`, location_id: "shop", active: true, match_status: "confirmed", toast_item_guid: guid,
    menu_item_id: null, item_id: null, sku_id: null, package_id: null, is_modifier: false,
    disposition: "deplete", portion_qty: null, portion_unit: null, parent_only: false, ...values };
}
function line(selection: string, guid: string, parent: string | null = null, qty = 1, name = guid): LedgerRow {
  return { check_guid: "check", selection_guid: selection, toast_item_guid: guid, parent_selection_guid: parent,
    item_name: name, quantity: qty, price_cents: null, voided: false, dining_option: null, menu_group: null, snapshot_version: 1 };
}
const derive = (...rows: LedgerRow[]) => deriveSalesConsumptionFrom("shop", "2026-10-07", new Map(rows.map((r) => [`${r.check_guid}:${r.selection_guid}`, r])));
function choice(id: string, qty: number, order: number, depletionQty: number | null = null): Row {
  return { id, package_id: "pkg", active: true, slot_type: "choice", item_id: null, menu_item_id: null, quantity: qty, depletion_qty: depletionQty, display_order: order };
}
function options(slot: string, ...ids: string[]): Row[] {
  return ids.map((id, index) => ({ package_item_id: slot, item_id: null, menu_item_id: id, active: true, classic: index === 0 }));
}
function packageSetup() {
  tables.toast_menu_map!.push(mapping("package", { package_id: "pkg" }),
    ...["a", "b", "c", "d"].map((id) => mapping(`pick-${id}`, { is_modifier: true, menu_item_id: id })),
    mapping("classics", { is_modifier: true, disposition: "assortment_classics" }));
  tables.catering_package_items = [choice("slot", 2, 0)];
  tables.catering_package_slot_options = options("slot", "c", "d");
}

beforeEach(() => {
  vi.clearAllMocks(); failedTable = undefined; reads = [];
  tables = {
    toast_ingest_exclusions: [], toast_map_effects: [], toast_open_item_aliases: [],
    toast_menu_map: ["a", "b", "c", "d"].map((id) => mapping(id, { menu_item_id: id })),
    menu_items: ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() })),
    items: ["prov", "mozz", "gf"].map((id) => ({ id, name: id })),
    vendor_items: skuIds.map((id) => ({ id, name: id, avg_oz_per_each: 3 })),
    catering_packages: [{ id: "pkg", label_en: "Lunch" }], catering_package_items: [], catering_package_slot_options: [],
  };
  vi.mocked(loadRecipeGraph).mockResolvedValue(graph);
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
    reads.push(table);
    let rows = [...tables[table]!];
    let selectedColumns: string[] | undefined;
    const result = () => ({ data: failedTable === table ? null : selectedColumns
      ? rows.map((row) => Object.fromEntries(selectedColumns!.map((column) => [column, row[column]]))) : rows,
      error: failedTable === table ? { message: "read denied" } : null });
    const q = {
      select: (columns: string) => {
        // Match PostgREST's selected map shape and field order for the legacy hash proof.
        if (table === "toast_menu_map") selectedColumns = columns.split(",").map((column) => column.trim());
        return q;
      },
      eq: (key: string, value: unknown) => {
        rows = rows.filter((r) => key.startsWith("toast_menu_map.")
          ? tables.toast_menu_map!.find((m) => m.id === r.map_id)?.[key.slice("toast_menu_map.".length)] === value
          : r[key] === value);
        return q;
      },
      in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return q; },
      not: (key: string, _op: string, value: unknown) => { rows = rows.filter((r) => r[key] !== value); return q; },
      is: (key: string, value: unknown) => { rows = rows.filter((r) => (r[key] ?? null) === value); return q; },
      gte: (key: string, value: string) => { rows = rows.filter((r) => String(r[key]) >= value); return q; },
      lt: (key: string, value: string) => { rows = rows.filter((r) => String(r[key]) < value); return q; },
      or: () => q, // production restricts global/current shop; alias fixture includes only those
      order: (key: string) => { rows.sort((a, b) => String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true })); return q; },
      range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return q; },
      returns: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.unstubAllEnvs());


describe("per-shop sales context reuse", () => {
  it("bounds the entire populated 30-day reconciled path, using real capture/config/projection loaders", async () => {
    vi.stubEnv("DEPLETION_SOURCE", "capture");
    const dates = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    Object.assign(tables, {
      ezcater_orders: [], ezcater_current_toast_links: [], productions: [], audit_log: [], ezcater_item_map: [],
      locations: [{ id: "shop", active: true, toast_restaurant_guid: "restaurant" }],
      toast_dining_options: [], sales_channel_map: [],
      toast_capture_runs: dates.map((date) => ({ id: `run-${date}`, location_id: "shop", business_date: date, orders: 1, status: "completed", finished_at: `${date}T23:00:00Z` })),
      toast_capture_run_orders: dates.map((date) => ({ run_id: `run-${date}`, location_id: "shop", business_date: date, order_guid: `order-${date}`, snapshot_id: `snap-${date}` })),
      toast_order_latest_pointers: dates.map((date) => ({ location_id: "shop", business_date: date, order_guid: `order-${date}`, snapshot_id: `snap-${date}` })),
      toast_orders: dates.map((date) => ({ id: `snap-${date}`, order_guid: `order-${date}`, location_id: "shop", business_date: date,
        modified_at: `${date}T22:00:00Z`, dining_option_guid: null, deleted: false, voided: false, excess_food: false,
        selection_units: [{ check_guid: `check-${date}`, selection_guid: "selection", item_guid: "a", name: "A", quantity: 1, voided: false, deleted: false, parent_selection_guid: null }] })),
      toast_order_checks: dates.map((date) => ({ snapshot_id: `snap-${date}`, check_guid: `check-${date}`, amount_cents: 100, deleted: false, voided: false })),
    });
    const result = await loadReconciledSalesWindow(getServiceRoleClient(), { locationId: "shop", fromDate: "2026-09-01", untilDateExclusive: "2026-10-01" });
    expect(result.coverage.hasGaps).toBe(false);
    expect(result.coverage.degraded).toBe(false);
    expect(result.rows).toHaveLength(90);
    expect(result.rows.filter((row) => row.sku_id === "raw-prov").reduce((n, row) => n + row.direct_oz, 0)).toBe(60);
    expect(reads.length).toBeLessThanOrEqual(24);
    expect(loadRecipeGraph).toHaveBeenCalledExactlyOnceWith({ locationId: "shop" });
    expect(reads.filter((table) => table === "items")).toHaveLength(1);
    expect(reads.filter((table) => table === "toast_dining_options")).toHaveLength(1);
  });
  it("derives thirty populated days without configuration reads or graph reloads", async () => {
    packageSetup();
    tables.toast_menu_map!.push(mapping("bread", { is_modifier: true, sku_id: "roll", portion_qty: 1, portion_unit: "each" }));
    tables.toast_map_effects = [{ id: "effect", map_id: "map-bread", ordinal: 1, active: true,
      item_id: null, sku_id: "roll", menu_item_id: null, disposition: "remove", portion_qty: 1, portion_unit: "oz", parent_only: false }];
    const rows = [line("pkg", "package"), line("pick", "pick-c", "pkg"), line("sub", "a"), line("extra", "bread", "sub")];
    const expected = await derive(...rows);
    const context = await loadSalesConsumptionContext("shop", graph);
    const baseline = reads.length;
    const graphCalls = vi.mocked(loadRecipeGraph).mock.calls.length;
    for (let day = 1; day <= 30; day++) {
      const result = await deriveSalesConsumptionFrom("shop", `2026-09-${String(day).padStart(2, "0")}`,
        new Map(rows.map((r) => [`${r.check_guid}:${r.selection_guid}`, r])), context);
      expect(result).toEqual(expected);
    }
    expect(reads).toHaveLength(baseline);
    expect(loadRecipeGraph).toHaveBeenCalledTimes(graphCalls);
  });

  it("rejects another shop's context before querying", async () => {
    const context = await loadSalesConsumptionContext("shop", graph);
    const baseline = reads.length;
    await expect(deriveSalesConsumptionFrom("other", "2026-10-01", new Map(), context))
      .rejects.toThrow("sales_consumption_context_location_mismatch");
    expect(reads).toHaveLength(baseline);
  });

  it("loads the graph with the shop when none is supplied", async () => {
    await loadSalesConsumptionContext("shop");
    expect(loadRecipeGraph).toHaveBeenCalledExactlyOnceWith({ locationId: "shop" });
  });

  it("propagates configuration read failures", async () => {
    failedTable = "vendor_items";
    await expect(loadSalesConsumptionContext("shop", graph)).rejects.toThrow("read denied");
  });
});

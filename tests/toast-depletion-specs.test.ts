/** A-D integration over the real shared projection and graph math, with DB I/O mocked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import { deriveSalesConsumptionFrom, deriveCapturedSalesConsumption, type LedgerRow } from "@/lib/catering/toast-sales";
import type { CapturedToastDay } from "@/lib/toast/captured-day";
import type { RecipeInputSku, MeasureUnitFactor } from "@/lib/recipe-math";

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
const direct = (result: Awaited<ReturnType<typeof derive>>, id: string) => result.skuConsumed.find((r) => r.skuId === id)?.directOz ?? 0;
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

describe("A: shared projection modifier effects", () => {
  it("removes only each parent's own cheese and preserves another unsuppressed sale", async () => {
    tables.toast_menu_map!.push(mapping("no-cheese", { is_modifier: true, item_id: "prov", disposition: "remove", parent_only: true, portion_qty: 50 }));
    tables.toast_map_effects = [{ id: "effect", map_id: "map-no-cheese", ordinal: 1, active: true, item_id: "mozz", menu_item_id: null, sku_id: null, disposition: "remove", parent_only: true, portion_qty: 50, portion_unit: null }];
    const result = await derive(line("a1", "a"), line("b1", "b"), line("c1", "c"), line("a2", "a"),
      line("n1", "no-cheese", "a1"), line("n2", "no-cheese", "b1"), line("n3", "no-cheese", "c1"));
    expect(result.prepConsumed).toEqual([{ itemId: "prov", name: "prov", units: 2, removedUnits: 2 }, { itemId: "mozz", name: "mozz", units: 0, removedUnits: 3 }]);
    expect(reads.filter((r) => r === "toast_map_effects")).toHaveLength(1);
  });
  it("counts one removal per line even when several effects apply (CC review)", async () => {
    tables.toast_menu_map!.push(mapping("pm", { menu_item_id: "pm" }),
      mapping("no-cheese", { is_modifier: true, item_id: "prov", disposition: "remove", parent_only: true, portion_qty: 50 }));
    tables.toast_map_effects = [{ id: "effect", map_id: "map-no-cheese", ordinal: 1, active: true, item_id: "mozz", menu_item_id: null, sku_id: null, disposition: "remove", parent_only: true, portion_qty: 50, portion_unit: null }];
    const result = await derive(line("p1", "pm"), line("n1", "no-cheese", "p1"));
    expect(result.prepConsumed.map((r) => [r.itemId, r.removedUnits])).toEqual([["prov", 1], ["mozz", 1]]);
    expect(result.modifierStats.removed).toBe(1);
  });
  it("GF swap on breadless parent does not steal another sale's roll", async () => {
    swapSetup();
    const result = await derive(line("a1", "a"), line("b1", "b"), line("swap1", "swap", "b1"));
    expect(direct(result, "roll")).toBe(6);
    expect(result.prepConsumed.find((r) => r.itemId === "gf")?.units).toBe(1);
  });
  it("SKU removal uses actual parent oz, not the each fallback", async () => {
    swapSetup();
    const result = await derive(line("a1", "a"), line("swap1", "swap", "a1"));
    expect(result.skuConsumed.find((r) => r.skuId === "roll")).toMatchObject({ directOz: 0, removedOz: 6 });
  });
  it("capture adapter applies the same multi-effect swap", async () => {
    swapSetup();
    const rows = [line("a1", "a"), line("swap1", "swap", "a1")];
    const day: CapturedToastDay = { coverage: { runId: "run", finishedAt: "2026-10-08T00:00:00Z", orderCount: 1, missingPointerCount: 0, absenceRemovalApplied: false, configDegraded: false }, orders: [{
      snapshotId: "snapshot", orderGuid: "order", modifiedAt: null, diningOptionGuid: null, diningOption: null, salesChannel: "retail", deleted: false, voided: false, excessFood: false,
      checks: [{ checkGuid: "check", amountCents: 100, voided: false, deleted: false }],
      selections: rows.map((r) => ({ check_guid: r.check_guid, selection_guid: r.selection_guid, parent_selection_guid: r.parent_selection_guid, item_guid: r.toast_item_guid, name: r.item_name, quantity: Number(r.quantity), voided: false, deleted: false })),
    }] };
    const result = await deriveCapturedSalesConsumption("shop", "2026-10-07", day);
    expect(result).toMatchObject({ captureRunId: "run", sourceOrderCount: 1 });
    expect(result.skuConsumed.find((r) => r.skuId === "roll")).toMatchObject({ directOz: 0, removedOz: 6 });
    expect(result.prepConsumed.find((r) => r.itemId === "gf")?.units).toBe(1);
  });
});
function swapSetup() {
  tables.toast_menu_map!.push(mapping("swap", { is_modifier: true, item_id: "gf", portion_qty: 1, portion_unit: "each" }));
  tables.toast_map_effects = [{ id: "effect", map_id: "map-swap", ordinal: 1, active: true, item_id: null, menu_item_id: null, sku_id: "roll", disposition: "remove", parent_only: true, portion_qty: 1, portion_unit: "each" }];
}

describe("B: package picks", () => {
  it("binds picks to two different slots and spreads only the remainder", async () => {
    packageSetup(); tables.catering_package_items = [choice("first", 2, 0), choice("second", 2, 1)];
    tables.catering_package_slot_options = [...options("first", "a", "b"), ...options("second", "c", "d")];
    const result = await derive(line("p", "package"), line("pa", "pick-a", "p"), line("pc", "pick-c", "p"));
    expect(["a", "b", "c", "d"].map((id) => direct(result, `raw-${id}`))).toEqual([1.5, 0.5, 1.5, 0.5]);
  });
  it("drops excess picks in ledger order instead of adding them again as modifiers", async () => {
    packageSetup();
    const result = await derive(line("p", "package"), line("pc", "pick-c", "p", 3), line("pd", "pick-d", "p"));
    expect(direct(result, "raw-c")).toBe(2); expect(direct(result, "raw-d")).toBe(0);
    expect(result.packageIssues).toEqual([{ name: "Lunch", issue: "excess_picks" }]);
  });
  it("assigns a pick present in both pools to the first display_order slot", async () => {
    packageSetup(); tables.catering_package_items = [choice("later", 1, 20), choice("earlier", 1, 10)];
    tables.catering_package_slot_options = [...options("later", "c", "d"), ...options("earlier", "c", "a")];
    const result = await derive(line("p", "package"), line("pc", "pick-c", "p"));
    expect(direct(result, "raw-c")).toBe(1.5); expect(direct(result, "raw-d")).toBe(0.5); expect(direct(result, "raw-a")).toBe(0);
  });
  it("keeps same selection guids on different checks independent", async () => {
    packageSetup();
    const result = await derive(line("p", "package"), line("pc", "pick-c", "p", 2),
      { ...line("p", "package"), check_guid: "other-check" }, { ...line("pd", "pick-d", "p", 2), check_guid: "other-check" });
    expect(direct(result, "raw-c")).toBe(2); expect(direct(result, "raw-d")).toBe(2); expect(result.packageIssues).toEqual([]);
  });
  it("uses a named non-classic pick plus the classics remainder", async () => {
    packageSetup();
    const result = await derive(line("p", "package"), line("pd", "pick-d", "p"), line("marker", "classics", "p"));
    expect(direct(result, "raw-c")).toBe(1); expect(direct(result, "raw-d")).toBe(1);
  });
  it("scales Light Lunch picks to depletion_qty, leaving selection count intact", async () => {
    packageSetup(); tables.catering_package_items = [choice("slot", 1, 0, 0.5)];
    const result = await derive(line("p", "package", null, 2), line("pc", "pick-c", "p", 2));
    expect(direct(result, "raw-c")).toBe(1); expect(direct(result, "raw-d")).toBe(0);
    expect(result.packageIssues).toEqual([]);
  });
  it("keeps unmatched picks in the ordinary modifier lane", async () => {
    packageSetup();
    const result = await derive(line("p", "package"), line("pa", "pick-a", "p"));
    expect(direct(result, "raw-a")).toBe(0.5); expect(direct(result, "raw-c")).toBe(1); expect(direct(result, "raw-d")).toBe(1);
  });
  it("no picks preserves legacy output byte-for-byte including the configuration fingerprint", async () => {
    packageSetup();
    const oldColumns = ["menu_item_id", "item_id", "package_id", "sku_id", "toast_item_guid", "is_modifier", "disposition", "portion_qty", "portion_unit"];
    const oldRows = tables.toast_menu_map!.map((row) => Object.fromEntries(oldColumns.map((column) => [column, row[column]])));
    const legacyHash = createHash("sha256").update(JSON.stringify(oldRows.map((row) => JSON.stringify(row)).sort())).digest("hex");
    const result = await derive(line("p", "package"));
    // Frozen legacy contract, also executed against HEAD a2dbe4c's original core:
    // old evenMixPerOption(2, 2) emits c=1 and d=1.
    expect(result.diagnostics?.mapping_fingerprint).toBe(legacyHash);
    const legacy = { soldLines: [{ name: "Lunch", quantity: 1, kind: "package" }], prepConsumed: [],
      skuConsumed: ["c", "d"].map((id) => ({ skuId: `raw-${id}`, name: `raw-${id}`, oz: 1, directOz: 1, flattenedOz: 0, removedOz: 0 })),
      unmappedToastItems: [], excludedCount: 0, diagnostics: { unmapped_units: 0, excluded_units: 0, poisoned_recipes: [], mapping_fingerprint: legacyHash },
      suspectedCatering: [], modifierStats: { depleted: 0, removed: 0, ignored: 0, portionNeeded: [] }, packageIssues: [] };
    expect(JSON.stringify(result)).toBe(JSON.stringify(legacy));
  });
});

describe("C: dual-role guids", () => {
  it("uses a modifier item portion and SKU portion on parentless lines", async () => {
    tables.toast_menu_map!.push(mapping("tomato", { is_modifier: true, item_id: "prov", portion_qty: 0.25, portion_unit: "oz" }), mapping("condiment", { is_modifier: true, sku_id: "roll", portion_qty: 2, portion_unit: "oz" }));
    const result = await derive(line("t", "tomato", null, 4), line("s", "condiment", null, 3));
    expect(result.prepConsumed.find((r) => r.itemId === "prov")?.units).toBe(1);
    expect(direct(result, "roll")).toBe(6); expect(result.unmappedToastItems).toEqual([]);
  });
  it("uses a full unit for a base menu/item guid appearing as a modifier", async () => {
    tables.toast_menu_map!.push(mapping("base-item", { item_id: "gf" }));
    const result = await derive(line("p", "c"), line("drink", "d", "p", 2), line("i", "base-item", "p", 2));
    expect(direct(result, "raw-d")).toBe(2);
    expect(result.prepConsumed.find((r) => r.itemId === "gf")?.units).toBe(2); expect(result.unmappedToastItems).toEqual([]);
  });
});

describe("D: typed open items", () => {
  function openSetup() {
    tables.toast_menu_map!.push(mapping("open", { disposition: "open_item" }));
    tables.toast_open_item_aliases = [
      { id: "global", location_id: null, normalized_text: "chip", menu_item_id: "c", item_id: null, qty_multiplier: 1, active: true },
      { id: "local", location_id: "shop", normalized_text: "chip", menu_item_id: "d", item_id: null, qty_multiplier: 2, active: true },
      { id: "cream", location_id: null, normalized_text: "cream soda", menu_item_id: "c", item_id: null, qty_multiplier: 1, active: true },
    ];
  }
  it("normalizes text and prefers the location alias, applying its multiplier", async () => {
    openSetup();
    const result = await derive(line("o", "open", null, 3, "  CHIOZ!!  "), line("cream", "open", null, 1, "CREWM   SODA"));
    expect(direct(result, "raw-d")).toBe(6); expect(direct(result, "raw-c")).toBe(1); expect(result.unmappedToastItems).toEqual([]);
  });
  it("retains distinct unmapped descriptions sharing one guid", async () => {
    openSetup();
    const result = await derive(line("o1", "open", null, 2, "Unrecognized one"), line("o2", "open", null, 1, "Unrecognized two"));
    expect(result.unmappedToastItems).toEqual([
      { name: "Unrecognized one", quantity: 2, toastItemGuid: "open", isModifier: false, isOpenItem: true },
      { name: "Unrecognized two", quantity: 1, toastItemGuid: "open", isModifier: false, isOpenItem: true },
    ]); expect(result.diagnostics?.unmapped_units).toBe(3);
  });
  it("skips ezCater codes, catering descriptions and date-only entries", async () => {
    openSetup();
    const result = await derive(line("o1", "open", null, 1, "abc-123"), line("o2", "open", null, 1, "Catering delivery"), line("o3", "open", null, 1, "10/07/2026"));
    expect(result.unmappedToastItems).toEqual([]); expect(result.diagnostics?.unmapped_units).toBe(0); expect(result.skuConsumed).toEqual([]);
  });
  it.each(["toast_map_effects", "toast_open_item_aliases"])("fails visibly when %s cannot be read", async (table) => {
    openSetup(); failedTable = table;
    await expect(derive(line("o", "open", null, 1, "chips"))).rejects.toThrow(/read denied/);
  });
});

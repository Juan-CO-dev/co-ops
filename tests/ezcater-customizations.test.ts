import { describe, expect, it } from "vitest";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import {
  customizedLineAmounts,
  packageTargets,
  resolveCustomizations,
  type CustomizationMap,
  type PackageComposition,
} from "@/lib/ezcater/customizations-shared";
import type { ModifierEffect } from "@/lib/toast/modifiers-shared";

const sku = (id: string, quantity: number): GraphRecipe["inputs"][number] => ({
  componentSkuId: id, componentItemId: null, quantity, unit: "oz",
});
const item = (id: string, quantity: number): GraphRecipe["inputs"][number] => ({
  componentSkuId: null, componentItemId: id, quantity, unit: "each",
});
const output = (id: string, inputs: GraphRecipe["inputs"], isItem = false): GraphRecipe => ({
  recipeId: `recipe-${id}`, batchYield: 1, inputs,
  outputs: [{ outputItemId: isItem ? id : null, outputMenuItemId: isItem ? null : id, yield: 1, ozPerParUnit: null }],
});
const skuIds = ["roll", "gf-roll", "raw-mozz", "raw-iceberg", "raw-filling", "raw-a", "raw-b", "raw-c"];
const graph = buildRecipeGraph([
  output("mozz", [sku("raw-mozz", 2)], true),
  output("iceberg", [sku("raw-iceberg", 3)], true),
  output("filling", [sku("raw-filling", 4)], true),
  output("sub", [sku("roll", 6), item("filling", 1)]),
  output("breadless", [item("filling", 1)]),
  output("a", [sku("raw-a", 1)]), output("b", [sku("raw-b", 1)]), output("c", [sku("raw-c", 1)]),
], new Map(skuIds.map((id) => [id, {
  packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null,
  avgOzPerEach: id === "gf-roll" ? 5 : null,
}])), new Map([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
]));

const effect = (overrides: Partial<ModifierEffect>): ModifierEffect => ({
  targetKind: "item", targetId: "mozz", disposition: "deplete", portionQty: 1,
  portionUnit: "each", parentOnly: false, ...overrides,
});
const map = (customization_id: string, effects: ModifierEffect[], overrides: Partial<CustomizationMap> = {}): CustomizationMap => ({
  location_id: "shop-a", customization_id, status: "confirmed", effects, pick_menu_item_id: null, ...overrides,
});
const option = (customizationId: string, quantity: unknown = 1) => ({ customizationId, quantity });
const amount = (rows: ReturnType<typeof customizedLineAmounts>["amounts"], id: string) => rows.find((row) => row.sku_id === id);
const run = (overrides: Partial<Parameters<typeof customizedLineAmounts>[0]> = {}) => customizedLineAmounts({
  graph, target: { item_id: null, menu_item_id: "sub" }, quantity: 1, options: [], maps: [],
  locationId: "shop-a", eventDate: "2026-10-08", productions: [], ...overrides,
});

describe("ezCater customization identity and quantities", () => {
  it("keeps maps shop-scoped, ignores reviewed no-ops, and queues unmapped identities", () => {
    const maps = [
      map("same", [effect({ targetId: "mozz" })]),
      map("same", [effect({ targetId: "iceberg" })], { location_id: "shop-b" }),
      map("ignored", [], { status: "ignored" }),
    ];
    expect(resolveCustomizations([option("same", 2)], maps, "shop-b").effects[0]?.effect.targetId).toBe("iceberg");
    expect(resolveCustomizations([option("ignored")], maps, "shop-a")).toEqual({ effects: [], picks: [], issues: [] });
    expect(resolveCustomizations([option("new")], maps, "shop-a").issues).toEqual([
      { code: "customization_unmapped", identity_key: "new" },
    ]);
  });

  it.each([NaN, Infinity, -1, "2", null])("refuses invalid option quantity %s", (quantity) => {
    expect(resolveCustomizations([option("mozz", quantity)], [map("mozz", [effect({})])], "shop-a").issues)
      .toEqual([{ code: "customization_quantity_invalid", identity_key: "mozz" }]);
  });

  it("treats option quantities as line-level selected counts instead of multiplying by line quantity", () => {
    const result = run({ quantity: 4, options: [option("mozz", 2)], maps: [map("mozz", [effect({ portionQty: 0.5 })])] });
    expect(result.issues).toEqual([]);
    expect(amount(result.amounts, "raw-mozz")?.sales_oz).toBe(2); // 2 selections * .5 item * 2 oz/item
    expect(amount(result.amounts, "roll")?.sales_oz).toBe(24);
  });
});

describe("ezCater multi-effect depletion", () => {
  const gf = map("gf", [
    effect({ targetKind: "sku", targetId: "gf-roll", portionQty: 1, portionUnit: "each" }),
    effect({ targetKind: "sku", targetId: "roll", disposition: "remove", portionQty: 99, portionUnit: "each", parentOnly: true }),
  ]);

  it("applies a GF roll SKU and removes only the parent recipe's roll", () => {
    const result = run({ quantity: 3, options: [option("gf", 2)], maps: [gf] });
    expect(result.issues).toEqual([]);
    expect(amount(result.amounts, "gf-roll")?.sales_oz).toBe(10);
    expect(amount(result.amounts, "roll")).toMatchObject({ sales_oz: 6, suppressed_oz: 0, shadow_oz: 6 });
  });

  it("a parent_only bread removal removes zero from a breadless parent", () => {
    const result = run({ target: { item_id: null, menu_item_id: "breadless" }, options: [option("gf")], maps: [gf] });
    expect(result.issues).toEqual([]);
    expect(amount(result.amounts, "gf-roll")?.sales_oz).toBe(5);
    expect(amount(result.amounts, "roll")).toBeUndefined();
  });

  it("applies mozzarella and lettuce-bed item portions through the recipe graph", () => {
    const result = run({ options: [option("mozz", 2), option("lettuce", 1)], maps: [
      map("mozz", [effect({ targetId: "mozz", portionQty: 0.5 })]),
      map("lettuce", [
        effect({ targetKind: "sku", targetId: "roll", disposition: "remove", parentOnly: true, portionQty: 1 }),
        effect({ targetId: "iceberg", portionQty: 0.25 }),
      ]),
    ] });
    expect(result.issues).toEqual([]);
    expect(amount(result.amounts, "raw-mozz")?.sales_oz).toBe(2);
    expect(amount(result.amounts, "raw-iceberg")?.sales_oz).toBe(0.75);
    expect(amount(result.amounts, "roll")).toMatchObject({ sales_oz: 0, suppressed_oz: 0, shadow_oz: 0 });
  });

  it("refuses a SKU each portion whose weight is unknown", () => {
    const result = run({ options: [option("unknown")], maps: [map("unknown", [
      effect({ targetKind: "sku", targetId: "unknown-sku", portionQty: 1, portionUnit: "each" }),
    ])] });
    expect(result).toEqual({ amounts: [], issues: [{ code: "customization_portion_needed", identity_key: "unknown" }] });
  });
});

describe("ezCater package Sub picks", () => {
  const packages = (depletion: number): PackageComposition => ({
    lines: [
      { id: "first", package_id: "pkg", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 2, depletion_qty: depletion, display_order: 1 },
      { id: "second", package_id: "pkg", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 1, depletion_qty: 1, display_order: 2 },
    ],
    options: [
      { package_item_id: "first", item_id: null, menu_item_id: "a", classic: true },
      { package_item_id: "first", item_id: null, menu_item_id: "b", classic: false },
      { package_item_id: "second", item_id: null, menu_item_id: "a", classic: true },
      { package_item_id: "second", item_id: null, menu_item_id: "c", classic: false },
    ],
  });
  const picks = [{ id: "pick", menuItemId: "a", qty: 1 }];

  it.each([[0.5, 0.5], [1, 1]])("uses depletion_qty %s for Light/Full Lunch picks", (depletion, expected) => {
    const context = packages(depletion);
    context.lines[0]!.quantity = 1;
    const result = packageTargets(context, "pkg", 1, picks);
    expect(result.targets[0]).toEqual({ item_id: null, menu_item_id: "a", units: expected });
  });

  it("binds an overlapping pick to the first eligible slot and evenly mixes the remainder", () => {
    const result = packageTargets(packages(2), "pkg", 1, picks);
    expect(result.issues).toEqual([]);
    expect(result.targets).toEqual([
      { item_id: null, menu_item_id: "a", units: 1 },
      { package_item_id: "first", item_id: null, menu_item_id: "a", classic: true, units: 0.5 },
      { package_item_id: "first", item_id: null, menu_item_id: "b", classic: false, units: 0.5 },
      { package_item_id: "second", item_id: null, menu_item_id: "a", classic: true, units: 0.5 },
      { package_item_id: "second", item_id: null, menu_item_id: "c", classic: false, units: 0.5 },
    ]);
  });

  it("caps excess picks, reports the excess, and refuses an unbound pick", () => {
    const excess = packageTargets(packages(0.5), "pkg", 1, [{ id: "pick", menuItemId: "a", qty: 4 }]);
    expect(excess.targets[0]).toEqual({ item_id: null, menu_item_id: "a", units: 0.5 });
    expect(excess.issues).toEqual([{ code: "customization_pick_excess", identity_key: "first" }]);
    expect(packageTargets(packages(1), "pkg", 1, [{ id: "pick", menuItemId: "missing", qty: 1 }]))
      .toEqual({ targets: [], issues: [{ code: "customization_pick_unbound", identity_key: "pkg" }] });
  });
});

describe("shadow evidence parity", () => {
  it("suppresses produced prep on D-1 at the transferred old shop while leaving direct bread live", () => {
    const result = run({
      quantity: 2,
      productions: [{ location_id: "old-shop", output_item_id: "filling", produced_at: "2026-10-07T13:00:00Z" }],
      transfers: [{ occurred_at: "2026-10-07T12:00:00Z", metadata: { from_location_id: "old-shop", to_location_id: "shop-a" } }],
    });
    expect(amount(result.amounts, "raw-filling")).toMatchObject({ sales_oz: 8, suppressed_oz: 8, shadow_oz: 0 });
    expect(amount(result.amounts, "roll")).toMatchObject({ sales_oz: 12, suppressed_oz: 0, shadow_oz: 12 });
  });
});

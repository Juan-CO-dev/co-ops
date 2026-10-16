/**
 * Catalog Phase 3b — chunk-2 review (Astra P2 #3, P3 #4): the recipe page's LINE reads are bounded.
 *   lineNames  — every id set is id-CHUNKED (the request-line budget) and PAGED (the 1,000-row cap), the
 *                2a/3a loader pattern: past 1,000 rows every name still resolves and no `.in()` list exceeds a chunk.
 *   judgeLines — a copied set (adopt / promote / restore) is validated from ONE products read and ONE measures
 *                read (chunked), never two reads per product line; the validation ORDER and the named per-line
 *                refusal are exactly what assertInputLineIsValid would say for the first invalid line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { judgeLines, lineNames } from "@/lib/catalog/recipe-item";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("tests pass the client directly"); } }));

type Row = Record<string, unknown>;
let db: ReturnType<typeof createFakeDb> | null = null;
afterEach(() => { db = null; });

/** The fake db with every `.in()` list length recorded (the request-line budget is spent per id). */
function install(tables: Record<string, Row[]>): { inSizes: number[] } {
  db = createFakeDb(tables);
  const inSizes: number[] = [];
  const client = db.client as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> };
  const from = client.from.bind(client);
  client.from = (t: string) => {
    const q = from(t);
    const inner = q.in!.bind(q);
    q.in = (col: unknown, vs: unknown) => { inSizes.push((vs as unknown[]).length); return inner(col, vs); };
    return q;
  };
  return { inSizes };
}

const id = (p: string, i: number) => `${p}-${String(i).padStart(5, "0")}`;
const sku = (s: string): RecipeLineFields => ({ componentSkuId: s, componentItemId: null, componentProductId: null, quantity: 1, unit: "case", eachContainerLabel: null, portioned: false });
const item = (s: string): RecipeLineFields => ({ componentSkuId: null, componentItemId: s, componentProductId: null, quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false });
const product = (s: string, unit: string | null = "oz", extra: Partial<RecipeLineFields> = {}): RecipeLineFields =>
  ({ componentSkuId: null, componentItemId: null, componentProductId: s, quantity: 1, unit, eachContainerLabel: null, portioned: false, ...extra });

describe("lineNames — id-chunked and paged (Astra chunk-2 P2)", () => {
  it("past 1,000 rows per kind every name resolves, and no .in() list is longer than one chunk", async () => {
    const N = 1_250;
    const tables: Record<string, Row[]> = {
      vendors: Array.from({ length: 150 }, (_, i) => ({ id: id("v", i), name: `Vendor ${i}` })),
      vendor_items: Array.from({ length: N }, (_, i) => ({ id: id("s", i), name: `Sku ${i}`, vendor_id: id("v", i % 150) })),
      items: Array.from({ length: N }, (_, i) => ({ id: id("i", i), name: `Item ${i}` })),
      products: Array.from({ length: N }, (_, i) => ({ id: id("p", i), name: `Product ${i}`, active: true })),
    };
    const { inSizes } = install(tables);
    const lines = Array.from({ length: N }, (_, i) => [sku(id("s", i)), item(id("i", i)), product(id("p", i))]).flat();
    const { names, vendorBySku } = await lineNames(db!.client, lines);
    expect(Object.keys(names)).toHaveLength(3 * N);
    expect(names[`sku:${id("s", N - 1)}`]).toBe(`Sku ${N - 1}`);
    expect(names[`item:${id("i", N - 1)}`]).toBe(`Item ${N - 1}`);
    expect(names[`product:${id("p", N - 1)}`]).toBe(`Product ${N - 1}`);
    expect(vendorBySku.size).toBe(N);
    expect(vendorBySku.get(id("s", N - 1))).toBe(`Vendor ${(N - 1) % 150}`);
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(100);
  });
  it("an empty set reads nothing", async () => {
    install({});
    expect(await lineNames(db!.client, [])).toEqual({ names: {}, vendorBySku: new Map() });
    expect(db!.log).toHaveLength(0);
  });
});

describe("judgeLines — the copied set is validated from batched reads (Astra chunk-2 P3)", () => {
  const measures = [{ label: "oz", active: true }, { label: "slice", active: true }, { label: "cup", active: false }];
  const productRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: id("p", i), name: `Product ${i}`, active: true }));

  it("a 200-line copied set: one products read per 100-id chunk plus ONE measures read — not two reads per line", async () => {
    install({ products: productRows(150), measure_units: measures });
    const after = Array.from({ length: 200 }, (_, i) => product(id("p", i % 150), i % 2 ? "oz" : "slice"));
    const added = new Set(after.map((_, i) => i + 1));
    expect(await judgeLines(db!.client, after, added, {})).toEqual([]);
    const reads = db!.log.map((l) => l.table);
    expect(reads.filter((t) => t === "products")).toHaveLength(2); // 150 distinct ids → 2 chunks
    expect(reads.filter((t) => t === "measure_units")).toHaveLength(1);
    expect(reads).toHaveLength(3);
  });

  it("the FIRST invalid line (by position) is refused, named, with the writer's own code — exactly as before", async () => {
    install({ products: [...productRows(5), { id: "p-off", name: "Off", active: false }], measure_units: measures });
    const after = [
      product(id("p", 0)),
      product("p-off"), // inactive product (not added: only flagged)
      product(id("p", 1), "cup"), // inactive measure — the first ADDED invalid line
      product("p-gone"), // no such product
      product(id("p", 2), "oz", { quantity: 0 }),
    ];
    const err = await judgeLines(db!.client, after, new Set([1, 3, 4, 5]), { [`product:${id("p", 1)}`]: "Product 1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecipeVersionError);
    expect(err).toMatchObject({ status: 400, code: "product_line_needs_measure_unit", line: { position: 3, name: "Product 1", reason: "product_line_needs_measure_unit" } });
  });

  it("each line keeps the writer's check order: shape before product, product before measure", async () => {
    install({ products: [{ id: "p-off", name: "Off", active: false }, { id: "p-on", name: "On", active: true }], measure_units: measures });
    const one = async (f: RecipeLineFields) => (await judgeLines(db!.client, [f], new Set([1]), {}).catch((e: unknown) => e)) as { code?: string };
    expect((await one(product("p-off", "cup", { quantity: 0 }))).code).toBe("invalid_quantity");
    expect((await one(product("p-off", "cup"))).code).toBe("invalid_component_product");
    expect((await one(product("p-gone", null))).code).toBe("invalid_component_product");
    expect((await one(product("p-on", null))).code).toBe("product_line_needs_measure_unit");
    expect(await one(product("p-on", "cup"))).toMatchObject({ code: "product_line_needs_measure_unit" }); // an inactive measure
    expect(await one(product("p-on", " slice "))).toEqual([]); // the writer trims the label (normStr)
  });

  it("carried lines are still only flagged, from the same reads", async () => {
    install({ products: [{ id: "p-off", name: "Off", active: false }, { id: "p-on", name: "On", active: true }], measure_units: measures });
    const flagged = await judgeLines(db!.client, [product("p-off"), product("p-on")], new Set([2]), { "product:p-off": "Off" });
    expect(flagged).toEqual([{ position: 1, name: "Off", reason: "invalid_component_product" }]);
    expect(db!.log.map((l) => l.table).sort()).toEqual(["measure_units", "products"]);
  });
});

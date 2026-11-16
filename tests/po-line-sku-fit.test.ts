/**
 * W08/B056 — a new PO line's SKU must fit the PO: it exists, is not a store item, belongs to the PO's
 * vendor, and is shared or this shop's own. Exercised on the real function body (transpiled), with a
 * stub client returning the given vendor_items rows; plus source pins for both draft writers.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolveActive } from "@/lib/location-sku-shared";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string): ts.FunctionDeclaration {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return fn;
}
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

type Row = { id: string; vendor_id: string | null; location_id: string | null; active?: boolean };
type Overlay = { location_id: string; sku_id: string; active_override: boolean | null };
function fit(rows: Row[], stores: string[] = ["store-v"], overlays: Overlay[] = []) {
  const js = ts.transpile(declaration("assertPoSkusFit").getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
  const fn = new Function("loadStoreVendorIds", "PurchaseOrderError", "resolveActive", `${js}; return assertPoSkusFit;`)(
    async () => new Set(stores), PurchaseOrderError, resolveActive,
  ) as (sb: unknown, expected: Map<string, string>, locationId: string) => Promise<void>;
  const calls: string[][] = [];
  const sb = { from: (table: string) => {
    let ids: string[] = [];
    if (table === "location_sku_settings") {
      let loc = "";
      const o = {
        select: (cols: string) => { expect(cols).toBe("sku_id, active_override"); return o; },
        eq: (c: string, v: string) => { expect(c).toBe("location_id"); loc = v; return o; },
        in: (c: string, v: string[]) => { expect(c).toBe("sku_id"); ids = v; return o; },
        returns: async () => ({ data: overlays.filter(x => x.location_id === loc && ids.includes(x.sku_id)), error: null }),
      };
      return o;
    }
    expect(table).toBe("vendor_items");
    const q = {
      select: (cols: string) => { expect(cols).toBe("id, vendor_id, location_id, active"); return q; },
      in: (_c: string, v: string[]) => { ids = v; calls.push(v); return q; },
      returns: async () => ({ data: rows.filter(r => ids.includes(r.id)).map(r => ({ active: true, ...r })), error: null }),
    };
    return q;
  } };
  return { run: (expected: Map<string, string>, loc = "shop") => fn(sb, expected, loc), calls };
}

describe("W08/B056 assertPoSkusFit", () => {
  it("refuses a SKU of another vendor", async () => {
    const f = fit([{ id: "s1", vendor_id: "V2", location_id: null }]);
    await expect(f.run(new Map([["s1", "V1"]]))).rejects.toMatchObject({ status: 400, code: "invalid_sku" });
  });

  it("refuses the other shop's private SKU", async () => {
    const f = fit([{ id: "s1", vendor_id: "V1", location_id: "other" }]);
    await expect(f.run(new Map([["s1", "V1"]]), "shop")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("refuses an id that does not exist", async () => {
    const f = fit([]);
    await expect(f.run(new Map([["ghost", "V1"]]))).rejects.toMatchObject({ status: 400, code: "invalid_sku" });
  });

  it("still refuses a store item (today's rule)", async () => {
    const f = fit([{ id: "s1", vendor_id: "store-v", location_id: null }]);
    await expect(f.run(new Map([["s1", "store-v"]]))).rejects.toMatchObject({ status: 400, code: "invalid_sku", message: "Store items cannot be ordered" });
  });

  it("accepts shared and own-shop SKUs of the PO's vendor, chunked by 100", async () => {
    const rows: Row[] = Array.from({ length: 150 }, (_, i) => ({ id: `s${i}`, vendor_id: "V1", location_id: i % 2 ? "shop" : null }));
    const f = fit(rows);
    await expect(f.run(new Map(rows.map(r => [r.id, "V1"])), "shop")).resolves.toBeUndefined();
    expect(f.calls.map(c => c.length)).toEqual([100, 50]);
  });

  it("refuses a globally inactive SKU, and one switched off at this shop", async () => {
    await expect(fit([{ id: "s1", vendor_id: "V1", location_id: null, active: false }]).run(new Map([["s1", "V1"]])))
      .rejects.toMatchObject({ status: 400, code: "invalid_sku" });
    await expect(fit([{ id: "s1", vendor_id: "V1", location_id: null }], undefined, [{ location_id: "shop", sku_id: "s1", active_override: false }])
      .run(new Map([["s1", "V1"]]), "shop")).rejects.toMatchObject({ status: 400, code: "invalid_sku" });
  });

  it("accepts a globally inactive SKU switched back on at this shop, but not on another shop's override", async () => {
    const off: Row = { id: "s1", vendor_id: "V1", location_id: null, active: false };
    await expect(fit([off], undefined, [{ location_id: "shop", sku_id: "s1", active_override: true }])
      .run(new Map([["s1", "V1"]]), "shop")).resolves.toBeUndefined();
    await expect(fit([off], undefined, [{ location_id: "other", sku_id: "s1", active_override: true }])
      .run(new Map([["s1", "V1"]]), "shop")).rejects.toMatchObject({ status: 400, code: "invalid_sku" });
  });

  it("an empty set reads nothing", async () => {
    const f = fit([]);
    await expect(f.run(new Map())).resolves.toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });
});

describe("W08/B056 both draft writers call it", () => {
  it("createDraftsFromLines checks every line against its vendor before any PO insert", () => {
    const body = declaration("createDraftsFromLines").body!.getText(ast);
    const at = body.indexOf("await assertPoSkusFit(sb, expectedVendorBySku, locationId)");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(body.indexOf('.from("purchase_orders").insert('));
  });

  it("updateDraftLines checks new lines and positive-qty updates, inside the lap, before any write", () => {
    const body = declaration("updateDraftLines").body!.getText(ast);
    expect(body).toContain('.select("id, location_id, vendor_id, status")');
    const lap = body.slice(body.indexOf("for (let lap = 0"));
    expect(lap).toContain("const mustFit = [...toInsert, ...toUpdate.filter((l) => l.orderQty > 0)];");
    const check = lap.indexOf("await assertPoSkusFit(sb, new Map(mustFit.map(");
    expect(check).toBeGreaterThan(lap.indexOf("partitionDraftLines(lines, existingSkus)"));
    expect(check).toBeLessThan(lap.indexOf('.from("po_lines")\n        .update('));
    expect(check).toBeLessThan(lap.indexOf("insertNewDraftLines("));
    // The store check on every incoming id is kept.
    expect(body).toContain("await assertNoStoreSkus(sb, skuIds)");
  });
});

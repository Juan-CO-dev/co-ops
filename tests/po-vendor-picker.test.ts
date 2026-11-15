import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ownerVisible } from "@/lib/catalog/shop-owned-shared";
import { resolveActive } from "@/lib/location-sku-shared";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
const load = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "loadPoDetail");
if (!load || !ts.isFunctionDeclaration(load) || !load.body) throw new Error("Missing loadPoDetail");
const body = load.body.getText(ast);

describe("LRA-229: the PO's vendor SKU picker", () => {
  it("reads only the PO vendor's active catalog by name, then sorts it in memory by the live order guide (V3-A)", () => {
    const catalog = body.slice(body.indexOf("{ data: vendorSkuRows"), body.indexOf("const onPo"));
    expect(catalog).toContain('sb.from("vendor_items")');
    // W08/B056 r2: the global flag alone no longer decides — activity is resolved per shop below.
    expect(catalog).toContain('.eq("vendor_id", po.vendor_id)');
    expect(catalog).not.toContain('.eq("active", true)');
    expect(catalog).toContain('.order("name", { ascending: true })');
    expect(catalog).toContain('"id, name, item_number, pack_format, location_id, active"');
    expect(catalog).not.toContain("guide_position\"");
    expect(body).toContain("compareByGuide(");
  });

  it("on a DRAFT excludes every existing PO line including removed zero-quantity lines", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const exclude = (po: unknown, lineRows: unknown, vendorSkuRows: unknown, _ov: unknown, overrides = new Map<string, boolean | null>()) =>
      new Function("po", "lineRows", "vendorSkuRows", "ownerVisible", "resolveActive", "activeOverrideBySku", `${js}; return availableSkus;`)(
        po, lineRows, vendorSkuRows, ownerVisible, resolveActive, overrides);
    expect(exclude({ status: "draft" }, [{ sku_id: "present", order_qty: 2 }, { sku_id: "removed", order_qty: 0 }], [
      { id: "present", active: true }, { id: "new", active: true }, { id: "removed", active: true },
    ], ownerVisible)).toEqual([{ id: "new", active: true }]);
    expect(exclude({ status: "draft" }, null, null, ownerVisible)).toEqual([]);
  });

  it("LRA-230: past draft (the add-on picker) offers every active SKU, including ones already on the order", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const exclude = (po: unknown, lineRows: unknown, vendorSkuRows: unknown, _ov: unknown, overrides = new Map<string, boolean | null>()) =>
      new Function("po", "lineRows", "vendorSkuRows", "ownerVisible", "resolveActive", "activeOverrideBySku", `${js}; return availableSkus;`)(
        po, lineRows, vendorSkuRows, ownerVisible, resolveActive, overrides);
    for (const status of ["confirmed", "placed", "invoiced", "received", "reconciled"]) {
      expect(exclude({ status }, [{ sku_id: "present", order_qty: 2 }], [{ id: "present", active: true }, { id: "new", active: true }], ownerVisible)).toEqual([{ id: "present", active: true }, { id: "new", active: true }]);
    }
  });

  it("W08/B056: filters out SKUs owned by another shop (draft and add-on pickers alike)", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const exclude = (po: unknown, lineRows: unknown, vendorSkuRows: unknown, _ov: unknown, overrides = new Map<string, boolean | null>()) =>
      new Function("po", "lineRows", "vendorSkuRows", "ownerVisible", "resolveActive", "activeOverrideBySku", `${js}; return availableSkus;`)(
        po, lineRows, vendorSkuRows, ownerVisible, resolveActive, overrides);
    const rows = [{ id: "shared", location_id: null, active: true }, { id: "mine", location_id: "shop", active: true }, { id: "theirs", location_id: "other", active: true }];
    for (const status of ["draft", "placed"]) {
      expect(exclude({ status, location_id: "shop" }, [], rows, ownerVisible).map((r: { id: string }) => r.id)).toEqual(["shared", "mine"]);
    }
  });

  it("loads the picker without a draft-only guard and returns it in the detail", () => {
    const prefix = body.slice(0, body.indexOf("const onPo"));
    expect(prefix).not.toMatch(/if\s*\([^)]*po\.status/);
    expect(body).toMatch(/return\s*\{\s*poId: po.id,\s*vendorSkus,/);
  });

  describe("W08/B056 r2: the picker uses the writer's rule, resolveActive(shop active_override, sku.active)", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const pick = (rows: Array<{ id: string; active: boolean }>, overrides: Map<string, boolean | null>, status = "draft") =>
      (new Function("po", "lineRows", "vendorSkuRows", "ownerVisible", "resolveActive", "activeOverrideBySku", `${js}; return availableSkus;`)(
        { status, location_id: "shop" }, [], rows.map(r => ({ ...r, location_id: null })), ownerVisible, resolveActive, overrides,
      ) as Array<{ id: string }>).map(r => r.id);

    it.each(["draft", "placed"])("(%s) hides a globally active SKU switched OFF at this shop", (status) => {
      expect(pick([{ id: "on", active: true }, { id: "off_here", active: true }], new Map([["off_here", false]]), status)).toEqual(["on"]);
    });

    it.each(["draft", "placed"])("(%s) shows a globally inactive SKU switched back ON at this shop", (status) => {
      expect(pick([{ id: "promo", active: false }], new Map([["promo", true]]), status)).toEqual(["promo"]);
    });

    it.each(["draft", "placed"])("(%s) hides a globally inactive SKU with no override (a null override inherits)", (status) => {
      expect(pick([{ id: "gone", active: false }, { id: "gone_null", active: false }], new Map([["gone_null", null]]), status)).toEqual([]);
    });

    it("reads the overrides from THIS PO shop's location_sku_settings rows only", () => {
      const read = body.slice(body.indexOf("{ data: vendorSkuRows"), body.indexOf("const onPo"));
      expect(read).toContain('sb.from("location_sku_settings")');
      expect(read).toContain('.eq("location_id", po.location_id)');
      expect(read).toContain("activeOverrideBySku");
    });
  });

});

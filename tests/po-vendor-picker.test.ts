import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ownerVisible } from "@/lib/catalog/shop-owned-shared";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
const load = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "loadPoDetail");
if (!load || !ts.isFunctionDeclaration(load) || !load.body) throw new Error("Missing loadPoDetail");
const body = load.body.getText(ast);

describe("LRA-229: the PO's vendor SKU picker", () => {
  it("reads only the PO vendor's active catalog by name, then sorts it in memory by the live order guide (V3-A)", () => {
    const catalog = body.slice(body.indexOf("const { data: vendorSkuRows"), body.indexOf("const onPo"));
    expect(catalog).toContain('sb.from("vendor_items")');
    expect(catalog).toContain('.eq("vendor_id", po.vendor_id).eq("active", true)');
    expect(catalog).toContain('.order("name", { ascending: true })');
    expect(catalog).toContain('"id, name, item_number, pack_format, location_id"');
    expect(catalog).not.toContain("guide_position\"");
    expect(body).toContain("compareByGuide(");
  });

  it("on a DRAFT excludes every existing PO line including removed zero-quantity lines", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const exclude = new Function("po", "lineRows", "vendorSkuRows", "ownerVisible", `${js}; return availableSkus;`);
    expect(exclude({ status: "draft" }, [{ sku_id: "present", order_qty: 2 }, { sku_id: "removed", order_qty: 0 }], [
      { id: "present" }, { id: "new" }, { id: "removed" },
    ], ownerVisible)).toEqual([{ id: "new" }]);
    expect(exclude({ status: "draft" }, null, null, ownerVisible)).toEqual([]);
  });

  it("LRA-230: past draft (the add-on picker) offers every active SKU, including ones already on the order", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const exclude = new Function("po", "lineRows", "vendorSkuRows", "ownerVisible", `${js}; return availableSkus;`);
    for (const status of ["confirmed", "placed", "invoiced", "received", "reconciled"]) {
      expect(exclude({ status }, [{ sku_id: "present", order_qty: 2 }], [{ id: "present" }, { id: "new" }], ownerVisible)).toEqual([{ id: "present" }, { id: "new" }]);
    }
  });

  it("W08/B056: filters out SKUs owned by another shop (draft and add-on pickers alike)", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const exclude = new Function("po", "lineRows", "vendorSkuRows", "ownerVisible", `${js}; return availableSkus;`);
    const rows = [{ id: "shared", location_id: null }, { id: "mine", location_id: "shop" }, { id: "theirs", location_id: "other" }];
    for (const status of ["draft", "placed"]) {
      expect(exclude({ status, location_id: "shop" }, [], rows, ownerVisible).map((r: { id: string }) => r.id)).toEqual(["shared", "mine"]);
    }
  });

  it("loads the picker without a draft-only guard and returns it in the detail", () => {
    const prefix = body.slice(0, body.indexOf("const onPo"));
    expect(prefix).not.toMatch(/if\s*\([^)]*po\.status/);
    expect(body).toMatch(/return\s*\{\s*poId: po.id,\s*vendorSkus,/);
  });
});

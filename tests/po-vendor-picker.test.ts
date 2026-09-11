import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
const load = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "loadPoDetail");
if (!load || !ts.isFunctionDeclaration(load) || !load.body) throw new Error("Missing loadPoDetail");
const body = load.body.getText(ast);

describe("LRA-229: the PO's vendor SKU picker", () => {
  it("reads only the PO vendor's active catalog in guide/name order, with null positions last", () => {
    const catalog = body.slice(body.indexOf("const { data: vendorSkuRows"), body.indexOf("const onPo"));
    expect(catalog).toContain('sb.from("vendor_items")');
    expect(catalog).toContain('.eq("vendor_id", po.vendor_id).eq("active", true)');
    expect(catalog).toContain('.order("guide_position", { ascending: true, nullsFirst: false }).order("name", { ascending: true })');
    expect(catalog).toContain('"id, name, item_number, pack_format, guide_position"');
  });

  it("excludes every existing PO line including removed zero-quantity lines", () => {
    const start = body.indexOf("const onPo");
    const end = body.indexOf("const chains", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const js = ts.transpile(body.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const exclude = new Function("lineRows", "vendorSkuRows", `${js}; return availableSkus;`);
    expect(exclude([{ sku_id: "present", order_qty: 2 }, { sku_id: "removed", order_qty: 0 }], [
      { id: "present" }, { id: "new" }, { id: "removed" },
    ])).toEqual([{ id: "new" }]);
    expect(exclude(null, null)).toEqual([]);
  });

  it("loads the picker without a draft-only guard and returns it in the detail", () => {
    const prefix = body.slice(0, body.indexOf("const onPo"));
    expect(prefix).not.toMatch(/if\s*\([^)]*po\.status/);
    expect(body).toMatch(/return\s*\{\s*poId: po.id,\s*vendorSkus,/);
  });
});

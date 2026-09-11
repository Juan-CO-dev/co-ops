import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return fn;
}
const body = declaration("createAddOnOrder").body!.getText(ast);
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message); }
}
function setup(status = "placed", bound = true) {
  const create = vi.fn().mockResolvedValue([{ poId: "child", vendorId: "vendor", displayCode: "CODE-2" }]);
  const requireLevel = vi.fn();
  const parent = Object.freeze({ id: "parent", location_id: "shop", vendor_id: "vendor", status });
  const sb = { from: () => {
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: parent, error: null }),
    };
    return query;
  } };
  const deps = { PurchaseOrderError, PO_MIN: 4, requireLevel, getServiceRoleClient: () => sb, lockLocationContext: () => bound, actorLoc: () => ({}), createDraftsFromLines: create };
  const js = ts.transpile(declaration("createAddOnOrder").getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
  const addOn = new Function(...Object.keys(deps), `${js}; return createAddOnOrder;`)(...Object.values(deps));
  const actor = { user: { id: "kh", role: "key_holder" } };
  return { create, requireLevel, parent, actor, run: (lines: unknown = [{ skuId: "sku", orderQty: 1 }]) => addOn(actor, "parent", lines) };
}

describe("LRA-229: a placed PO's separate add-on draft", () => {
  it.each(["placed", "invoiced", "received", "reconciled"])("accepts %s at KH floor and deliberately requests a suffixed draft", async status => {
    const f = setup(status);
    const lines = [{ skuId: "sku", orderQty: 1.5, note: "Extra", orderUnitLabel: "case" }];
    expect(await f.run(lines)).toEqual({ poId: "child", vendorId: "vendor", displayCode: "CODE-2" });
    expect(f.requireLevel).toHaveBeenCalledWith(f.actor, 4);
    expect(f.create).toHaveBeenCalledWith(f.actor, "shop", new Map([["vendor", lines]]), null, {
      noCodeSuffixRetry: false, source: "add_on", parentPoId: "parent",
    });
    expect(f.parent.status).toBe(status);
  });

  it.each(["draft", "confirmed"])("refuses an unplaced %s parent", async status => {
    const f = setup(status);
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "not_placed" });
    expect(f.create).not.toHaveBeenCalled();
  });

  it("refuses another shop's parent", async () => {
    const f = setup("placed", false);
    await expect(f.run()).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "1", null])("rejects quantity %s before draft creation", async orderQty => {
    const f = setup();
    await expect(f.run([{ skuId: "sku", orderQty }])).rejects.toMatchObject({ status: 400, code: "invalid_qty" });
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each([
    { lines: [], code: "no_lines" },
    { lines: null, code: "no_lines" },
    { lines: [null], code: "invalid_sku" },
    { lines: [{ skuId: "", orderQty: 1 }], code: "invalid_sku" },
    { lines: [{ skuId: "sku", orderQty: 1 }, { skuId: "sku", orderQty: 2 }], code: "duplicate_sku" },
    { lines: [{ skuId: "sku", orderQty: 1, note: {} }], code: "invalid_payload" },
    { lines: [{ skuId: "sku", orderQty: 1, orderUnitLabel: {} }], code: "invalid_payload" },
  ])("rejects malformed lines with $code", async ({ lines, code }) => {
    const f = setup();
    await expect(f.run(lines)).rejects.toMatchObject({ status: 400, code });
    expect(f.create).not.toHaveBeenCalled();
  });

  it("pins status/positive-quantity guards and has no parent update", () => {
    expect(body).toContain('["placed", "invoiced", "received", "reconciled"].includes(parent.status)');
    expect(body).toContain("!Number.isFinite(l.orderQty) || l.orderQty <= 0");
    expect(body).toContain('{ noCodeSuffixRetry: false, source: "add_on", parentPoId: poId }');
    expect(body).not.toContain(".update(");
    expect(body).not.toContain(".delete(");
  });

  it("adds parent linkage to the existing draft-created audit without changing normal sources", () => {
    const createBody = declaration("createDraftsFromLines").body!.getText(ast);
    expect(createBody.match(/action: "po.draft_created"/g)).toHaveLength(1);
    expect(createBody).toContain('source: opts?.source ?? (parPassEventId ? "par_pass" : "cutoff_draft")');
    expect(createBody).toContain("parent_po_id: opts.parentPoId");
    const metadata = createBody.match(/metadata: (\{\s*po_ids:[\s\S]*?\n    \}),/);
    expect(metadata).not.toBeNull();
    const evaluate = new Function("opts", "parPassEventId", "created", "locationId", `return (${metadata![1]});`);
    const created = [{ poId: "child" }];
    expect(evaluate({ source: "add_on", parentPoId: "parent" }, null, created, "shop")).toEqual({
      po_ids: ["child"], location_id: "shop", source: "add_on", parent_po_id: "parent", par_pass_event_id: null,
    });
    expect(evaluate(undefined, "walk", created, "shop")).toEqual({
      po_ids: ["child"], location_id: "shop", source: "par_pass", par_pass_event_id: "walk",
    });
    expect(evaluate(undefined, null, created, "shop")).toEqual({
      po_ids: ["child"], location_id: "shop", source: "cutoff_draft", par_pass_event_id: null,
    });
  });

  it("maps add_on to the new PO id/code with a 201 response", () => {
    const route = readFileSync("app/api/operations/ordering/po/route.ts", "utf8");
    expect(route).toMatch(/case "add_on":\s*\{[\s\S]*?await createAddOnOrder\(ctx, b.poId, b.lines as DraftLineEdit\[\]\);\s*return jsonOk\(\{ poId: created.poId, displayCode: created.displayCode \}, 201\)/);
  });
});

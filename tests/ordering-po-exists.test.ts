import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { etCalendarDate, operationalDayUtcRange } from "@/lib/operational-day";

const source = readFileSync("lib/ordering.ts", "utf8");
const ast = ts.createSourceFile("ordering.ts", source, ts.ScriptTarget.Latest, true);
function body(name: string) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return fn.body.getText(ast);
}

// Execute the actual function bodies with synthetic I/O. No server module or DB access.
function execute(name: string, dependencies: Record<string, unknown>) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  const js = ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(dependencies), `${js}; return ${name};`)(...Object.values(dependencies));
}
class OrderingError extends Error {
  constructor(public status: number, public code: string, message?: string, public existingPoId?: string) { super(message); }
}
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string, public displayCode?: string) { super(message); }
}
function setup() {
  const writes: { table: string; data: unknown }[] = [];
  const filters: [string, unknown][] = [];
  const skus = ["a", "b", "c"].map(id => ({ id, vendor_id: id, active: true, weekday_par: 4, name: id, product_id: null }));
  const sb = { from: (table: string) => {
    const query = {
      select: () => query,
      in: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      insert: (data: unknown) => { writes.push({ table, data }); return query; },
      returns: async () => ({ data: skus, error: null }),
      maybeSingle: async () => ({ data: { id: table === "purchase_orders" ? "existing-race" : "walk" }, error: null }),
    };
    return query;
  } };
  const guard = vi.fn<(sb: unknown, location: string, vendor: string) => Promise<void>>().mockResolvedValue(undefined);
  const create = vi.fn(async (_actor: unknown, _loc: string, vendors: Map<string, unknown>) =>
    [...vendors.keys()].map(vendorId => ({ vendorId, poId: `po-${vendorId}`, displayCode: vendorId })));
  const audit = vi.fn();
  const log = vi.fn();
  const deps = {
    OrderingError, PurchaseOrderError, PAR_PASS_MIN: 4, WALKER_SKU_COLUMNS: "id",
    requireLevel: vi.fn(), lockLocationContext: () => true, actorLoc: () => ({}),
    getServiceRoleClient: () => sb, etWalkDay: () => ({ weekend: false }),
    loadSkuPackChains: async () => new Map(), loadMeasures: async () => new Map(), loadOverlayBySku: async () => new Map(),
    resolveActive: () => true, num: Number, resolvePar: () => 4,
    perOrderUnitOz: () => 1, orderUnitLabelFor: () => "case",
    assertNoLivePoToday: guard, createDraftsFromLines: create, audit,
    buildDraftOrders: async (_sb: unknown, entries: { vendorId: string }[]) => entries.map(e => ({ vendorId: e.vendorId, vendorName: `Vendor ${e.vendorId}` })),
    loadOnHandDerived: async () => [], advisoryOnHandBySku: () => new Map(),
    console: { error: log },
  };
  const submit = execute("submitParPass", deps) as typeof import("@/lib/ordering").submitParPass;
  const run = () => submit({ user: { id: "kh", role: "key_holder" } } as Parameters<typeof submit>[0], "shop", skus.map(s => ({ skuId: s.id, orderQty: 2 })));
  return { writes, filters, guard, create, audit, run, log };
}

describe("LRA-206: a PO conflict never refuses the walk", () => {
  it("excludes a pre-existing vendor before PO writes, reports it, and persists every observation", async () => {
    const f = setup();
    f.guard.mockImplementation(async (_sb, _loc, vendor) => {
      if (vendor === "b") throw new OrderingError(409, "po_exists", "exists", "existing-b");
    });
    const result = await f.run();
    expect(f.create.mock.calls.map(c => [...c[2].keys()])).toEqual([["a"], ["c"]]);
    expect(result.poSkipped).toEqual([{ vendorId: "b", vendorName: "Vendor b", reason: "po_exists", existingPoId: "existing-b" }]);
    expect(result.poError).toBe(false);
    expect(result.pos.map(p => p.vendorId)).toEqual(["a", "c"]);
    expect(result.draftOrders.map(p => p.vendorId)).toEqual(["a", "c"]);
    expect(f.writes.map(w => w.table)).toEqual(["par_pass_events", "par_pass_lines"]);
    expect(f.writes[1]!.data).toEqual(expect.arrayContaining([expect.objectContaining({ sku_id: "b", order_qty: 2 })]));
    expect(f.writes[1]!.data).toHaveLength(3);
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "par_pass.submitted" }));
  });

  it("reports a middle vendor's race winner and continues creating the remaining vendor", async () => {
    const f = setup();
    f.create.mockImplementation(async (_actor, _loc, vendors) => {
      const vendorId = [...vendors.keys()][0]!;
      if (vendorId === "b") throw new PurchaseOrderError(409, "po_exists", "race", "SHOP-DATE-B");
      return [{ vendorId, poId: vendorId, displayCode: vendorId }];
    });
    const result = await f.run();
    expect(result.poSkipped).toEqual([{ vendorId: "b", vendorName: "Vendor b", reason: "po_exists", existingPoId: "existing-race" }]);
    expect(result.pos.map(p => p.vendorId)).toEqual(["a", "c"]);
    expect(result.poError).toBe(false);
    expect(f.filters).toContainEqual(["display_code", "SHOP-DATE-B"]);
    expect(f.writes[1]!.data).toHaveLength(3);
  });

  it("saves an all-skipped walk without attempting any PO writes", async () => {
    const f = setup();
    f.guard.mockImplementation(async (_sb, _loc, vendor) => { throw new OrderingError(409, "po_exists", "exists", `existing-${vendor}`); });
    const result = await f.run();
    expect(result.poSkipped).toHaveLength(3);
    expect(result.pos).toEqual([]);
    expect(result.poError).toBe(false);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.writes[1]!.data).toHaveLength(3);
  });

  it.each(["pre-check", "creation", "unresolved-conflict"])("contains %s failures with poError and saved observations", async phase => {
    const f = setup();
    if (phase === "pre-check") f.guard.mockRejectedValue(new Error("lookup failed"));
    else f.create.mockRejectedValueOnce(phase === "creation" ? new Error("insert failed") : new PurchaseOrderError(409, "po_exists"));
    const result = await f.run();
    expect(result.poError).toBe(true);
    expect(result.pos).toEqual([]);
    expect(f.writes[1]!.data).toHaveLength(3);
    expect(f.log).toHaveBeenCalled();
  });

  it("keeps single-vendor cutoff generation's early 409", async () => {
    const loadWalkerData = vi.fn();
    const generate = execute("generateDraftForVendor", {
      OrderingError, PurchaseOrderError, PAR_PASS_MIN: 4, requireLevel: vi.fn(),
      lockLocationContext: () => true, actorLoc: () => ({}), getServiceRoleClient: () => ({}),
      assertNoLivePoToday: async () => { throw new OrderingError(409, "po_exists"); }, loadWalkerData,
    });
    await expect(generate({}, "shop", "vendor")).rejects.toMatchObject({ status: 409, code: "po_exists" });
    expect(loadWalkerData).not.toHaveBeenCalled();
  });

  it("keeps single-vendor cutoff generation's race 409", async () => {
    const generate = execute("generateDraftForVendor", {
      OrderingError, PurchaseOrderError, PAR_PASS_MIN: 4, requireLevel: vi.fn(),
      lockLocationContext: () => true, actorLoc: () => ({}), getServiceRoleClient: () => ({}),
      assertNoLivePoToday: async () => {},
      loadWalkerData: async () => ({ vendors: [{ vendorId: "vendor", skus: [{ skuId: "a", suggestedQty: 2 }] }] }),
      createDraftsFromLines: async () => { throw new PurchaseOrderError(409, "po_exists", "race", "CODE"); },
    });
    await expect(generate({}, "shop", "vendor")).rejects.toMatchObject({ status: 409, code: "po_exists" });
  });

  it("keeps pos empty when a later non-conflict failure follows successful PO creation", async () => {
    const f = setup();
    f.create.mockImplementation(async (_actor, _loc, vendors) => {
      const vendorId = [...vendors.keys()][0]!;
      if (vendorId === "b") throw new Error("insert failed");
      return [{ vendorId, poId: vendorId, displayCode: vendorId }];
    });
    const result = await f.run();
    expect(result.poError).toBe(true);
    expect(result.pos).toEqual([]);
    expect(f.writes[1]!.data).toHaveLength(3);
  });

  it("keeps the live-status ET guard and both base-code conflict branches", () => {
    const guard = body("assertNoLivePoToday");
    expect(guard).toContain('.eq("location_id", locationId).eq("vendor_id", vendorId)');
    expect(guard).toContain('.in("status", ["draft", "confirmed"])');
    expect(guard).toContain('.gte("created_at", startIso).lt("created_at", endExclusiveIso)');
    const po = readFileSync("lib/purchase-orders.ts", "utf8");
    expect(po.match(/throw new PurchaseOrderError\(409, "po_exists"[^;]+/g)).toHaveLength(2);
    expect(po).toMatch(/throw new PurchaseOrderError\(409, "po_exists"[^;]+, base\)/);
    expect(po).toMatch(/throw new PurchaseOrderError\(409, "po_exists"[^;]+, code\)/);
    expect(body("generateDraftForVendor")).toContain("{ noCodeSuffixRetry: true }");
    expect(body("submitParPass")).toContain("{ noCodeSuffixRetry: true }");
  });

  // Existing helper retained: DST transition-day fixed-24h limitation is out of scope.
  it.each([
    ["2026-09-10", "2026-09-10T04:00:00.000Z", "2026-09-11T04:00:00.000Z"],
    ["2026-01-15", "2026-01-15T05:00:00.000Z", "2026-01-16T05:00:00.000Z"],
  ])("uses the ET day window for %s", (date, start, end) => {
    expect(operationalDayUtcRange(date)).toEqual({ startIso: start, endExclusiveIso: end });
    expect(etCalendarDate(new Date(Date.parse(end) - 1).toISOString())).toBe(date);
    expect(etCalendarDate(end)).not.toBe(date);
  });
});

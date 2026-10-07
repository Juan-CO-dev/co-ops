import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadStoreVendorIds } from "@/lib/ordering-sources";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("receiving sources stay out of ordering", () => {
  it("keeps store filtering at every ordering vendor entry point", () => {
    const sites = [
      ["lib/admin/vendors.ts", "loadVendors"],
      ["lib/admin/vendors.ts", "loadVendorOrderingWeek"],
      ["lib/admin/vendors.ts", "getVendor"],
      ["lib/admin/vendors.ts", "requireVendorRow"],
      ["lib/vendor-rhythm.ts", "requireVendorRow"],
      ["lib/vendor-import.ts", "loadVendor"],
      ["lib/order-guides.ts", "createEmptyGuide"],
      ["lib/ordering.ts", "loadWalkerData"],
      ["lib/ordering.ts", "buildDraftOrders"],
      ["lib/ordering.ts", "loadOrderingAttention"],
    ] as const;
    for (const [file, name] of sites) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
      expect(fn?.getText(ast), `${file}:${name}`).toContain('.eq("source_kind", "vendor")');
    }
    const walker = readFileSync("lib/ordering.ts", "utf8");
    // A store becoming the resolved costing member cannot become the ordering backup.
    expect(walker).toContain("m.vendorId != null && vendorById.has(m.vendorId)");
    expect(walker).not.toContain('.eq("inventory_only", false)');
  });

  it("loads every store, including inactive stores, without treating inventory-only vendors as stores", async () => {
    const rows = [
      { id: "supplies", source_kind: "vendor", active: true },
      ...Array.from({ length: 1001 }, (_, n) => ({ id: `store-${n}`, source_kind: "store", active: n !== 0 })),
    ];
    const ranges: number[] = [];
    const client = { from: () => {
      let filtered = rows;
      const q = {
        select: () => q,
        eq: (key: string, value: string) => { filtered = filtered.filter(row => row[key as "source_kind"] === value); return q; },
        order: () => q,
        range: async (from: number, to: number) => { ranges.push(from); return { data: filtered.slice(from, to + 1), error: null }; },
      };
      return q;
    } };
    vi.mocked(getServiceRoleClient).mockReturnValue(client as unknown as ReturnType<typeof getServiceRoleClient>);
    const stores = await loadStoreVendorIds();
    expect(stores.size).toBe(1001);
    expect(stores.has("store-0")).toBe(true);
    expect(stores.has("supplies")).toBe(false);
    expect(ranges).toEqual([0, 1000]);
  });

  it("refuses store SKUs smuggled onto an ordinary vendor draft", async () => {
    const source = readFileSync("lib/purchase-orders.ts", "utf8");
    const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "assertNoStoreSkus");
    if (!declaration) throw new Error("Missing draft source guard");
    class PurchaseOrderError extends Error {
      constructor(public status: number, public code: string, message: string) { super(message); }
    }
    const js = ts.transpile(declaration.getText(ast), { target: ts.ScriptTarget.ES2022 });
    const guard = new Function("loadStoreVendorIds", "PurchaseOrderError", `${js}; return assertNoStoreSkus;`)(
      async () => new Set(["store"]), PurchaseOrderError,
    ) as (sb: unknown, ids: string[]) => Promise<void>;
    const q = { select: () => q, in: () => q, returns: async () => ({ data: [{ id: "store-sku", vendor_id: "store" }], error: null }) };
    await expect(guard({ from: () => q }, ["store-sku"])).rejects.toMatchObject({ status: 400, code: "invalid_sku" });
    expect(source).toContain("await assertNoStoreSkus(sb, allSkuIds)");
    expect(source).toContain("await assertNoStoreSkus(sb, skuIds)");
  });
});

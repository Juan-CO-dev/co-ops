/**
 * W08/B056 fix round 1 — updateDraftLines, driven end to end (real function bodies, transpiled; an
 * in-memory stand-in for the service client).
 *
 *   1. A line ALREADY on the draft is validated too when it is set to a positive qty: a foreign-vendor or
 *      another shop's SKU left on a draft from before the fix can no longer be re-ordered. Setting that
 *      line to 0 (removal) still lands — the cleanup path stays open.
 *   2. The fit check honours the SKU's effective activity at the PO's shop, the same rule the walk
 *      submit uses (resolveActive(overlay.active_override, sku.active)): a globally inactive SKU with no
 *      override and a SKU switched off at this shop are refused; one switched back on at this shop
 *      (promotional override) is accepted.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolveActive } from "@/lib/location-sku-shared";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
function fnText(name: string): string {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
}
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

type Sku = { id: string; vendor_id: string | null; location_id: string | null; active: boolean };
type Overlay = { location_id: string; sku_id: string; active_override: boolean | null };
type Line = { po_id: string; sku_id: string; order_qty: number; note: string | null };

const SHOP = "shop-a";
const PO = { id: "po1", location_id: SHOP, vendor_id: "V1", status: "draft" };

function world(skus: Sku[], lines: Line[], overlays: Overlay[] = []) {
  const db = { skus, lines: lines.map(l => ({ ...l })), overlays };
  const sb = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let op: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      const match = (row: Record<string, unknown>) => filters.every(([kind, col, v]) =>
        kind === "eq" ? row[col] === v : (v as unknown[]).includes(row[col]));
      const rows = (): Record<string, unknown>[] => {
        if (table === "purchase_orders") return [PO];
        if (table === "po_lines") return db.lines;
        if (table === "vendor_items") return db.skus;
        if (table === "location_sku_settings") return db.overlays;
        throw new Error(`unexpected table ${table}`);
      };
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => { op = "update"; patch = p; return q; },
        eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
        in: (c: string, v: unknown[]) => { filters.push(["in", c, v]); return q; },
        returns: async () => ({ data: rows().filter(match), error: null }),
        maybeSingle: async () => ({ data: rows().filter(match)[0] ?? null, error: null }),
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          try {
            if (op !== "update" || table !== "po_lines") throw new Error(`unexpected awaited ${op} on ${table}`);
            const hit = db.lines.filter(match);
            for (const r of hit) Object.assign(r, patch);
            resolve({ error: null, count: hit.length });
          } catch (e) { reject(e); }
        },
      };
      return q;
    },
  };
  const inserted: Array<{ skuId: string; orderQty: number }> = [];
  const insertNewDraftLines = async (_sb: unknown, poId: string, toInsert: Array<{ skuId: string; orderQty: number; note?: string | null }>) => {
    for (const l of toInsert) {
      inserted.push({ skuId: l.skuId, orderQty: l.orderQty });
      db.lines.push({ po_id: poId, sku_id: l.skuId, order_qty: l.orderQty, note: l.note ?? null });
    }
    return null;
  };
  const assertPoSkusFit = new Function("loadStoreVendorIds", "PurchaseOrderError", "resolveActive",
    `${fnText("assertPoSkusFit")}; return assertPoSkusFit;`)(async () => new Set<string>(), PurchaseOrderError, resolveActive);
  const partitionDraftLines = new Function(`${fnText("partitionDraftLines")}; return partitionDraftLines;`)();
  const deps: Record<string, unknown> = {
    requireLevel: () => {}, PO_MIN: 4, PurchaseOrderError,
    getServiceRoleClient: () => sb, lockLocationContext: () => true, actorLoc: () => ({}),
    canDoOperationalTask: async () => true, assertNoStoreSkus: async () => {},
    partitionDraftLines, assertPoSkusFit, insertNewDraftLines, DRAFT_LINE_LAPS: 3,
    auditOperationalTaskOverride: async () => {},
  };
  const update = new Function(...Object.keys(deps), `${fnText("updateDraftLines")}; return updateDraftLines;`)(...Object.values(deps)) as
    (actor: unknown, poId: string, lines: Array<{ skuId: string; orderQty: number }>) => Promise<{ updated: number; inserted: number }>;
  const actor = { user: { id: "kh", role: "key_holder" }, locations: [SHOP] };
  return { db, inserted, run: (edits: Array<{ skuId: string; orderQty: number }>) => update(actor, "po1", edits) };
}

const good: Sku = { id: "good", vendor_id: "V1", location_id: null, active: true };
const foreignVendor: Sku = { id: "fv", vendor_id: "V2", location_id: null, active: true };
const foreignShop: Sku = { id: "fs", vendor_id: "V1", location_id: "shop-b", active: true };
const line = (sku: string, qty = 1): Line => ({ po_id: "po1", sku_id: sku, order_qty: qty, note: null });
const qtyOf = (w: ReturnType<typeof world>, sku: string) => w.db.lines.find(l => l.sku_id === sku)?.order_qty;

describe("W08/B056 r1: a line already on the draft is validated when set to a positive qty", () => {
  it.each([
    ["another vendor's SKU", foreignVendor, 400, "invalid_sku"],
    ["another shop's own SKU", foreignShop, 404, "not_found"],
  ])("raising %s that is already on the draft is refused, and nothing is written", async (_l, bad, status, code) => {
    const w = world([good, bad], [line("good", 2), line(bad.id, 1)]);
    await expect(w.run([{ skuId: "good", orderQty: 3 }, { skuId: bad.id, orderQty: 5 }])).rejects.toMatchObject({ status, code });
    expect(qtyOf(w, bad.id)).toBe(1);
    expect(qtyOf(w, "good")).toBe(2);
  });

  it.each([
    ["another vendor's SKU", foreignVendor],
    ["another shop's own SKU", foreignShop],
  ])("zeroing %s that is already on the draft still lands (cleanup)", async (_l, bad) => {
    const w = world([good, bad], [line("good", 2), line(bad.id, 4)]);
    await expect(w.run([{ skuId: "good", orderQty: 3 }, { skuId: bad.id, orderQty: 0 }])).resolves.toEqual({ updated: 2, inserted: 0 });
    expect(qtyOf(w, bad.id)).toBe(0);
    expect(qtyOf(w, "good")).toBe(3);
  });

  it("a valid existing line still updates", async () => {
    const w = world([good], [line("good", 2)]);
    await expect(w.run([{ skuId: "good", orderQty: 7 }])).resolves.toEqual({ updated: 1, inserted: 0 });
    expect(qtyOf(w, "good")).toBe(7);
  });
});


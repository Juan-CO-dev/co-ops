/**
 * W19/B111 — the PO display code uses the first 6 letters of the vendor name, so "Baldor" and "Baldor Specialty"
 * share a base code. Day idempotency (one draft per vendor per shop per ET day) must be decided by VENDOR, never by
 * the code: a same-prefix vendor's PO does not block (or absorb) another vendor's daily draft. Exercised on the real
 * createDraftsFromLines body (transpiled) over a small in-memory purchase_orders table with the display_code unique
 * index, plus a pin on submitParPass's race lookup.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
function fnText(name: string): string {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
}
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string, public displayCode?: string) { super(message ?? code); }
}

type Po = { id: string; display_code: string; vendor_id: string; status: string; location_id: string; created_at: string };
const BALDOR = "v-baldor";
const SPECIALTY = "v-baldor-specialty";
const BASE = "CH-20261114-BALDOR";

function setup(existing: Po[], opts: { raceWinner?: Po } = {}) {
  const pos: Po[] = [...existing];
  const inserted: string[] = [];
  let raced = false;
  const sb = { from: (table: string) => {
    const q: Record<string, unknown> & { _filters: [string, unknown][]; _insert?: Record<string, unknown>; _cols?: string } = { _filters: [] };
    const self = q as unknown as Record<string, (...a: unknown[]) => unknown>;
    q.select = (cols: string) => { q._cols = cols; return q; };
    q.eq = (c: string, v: unknown) => { q._filters.push([c, v]); return q; };
    q.in = () => q; q.gte = () => q; q.lt = () => q; q.order = () => q; q.limit = () => q;
    q.insert = (row: Record<string, unknown>) => { q._insert = row; return q; };
    const match = () => pos.filter(p => q._filters.every(([c, v]) => (p as Record<string, unknown>)[c] === v));
    q.returns = async () => {
      if (table === "vendors") return { data: [{ id: BALDOR, name: "Baldor" }, { id: SPECIALTY, name: "Baldor Specialty" }], error: null };
      if (table === "purchase_orders") return { data: match(), error: null };
      return { data: [], error: null };
    };
    q.maybeSingle = async () => {
      if (table === "locations") return { data: { id: "shop", code: "CH" }, error: null };
      if (table === "purchase_orders" && q._insert) {
        const row = q._insert as unknown as Po;
        // A rival committed the code between our scan and our insert (the 23505 race).
        if (opts.raceWinner && !raced && row.display_code === opts.raceWinner.display_code) { raced = true; pos.push(opts.raceWinner); }
        if (pos.some(p => p.display_code === row.display_code)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const id = `po-${pos.length + 1}`;
        pos.push({ ...row, id, created_at: "now" });
        inserted.push(row.display_code);
        return { data: { id }, error: null };
      }
      if (table === "purchase_orders") return { data: match()[0] ?? null, error: null };
      return { data: null, error: null };
    };
    // `await sb.from("po_lines").insert(...)` — the line insert is awaited directly.
    q.then = (resolve: (v: unknown) => void) => resolve({ error: null });
    return self;
  } };
  const nextFreeCode = new Function("PurchaseOrderError", `${fnText("nextFreeCode")}; return nextFreeCode;`)(PurchaseOrderError);
  const vendorCodeFragment = new Function(`${fnText("vendorCodeFragment")}; return vendorCodeFragment;`)();
  const baseDisplayCode = new Function("vendorCodeFragment", `${fnText("baseDisplayCode")}; return baseDisplayCode;`)(vendorCodeFragment);
  const deps: Record<string, unknown> = {
    PurchaseOrderError, requireLevel: () => {}, PO_MIN: 4, lockLocationContext: () => true, actorLoc: () => ({}),
    canDoOperationalTask: async () => true, getServiceRoleClient: () => sb, loadStoreVendorIds: async () => new Set(),
    etToday: () => ({ dateEt: "2026-11-14", dow: 6, compactYmd: "20261114" }),
    assertPoSkusFit: async () => {}, guideKeysFor: async () => new Map(),
    operationalDayUtcRange: () => ({ startIso: "a", endExclusiveIso: "b" }),
    baseDisplayCode, nextFreeCode, auditOperationalTaskOverride: vi.fn(async () => {}), audit: vi.fn(async () => {}),
  };
  const create = new Function(...Object.keys(deps), `${fnText("createDraftsFromLines")}; return createDraftsFromLines;`)(...Object.values(deps)) as
    (actor: unknown, loc: string, byVendor: Map<string, unknown[]>, ev: string | null, o?: { noCodeSuffixRetry?: boolean }) => Promise<Array<{ displayCode: string; vendorId: string }>>;
  const actor = { user: { id: "kh", role: "key_holder" } };
  const run = (vendorId: string, o = { noCodeSuffixRetry: true }) => create(actor, "shop", new Map([[vendorId, [{ skuId: `sku-${vendorId}`, orderQty: 2 }]]]), "walk", o);
  return { run, inserted, pos };
}
const po = (id: string, vendor: string, code: string, status = "draft"): Po => ({ id, vendor_id: vendor, display_code: code, status, location_id: "shop", created_at: "today" });

describe("W19/B111 day idempotency is per vendor, not per display code", () => {
  it("a same-prefix vendor's PO today does not block this vendor's draft: it gets <base>-2", async () => {
    const f = setup([po("p1", BALDOR, BASE)]);
    const created = await f.run(SPECIALTY);
    expect(created).toEqual([expect.objectContaining({ vendorId: SPECIALTY, displayCode: `${BASE}-2` })]);
  });

  it("this vendor's own PO today is still po_exists, naming its code", async () => {
    const f = setup([po("p1", BALDOR, BASE, "placed")]);
    await expect(f.run(BALDOR)).rejects.toMatchObject({ status: 409, code: "po_exists", displayCode: BASE });
    expect(f.inserted).toEqual([]);
  });

  it("this vendor's suffixed PO (base held by the other vendor) is found by vendor, not by the base code", async () => {
    const f = setup([po("p1", BALDOR, BASE), po("p2", SPECIALTY, `${BASE}-2`)]);
    await expect(f.run(SPECIALTY)).rejects.toMatchObject({ code: "po_exists", displayCode: `${BASE}-2` });
  });

  it("a 23505 whose winner is another vendor retries the next suffix", async () => {
    const f = setup([], { raceWinner: po("rival", BALDOR, BASE) });
    const created = await f.run(SPECIALTY);
    expect(created[0]?.displayCode).toBe(`${BASE}-2`);
  });

  it("a 23505 whose winner is the same vendor is po_exists (two concurrent walks meet on one code)", async () => {
    const f = setup([], { raceWinner: po("rival", SPECIALTY, BASE) });
    await expect(f.run(SPECIALTY)).rejects.toMatchObject({ code: "po_exists", displayCode: BASE });
  });

  it("an add-on (no day idempotency) still suffixes as before", async () => {
    const f = setup([po("p1", BALDOR, BASE, "placed")]);
    const created = await f.run(BALDOR, { noCodeSuffixRetry: false });
    expect(created[0]?.displayCode).toBe(`${BASE}-2`);
  });
});

describe("W19/B111 submitParPass's race lookup is bound to the vendor", () => {
  it("reads the po_exists winner by location, display code AND vendor", () => {
    const ordering = readFileSync("lib/ordering.ts", "utf8");
    const at = ordering.indexOf('err.code === "po_exists" && err.displayCode');
    expect(at).toBeGreaterThan(-1);
    const lookup = ordering.slice(at, ordering.indexOf(".maybeSingle", at));
    expect(lookup).toContain('.eq("display_code", err.displayCode)');
    expect(lookup).toContain('.eq("vendor_id", vendorId)');
  });
});

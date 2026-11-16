/**
 * W19/B109 + B110 — a change saved just as the order is confirmed is never silently left out of the confirmed order,
 * and a confirmed PO shows exactly what was confirmed. Exercised on the real function bodies (transpiled) of
 * confirmPO, updateDraftLines and loadPoDetail over a synthetic client; the SQL half (the trigger and the RPC) is
 * proven by scripts/sql-harness-0325.mjs.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { parseSnapshotLines } from "@/lib/po-snapshot-shared";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
function fnText(name: string): string {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
}
function exec<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnText(name)}; return ${name};`)(...Object.values(deps)) as T;
}
const helper = <T>(name: string, deps: Record<string, unknown> = {}) => {
  try { return exec<T>(name, deps); } catch { return undefined; }
};
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}
const confirmedDuringEdit = () => new PurchaseOrderError(409, "confirmed_during_edit");

type Result = { data?: unknown; error?: { code?: string; message: string } | null; count?: number };
/** A chainable fake: `respond(table, op, query)` answers every terminal (await / maybeSingle / returns). */
function fakeClient(respond: (table: string, op: string, q: { filters: [string, unknown][]; payload?: unknown; cols?: string }) => Result,
  rpc: (name: string, args: Record<string, unknown>) => Result = () => ({ error: null })) {
  const calls: Array<{ table: string; op: string; payload?: unknown; filters: [string, unknown][] }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const sb = {
    rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpc(name, args); },
    from: (table: string) => {
      const q: { filters: [string, unknown][]; payload?: unknown; cols?: string; op: string } = { filters: [], op: "select" };
      const chain: Record<string, unknown> = {};
      const answer = () => { calls.push({ table, op: q.op, payload: q.payload, filters: q.filters }); return respond(table, q.op, q); };
      for (const m of ["eq", "in", "is", "not", "gte", "lt", "or", "order", "limit"]) chain[m] = (c: string, v: unknown) => { q.filters.push([c, v]); return chain; };
      chain.select = (cols: string) => { if (q.op === "select") q.cols = cols; return chain; };
      chain.update = (p: unknown) => { q.op = "update"; q.payload = p; return chain; };
      chain.insert = (p: unknown) => { q.op = "insert"; q.payload = p; return chain; };
      chain.maybeSingle = async () => answer();
      chain.returns = async () => answer();
      chain.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(answer()).then(res, rej);
      return chain;
    },
  };
  return { sb, calls, rpcCalls };
}

const PO = { id: "po-1", location_id: "shop", vendor_id: "v1", display_code: "CH-1-BALDOR", status: "draft" };
const LINES = [{ id: "l1", sku_id: "s1", order_qty: "2", order_unit_label: "cs", guide_position_snapshot: 1, guide_section_snapshot: "Dairy" }];

function confirmSetup(rpcAnswer: Result) {
  const f = fakeClient((table, op) => {
    if (table === "purchase_orders" && op === "select") return { data: PO, error: null };
    if (table === "po_lines" && op === "select") return { data: LINES, error: null };
    if (table === "vendor_items") return { data: [{ id: "s1", name: "Eggs", item_number: "9" }], error: null };
    if (table === "vendors") return { data: { id: "v1", name: "Baldor" }, error: null };
    if (table === "users") return { data: { id: "kh", name: "K" }, error: null };
    return { data: null, error: null, count: 1 };
  }, () => rpcAnswer);
  const rpcMissing = helper("rpcMissing");
  const confirm = exec<(a: unknown, id: string) => Promise<void>>("confirmPO", {
    requireLevel: () => {}, PO_MIN: 4, getServiceRoleClient: () => f.sb, lockLocationContext: () => true, actorLoc: () => ({}),
    canDoOperationalTask: async () => true, PurchaseOrderError, guideKeysFor: async () => new Map(),
    resolveGuideKey: (s: unknown) => s, loadLatestPriceCentsBySku: async () => new Map([["s1", 450]]),
    etToday: () => ({ dateEt: "2026-11-15", dow: 0 }), resolveGoverningCutoffIso: async () => null,
    num: (v: number | string | null) => (v === null ? null : Number(v)), formatTime: () => "2:00 PM", rpcMissing,
    auditOperationalTaskOverride: vi.fn(async () => {}), audit: vi.fn(async () => {}), console: { error: vi.fn() },
  });
  return { run: () => confirm({ user: { id: "kh", role: "key_holder", language: "en" } }, "po-1"), ...f };
}

describe("W19/B109 confirmPO flips through confirm_purchase_order, bound to the lines it read", () => {
  it("sends the exact lines the snapshot was built from, and no bare status update", async () => {
    const f = confirmSetup({ error: null });
    await f.run();
    expect(f.rpcCalls).toHaveLength(1);
    expect(f.rpcCalls[0]!.name).toBe("confirm_purchase_order");
    expect(f.rpcCalls[0]!.args.p_expected_lines).toEqual([{ id: "l1", sku_id: "s1", order_qty: 2, order_unit_label: "cs" }]);
    expect((f.rpcCalls[0]!.args.p_snapshot as { lines: Array<{ qty: number }> }).lines[0]!.qty).toBe(2);
    expect(f.calls.some(c => c.table === "purchase_orders" && c.op === "update")).toBe(false);
  });

  it("a line changed since the read is 409 lines_changed (never a silent confirm without it)", async () => {
    const f = confirmSetup({ error: { code: "P0001", message: "lines_changed" } });
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "lines_changed" });
    expect(f.calls.some(c => c.table === "po_lines" && c.op === "update")).toBe(false);
  });

  it("a concurrent confirm is still 409 not_draft", async () => {
    const f = confirmSetup({ error: { code: "P0001", message: "not_draft" } });
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "not_draft" });
  });

  it("before 0325 (function missing) it falls back to the guarded UPDATE", async () => {
    const f = confirmSetup({ error: { code: "PGRST202", message: "Could not find the function public.confirm_purchase_order" } });
    await f.run();
    const flip = f.calls.find(c => c.table === "purchase_orders" && c.op === "update");
    expect(flip?.payload).toMatchObject({ status: "confirmed" });
    expect(flip?.filters).toContainEqual(["status", "draft"]);
  });
});

describe("W19/B109 updateDraftLines names the trigger's refusal", () => {
  function setup(updateError: Result["error"], insertError: Result["error"] = null) {
    const f = fakeClient((table, op) => {
      if (table === "purchase_orders") return { data: { ...PO, status: "draft" }, error: null };
      if (table === "po_lines" && op === "select") return { data: [{ sku_id: "s1" }], error: null };
      if (table === "po_lines" && op === "update") return { error: updateError, count: updateError ? 0 : 1 };
      return { data: null, error: null };
    });
    const update = exec<(a: unknown, id: string, lines: unknown[]) => Promise<unknown>>("updateDraftLines", {
      requireLevel: () => {}, PO_MIN: 4, PurchaseOrderError, getServiceRoleClient: () => f.sb, lockLocationContext: () => true,
      actorLoc: () => ({}), canDoOperationalTask: async () => true, assertNoStoreSkus: async () => {}, assertPoSkusFit: async () => {},
      partitionDraftLines: helper("partitionDraftLines"), DRAFT_LINE_LAPS: 3,
      insertNewDraftLines: async () => insertError, lineWriteRefusedNotDraft: helper("lineWriteRefusedNotDraft"),
      confirmedDuringEdit, auditOperationalTaskOverride: vi.fn(async () => {}),
    });
    return () => update({ user: { id: "kh", role: "key_holder" } }, "po-1", [{ skuId: "s1", orderQty: 5 }, { skuId: "s2", orderQty: 1 }]);
  }
  it("an UPDATE refused po_not_draft (the PO was confirmed first) is 409 confirmed_during_edit, not a 500", async () => {
    await expect(setup({ code: "P0001", message: "po_not_draft" })()).rejects.toMatchObject({ status: 409, code: "confirmed_during_edit" });
  });
  it("an INSERT refused po_not_draft is 409 confirmed_during_edit", async () => {
    await expect(setup(null, { code: "P0001", message: "po_not_draft" })()).rejects.toMatchObject({ status: 409, code: "confirmed_during_edit" });
  });
});

describe("W19/B110 a confirmed PO's lines come from confirmed_snapshot", () => {
  const snapshot = { lines: [{ skuId: "s1", name: "Ham", itemNumber: "77", qty: 2, unitLabel: "cs", priceCents: 1200, guidePos: 3, guideSection: "Deli" }] };
  function setup(status: string) {
    const f = fakeClient((table, op, q) => {
      if (table === "purchase_orders" && q.cols?.startsWith("email_send_uncertain_at")) return { data: { email_send_uncertain_at: null }, error: null };
      if (table === "purchase_orders") return { data: { ...PO, status, par_pass_event_id: null, confirmed_snapshot: status === "draft" ? null : snapshot, cutoff_at_confirm: null, created_at: "t0", confirmed_at: "t1", placed_at: null, placed_note: null, ack: null }, error: null };
      if (table === "po_lines") return { data: [{ sku_id: "s1", order_qty: "10", order_unit_label: "cs", price_cents_at_order: 1300, guide_position_snapshot: 3, guide_section_snapshot: "Deli", note: "back door" }], error: null };
      if (table === "vendor_items" && q.cols === "id, name, item_number") return { data: [{ id: "s1", name: "Ham v2", item_number: "78" }], error: null };
      if (table === "vendors") return { data: { id: "v1", name: "Baldor", transmission_tier: "manual", portal_url: null }, error: null };
      if (table === "locations") return { data: { receipt_email_address: null }, error: null };
      return { data: [], error: null };
    });
    const load = exec<(a: unknown, id: string) => Promise<{ lines: Array<{ orderQty: number; skuName: string; itemNumber: string | null; note: string | null; priceCentsAtOrder: number | null }> }>>("loadPoDetail", {
      requireLevel: () => {}, PO_MIN: 4, getServiceRoleClient: () => f.sb, lockLocationContext: () => true, actorLoc: () => ({}),
      PurchaseOrderError, ownerVisible: () => true, resolveActive: () => true, loadSkuPackChains: async () => new Map(),
      guideKeysFor: async () => new Map(), chainRootLabel: () => null, buildPackChain: () => [], compareByGuide: () => 0,
      emailOrderingAvailable: () => false, isPlausibleEmail: () => true, loadCreditsForDelivery: async () => [],
      parseAckInfo: () => null, truncateBody: (b: string | null) => b, num: (v: number | string | null) => (v === null ? null : Number(v)),
      poLineGuideKey: (i: { snapshot: unknown }) => i.snapshot, parseSnapshotLines, process: { env: {} },
    });
    return () => load({ user: { id: "kh", role: "key_holder" } }, "po-1");
  }
  it("confirmed: qty, name and item number are the snapshot's (what was confirmed and emailed); the note joins by SKU", async () => {
    const d = await setup("confirmed")();
    expect(d.lines).toEqual([expect.objectContaining({ orderQty: 2, skuName: "Ham", itemNumber: "77", priceCentsAtOrder: 1200, note: "back door" })]);
  });
  it("draft: still the live po_lines", async () => {
    const d = await setup("draft")();
    expect(d.lines).toEqual([expect.objectContaining({ orderQty: 10, skuName: "Ham v2" })]);
  });
});

describe("W19/B110 the one snapshot parser", () => {
  it("keeps qty-0 lines, drops malformed entries, a non-numeric qty is 0, a missing snapshot is []", () => {
    expect(parseSnapshotLines(null)).toEqual([]);
    expect(parseSnapshotLines({ lines: "x" })).toEqual([]);
    const out = parseSnapshotLines({ lines: [null, 3, { skuId: "a", name: "A", qty: 0 }, { skuId: "b", qty: "2" }] });
    expect(out.map(l => [l.skuId, l.qty, l.name])).toEqual([["a", 0, "A"], ["b", 0, "(sku)"]]);
  });
  it("po-email reads the snapshot through it", () => {
    const email = readFileSync("lib/po-email.ts", "utf8");
    expect(email).toContain("parseSnapshotLines(po.confirmed_snapshot)");
  });
});

describe("W19/B109 the panel reloads when the lines changed under a confirm", () => {
  it("PoPanel.confirm reloads on lines_changed, and the message exists in en + es", async () => {
    const panel = readFileSync("components/ordering/PoPanel.tsx", "utf8");
    expect(panel).toMatch(/res\.code === "lines_changed"/);
    const en = (await import("@/lib/i18n/en.json")).default as Record<string, string>;
    const es = (await import("@/lib/i18n/es.json")).default as Record<string, string>;
    expect(en["ordering.po.error.lines_changed"]).toBeTruthy();
    expect(es["ordering.po.error.lines_changed"]).toBeTruthy();
  });
});

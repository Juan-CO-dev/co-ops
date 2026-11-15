/**
 * W16 — the single-box and batch prep folds (lib/prep-consumption.ts) over the real recipe graph
 * (shop-versions fixture: Slaw = 24 oz lettuce + 8 oz mayo per quart).
 *   B183: the single-box fold reconciles the client's confirmed set against the SERVER's recipe.
 *   B090: both folds write through record_prep_production_atomic (0322) with the completion they came
 *         from; a stale completion writes and audits nothing. Before 0322 (missing function) the
 *         fallback applies the same liveness rule.
 *   B091: a single-box re-save never sends a client clock; the fallback keeps the prior header's
 *         produced_at (else the completion's completed_at). Batch rows send the session's time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC } from "./fixtures/shop-versions-fixture";
import { recordBatchProductionFromPrep, recordProductionFromPrep, type ConfirmedInput } from "@/lib/prep-consumption";

type Row = Record<string, unknown>;
let current: ReturnType<typeof createFakeDb> | null = null;
let rpcAnswer: { data: unknown; error: { code: string; message: string } | null };
const rpcCalls: Array<{ fn: string; args: Row }> = [];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return { from: current.client.from, rpc: async (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return rpcAnswer; } };
} }));
const audits = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/audit", () => ({ audit: async (row: Record<string, unknown>) => { audits.push(row); } }));

const actor = { userId: "u-kh", role: "key_holder" as const };
const base = { locationId: LOC, instanceId: "inst-1", templateItemId: "tpl-1", outputItemId: "i-slaw", source: "opening_p2" as const, completionId: "C2" };
const confirmed = (skuId: string, qtyOz: number, extra: Partial<ConfirmedInput> = {}): ConfirmedInput =>
  ({ skuId, qtyOz, qtyEntered: null, unitEntered: null, derivedOz: qtyOz, ...extra });
const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function public.record_prep_production_atomic" } };

let tables: ReturnType<typeof buildShopVersionsFixture>;
beforeEach(() => {
  tables = buildShopVersionsFixture();
  tables.productions = [];
  tables.production_inputs = [];
  tables.checklist_completions = [];
  current = createFakeDb(tables);
  audits.length = 0;
  rpcCalls.length = 0;
  rpcAnswer = { data: { status: "recorded", production_id: "P-new", produced_at: "2026-11-10T12:00:00Z" }, error: null };
});
afterEach(() => { current = null; });

const sentLines = () => (rpcCalls.at(-1)!.args.p_lines as Row[])
  .map((r) => ({ sku: r.sku_id, oz: r.input_oz, derived: r.derived_oz, qty: r.qty_entered, unit: r.unit_entered }))
  .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
const productionWrites = () => current!.writes.filter((w) => w.table === "productions" || w.table === "production_inputs");

describe("W16/B183: the single-box fold trusts the recipe for WHICH SKUs, the prepper for HOW MUCH", () => {
  it("a confirmed SKU the recipe does not name is dropped, and missing recipe SKUs are filled at their derived oz", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordProductionFromPrep(actor, { ...base, outputQty: 2,
      confirmedConsumption: [confirmed("s-pickle", 99), confirmed("s-lettuce", 50, { qtyEntered: 2, unitEntered: "each", derivedOz: 999 })] });
    expect(sentLines()).toEqual([
      { sku: "s-lettuce", oz: 50, derived: 48, qty: 2, unit: "each" },  // the prepper's amount, the server's derived
      { sku: "s-mayo", oz: 16, derived: 16, qty: null, unit: null },     // filled from the recipe
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("s-pickle"));
    warn.mockRestore();
  });

  it("null (crew / untouched panel) records the derived set exactly", async () => {
    await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null });
    expect(sentLines()).toEqual([
      { sku: "s-lettuce", oz: 48, derived: 48, qty: null, unit: null },
      { sku: "s-mayo", oz: 16, derived: 16, qty: null, unit: null },
    ]);
  });

  it("a recipe SKU zeroed on purpose stays out and is not refilled", async () => {
    await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: [confirmed("s-mayo", 0)] });
    expect(sentLines()).toEqual([{ sku: "s-lettuce", oz: 48, derived: 48, qty: null, unit: null }]);
  });
});

describe("W16/B090: the fold writes only for the live completion", () => {
  it("calls the one writer with the completion it came from, and audits a recorded production", async () => {
    const r = await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null });
    expect(r).toEqual({ productionId: "P-new" });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ fn: "record_prep_production_atomic", args: {
      p_completion_id: "C2", p_location_id: LOC, p_instance_id: "inst-1", p_template_item_id: "tpl-1",
      p_output_item_id: "i-slaw", p_output_qty: 2, p_source: "opening_p2", p_actor_id: "u-kh", p_batch: null } });
    expect(productionWrites()).toEqual([]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "production.recorded", resourceId: "P-new", metadata: expect.objectContaining({ completion_id: "C2" }) });
  });

  it("a fold whose completion was superseded writes nothing and audits nothing", async () => {
    rpcAnswer = { data: { status: "stale_completion", production_id: null }, error: null };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null })).toEqual({ productionId: null });
    expect(productionWrites()).toEqual([]);
    expect(audits).toEqual([]);
    expect(await recordBatchProductionFromPrep(actor, { ...base, batches: 1, cameOutTo: 2, confirmedConsumption: null,
      producedAt: "2026-11-10T11:00:00Z", madeBy: "u-maker" })).toEqual({ productionId: null, yieldAtTime: 2 });
    expect(rpcCalls.at(-1)!.args).toMatchObject({ p_completion_id: "C2", p_output_qty: 2,
      p_batch: { produced_at: "2026-11-10T11:00:00Z", made_by: "u-maker", batches_made: 1, came_out_to: 2, yield_at_time: 2 } });
    expect(productionWrites()).toEqual([]);
    expect(audits).toEqual([]);
    info.mockRestore();
  });

  it("the empty-consumption save still goes through the live-head check", async () => {
    rpcAnswer = { data: { status: "cleared", production_id: null }, error: null };
    expect(await recordProductionFromPrep(actor, { ...base, outputQty: 0, confirmedConsumption: [confirmed("s-lettuce", 5)] })).toEqual({ productionId: null });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.args.p_lines).toEqual([]);
    expect(productionWrites()).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("a writer error is loud (the call sites log it; the completion stays committed)", async () => {
    rpcAnswer = { data: null, error: { code: "P0001", message: "record_prep_production_atomic: completion_mismatch" } };
    await expect(recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null })).rejects.toThrow(/completion_mismatch/);
  });
});

describe("W16/B091: produced_at is the first save's, never the fold's clock", () => {
  it("recordProductionFromPrep sends no produced_at; the batch fold sends the session's", async () => {
    await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null });
    expect(rpcCalls[0]!.args.p_batch).toBeNull();
    expect(JSON.stringify(rpcCalls[0]!.args)).not.toContain("produced_at");
  });
});

describe("before 0322 is applied (missing function): the same rules as direct writes", () => {
  const completion = (id: string, extra: Row = {}) => ({ id, instance_id: "inst-1", template_item_id: "tpl-1",
    completed_at: "2026-11-10T13:00:00.000Z", superseded_at: null, revoked_at: null, ...extra });
  const liveHeaders = () => tables.productions!.filter((p) => p.superseded_at == null && p.revoked_at == null);

  it("a stale completion writes nothing", async () => {
    rpcAnswer = MISSING;
    tables.checklist_completions!.push(completion("C2", { superseded_at: "2026-11-10T13:05:00.000Z" }));
    tables.productions!.push({ id: "P4", location_id: LOC, instance_id: "inst-1", template_item_id: "tpl-1", output_qty: 4,
      produced_at: "2026-11-10T07:00:00.000Z", superseded_at: null, revoked_at: null });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null })).toEqual({ productionId: null });
    info.mockRestore();
    expect(productionWrites()).toEqual([]);
    expect(liveHeaders().map((p) => p.id)).toEqual(["P4"]);
    expect(audits).toEqual([]);
  });

  it("a re-save supersedes the prior header and keeps ITS produced_at", async () => {
    rpcAnswer = MISSING;
    tables.checklist_completions!.push(completion("C2"));
    tables.productions!.push({ id: "P1", location_id: LOC, instance_id: "inst-1", template_item_id: "tpl-1", output_qty: 2,
      produced_at: "2026-11-10T07:00:00.000Z", superseded_at: null, revoked_at: null });
    await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null });
    const live = liveHeaders();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ produced_at: "2026-11-10T07:00:00.000Z", output_qty: 2 });
    expect(live[0]!.id).not.toBe("P1");
    expect(tables.production_inputs!.filter((l) => l.production_id === live[0]!.id)).toHaveLength(2);
  });

  it("a first save takes the completion's completed_at", async () => {
    rpcAnswer = MISSING;
    tables.checklist_completions!.push(completion("C2"));
    await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null });
    expect(liveHeaders()[0]).toMatchObject({ produced_at: "2026-11-10T13:00:00.000Z" });
  });
});

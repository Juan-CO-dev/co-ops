/**
 * Unit spine — batch vs bottle PHASE B server surface (lib/yield-stats.ts + the two routes).
 *
 * The service-role client is an in-memory fake (filters applied for real), so these pin
 * BEHAVIOUR rather than source text:
 *   · level 5+ sees the variance view; level 4 does not; actions are GM (7) only;
 *   · location scoping — a GM sees only their shop's batches, another shop is a 404 and never
 *     a write; level 9 reads any shop;
 *   · Retrain writes ONE append-only note naming the outlier makers, then the nudge is snoozed;
 *   · Update recipe yield goes through the serialised writer (rpc update_recipe_output_yield),
 *     never a direct recipe_outputs write, and is audited recipe_output.update AFTER the RPC;
 *   · both actions refuse 409 no_active_nudge when the server sees no live nudge;
 *   · the Update route demands the Tier-B step-up; the Retrain route does not.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory service-role fake ─────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const rpcCalls: Array<{ fn: string; args: Row }> = [];
const writes: Array<{ table: string; op: string; payload: unknown }> = [];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "insert" = "select";
  let payload: Row | null = null;
  let range: [number, number] | null = null;
  const run = () => {
    if (op === "insert") {
      const row = { id: `note-${(db[table] ?? []).length + 1}`, created_at: new Date().toISOString(), ...payload };
      (db[table] ??= []).push(row);
      return { data: { id: row.id }, error: null };
    }
    let rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    return { data: rows, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    gt: (c: string, v: number) => { filters.push((r) => Number(r[c]) > v); return b; },
    gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; },
    not: (c: string) => { filters.push((r) => r[c] !== null && r[c] !== undefined); return b; },
    order: () => b,
    range: (f: number, t: number) => { range = [f, t]; return b; },
    returns: () => b,
    insert: (p: Row) => { op = "insert"; payload = p; writes.push({ table, op: "insert", payload: p }); return b; },
    update: (p: Row) => { writes.push({ table, op: "update", payload: p }); return b; },
    delete: () => { writes.push({ table, op: "delete", payload: null }); return b; },
    maybeSingle: () => Promise.resolve(run()),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
const fakeSb = {
  from: (t: string) => builder(t),
  rpc: (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return Promise.resolve(rpcResult); },
};

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => fakeSb }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/batch-prep", () => ({
  loadBatchContextForItems: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, {
    itemId: id, recipeId: `recipe-of-${id}`, recipeName: "Ranch", batchMode: true, shelfLifeDays: 5,
    outputCount: 1, yieldPerBatch: 10, isBatch: true, eligibility: "batched", blockedReason: null,
  }]))),
}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));

import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { loadYieldVariance, recordYieldRetrain, updateRecipeYieldFromNudge, YieldStatsError } from "@/lib/yield-stats";
import { POST as updatePOST } from "@/app/api/admin/recipes/yield-nudge/route";
import { POST as retrainPOST } from "@/app/api/operations/production/yield/retrain/route";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RANCH = "11111111-1111-4111-8111-111111111111";
const ANA = "a0000000-0000-4000-8000-000000000001";
const BEN = "b0000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-07T18:00:00.000Z");

function actor(role: string, level: number, locations: string[], stepUp = false) {
  return {
    user: { id: "u-actor", role, name: "Actor" },
    role, level, locations,
    session: { stepUpUnlocked: stepUp, stepUpUnlockedAt: stepUp ? new Date().toISOString() : null },
  } as never;
}
const SL_A = actor("shift_lead", 5, [SHOP_A]);
const KH_A = actor("key_holder", 4, [SHOP_A]);
const AGM_A = actor("agm", 6, [SHOP_A]);
const GM_A = actor("gm", 7, [SHOP_A]);
const OWNER = actor("owner", 9, []);

let seq = 0;
function header(loc: string, day: number, cameOutTo: number, madeBy: string, extra: Row = {}): Row {
  seq += 1;
  return {
    id: `p-${String(seq).padStart(4, "0")}`, location_id: loc, output_item_id: RANCH,
    produced_at: new Date(Date.UTC(2026, 8, 20) + day * 3_600_000).toISOString(),
    made_by: madeBy, batches_made: 1, came_out_to: cameOutTo, yield_at_time: 10,
    superseded_at: null, revoked_at: null, ...extra,
  };
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  rpcCalls.length = 0;
  writes.length = 0;
  rpcResult = { data: { output_id: "out-1", before: 10, after: 7.5 }, error: null };
  vi.mocked(audit).mockClear();
  db.items = [{ id: RANCH, name: "Ranch", name_es: "Rancho", default_par_unit: "bottle" }];
  db.users = [{ id: ANA, name: "Ana" }, { id: BEN, name: "Ben" }];
  db.recipes = [{ id: `recipe-of-${RANCH}`, name_es: "Rancho" }];
  db.recipe_yield_retrain_notes = [];
  // Shop A: 10 batches 25% under (7.5 vs 10) — Ana 6, Ben 4. Shop B: 10 batches on the card.
  db.productions = [
    ...Array.from({ length: 6 }, (_, i) => header(SHOP_A, i, 7.5, ANA)),
    ...Array.from({ length: 4 }, (_, i) => header(SHOP_A, 10 + i, 7.5, BEN)),
    ...Array.from({ length: 10 }, (_, i) => header(SHOP_B, i, 10, BEN)),
    // Noise the loader must ignore: superseded, revoked, single-box.
    header(SHOP_A, 30, 1, ANA, { superseded_at: "2026-09-25T00:00:00Z" }),
    header(SHOP_A, 31, 1, ANA, { revoked_at: "2026-09-25T00:00:00Z" }),
    header(SHOP_A, 32, 1, ANA, { batches_made: null, came_out_to: null, yield_at_time: null }),
  ];
});

describe("variance view — level 5+, location-bound", () => {
  it("refuses level 4 (403)", async () => {
    await expect(loadYieldVariance(KH_A, SHOP_A, NOW)).rejects.toMatchObject({ status: 403 });
  });
  it("a shift lead sees their shop, without the action buttons", async () => {
    const v = await loadYieldVariance(SL_A, SHOP_A, NOW);
    expect(v.canAct).toBe(false);
    expect(v.items).toHaveLength(1);
    const it0 = v.items[0]!;
    expect(it0.verdict.recipe.summary!.count).toBe(10);
    expect(it0.verdict.recipe.summary!.direction).toBe("under");
    expect(it0.verdict.recipe.nudge).toBe(true);
    expect(it0.lines.every((l) => l.cameOutTo === 7.5)).toBe(true);
    expect(it0.makerNames[ANA]).toBe("Ana");
    expect(v.recipeNudges).toBe(1);
  });
  it("a GM sees ONLY their shop: shop B is a 404, and shop A's numbers never include shop B's", async () => {
    await expect(loadYieldVariance(GM_A, SHOP_B, NOW)).rejects.toMatchObject({ status: 404 });
    const v = await loadYieldVariance(GM_A, SHOP_A, NOW);
    expect(v.canAct).toBe(true);
    expect(v.items[0]!.lines.every((l) => l.cameOutTo === 7.5)).toBe(true);
  });
  it("level 9 reads any shop", async () => {
    const v = await loadYieldVariance(OWNER, SHOP_B, NOW);
    expect(v.items[0]!.verdict.recipe.nudge).toBe(false);
  });
});

describe("Retrain — GM only, bound, one append-only note, then snoozed", () => {
  it("level 5 and 6 are refused (403) and nothing is written", async () => {
    await expect(recordYieldRetrain(SL_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe" }, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(recordYieldRetrain(AGM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe" }, NOW)).rejects.toMatchObject({ status: 403 });
    expect(writes).toHaveLength(0);
  });
  it("a GM on another shop is a 404 before any I/O", async () => {
    await expect(recordYieldRetrain(GM_A, { locationId: SHOP_B, itemId: RANCH, scope: "recipe" }, NOW)).rejects.toMatchObject({ status: 404 });
    expect(writes).toHaveLength(0);
  });
  it("records the note naming the outlier makers, audits it, and the nudge goes quiet", async () => {
    const res = await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe", note: "  scale check  " }, NOW);
    expect(res.id).toBeTruthy();
    expect(writes).toEqual([{ table: "recipe_yield_retrain_notes", op: "insert", payload: expect.objectContaining({
      location_id: SHOP_A, item_id: RANCH, recipe_id: `recipe-of-${RANCH}`, scope: "recipe", maker_id: null,
      outlier_user_ids: [ANA, BEN], note: "scale check", batches_in_window: 10, snooze_batches: 10, created_by: "u-actor",
    }) }]);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "yield.retrain_noted" });
    const v = await loadYieldVariance(GM_A, SHOP_A, NOW);
    expect(v.items[0]!.verdict.recipe.nudge).toBe(false);
    expect(v.items[0]!.verdict.recipe.snooze).toMatchObject({ snoozed: true, remaining: 10 });
  });
  it("refuses 409 no_active_nudge when the server sees no live nudge (shop B is on the card)", async () => {
    const ownerB = actor("owner", 9, []);
    await expect(recordYieldRetrain(ownerB, { locationId: SHOP_B, itemId: RANCH, scope: "recipe" }, NOW)).rejects.toMatchObject({ status: 409, code: "no_active_nudge" });
    expect(writes).toHaveLength(0);
  });
  it("maker scope: Ana's item (her own 6 batches) can be retrained; Ben (4 batches) has no item", async () => {
    await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "maker", makerId: ANA }, NOW);
    expect(writes[0]!.payload).toMatchObject({ scope: "maker", maker_id: ANA, outlier_user_ids: [ANA] });
    await expect(recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "maker", makerId: BEN }, NOW)).rejects.toMatchObject({ status: 409 });
  });
});

describe("Update recipe yield — GM only, bound, through the serialised writer", () => {
  it("calls rpc update_recipe_output_yield (never a direct recipe_outputs write) and audits AFTER it", async () => {
    const res = await updateRecipeYieldFromNudge(GM_A, { locationId: SHOP_A, itemId: RANCH, yield: 7.5 }, NOW);
    expect(res).toEqual({ outputId: "out-1", before: 10, after: 7.5 });
    expect(rpcCalls).toEqual([{ fn: "update_recipe_output_yield", args: { p_recipe_id: `recipe-of-${RANCH}`, p_output_item_id: RANCH, p_yield: 7.5, p_actor: "u-actor" } }]);
    expect(writes.filter((w) => w.table === "recipe_outputs")).toEqual([]);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "recipe_output.update", resourceId: "out-1", metadata: expect.objectContaining({ before: { yield: 10 }, after: { yield: 7.5 }, source: "yield_nudge", location_id: SHOP_A }) });
  });
  it("a refused RPC is a named error and writes no audit row", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "not_batch_recipe" } };
    await expect(updateRecipeYieldFromNudge(GM_A, { locationId: SHOP_A, itemId: RANCH, yield: 7.5 }, NOW)).rejects.toMatchObject({ status: 409, code: "not_batch_recipe" });
    expect(audit).not.toHaveBeenCalled();
  });
  it("level 6 is refused; another shop is a 404; a bad yield is a 400 — none reach the RPC", async () => {
    await expect(updateRecipeYieldFromNudge(AGM_A, { locationId: SHOP_A, itemId: RANCH, yield: 7.5 }, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(updateRecipeYieldFromNudge(GM_A, { locationId: SHOP_B, itemId: RANCH, yield: 7.5 }, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(updateRecipeYieldFromNudge(GM_A, { locationId: SHOP_A, itemId: RANCH, yield: 0 }, NOW)).rejects.toMatchObject({ status: 400 });
    expect(rpcCalls).toHaveLength(0);
  });
  it("no live nudge → 409, no RPC (never a quiet card edit)", async () => {
    await expect(updateRecipeYieldFromNudge(OWNER, { locationId: SHOP_B, itemId: RANCH, yield: 9 }, NOW)).rejects.toBeInstanceOf(YieldStatsError);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("routes — GM gates, step-up on Update only", () => {
  const HOST = "https://co-ops.example.com";
  const post = (path: string, body: Row) => new NextRequest(`${HOST}${path}`, {
    method: "POST", headers: { origin: HOST, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body),
  });
  it("Update: a shift lead is 403 forbidden", async () => {
    vi.mocked(requireSession).mockResolvedValue(SL_A);
    const res = await updatePOST(post("/api/admin/recipes/yield-nudge", { locationId: SHOP_A, itemId: RANCH, yield: 7.5 }));
    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });
  it("Update: a GM without a fresh step-up is 403 step_up_required", async () => {
    vi.mocked(requireSession).mockResolvedValue(GM_A);
    const res = await updatePOST(post("/api/admin/recipes/yield-nudge", { locationId: SHOP_A, itemId: RANCH, yield: 7.5 }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_required");
    expect(rpcCalls).toHaveLength(0);
  });
  it("Update: a GM with a fresh step-up reaches the serialised writer", async () => {
    vi.mocked(requireSession).mockResolvedValue(actor("gm", 7, [SHOP_A], true));
    const res = await updatePOST(post("/api/admin/recipes/yield-nudge", { locationId: SHOP_A, itemId: RANCH, yield: 7.5 }));
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["update_recipe_output_yield"]);
  });
  it("Update: a cross-site POST is refused before the session", async () => {
    vi.mocked(requireSession).mockClear();
    const res = await updatePOST(new NextRequest(`${HOST}/api/admin/recipes/yield-nudge`, { method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: "{}" }));
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });
  it("Retrain: a shift lead is 403; a GM (no step-up needed) gets 201", async () => {
    vi.mocked(requireSession).mockResolvedValue(SL_A);
    expect((await retrainPOST(post("/api/operations/production/yield/retrain", { locationId: SHOP_A, itemId: RANCH, scope: "recipe" }))).status).toBe(403);
    vi.mocked(requireSession).mockResolvedValue(GM_A);
    expect((await retrainPOST(post("/api/operations/production/yield/retrain", { locationId: SHOP_A, itemId: RANCH, scope: "recipe" }))).status).toBe(201);
  });
  it("Retrain: a bad scope is 400", async () => {
    vi.mocked(requireSession).mockResolvedValue(GM_A);
    expect((await retrainPOST(post("/api/operations/production/yield/retrain", { locationId: SHOP_A, itemId: RANCH, scope: "everyone" }))).status).toBe(400);
  });
});

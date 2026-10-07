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
/** Tables that do not exist (0218 not applied). */
const missing = new Set<string>();

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "insert" = "select";
  let payload: Row | null = null;
  let range: [number, number] | null = null;
  const run = () => {
    if (missing.has(table)) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` } };
    if (op === "insert") {
      const row = { id: `${String((db[table] ?? []).length + 1).padStart(8, "0")}-0000-4000-8000-000000000000`, created_at: new Date().toISOString(), status: "open", done_at: null, done_by: null, done_note: null, ...payload };
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
    maybeSingle: () => {
      const r = run();
      if (op === "insert" || r.error) return Promise.resolve(r);
      return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null });
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
const fakeSb = {
  from: (t: string) => builder(t),
  rpc: (fn: string, args: Row) => {
    rpcCalls.push({ fn, args });
    if (fn === "complete_yield_retrain") {
      const row = (db.recipe_yield_retrain_notes ?? []).find((r) => r.id === args.p_note_id && r.location_id === args.p_location_id);
      if (!row) return Promise.resolve({ data: null, error: { code: "P0001", message: "retrain_not_found" } });
      if (row.status !== "open") return Promise.resolve({ data: null, error: { code: "P0001", message: "retrain_already_done" } });
      Object.assign(row, { status: "done", done_at: new Date().toISOString(), done_by: args.p_actor, done_note: args.p_done_note });
      return Promise.resolve({ data: { id: row.id }, error: null });
    }
    return Promise.resolve(rpcResult);
  },
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
import { completeYieldRetrain, loadMyRetrainTasks, loadYieldVariance, recordYieldRetrain, updateRecipeYieldFromNudge, YieldStatsError } from "@/lib/yield-stats";
import { POST as donePOST } from "@/app/api/operations/production/yield/retrain/done/route";
import { POST as updatePOST } from "@/app/api/admin/recipes/yield-nudge/route";
import { POST as retrainPOST } from "@/app/api/operations/production/yield/retrain/route";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RANCH = "11111111-1111-4111-8111-111111111111";
const ANA = "a0000000-0000-4000-8000-000000000001";
const BEN = "b0000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-07T18:00:00.000Z");

function actor(role: string, level: number, locations: string[], stepUp = false, id = "u-actor") {
  return {
    user: { id, role, name: "Actor" },
    role, level, locations,
    session: { stepUpUnlocked: stepUp, stepUpUnlockedAt: stepUp ? new Date().toISOString() : null },
  } as never;
}
const SL_A = actor("shift_lead", 5, [SHOP_A]);
const KH_A = actor("key_holder", 4, [SHOP_A]);
const AGM_A = actor("agm", 6, [SHOP_A]);
const GM_A = actor("gm", 7, [SHOP_A]);
const OWNER = actor("owner", 9, []);
const KH1 = "c0000000-0000-4000-8000-000000000011";
const KH2 = "c0000000-0000-4000-8000-000000000012";
const KHB = "c0000000-0000-4000-8000-000000000013";
const KHX = "c0000000-0000-4000-8000-000000000014";
const EMP = "c0000000-0000-4000-8000-000000000015";
const MOO = "c0000000-0000-4000-8000-000000000016";
const MOO_A = actor("moo", 8, [SHOP_A], false, MOO);

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
  db.users = [
    { id: ANA, name: "Ana", role: "employee", active: true }, { id: BEN, name: "Ben", role: "employee", active: true },
    { id: "u-actor", name: "Gina GM", role: "gm", active: true },
    { id: KH1, name: "Kim KH", role: "key_holder", active: true }, { id: KH2, name: "Kai KH", role: "key_holder", active: true },
    { id: EMP, name: "Eli Emp", role: "employee", active: true }, { id: MOO, name: "Mo MoO", role: "moo", active: true },
    { id: KHB, name: "Bo KH-B", role: "key_holder", active: true }, { id: KHX, name: "Xi KH gone", role: "key_holder", active: false },
  ];
  db.user_locations = [KH1, KH2, EMP, MOO, KHX, "u-actor"].map((user_id) => ({ user_id, location_id: SHOP_A, active: true }))
    .concat([{ user_id: KHB, location_id: SHOP_B, active: true }]);
  missing.clear();
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
    expect(it0.verdict.recipe.summary!.batches).toBe(10);
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
    expect(v.items[0]!.verdict.recipe.hold).toMatchObject({ snoozed: true, remaining: 10, open: true });
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

describe("Astra r1 #4 — level 8 reads both shops; writes keep the operational bind", () => {
  it("a level-8 MoO assigned only to shop A reads shop B (view-only there)", async () => {
    const v = await loadYieldVariance(MOO_A, SHOP_B, NOW);
    expect(v.items).toHaveLength(1);
    expect(v.canAct).toBe(false);
    expect(v.assignees).toEqual([]);
  });
  it("…but cannot Retrain on shop B (operational bind → 404, nothing written)", async () => {
    await expect(recordYieldRetrain(MOO_A, { locationId: SHOP_B, itemId: RANCH, scope: "recipe" }, NOW)).rejects.toMatchObject({ status: 404 });
    expect(writes).toHaveLength(0);
  });
  it("a GM cross-shop read is still refused", async () => {
    await expect(loadYieldVariance(GM_A, SHOP_B, NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe("Retrain is GM-only for BOTH scopes; shift leads are view-only (Juan, supersedes Astra r1 #1)", () => {
  it("a shift lead's maker Retrain is refused (403), at the lib and the route", async () => {
    await expect(recordYieldRetrain(SL_A, { locationId: SHOP_A, itemId: RANCH, scope: "maker", makerId: ANA }, NOW)).rejects.toMatchObject({ status: 403 });
    vi.mocked(requireSession).mockResolvedValue(SL_A);
    const res = await retrainPOST(new NextRequest("https://co-ops.example.com/api/operations/production/yield/retrain", {
      method: "POST", headers: { origin: "https://co-ops.example.com", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ locationId: SHOP_A, itemId: RANCH, scope: "maker", makerId: ANA }),
    }));
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });
  it("the shift lead still SEES the maker items", async () => {
    const v = await loadYieldVariance(SL_A, SHOP_A, NOW);
    expect(v.items[0]!.verdict.makers.find((m) => m.makerId === ANA)!.nudge).toBe(true);
    expect(v.canAct).toBe(false);
  });
});

describe("assignee picker — active KH+ at that shop, level ≤ the GM's", () => {
  it("lists exactly the eligible people (the GM included as themself)", async () => {
    const v = await loadYieldVariance(GM_A, SHOP_A, NOW);
    expect(v.assignees.map((a) => a.id).sort()).toEqual([KH1, KH2, "u-actor"].sort());
    // Out: an employee (3), a MoO (8 > 7), a KH at shop B, an inactive KH, the makers (employees).
  });
  it("the server re-checks the choice: employee, above-GM, other-shop and inactive are 400 invalid_assignee", async () => {
    for (const bad of [EMP, MOO, KHB, KHX]) {
      await expect(recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe", assignedTo: bad }, NOW)).rejects.toMatchObject({ status: 400, code: "invalid_assignee" });
    }
    expect(writes).toHaveLength(0);
  });
  it("assigning a KH writes assigned_to and audits retrain_noted + retrain_assigned; no pick = the GM", async () => {
    await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe", assignedTo: KH1 }, NOW);
    expect(writes[0]!.payload).toMatchObject({ assigned_to: KH1, status: "open" });
    expect(vi.mocked(audit).mock.calls.map((c) => c[0].action)).toEqual(["yield.retrain_noted", "yield.retrain_assigned"]);
  });
  it("with no pick the GM owns it (assigned_to = the GM, only retrain_noted is audited)", async () => {
    await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe" }, NOW);
    expect(writes[0]!.payload).toMatchObject({ assigned_to: "u-actor" });
    expect(vi.mocked(audit).mock.calls.map((c) => c[0].action)).toEqual(["yield.retrain_noted"]);
  });
});

describe("a recipe-level Retrain holds that recipe's maker items too (Astra r1 #2)", () => {
  it("immediately after the recipe Retrain, Ana's maker item is held via the recipe", async () => {
    await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe", assignedTo: KH1 }, NOW);
    const v = await loadYieldVariance(GM_A, SHOP_A, NOW);
    const ana = v.items[0]!.verdict.makers.find((m) => m.makerId === ANA)!;
    expect(ana.summary!.flagged).toBe(true);
    expect(ana.nudge).toBe(false);
    expect(ana.hold).toMatchObject({ via: "recipe" });
    expect(v.makerItems).toBe(0);
  });
});

describe("My shift — the assignee's own open retrains, location-bound", () => {
  const KH1_A = actor("key_holder", 4, [SHOP_A], false, KH1);
  const KH2_A = actor("key_holder", 4, [SHOP_A], false, KH2);
  beforeEach(async () => {
    await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe", assignedTo: KH1, note: "watch the ladle" }, NOW);
  });
  it("the assignee sees 'Retrain Ana, Ben on Ranch (from Gina GM)'", async () => {
    const tasks = await loadMyRetrainTasks(KH1_A, SHOP_A);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ scope: "recipe", traineeNames: ["Ana", "Ben"], fromName: "Gina GM", note: "watch the ladle" });
  });
  it("nobody else sees it: another KH, the GM who assigned it, a shift lead", async () => {
    expect(await loadMyRetrainTasks(KH2_A, SHOP_A)).toEqual([]);
    expect(await loadMyRetrainTasks(GM_A, SHOP_A)).toEqual([]);
    expect(await loadMyRetrainTasks(SL_A, SHOP_A)).toEqual([]);
  });
  it("another shop is a 404 for the assignee (location-bound)", async () => {
    await expect(loadMyRetrainTasks(KH1_A, SHOP_B)).rejects.toMatchObject({ status: 404 });
  });
  it("it persists until done, then leaves My shift", async () => {
    const [task] = await loadMyRetrainTasks(KH1_A, SHOP_A);
    await completeYieldRetrain(KH1_A, { noteId: task!.noteId, doneNote: "showed her the scale" });
    expect(await loadMyRetrainTasks(KH1_A, SHOP_A)).toEqual([]);
  });
});

describe("Mark done — the assignee or a GM, once", () => {
  const KH1_A = actor("key_holder", 4, [SHOP_A], false, KH1);
  const KH2_A = actor("key_holder", 4, [SHOP_A], false, KH2);
  const GM_B = actor("gm", 7, [SHOP_B], false, "u-gm-b");
  let noteId = "";
  beforeEach(async () => {
    noteId = (await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe", assignedTo: KH1 }, NOW)).id;
    rpcCalls.length = 0;
    vi.mocked(audit).mockClear();
  });
  it("another KH, or a shift lead who is not the assignee, is 403 and nothing is written", async () => {
    await expect(completeYieldRetrain(KH2_A, { noteId })).rejects.toMatchObject({ status: 403 });
    await expect(completeYieldRetrain(SL_A, { noteId })).rejects.toMatchObject({ status: 403 });
    expect(rpcCalls).toHaveLength(0);
  });
  it("a GM of ANOTHER shop is a 404 (operational bind)", async () => {
    await expect(completeYieldRetrain(GM_B, { noteId })).rejects.toMatchObject({ status: 404 });
    expect(rpcCalls).toHaveLength(0);
  });
  it("the assignee completes it through complete_yield_retrain and it is audited; a second time is 409", async () => {
    await completeYieldRetrain(KH1_A, { noteId, doneNote: "  done  " });
    expect(rpcCalls).toEqual([{ fn: "complete_yield_retrain", args: { p_note_id: noteId, p_location_id: SHOP_A, p_actor: KH1, p_done_note: "done" } }]);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "yield.retrain_done", metadata: expect.objectContaining({ by_assignee: true }) });
    await expect(completeYieldRetrain(GM_A, { noteId })).rejects.toMatchObject({ status: 409, code: "retrain_already_done" });
  });
  it("the GM of the shop may mark it done too", async () => {
    await completeYieldRetrain(GM_A, { noteId });
    expect(db.recipe_yield_retrain_notes![0]).toMatchObject({ status: "done", done_by: "u-actor" });
  });
  it("the done route: a shift lead is 403", async () => {
    vi.mocked(requireSession).mockResolvedValue(SL_A);
    const res = await donePOST(new NextRequest("https://co-ops.example.com/api/operations/production/yield/retrain/done", {
      method: "POST", headers: { origin: "https://co-ops.example.com", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ noteId }),
    }));
    expect(res.status).toBe(403);
  });
});

describe("open / done display on the variance view", () => {
  const KH1_A = actor("key_holder", 4, [SHOP_A], false, KH1);
  it("open: the recipe is held by an OPEN note naming the assignee; done: the note names who and when", async () => {
    const { id } = await recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe", assignedTo: KH1 }, NOW);
    let v = await loadYieldVariance(SL_A, SHOP_A, NOW);
    let item = v.items[0]!;
    expect(item.verdict.recipe.hold).toMatchObject({ noteId: id, open: true });
    expect(item.notes[id]).toMatchObject({ status: "open", assignedToName: "Kim KH" });
    await completeYieldRetrain(KH1_A, { noteId: id });
    v = await loadYieldVariance(SL_A, SHOP_A, NOW);
    item = v.items[0]!;
    expect(item.notes[id]).toMatchObject({ status: "done", doneByName: "Kim KH" });
    expect(item.notes[id]!.doneAt).toBeTruthy();
    // The 10-batch snooze started at recording and still holds (no batches since).
    expect(item.verdict.recipe.hold).toMatchObject({ open: false, snoozed: true, remaining: 10 });
  });
});

describe("0218 missing — an explicit unavailable state, never fabricated verdicts", () => {
  beforeEach(() => { missing.add("recipe_yield_retrain_notes"); });
  it("the view says unavailable, with no items and no actions", async () => {
    const v = await loadYieldVariance(GM_A, SHOP_A, NOW);
    expect(v).toMatchObject({ unavailable: true, items: [], canAct: false, recipeNudges: 0, makerItems: 0 });
  });
  it("Retrain and Update answer 503 yield_unavailable and write nothing", async () => {
    await expect(recordYieldRetrain(GM_A, { locationId: SHOP_A, itemId: RANCH, scope: "recipe" }, NOW)).rejects.toMatchObject({ status: 503, code: "yield_unavailable" });
    await expect(updateRecipeYieldFromNudge(GM_A, { locationId: SHOP_A, itemId: RANCH, yield: 7.5 }, NOW)).rejects.toMatchObject({ status: 503 });
    expect(rpcCalls).toHaveLength(0);
  });
  it("My shift reads as no tasks (a dashboard widget must not fail the dashboard)", async () => {
    expect(await loadMyRetrainTasks(GM_A, SHOP_A)).toEqual([]);
  });
});

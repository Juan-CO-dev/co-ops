/**
 * Unit spine — the opening Phase 2 save under batch vs bottle (0215, plan S r4 Phase A).
 *
 * The guarantee that matters most is a NEGATIVE: a single-box save (no `entry.batch`) calls
 * save_phase2_item_atomic with exactly today's arguments plus `p_batch: null` — the RPC's
 * DEFAULT — and never touches the batch fold. Then the positive half: a batch entry rides
 * as `p_batch` in the RPC's snake_case shape, a contract refusal becomes a typed 422, and
 * the revoke consults the SESSION KEY (correction 1). No DB — the service client is a stub.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { mapOpeningError } from "@/app/api/opening/_helpers";
import { audit } from "@/lib/audit";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { BATCH_CONTRACT_CODES, OVER_BATCH_REASON_CODES, type BatchItemContext } from "@/lib/batch-prep-shared";
import {
  OPENING_BASE_LEVEL,
  OpeningBatchContractError,
  savePhase2Item,
} from "@/lib/opening";
import type { OpeningEntryPhase2 } from "@/lib/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
// Astra P2 #5: the save consults the batch context (graph resolvability) BEFORE the RPC. The
// double answers "eligible" by default; one test flips it to "unresolved".
const batchCtxMock = vi.fn(async (ids: string[]): Promise<Map<string, BatchItemContext>> => new Map(ids.map((id) => [id, { itemId: id, recipeId: "r1", recipeName: "Hot Peppers", batchMode: true, shelfLifeDays: 5, outputCount: 1, yieldPerBatch: 4, isBatch: true, eligibility: "batched" as const, blockedReason: null }])));
vi.mock("@/lib/batch-prep", () => ({ loadBatchContextForItems: (ids: string[]) => batchCtxMock(ids) }));
// The fold is a separate service-role writer; stubbed so the test observes the ARGUMENTS the
// save hands it (persisted attribution, never the caller's clock) without a graph.
const foldMock = vi.fn(async () => ({ productionId: "p1", yieldAtTime: 4 }));
vi.mock("@/lib/prep-consumption", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prep-consumption")>();
  return { ...actual, recordBatchProductionFromPrep: (...a: unknown[]) => foldMock(...(a as [])) };
});
const ITEM_ID = "33333333-4444-4555-8666-777777777777";
vi.mocked(audit);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const TEMPLATE_ITEM_ID = "11111111-2222-4333-8444-555555555555";
const INSTANCE_ID = "99999999-8888-4777-8666-555555555555";
const ACTOR_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const ROW = {
  id: "77777777-6666-4555-8444-333333333333",
  instance_id: INSTANCE_ID,
  template_item_id: TEMPLATE_ITEM_ID,
  completed_by: ACTOR_ID,
  completed_at: "2026-10-07T11:04:09.000Z",
  count_value: null,
  photo_id: null,
  notes: null,
  superseded_at: null,
  superseded_by: null,
  revoked_at: null,
  revoked_by: null,
  revocation_reason: null,
  revocation_note: null,
  actual_completer_id: null,
  actual_completer_tagged_at: null,
  actual_completer_tagged_by: null,
  prep_data: { phase2: { phase: 2, opener_prepped: 6, over_under_status: "at_par", saved_by: ACTOR_ID, saved_at: "2026-10-07T11:04:09.000Z" } },
  auto_complete_meta: null,
  original_completion_id: null,
  edit_count: 0,
};

const SINGLE_BOX: OpeningEntryPhase2 = {
  templateItemId: TEMPLATE_ITEM_ID,
  phase: "phase2",
  openerPrepped: 6,
  deltaVsPrepNeed: null,
  overPar: null,
  underPar: null,
};

/** A service double: `rpc` answers as given; `from(...)` is a thenable builder whose maybeSingle yields `row`. */
function service(rpcAnswer: { data: unknown; error: { code: string; message: string } | null }, row: unknown = null) {
  const rpc = vi.fn(async () => rpcAnswer);
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  });
  return { client: { rpc, from } as never, rpc, from };
}

beforeEach(() => {
  vi.mocked(audit).mockClear();
  batchCtxMock.mockClear();
  foldMock.mockClear();
});

const BATCH_RPC_OK = (extra: Record<string, unknown> = {}) => ({
  data: { completion: ROW, templateItemId: TEMPLATE_ITEM_ID, completionId: ROW.id, deltaVsPrepNeed: 0, overUnderStatus: "at_par", tossPrevious: 0, tossCurrent: 0, producedAt: "2026-10-07T10:00:00.000Z", madeBy: "maker-0000-4000-8000-000000000001", ...extra },
  error: null,
});
const TEMPLATE_ITEM_ROW = { item_id: ITEM_ID };

describe("single-box save is byte-identical (plus the RPC's default)", () => {
  it("calls save_phase2_item_atomic with today's arguments and p_batch: null", async () => {
    const svc = service({ data: { completion: ROW, templateItemId: TEMPLATE_ITEM_ID, completionId: ROW.id, deltaVsPrepNeed: 0, overUnderStatus: "at_par" }, error: null });
    const result = await savePhase2Item(svc.client, {
      instanceId: INSTANCE_ID,
      locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
      entry: SINGLE_BOX,
      confirmedConsumption: null,
    });
    expect(svc.rpc).toHaveBeenCalledTimes(1);
    expect(svc.rpc).toHaveBeenCalledWith("save_phase2_item_atomic", {
      p_opening_instance_id: INSTANCE_ID,
      p_actor_id: ACTOR_ID,
      p_template_item_id: TEMPLATE_ITEM_ID,
      p_opener_prepped: 6,
      p_over_par: null,
      p_under_par: null,
      p_ip_address: null,
      p_user_agent: null,
      p_batch: null,
    });
    expect(result.completionId).toBe(ROW.id);
    // The template item has no registry link in this double → neither fold runs, no header write.
    expect(svc.from).toHaveBeenCalledWith("checklist_template_items");
    expect(svc.from).not.toHaveBeenCalledWith("productions");
  });
});

describe("batched save", () => {
  it("sends the batch half as p_batch in the RPC's snake_case shape", async () => {
    const svc = service(BATCH_RPC_OK(), TEMPLATE_ITEM_ROW);
    await savePhase2Item(svc.client, {
      instanceId: INSTANCE_ID,
      locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
      entry: { ...SINGLE_BOX, batch: { batches: 2, cameOutTo: 7.5, tossed: 0, overBatchReason: { code: "catering_order", note: null } } },
      confirmedConsumption: null,
    });
    const call = svc.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[1].p_batch).toEqual({ batches: 2, came_out_to: 7.5, tossed: 0, over_batch_reason: { code: "catering_order", note: null } });
  });
  it("a zero-batch bottling sends batches 0 / came_out_to 0 and no reason", async () => {
    const svc = service(BATCH_RPC_OK(), TEMPLATE_ITEM_ROW);
    await savePhase2Item(svc.client, {
      instanceId: INSTANCE_ID,
      locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
      entry: { ...SINGLE_BOX, openerPrepped: 2, batch: { batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null } },
      confirmedConsumption: null,
    });
    const call = svc.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[1].p_batch).toEqual({ batches: 0, came_out_to: 0, tossed: 0, over_batch_reason: null });
  });
  it("a contract refusal from the RPC becomes OpeningBatchContractError → 422 with the item id", async () => {
    const svc = service({ data: null, error: { code: "P0001", message: `save_phase2_item_atomic: bottled_exceeds_available for item ${TEMPLATE_ITEM_ID} (Hot Peppers) — bottled 9 > available 6` } }, TEMPLATE_ITEM_ROW);
    const err = await savePhase2Item(svc.client, {
      instanceId: INSTANCE_ID,
      locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
      entry: { ...SINGLE_BOX, openerPrepped: 9, batch: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null } },
      confirmedConsumption: null,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningBatchContractError);
    const response = mapOpeningError(err as OpeningBatchContractError);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; template_item_id: string };
    expect(body.code).toBe("bottled_exceeds_available");
    expect(body.template_item_id).toBe(TEMPLATE_ITEM_ID);
  });
  it("an UNRESOLVABLE batch recipe is refused BEFORE the RPC (Astra P2 #5) — no completion is written", async () => {
    batchCtxMock.mockImplementationOnce(async (ids: string[]) => new Map(ids.map((id) => [id, { itemId: id, recipeId: "r1", recipeName: "Hot Peppers", batchMode: true, shelfLifeDays: 5, outputCount: 1, yieldPerBatch: 4, isBatch: false, eligibility: "blocked" as const, blockedReason: "unresolved" as const }])));
    const svc = service(BATCH_RPC_OK(), TEMPLATE_ITEM_ROW);
    const err = await savePhase2Item(svc.client, {
      instanceId: INSTANCE_ID,
      locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
      entry: { ...SINGLE_BOX, batch: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null } },
      confirmedConsumption: null,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningBatchContractError);
    expect((err as OpeningBatchContractError).code).toBe("batch_recipe_unresolved");
    expect(svc.rpc).not.toHaveBeenCalled();
    expect(foldMock).not.toHaveBeenCalled();
  });
  it("the fold receives the PERSISTED session attribution the RPC returned, never the caller's clock or editor (Astra P2 #7)", async () => {
    const svc = service(BATCH_RPC_OK({ producedAt: "2026-10-07T09:00:00.000Z", madeBy: "maker-0000-4000-8000-000000000001" }), TEMPLATE_ITEM_ROW);
    await savePhase2Item(svc.client, {
      instanceId: INSTANCE_ID,
      locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
      entry: { ...SINGLE_BOX, batch: { batches: 2, cameOutTo: 8, tossed: 0, overBatchReason: { code: "catering_order", note: null } } },
      confirmedConsumption: null,
    });
    expect(foldMock).toHaveBeenCalledTimes(1);
    const foldArgs = (foldMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(foldArgs.producedAt).toBe("2026-10-07T09:00:00.000Z");
    expect(foldArgs.madeBy).toBe("maker-0000-4000-8000-000000000001");
    expect(foldArgs.madeBy).not.toBe(ACTOR_ID);
    expect(foldArgs.batches).toBe(2);
  });
  it("without session attribution in the RPC answer the fold is SKIPPED (loudly), the completion still stands", async () => {
    const svc = service(BATCH_RPC_OK({ producedAt: null, madeBy: null }), TEMPLATE_ITEM_ROW);
    const result = await savePhase2Item(svc.client, {
      instanceId: INSTANCE_ID,
      locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      actor: { userId: ACTOR_ID, role: "key_holder", level: OPENING_BASE_LEVEL },
      entry: { ...SINGLE_BOX, batch: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null } },
      confirmedConsumption: null,
    });
    expect(result.completionId).toBe(ROW.id);
    expect(foldMock).not.toHaveBeenCalled();
  });
  it("audits backup.tossed on every REAL toss change (set and cleared) and never on an unchanged save (Astra P2 #6)", async () => {
    const base = { instanceId: INSTANCE_ID, locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb", actor: { userId: ACTOR_ID, role: "key_holder" as const, level: OPENING_BASE_LEVEL }, confirmedConsumption: null };
    const tossActions = () => vi.mocked(audit).mock.calls.filter((c) => (c[0] as { action: string }).action === "backup.tossed");
    // set: 0 → 8
    await savePhase2Item(service(BATCH_RPC_OK({ tossPrevious: 0, tossCurrent: 8 }), TEMPLATE_ITEM_ROW).client, { ...base, entry: { ...SINGLE_BOX, batch: { batches: 1, cameOutTo: 4, tossed: 8, overBatchReason: null } } });
    expect(tossActions()).toHaveLength(1);
    expect((tossActions()[0]![0] as { metadata: Record<string, unknown> }).metadata).toMatchObject({ tossed_previous: 0, tossed_current: 8 });
    // unchanged: 8 → 8
    vi.mocked(audit).mockClear();
    await savePhase2Item(service(BATCH_RPC_OK({ tossPrevious: 8, tossCurrent: 8 }), TEMPLATE_ITEM_ROW).client, { ...base, entry: { ...SINGLE_BOX, batch: { batches: 1, cameOutTo: 4, tossed: 8, overBatchReason: null } } });
    expect(tossActions()).toHaveLength(0);
    // cleared through a correction: 8 → 0
    vi.mocked(audit).mockClear();
    await savePhase2Item(service(BATCH_RPC_OK({ tossPrevious: 8, tossCurrent: 0 }), TEMPLATE_ITEM_ROW).client, { ...base, entry: { ...SINGLE_BOX, batch: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null } } });
    expect(tossActions()).toHaveLength(1);
    expect((tossActions()[0]![0] as { metadata: Record<string, unknown> }).metadata).toMatchObject({ tossed_previous: 8, tossed_current: 0 });
  });
  it("a fold failure never fails the committed completion, and a re-save re-runs the fold (heals by supersede)", async () => {
    foldMock.mockImplementationOnce(async () => { throw new Error("lines insert exploded"); });
    const base = { instanceId: INSTANCE_ID, locationId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb", actor: { userId: ACTOR_ID, role: "key_holder" as const, level: OPENING_BASE_LEVEL }, confirmedConsumption: null, entry: { ...SINGLE_BOX, batch: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null } } };
    const first = await savePhase2Item(service(BATCH_RPC_OK(), TEMPLATE_ITEM_ROW).client, base);
    expect(first.completionId).toBe(ROW.id); // committed despite the fold error
    const second = await savePhase2Item(service(BATCH_RPC_OK(), TEMPLATE_ITEM_ROW).client, base);
    expect(second.completionId).toBe(ROW.id);
    expect(foldMock).toHaveBeenCalledTimes(2); // the re-save folds again; recordBatchProductionFromPrep supersedes the prior header
  });
  it("the batch fold is chosen by the ENTRY, and the single-box fold stays the only path without it", () => {
    const src = read("lib", "opening.ts");
    const fn = src.slice(src.indexOf("export async function savePhase2Item("), src.indexOf("// C.53 §8.4 Phase 2 revoke (Lane D)"));
    expect(fn).toMatch(/if \(tItem\?\.item_id && args\.entry\.batch\) \{/);
    expect(fn).toMatch(/recordBatchProductionFromPrep\(args\.actor, \{/);
    expect(fn).toMatch(/\} else if \(tItem\?\.item_id\) \{/);
    expect(fn).toContain("outputQty: args.entry.openerPrepped,");
    // produced_at / made_by are the PERSISTED session facts the RPC returned — never this
    // call's clock or editor (Astra P2 #7); missing facts skip the fold loudly.
    expect(fn).toMatch(/const producedAt = rpcResult\.producedAt \?\? record\?\.producedAt \?\? null;/);
    expect(fn).toMatch(/const madeBy = rpcResult\.madeBy \?\? record\?\.madeBy \?\? null;/);
    expect(fn).not.toMatch(/madeBy: .*args\.actor\.userId/);
    expect(fn).toContain("fold skipped");
  });
});

describe("revoke consults the SESSION KEY (correction 1)", () => {
  const src = read("lib", "opening.ts");
  const fn = src.slice(src.indexOf("export async function revokePhase2Completion("), src.indexOf("export async function submitPhase2Atomic("));
  it("looks up prep_batch_sessions by (instance_id, template_item_id) BEFORE deciding the write path", () => {
    const sessionAt = fn.indexOf('.from("prep_batch_sessions")');
    const rpcAt = fn.indexOf('rpc("revoke_phase2_item_atomic"');
    const updateAt = fn.indexOf(".update({");
    expect(sessionAt).toBeGreaterThan(-1);
    expect(sessionAt).toBeLessThan(rpcAt);
    expect(sessionAt).toBeLessThan(updateAt);
    expect(fn).toMatch(/\.eq\("template_item_id", liveRow\.template_item_id\)/);
  });
  it("with a session row the revoke and the toss retraction are ONE RPC; without one the UPDATE is today's", () => {
    expect(fn).toMatch(/if \(sessionRow\) \{/);
    expect(fn).toContain("p_revocation_reason: revocationReason,");
    expect(fn).toContain("p_revocation_note: revocationNote,");
    // The UPDATE body is byte-for-byte the pre-0215 statement.
    expect(fn).toContain(`.update({
        revoked_at: nowIso,
        revoked_by: args.actor.userId,
        revocation_reason: revocationReason,
        revocation_note: revocationNote,
      })
      .eq("id", args.completionId)
      .eq("instance_id", args.instanceId)
      .is("revoked_at", null)
      .is("superseded_at", null)
      .select(COMPLETION_COLUMNS);`);
  });
  it("a retracted toss is audited as backup.toss_retracted whatever the revoke path", () => {
    expect(fn).toMatch(/if \(tossRetracted > 0\) \{/);
    expect(fn).toContain('action: "backup.toss_retracted"');
    expect(fn).toContain("revoke_path: path,");
  });
});

describe("route + strings", () => {
  it("the route parses entry.batch by SHAPE only and omits it when absent", () => {
    const route = read("app", "api", "opening", "prep", "item", "route.ts");
    expect(route).toMatch(/function parseBatchEntry\(raw: unknown\)/);
    expect(route).toContain('if (batch === BATCH_INVALID) return { ok: false, field: "entry.batch" };');
    expect(route).toContain("...(batch !== null ? { batch } : {}),");
  });
  it.each([...BATCH_CONTRACT_CODES])("prep.batch.error.%s exists in en and es", (code) => {
    expect((en as Record<string, string>)[`prep.batch.error.${code}`]).toBeTruthy();
    expect((es as Record<string, string>)[`prep.batch.error.${code}`]).toBeTruthy();
  });
  it.each(["bottled_missing"])("prep.batch.error.%s (client-only gate) exists in en and es", (code) => {
    expect((en as Record<string, string>)[`prep.batch.error.${code}`]).toBeTruthy();
    expect((es as Record<string, string>)[`prep.batch.error.${code}`]).toBeTruthy();
  });
  it.each([...OVER_BATCH_REASON_CODES])("prep.batch.reason.%s exists in en and es", (code) => {
    expect((en as Record<string, string>)[`prep.batch.reason.${code}`]).toBeTruthy();
    expect((es as Record<string, string>)[`prep.batch.reason.${code}`]).toBeTruthy();
  });
  it("the opening row's 'needs_batch' nudge has a string", () => {
    expect((en as Record<string, string>)["opening.phase2.save.incomplete_batch"]).toBeTruthy();
    expect((es as Record<string, string>)["opening.phase2.save.incomplete_batch"]).toBeTruthy();
  });
});

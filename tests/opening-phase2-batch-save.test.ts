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
import { BATCH_CONTRACT_CODES, OVER_BATCH_REASON_CODES } from "@/lib/batch-prep-shared";
import {
  OPENING_BASE_LEVEL,
  OpeningBatchContractError,
  savePhase2Item,
} from "@/lib/opening";
import type { OpeningEntryPhase2 } from "@/lib/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
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
});

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
    const svc = service({ data: { completion: ROW, templateItemId: TEMPLATE_ITEM_ID, completionId: ROW.id, deltaVsPrepNeed: 0, overUnderStatus: "at_par" }, error: null });
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
    const svc = service({ data: { completion: ROW, templateItemId: TEMPLATE_ITEM_ID, completionId: ROW.id, deltaVsPrepNeed: 0, overUnderStatus: "at_par" }, error: null });
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
    const svc = service({ data: null, error: { code: "P0001", message: `save_phase2_item_atomic: bottled_exceeds_available for item ${TEMPLATE_ITEM_ID} (Hot Peppers) — bottled 9 > available 6` } });
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
  it("the batch fold is chosen by the ENTRY, and the single-box fold stays the only path without it", () => {
    const src = read("lib", "opening.ts");
    const fn = src.slice(src.indexOf("export async function savePhase2Item("), src.indexOf("// C.53 §8.4 Phase 2 revoke (Lane D)"));
    expect(fn).toMatch(/if \(tItem\?\.item_id && args\.entry\.batch\) \{/);
    expect(fn).toMatch(/recordBatchProductionFromPrep\(args\.actor, \{/);
    expect(fn).toMatch(/\} else if \(tItem\?\.item_id\) \{/);
    expect(fn).toContain("outputQty: args.entry.openerPrepped,");
    // produced_at / made_by come from the session the RPC stamped, never this call's clock.
    expect(fn).toMatch(/producedAt: record\?\.producedAt \?\? rpcResult\.completion\.completed_at/);
    expect(fn).toMatch(/madeBy: record\?\.madeBy \?\? args\.actor\.userId/);
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

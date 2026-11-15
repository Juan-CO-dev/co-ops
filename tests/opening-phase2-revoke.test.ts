/**
 * Audit W14 / B080 + B181 — every Phase 2 Undo goes through ONE transactional writer.
 *
 * B080: revokePhase2Completion read the instance status in one request and then — for a row
 * with no batch session — revoked it with a plain UPDATE in another. Neither re-checked the
 * status nor locked the instance, so an Undo that committed after submit_phase2_atomic counted
 * its row left a finalized report naming a revoked completion. Every Undo now calls
 * revoke_phase2_item_atomic (0315 locks the instance, re-checks phase1_complete under the lock,
 * and treats "no batch session" as the old UPDATE), and the lib maps its named refusal.
 *
 * B181: a save and an undo of the same batch row could deadlock (40P01), which surfaced as a
 * 500. 0315 gives both the same lock order; a residual 40P01 / 55P03 is the named, retryable
 * 409 revoke_conflict, never a 500.
 *
 * No DB — the service client is a stub (the opening-phase2-save-conflict.test.ts boundary).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mapOpeningError } from "@/app/api/opening/_helpers";
import { audit } from "@/lib/audit";
import {
  OpeningError,
  OpeningPhase2NotEligibleError,
  OpeningRevocationReasonInvalidError,
  OpeningRevokeConflictError,
  revokePhase2Completion,
} from "@/lib/opening";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/prep-consumption", async (original) => ({
  ...(await original<typeof import("@/lib/prep-consumption")>()),
  reverseProductionForPrep: vi.fn(async () => {}),
}));

const auditMock = vi.mocked(audit);
const INSTANCE_ID = "99999999-8888-4777-8666-555555555555";
const COMPLETION_ID = "77777777-6666-4555-8444-333333333333";
const TEMPLATE_ITEM_ID = "11111111-2222-4333-8444-555555555555";
const ACTOR = { userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", role: "key_holder" as const, level: 4 };

const liveRow = () => ({
  id: COMPLETION_ID,
  instance_id: INSTANCE_ID,
  template_item_id: TEMPLATE_ITEM_ID,
  completed_by: ACTOR.userId,
  completed_at: new Date().toISOString(), // inside the 60 s self window → the silent path
  count_value: null, photo_id: null, notes: null, superseded_at: null, superseded_by: null,
  revoked_at: null, revoked_by: null, revocation_reason: null, revocation_note: null,
  actual_completer_id: null, actual_completer_tagged_at: null, actual_completer_tagged_by: null,
  prep_data: { phase2: { phase: 2, opener_prepped: 12, over_under_status: "at_par" } },
  auto_complete_meta: null, original_completion_id: null, edit_count: 0,
});

type RpcAnswer = { data: unknown; error: null } | { data: null; error: { code: string; message: string } };

/** Records every table touched, every UPDATE, and every RPC. */
function service(answer: RpcAnswer, status = "phase1_complete") {
  const tables: string[] = [];
  const updates: Array<{ table: string; patch: unknown }> = [];
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => answer);
  const from = vi.fn((table: string) => {
    tables.push(table);
    const row = table === "checklist_instances" ? { status, location_id: "shop", date: "2026-11-15" } : table === "checklist_completions" ? liveRow() : null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      update: (patch: unknown) => { updates.push({ table, patch }); return builder; },
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve),
    };
    return builder;
  });
  return { client: { rpc, from } as never, rpc, tables, updates };
}

const revoked = () => ({ data: { completion: { ...liveRow(), revoked_at: new Date().toISOString(), revoked_by: ACTOR.userId, revocation_reason: "quick_reenter" }, tossRetracted: 0 }, error: null });
const args = { instanceId: INSTANCE_ID, completionId: COMPLETION_ID, actor: ACTOR };

beforeEach(() => auditMock.mockClear());

describe("revokePhase2Completion — one transactional writer for every Undo (B080)", () => {
  it("a single-box revoke goes through revoke_phase2_item_atomic, never a direct update", async () => {
    const s = service(revoked());
    const result = await revokePhase2Completion(s.client, args);
    expect(result.path).toBe("silent");
    expect(s.rpc).toHaveBeenCalledTimes(1);
    expect(s.rpc).toHaveBeenCalledWith("revoke_phase2_item_atomic", {
      p_instance_id: INSTANCE_ID,
      p_completion_id: COMPLETION_ID,
      p_actor_id: ACTOR.userId,
      p_revocation_reason: "quick_reenter",
      p_revocation_note: null,
    });
    expect(s.updates).toEqual([]);
    // The lib no longer decides "batch or not" from a separate, unlocked read.
    expect(s.tables).not.toContain("prep_batch_sessions");
  });

  it("the RPC's phase2_not_eligible (finalize won the lock) is the named 409, audited as its own phase", async () => {
    const s = service({ data: null, error: { code: "P0001", message: `revoke_phase2_item_atomic: phase2_not_eligible — instance ${INSTANCE_ID} status is "phase2_complete" (expected phase1_complete)` } });
    const err = await revokePhase2Completion(s.client, args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningPhase2NotEligibleError);
    expect((err as OpeningPhase2NotEligibleError).status).toBe("phase2_complete");
    expect(mapOpeningError(err as OpeningPhase2NotEligibleError).status).toBe(409);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "opening.phase2.revoke",
      metadata: expect.objectContaining({ outcome: "phase2_not_eligible", phase: "rpc", current_status: "phase2_complete" }),
    }));
  });

  it("revoke_conflict and the reason CHECK keep their existing mappings", async () => {
    const conflict = service({ data: null, error: { code: "P0001", message: "revoke_phase2_item_atomic: revoke_conflict — completion x is not live on instance y" } });
    await expect(revokePhase2Completion(conflict.client, args)).rejects.toBeInstanceOf(OpeningRevokeConflictError);
    const badReason = service({ data: null, error: { code: "23514", message: "check constraint" } });
    await expect(revokePhase2Completion(badReason.client, args)).rejects.toBeInstanceOf(OpeningRevocationReasonInvalidError);
  });

  it("an unknown RPC failure is still a 500 (never mistaken for a conflict)", async () => {
    const s = service({ data: null, error: { code: "XX000", message: "boom" } });
    const err = await revokePhase2Completion(s.client, args).catch((e: unknown) => e);
    // Not an OpeningError at all: the route's catch answers 500 for it.
    expect(err).not.toBeInstanceOf(OpeningError);
    expect((err as Error).message).toContain("revokePhase2Completion revoke_phase2_item_atomic: boom");
  });
});

describe("revokePhase2Completion — a deadlock or lock timeout is a retryable 409, not a 500 (B181)", () => {
  it.each([["40P01", "deadlock detected"], ["55P03", "canceling statement due to lock timeout"]])("%s maps to OpeningRevokeConflictError", async (code, message) => {
    const s = service({ data: null, error: { code, message } });
    const err = await revokePhase2Completion(s.client, args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpeningRevokeConflictError);
    const res = mapOpeningError(err as OpeningRevokeConflictError);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "revoke_conflict" });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ outcome: "revoke_conflict", phase: "lock", sqlstate: code }),
    }));
  });
});

describe("the lib source", () => {
  const src = readFileSync("lib/opening.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function revokePhase2Completion("), src.indexOf("\n}\n", src.indexOf("export async function revokePhase2Completion(")));
  it("has no direct completion UPDATE and no session lookup left in the revoke", () => {
    expect(fn).toContain('service.rpc("revoke_phase2_item_atomic"');
    expect(fn).not.toMatch(/\.from\("checklist_completions"\)\s*\.update\(/);
    expect(fn).not.toContain('.from("prep_batch_sessions")');
  });
});

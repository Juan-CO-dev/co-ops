import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrepError, submitAmPrep, hashAmPrepIntent } from "@/lib/prep";
import { hasTaskAccess, auditTaskOverride } from "@/lib/assignments";
import { audit } from "@/lib/audit";
import { mapPrepError } from "@/app/api/prep/_helpers";
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const INSTANCE = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const actor = { userId: "actor", role: "key_holder" as const, level: 4 };
function fixture(opts: { edit?: boolean; otherActor?: boolean; noMatch?: boolean; badHash?: boolean; wrongMode?: boolean; payload?: boolean; open?: boolean; error?: { code: string; message: string } } = {}) {
  const reads: string[] = [];
  const instance = { id: INSTANCE, location_id: "shop", date: "2026-11-04", status: opts.open ? "open" : "confirmed", template_id: "prep-template" };
  const rpc = vi.fn(async () => ({ data: { instance, submissionId: "saved", completionIds: ["completion"], autoCompleteId: "closing", editCount: opts.edit ? 3 : 0, originalSubmissionId: opts.edit ? "head" : null, replayed: true }, error: opts.error ?? null }));
  const from = (table: string) => {
    reads.push(table);
    let chain = false;
    const q = { select: () => q, or: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, eq: (key: string) => { if (key === "id" && table === "checklist_submissions") chain = true; return q; },
      maybeSingle: async () => ({ data: table === "checklist_instances" ? instance : chain ? { id: "head", instance_id: INSTANCE, submitted_by: opts.otherActor ? "someone-else" : actor.userId, original_submission_id: null, completion_ids: [] } : opts.noMatch ? null : { id: "saved", client_request_hash: opts.badHash ? "wrong" : hashAmPrepIntent({ entries: [], isUpdate: opts.edit, originalSubmissionId: opts.edit ? "head" : undefined }), completion_ids: ["completion"], edit_count: opts.edit ? 3 : 0, original_submission_id: opts.wrongMode ? "different-head" : opts.edit ? "head" : null, submitted_at: "2026-11-04T12:00:00.123456+00:00" }, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: table === "checklist_submissions" ? [{ edit_count: 3, completion_ids: [] }]
        : table === "checklist_instances" ? [{ id: "closing", template_id: "closing-template" }]
        : table === "checklist_template_items" ? opts.payload ? [{ id: KEY, template_id: "prep-template", station: "sauces", label: "Mayo", display_order: 1, active: true, item_id: null, translations: null, prep_meta: { section: "sauces", parValue: 4, parUnit: "Bottle", specialInstruction: null, columns: ["par", "total"] } }] : opts.noMatch ? [] : [{ id: "ref" }]
        : table === "checklist_completions" ? [{ id: "wrong-microsecond", auto_complete_meta: { reportSubmittedAt: "2026-11-04T12:00:00.123455Z" } }, { id: "closing", auto_complete_meta: { reportSubmittedAt: "2026-11-04T12:00:00.123456Z" } }] : [], error: null })) };
    return q;
  };
  return { service: { from, rpc } as unknown as SupabaseClient, rpc, reads };
}
const args = { instanceId: INSTANCE, actor, entries: [], closingReportRefItemId: null, activeAssignmentId: null, clientRequestId: KEY };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasTaskAccess).mockResolvedValue(true); });
describe("0291 authorized replay", () => {
  it.each([false, true])("replays confirmed/capped intent without success or override audits (edit=%s)", async (edit) => {
    const f = fixture({ edit });
    const result = await submitAmPrep(f.service, { ...args, isUpdate: edit, originalSubmissionId: edit ? "head" : undefined });
    expect(result).toMatchObject({ replayed: true, submittedCompletionIds: ["completion"] });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(result.closingAutoCompleteId).toBe(edit ? null : "closing");
    expect(audit).not.toHaveBeenCalled();
    expect(auditTaskOverride).not.toHaveBeenCalled();
  });
  it("a new key bypasses the stale JS open check and lets SQL decide", async () => {
    const f = fixture({ noMatch: true, error: { code: "23514", message: "instance not open" } });
    await expect(submitAmPrep(f.service, args)).rejects.toMatchObject({ code: "already_submitted" });
    expect(f.rpc).toHaveBeenCalledWith("submit_am_prep_atomic", expect.objectContaining({ p_client_request_id: KEY }));
  });
  it("a new keyed edit at cap bypasses JS cap and receives the SQL refusal", async () => {
    const f = fixture({ edit: true, noMatch: true, error: { code: "P0001", message: "edit limit exceeded" } });
    await expect(submitAmPrep(f.service, { ...args, isUpdate: true, originalSubmissionId: "head" })).rejects.toMatchObject({ code: "edit_limit_exceeded" });
    expect(f.rpc).toHaveBeenCalledOnce();
  });
  it("checks current task authorization before looking up a key", async () => {
    vi.mocked(hasTaskAccess).mockResolvedValue(false);
    const f = fixture();
    await expect(submitAmPrep(f.service, args)).rejects.toMatchObject({ code: "prep_role_violation" });
    expect(f.reads).toEqual(["checklist_instances"]);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("checks chain identity before replay", async () => {
    const f = fixture({ edit: true, otherActor: true });
    await expect(submitAmPrep(f.service, { ...args, actor: { ...actor, level: 3 }, isUpdate: true, originalSubmissionId: "head" })).rejects.toMatchObject({ code: "edit_access_denied" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("dispatches reuse before blanket P0001 cap mapping", async () => {
    const f = fixture({ edit: true, badHash: true });
    await expect(submitAmPrep(f.service, { ...args, isUpdate: true, originalSubmissionId: "head" })).rejects.toMatchObject({ code: "prep_request_key_reused" });
  });
  it.each([false, true])("rejects a stored hash or mode mismatch without RPC (mode=%s)", async (wrongMode) => {
    const f = fixture({ wrongMode, badHash: !wrongMode });
    const error = await submitAmPrep(f.service, args).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrepError);
    expect(mapPrepError(error as PrepError).status).toBe(409);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])("maps only the named request-key constraint (edit=%s)", async (edit) => {
    const f = fixture({ edit, noMatch: true, error: { code: "23505", message: 'duplicate key value violates unique constraint "checklist_submissions_client_request_unique"' } });
    await expect(submitAmPrep(f.service, { ...args, isUpdate: edit, originalSubmissionId: edit ? "head" : undefined })).rejects.toMatchObject({ code: "already_submitted" });
  });
  it.each([false, true])("logs unrelated unique violations without payload and keeps a 500 error (edit=%s)", async (edit) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const f = fixture({ edit, noMatch: true, error: { code: "23505", message: 'duplicate key value violates unique constraint "completion_live_head"' } });
      const error = await submitAmPrep(f.service, { ...args, isUpdate: edit, originalSubmissionId: edit ? "head" : undefined }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PrepError);
      expect(log).toHaveBeenCalledWith("submitAmPrep: unexpected unique violation", { instanceId: INSTANCE, code: "23505", constraint: "completion_live_head" });
    } finally { log.mockRestore(); }
  });
  it.each([false, true])("preserves the 23514 drain contract (keyed=%s)", async (keyed) => {
    const f = fixture({ noMatch: true, open: true, error: { code: "23514", message: "instance not open" } });
    await expect(submitAmPrep(f.service, { ...args, clientRequestId: keyed ? KEY : undefined })).rejects.toMatchObject({ code: keyed ? "already_submitted" : "prep_instance_not_open" });
    expect(f.rpc).toHaveBeenCalledOnce();
  });
  it("a lookup miss submits the real keyed payload with its snapshot", async () => {
    const f = fixture({ noMatch: true, payload: true, open: true });
    const entries = [{ templateItemId: KEY, inputs: { total: 2 } }];
    await submitAmPrep(f.service, { ...args, entries });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("submit_am_prep_atomic", expect.objectContaining({
      p_client_request_id: KEY, p_client_request_hash: hashAmPrepIntent({ entries }),
      p_entries: [expect.objectContaining({ ...entries[0], snapshot: expect.objectContaining({ itemName: "Mayo" }) })],
    }));
  });
  it("canonicalizes entry/input order but distinguishes intent and edit mode", () => {
    const a = { templateItemId: INSTANCE, inputs: { onHand: 1, backUp: 2 } };
    const b = { templateItemId: KEY, inputs: { yesNo: true } };
    expect(hashAmPrepIntent({ entries: [a,b] })).toBe("58f536ecf2b513b3084e71878f7ea4b16f655c867b73e3b5bb9816f8b6e1631e");
    expect(hashAmPrepIntent({ entries: [a,b] })).toBe(hashAmPrepIntent({ entries: [b, { ...a, inputs: { backUp: 2, onHand: 1 } }] }));
    expect(hashAmPrepIntent({ entries: [a] })).not.toBe(hashAmPrepIntent({ entries: [a], isUpdate: true, originalSubmissionId: KEY }));
    expect(hashAmPrepIntent({ entries: [a] })).not.toBe(hashAmPrepIntent({ entries: [{ ...a, inputs: { onHand: 2 } }] }));
  });
});

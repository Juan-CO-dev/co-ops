import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { submitAmPrep, hashAmPrepIntent } from "@/lib/prep";
import { hasTaskAccess, auditTaskOverride } from "@/lib/assignments";
import { audit } from "@/lib/audit";
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const INSTANCE = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const actor = { userId: "actor", role: "key_holder" as const, level: 4 };
function fixture(opts: { edit?: boolean; otherActor?: boolean; noMatch?: boolean; error?: { code: string; message: string } } = {}) {
  const reads: string[] = [];
  const instance = { id: INSTANCE, location_id: "shop", date: "2026-11-04", status: "confirmed" };
  const rpc = vi.fn(async () => ({ data: { instance, submissionId: "saved", completionIds: ["completion"], autoCompleteId: "closing", editCount: opts.edit ? 3 : 0, originalSubmissionId: opts.edit ? "head" : null, replayed: true }, error: opts.error ?? null }));
  const from = (table: string) => {
    reads.push(table);
    let chain = false;
    const q = { select: () => q, or: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, eq: (key: string) => { if (key === "id" && table === "checklist_submissions") chain = true; return q; },
      maybeSingle: async () => ({ data: table === "checklist_instances" ? instance : chain ? { id: "head", instance_id: INSTANCE, submitted_by: opts.otherActor ? "someone-else" : actor.userId, original_submission_id: null, completion_ids: [] } : opts.noMatch ? null : { id: "saved" }, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: table === "checklist_submissions" ? [{ edit_count: 3, completion_ids: [] }] : [], error: null })) };
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
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.reads).not.toContain("checklist_templates");
    expect(f.reads).not.toContain("checklist_template_items");
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
    const f = fixture({ edit: true, error: { code: "P0001", message: "prep_request_key_reused" } });
    await expect(submitAmPrep(f.service, { ...args, isUpdate: true, originalSubmissionId: "head" })).rejects.toMatchObject({ code: "prep_request_key_reused" });
  });
  it("maps any unexpected unique violation to already_submitted", async () => {
    const f = fixture({ error: { code: "23505", message: "unique violation" } });
    await expect(submitAmPrep(f.service, args)).rejects.toMatchObject({ code: "already_submitted" });
  });
  it("canonicalizes entry/input order but distinguishes intent and edit mode", () => {
    const a = { templateItemId: INSTANCE, inputs: { onHand: 1, backUp: 2 } };
    const b = { templateItemId: KEY, inputs: { yesNo: true } };
    expect(hashAmPrepIntent({ entries: [a,b] })).toBe(hashAmPrepIntent({ entries: [b, { ...a, inputs: { backUp: 2, onHand: 1 } }] }));
    expect(hashAmPrepIntent({ entries: [a] })).not.toBe(hashAmPrepIntent({ entries: [a], isUpdate: true, originalSubmissionId: KEY }));
    expect(hashAmPrepIntent({ entries: [a] })).not.toBe(hashAmPrepIntent({ entries: [{ ...a, inputs: { onHand: 2 } }] }));
  });
});

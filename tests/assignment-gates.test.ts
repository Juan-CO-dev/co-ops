import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const assignmentService = vi.hoisted(() => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => assignmentService }));
import { hasTaskAccess } from "@/lib/assignments";
import { canAccessOpeningInstance, savePhase2Item, submitPhase1Atomic, submitPhase2Atomic, revokePhase2Completion, OpeningRoleViolationError } from "@/lib/opening";
import { submitAmPrep, submitMidDayPhase1, saveMidDayPhase2Item, finalizeMidDayPhase2, PrepRoleViolationError } from "@/lib/prep";
import { submitCashReport } from "@/lib/cash";

import { requireChecklistTaskAccess, completeItem, submitBatch, confirmInstance, revokeCompletion, revokeWithReason, dropInstance, ChecklistRoleViolationError } from "@/lib/checklists";

const actor = { userId: "employee", role: "employee" as const, level: 3 };
function instanceClient() {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { location_id: "stored-shop", date: "2026-10-07" }, error: null }) };
  const from = vi.fn((_table: string) => query);
  const rpc = vi.fn(() => { throw new Error("unauthorized write reached RPC"); });
  return { service: { from, rpc } as unknown as SupabaseClient, from, rpc };
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasTaskAccess).mockResolvedValue(false); });

describe("assignment gates at the writer boundary", () => {
  it("opening scope comes from the stored instance and allows an assigned employee", async () => {
    const { service } = instanceClient();
    vi.mocked(hasTaskAccess).mockResolvedValue(true);
    expect(await canAccessOpeningInstance(service, { instanceId: "instance", actor })).toBe(true);
    expect(hasTaskAccess).toHaveBeenCalledWith(service, { ...actor, locationId: "stored-shop", date: "2026-10-07", task: "opening_report" });
  });

  it("retracted opening assignment blocks original submits, update bypass, saves and revokes before RPC", async () => {
    const { service, rpc } = instanceClient();
    const base = { instanceId: "instance", actor };
    await expect(submitPhase1Atomic(service, { ...base, entries: [], sectionVerifications: [], openerNoPriorDataAttestation: null, isUpdate: true })).rejects.toBeInstanceOf(OpeningRoleViolationError);
    await expect(submitPhase2Atomic(service, { ...base, isUpdate: true })).rejects.toBeInstanceOf(OpeningRoleViolationError);
    await expect(savePhase2Item(service, { ...base, locationId: "body-shop", entry: {} as Parameters<typeof savePhase2Item>[1]["entry"] })).rejects.toBeInstanceOf(OpeningRoleViolationError);
    await expect(revokePhase2Completion(service, { ...base, completionId: "completion" })).rejects.toBeInstanceOf(OpeningRoleViolationError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("all mid-day writers refuse a revoked assignment before loading items or writing", async () => {
    const { service, rpc, from } = instanceClient();
    const base = { instanceId: "instance", actor };
    await expect(submitMidDayPhase1(service, { ...base, entries: [] })).rejects.toBeInstanceOf(PrepRoleViolationError);
    await expect(saveMidDayPhase2Item(service, { ...base, templateItemId: "item", prepped: 1 })).rejects.toBeInstanceOf(PrepRoleViolationError);
    await expect(finalizeMidDayPhase2(service, base)).rejects.toBeInstanceOf(PrepRoleViolationError);
    expect(from.mock.calls.every(([table]) => table === "checklist_instances")).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("AM prep ignores a stale assignment ID and checks update calls too", async () => {
    const { service, rpc } = instanceClient();
    const base = { instanceId: "instance", actor, entries: [], closingReportRefItemId: null, activeAssignmentId: "stale-assignment" };
    await expect(submitAmPrep(service, base)).rejects.toBeInstanceOf(PrepRoleViolationError);
    await expect(submitAmPrep(service, { ...base, isUpdate: true, originalSubmissionId: "old" })).rejects.toBeInstanceOf(PrepRoleViolationError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cash rejects a revoked assignment before superseding any history", async () => {
    const { service, from } = instanceClient();
    const result = await submitCashReport(service, { actor, locationId: "shop", date: "2026-10-07", projectedCents: 0, drawerTotalCents: 0, floatCents: 0, countMethod: "hand", denominations: null, cashTipsCents: 0, onShift: [], overShortNote: null });
    expect(result).toEqual({ ok: false, reason: "assignment_required" });
    expect(from).not.toHaveBeenCalled();
  });
});

function genericClient(type = "opening", prepSubtype: string | null = null) {
  const from = vi.fn((table: string) => {
    const data = table === "checklist_instances"
      ? { id: "instance", template_id: "template", location_id: "stored-shop", date: "2026-10-07", status: "open" }
      : table === "checklist_templates" ? { type, prep_subtype: prepSubtype }
      : table === "checklist_completions" ? { id: "completion", instance_id: "instance", completed_by: actor.userId }
      : null;
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
    return query;
  });
  return { service: { from } as unknown as SupabaseClient, from };
}

describe("generic checklist routes cannot bypass task assignment", () => {
  it.each([
    ["opening", null, "opening_report"],
    ["prep", "am_prep", "am_prep"],
    ["prep", "mid_day_prep", "mid_day_prep"],
  ])("binds %s/%s to its task and stored instance scope", async (type, subtype, task) => {
    const { service } = genericClient(type!, subtype);
    vi.mocked(hasTaskAccess).mockResolvedValue(true);
    await expect(requireChecklistTaskAccess(service, "instance", actor)).resolves.toBeUndefined();
    expect(hasTaskAccess).toHaveBeenCalledWith(assignmentService, { userId: actor.userId, level: 3, locationId: "stored-shop", date: "2026-10-07", task });
    vi.mocked(hasTaskAccess).mockResolvedValue(false);
    await expect(requireChecklistTaskAccess(service, "instance", actor)).rejects.toBeInstanceOf(ChecklistRoleViolationError);
  });

  it("leaves closing available to all levels", async () => {
    const { service, from } = genericClient("closing");
    await expect(requireChecklistTaskAccess(service, "instance", actor)).resolves.toBeUndefined();
    expect(hasTaskAccess).not.toHaveBeenCalled();
    from.mockClear();
    await expect(requireChecklistTaskAccess(service, "instance", { ...actor, level: 4 })).resolves.toBeUndefined();
    expect(hasTaskAccess).not.toHaveBeenCalled();
  });

  it("blocks complete, submit, confirm, self-revoke and drop before mutation", async () => {
    const { service } = genericClient();
    const base = { actor, instanceId: "instance" };
    await expect(completeItem(service, { ...base, templateItemId: "item" })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    await expect(submitBatch(service, { ...base, completionIds: ["completion"] })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    await expect(confirmInstance(service, { ...base, pin: "1234", incompleteReasons: [] })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    await expect(revokeCompletion(service, { actor, completionId: "completion" })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    await expect(revokeWithReason(service, { actor, completionId: "completion", reason: "not_actually_done" })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    await expect(dropInstance(service, { ...base, reason: "change" })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
  });
});


describe("manager roles never bypass a task assigned to somebody else", () => {
  it.each([4, 5, 6, 7, 9])("refuses level %i across opening, prep, and generic checklist writes", async (level) => {
    const elevated = { ...actor, level };
    const { service, rpc } = instanceClient();
    expect(await canAccessOpeningInstance(service, { instanceId: "instance", actor: elevated })).toBe(false);
    await expect(submitAmPrep(service, { instanceId: "instance", actor: elevated, entries: [], activeAssignmentId: null, closingReportRefItemId: null, isUpdate: true })).rejects.toBeInstanceOf(PrepRoleViolationError);
    await expect(finalizeMidDayPhase2(service, { instanceId: "instance", actor: elevated })).rejects.toBeInstanceOf(PrepRoleViolationError);
    await expect(requireChecklistTaskAccess(genericClient().service, "instance", elevated)).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    expect(rpc).not.toHaveBeenCalled();
  });
});

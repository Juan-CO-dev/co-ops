import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canCompleteChecklistItem, evaluateLockUpGate } from "@/lib/checklist-constants";
const mocks = vi.hoisted(() => ({ service: {} as unknown, insert: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => mocks.service }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => false), auditTaskOverride: vi.fn() }));
import { completeItem, confirmInstance, ChecklistFinalizeGateError, ChecklistRoleViolationError } from "@/lib/checklists";

function client(type = "closing", reference: string | null = null, floor = 4) {
  const item = { id: "item", template_id: "template", min_role_level: floor, active: true,
    report_reference_type: reference, ref_track_item_completion: false, references_template_item_id: null,
    required: false, expects_count: false, expects_photo: false, input_type: null };
  const from = (table: string) => {
    let inserted = false;
    const row = table === "checklist_instances" ? { id: "instance", template_id: "template", location_id: "shop", date: "2026-10-07", status: "open" }
      : table === "checklist_templates" ? { id: "template", type, single_submission_only: false }
      : table === "checklist_template_items" ? item : { id: "completion", instance_id: "instance", template_item_id: "item", completed_by: "trainee" };
    const query = {
      select: () => query, eq: () => query, is: () => query,
      update: () => query,
      insert: (payload: unknown) => { mocks.insert(payload); inserted = true; return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: inserted ? row : [], error: null, count: 0 }).then(resolve),
    };
    return query;
  };
  return { from } as unknown as SupabaseClient;
}
const actor = { userId: "trainee", role: "trainee" as const, level: 2 };
beforeEach(() => { vi.clearAllMocks(); mocks.service = client(); });

describe("closing manual work preserves each item role floor", () => {
  it("refuses employee completion of a KH-only closing item", async () => {
    await expect(completeItem(client(), { instanceId: "instance", templateItemId: "item",
      actor: { userId: "employee", role: "employee", level: 3 } })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("allows a trainee to complete a closing item whose floor is trainee", async () => {
    await expect(completeItem(client("closing", null, 2), { instanceId: "instance", templateItemId: "item", actor })).resolves.toMatchObject({ completion: { id: "completion" } });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ completed_by: "trainee" }));
  });
  it("refuses direct manual completion of a report-reference task", async () => {
    await expect(completeItem(client("closing", "cash_report"), { instanceId: "instance", templateItemId: "item", actor })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("leaves other checklist task floors enforced", async () => {
    await expect(completeItem(client("opening"), { instanceId: "instance", templateItemId: "item", actor })).rejects.toBeInstanceOf(ChecklistRoleViolationError);
    expect(canCompleteChecklistItem({ templateType: "opening", actorLevel: 2, itemMinRoleLevel: 3, reportReferenceType: null })).toBe(false);
  });
  it("keeps KH finalization enforced by the real confirmation writer", async () => {
    await expect(confirmInstance(client(), { instanceId: "instance", actor, pin: "1234", incompleteReasons: [] })).rejects.toBeInstanceOf(ChecklistFinalizeGateError);
    expect(evaluateLockUpGate({ templateType: "closing", actorLevel: 2, floorLevel: 4, items: [], completedItemIds: new Set() })).toEqual({ ok: false, reason: "role" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("tracked item references are not manual closing work", () => {
    expect(canCompleteChecklistItem({ templateType: "closing", actorLevel: 2, itemMinRoleLevel: 4, reportReferenceType: null, refTrackItemCompletion: true, referencesTemplateItemId: "source" })).toBe(false);
  });
});

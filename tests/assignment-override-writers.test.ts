import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignTask, retractTask, writeStationEvent, type AssignmentActor } from "@/lib/assignments";
import type { OverrideReason } from "@/lib/assignments-shared";
import { audit } from "@/lib/audit";
import { enqueueNotification } from "@/lib/notifications";
import { POST } from "@/app/api/assignments/route";
import { requireSession } from "@/lib/session";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
const shop = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333";
const id = "44444444-4444-4444-8444-444444444444";
const actor: AssignmentActor = { userId: actorId, role: "key_holder", level: 4, locations: [shop] };
const persisted = { id, changed: true, reason_code: "correction", reason_note: "stored note", overridden_assigner_id: "senior" };
function fake(changed = true, error: string | null = null) {
  const from = vi.fn((table: string) => {
    const q = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "users" ? { role: "employee" } : { user_id: target }, error: null }) };
    return q;
  });
  const rpc = vi.fn(async () => ({ data: { ...persisted, changed }, error: error ? { message: error, code: "P0001" } : null }));
  return { service: { from, rpc } as unknown as SupabaseClient, from, rpc };
}
const operations = [
  ["task change", (service: SupabaseClient, reason: OverrideReason) => assignTask(service, { actor, locationId: shop, userId: target, task: "am_prep", ...reason })],
  ["task retract", (service: SupabaseClient, reason: OverrideReason) => retractTask(service, { actor, locationId: shop, assignmentId: id, ...reason })],
  ["station move", (service: SupabaseClient, reason: OverrideReason) => writeStationEvent(service, { actor, locationId: shop, userId: target, stationId: id, positionId: id, manage: true, ...reason })],
  ["station release", (service: SupabaseClient, reason: OverrideReason) => writeStationEvent(service, { actor, locationId: shop, userId: target, stationId: null, positionId: null, manage: true, ...reason })],
] as const;
afterEach(() => vi.clearAllMocks());
describe.each(operations)("%s reason contract", (_label, write) => {
  it("rejects malformed reason before RPC", async () => {
    const f = fake();
    await expect(write(f.service, { reasonCode: "other", reasonNote: " " })).rejects.toMatchObject({ code: "invalid_payload", status: 400 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("maps the locked RPC hierarchy refusal to 422", async () => {
    const f = fake(true, "override_reason_required");
    await expect(write(f.service, {})).rejects.toMatchObject({ code: "override_reason_required", status: 422 });
    expect(audit).not.toHaveBeenCalled(); expect(enqueueNotification).not.toHaveBeenCalled();
  });
  it("sends reason atomically and audits/notifies the persisted context", async () => {
    const f = fake();
    await write(f.service, { reasonCode: "other", reasonNote: " request note " });
    expect(f.rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ p_reason_code: "other", p_reason_note: "request note" }));
    const context = { reason_code: "correction", reason_note: "stored note", overridden_assigner_id: "senior" };
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ resourceId: id, metadata: expect.objectContaining(context) }));
    expect(enqueueNotification).toHaveBeenCalledWith(f.service, expect.objectContaining({ relatedId: id, extraData: context,
      recipients: [{ userId: "senior", deliveryMethod: "in_app" }] }));
  });
  it("does not audit or notify an unchanged retry", async () => {
    await write(fake(false).service, { reasonCode: "correction" });
    expect(audit).not.toHaveBeenCalled(); expect(enqueueNotification).not.toHaveBeenCalled();
  });
  it.each([2, 3])("still refuses a level %s manager action", async (level) => {
    const f = fake();
    const deniedActor: AssignmentActor = { ...actor, level, role: level === 2 ? "trainee" : "employee" };
    await expect(assignTask(f.service, { actor: deniedActor, locationId: shop, userId: target, task: "am_prep", reasonCode: "correction" })).rejects.toMatchObject({ code: "role_insufficient" });
    await expect(retractTask(f.service, { actor: deniedActor, locationId: shop, assignmentId: id })).rejects.toMatchObject({ code: "role_insufficient" });
    await expect(writeStationEvent(f.service, { actor: deniedActor, locationId: shop, userId: target, stationId: null, positionId: null, manage: true })).rejects.toMatchObject({ code: "role_insufficient" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
it("API rejects invalid reason input before acquiring a write client", async () => {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: actorId }, role: "key_holder", level: 4, locations: [shop] } as Awaited<ReturnType<typeof requireSession>>);
  const response = await POST(new Request("http://localhost/api/assignments", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ locationId: shop, action: "task_retract", assignmentId: id, reasonCode: "other", reasonNote: "" }) }) as NextRequest);
  expect(response.status).toBe(400);
});

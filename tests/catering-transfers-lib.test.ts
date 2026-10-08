import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { transferCateringLead } from "@/lib/catering/transfers";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));
vi.mock("@/lib/catering/pipeline", () => ({ CateringPipelineError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));
const rpc = vi.fn();
const target = "00000000-0000-4000-8000-000000000002";
function actor(unlocked = true, time = new Date().toISOString()): AuthContext {
  return { user: { id: "actor", role: "owner" }, locations: [],
    session: { stepUpUnlocked: unlocked, stepUpUnlockedAt: time } } as unknown as AuthContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCateringReader).mockResolvedValue({ role: "catering_mgr", active: true, locations: [] });
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  rpc.mockResolvedValue({ data: { result: "moved", prep_preserved: true }, error: null });
});
it.each([null, { role: "gm" as const, active: true, locations: [] }])("refuses inactive/demoted fresh identity despite owner session", async (fresh) => {
  vi.mocked(loadCateringReader).mockResolvedValue(fresh);
  await expect(transferCateringLead(actor(), "lead", { locationId: target, reason: "capacity" })).rejects.toMatchObject({ status: 403 });
  expect(rpc).not.toHaveBeenCalled();
});
it.each([actor(false), actor(true, "2020-01-01T00:00:00Z")])("refuses absent or stale step-up before RPC", async (ctx) => {
  await expect(transferCateringLead(ctx, "lead", { locationId: target, reason: "capacity" })).rejects.toMatchObject({ status: 403 });
  expect(rpc).not.toHaveBeenCalled();
});
it("allows fresh catering manager across shops with normalized bounded note", async () => {
  await expect(transferCateringLead(actor(), "lead", { locationId: target, reason: "other", note: "  Customer requested  " })).resolves.toMatchObject({ result: "moved" });
  expect(rpc).toHaveBeenCalledWith("transfer_catering_lead", {
    p_lead_id: "lead", p_location_id: target, p_actor_id: "actor", p_reason: "other", p_note: "Customer requested",
  });
});
it.each([["transfer_forbidden", 403], ["transfer_lead_not_found", 404], ["transfer_invalid_location", 400]] as const)("maps safe RPC refusals %s", async (message, status) => {
  rpc.mockResolvedValue({ data: null, error: { message } });
  await expect(transferCateringLead(actor(), "lead", { locationId: target, reason: "capacity" })).rejects.toMatchObject({ status });
});
it.each(["PGRST202", "42883", "42P01", "42703", "PGRST204", "PGRST205"])("makes missing schema retryable (%s)", async (code) => {
  rpc.mockResolvedValue({ data: null, error: { code } });
  await expect(transferCateringLead(actor(), "lead", { locationId: target, reason: "capacity" })).rejects.toMatchObject({ status: 503, code: "catering_transfer_unavailable" });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("retries an aborted deadlock transaction with identical arguments", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "40P01" } });
  await expect(transferCateringLead(actor(), "lead", { locationId: target, reason: "capacity" })).resolves.toMatchObject({ result: "moved" });
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
});
it("bounds deadlock retries and asks caller to retry", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "40P01" } });
  await expect(transferCateringLead(actor(), "lead", { locationId: target, reason: "capacity" })).rejects.toMatchObject({ status: 503, code: "catering_transfer_retry" });
  expect(rpc).toHaveBeenCalledTimes(3);
});

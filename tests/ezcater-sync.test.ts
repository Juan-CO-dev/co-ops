import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syncEzcaterOrder, ezcaterSyncError } from "@/lib/ezcater/sync";
import { fetchEzcaterOrder } from "@/lib/ezcater/orders";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { normalizeEzcaterOrder } from "@/lib/ezcater/orders-shared";
import { EzcaterApiError } from "@/lib/ezcater/client";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ezcater/orders", () => ({ fetchEzcaterOrder: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
const uuid = "00000000-0000-4000-8000-000000000001";
const rpc = vi.fn();
const ok = { data: { lead_id: "lead", result: "refreshed" }, error: null };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EZCATER_API_TOKEN", "test-only"); vi.stubEnv("EZCATER_FIXTURES", "0");
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve(ok) }));
  vi.mocked(fetchEzcaterOrder).mockResolvedValue(normalizeEzcaterOrder({ orderNumber: "TEST",
    caterer: { uuid: "caterer" }, event: { timestamp: "2026-10-09T00:01:00Z" },
    totals: { subTotal: { subunits: 100 }, tip: { subunits: 20 } },
    contact: { name: "PRIVATE CUSTOMER" }, catererCart: { orderItems: [] } }));
});
afterEach(() => vi.unstubAllEnvs());

it("publishes snapshot/projection once via RPC and hashes semantics consistently", async () => {
  await syncEzcaterOrder(uuid, "caterer"); await syncEzcaterOrder(uuid, "caterer");
  expect(rpc).toHaveBeenCalledTimes(2);
  const args = rpc.mock.calls[0]?.[1];
  expect(args.p_snapshot).toMatchObject({ eventDate: "2026-10-08", subtotalCents: 100, tipCents: 20 });
  expect(args.p_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(args.p_digest).toBe(rpc.mock.calls[1]?.[1].p_digest);
  expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("PRIVATE CUSTOMER");
});

it("stores a retry code and original lifecycle event when provider fetch fails", async () => {
  vi.mocked(fetchEzcaterOrder).mockRejectedValue(new EzcaterApiError(502, "graphql_error", "PRIVATE CUSTOMER"));
  expect(await syncEzcaterOrder(uuid, "caterer", { eventKey: "accepted" })).toEqual({ lead_id: null, result: "error:graphql_error" });
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_snapshot: null, p_error: "graphql_error", p_event_key: "accepted" });
  expect(JSON.stringify(rpc.mock.calls)).not.toContain("PRIVATE CUSTOMER");
});

it("does not apply an order from a different caterer", async () => {
  expect(await syncEzcaterOrder(uuid, "foreign")).toMatchObject({ result: "error:location_mismatch" });
  expect(rpc.mock.calls[0]?.[1].p_snapshot).toBeNull();
});

it("failed retry persistence propagates for webhook retry", async () => {
  vi.mocked(fetchEzcaterOrder).mockRejectedValue(new Error("PRIVATE CUSTOMER"));
  rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ error: { message: "PRIVATE" } }) }));
  await expect(syncEzcaterOrder(uuid, "caterer")).rejects.toThrow("apply_failed");
});

it("an expired provider signal does not cancel the separately bounded retry marker", async () => {
  const controller = new AbortController(); controller.abort();
  vi.mocked(fetchEzcaterOrder).mockRejectedValue(new EzcaterApiError(504, "timeout"));
  const signals: AbortSignal[] = [];
  rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { signals.push(signal); return Promise.resolve(ok); } }));
  await syncEzcaterOrder(uuid, "caterer", { signal: controller.signal, eventKey: "cancelled" });
  expect(signals[0]?.aborted).toBe(false);
  expect(signals[0]).not.toBe(controller.signal);
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_snapshot: null, p_event_key: "cancelled" });
});

it.each([undefined, ""])("refuses missing credentials before fixture fetch (%s)", async (token) => {
  vi.stubEnv("EZCATER_API_TOKEN", token);
  await expect(syncEzcaterOrder(uuid, "caterer")).rejects.toThrow("ezcater_disabled");
  expect(fetchEzcaterOrder).not.toHaveBeenCalled();
});
it("refuses explicit fixture mode", async () => {
  vi.stubEnv("EZCATER_FIXTURES", "1");
  await expect(syncEzcaterOrder(uuid, "caterer")).rejects.toThrow("ezcater_disabled");
  expect(rpc).not.toHaveBeenCalled();
});
it("does not persist arbitrary provider code strings", () => {
  expect(ezcaterSyncError(new EzcaterApiError(502, "PRIVATE CUSTOMER"))).toBe("sync_failed");
});

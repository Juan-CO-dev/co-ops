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
  rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(args.p_error
    ? { data: { lead_id: null, result: `error:${args.p_error}`, sync_error: args.p_error }, error: null } : ok) }));
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
  expect(await syncEzcaterOrder(uuid, "caterer", { eventKey: "accepted" })).toMatchObject({ lead_id: null, result: "error:graphql_error" });
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_snapshot: null, p_error: "graphql_error", p_event_key: "accepted" });
  expect(JSON.stringify(rpc.mock.calls)).not.toContain("PRIVATE CUSTOMER");
});

it("uses freshly fetched caterer on reassignment; the RPC binds it to an active shop", async () => {
  expect(await syncEzcaterOrder(uuid, "former-caterer")).toMatchObject({ result: "refreshed" });
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_caterer_uuid: "caterer" });
  expect(rpc.mock.calls[0]?.[1].p_snapshot.locationObservedAt).toBeTruthy();
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

 it.each(["timeout", "network_error"])("preserves retry code %s", (code) => {
  expect(ezcaterSyncError(new EzcaterApiError(502, code))).toBe(code);
 });
 it.each(["PGRST202", "42883"])("signals missing RPC for retryable 503 (%s)", async (code) => {
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ error: { code } }) }));
  await expect(syncEzcaterOrder(uuid, "caterer")).rejects.toThrow("ezcater_schema_unavailable");
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it("preserves cancellation stage move and audits it after provider failure", async () => {
  vi.mocked(fetchEzcaterOrder).mockRejectedValue(new EzcaterApiError(502, "network_error"));
  const result = { lead_id: "lead", result: "stage_moved", from_stage: "confirmed", to_stage: "lost", sync_error: "network_error" };
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: result, error: null }) }));
  expect(await syncEzcaterOrder(uuid, "caterer", { eventKey: "cancelled" })).toEqual(result);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.pipeline.stage_move", resourceId: "lead", metadata: expect.objectContaining({ from_stage: "confirmed", to_stage: "lost" }) }));
 });
 it("restores create audit from RPC result", async () => {
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: { lead_id: "lead", result: "created_lead_confirmed", created: true, from_stage: null, to_stage: "confirmed" }, error: null }) }));
  await syncEzcaterOrder(uuid, "caterer");
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.pipeline.create", resourceId: "lead" }));
  expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "catering.pipeline.stage_move" }));
 });

it("missing RPC after failed provider fetch still requests deployment retry", async () => {
  vi.mocked(fetchEzcaterOrder).mockRejectedValue(new EzcaterApiError(502, "network_error"));
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ error: { code: "PGRST202" } }) }));
  await expect(syncEzcaterOrder(uuid, "caterer", { eventKey: "cancelled" })).rejects.toThrow("ezcater_schema_unavailable");
});

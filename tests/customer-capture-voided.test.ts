/** W12/B176: Toast capture re-syncs voided / deleted orders for the shop-day after every customer ingest. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no real client"); } }));
import { persistCapturedCustomers } from "@/lib/customers/capture";

const LOC = "11111111-1111-4111-8111-111111111111";
function client(syncError: { code?: string; message?: string } | null = null) {
  const calls: [string, Record<string, unknown>][] = [];
  const empty = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "range", "abortSignal"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return q;
  };
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args]);
    const result = fn === "customer_orders_sync_voided"
      ? { data: syncError ? null : { voided: 1, restored: 0 }, error: syncError }
      : fn === "customer_ingest_orders" ? { data: { linked: 1, skipped: 0, created: 1, customer_ids: [] }, error: null }
      : { data: [], error: null };
    return { abortSignal: () => Promise.resolve(result), then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r) };
  });
  return { calls, sb: { rpc, from: vi.fn(() => empty()) } };
}

beforeEach(() => { vi.stubEnv("CUSTOMER_PROFILES", "1"); });

describe("persistCapturedCustomers void sync", () => {
  it("the void sync runs for the shop-day even when every order was voided", async () => {
    const { calls, sb } = client();
    const r = await persistCapturedCustomers(LOC, [{ guid: "O1", businessDate: 20261101, voided: true }], { businessDate: "2026-11-01", client: sb as never });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c[0])).toEqual(["customer_orders_sync_voided"]);
    expect(calls[0]![1]).toEqual({ p_location_id: LOC, p_business_date: "2026-11-01" });
  });
  it("before 0312 is applied the missing sync is not a capture failure", async () => {
    const { sb } = client({ code: "PGRST202", message: "Could not find the function" });
    const r = await persistCapturedCustomers(LOC, [], { businessDate: "2026-11-01", client: sb as never });
    expect(r).toMatchObject({ ok: true, error: null });
  });
  it("a failed sync reports a fixed code, never a database message", async () => {
    const { sb } = client({ code: "XX000", message: "guest@example.com" });
    const r = await persistCapturedCustomers(LOC, [], { businessDate: "2026-11-01", client: sb as never });
    expect(r).toMatchObject({ ok: false, error: "customer_capture_failed" });
    expect(JSON.stringify(r)).not.toContain("guest@example.com");
  });
  it("without a business date nothing is synced (a caller that cannot name the day)", async () => {
    const { calls, sb } = client();
    await persistCapturedCustomers(LOC, [], { client: sb as never });
    expect(calls.map((c) => c[0])).not.toContain("customer_orders_sync_voided");
  });
});

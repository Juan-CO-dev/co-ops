import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { loadEzcaterOrderDetail } from "@/lib/catering/ezcater-detail";
import { loadPipelineBoard } from "@/lib/catering/pipeline";

const { from, scopeFilter, queues } = vi.hoisted(() => ({
  from: vi.fn(), scopeFilter: vi.fn(), queues: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from }) }));
const actor = { user: { id: "actor", role: "owner" }, locations: ["shop-a"] } as AuthContext;
const response = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  from.mockReset();
  scopeFilter.mockReset();
  for (const key of Object.keys(queues)) delete queues[key];
  from.mockImplementation((table: string) => {
    const result = queues[table]?.shift();
    if (!result) throw new Error(`Unexpected table: ${table}`);
    const query = {
      select: () => query, eq: () => query, order: () => query,
      or: (filter: string) => { scopeFilter(filter); return query; },
      maybeSingle: async () => result, returns: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  });
});
function authorizedRead(snapshot: string, current: string) {
  (queues.catering_pipeline ??= []).push(response({ location_id: "shop-a" }));
  (queues.users ??= []).push(response({ role: "shift_lead", active: true }));
  (queues.user_locations ??= []).push(response([{ location_id: "shop-a" }]));
  (queues.ezcater_orders ??= []).push(response({ id: "order", snapshot_id: snapshot, location_id: "shop-a", order_number: snapshot }), response({ snapshot_id: current }));
  (queues.ezcater_order_items ??= []).push(response([{ ordinal: 0, name: snapshot }]));
  (queues.ezcater_order_contacts ??= []).push(response({ contact: { name: snapshot } }));
}

describe("ezCater detail service-role read boundary", () => {
  it("fresh membership removal defeats a stale all-access actor and prevents PII queries", async () => {
    queues.catering_pipeline = [response({ location_id: "shop-a" })];
    queues.users = [response({ role: "shift_lead", active: true })];
    queues.user_locations = [response([])];
    expect(await loadEzcaterOrderDetail(actor, "lead")).toBeNull();
    expect(from.mock.calls.map(([table]) => table)).toEqual(["catering_pipeline", "users", "user_locations"]);
  });
  it("membership read failure and inactive accounts fail closed", async () => {
    for (const inactive of [false, true]) {
      queues.catering_pipeline = [response({ location_id: "shop-a" })];
      queues.users = [response({ role: "owner", active: !inactive })];
      queues.user_locations = [{ data: null, error: { message: "synthetic failure" } }];
      expect(await loadEzcaterOrderDetail(actor, "lead")).toBeNull();
    }
    expect(from.mock.calls.some(([table]) => table === "ezcater_order_contacts")).toBe(false);
  });
  it("retries a snapshot change and returns coherent items and contact", async () => {
    authorizedRead("first", "second");
    authorizedRead("second", "second");
    const detail = await loadEzcaterOrderDetail(actor, "lead");
    expect(detail).toMatchObject({ order_number: "second", items: [{ name: "second" }], contact: { name: "second" } });
  });
  it("bounds retries if the provider keeps updating the snapshot", async () => {
    authorizedRead("first", "second");
    authorizedRead("second", "third");
    await expect(loadEzcaterOrderDetail(actor, "lead")).rejects.toThrow("ezcater_detail_snapshot_changed");
    expect(from.mock.calls.filter(([table]) => table === "ezcater_orders")).toHaveLength(4);
  });
  it("does not expose a pending failed-sync row before its first snapshot", async () => {
    authorizedRead("unused", "unused");
    queues.ezcater_orders = [response({ id: "order", snapshot_id: null, location_id: "shop-a", order_number: null, fetched_at: null, status: null })];
    expect(await loadEzcaterOrderDetail(actor, "lead")).toBeNull();
    expect(from.mock.calls.some(([table]) => table === "ezcater_order_contacts")).toBe(false);
  });
  it("board uses fresh membership and preserves existing global-lead visibility", async () => {
    queues.catering_pipeline = [response([])];
    queues.users = [response({ role: "shift_lead", active: true })];
    queues.user_locations = [response([{ location_id: "shop-b" }])];
    expect(await loadPipelineBoard(actor)).toEqual([]);
    expect(scopeFilter).toHaveBeenCalledWith("location_id.is.null,location_id.in.(shop-b)");
  });
  it("board grants catering manager and level 8 cross-shop reads", async () => {
    for (const role of ["catering_mgr", "moo"]) {
      queues.catering_pipeline = [response([])];
      queues.users = [response({ role, active: true })];
      queues.user_locations = [response([])];
      expect(await loadPipelineBoard(actor)).toEqual([]);
    }
    expect(scopeFilter).not.toHaveBeenCalled();
  });
});

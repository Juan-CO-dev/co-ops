/**
 * Audit W22/B122 — reserve goes through ONE database call (0329 reserve_catering_prep_demand) that holds
 * the lead's row lock; the client never retires and inserts on its own once 0329 exists. A lost race
 * (`not_confirmed` / `quote_changed`) is returned, not audited as a reserve. Before 0329 is applied the
 * previous two-call path still runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reservePrepDemand } from "@/lib/catering/prep-demand";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeCall, type FakeRpc } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const actor = { user: { id: "mgr", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: ["shop"] } as unknown as AuthContext;

let calls: FakeCall[];
let rpcs: FakeRpc[];
let rpcAnswer: { data?: unknown; error?: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  rpcAnswer = { data: { result: "reserved", released: 0, inserted: 2 } };
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_quotes") return { data: { id: "Q", location_id: "shop", event_date: "2030-11-20" } };
    if (call.table === "catering_quote_items" && call.has("is", "line_kind", null)) return { data: [] };
    if (call.table === "catering_quote_items") {
      return { data: [
        { id: "l1", item_id: "chips", menu_item_id: null, package_id: null, quantity: 3, portion: null, description: null, line_kind: null, components_listed: null },
        { id: "l2", item_id: null, menu_item_id: "sub", package_id: null, quantity: 4, portion: "half", description: null, line_kind: null, components_listed: null },
      ] };
    }
    return { data: null };
  }, () => rpcAnswer);
  calls = fake.calls;
  rpcs = fake.rpcs;
  vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
});

describe("B122: reserve through one locked RPC", () => {
  it("reserves through reserve_catering_prep_demand, never a client-side release+insert", async () => {
    expect(await reservePrepDemand(actor, "L")).toBe("reserved");
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]!.name).toBe("reserve_catering_prep_demand");
    expect(rpcs[0]!.args).toEqual({
      p_pipeline_id: "L",
      p_quote_id: "Q",
      p_rows: [
        { item_id: "chips", menu_item_id: null, choice_package_item_id: null, portion: null, qty: 3 },
        { item_id: null, menu_item_id: "sub", choice_package_item_id: null, portion: "half", qty: 4 },
      ],
      p_actor_id: "mgr",
    });
    expect(calls.filter((c) => c.table === "catering_prep_demand" && (c.kind === "update" || c.kind === "insert"))).toHaveLength(0);
    expect(vi.mocked(audit).mock.calls.map((c) => c[0].action)).toEqual(["catering.prep_demand.reserve"]);
  });

  it.each(["not_confirmed", "quote_changed", "already_consumed"])("%s is returned and not audited as a reserve", async (result) => {
    rpcAnswer = { data: { result } };
    expect(await reservePrepDemand(actor, "L")).toBe(result);
    expect(audit).not.toHaveBeenCalled();
  });

  it("a real RPC error throws (moveStage's catch records sync_failed)", async () => {
    rpcAnswer = { error: { code: "23514", message: "check constraint" } };
    await expect(reservePrepDemand(actor, "L")).rejects.toThrow(/reservePrepDemand: check constraint/);
  });

  it("before 0329 is applied, the previous two-call path still runs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcAnswer = { error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await reservePrepDemand(actor, "L")).toBe("reserved");
    const writes = calls.filter((c) => c.table === "catering_prep_demand");
    expect(writes.map((c) => c.kind)).toEqual(["update", "insert"]);
  });
});

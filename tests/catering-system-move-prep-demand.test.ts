/**
 * Audit W22/B201 — a SYSTEM stage move (nightly rollover, Toast scan, ezCater lifecycle) moves the lead's
 * still-reserved prep demand like a person's move does: completed/out consume, lost/inquiry/quote_sent
 * release. A move that did not happen touches no demand; a ledger failure never changes the outcome.
 * The settle goes through 0329's settle_catering_prep_demand (fix round 1); before 0329 the bare update runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { systemMoveStage, completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { fakeSupabase, type FakeCall, type FakeRpc } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

let calls: FakeCall[];
let rpcs: FakeRpc[];
let rpcMissing: boolean;
let moveCount: number;
let demandError: unknown;
let client: ReturnType<typeof getServiceRoleClient>;

beforeEach(() => {
  vi.clearAllMocks();
  moveCount = 1;
  demandError = null;
  rpcMissing = false;
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_pipeline" && call.kind === "update") return { count: moveCount };
    if (call.table === "catering_pipeline") return { data: [{ id: "house-lead", stage: "confirmed", location_id: "shop", lead_source: "toast" }] };
    if (call.table === "catering_prep_demand") return { error: demandError };
    return { data: null };
  }, (r) => {
    if (rpcMissing) return { error: { code: "PGRST202", message: "Could not find the function" } };
    if (demandError) return { error: demandError };
    return { data: { result: r.args.p_to } };
  });
  calls = fake.calls;
  rpcs = fake.rpcs;
  client = fake.client as unknown as ReturnType<typeof getServiceRoleClient>;
  vi.mocked(getServiceRoleClient).mockReturnValue(client);
});

const demandWrites = () => calls.filter((c) => c.table === "catering_prep_demand" && c.kind === "update");
const settles = () => rpcs.filter((r) => r.name === "settle_catering_prep_demand");

describe("B201: system moves follow the prep-demand ledger", () => {
  it("a completed house lead consumes its reserved prep demand", async () => {
    const r = await completeElapsedCateringEvents("2030-11-21");
    expect(r.completed).toEqual(["house-lead"]);
    expect(settles()).toEqual([{ name: "settle_catering_prep_demand", args: { p_pipeline_id: "house-lead", p_to: "consumed" } }]);
    expect(demandWrites()).toHaveLength(0);
    expect(vi.mocked(audit).mock.calls.map((c) => c[0].action)).toContain("catering.prep_demand.consume");
  });

  it.each(["lost", "inquiry", "quote_sent"] as const)("a system move to %s releases", async (to) => {
    expect(await systemMoveStage(client, { id: "L", stage: "confirmed" }, to, "note", "toast_scan")).toBe("moved");
    expect(settles()[0]!.args).toEqual({ p_pipeline_id: "L", p_to: "released" });
  });

  it("before 0329 is applied the bare update still runs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcMissing = true;
    expect(await systemMoveStage(client, { id: "L", stage: "confirmed" }, "completed", "note", "cron_rollover")).toBe("moved");
    const w = demandWrites();
    expect(w).toHaveLength(1);
    expect((w[0]!.arg("update") as Record<string, unknown>).status).toBe("consumed");
    expect(w[0]!.has("eq", "pipeline_id", "L")).toBe(true);
    expect(w[0]!.has("eq", "status", "reserved")).toBe(true);
  });

  it("a system move to confirmed never reserves", async () => {
    expect(await systemMoveStage(client, { id: "L", stage: "inquiry" }, "confirmed", "note", "ezcater")).toBe("moved");
    expect(settles()).toHaveLength(0);
    expect(demandWrites()).toHaveLength(0);
  });

  it("a stage_changed outcome touches no demand", async () => {
    moveCount = 0;
    expect(await systemMoveStage(client, { id: "L", stage: "confirmed" }, "completed", "note", "cron_rollover")).toBe("stage_changed");
    expect(settles()).toHaveLength(0);
    expect(demandWrites()).toHaveLength(0);
  });

  it("a ledger failure is audited as sync_failed and never changes the outcome", async () => {
    demandError = { message: "boom" };
    expect(await systemMoveStage(client, { id: "L", stage: "confirmed" }, "completed", "note", "cron_rollover")).toBe("moved");
    const failed = vi.mocked(audit).mock.calls.map((c) => c[0]).find((a) => a.action === "catering.prep_demand.sync_failed");
    expect(failed?.metadata).toMatchObject({ actor_context: "cron_rollover", to_stage: "completed" });
  });
});

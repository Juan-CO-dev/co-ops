/**
 * Audit W22 fix round 1 (B122 reverse order) — releasing or consuming a lead's reserved prep goes through ONE
 * database call (0329 settle_catering_prep_demand) that takes the lead's row lock and re-checks the lead's
 * CURRENT stage. The interleaving it closes: manager A moves confirmed → quote_sent and stalls before the
 * release; manager B re-confirms and reserves a fresh set; A's release resumes. Before, A's release flipped
 * B's fresh rows (it checked only pipeline id + status), so a confirmed order vanished from kitchen demand.
 * Now the RPC answers `stage_changed` and writes nothing. Before 0329 is applied the previous update runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumePrepDemand, releasePrepDemand, applySystemStageToPrepDemand } from "@/lib/catering/prep-demand";
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
let client: ReturnType<typeof getServiceRoleClient>;

beforeEach(() => {
  vi.clearAllMocks();
  rpcAnswer = { data: { result: "released", rows: 3 } };
  const fake = fakeSupabase(() => ({ data: null }), () => rpcAnswer);
  calls = fake.calls;
  rpcs = fake.rpcs;
  client = fake.client as unknown as ReturnType<typeof getServiceRoleClient>;
  vi.mocked(getServiceRoleClient).mockReturnValue(client);
});

const demandWrites = () => calls.filter((c) => c.table === "catering_prep_demand" && c.kind === "update");
const actions = () => vi.mocked(audit).mock.calls.map((c) => c[0]);

describe("settle through one locked RPC that re-checks the stage", () => {
  it("release goes through settle_catering_prep_demand, never a bare client-side update", async () => {
    await releasePrepDemand(actor, "L");
    expect(rpcs).toEqual([{ name: "settle_catering_prep_demand", args: { p_pipeline_id: "L", p_to: "released" } }]);
    expect(demandWrites()).toHaveLength(0);
    expect(actions().map((a) => a.action)).toEqual(["catering.prep_demand.release"]);
  });

  it("consume asks for 'consumed'", async () => {
    rpcAnswer = { data: { result: "consumed", rows: 2 } };
    await consumePrepDemand(actor, "L");
    expect(rpcs[0]).toEqual({ name: "settle_catering_prep_demand", args: { p_pipeline_id: "L", p_to: "consumed" } });
    expect(actions().map((a) => a.action)).toEqual(["catering.prep_demand.consume"]);
  });

  it("A's delayed release after B re-confirmed → stage_changed: B's fresh reservation is kept, recorded as skipped", async () => {
    rpcAnswer = { data: { result: "stage_changed", stage: "confirmed" } };
    await releasePrepDemand(actor, "L");
    expect(demandWrites()).toHaveLength(0);
    const a = actions();
    expect(a.map((x) => x.action)).toEqual(["catering.prep_demand.settle_skipped"]);
    expect(a[0]!.metadata).toMatchObject({ to: "released", reason: "stage_changed", stage: "confirmed" });
  });

  it("a system move whose lead moved on again settles nothing and answers none", async () => {
    rpcAnswer = { data: { result: "stage_changed", stage: "confirmed" } };
    expect(await applySystemStageToPrepDemand(client, "L", "lost", "toast_scan")).toBe("none");
    expect(rpcs[0]).toEqual({ name: "settle_catering_prep_demand", args: { p_pipeline_id: "L", p_to: "released" } });
    expect(demandWrites()).toHaveLength(0);
  });

  it("a real RPC error throws (moveStage's catch records sync_failed)", async () => {
    rpcAnswer = { error: { code: "40001", message: "serialization failure" } };
    await expect(releasePrepDemand(actor, "L")).rejects.toThrow(/releasePrepDemand: serialization failure/);
  });

  it("before 0329 is applied, the previous update still runs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcAnswer = { error: { code: "PGRST202", message: "Could not find the function" } };
    await releasePrepDemand(actor, "L");
    const w = demandWrites();
    expect(w).toHaveLength(1);
    expect((w[0]!.arg("update") as Record<string, unknown>).status).toBe("released");
    expect(w[0]!.has("eq", "status", "reserved")).toBe(true);
  });
});

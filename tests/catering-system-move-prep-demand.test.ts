/**
 * Audit W22/B201 — a SYSTEM stage move (nightly rollover, Toast scan, ezCater lifecycle) moves the lead's
 * still-reserved prep demand like a person's move does: completed/out consume, lost/inquiry/quote_sent
 * release. A move that did not happen touches no demand; a ledger failure never changes the outcome.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { systemMoveStage, completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

let calls: FakeCall[];
let moveCount: number;
let demandError: unknown;
let client: ReturnType<typeof getServiceRoleClient>;

beforeEach(() => {
  vi.clearAllMocks();
  moveCount = 1;
  demandError = null;
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_pipeline" && call.kind === "update") return { count: moveCount };
    if (call.table === "catering_pipeline") return { data: [{ id: "house-lead", stage: "confirmed", location_id: "shop", lead_source: "toast" }] };
    if (call.table === "catering_prep_demand") return { error: demandError };
    return { data: null };
  });
  calls = fake.calls;
  client = fake.client as unknown as ReturnType<typeof getServiceRoleClient>;
  vi.mocked(getServiceRoleClient).mockReturnValue(client);
});

const demandWrites = () => calls.filter((c) => c.table === "catering_prep_demand" && c.kind === "update");

describe("B201: system moves follow the prep-demand ledger", () => {
  it("a completed house lead consumes its reserved prep demand", async () => {
    const r = await completeElapsedCateringEvents("2030-11-21");
    expect(r.completed).toEqual(["house-lead"]);
    const w = demandWrites();
    expect(w).toHaveLength(1);
    expect((w[0]!.arg("update") as Record<string, unknown>).status).toBe("consumed");
    expect(w[0]!.has("eq", "pipeline_id", "house-lead")).toBe(true);
    expect(w[0]!.has("eq", "status", "reserved")).toBe(true);
    expect(vi.mocked(audit).mock.calls.map((c) => c[0].action)).toContain("catering.prep_demand.consume");
  });

  it.each(["lost", "inquiry", "quote_sent"] as const)("a system move to %s releases", async (to) => {
    expect(await systemMoveStage(client, { id: "L", stage: "confirmed" }, to, "note", "toast_scan")).toBe("moved");
    expect((demandWrites()[0]!.arg("update") as Record<string, unknown>).status).toBe("released");
  });

  it("a system move to confirmed never reserves", async () => {
    expect(await systemMoveStage(client, { id: "L", stage: "inquiry" }, "confirmed", "note", "ezcater")).toBe("moved");
    expect(demandWrites()).toHaveLength(0);
  });

  it("a stage_changed outcome touches no demand", async () => {
    moveCount = 0;
    expect(await systemMoveStage(client, { id: "L", stage: "confirmed" }, "completed", "note", "cron_rollover")).toBe("stage_changed");
    expect(demandWrites()).toHaveLength(0);
  });

  it("a ledger failure is audited as sync_failed and never changes the outcome", async () => {
    demandError = { message: "boom" };
    expect(await systemMoveStage(client, { id: "L", stage: "confirmed" }, "completed", "note", "cron_rollover")).toBe("moved");
    const failed = vi.mocked(audit).mock.calls.map((c) => c[0]).find((a) => a.action === "catering.prep_demand.sync_failed");
    expect(failed?.metadata).toMatchObject({ actor_context: "cron_rollover", to_stage: "completed" });
  });
});

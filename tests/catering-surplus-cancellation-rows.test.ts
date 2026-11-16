/** Audit W22/B124 — only a real cancellation's LAST release batch is surplus. The audit's repro cases. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { latestReleaseBatch, selectCancellationRows } from "@/lib/catering/surplus-shared";
import { loadCateringSurplus } from "@/lib/catering/surplus";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

type Row = { pipeline_id: string; created_at: string; released_at: string | null; status: "reserved" | "consumed" | "released"; location_id: string };
const T = (n: number) => `2030-11-${String(10 + n).padStart(2, "0")}T12:00:00.000000+00:00`;

/** What loadCateringSurplus computes, over one lead's whole ledger (all shops), for the rows at `shop`. */
function surplusAt(ledger: Row[], stage: string, shop: string) {
  const released = ledger.filter((r) => r.status === "released");
  return selectCancellationRows(released.filter((r) => r.location_id === shop), {
    liveByPipeline: new Set(ledger.filter((r) => r.status !== "released").map((r) => r.pipeline_id)),
    stageByPipeline: new Map([["L", stage]]),
    latestBatchCreatedAt: latestReleaseBatch(released),
  });
}

describe("B124: selectCancellationRows", () => {
  it("revise then out: R1 released, R2 consumed → no surplus", () => {
    const ledger: Row[] = [
      { pipeline_id: "L", created_at: T(0), released_at: T(1), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(1), released_at: null, status: "consumed", location_id: "A" },
    ];
    expect(surplusAt(ledger, "out", "A")).toEqual([]);
  });

  it("released rows on a completed lead are not a cancellation (stage) → no surplus", () => {
    const ledger: Row[] = [
      { pipeline_id: "L", created_at: T(0), released_at: T(1), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(1), released_at: T(2), status: "released", location_id: "A" },
    ];
    expect(surplusAt(ledger, "completed", "A")).toEqual([]);
  });

  it("re-confirm churn twice then lost → only the last batch counts", () => {
    const ledger: Row[] = [
      { pipeline_id: "L", created_at: T(0), released_at: T(1), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(1), released_at: T(2), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(2), released_at: T(3), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(2), released_at: T(3), status: "released", location_id: "A" },
    ];
    const s = surplusAt(ledger, "lost", "A");
    expect(s).toHaveLength(2);
    expect(s.every((r) => r.created_at === T(2))).toBe(true);
  });

  it("transfer A→B then lost at B → nothing at A, the batch at B", () => {
    const ledger: Row[] = [
      { pipeline_id: "L", created_at: T(0), released_at: T(1), status: "released", location_id: "A" }, // retired by the transfer
      { pipeline_id: "L", created_at: T(1), released_at: T(4), status: "released", location_id: "B" }, // lost at B
    ];
    expect(surplusAt(ledger, "lost", "A")).toEqual([]);
    expect(surplusAt(ledger, "lost", "B")).toHaveLength(1);
  });

  it("transfer then completed → nothing anywhere", () => {
    const ledger: Row[] = [
      { pipeline_id: "L", created_at: T(0), released_at: T(1), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(1), released_at: null, status: "consumed", location_id: "B" },
    ];
    expect(surplusAt(ledger, "completed", "A")).toEqual([]);
    expect(surplusAt(ledger, "completed", "B")).toEqual([]);
  });

  it("a lead still reserved (re-confirmed) → no surplus", () => {
    const ledger: Row[] = [
      { pipeline_id: "L", created_at: T(0), released_at: T(1), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(1), released_at: null, status: "reserved", location_id: "A" },
    ];
    expect(surplusAt(ledger, "confirmed", "A")).toEqual([]);
  });

  it("plain confirmed→lost → the one batch is surplus", () => {
    const ledger: Row[] = [
      { pipeline_id: "L", created_at: T(0), released_at: T(3), status: "released", location_id: "A" },
      { pipeline_id: "L", created_at: T(0), released_at: T(3), status: "released", location_id: "A" },
    ];
    expect(surplusAt(ledger, "lost", "A")).toHaveLength(2);
  });

  it("a lead with no known stage is never surplus", () => {
    expect(selectCancellationRows([{ pipeline_id: "X", created_at: T(0) }], { liveByPipeline: new Set(), stageByPipeline: new Map(), latestBatchCreatedAt: new Map([["X", T(0)]]) })).toEqual([]);
  });
});

describe("B124 / B201: loadCateringSurplus reads", () => {
  const actor = { user: { id: "mgr", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: ["A"] } as unknown as AuthContext;
  let calls: FakeCall[];
  beforeEach(() => {
    const fake = fakeSupabase((call) => {
      if (call.table === "catering_prep_demand" && call.has("eq", "location_id", "A")) {
        // the window read: a revised-then-out lead's superseded batch, 2 days before its date
        return { data: [{ id: "r1", pipeline_id: "L", created_at: T(0), need_date: "2030-11-13", released_at: T(1), item_id: "chips", menu_item_id: null, choice_package_item_id: null, portion: null, qty: 3 }] };
      }
      if (call.table === "catering_prep_demand" && call.has("in", "status", ["reserved", "consumed"])) return { data: [{ pipeline_id: "L" }] };
      if (call.table === "catering_prep_demand") return { data: [{ pipeline_id: "L", created_at: T(0), released_at: T(1) }] };
      if (call.table === "catering_pipeline") return { data: [{ id: "L", stage: "out" }] };
      return { data: [] };
    });
    calls = fake.calls;
    vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
  });

  it("a delivered lead's superseded batch is not surplus", async () => {
    expect(await loadCateringSurplus(actor, { locationId: "A", from: "2030-11-01", to: "2030-11-30" })).toEqual([]);
  });

  it("every read is paged, and there is no unbounded shop-wide reserved scan", async () => {
    await loadCateringSurplus(actor, { locationId: "A", from: "2030-11-01", to: "2030-11-30" });
    const demandReads = calls.filter((c) => c.table === "catering_prep_demand");
    expect(demandReads.length).toBeGreaterThanOrEqual(3);
    for (const c of demandReads) expect(c.ops.some((o) => o.op === "range")).toBe(true);
    // The old exclusion read every reserved row at the shop: location + status=reserved, no lead filter.
    expect(demandReads.some((c) => c.has("eq", "location_id", "A") && c.has("eq", "status", "reserved"))).toBe(false);
  });
});

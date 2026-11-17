// Item 2 PR 2b: one bounded build pass over the diff; a raced day is not a failure; no stored resume state.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
import { runFactBuildPass, loadOrderDaySource } from "@/lib/facts/order-facts";
import { FACT_BUILDER_VERSION } from "@/lib/facts/order-facts-shared";
import { factFloor, factLayerEnabled } from "@/lib/facts/config-shared";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
/** A tiny PostgREST stand-in: every table read returns the rows given for it; .in() filters by the id list. */
function fakeSb(tables: Record<string, Record<string, unknown>[]>, rpc: Rpc) {
  return {
    rpc: vi.fn(rpc),
    from: (table: string) => {
      let rows = tables[table] ?? [];
      const q = {
        select: () => q, order: () => q,
        eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q; },
        in: (col: string, ids: unknown[]) => { rows = rows.filter((r) => ids.includes(r[col === "id" ? "snapshot_id" : col])); return q; },
        range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
      };
      return q;
    },
  };
}
const day = (d: string) => ({ day_location_id: "loc", day_business_date: d, day_fingerprint: "f".repeat(32) });

describe("runFactBuildPass", () => {
  it("diffs from the floor with the builder version, builds each stale day, counts a race as stale", async () => {
    const calls: string[] = [];
    const sb = fakeSb({}, async (name, args) => {
      calls.push(name);
      if (name === "fact_order_days_stale") {
        expect(args).toEqual({ p_floor: "2026-10-01", p_limit: 500, p_builder_version: FACT_BUILDER_VERSION });
        return { data: [day("2026-10-03"), day("2026-10-02"), day("2026-10-01")], error: null };
      }
      expect(args).toMatchObject({ p_location_id: "loc", p_builder_version: FACT_BUILDER_VERSION, p_fingerprint: "f".repeat(32),
        p_orders: [], p_checks: [], p_lines: [], p_refunds: [] });
      if (args.p_business_date === "2026-10-02") return { data: null, error: { message: 'P0001: fact_stale' } };
      if (args.p_business_date === "2026-10-01") return { data: null, error: { message: "boom" } };
      return { data: {}, error: null };
    });
    const r = await runFactBuildPass({ floor: "2026-10-01", deadlineAt: Number.MAX_SAFE_INTEGER, sb: sb as never });
    expect(r).toEqual({ stale: 3, built: 1, raced: 1, failed: 1, leftForNextPass: 0 });
    expect(calls).toEqual(["fact_order_days_stale", "fact_replace_order_day", "fact_replace_order_day", "fact_replace_order_day"]);
  });
  it("stops starting days at the deadline and leaves the rest for the next pass", async () => {
    let t = 0;
    const sb = fakeSb({}, async (name) => name === "fact_order_days_stale"
      ? { data: [day("2026-10-03"), day("2026-10-02"), day("2026-10-01")], error: null } : { data: {}, error: null });
    const r = await runFactBuildPass({ floor: "2026-10-01", deadlineAt: 2, now: () => t++, sb: sb as never });
    expect(r).toEqual({ stale: 3, built: 2, raced: 0, failed: 0, leftForNextPass: 1 });
  });
  it("a failed diff throws (the route records cron.failure)", async () => {
    const sb = fakeSb({}, async () => ({ data: null, error: { message: "x" } }));
    await expect(runFactBuildPass({ floor: "2026-10-01", deadlineAt: Number.MAX_SAFE_INTEGER, sb: sb as never })).rejects.toThrow("fact_diff_failed");
  });
});

describe("loadOrderDaySource", () => {
  it("reads only the pointed snapshots, in chunks, and refuses a missing snapshot", async () => {
    const pointers = Array.from({ length: 150 }, (_, i) => ({ location_id: "loc", business_date: "2026-10-01", order_guid: `o${i}`, snapshot_id: `s${i}` }));
    const orders = pointers.map((p) => ({ snapshot_id: p.snapshot_id, order_guid: p.order_guid, selection_units: [] }));
    const sb = fakeSb({ toast_order_latest_pointers: pointers, toast_orders: [...orders, { snapshot_id: "stray", order_guid: "x" }],
      toast_order_checks: [{ snapshot_id: "s149", check_guid: "c" }], toast_check_discounts: [], toast_payments: [] }, async () => ({ data: null, error: null }));
    const src = await loadOrderDaySource(sb as never, "loc", "2026-10-01");
    expect(src.orders).toHaveLength(150);
    expect(src.checks).toEqual([{ snapshot_id: "s149", check_guid: "c" }]);
    const short = fakeSb({ toast_order_latest_pointers: pointers, toast_orders: orders.slice(1), toast_order_checks: [], toast_check_discounts: [], toast_payments: [] },
      async () => ({ data: null, error: null }));
    await expect(loadOrderDaySource(short as never, "loc", "2026-10-01")).rejects.toThrow("fact_source_snapshot_missing");
  });
});

describe("config", () => {
  it("FACT_LAYER is on only for exactly '1'", () => {
    expect([undefined, "", "0", "true", "yes", "1"].map(factLayerEnabled)).toEqual([false, false, false, false, false, true]);
  });
  it("the floor is an explicit valid date, else today minus 35 ET days; a bad floor refuses", () => {
    expect(factFloor("2025-10-01", "2026-11-17")).toBe("2025-10-01");
    expect(factFloor(undefined, "2026-11-17")).toBe("2026-10-13");
    expect(() => factFloor("2025-02-30", "2026-11-17")).toThrow("fact_invalid_floor");
  });
});

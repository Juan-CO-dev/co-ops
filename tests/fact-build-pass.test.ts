// Item 2 PR 2b: one bounded build pass over the diff; a raced day is not a failure; no stored resume state.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
import { runFactBuildPass, loadOrderDaySource } from "@/lib/facts/order-facts";
import { FACT_BUILDER_VERSION } from "@/lib/facts/order-facts-shared";
import { factFloor, factLayerEnabled, FACT_FAILURE_SAMPLE, FACT_DAY_TIMEOUT_MS, FACT_PASS_BUDGET_MS } from "@/lib/facts/config-shared";

type Rpc = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<{ data: unknown; error: { message: string } | null }>;
type Range = (table: string, from: number, to: number, signal?: AbortSignal) => Promise<{ data: unknown[]; error: { message: string } | null }> | undefined;
/** A tiny PostgREST stand-in: every table read returns the rows given for it; .in() filters by the id list. */
function fakeSb(tables: Record<string, Record<string, unknown>[]>, rpc: Rpc, onRange?: Range) {
  return {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      let signal: AbortSignal | undefined;
      const call = { abortSignal: (s: AbortSignal) => { signal = s; return call; },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(() => rpc(name, args, signal)).then(ok, ko) };
      return call;
    }),
    from: (table: string) => {
      let rows = tables[table] ?? [];
      let signal: AbortSignal | undefined;
      const q = {
        select: () => q, order: () => q, abortSignal: (s: AbortSignal) => { signal = s; return q; },
        eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q; },
        in: (col: string, ids: unknown[]) => { rows = rows.filter((r) => ids.includes(r[col === "id" ? "snapshot_id" : col])); return q; },
        range: async (from: number, to: number) => (await onRange?.(table, from, to, signal)) ?? ({ data: rows.slice(from, to + 1), error: null }),
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
    expect(r).toEqual({ stale: 3, built: 1, raced: 1, failed: 1, timedOut: 0, leftForNextPass: 0,
      failures: [{ locationId: "loc", businessDate: "2026-10-01", error: "fact_replace_failed" }] });
    expect(calls).toEqual(["fact_order_days_stale", "fact_replace_order_day", "fact_replace_order_day", "fact_replace_order_day"]);
  });
  it("stops starting days at the deadline and leaves the rest for the next pass", async () => {
    let t = 0;
    const sb = fakeSb({}, async (name) => name === "fact_order_days_stale"
      ? { data: [day("2026-10-03"), day("2026-10-02"), day("2026-10-01")], error: null } : { data: {}, error: null });
    const r = await runFactBuildPass({ floor: "2026-10-01", deadlineAt: 3, dayTimeoutMs: 1, now: () => t++, sb: sb as never });
    expect(r).toMatchObject({ stale: 3, built: 2, raced: 0, failed: 0, leftForNextPass: 1 });
  });
  it("never STARTS a day that could run past the deadline (review r1 #3): admission needs a whole day budget left", async () => {
    const sb = fakeSb({}, async (name) => name === "fact_order_days_stale" ? { data: [day("2026-10-03"), day("2026-10-02")], error: null } : { data: {}, error: null });
    const r = await runFactBuildPass({ floor: "2026-10-01", deadlineAt: 1_000 + 44_999, dayTimeoutMs: 45_000, now: () => 1_000, sb: sb as never });
    expect(r).toMatchObject({ stale: 2, built: 0, failed: 0, leftForNextPass: 2 });
    expect(sb.rpc).toHaveBeenCalledTimes(1);
  });
  it("a day whose RPC stalls after admission is aborted at its timeout, counted, named, and the pass goes on", async () => {
    const sb = fakeSb({}, (name, args, signal) => {
      if (name === "fact_order_days_stale") return Promise.resolve({ data: [day("2026-10-03"), day("2026-10-02")], error: null });
      if (args.p_business_date === "2026-10-02") return Promise.resolve({ data: {}, error: null });
      // Stalls until its signal aborts, as postgrest-js does (an aborted fetch resolves with an error).
      return new Promise((resolve) => signal!.addEventListener("abort", () => resolve({ data: null, error: { message: "AbortError" } })));
    });
    const started = Date.now();
    const r = await runFactBuildPass({ floor: "2026-10-01", deadlineAt: Date.now() + 60_000, dayTimeoutMs: 40, sb: sb as never });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r).toEqual({ stale: 2, built: 1, raced: 0, failed: 1, timedOut: 1, leftForNextPass: 0,
      failures: [{ locationId: "loc", businessDate: "2026-10-03", error: "fact_day_timeout" }] });
  });
  it("a day whose SOURCE READ stalls is aborted too: every read carries the day signal", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const sb = fakeSb({}, async (name) => name === "fact_order_days_stale" ? { data: [day("2026-10-03")], error: null } : { data: {}, error: null },
      (_t, _f, _to, signal) => { seen.push(signal); return new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ data: [], error: { message: "AbortError" } }))); });
    const r = await runFactBuildPass({ floor: "2026-10-01", deadlineAt: Date.now() + 60_000, dayTimeoutMs: 40, sb: sb as never });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x instanceof AbortSignal)).toBe(true);
    expect(r).toMatchObject({ built: 0, failed: 1, timedOut: 1, failures: [{ businessDate: "2026-10-03", error: "fact_day_timeout" }] });
  });
  it("a failed source read is a named day failure, never a message", async () => {
    const sb = fakeSb({}, async (name) => name === "fact_order_days_stale" ? { data: [day("2026-10-03")], error: null } : { data: {}, error: null },
      async () => ({ data: [], error: { message: "secret detail" } }));
    const r = await runFactBuildPass({ floor: "2026-10-01", deadlineAt: Number.MAX_SAFE_INTEGER, sb: sb as never });
    expect(r.failures).toEqual([{ locationId: "loc", businessDate: "2026-10-03", error: "fact_source_read_failed" }]);
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("keeps at most FACT_FAILURE_SAMPLE named failures while counting them all", async () => {
    const days = Array.from({ length: FACT_FAILURE_SAMPLE + 5 }, (_, i) => day(`2026-09-${String(1 + i).padStart(2, "0")}`));
    const sb = fakeSb({}, async (name) => name === "fact_order_days_stale" ? { data: days, error: null } : { data: null, error: { message: "x" } });
    const r = await runFactBuildPass({ floor: "2026-09-01", deadlineAt: Number.MAX_SAFE_INTEGER, sb: sb as never });
    expect(r.failed).toBe(FACT_FAILURE_SAMPLE + 5);
    expect(r.failures).toHaveLength(FACT_FAILURE_SAMPLE);
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
  it("a day budget fits inside the pass budget", () => {
    expect(FACT_DAY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FACT_DAY_TIMEOUT_MS).toBeLessThan(FACT_PASS_BUDGET_MS);
  });
  it("FACT_LAYER is on only for exactly '1'", () => {
    expect([undefined, "", "0", "true", "yes", "1"].map(factLayerEnabled)).toEqual([false, false, false, false, false, true]);
  });
  it("the floor is an explicit valid date, else today minus 35 ET days; a bad floor refuses", () => {
    expect(factFloor("2025-10-01", "2026-11-17")).toBe("2025-10-01");
    expect(factFloor(undefined, "2026-11-17")).toBe("2026-10-13");
    expect(() => factFloor("2025-02-30", "2026-11-17")).toThrow("fact_invalid_floor");
  });
});

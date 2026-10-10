import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { defaultPulseDeps, loadPulseSection, pulseDeps, type PulseCtx } from "@/lib/pulse/sections";
import { resetSourceCache } from "@/lib/pulse/source-cache";
import { withAbort } from "@/lib/pulse/abort";
import { BASELINE_DEADLINE_MS, clearBaselineCache } from "@/lib/pulse/sales";
import type { SalesData } from "@/lib/pulse/types";
import { summarizeSales } from "@/lib/sales-reports-shared";

const loc = "11111111-1111-4111-8111-111111111111";
const ctx: PulseCtx = {
  auth: { user: { id: "gm", role: "gm", language: "en" }, role: "gm", level: 7, locations: [loc] } as AuthContext,
  locationId: loc, date: "2026-10-09", now: new Date("2026-10-09T19:30:00Z"),
};
const today = { classes: [{ business_date: ctx.date, sale_class: "sale" as const, checks: 2, amount_cents: 900, tax_cents: 90, amount_missing: 0 }],
  discounts: [{ business_date: ctx.date, cents: 100, count: 1 }],
  refunds: [{ business_date: ctx.date, refund_cents: 50, refund_tip_cents: 0, count: 1 }],
  captured_days: [ctx.date], captured_at: "2026-10-09T19:00:00Z" };
const history = { hours: [{ key: "5|11", dow: 5, hour: 11, cents: 1001, checks: 4 }, { key: "4|12", dow: 4, hour: 12, cents: 600, checks: 2 }],
  captured_days: ["2026-10-02", "2026-09-25", "2026-10-01", "2026-10-02"] };
function fake(mode: "ok" | "hang" | "error" | "empty" | "today-error" = "ok") {
  const calls: Array<{ name: string; args: Record<string, unknown>; signal?: AbortSignal }> = [];
  const reads: string[] = [];
  // The only table read the sales lane may make is the one-row capture-stamp probe (loadCaptureStamp).
  const client = { from: vi.fn((table: string) => {
    reads.push(table);
    if (table !== "toast_capture_runs") throw new Error("unexpected table read");
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "abortSignal"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: { finished_at: today.captured_at }, error: null });
    return q;
  }), rpc(name: string, args: Record<string, unknown>) {
    const call: typeof calls[number] = { name, args }; calls.push(call);
    const data = name === "pulse_sales_today" ? today : name === "pulse_sales_baseline" ?
      (mode === "empty" ? { hours: [], captured_days: [] } : history) :
      args.p_dimension === "hour_weekday" ? [{ key: "5|11", dow: 5, hour: 11, cents: 900, checks: 2 }] : [];
    const result = name === "pulse_sales_baseline" && mode === "hang" ? new Promise<never>(() => {}) :
      Promise.resolve({ data, error: (name === "pulse_sales_baseline" && mode === "error") || (name === "pulse_sales_today" && mode === "today-error") ? { message: "timeout" } : null });
    return { abortSignal(signal: AbortSignal) { call.signal = signal; return this; }, then: result.then.bind(result) };
  } } as unknown as SupabaseClient;
  return { client, calls, reads };
}
afterEach(() => { vi.useRealTimers(); resetSourceCache(); clearBaselineCache(); vi.restoreAllMocks(); });
describe("real Pulse sales wiring", () => {
  it("issues seven scoped RPCs, preserves summary and weekday rounding/full heatmap; a cached repoll issues zero RPCs and only the one-row capture-stamp probe", async () => {
    const { client, calls, reads } = fake();
    const parent = new AbortController();
    const deps = pulseDeps(withAbort(client, parent.signal));
    const result = await loadPulseSection(deps, ctx, "sales");
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error(result.state);
    const data = result.data as SalesData;
    const legacy = summarizeSales([{ ...today, tips: [], ezcater: [] }], ctx.date, ctx.date, "day").totals;
    expect(data.net).toEqual({ cents: legacy.toastChecksCents, checks: legacy.checks, avgCheckCents: legacy.avgCheckCents });
    expect(data.refunds).toEqual({ cents: 50, count: 1 });
    expect(data.discounts).toEqual({ cents: 100, count: 1 });
    expect(data.pace.baselineWeeks).toBe(2);
    expect(data.pace.baselineCumulative?.[11]).toBe(501);
    expect(data.pace.pctOfNormal).toBe(80);
    expect(data.heat).toHaveLength(2);
    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(call.signal).toBeDefined();
      expect(call.args).toMatchObject({ p_location_id: loc, p_from: call.name === "pulse_sales_baseline" ? "2026-09-11" : ctx.date,
        p_to: call.name === "pulse_sales_baseline" ? "2026-10-08" : ctx.date });
    }
    expect(calls.filter((c) => c.name === "sales_report_breakdown").map((c) => c.args.p_dimension)).toEqual(["item", "channel", "discount", "server", "hour_weekday"]);
    await loadPulseSection(pulseDeps(client), ctx, "sales");
    expect(calls).toHaveLength(7);
    // The cache key carries the stamp the probe returned, which is the RPC's own captured_at.
    expect(reads).toEqual(["toast_capture_runs", "toast_capture_runs"]);
    expect(data.capturedAt).toBe(today.captured_at);
  });
  it.each(["hang", "error"] as const)("isolates %s baseline and aborts the hung request at the baseline deadline", async (mode) => {
    vi.useFakeTimers();
    const { client, calls } = fake(mode);
    const pending = loadPulseSection(defaultPulseDeps(client), ctx, "sales");
    await vi.advanceTimersByTimeAsync(BASELINE_DEADLINE_MS);
    const result = await pending;
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error(result.state);
    const data = result.data as SalesData;
    expect(data.net?.cents).toBe(900);
    expect(data.pace).toMatchObject({ baselineUnavailable: true, baselineCumulative: null, pctOfNormal: null });
    if (mode === "hang") expect(calls.find((c) => c.name === "pulse_sales_baseline")?.signal?.aborted).toBe(true);
  });
  it("keeps empty coverage distinct from failed baseline", async () => {
    const { client } = fake("empty");
    const result = await loadPulseSection(defaultPulseDeps(client), ctx, "sales");
    if (result.state !== "ok") throw new Error(result.state);
    expect((result.data as SalesData).pace).toMatchObject({ baselineUnavailable: false, baselineWeeks: 0, baselineCumulative: null });
  });
  it("does not hide a today failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fake("today-error");
    expect((await loadPulseSection(defaultPulseDeps(client), ctx, "sales")).state).toBe("error");
  });
  it("refuses role and location before I/O, including direct source access", async () => {
    const { client, calls } = fake();
    for (const auth of [{ ...ctx.auth, level: 6 }, { ...ctx.auth, locations: [] }]) {
      await expect(defaultPulseDeps(client).sales({ ...ctx, auth })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });
  it("composes the section abort with the independent baseline deadline", async () => {
    vi.useFakeTimers();
    const { client, calls } = fake("hang");
    const parent = new AbortController();
    const pending = defaultPulseDeps(withAbort(client, parent.signal)).sales(ctx);
    parent.abort();
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(BASELINE_DEADLINE_MS);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("baseline cache (past days only)", () => {
  it("serves a successful baseline for the rest of the shift without re-querying, but never caches a miss", async () => {
    const ok = fake();
    await loadPulseSection(defaultPulseDeps(ok.client), ctx, "sales");
    resetSourceCache();
    await loadPulseSection(defaultPulseDeps(ok.client), ctx, "sales");
    expect(ok.calls.filter((c) => c.name === "pulse_sales_baseline")).toHaveLength(1);
    clearBaselineCache(); resetSourceCache();
    const bad = fake("error");
    await loadPulseSection(defaultPulseDeps(bad.client), ctx, "sales");
    resetSourceCache();
    await loadPulseSection(defaultPulseDeps(bad.client), ctx, "sales");
    expect(bad.calls.filter((c) => c.name === "pulse_sales_baseline")).toHaveLength(2);
  });
});

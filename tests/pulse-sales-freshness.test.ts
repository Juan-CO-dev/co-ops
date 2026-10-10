/**
 * Sales card freshness (Juan, 2026-10-10, live: "needs 2-4 refreshes, and went BACKWARDS" — 4:40 PM
 * $3,380.38 / 103 checks, 4:41 PM ~$2,850).
 *   (a) A read NEVER sees a partial capture run. Pinned on the writers' SQL: pointers move and the run
 *       completes in one function (0221 toast_capture_finish); paging writes no pointer; the
 *       modified-order path finishes inside one function too (0237); 0242 counts 'completed' only.
 *   (b) Today's sales cache is keyed by the latest COMPLETED capture stamp, so two warm instances
 *       (two module copies) agree on the newest numbers instead of refresh roulette.
 *   (c) The card says when Toast last synced, en + es, and a completed capture reaches the next poll.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { cachedStampedSource, resetSourceCache, SOURCE_TTL_MS, sourceCacheSize, sourceKey } from "@/lib/pulse/source-cache";
import { cachedPulseDeps, type PulseCtx, type PulseDeps, type SalesFacts } from "@/lib/pulse/sections";
import { withAbort } from "@/lib/pulse/abort";
import { loadCaptureStamp } from "@/lib/pulse/sales";
import type { SalesData } from "@/lib/pulse/types";
import { SalesSection } from "@/components/pulse/sections/SalesSection";
import { TranslationProvider } from "@/lib/i18n/provider";
import { formatTime } from "@/lib/i18n/format";

const LOC = "11111111-1111-4111-8111-111111111111";
const ctx = (id = "gm"): PulseCtx => ({
  auth: { user: { id, role: "gm", language: "en" } as AuthContext["user"], session: {} as AuthContext["session"], role: "gm", level: 7, locations: [LOC] },
  locationId: LOC, date: "2026-10-10", now: new Date("2026-10-10T20:41:00Z"),
});
const sql = (file: string) => readFileSync(`supabase/migrations/${file}`, "utf8");
/** The LAST definition of a function in a migration file (0239 re-emits 0221's page writer). */
function fnBody(text: string, name: string): string {
  const re = new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?end \\$\\$;`, "g");
  const all = [...text.matchAll(re)].map((m) => m[0]);
  if (all.length === 0) throw new Error(`${name} not found`);
  return all.at(-1)!;
}

beforeEach(() => resetSourceCache());
afterEach(() => { resetSourceCache(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetModules(); });

describe("(a) a sales read never sees a partial capture run — pinned on the writers", () => {
  it("0221 toast_capture_finish publishes the pointers AND completes the run in ONE function; paging never touches a pointer", () => {
    const finish = fnBody(sql("0221_toast_order_capture.sql"), "toast_capture_finish");
    expect(finish).toContain("insert into public.toast_order_latest_pointers");
    expect(finish).toContain("set status='completed'");
    expect(finish).toMatch(/if v_run\.status<>'running'/);
    const page = fnBody(sql("0239_sales_true_net.sql"), "toast_capture_page"); // the live (re-emitted) page writer
    expect(page).not.toContain("toast_order_latest_pointers");
    expect(page).toContain("if not found or v_run.status <> 'running' then raise exception");
  });
  it("0237 toast_modified_save runs page + finish + the modified_completed flip inside one function (one transaction per batch)", () => {
    const save = fnBody(sql("0237_toast_modified_capture.sql"), "toast_modified_save");
    expect(save).toContain("perform public.toast_capture_finish(run_id,p_location_id,day,1);");
    expect(save).toContain("update public.toast_capture_runs set status='modified_completed' where id=run_id;");
  });
  it("0242 pulse_sales_today reads facts through the latest pointers and counts coverage / captured_at over COMPLETED runs only", () => {
    const today = fnBody(sql("0242_pulse_sales_reads.sql"), "pulse_sales_today");
    expect(today).toContain("from public.sales_report_facts(p_location_id, p_from, p_to)");
    expect(today.match(/r\.status = 'completed'/g)).toHaveLength(2); // captured_days + captured_at
    expect(today).toContain("'captured_at', (select max(r.finished_at) from public.toast_capture_runs r");
    const facts = fnBody(sql("0232_reports_sales_reads.sql"), "sales_report_facts");
    expect(facts).toContain("from public.toast_order_latest_pointers p");
    expect(facts).not.toContain("toast_capture_run_orders");
  });
});

/** A recording fake for the one-row stamp probe. */
function stampClient(row: { finished_at: string | null } | null, error: { message: string } | null = null) {
  const chain: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = (...a: unknown[]) => { chain.push([m, a]); return q; };
  q.abortSignal = (signal: AbortSignal) => { chain.push(["abortSignal", [signal]]); return q; };
  q.maybeSingle = async () => ({ data: row, error });
  const tables: string[] = [];
  const client = { from: (t: string) => { tables.push(t); return q; }, rpc: () => { throw new Error("no rpc"); } } as unknown as SupabaseClient;
  return { client, chain, tables };
}

describe("loadCaptureStamp — the latest COMPLETED full-day capture, one indexed row", () => {
  it("filters shop + day + status completed, newest finished_at first, limit 1; returns finished_at", async () => {
    const f = stampClient({ finished_at: "2026-10-10T20:40:30Z" });
    expect(await loadCaptureStamp(f.client, LOC, "2026-10-10")).toBe("2026-10-10T20:40:30Z");
    expect(f.tables).toEqual(["toast_capture_runs"]);
    expect(f.chain).toEqual([
      ["select", ["finished_at"]], ["eq", ["location_id", LOC]], ["eq", ["business_date", "2026-10-10"]], ["eq", ["status", "completed"]],
      ["order", ["finished_at", { ascending: false }]], ["limit", [1]],
    ]);
  });
  it.each(["probe", "route"])("combines the probe and route signals: %s cancellation reaches the query", async (which) => {
    const f = stampClient(null);
    const route = new AbortController();
    const probe = new AbortController();
    await loadCaptureStamp(withAbort(f.client, route.signal), LOC, "2026-10-10", probe.signal);
    const signal = f.chain.filter(([method]) => method === "abortSignal").at(-1)![1][0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    (which === "probe" ? probe : route).abort();
    expect(signal.aborted).toBe(true);
    expect((which === "probe" ? route : probe).signal.aborted).toBe(false);
  });
  it("null before the first completed capture; a read error throws (the caller degrades, never guesses)", async () => {
    expect(await loadCaptureStamp(stampClient(null).client, LOC, "2026-10-10")).toBeNull();
    await expect(loadCaptureStamp(stampClient(null, { message: "down" }).client, LOC, "2026-10-10")).rejects.toThrow("pulse capture stamp: down");
  });
});

describe("cachedStampedSource — one live stamp per prefix", () => {
  it("serves the same stamp inside the TTL, and a NEW stamp retires the old sibling at once (TTL or not)", async () => {
    const prefix = sourceKey({ source: "sales", locationId: LOC, date: "d", scope: "" });
    const k1 = sourceKey({ source: "sales", locationId: LOC, date: "d", scope: "shop|captured:T1" });
    const k2 = sourceKey({ source: "sales", locationId: LOC, date: "d", scope: "shop|captured:T2" });
    let loads = 0;
    const load = vi.fn(async () => ++loads);
    expect(await cachedStampedSource(prefix, k1, load, { now: 0 })).toBe(1);
    expect(await cachedStampedSource(prefix, k1, load, { now: 10 })).toBe(1);
    expect(sourceCacheSize()).toBe(1);
    expect(await cachedStampedSource(prefix, k2, load, { now: 20 })).toBe(2); // inside k1's TTL, still reloads
    expect(sourceCacheSize()).toBe(1); // k1 is gone, not lingering
    expect(await cachedStampedSource(prefix, k2, load, { now: 20 + SOURCE_TTL_MS })).toBe(3); // the TTL still bounds an unmoved stamp
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("another shop's sales under its own prefix is untouched", async () => {
    const other = sourceKey({ source: "sales", locationId: "other", date: "d", scope: "shop|captured:T1" });
    await cachedStampedSource(sourceKey({ source: "sales", locationId: "other", date: "d", scope: "" }), other, async () => "o", { now: 0 });
    const prefix = sourceKey({ source: "sales", locationId: LOC, date: "d", scope: "" });
    await cachedStampedSource(prefix, sourceKey({ source: "sales", locationId: LOC, date: "d", scope: "shop|captured:T1" }), async () => 1, { now: 0 });
    await cachedStampedSource(prefix, sourceKey({ source: "sales", locationId: LOC, date: "d", scope: "shop|captured:T2" }), async () => 2, { now: 1 });
    expect(sourceCacheSize()).toBe(2);
  });
});

const facts = (cents: number, capturedAt: string | null): SalesFacts => ({
  today: { totals: { toastChecksCents: cents } as unknown as SalesFacts["today"]["totals"], capturedAt },
  items: [], channels: [], discounts: [], servers: [], hoursToday: [], heatTrailing: [], trailing: null,
});
function salesDeps(world: { stamp: string | null; cents: number; stampFails?: boolean }): PulseDeps & { loads: number; probes: number } {
  const d = {
    loads: 0, probes: 0,
    sales: async () => { d.loads++; return facts(world.cents, world.stamp); },
    salesStamp: async () => { d.probes++; if (world.stampFails) throw new Error("probe down"); return world.stamp; },
  } as unknown as PulseDeps & { loads: number; probes: number };
  for (const k of ["board", "reports", "fridges", "cateringToday", "cateringTomorrow", "notRung", "unlinkedClockIns", "lastParPass", "deliveries", "cutoffs", "handoff", "layout"] as const) {
    (d as unknown as Record<string, unknown>)[k] = async () => { throw new Error(`${k} not read`); };
  }
  return d;
}

describe("(b) cachedPulseDeps keys today's sales by the capture stamp", () => {
  it("same stamp → one load for any number of polls; a new stamp inside the TTL → reload; the probe runs every poll", async () => {
    const world = { stamp: "2026-10-10T20:30:00Z", cents: 285_000 };
    const d = salesDeps(world);
    let now = 1_000;
    const deps = cachedPulseDeps(d, { now: () => now });
    expect((await deps.sales(ctx("gm-a"))).today.totals.toastChecksCents).toBe(285_000);
    now += 20_000;
    expect((await deps.sales(ctx("gm-b"))).today.totals.toastChecksCents).toBe(285_000);
    expect(d.loads).toBe(1);
    world.stamp = "2026-10-10T20:40:30Z"; world.cents = 338_038; // the :40 capture completes
    now += 10_000; // still inside the 50 s TTL of the first load
    const fresh = await deps.sales(ctx("gm-a"));
    expect(fresh.today.totals.toastChecksCents).toBe(338_038);
    expect(fresh.today.capturedAt).toBe("2026-10-10T20:40:30Z");
    expect(d.loads).toBe(2);
    expect(d.probes).toBe(3);
    expect(sourceCacheSize()).toBe(1);
  });
  it("a failing stamp probe degrades to the plain TTL cache and never fails the section", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const world = { stamp: "x", cents: 1, stampFails: true };
    const d = salesDeps(world);
    const deps = cachedPulseDeps(d, { now: () => 5 });
    expect((await deps.sales(ctx())).today.totals.toastChecksCents).toBe(1);
    expect((await deps.sales(ctx())).today.totals.toastChecksCents).toBe(1);
    expect(d.loads).toBe(1);
  });
  it("the authorization check still runs before the probe and the cache", async () => {
    const d = salesDeps({ stamp: "x", cents: 1 });
    const deps = cachedPulseDeps(d);
    const c = ctx(); c.auth = { ...c.auth, locations: [] };
    await expect(deps.sales(c)).rejects.toThrow("location_access_denied");
    expect(d.probes).toBe(0);
    expect(d.loads).toBe(0);
  });
});

describe("(b) two warm instances (two module copies) agree on the newest completed capture", () => {
  type Mod = typeof import("@/lib/pulse/sections");
  async function instance(): Promise<Mod> { vi.resetModules(); return import("@/lib/pulse/sections"); }
  it("with the stamp: after a capture completes, BOTH instances show the new number on their next poll; without it, B serves the stale (lower) one", async () => {
    const a = await instance();
    const b = await instance();
    expect(a).not.toBe(b);
    let now = 1_000;
    const world = { stamp: "2026-10-10T20:30:00Z", cents: 285_000 };
    const depsA = a.cachedPulseDeps(salesDeps(world), { now: () => now });
    const depsB = b.cachedPulseDeps(salesDeps(world), { now: () => now });
    expect((await depsA.sales(ctx())).today.totals.toastChecksCents).toBe(285_000);
    now += 5_000;
    expect((await depsB.sales(ctx())).today.totals.toastChecksCents).toBe(285_000);
    // :40 capture completes between Juan's two refreshes
    world.stamp = "2026-10-10T20:40:30Z"; world.cents = 338_038;
    now += 5_000;
    expect((await depsA.sales(ctx())).today.totals.toastChecksCents).toBe(338_038);
    now += 1_000; // 4:41 PM: instance B, still inside its TTL
    expect((await depsB.sales(ctx())).today.totals.toastChecksCents).toBe(338_038); // not 285_000: no going backwards

    // Control — the pre-fix behaviour (no stamp): B keeps serving the older snapshot inside its TTL.
    const c = await instance();
    const dNoStamp = salesDeps({ stamp: null, cents: 285_000 });
    delete (dNoStamp as Partial<PulseDeps>).salesStamp;
    const world2 = { stamp: null as string | null, cents: 285_000 };
    const d2 = { ...dNoStamp, sales: async () => facts(world2.cents, world2.stamp) } as PulseDeps;
    delete d2.salesStamp;
    const depsC = c.cachedPulseDeps(d2, { now: () => now });
    expect((await depsC.sales(ctx())).today.totals.toastChecksCents).toBe(285_000);
    world2.cents = 338_038; now += 1_000;
    expect((await depsC.sales(ctx())).today.totals.toastChecksCents).toBe(285_000);
  });
});

describe("(c) the card says when Toast last synced", () => {
  const data = (capturedAt: string | null): SalesData => ({
    capturedAt, coverage: capturedAt ? "complete" : "missing",
    net: capturedAt ? { cents: 338_038, checks: 103, avgCheckCents: 3282 } : null,
    discounts: { cents: 0, count: 0 }, refunds: { cents: 0, count: 0 },
    pace: { todayCumulative: new Array(24).fill(null), baselineCumulative: null, baselineWeeks: 0, baselineUnavailable: false, weekday: 5, pctOfNormal: null, currentHour: 16 },
    topItems: [], channels: [], discountsByName: [], servers: [], heat: [],
  });
  const render = (d: SalesData, language: "en" | "es") =>
    // eslint-disable-next-line react/no-children-prop -- TranslationProvider types `children` as a required prop
    renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(SalesSection, { data: d, mode: "card", locationId: LOC, date: "2026-10-10" }) }));
  it("en + es: 'Toast synced <time of the last completed capture>', in the shop's time zone", () => {
    const at = "2026-10-10T20:30:00Z"; // 4:30 PM ET
    expect(render(data(at), "en")).toContain(`Toast synced ${formatTime(at, "en")}`);
    expect(formatTime(at, "en")).toBe("4:30 PM");
    expect(render(data(at), "es")).toContain(`Toast sincronizado ${formatTime(at, "es")}`);
  });
  it("before the first completed capture it says so, in both languages, instead of a time", () => {
    expect(render(data(null), "en")).toContain("Not synced with Toast yet today");
    expect(render(data(null), "es")).toContain("Aún sin sincronizar con Toast hoy");
  });
});


describe("stamp probe regressions", () => {
  it.each([false, true])("a hanging probe has a short deadline (warm=%s)", async (warm) => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = salesDeps({ stamp: "T1", cents: 1 });
    const cached = cachedPulseDeps(d);
    if (warm) await cached.sales(ctx());
    let signal: AbortSignal | undefined;
    d.salesStamp = (_ctx, probeSignal) => { signal = probeSignal; return new Promise(() => {}); };
    let result: SalesFacts | undefined;
    const pending = cached.sales(ctx()).then((value) => { result = value; });
    await vi.advanceTimersByTimeAsync(1_600);
    expect(result?.today.totals.toastChecksCents).toBe(1);
    expect(signal?.aborted).toBe(true);
    expect(d.loads).toBe(1);
    await pending;
  });
  it("a late T1 probe cannot evict T2; failed and null probes keep T2", async () => {
    const world = { stamp: "T1", cents: 1 };
    const d = salesDeps(world);
    const cached = cachedPulseDeps(d);
    await cached.sales(ctx());
    let finish!: (stamp: string) => void;
    d.salesStamp = () => new Promise((resolve) => { finish = resolve; });
    const late = cached.sales(ctx());
    d.salesStamp = async () => "T2";
    world.cents = 2;
    expect((await cached.sales(ctx())).today.totals.toastChecksCents).toBe(2);
    finish("T1");
    expect((await late).today.totals.toastChecksCents).toBe(2);
    expect((await cached.sales(ctx())).today.totals.toastChecksCents).toBe(2);
    d.salesStamp = async () => null;
    expect((await cached.sales(ctx())).today.totals.toastChecksCents).toBe(2);
    vi.spyOn(console, "error").mockImplementation(() => {});
    d.salesStamp = async () => { throw new Error("down"); };
    expect((await cached.sales(ctx())).today.totals.toastChecksCents).toBe(2);
    expect(d.loads).toBe(2);
  });
});

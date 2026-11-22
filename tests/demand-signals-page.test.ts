/**
 * Item 4 PR 5: the signals page's loader (lib/demand-signals/signals-page.ts) and the store's two page reads,
 * over fakes. The gated readers themselves are proved against the real 0343 in the harness; here the questions
 * are the PAGE's: a source that is not verified is never read for weather, a read that did not finish whole is
 * "unreadable" (never an empty list), the actor's flags follow the trusted role, and the store refuses a
 * definition read that came back short.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>, events: [] as Array<Record<string, unknown>> | Error, weather: [] as Array<Record<string, unknown>> | Error,
  runs: new Map<string, Record<string, unknown> | null>(), calls: [] as string[], rowsError: null as Error | null, runError: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/demand-signals/signal-store", async (original) => {
  const real = await original<typeof import("@/lib/demand-signals/signal-store")>();
  const give = <T,>(v: T | Error) => { if (v instanceof Error) throw v; return v; };
  return {
    ...real,
    loadSourceRows: async () => { h.calls.push("rows"); if (h.rowsError) throw h.rowsError; return h.rows; },
    loadUsableDayEvents: async (_sb: unknown, a: { from: string; to: string; use: string }) => { h.calls.push(`events:${a.from}:${a.to}:${a.use}`); return give(h.events); },
    loadUsableWeather: async (_sb: unknown, a: { fromIso: string; toIso: string; use: string }) => { h.calls.push(`weather:${a.fromIso}:${a.toIso}:${a.use}`); return give(h.weather); },
    loadLatestRun: async (_sb: unknown, a: { sourceId: string; feed: string; goodOnly: boolean }) => {
      h.calls.push(`run:${a.feed}:${a.goodOnly}`);
      if (h.runError) throw new real.DemandSignalError(500, "generic");
      return h.runs.get(`${a.feed}:${a.goodOnly}`) ?? null;
    },
  };
});

import { DemandSignalError, loadLatestRun, loadSourceRegister, loadSourceRows } from "@/lib/demand-signals/signal-store";
import { loadSignalsPage } from "@/lib/demand-signals/signals-page";

const SHOP = { id: "1c000000-0000-4000-8000-000000000002", name: "Shop A" };
const NOW = "2026-11-19T22:30:00Z";   // 5:30 PM ET on the 19th
const row = (over: Record<string, unknown> = {}) => ({ sourceId: "nws", definitionHash: "h", gate: "allow_with_conditions", adapter: "nws@1", status: "verified",
  sourceSeq: 1, name: "National Weather Service", category: "weather", termsStatus: "verified", termsUrl: "https://www.weather.gov/disclaimer", markedAt: null, markedBy: null, ...over });
const ev = (id: string, over: Record<string, unknown> = {}) => ({ id, origin: "manual", sourceId: null, sourceIds: [], locationId: SHOP.id, category: "sports_game",
  validFrom: "2026-11-20", validTo: "2026-11-20", startLocal: null, endLocal: null, title: id, expectedImpact: "up", severity: null, ...over });
const load = (role: string, locations: string[] = [SHOP.id]) => loadSignalsPage({} as never, { actor: { role, locations }, shop: SHOP, nowIso: NOW });

beforeEach(() => { h.rows = [row()]; h.events = []; h.weather = []; h.runs = new Map(); h.calls = []; h.rowsError = null; h.runError = false; });

describe("the page loader", () => {
  it("reads events for 60 days and weather for 8 ET days, both at the render use point, from the ET date of now", async () => {
    const page = await load("gm");
    expect(page.state).toBe("ok");
    if (page.state !== "ok") return;
    expect(page.today).toBe("2026-11-19");
    expect(h.calls).toContain("events:2026-11-19:2027-01-18:render");
    // ET midnight of the 19th (EST, UTC-5) to ET midnight of the 27th: eight days, inside 0343's nine-day window.
    expect(h.calls).toContain("weather:2026-11-19T05:00:00.000Z:2026-11-27T05:00:00.000Z:render");
    expect(page.days).toHaveLength(14);
    expect(page.events).toEqual([]);
  });
  it("a weather source that is not verified is NOT read, and every day says so", async () => {
    for (const status of ["unverified", "revoked"]) {
      h.rows = [row({ status })]; h.calls = [];
      const page = await load("moo");
      if (page.state !== "ok") throw new Error("not ok");
      expect(h.calls.some((c) => c.startsWith("weather:")), status).toBe(false);
      expect(page.weatherStatus).toBe(status);
      expect(new Set(page.days.map((d) => d.weatherGap))).toEqual(new Set(["source_not_verified"]));
      expect(page.adapters[0]!.status).toBe(status);
    }
    h.rows = []; h.calls = [];
    const none = await load("moo");
    if (none.state !== "ok") throw new Error("not ok");
    expect(none.weatherStatus).toBe("unverified");
    expect(none.adapters).toEqual([]);
    expect(none.sources).toEqual({ registered: 0, verified: 0, revoked: 0 });
  });
  it("a section whose read failed is unreadable (null events, an 'unreadable' reason), never empty", async () => {
    h.events = new DemandSignalError(503, "signal_reads_incomplete"); h.weather = new DemandSignalError(503, "signal_reads_incomplete");
    const page = await load("gm");
    if (page.state !== "ok") throw new Error("not ok");
    expect(page.events).toBeNull();
    expect(page.days.every((d) => d.eventIds === null)).toBe(true);
    expect(page.days[0]!.weatherGap).toBe("unreadable");
  });
  it("0343 not applied is 'unavailable'; a register that cannot be read closes the whole page", async () => {
    h.rowsError = new DemandSignalError(503, "demand_signals_unavailable");
    expect(await load("moo")).toEqual({ state: "unavailable" });
    h.rowsError = new DemandSignalError(500, "generic");
    expect(await load("moo")).toEqual({ state: "unreadable" });
    expect(h.calls.filter((c) => c !== "rows")).toEqual([]);   // nothing else was read
    h.rowsError = null; h.events = new DemandSignalError(503, "demand_signals_unavailable");
    expect(await load("moo")).toEqual({ state: "unavailable" });
  });
  it("what the actor may do follows the trusted role and the shop", async () => {
    h.events = [ev("mine"), ev("everyone", { locationId: null }), ev("alert", { origin: "feed", sourceId: "nws", sourceIds: ["nws"] })];
    const gm = await load("gm");
    if (gm.state !== "ok") throw new Error("not ok");
    expect(gm.can).toEqual({ enter: true, enterAllShops: false, mark: false });
    expect(gm.events!.map((e) => [e.id, e.canEdit])).toEqual([["mine", true], ["everyone", false], ["alert", false]]);
    const outsider = await load("gm", ["another-shop"]);
    if (outsider.state !== "ok") throw new Error("not ok");
    expect(outsider.can.enter).toBe(false);
    expect(outsider.events!.every((e) => !e.canEdit)).toBe(true);
    const moo = await load("moo", []);
    if (moo.state !== "ok") throw new Error("not ok");
    expect(moo.can).toEqual({ enter: true, enterAllShops: true, mark: true });
    expect(moo.events!.map((e) => e.canEdit)).toEqual([true, true, false]);   // a feed event is never edited by hand
    // The page's DTO carries no key beyond the ones this test names (a new field is a deliberate change).
    expect(Object.keys(moo).sort()).toEqual(["adapters", "can", "days", "events", "shop", "sources", "state", "today", "weatherFeeds", "weatherStatus"]);
    expect(Object.keys(moo.events![0]!).sort()).toEqual(["canEdit", "category", "endLocal", "expectedImpact", "id", "locationId", "origin", "severity", "sourceId", "startLocal", "title", "validFrom", "validTo"]);
  });
  it("feed health: the last run per feed, the last good one when the last failed, and 'never' when none is recorded", async () => {
    h.runs.set("weather_hourly:false", { feed: "weather_hourly", outcome: "failed", errorCode: "http_error", rowsSeen: 0, rowsWritten: 0, rowsWithdrawn: 0, finishedAt: "2026-11-19T21:50:10Z" });
    h.runs.set("weather_hourly:true", { feed: "weather_hourly", outcome: "written", errorCode: null, rowsSeen: 112, rowsWritten: 9, rowsWithdrawn: 0, finishedAt: "2026-11-19T15:50:10Z" });
    const page = await load("moo");
    if (page.state !== "ok") throw new Error("not ok");
    const feeds = page.adapters[0]!.feeds!;
    expect(feeds.map((f) => [f.feed, f.state, f.lastGoodAt])).toEqual([["weather_hourly", "failed", "2026-11-19T15:50:10Z"], ["day_events", "never", null]]);
    // The days carry the feed's state so a forecast from a feed that stopped is never shown as current.
    expect(page.weatherFeeds).toEqual({ nws: "failed" });
    // The good-only read is asked only when the last run failed.
    expect(h.calls.filter((c) => c.startsWith("run:"))).toEqual(["run:weather_hourly:false", "run:weather_hourly:true", "run:day_events:false"]);
    h.runError = true;
    const broken = await load("moo");
    if (broken.state !== "ok") throw new Error("not ok");
    expect(broken.adapters[0]!.feeds).toBeNull();   // unreadable, not "never ran"
    expect(broken.weatherFeeds).toEqual({ nws: "unreadable" });
  });
});

describe("the store's page reads (the real functions over a fake client)", () => {
  const stateRow = (i: number) => ({ source_id: `s${i}`, source_seq: i, definition_hash: "h".repeat(64), name: `Source ${String(i).padStart(3, "0")}`, category: "weather",
    gate: "allow", terms_status: "verified", terms_url: "https://x.test/terms", adapter: null, status: "unverified", marked_at: null, marked_by: null });
  function client(states: unknown[], definitions: (seqs: number[]) => unknown[] | null) {
    const seen: number[][] = [];
    const sb = {
      rpc: async (name: string) => ({ data: name === "demand_source_states" ? states : null, error: null }),
      from: (table: string) => {
        if (table !== "demand_sources") throw new Error(`unexpected table ${table}`);
        let seqs: number[] = [];
        const q = { select: () => q, in: (_c: string, v: number[]) => { seqs = v; seen.push(v); return q; }, order: () => q,
          returns: async () => { const data = definitions(seqs); return data === null ? { data: null, error: { message: "boom" } } : { data, error: null }; } };
        return q;
      },
    };
    return { sb: sb as never, seen };
  }
  const def = (seq: number) => ({ seq, definition: JSON.stringify({ sourceId: `s${seq}`, gives: "Something useful", endpoints: [], conditions: [] }), registered_at: "2026-11-18T00:00:00Z" });

  it("reads every definition by its exact id, in chunks, sorted by name", async () => {
    const real = await vi.importActual<typeof import("@/lib/demand-signals/signal-store")>("@/lib/demand-signals/signal-store");
    const states = Array.from({ length: 120 }, (_, i) => stateRow(120 - i));
    const { sb, seen } = client(states, (seqs) => seqs.map(def));
    const out = await real.loadSourceRegister(sb);
    expect(out).toHaveLength(120);
    expect(out[0]!.name).toBe("Source 001");
    expect(out[0]!.definition).toMatchObject({ gives: "Something useful" });
    expect(seen.map((c) => c.length)).toEqual([50, 50, 20]);
  });
  it("a definition read that comes back short, or fails, is refused by name (never a source 'without details')", async () => {
    const real = await vi.importActual<typeof import("@/lib/demand-signals/signal-store")>("@/lib/demand-signals/signal-store");
    const states = [stateRow(1), stateRow(2)];
    await expect(real.loadSourceRegister(client(states, (seqs) => seqs.slice(1).map(def)).sb)).rejects.toMatchObject({ code: "signal_reads_incomplete", status: 503 });
    await expect(real.loadSourceRegister(client(states, () => null).sb)).rejects.toBeInstanceOf(real.DemandSignalError);
    // A register at the response cap could be a cut one.
    await expect(real.loadSourceRows(client(Array.from({ length: 1000 }, (_, i) => stateRow(i)), () => []).sb)).rejects.toMatchObject({ code: "signal_reads_incomplete" });
  });
  it("the latest run is ONE row by a total order, scoped to the source, the feed and the shop", async () => {
    const real = await vi.importActual<typeof import("@/lib/demand-signals/signal-store")>("@/lib/demand-signals/signal-store");
    const steps: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit"]) q[m] = (...a: unknown[]) => { steps.push(`${m}:${a.filter((x) => typeof x !== "object").join(",")}${a.some((x) => typeof x === "object") ? ":desc" : ""}`); return q; };
    q.returns = async () => ({ data: [{ feed: "day_events", outcome: "unchanged", error_code: null, rows_seen: 2, rows_written: 0, rows_withdrawn: 0, finished_at: "2026-11-19T21:50:00Z" }], error: null });
    const sb = { from: (t: string) => { steps.push(`from:${t}`); return q; } } as never;
    expect(await real.loadLatestRun(sb, { sourceId: "nws", locationId: SHOP.id, feed: "day_events", goodOnly: true })).toEqual(
      { feed: "day_events", outcome: "unchanged", errorCode: null, rowsSeen: 2, rowsWritten: 0, rowsWithdrawn: 0, finishedAt: "2026-11-19T21:50:00Z" });
    expect(steps).toEqual(["from:demand_signal_runs", expect.stringMatching(/^select:/), "eq:source_id,nws", "eq:feed,day_events", `eq:location_id,${SHOP.id}`,
      "neq:outcome,failed", "order:finished_at:desc", "order:id:desc", "limit:1"]);
  });
  it("the mocked names above are the store's real exports", () => {
    expect(typeof loadLatestRun).toBe("function"); expect(typeof loadSourceRegister).toBe("function"); expect(typeof loadSourceRows).toBe("function");
  });
});

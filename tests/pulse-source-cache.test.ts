/**
 * Astra #2 — the cross-poll source cache and the abort proxy:
 *   - one load per (source, shop, day, scope) for SOURCE_TTL_MS; in-flight calls share the promise;
 *   - rejections are never cached; writers invalidate by prefix; TTL just under the 60 s poll;
 *   - scope safety: crew report statuses are keyed per viewer, the board is shared and viewer-patched,
 *     handoff is shared raw and projected per viewer;
 *   - withAbort() puts the one deadline signal on every query a client issues.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedSource, invalidateSource, resetSourceCache, SOURCE_TTL_MS, sourceCacheSize, sourceKey } from "@/lib/pulse/source-cache";
import { withAbort } from "@/lib/pulse/abort";
import { cachedPulseDeps, loadPulseSection, sourceScope, type PulseCtx, type PulseDeps } from "@/lib/pulse/sections";
import type { AuthContext } from "@/lib/session";

beforeEach(() => resetSourceCache());
afterEach(() => resetSourceCache());

describe("cachedSource", () => {
  it("shares one in-flight load, serves it until the TTL, reloads after, and never caches a rejection", async () => {
    expect(SOURCE_TTL_MS).toBeLessThan(60_000);
    expect(SOURCE_TTL_MS).toBeGreaterThanOrEqual(45_000);
    let loads = 0;
    const load = vi.fn(async () => ++loads);
    const [a, b] = await Promise.all([cachedSource("k", load, { now: 0 }), cachedSource("k", load, { now: 10 })]);
    expect([a, b]).toEqual([1, 1]);
    expect(await cachedSource("k", load, { now: SOURCE_TTL_MS - 1 })).toBe(1);
    expect(await cachedSource("k", load, { now: SOURCE_TTL_MS })).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    const boom = vi.fn(async () => { throw new Error("down"); });
    await expect(cachedSource("bad", boom, { now: 0 })).rejects.toThrow("down");
    await expect(cachedSource("bad", boom, { now: 1 })).rejects.toThrow("down");
    expect(boom).toHaveBeenCalledTimes(2); // the failure was not served from the cache
  });
  it("invalidateSource drops by prefix (a writer busts its own shop's source only)", async () => {
    await cachedSource(sourceKey({ source: "handoff", locationId: "A", date: "d", scope: "shop" }), async () => 1);
    await cachedSource(sourceKey({ source: "handoff", locationId: "B", date: "d", scope: "shop" }), async () => 1);
    await cachedSource(sourceKey({ source: "layout", locationId: "A", date: "d", scope: "shop" }), async () => 1);
    expect(sourceCacheSize()).toBe(3);
    expect(invalidateSource("handoff|A|")).toBe(1);
    expect(sourceCacheSize()).toBe(2);
  });
});

const LOC = "11111111-1111-4111-8111-111111111111";
const ctx = (level: number, id: string): PulseCtx => ({
  auth: { user: { id, role: "gm", language: "en" } as AuthContext["user"], session: {} as AuthContext["session"], role: "gm", level, locations: [LOC] },
  locationId: LOC, date: "2026-10-09", now: new Date("2026-10-09T19:30:00Z"),
});
function deps(): PulseDeps & { counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const count = <T,>(name: string, value: T) => async () => { counts[name] = (counts[name] ?? 0) + 1; return value; };
  return {
    counts,
    board: count("board", { locationId: LOC, date: "2026-10-09", viewerId: "loader", viewerLevel: 0, stations: [], people: [], events: [], tasks: [] }),
    reports: count("reports", { rows: [], closingDone: false, midDayDoneCount: 0 }),
    fridges: count("fridges", []), cateringToday: count("cateringToday", []), cateringTomorrow: count("cateringTomorrow", { count: 0, firstWindow: null }),
    notRung: count("notRung", []), unlinkedClockIns: count("unlinked", { count: 0, names: [] }), lastParPass: count("parPass", null),
    deliveries: count("deliveries", []), cutoffs: count("cutoffs", { count: 0, vendors: [] }),
    sales: count("sales", {} as never), handoff: count("handoff", { notes: [], acks: [], names: {} }), layout: count("layout", null),
  };
}

describe("cachedPulseDeps — scope-safe sharing", () => {
  it("the board is read once per shop per poll for any number of viewers, and each viewer gets their own viewer fields", async () => {
    const d = deps();
    const c = cachedPulseDeps(d, { now: () => 1_000 });
    const [gm, kh, crew] = await Promise.all([c.board(ctx(7, "gm")), c.board(ctx(4, "kh")), c.board(ctx(3, "crew"))]);
    expect(d.counts.board).toBe(1);
    expect([gm.viewerId, kh.viewerId, crew.viewerId]).toEqual(["gm", "kh", "crew"]);
    expect([gm.viewerLevel, kh.viewerLevel, crew.viewerLevel]).toEqual([7, 4, 3]);
  });
  it("report statuses are shared at KH+ but keyed PER VIEWER below KH (assignment-dependent)", async () => {
    const d = deps();
    const c = cachedPulseDeps(d, { now: () => 1_000 });
    await Promise.all([c.reports(ctx(7, "gm")), c.reports(ctx(5, "sl")), c.reports(ctx(3, "a")), c.reports(ctx(3, "b")), c.reports(ctx(3, "a"))]);
    expect(d.counts.reports).toBe(3); // full + user:a + user:b
    expect(sourceScope("reports", ctx(4, "x"))).toBe("full");
    expect(sourceScope("reports", ctx(3, "x"))).toBe("user:x");
    expect(sourceScope("board", ctx(3, "x"))).toBe("shop");
  });
  it("keeps formatted cutoffs separate by language within the same shop", async () => {
    const d = deps();
    d.cutoffs = vi.fn(async (viewer) => ({ count: 1, vendors: [{
      vendorId: "vendor", vendorName: "Vendor", cutoffTime: viewer.auth.user.language === "es" ? "4:00 p. m." : "4:00 PM", hasDraft: false,
    }] }));
    const c = cachedPulseDeps(d, { now: () => 1_000 });
    const spanish = ctx(8, "director");
    spanish.auth.user.language = "es";
    const english = ctx(4, "kh");
    expect((await c.cutoffs(spanish)).vendors[0]?.cutoffTime).toBe("4:00 p. m.");
    expect((await c.cutoffs(english)).vendors[0]?.cutoffTime).toBe("4:00 PM");
    expect((await c.cutoffs(ctx(8, "other"))).vendors[0]?.cutoffTime).toBe("4:00 PM");
    expect(d.cutoffs).toHaveBeenCalledTimes(2);
  });
  it("projects crew-redacted catering after a level-8 viewer warms the shop cache", async () => {
    const d = deps();
    d.cateringToday = vi.fn(async () => [{ id: "event", name: "Private customer", timeWindow: "4:00 PM", headcount: 12, isDelivery: true, stage: "confirmed" as const, source: "ezcater" }]);
    const c = cachedPulseDeps(d, { now: () => 1_000 });
    expect(await loadPulseSection(c, ctx(8, "director"), "catering")).toMatchObject({ state: "ok", data: {
      redacted: false, today: [{ name: "Private customer", source: "ezcater" }],
    } });
    const crew = await loadPulseSection(c, ctx(3, "crew"), "catering");
    expect(crew).toMatchObject({ state: "ok", data: {
      redacted: true, today: [{ name: null, source: null, timeWindow: "4:00 PM", headcount: 12 }], notRung: [],
    } });
    expect(JSON.stringify(crew)).not.toContain("Private customer");
    expect(d.cateringToday).toHaveBeenCalledTimes(1);
  });
  it("a second poll inside the TTL reads nothing; after the TTL every source reloads", async () => {
    const d = deps();
    let now = 0;
    const c = cachedPulseDeps(d, { now: () => now });
    // `salesStamp` is the one optional dep (absent from this fake), hence `?.`.
    const poll = async () => { for (const k of Object.keys(d).filter((k) => k !== "counts") as Array<keyof PulseDeps>) await c[k]?.(ctx(7, "gm")); };
    await poll();
    const first = { ...d.counts };
    now = 30_000; await poll();
    expect(d.counts).toEqual(first);
    now = SOURCE_TTL_MS + 1; await poll();
    expect(Object.values(d.counts).every((n) => n === 2)).toBe(true);
  });
});

describe("withAbort", () => {
  it("appends the signal to every from().<verb>() chain and to rpc()", () => {
    const seen: AbortSignal[] = [];
    const builder = () => { const q: Record<string, unknown> = { eq: () => q, abortSignal: (s: AbortSignal) => { seen.push(s); return q; } }; return q; };
    const client = { from: () => ({ select: () => builder(), update: () => builder() }), rpc: () => builder(), auth: "untouched" };
    const signal = AbortSignal.timeout(1_000);
    const wrapped = withAbort(client as never, signal) as unknown as typeof client;
    (wrapped.from() as ReturnType<typeof client.from>).select();
    (wrapped.from() as ReturnType<typeof client.from>).update();
    wrapped.rpc();
    expect(seen).toEqual([signal, signal, signal]);
    expect(wrapped.auth).toBe("untouched");
  });
});

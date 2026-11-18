/**
 * Demand signals: WHERE IS EACH SHOP (the NWS collector's shop points). A shop's point is its ACTIVE catering
 * fulfilment node; exactly one designated point per shop. The table has no primary flag (0138), so several active
 * nodes for one shop is refused by name, never resolved by picking one. A shop with no point is LISTED in the run
 * result (`no_coordinates`), never silently skipped.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("not used"); } }));

import { pickShopPoints } from "@/lib/demand-signals/shop-points-shared";
import { nwsCollectDeps } from "@/lib/demand-signals/signal-store";
import { runNwsCollection, type CollectDeps, type IngestResult } from "@/lib/demand-signals/collect";
import { NWS_DEFINITION } from "@/lib/demand-signals/nws-shared";
import type { SupabaseClient } from "@supabase/supabase-js";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", C = "00000000-0000-4000-8000-00000000000c";
const node = (location_id: string, over: Partial<{ lat: number; lng: number; active: boolean }> = {}) => ({ location_id, lat: 38.9, lng: -77.0, active: true, ...over });

describe("pickShopPoints (pure)", () => {
  it("one active node per active shop = that shop's point", () => {
    expect(pickShopPoints([A], [node(A, { lat: 38.88, lng: -76.99 })])).toEqual({ points: [{ locationId: A, lat: 38.88, lon: -76.99 }], unplaced: [] });
  });
  it("an INACTIVE node is not a point: the shop has no coordinates", () => {
    expect(pickShopPoints([A], [node(A, { active: false })])).toEqual({ points: [], unplaced: [{ locationId: A, reason: "no_coordinates" }] });
  });
  it("a shop with no node is listed, never skipped", () => {
    expect(pickShopPoints([A, B], [node(B)])).toEqual({ points: [{ locationId: B, lat: 38.9, lon: -77 }], unplaced: [{ locationId: A, reason: "no_coordinates" }] });
  });
  it("several ACTIVE nodes for one shop are refused by name; nothing is picked (order-independent)", () => {
    const one = pickShopPoints([A], [node(A, { lat: 1, lng: 2 }), node(A, { lat: 3, lng: 4 })]);
    const two = pickShopPoints([A], [node(A, { lat: 3, lng: 4 }), node(A, { lat: 1, lng: 2 })]);
    expect(one).toEqual({ points: [], unplaced: [{ locationId: A, reason: "multiple_points" }] });
    expect(two).toEqual(one);
  });
  it("one active node beside inactive ones is the point", () => {
    expect(pickShopPoints([A], [node(A, { active: false, lat: 1 }), node(A, { lat: 38.91, lng: -77.05 })]).points).toEqual([{ locationId: A, lat: 38.91, lon: -77.05 }]);
  });
  it("a node of an inactive (or unknown) shop is ignored; output is in shop id order", () => {
    expect(pickShopPoints([C, A], [node(B), node(C), node(A)])).toEqual({
      points: [{ locationId: A, lat: 38.9, lon: -77 }, { locationId: C, lat: 38.9, lon: -77 }], unplaced: [] });
  });
  it("non-finite coordinates are not a point", () => {
    expect(pickShopPoints([A], [node(A, { lat: Number.NaN })]).unplaced).toEqual([{ locationId: A, reason: "bad_coordinates" }]);
  });
});

/** A PostgREST stand-in: every `from(t).select(...).eq(...)` resolves to the table's rows after the filters. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, seen: Array<{ table: string; select: string; eq: Array<[string, unknown]> }>) {
  return {
    from(table: string) {
      const q = { table, select: "", eq: [] as Array<[string, unknown]> };
      const b = {
        select(cols: string) { q.select = cols; return b; },
        eq(col: string, v: unknown) { q.eq.push([col, v]); return b; },
        returns() { return b; },
        abortSignal() { return b; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          seen.push(q);
          const rows = (tables[table] ?? []).filter((r) => q.eq.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("the real loader (nwsCollectDeps.loadShopPoints)", () => {
  it("reads active shops and every node WITH its active flag, and applies the one rule", async () => {
    const seen: Array<{ table: string; select: string; eq: Array<[string, unknown]> }> = [];
    const sb = fakeDb({
      locations: [{ id: A, active: true }, { id: B, active: true }, { id: C, active: false }],
      catering_fulfillment_nodes: [node(A, { active: false }), node(B, { lat: 38.88, lng: -76.99 }), node(C)],
    }, seen);
    const deps = nwsCollectDeps(sb, { userAgent: "t", deadlineAt: Date.now() + 10_000, counter: { requests: 0 } });
    const out = await deps.loadShopPoints(new AbortController().signal);
    expect(out).toEqual({ points: [{ locationId: B, lat: 38.88, lon: -76.99 }], unplaced: [{ locationId: A, reason: "no_coordinates" }] });
    expect(seen.find((q) => q.table === "catering_fulfillment_nodes")!.select).toMatch(/\bactive\b/);
  });
});

describe("the collection pass lists a shop with no point", () => {
  const NOW = Date.parse("2026-11-18T15:00:00Z");
  it("no_coordinates / multiple_points shops are in the result, make no request and no write, and count as failed", async () => {
    const getJson = vi.fn(async () => ({ ok: false as const, code: "server_error" }));
    const ingestWeather = vi.fn(async (): Promise<IngestResult> => ({ ok: true, seen: 0, written: 0 }));
    const recordFailure = vi.fn(async () => {});
    const deps: CollectDeps = {
      loadSourceStates: async () => [{ sourceId: "nws", definitionHash: NWS_DEFINITION.hash, gate: "allow_with_conditions", adapter: "nws@1", status: "verified" }],
      loadShopPoints: async () => ({ points: [], unplaced: [{ locationId: B, reason: "multiple_points" }, { locationId: A, reason: "no_coordinates" }] }),
      getJson, ingestWeather, ingestEvents: async () => ({ ok: true, seen: 0, written: 0 }), recordFailure, now: () => NOW,
    };
    const res = await runNwsCollection(deps, { deadlineAt: NOW + 60_000, userAgent: "t" });
    expect(res).toEqual({ status: "ran", weatherRows: 0, failed: 4, shops: [
      { locationId: A, weather: { error: "no_coordinates" }, alerts: { error: "no_coordinates" } },
      { locationId: B, weather: { error: "multiple_points" }, alerts: { error: "multiple_points" } },
    ] });
    expect(getJson).not.toHaveBeenCalled();
    expect(ingestWeather).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

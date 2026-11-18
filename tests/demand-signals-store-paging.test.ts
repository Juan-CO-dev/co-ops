/**
 * Item 4 PR 2, review r1 P2 #2: the stored-signal readers read their set to COMPLETION or refuse by name.
 * PostgREST answers an unranged read of a set-returning function with at most max-rows (1,000) rows and no
 * error, so one call silently drops signals once a window holds more. The fake below is that server: an
 * unranged read is cut at 1,000; a ranged read with `count: "exact"` gets its page and the total.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("not used"); } }));

import { NWS_DEFINITION } from "@/lib/demand-signals/nws-shared";
import { DemandSignalError, SIGNAL_READ_MAX_PAGES, SIGNAL_READ_PAGE, loadUsableDayEvents, loadUsableWeather } from "@/lib/demand-signals/signal-store";

const MAX_ROWS = 1_000;
type Row = Record<string, unknown>;
interface Served { name: string; range: [number, number] | null; count: string | null }

/** `rows(call)` is the function's whole ordered result at that call; `countOf` lets a test move the total. */
function server(rows: (served: number) => Row[], opts: { countOf?: (served: number, real: number) => number | null } = {}) {
  const served: Served[] = [];
  let eventCalls = 0;
  const client = {
    rpc(name: string, _args: Row, options?: { count?: string }) {
      if (name === "demand_source_states") {
        return Promise.resolve({ data: [{ source_id: "nws", definition_hash: NWS_DEFINITION.hash, gate: "allow_with_conditions", adapter: "nws@1", status: "verified" }], error: null });
      }
      let range: [number, number] | null = null;
      const settle = () => {
        const all = rows(eventCalls++);
        served.push({ name, range, count: options?.count ?? null });
        const data = range ? all.slice(range[0], Math.min(range[1] + 1, range[0] + MAX_ROWS)) : all.slice(0, MAX_ROWS);
        const count = options?.count === "exact" ? (opts.countOf ? opts.countOf(eventCalls - 1, all.length) : all.length) : null;
        return { data, error: null, count };
      };
      const builder = {
        range(a: number, z: number) { range = [a, z]; return builder; },
        abortSignal() { return builder; },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(settle).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client: client as never, served };
}

const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const eventRow = (i: number): Row => ({ id: id(i), origin: i % 2 ? "manual" : "feed", source_id: i % 2 ? null : "nws", location_id: null, category: "other",
  valid_from: "2026-11-18", valid_to: "2026-11-18", start_local: null, end_local: null, title: `Event ${i}`, expected_impact: "unknown", severity: null,
  issued_at: null, available_at: "2026-11-18T12:00:00+00:00" });
const events = (n: number) => Array.from({ length: n }, (_, i) => eventRow(i));
const ARGS = { locationId: id(999_999), from: "2026-11-18", to: "2026-12-18", asOfIso: "2026-11-18T16:00:00Z", use: "compute" as const };

describe("loadUsableDayEvents reads to completion", () => {
  it("returns every one of 2,345 events, in the reader's order, page by page with an exact count", async () => {
    const all = events(2_345);
    const s = server(() => all);
    const got = await loadUsableDayEvents(s.client, ARGS);
    expect(got).toHaveLength(2_345);
    expect(got.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(s.served.map((c) => c.range)).toEqual([[0, 999], [1_000, 1_999], [2_000, 2_999]]);
    expect(s.served.every((c) => c.count === "exact")).toBe(true);
    expect(SIGNAL_READ_PAGE).toBe(1_000);
  });
  it("exactly one page, and an empty set, are one request each", async () => {
    const full = server(() => events(1_000));
    expect(await loadUsableDayEvents(full.client, ARGS)).toHaveLength(1_000);
    expect(full.served).toHaveLength(1);
    const none = server(() => []);
    expect(await loadUsableDayEvents(none.client, ARGS)).toEqual([]);
    expect(none.served).toHaveLength(1);
  });
  it.each([
    ["the total moves between pages (a row was added, or a source was revoked)", server((n) => events(n === 0 ? 1_500 : 1_501))],
    ["the server gives no count", server(() => events(1_500), { countOf: () => null })],
    ["a page comes back empty before the count is reached", server((n) => (n === 0 ? events(1_500) : events(1_000)), { countOf: () => 1_500 })],
    ["the server returns more rows than it counted", server(() => events(1_500), { countOf: () => 900 })],
  ])("refuses by name, never a partial list: %s", async (_name, s) => {
    const refused = await loadUsableDayEvents(s.client, ARGS).then(() => null, (e: unknown) => e);
    expect(refused).toBeInstanceOf(DemandSignalError);
    expect(refused).toMatchObject({ status: 503, code: "signal_reads_incomplete" });
  });
  it("stops at the page limit by name", async () => {
    const s = server(() => events((SIGNAL_READ_MAX_PAGES + 1) * 1_000));
    await expect(loadUsableDayEvents(s.client, ARGS)).rejects.toMatchObject({ status: 503, code: "signal_reads_incomplete" });
    expect(s.served).toHaveLength(SIGNAL_READ_MAX_PAGES);
  });
});

describe("loadUsableWeather reads the same way", () => {
  it("pages a set over the response cap", async () => {
    const hours = Array.from({ length: 1_200 }, (_, i): Row => ({ source_id: "nws", valid_hour: new Date(Date.UTC(2026, 10, 18) + i * 3_600_000).toISOString(),
      issued_at: "2026-11-18T14:00:00+00:00", available_at: "2026-11-18T15:00:00+00:00", vintage_id: i + 1, temperature_f: 57, precip_probability_pct: 0,
      wind_speed_mph: 2, relative_humidity_pct: 40, is_daytime: true, condition: "Sunny" }));
    const s = server(() => hours);
    const got = await loadUsableWeather(s.client, { locationId: id(1), fromIso: "2026-11-18T00:00:00Z", toIso: "2026-11-19T00:00:00Z", asOfIso: "2026-11-18T16:00:00Z", use: "render" });
    expect(got.map((r) => r.vintageId)).toEqual(hours.map((r) => r.vintage_id));
    expect(s.served.map((c) => c.range)).toEqual([[0, 999], [1_000, 1_999]]);
  });
});

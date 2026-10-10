/**
 * Astra #3 — the batched fridge reader: THREE location/day-scoped queries for any number of fridges
 * (equipment · today's instances · live completions on those instances), statuses via the house
 * computeFridgeStatus, and the deadline signal reaching every query.
 */
import { describe, expect, it } from "vitest";
import { loadFridgesToday } from "@/lib/pulse/fridges";

type Call = { table: string; filters: Array<[string, unknown]>; signal: AbortSignal | null; range: [number, number] | null };
function fakeService(data: { fridges: unknown[]; instances: unknown[]; completions: unknown[] }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, filters: [], signal: null, range: null };
    calls.push(call);
    const rows = table === "maintenance_equipment" ? data.fridges : table === "checklist_instances" ? data.instances : data.completions;
    const q: Record<string, unknown> = {
      select: () => q, order: () => q, returns: () => q,
      eq: (c: string, v: unknown) => { call.filters.push([c, v]); return q; },
      in: (c: string, v: unknown) => { call.filters.push([c, v]); return q; },
      is: (c: string, v: unknown) => { call.filters.push([c, v]); return q; },
      range: (a: number, b: number) => { call.range = [a, b]; return q; },
      abortSignal: (s: AbortSignal) => { call.signal = s; return q; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const page = call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows;
        return Promise.resolve({ data: page, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return { client: { from } as never, calls };
}
const LOC = "11111111-1111-4111-8111-111111111111";
const fridge = (n: number) => ({ id: `f${n}`, name: `Fridge ${n}`, opening_temp_item_id: `am${n}`, closing_temp_item_id: `pm${n}`, safe_max_f: 41 });

describe("loadFridgesToday", () => {
  it("six fridges → exactly 3 queries, each bounded by location/day, with statuses from today's readings only", async () => {
    const fridges = [1, 2, 3, 4, 5, 6].map(fridge);
    const instances = [{ id: "i-open" }, { id: "i-close" }];
    const completions = [
      { template_item_id: "am1", count_value: 38, completed_at: "2026-10-09T13:00:00Z" },
      { template_item_id: "pm1", count_value: "44", completed_at: "2026-10-09T23:00:00Z" }, // numeric arrives as string
      { template_item_id: "am2", count_value: 39, completed_at: "2026-10-09T13:05:00Z" },
      { template_item_id: "am3", count_value: null, completed_at: "2026-10-09T13:06:00Z" }, // a blank reading is not a reading
    ];
    const { client, calls } = fakeService({ fridges, instances, completions });
    const signal = AbortSignal.timeout(5_000);
    const out = await loadFridgesToday(client, { locationId: LOC, date: "2026-10-09", signal });
    expect(calls.map((c) => c.table)).toEqual(["maintenance_equipment", "checklist_instances", "checklist_completions"]);
    expect(calls[0]!.filters).toEqual(expect.arrayContaining([["location_id", LOC], ["active", true], ["kind", "fridge"]]));
    expect(calls[1]!.filters).toEqual(expect.arrayContaining([["location_id", LOC], ["date", "2026-10-09"]]));
    expect(calls[2]!.filters).toEqual(expect.arrayContaining([["instance_id", ["i-open", "i-close"]], ["superseded_at", null], ["revoked_at", null]]));
    expect(calls[2]!.filters.find(([c]) => c === "template_item_id")![1]).toHaveLength(12);
    for (const c of calls) expect(c.signal).toBe(signal);
    expect(out.map((f) => f.status)).toEqual(["out_of_range", "ok", "no_reading_today", "no_reading_today", "no_reading_today", "no_reading_today"]);
    expect(out[0]).toMatchObject({ id: "f1", name: "Fridge 1", latestF: 44, readings: [38, 44] });
    expect(out[1]).toMatchObject({ latestF: 39, readings: [39] });
    expect(out[2]).toMatchObject({ latestF: null, readings: [] });
  });
  it("no instances today → 2 queries and every fridge is 'no reading today'; no fridges → 1 query", async () => {
    const a = fakeService({ fridges: [fridge(1), fridge(2)], instances: [], completions: [] });
    const out = await loadFridgesToday(a.client, { locationId: LOC, date: "2026-10-09" });
    expect(a.calls.map((c) => c.table)).toEqual(["maintenance_equipment", "checklist_instances"]);
    expect(out.map((f) => f.status)).toEqual(["no_reading_today", "no_reading_today"]);
    const b = fakeService({ fridges: [], instances: [], completions: [] });
    expect(await loadFridgesToday(b.client, { locationId: LOC, date: "2026-10-09" })).toEqual([]);
    expect(b.calls).toHaveLength(1);
  });
  it("completions are PAGED (500 a page) so a busy day can never truncate today's readings", async () => {
    const completions = Array.from({ length: 1203 }, (_, i) => ({ template_item_id: i % 2 ? "am1" : "pm1", count_value: 40, completed_at: `2026-10-09T13:${String(i % 60).padStart(2, "0")}:00Z` }));
    const { client, calls } = fakeService({ fridges: [fridge(1)], instances: [{ id: "i" }], completions });
    const out = await loadFridgesToday(client, { locationId: LOC, date: "2026-10-09" });
    expect(calls.filter((c) => c.table === "checklist_completions").map((c) => c.range)).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(out[0]!.readings).toHaveLength(1203);
  });
});

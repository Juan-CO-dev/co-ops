/**
 * Nav PR 6, ruling B4 (plan r3, 8.6): `loadItemDefns` / `loadItemOverrides` are BOUNDED (ids chunked at 100 for the
 * request line) and PAGED (each chunk read to the end with `selectAllRows`, ordered by id). Before this they sent the
 * whole id set through one `.in()` and read one response: past the request line the read failed, and past 1,000
 * override rows the response cap dropped rows, so `pickOverride` silently chose the wrong par.
 */
import { describe, expect, it, vi } from "vitest";
import { ITEM_READ_CHUNK, loadItemDefns, loadItemOverrides, pickOverride } from "@/lib/items";
import { loadPrepOverview } from "@/lib/admin/prep-overview";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const ids = (n: number, prefix = "item") => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(4, "0")}`);
const rangeOf = (c: FakeCall) => c.arg("range", 0) as number;
const inIds = (c: FakeCall) => c.arg("in", 1) as string[];

/**
 * A table answered like PostgREST: the rows matching the call's `.in()` and `.eq()`s, in id order, cut by `.range()`
 * (no range = the 1,000-row response cap). An `.in()` of more than 100 ids stands in for the request line refused (414).
 */
function table(rows: Array<Record<string, unknown>>, column: string) {
  return (c: FakeCall) => {
    if (inIds(c).length > 100) return { error: { message: "414 request line too long" } };
    const wanted = new Set(inIds(c));
    const eqs = c.ops.filter((o) => o.op === "eq").map((o) => o.args as [string, unknown]);
    const matched = rows.filter((r) => wanted.has(String(r[column])) && eqs.every(([k, v]) => r[k] === v))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const from = c.has("range") ? rangeOf(c) : 0;
    const to = c.has("range") ? (c.arg("range", 1) as number) : 999;
    return { data: matched.slice(from, to + 1) };
  };
}

describe("loadItemDefns: bounded and paged", () => {
  it("an empty id list makes no call", async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [] }));
    expect((await loadItemDefns(client as never, [])).size).toBe(0);
    expect((await loadItemDefns(client as never, ["", ""])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("250 distinct ids: every .in() carries at most 100 ids, ordered by id, and every item comes back", async () => {
    const all = ids(250);
    const rows = all.map((id, i) => ({ id, name: `Item ${i}`, name_es: null, default_par: i, default_par_unit: "ea", active: true }));
    const { client, calls } = fakeSupabase(table(rows, "id"));
    const map = await loadItemDefns(client as never, [...all, ...all.slice(0, 10)]);
    expect(map.size).toBe(250);
    expect(map.get("item-0249")).toEqual({ name: "Item 249", nameEs: null, defaultPar: 249, defaultParUnit: "ea", active: true });
    expect(calls.map((c) => inIds(c).length)).toEqual([100, 100, 50]);
    for (const c of calls) {
      expect(inIds(c).length).toBeLessThanOrEqual(ITEM_READ_CHUNK);
      expect(c.has("order", "id", { ascending: true })).toBe(true);
      expect(c.arg("range", 0)).toBe(0);
    }
    expect(new Set(calls.flatMap(inIds)).size).toBe(250);
  });

  it("a chunk pages until a short page (a full first page reads the next)", async () => {
    // A fake that ignores the ids and returns 1,000 rows for page 0: the reader must ask for page 1.
    const page = (from: number) => Array.from({ length: from === 0 ? 1000 : 3 }, (_, i) => ({ id: `x-${from + i}`, name: "n", name_es: null, default_par: 1, default_par_unit: null, active: true }));
    const { client, calls } = fakeSupabase((c) => ({ data: page(rangeOf(c)) }));
    const map = await loadItemDefns(client as never, ["a"]);
    expect(calls.map(rangeOf)).toEqual([0, 1000]);
    expect(map.size).toBe(1003);
  });

  it("a page error throws (no partial map)", async () => {
    const { client } = fakeSupabase((c) => (rangeOf(c) === 0 && inIds(c)[0] === "item-0100" ? { error: { message: "boom" } } : { data: [] }));
    await expect(loadItemDefns(client as never, ids(150))).rejects.toThrow(/loadItemDefns: .*boom/);
  });
});

describe("loadItemOverrides: bounded and paged", () => {
  it("more than 1,000 override rows: the second page's deciding weekday override is kept", async () => {
    const items = ids(250);
    const rows: Array<Record<string, unknown>> = [];
    let n = 0;
    // 5 rows per item (base + four weekdays) = 1,250 rows; within ONE chunk of 100 items that is 500 rows, so to
    // cross a page boundary inside a chunk, give the first chunk's items 12 rows each (1,200 rows in chunk 1).
    for (const [i, item] of items.entries()) {
      const days = i < 100 ? [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [null, 0, 1, 2, 3];
      for (const d of days) rows.push({ id: `p-${String(n++).padStart(6, "0")}`, item_id: item, location_id: "shop", active: true,
        day_of_week: d, par_value: d === 3 ? 30 : 10, par_unit: null, par_mode: "manual" });
    }
    // The Wednesday (dow 3) row of the LAST item of chunk 1 sits past row 1,000 of that chunk.
    const { client, calls } = fakeSupabase(table(rows, "item_id"));
    const map = await loadItemOverrides(client as never, items, "shop");
    expect(map.size).toBe(250);
    expect([...map.values()].reduce((a, r) => a + r.length, 0)).toBe(rows.length);
    expect(pickOverride(map.get("item-0099")!, 3)?.parValue).toBe(30);
    // Chunk 1 needed two pages; chunks 2 and 3 one each.
    expect(calls.map((c) => [inIds(c).length, rangeOf(c)])).toEqual([[100, 0], [100, 1000], [100, 0], [50, 0]]);
    for (const c of calls) {
      expect(c.has("eq", "location_id", "shop")).toBe(true);
      expect(c.has("eq", "active", true)).toBe(true);
      expect(c.has("order", "id", { ascending: true })).toBe(true);
    }
  });

  it("small inputs: the same map the unbounded read gave", async () => {
    const rows = [
      { id: "1", item_id: "a", location_id: "shop", active: true, day_of_week: null, par_value: 4, par_unit: null, par_mode: "manual" },
      { id: "2", item_id: "a", location_id: "shop", active: true, day_of_week: 2, par_value: 6, par_unit: null, par_mode: "auto" },
      { id: "3", item_id: "b", location_id: "shop", active: true, day_of_week: null, par_value: 1, par_unit: "ea", par_mode: "manual" },
    ];
    const { client, calls } = fakeSupabase(table(rows, "item_id"));
    const map = await loadItemOverrides(client as never, ["a", "b", "c", "a"], "shop");
    expect(Object.fromEntries(map)).toEqual({
      a: [{ dayOfWeek: null, parValue: 4, parUnit: null, parMode: "manual" }, { dayOfWeek: 2, parValue: 6, parUnit: null, parMode: "auto" }],
      b: [{ dayOfWeek: null, parValue: 1, parUnit: "ea", parMode: "manual" }],
    });
    expect(calls).toHaveLength(1);
    expect(inIds(calls[0]!)).toEqual(["a", "b", "c"]);
  });

  it("a page error throws; an empty list makes no call", async () => {
    const bad = fakeSupabase(() => ({ error: { message: "down" } }));
    await expect(loadItemOverrides(bad.client as never, ["a"], "shop")).rejects.toThrow(/loadItemOverrides: .*down/);
    const none = fakeSupabase(() => ({ data: [] }));
    expect((await loadItemOverrides(none.client as never, [], "shop")).size).toBe(0);
    expect(none.calls).toEqual([]);
  });
});

describe("a consumer, past 100 items: the prep overview resolves every linked line", () => {
  it("250 linked lines across one template: every line takes its registry name", async () => {
    const items = ids(250);
    const actor = { user: { role: "cgs" }, locations: [] } as unknown as AuthContext;
    const { client } = fakeSupabase((c) => {
      if (c.table === "locations") return { data: [{ id: "shop", name: "Shop" }] };
      if (c.table === "checklist_templates") {
        return c.has("eq", "prep_subtype", "am_prep")
          ? { data: { id: "tpl", name: "AM prep" } }
          : { data: null };
      }
      if (c.table === "checklist_template_items") {
        return { data: items.map((id, i) => ({ id: `line-${i}`, template_id: "tpl", item_id: id, label: `raw ${i}`, active: true,
          display_order: i, station: "Prep", required: false, expects_count: false, expects_photo: false, min_role_level: 3,
          report_reference_type: null, translations: null, prep_meta: { section: "veg", columns: ["count"] } })) };
      }
      if (c.table === "items") return table(items.map((id, i) => ({ id, name: `Registry ${i}`, name_es: null, default_par: 1, default_par_unit: null, active: true })), "id")(c);
      return { data: [] };
    });
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
    const report = await loadPrepOverview(actor);
    const lines = report.templates.flatMap((t) => t.lines);
    expect(lines).toHaveLength(250);
    expect(lines.every((l) => /^Registry \d+$/.test(l.displayLabel))).toBe(true);
  });
});

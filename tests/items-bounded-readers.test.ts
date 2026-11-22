/**
 * Nav PR 6, ruling B4 (plan r3, 8.6): `loadItemDefns` / `loadItemOverrides` are BOUNDED (ids chunked at 100 for the
 * request line) and PAGED (each chunk read to the end with `selectAllRows`, ordered by id). Before this they sent the
 * whole id set through one `.in()` and read one response: past the request line the read failed, and past 1,000
 * override rows the response cap dropped rows, so `pickOverride` silently chose the wrong par.
 */
import { describe, expect, it, vi } from "vitest";
import { ITEM_READ_CHUNK, loadItemDefns, loadItemOverrides, pickOverride } from "@/lib/items";
import { loadPrepOverview } from "@/lib/admin/prep-overview";
import { loadOpeningState } from "@/lib/opening";
import { loadAmPrepState, loadMidDayPrepState, submitAmPrep } from "@/lib/prep";
import { REQUEST_LINE_BUDGET_BYTES } from "@/lib/supabase-paginate";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
// The consumers below run for real; only the access check, the audit writer and the recipe-graph readers are stood in
// for (no database here), as in tests/opening-load-day-instance.test.ts and tests/prep-bad-row-writers.test.ts.
vi.mock("@/lib/assignments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assignments")>()),
  hasTaskAccess: vi.fn(async () => true),
  auditTaskOverride: vi.fn(async () => {}),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/prep-consumption", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prep-consumption")>()),
  loadDerivedForItems: vi.fn(async () => new Map()),
  loadBatchDerivedForItems: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/batch-prep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/batch-prep")>()),
  loadBatchContextForItems: vi.fn(async () => new Map()),
}));

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

// ══ Their other consumers, past 100 items and past the 1,000-row response (plan r3 8.6, ruling B4; Astra r1) ══════════
//
// 180 registry items linked from one template: two `.in()` chunks (100 + 80). Each item has 7 active overrides at the shop
// (the all-days base and six weekdays; the unique indexes of 0080 allow at most 8), so ONE unchunked read matches 1,260 rows
// and PostgREST's 1,000-row response drops the last 260 in id order: the deciding Wednesday row of items 142-179. 180 UUIDs
// (about 6.7 KB) still fit the request line, so before the fix that loss was SILENT: item 142 fell back to its base row and
// items 143-179 (every row lost) to the item default, and the line showed the wrong par. Every consumer below must show, for
// every line, the registry name and the par of a hand-written table. (Capping a CHUNK at one page is not reachable through a
// consumer on schema-valid data: 100 items x at most 8 active rows = 800 < 1,000. The reader cases above pin that page.)

type Row = Record<string, unknown>;
const N = 180;
const PLAN_DAY = "2026-11-18"; // a Wednesday: the deciding override is day_of_week 3
const WED = 3;
const SHOP = "10000000-0000-4000-8000-000000000001";
const OTHER_SHOP = "10000000-0000-4000-8000-000000000002";
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const itemId = (i: number) => uuid("20000000", i);
const lineId = (i: number) => uuid("30000000", i);
const every = <T,>(f: (i: number) => T) => Array.from({ length: N }, (_, i) => f(i));

/** The expected par, written out from the rule (the day's MANUAL override, else the item's default par), not computed by it. */
const EXPECTED_PAR = (i: number) => (i % 3 === 2 ? i + 1 : 500 + i);
const EXPECTED_NAME = (i: number) => `Registry ${i}`;
const EXPECTED_NAME_ES = (i: number) => (i % 2 === 0 ? `Registro ${i}` : undefined);

const registry = (): Row[] => every((i) => ({ id: itemId(i), name: `Registry ${i}`, name_es: i % 2 === 0 ? `Registro ${i}` : null,
  default_par: i + 1, default_par_unit: "qt", active: true }));

/**
 * item_par_levels. Per item, in id order: the base (manual 200+i), five other weekdays (manual 300+i), then Wednesday:
 * manual 500+i, except every third item (i % 3 === 2), whose Wednesday row is AUTO (9000+i: never a par, so the item's
 * default stands). Plus two rows no read may use: the same Wednesday at another shop, and an inactive one here.
 */
function overrideRows(): Row[] {
  const out: Row[] = [];
  const row = (n: number, i: number, over: Row): Row =>
    ({ id: uuid("40000000", n), item_id: itemId(i), location_id: SHOP, active: true, par_unit: null, par_mode: "manual", ...over });
  for (let i = 0; i < N; i++) {
    const days: Row[] = [
      { day_of_week: null, par_value: 200 + i },
      ...[0, 1, 2, 4, 5].map((d) => ({ day_of_week: d, par_value: 300 + i })),
      i % 3 === 2 ? { day_of_week: WED, par_value: 9000 + i, par_mode: "auto" } : { day_of_week: WED, par_value: 500 + i },
    ];
    days.forEach((d, k) => out.push(row(i * 7 + k, i, d)));
    out.push(row(10_000 + i, i, { location_id: OTHER_SHOP, day_of_week: WED, par_value: 7000 + i }));
    out.push(row(20_000 + i, i, { active: false, day_of_week: WED, par_value: 8000 + i }));
  }
  return out;
}

const templateLine = (template: string, prepMeta: Row) => (i: number): Row => ({
  id: lineId(i), template_id: template, station: typeof prepMeta.section === "string" ? prepMeta.section : "Prep", display_order: i,
  label: `raw ${i}`, description: null, min_role_level: 3, required: true, expects_count: false, expects_photo: false, vendor_item_id: null,
  active: true, translations: null, prep_meta: prepMeta, report_reference_type: null, references_template_item_id: null, item_id: itemId(i),
  hard_gate: false, ref_track_item_completion: false, input_type: null,
});
const PREP_META = { section: "sauces", parValue: 1, parUnit: "raw", specialInstruction: null, columns: ["par", "total"] };
const instanceRow = (id: string, template: string, status = "open"): Row => ({
  id, template_id: template, location_id: SHOP, date: PLAN_DAY, shift_start_at: null, status, confirmed_at: null, confirmed_by: null,
  created_at: `${PLAN_DAY}T10:00:00Z`, triggered_by_user_id: null, triggered_at: null, finalized_at_actor_type: null, assigned_to: null,
  assignment_locked: false, dropped_at: null, dropped_by: null, dropped_reason: null, allows_multiple_per_day: false,
});

/**
 * A small PostgREST over in-memory tables, on the recording client: `eq` / `in` / `is` filters, `order`, then `range` (else
 * `limit`, else the 1,000-row response cap); `maybeSingle` takes the first row. An `.in()` list longer than the request line
 * (REQUEST_LINE_BUDGET_BYTES) is refused (414) before any row is read. `template:checklist_templates` embeds the row's
 * template. Any other operator fails the test rather than being silently ignored.
 */
function postgrest(tables: Record<string, Row[]>) {
  const cmp = (a: unknown, b: unknown) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : String(a) < String(b) ? -1 : 1);
  return (c: FakeCall) => {
    if (c.kind !== "select") throw new Error(`fake: unexpected ${c.kind} on ${c.table}`);
    let rows = [...(tables[c.table] ?? [])];
    const orders: Array<[string, boolean]> = [];
    for (const { op, args } of c.ops) {
      const [col, val] = args as [string, unknown];
      if (op === "eq") rows = rows.filter((r) => r[col] === val);
      else if (op === "is") rows = rows.filter((r) => (r[col] ?? null) === val);
      else if (op === "in") {
        const list = val as unknown[];
        if (list.map(String).join(",").length > REQUEST_LINE_BUDGET_BYTES) return { error: { message: "414 Request-URI Too Large" } };
        rows = rows.filter((r) => list.includes(r[col]));
      } else if (op === "order") orders.push([col, (args[1] as { ascending?: boolean } | undefined)?.ascending !== false]);
      else if (op === "or" && col.startsWith("effective_from.is.null,")) rows = rows.filter((r) => r.effective_from == null);
      else if (!["select", "range", "limit", "abortSignal", "maybeSingle", "single", "returns"].includes(op)) throw new Error(`fake: unhandled ${op} on ${c.table}`);
    }
    rows.sort((a, b) => {
      for (const [k, asc] of orders) {
        const d = typeof a[k] === "number" && typeof b[k] === "number" ? (a[k] as number) - (b[k] as number) : cmp(a[k], b[k]);
        if (d) return asc ? d : -d;
      }
      return 0;
    });
    if (String(c.arg("select") ?? "").includes("template:checklist_templates")) {
      rows = rows.map((r) => ({ ...r, template: (tables.checklist_templates ?? []).find((t) => t.id === r.template_id) ?? null }));
    }
    const from = c.has("range") ? (c.arg("range", 0) as number) : 0;
    const to = c.has("range") ? (c.arg("range", 1) as number) : c.has("limit") ? (c.arg("limit") as number) - 1 : 999;
    rows = rows.slice(from, to + 1);
    return { data: c.has("maybeSingle") || c.has("single") ? rows[0] ?? null : rows };
  };
}

/** Each registry read: at most 100 ids per `.in()`, two chunks (100 + 80), every id asked for once. */
function expectBoundedItemReads(calls: FakeCall[]) {
  for (const table of ["items", "item_par_levels"]) {
    const reads = calls.filter((c) => c.table === table);
    expect(reads.map((c) => inIds(c).length), table).toEqual([100, 80]);
    expect(new Set(reads.flatMap(inIds)), table).toEqual(new Set(every(itemId)));
  }
}

describe("their other consumers, past 100 items and past 1,000 override rows: names, weekday pars, submit", () => {
  it("the fixture: one unchunked read would match 1,260 override rows, and items 142-179 hold their Wednesday row only past row 1,000", () => {
    const here = overrideRows().filter((r) => r.location_id === SHOP && r.active === true).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    expect(here).toHaveLength(1260);
    const wednesdayAt = (i: number) => here.findIndex((r) => r.item_id === itemId(i) && r.day_of_week === WED);
    expect(wednesdayAt(141)).toBe(993);
    expect(wednesdayAt(142)).toBe(1000);
    expect(every(itemId).join(",").length).toBeLessThan(REQUEST_LINE_BUDGET_BYTES); // the old single read was not refused
  });

  it("opening Phase 2 (lib/opening.ts): every frozen snapshot carries the item's Wednesday par and unit", async () => {
    const TPL = "50000000-0000-4000-8000-000000000001";
    const tables: Record<string, Row[]> = {
      checklist_templates: [{ id: TPL, location_id: SHOP, type: "opening", name: "Opening", active: true, effective_from: null, created_at: "2026-01-01T00:00:00Z" }],
      checklist_template_items: every(templateLine(TPL, { openingPhase2: true, parValue: 1, parUnit: "raw" })),
      checklist_instances: [], checklist_completions: [], users: [], items: registry(), item_par_levels: overrideRows(),
    };
    const { client, calls, rpcs } = fakeSupabase(postgrest(tables), (r) => {
      if (r.name !== "create_opening_instance_atomic") throw new Error(`fake: unexpected rpc ${r.name}`);
      tables.checklist_instances!.push(instanceRow("op-1", TPL));
      return { data: { instance_id: "op-1", was_created: true, snapshot_count: N } };
    });
    const state = await loadOpeningState(client as never, { locationId: SHOP, date: PLAN_DAY, actor: { userId: "u-1", role: "key_holder", level: 4 } });
    expect(state?.instance.id).toBe("op-1");
    expect(rpcs).toHaveLength(1);
    const snapshots = rpcs[0]!.args.p_snapshots as Array<{ template_item_id: string; par_value: number | null; par_unit: string | null }>;
    expect(snapshots.map((s) => [s.template_item_id, s.par_value, s.par_unit])).toEqual(every((i) => [lineId(i), EXPECTED_PAR(i), "qt"]));
    expectBoundedItemReads(calls);
  });

  const AM_TPL = "50000000-0000-4000-8000-000000000002";
  const MID_TPL = "50000000-0000-4000-8000-000000000003";
  const AM_INST = "60000000-0000-4000-8000-000000000002";
  const MID_INST = "60000000-0000-4000-8000-000000000003";
  const prepTables = (): Record<string, Row[]> => ({
    checklist_templates: [
      { id: AM_TPL, location_id: SHOP, type: "prep", prep_subtype: "am_prep", name: "AM prep", active: true, effective_from: null, created_at: "2026-01-01T00:00:00Z" },
      { id: MID_TPL, location_id: SHOP, type: "prep", prep_subtype: "mid_day_prep", name: "Mid-day prep", active: true, effective_from: null, created_at: "2026-01-01T00:00:00Z" },
    ],
    checklist_template_items: [...every(templateLine(AM_TPL, PREP_META)), ...every(templateLine(MID_TPL, PREP_META))],
    checklist_instances: [instanceRow(AM_INST, AM_TPL), instanceRow(MID_INST, MID_TPL)],
    checklist_completions: [], checklist_submissions: [], users: [], prep_sections: [], items: registry(), item_par_levels: overrideRows(),
  });
  type ShownLine = { id: string; label: string; translations: { es?: { label?: string } } | null; prepMeta: { parValue?: unknown; parUnit?: unknown } | null };
  const shown = (items: ShownLine[]) => items.map((t) => [t.id, t.label, t.translations?.es?.label, t.prepMeta?.parValue, t.prepMeta?.parUnit]);
  const EXPECTED_LINES = every((i) => [lineId(i), EXPECTED_NAME(i), EXPECTED_NAME_ES(i), EXPECTED_PAR(i), "qt"]);

  it("AM prep page (lib/prep.ts loadAmPrepState): every line takes its registry name (en + es) and its Wednesday par", async () => {
    const { client, calls } = fakeSupabase(postgrest(prepTables()));
    const state = await loadAmPrepState(client as never, { locationId: SHOP, date: PLAN_DAY, actor: { userId: "u-1", role: "employee", level: 3 } });
    expect(state?.instance.id).toBe(AM_INST);
    expect(shown(state!.templateItems as ShownLine[])).toEqual(EXPECTED_LINES);
    expectBoundedItemReads(calls);
  });

  it("mid-day prep page (lib/prep.ts loadMidDayPrepState): every line takes its registry name (en + es) and its Wednesday par", async () => {
    const { client, calls } = fakeSupabase(postgrest(prepTables()));
    const state = await loadMidDayPrepState(client as never, { instanceId: MID_INST });
    expect(state?.instance.id).toBe(MID_INST);
    expect(shown(state!.templateItems as ShownLine[])).toEqual(EXPECTED_LINES);
    expectBoundedItemReads(calls);
  });

  it("AM prep submit (lib/prep.ts submitAmPrep): every entry's frozen snapshot carries the registry name and the Wednesday par", async () => {
    const { client, calls, rpcs } = fakeSupabase(postgrest(prepTables()), (r) => {
      if (r.name !== "submit_am_prep_atomic") throw new Error(`fake: unexpected rpc ${r.name}`);
      return { data: { instance: instanceRow(AM_INST, AM_TPL, "confirmed"), completionIds: every((i) => `c-${i}`), autoCompleteId: null,
        submissionId: "s-1", editCount: 0, originalSubmissionId: null } };
    });
    const res = await submitAmPrep(client as never, {
      instanceId: AM_INST, actor: { userId: "u-1", role: "employee", level: 3 },
      entries: every((i) => ({ templateItemId: lineId(i), inputs: { total: i } })),
      closingReportRefItemId: null, activeAssignmentId: null,
    });
    expect(res.submittedCompletionIds).toHaveLength(N);
    expect(res.skipped).toEqual([]);
    expect(rpcs.map((r) => r.name)).toEqual(["submit_am_prep_atomic"]);
    expect(rpcs[0]!.args.p_entries).toEqual(every((i) => ({ templateItemId: lineId(i), inputs: { total: i },
      snapshot: { section: "sauces", itemName: EXPECTED_NAME(i), parValue: EXPECTED_PAR(i), parUnit: "qt", specialInstruction: null } })));
    expectBoundedItemReads(calls);
  });
});

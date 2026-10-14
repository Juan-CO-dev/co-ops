import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeReportSignals, countHotTempReadings, listReports, loadLocationTempItemIds, type ReportTypeKey } from "@/lib/reports-hub";
import { composeReportSummary } from "@/lib/report-summary";
import { loadTrendSeries } from "@/lib/reports-trends";
import { loadFridgesToday } from "@/lib/pulse/fridges";
import { listMaintenanceReportDates } from "@/lib/maintenance";
import { buildTempItemRegistry, type FridgeRegistryRow } from "@/lib/fridge-registry";

// B8 #4 — the hub's temperature-flag count. r2 (Astra P1): today's unfinished opening is not listed,
// but its hot reading is real. r3 (Astra P2): report flags read retired fridges too. r4 (Astra round
// 3): two fridge registries disagreed on a shared item (row-order dependent), and the summary
// depended on whether a maintenance day row existed. Now ONE registry (lib/fridge-registry) feeds
// every surface, and the summary counts the window's readings directly.


type Row = Record<string, unknown>;
function fake(tables: Record<string, Row[]>) {
  return { from(table: string) {
    let rows = [...(tables[table] ?? [])]; let columns = ""; let start = 0; let end = Infinity;
    const q = {
      select(c: string) { columns = c; return q; },
      eq(k: string, v: unknown) { rows = rows.filter((r) => r[k] === v); return q; },
      match(m: Row) { for (const [k, v] of Object.entries(m)) q.eq(k, v); return q; },
      in(k: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[k])); return q; },
      is(k: string, v: unknown) { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
      gte(k: string, v: string) { rows = rows.filter((r) => String(r[k]) >= v); return q; },
      lte(k: string, v: string) { rows = rows.filter((r) => String(r[k]) <= v); return q; },
      lt(k: string, v: string) { rows = rows.filter((r) => String(r[k]) < v); return q; },
      not(k: string, _op: string, v: unknown) { rows = rows.filter((r) => (r[k] ?? null) !== v); return q; },
      or(filter: string) {
        const m = /^status\.in\.\(([^)]+)\),report_date\.lt\.(.+)$/.exec(filter);
        if (!m) throw new Error(`Unsupported OR: ${filter}`);
        rows = rows.filter((r) => m[1]!.split(",").includes(String(r.status)) || String(r.report_date) < m[2]!);
        return q;
      },
      order() { return q; }, limit(n: number) { end = n - 1; return q; }, returns() { return q; },
      range(a: number, b: number) { start = a; end = b; return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(resolve: (v: unknown) => unknown) {
        const data = rows.slice(start, end === Infinity ? undefined : end + 1)
          .map((r) => Object.fromEntries(columns.split(",").map((k) => [k.trim(), r[k.trim()]])));
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return q;
  } } as unknown as SupabaseClient;
}


const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const viewer = { userId: "gm", level: 7, locations: ["shop"] };
type Item = "am-temp" | "pm-temp" | "old-am-temp";
const inst = (id: string, date: string, template: "t-open" | "t-close", status: string) =>
  ({ id, location_id: "shop", date, template_id: template, status, confirmed_by: "gm", confirmed_at: status === "open" ? null : `${date}T21:00:00Z` });
const reading = (id: string, instanceId: string, item: Item, value: number) =>
  ({ id, instance_id: instanceId, template_item_id: item, completed_by: "kh", count_value: value, notes: null, prep_data: null, completed_at: `${TODAY}T13:00:00Z` });
const walkin = (over: Row = {}): Row => ({ id: "walkin", kind: "fridge", name: "Walk-in", active: true, location_id: "shop", opening_temp_item_id: "am-temp", closing_temp_item_id: "pm-temp", safe_max_f: 41, sort_order: 1, created_at: "2026-01-01T00:00:00Z", ...over });
const oldReachIn = (over: Row = {}): Row => ({ id: "old-reach-in", kind: "fridge", name: "Old reach-in", active: false, location_id: "shop", opening_temp_item_id: "old-am-temp", closing_temp_item_id: null, safe_max_f: 41, sort_order: 2, created_at: "2025-01-01T00:00:00Z", ...over });
function tables(instances: Row[], completions: Row[], equipment: Row[]): Record<string, Row[]> {
  return {
    checklist_instances: instances,
    checklist_templates: [{ id: "t-open", type: "opening", prep_subtype: null }, { id: "t-close", type: "closing", prep_subtype: null }],
    checklist_template_items: [
      { id: "am-temp", template_id: "t-open", label: "Walk-in AM", station: "Kitchen", required: true, active: true },
      { id: "pm-temp", template_id: "t-close", label: "Walk-in PM", station: "Kitchen", required: true, active: true },
      { id: "old-am-temp", template_id: "t-open", label: "Old reach-in AM", station: "Kitchen", required: false, active: true },
    ],
    checklist_completions: completions,
    maintenance_equipment: equipment,
    users: [{ id: "gm", name: "GM" }, { id: "kh", name: "KH" }],
  };
}

/**
 * Every surface on one fixture, all through the one registry. `hub` = the summary chip; `reports` =
 * each report's own temp flags (its detail signals, listed or not); `trends` = the day buckets (its
 * existing window: past days and finalized reports); `pulse` = hot readings on the fridges Pulse
 * shows (active only); `maintenanceFlags` / `maintenanceRows` = the day rows' out-of-range ACTIVE
 * fridge count and the dates that have a row (both unchanged by r4).
 */
async function surfaces(instances: Row[], completions: Row[], equipment: Row[] = [walkin()]) {
  const client = fake(tables(instances, completions, equipment));
  const scope = { viewer, locationId: "shop", dateFrom: YESTERDAY, dateTo: TODAY };
  const hub = composeReportSummary(await listReports(client, scope), await countHotTempReadings(client, scope)).signals.tempFlags;
  const registry = await loadLocationTempItemIds(client, "shop");
  let reports = 0;
  for (const i of instances) {
    const type: ReportTypeKey = i.template_id === "t-open" ? "opening" : "closing";
    reports += (await computeReportSignals(client, { type, id: String(i.id), tempItemIds: registry, viewer })).signals.tempFlags;
  }
  const trend = await loadTrendSeries(client, { viewer, locationId: "shop", granularity: "day", compare: false, today: TODAY });
  const trends = trend.current.reduce((n, b) => n + b.tempFlags, 0);
  const maxOf = new Map([...buildTempItemRegistry(equipment as unknown as FridgeRegistryRow[]).values()].map((o) => [o.fridgeId, o.safeMaxF] as const));
  let pulse = 0;
  for (const date of [YESTERDAY, TODAY]) {
    for (const f of await loadFridgesToday(client, { locationId: "shop", date })) pulse += f.readings.filter((v) => v > maxOf.get(f.id)!).length;
  }
  const days = await listMaintenanceReportDates(client, "shop", YESTERDAY, TODAY);
  return { hub, reports, trends, pulse, maintenanceFlags: days.reduce((n, d) => n + d.tempFlags, 0), maintenanceRows: days.map((d) => d.date) };
}

afterEach(() => { vi.useRealTimers(); });
const atToday = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T16:00:00Z`)); };

describe("B8 #4 every surface agrees on each temperature fixture", () => {
  it("an UNFINISHED opening today with a hot reading: hub 1 although its report is not listed yet", async () => {
    atToday();
    expect(await surfaces([inst("o-today", TODAY, "t-open", "open")], [reading("r1", "o-today", "am-temp", 45)]))
      .toEqual({ hub: 1, reports: 1, trends: 0, pulse: 1, maintenanceFlags: 1, maintenanceRows: [TODAY] });
  });
  it("a finalized report plus its maintenance day row counts once, not twice", async () => {
    atToday();
    expect(await surfaces([inst("o-y", YESTERDAY, "t-open", "confirmed")], [reading("r1", "o-y", "am-temp", 45)]))
      .toEqual({ hub: 1, reports: 1, trends: 1, pulse: 1, maintenanceFlags: 1, maintenanceRows: [YESTERDAY] });
  });
  it("a mixed day (finalized opening, unfinished closing) counts both hot readings once each", async () => {
    atToday();
    expect(await surfaces(
      [inst("o-today", TODAY, "t-open", "confirmed"), inst("c-today", TODAY, "t-close", "open"), inst("o-y", YESTERDAY, "t-open", "confirmed")],
      [reading("r1", "o-today", "am-temp", 45), reading("r2", "c-today", "pm-temp", 44), reading("r3", "o-y", "am-temp", 38)],
    )).toEqual({ hub: 2, reports: 2, trends: 1, pulse: 2, maintenanceFlags: 1, maintenanceRows: [TODAY, YESTERDAY] });
  });
  it("in-range readings never count", async () => {
    atToday();
    expect(await surfaces([inst("o-today", TODAY, "t-open", "open")], [reading("r1", "o-today", "am-temp", 37)]))
      .toEqual({ hub: 0, reports: 0, trends: 0, pulse: 0, maintenanceFlags: 0, maintenanceRows: [TODAY] });
  });
  it("an unset max is 41°F, and a reading equal to the max is not a flag", async () => {
    atToday();
    const day = [inst("o-y", YESTERDAY, "t-open", "confirmed"), inst("c-y", YESTERDAY, "t-close", "confirmed")];
    expect(await surfaces(day, [reading("r1", "o-y", "am-temp", 41), reading("r2", "c-y", "pm-temp", 42)], [walkin({ safe_max_f: null })]))
      .toEqual({ hub: 1, reports: 1, trends: 1, pulse: 1, maintenanceFlags: 1, maintenanceRows: [YESTERDAY] });
    expect(await surfaces(day, [reading("r1", "o-y", "am-temp", 45), reading("r2", "c-y", "pm-temp", 45)], [walkin({ safe_max_f: 45 })]))
      .toEqual({ hub: 0, reports: 0, trends: 0, pulse: 0, maintenanceFlags: 0, maintenanceRows: [YESTERDAY] });
  });
});

describe("B8 #4 retired fridges: counted from the readings, never from day rows", () => {
  const twoFridges = (retiredValue: number) => surfaces([inst("o-y", YESTERDAY, "t-open", "confirmed")],
    [reading("r1", "o-y", "am-temp", 43), reading("r2", "o-y", "old-am-temp", retiredValue)],
    [walkin({ safe_max_f: 45 }), oldReachIn()]);
  it("r3 repro: retired fridge 43°F over its 41°F max + active fridge 43°F under its 45°F max -> 1", async () => {
    atToday();
    expect(await twoFridges(43)).toEqual({ hub: 1, reports: 1, trends: 1, pulse: 0, maintenanceFlags: 0, maintenanceRows: [YESTERDAY] });
  });
  it("the retired fridge in range (40°F, max 41°F) -> 0", async () => {
    atToday();
    expect(await twoFridges(40)).toEqual({ hub: 0, reports: 0, trends: 0, pulse: 0, maintenanceFlags: 0, maintenanceRows: [YESTERDAY] });
  });
  it("P2-2: today's unfinished opening 43°F / max 41°F, its fridge retired since, no notes -> no day row, hub still 1", async () => {
    atToday();
    expect(await surfaces([inst("o-today", TODAY, "t-open", "open")], [reading("r1", "o-today", "old-am-temp", 43)], [walkin(), oldReachIn()]))
      .toEqual({ hub: 1, reports: 1, trends: 0, pulse: 0, maintenanceFlags: 0, maintenanceRows: [] });
  });
});

describe("B8 #4 r4 P2-1: one owner per shared item, whatever the row order", () => {
  // An active fridge (max 45) and a retired one (max 41) both carry am-temp; the reading is 43°F.
  const shared = [walkin({ safe_max_f: 45 }), oldReachIn({ opening_temp_item_id: "am-temp" })];
  for (const [label, equipment] of [["retired row last", shared], ["retired row first", [...shared].reverse()]] as const) {
    it(`the ACTIVE fridge owns it (${label}): 43°F under its 45°F max is 0 on every surface`, async () => {
      atToday();
      expect(await surfaces([inst("o-y", YESTERDAY, "t-open", "confirmed")], [reading("r1", "o-y", "am-temp", 43)], [...equipment]))
        .toEqual({ hub: 0, reports: 0, trends: 0, pulse: 0, maintenanceFlags: 0, maintenanceRows: [YESTERDAY] });
    });
  }
  it("same status: the most recently created fridge wins, then the lowest id; row order never decides", () => {
    const newer = { id: "b-fridge", opening_temp_item_id: "x", closing_temp_item_id: null, safe_max_f: 45, active: true, created_at: "2026-05-01T00:00:00Z" };
    const older = { id: "a-fridge", opening_temp_item_id: "x", closing_temp_item_id: null, safe_max_f: 38, active: true, created_at: "2026-01-01T00:00:00Z" };
    expect(buildTempItemRegistry([newer, older]).get("x")).toMatchObject({ fridgeId: "b-fridge", safeMaxF: 45 });
    expect(buildTempItemRegistry([older, newer]).get("x")).toMatchObject({ fridgeId: "b-fridge", safeMaxF: 45 });
    const twin = { ...older, created_at: newer.created_at };
    expect(buildTempItemRegistry([newer, twin]).get("x")?.fridgeId).toBe("a-fridge");
    expect(buildTempItemRegistry([twin, newer]).get("x")?.fridgeId).toBe("a-fridge");
  });
});

/**
 * W15 fix round 1 (review r1 P2 2, B022) — the fridge registry claims every fridge line on every
 * version, so it grows with every publish. Its consumers sent the WHOLE registry in one
 * `.in("template_item_id", …)`: after a few hundred publishes that request line passes the proxy's
 * ceiling (414) and today's readings fail to load. Here a shop has 600 published versions (600
 * registry ids), and every consumer runs over the PostgREST-capped fake with a request-line check on
 * every `.in()` list. The readings must still come back right.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { inListFitsRequestLine } from "@/lib/supabase-paginate";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { loadFridgesToday } from "@/lib/pulse/fridges";
import { loadEquipmentDetail, loadMaintenanceOverview, listMaintenanceReportDates, loadMaintenanceReportDetail } from "@/lib/maintenance";
import { countHotTempReadings } from "@/lib/reports-hub";

const LOC = "11111111-1111-4111-8111-111111111111";
const FRIDGE = "f0000000-0000-4000-8000-000000000001";
const VERSIONS = 600;
const uuid = (prefix: string, n: number) => `${prefix}${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;
const TODAY = "2026-11-15";
const OLD_DAY = "2026-01-02";

let tables: Tables;
let oversize: Array<{ table: string; column: string; n: number }>;

/** The fake DB with `.match()` and a request-line check on every `.in()`. */
function client() {
  const db = createFakeDb(tables);
  const from = (table: string) => {
    const q = (db.client as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(table);
    const origIn = q.in!.bind(q);
    q.in = (column: unknown, values: unknown) => {
      const n = (values as unknown[]).length;
      if (!inListFitsRequestLine(column as string, n)) oversize.push({ table, column: column as string, n });
      return origIn(column, values);
    };
    q.match = (obj: unknown) => { for (const [k, v] of Object.entries(obj as Record<string, unknown>)) q.eq!(k, v); return q; };
    return q;
  };
  return { from } as never;
}

beforeEach(() => {
  oversize = [];
  const templates = Array.from({ length: VERSIONS }, (_, i) => ({ id: uuid("a", i + 1), location_id: LOC, type: "closing", active: i === VERSIONS - 1 }));
  const lines = templates.map((t, i) => ({ id: uuid("b", i + 1), template_id: t.id, equipment_id: FRIDGE, expects_count: true }));
  const latest = lines[VERSIONS - 1]!.id, first = lines[0]!.id;
  tables = {
    maintenance_equipment: [{ id: FRIDGE, location_id: LOC, kind: "fridge", name: "Line fridge", opening_temp_item_id: null,
      closing_temp_item_id: latest, safe_max_f: 41, active: true, sort_order: 1, created_at: "2026-01-01T00:00:00Z" }],
    checklist_templates: templates,
    checklist_template_items: lines,
    checklist_instances: [
      { id: "i-today", location_id: LOC, date: TODAY, template_id: templates[VERSIONS - 1]!.id },
      { id: "i-old", location_id: LOC, date: OLD_DAY, template_id: templates[0]!.id },
    ],
    checklist_completions: [
      { id: "c1", instance_id: "i-today", template_item_id: latest, count_value: 45, completed_at: `${TODAY}T23:00:00Z`, notes: "door left open",
        completed_by: "u1", superseded_at: null, revoked_at: null },
      { id: "c2", instance_id: "i-old", template_item_id: first, count_value: 38, completed_at: `${OLD_DAY}T23:00:00Z`, notes: null,
        completed_by: "u1", superseded_at: null, revoked_at: null },
    ],
    maintenance_notes: [],
    users: [],
  };
});

describe("W15/B022 round 1 — 600 published versions never put the whole registry in one request line", () => {
  it("the pulse reads today's reading on the newest copy", async () => {
    const out = await loadFridgesToday(client(), { locationId: LOC, date: TODAY });
    expect(out).toEqual([expect.objectContaining({ id: FRIDGE, status: "out_of_range", latestF: 45, readings: [45] })]);
    expect(oversize).toEqual([]);
  });

  it("the maintenance overview and the fridge page read every version's readings and notes", async () => {
    const overview = await loadMaintenanceOverview(client(), { locationId: LOC, today: TODAY, sinceDate: OLD_DAY });
    expect(overview.fridges[0]).toMatchObject({ status: "out_of_range", spark: [38, 45] });
    const detail = await loadEquipmentDetail(client(), { equipmentId: FRIDGE, today: TODAY, sinceDate: OLD_DAY });
    expect(detail?.readings.map((r) => r.valueF)).toEqual([38, 45]);
    expect(detail?.notes.map((n) => n.note)).toContain("door left open");
    expect(oversize).toEqual([]);
  });

  it("the maintenance report list, its day page and the hub's hot-reading count", async () => {
    const days = await listMaintenanceReportDates(client(), LOC, OLD_DAY, TODAY);
    expect(days).toEqual(expect.arrayContaining([{ date: TODAY, tempFlags: 1 }, expect.objectContaining({ date: OLD_DAY, tempFlags: 0 })]));
    const day = await loadMaintenanceReportDetail(client(), LOC, TODAY);
    expect(day.flagCount).toBe(1);
    const viewer = { userId: "u-moo", level: 8, role: "moo", locations: [LOC] } as never;
    expect(await countHotTempReadings(client(), { viewer, locationId: LOC, dateFrom: OLD_DAY, dateTo: TODAY })).toBe(1);
    expect(oversize).toEqual([]);
  });
});

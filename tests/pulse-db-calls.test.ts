/**
 * Astra #2 — DB calls per poll, BEFORE and AFTER, through the REAL readers (defaultPulseDeps) against a
 * recording fake client. A "poll" is what the client does every 60 s: one /api/pulse/section request
 * per visible section, each building its own deps (no per-request memo across requests).
 *   before = defaultPulseDeps per request (the reviewed c5f3f6c behaviour);
 *   after  = pulseDeps (cachedPulseDeps over defaultPulseDeps): the first poll of a shop loads every
 *            source once; a second viewer's poll (or the same viewer's next poll inside the TTL) is 0.
 * The numbers are printed so the hand-back note carries them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const fake = vi.hoisted(() => ({ calls: [] as string[], date: "2026-10-09", rows: {} as Record<string, unknown[]> }));
function builder(data: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "neq", "in", "is", "not", "or", "gte", "gt", "lte", "lt", "order", "limit", "range", "match", "returns", "abortSignal"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  q.single = async () => ({ data: null, error: { message: "no row" } });
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data, error: null, count: 0 }).then(res, rej);
  return q;
}
const client = {
  from: (table: string) => { fake.calls.push(`from:${table}`); return builder(fake.rows[table] ?? []); },
  rpc: (name: string) => {
    fake.calls.push(`rpc:${name}`);
    return builder(name === "station_business_date" ? fake.date : name === "pulse_sales_today" ?
      { classes: [], discounts: [], refunds: [], captured_days: [], captured_at: null } :
      name === "pulse_sales_baseline" ? { hours: [], captured_days: [] } : []);
  },
};
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { defaultPulseDeps, loadPulseSection, pulseDeps, type PulseCtx } from "@/lib/pulse/sections";
import { resetSourceCache } from "@/lib/pulse/source-cache";
import { visibleSections } from "@/lib/pulse/scope-shared";

const LOC = "11111111-1111-4111-8111-111111111111";
const ctx = (level: number, id: string): PulseCtx => ({
  auth: { user: { id, role: level >= 7 ? "gm" : "key_holder", language: "en" } as AuthContext["user"], session: {} as AuthContext["session"], role: level >= 7 ? "gm" : "key_holder", level, locations: [LOC] },
  locationId: LOC, date: fake.date, now: new Date(`${fake.date}T19:30:00Z`),
});

/** One client poll cycle: a separate request per section (as /api/pulse/section is called). */
async function poll(level: number, viewer: string, depsFactory: () => ReturnType<typeof defaultPulseDeps>) {
  const start = fake.calls.length;
  for (const section of visibleSections(level)) {
    const r = await loadPulseSection(depsFactory(), ctx(level, viewer), section);
    expect(r.state, `${section} should not be forbidden`).not.toMatchObject({ code: "forbidden" });
  }
  const mine = fake.calls.slice(start);
  const byTable: Record<string, number> = {};
  for (const c of mine) byTable[c] = (byTable[c] ?? 0) + 1;
  return { total: mine.length, byTable };
}

beforeEach(() => { fake.calls.length = 0; fake.rows = {}; resetSourceCache(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); resetSourceCache(); });

describe("DB calls per poll (GM, all nine sections)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${fake.date}T19:30:00Z`)); });
  afterEach(() => vi.useRealTimers());
  it("BEFORE: every section request reloads its sources; AFTER: one shared load per shop per poll, only the one-row sales freshness probe on the next viewer's poll", async () => {
    const before = await poll(7, "gm-a", () => defaultPulseDeps(client as never));
    fake.calls.length = 0;
    const afterFirst = await poll(7, "gm-a", () => pulseDeps(client as never));
    const afterSecondViewer = await poll(7, "gm-b", () => pulseDeps(client as never));
    const afterSamePoll = await poll(7, "gm-a", () => pulseDeps(client as never));
    console.log(`[pulse db calls/poll] BEFORE total=${before.total} board(rpc:station_business_date)=${before.byTable["rpc:station_business_date"] ?? 0} ` +
      `AFTER first=${afterFirst.total} second-viewer=${afterSecondViewer.total} same-viewer-repoll=${afterSamePoll.total}`);
    console.log("[pulse db calls/poll] BEFORE by call:", JSON.stringify(before.byTable));
    console.log("[pulse db calls/poll] AFTER by call:", JSON.stringify(afterFirst.byTable));
    // Before: the board loader ran once per board-consuming section (attention, floor, people, stations).
    expect(before.byTable["rpc:station_business_date"]).toBe(4);
    // After: once per shop per poll, however many sections or viewers.
    expect(afterFirst.byTable["rpc:station_business_date"]).toBe(1);
    expect(afterFirst.total).toBeLessThan(before.total);
    // The ONE read a warm poll still makes: the sales freshness probe (toast_capture_runs, one indexed row),
    // so every instance keys today's sales by the latest COMPLETED capture (2026-10-10, "went backwards").
    expect(afterSecondViewer.byTable).toEqual({ "from:toast_capture_runs": 1 });
    expect(afterSamePoll.byTable).toEqual({ "from:toast_capture_runs": 1 });
  });
  it("a crew poll never reaches sources outside its scope, before or after", async () => {
    const before = await poll(3, "crew", () => defaultPulseDeps(client as never));
    // (vendor_deliveries is read by the report-status loaders for everyone; the inventory lane is par_pass_events + vendor_cutoffs.)
    for (const t of ["from:par_pass_events", "from:vendor_cutoffs", "rpc:pulse_sales_today", "rpc:pulse_sales_baseline", "rpc:sales_report_daily", "rpc:sales_report_breakdown", "from:ezcater_reconciliation_status", "from:toast_time_entries", "from:pulse_station_layouts_never"]) {
      expect(before.byTable[t], t).toBeUndefined();
    }
  });
});

describe("level-8 cross-shop Pulse sources", () => {
  const other = "22222222-2222-4222-8222-222222222222";
  const crossShop = (level = 8): PulseCtx => {
    const c = ctx(level, "director");
    c.auth.role = c.auth.user.role = level === 8 ? "moo" : "gm";
    c.locationId = other;
    return c;
  };
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${fake.date}T19:30:00Z`)); });
  afterEach(() => vi.useRealTimers());

  it.each(["board", "deliveries", "cutoffs"] as const)("loads %s through the REAL reader on a cold cache", async (source) => {
    const c = crossShop();
    const result = await pulseDeps(client as never)[source](c);
    expect(result).toBeDefined();
    const query = { board: "rpc:station_business_date", deliveries: "from:vendor_deliveries", cutoffs: "from:vendor_cutoffs" }[source];
    expect(fake.calls).toContain(query);
    expect(c.auth.locations).toEqual([LOC]);
  });

  it.each(["floor", "people", "stations", "inventory"] as const)("serves the %s section without a member warming it", async (section) => {
    expect(await loadPulseSection(pulseDeps(client as never), crossShop(), section)).toMatchObject({ state: "ok" });
  });

  it("returns populated cross-shop Inventory sources, not swallowed failures", async () => {
    fake.rows.vendor_deliveries = [{ id: "delivery", vendor_id: "vendor", delivery_date: fake.date,
      received_by: null, purchase_order_id: null, delivery_status: "complete", match_state: "counted_only" }];
    fake.rows.vendor_delivery_items = [{ id: "line", delivery_id: "delivery" }];
    fake.rows.vendor_cutoffs = [{ vendor_id: "vendor", location_id: other, cutoff_time: "16:00:00" }];
    fake.rows.vendors = [{ id: "vendor", name: "Test vendor" }];
    const deps = pulseDeps(client as never);
    const c = crossShop();
    expect(await deps.deliveries(c)).toMatchObject([{ id: "delivery", vendorName: "Test vendor", lineCount: 1 }]);
    expect(await deps.cutoffs(c)).toMatchObject({ count: 1, vendors: [{ vendorId: "vendor", vendorName: "Test vendor", hasDraft: false }] });
    const result = await loadPulseSection(deps, c, "inventory");
    expect(result).toMatchObject({ state: "ok", data: {
      receiving: [{ id: "delivery", vendorName: "Test vendor" }], cutoffs: [{ vendorName: "Test vendor", hasDraft: false }],
    } });
  });

  it.each([false, true])("refuses a level-7 non-member before I/O, warm=%s", async (warm) => {
    const deps = pulseDeps(client as never);
    if (warm) {
      for (const source of ["board", "deliveries", "cutoffs"] as const) await deps[source](crossShop());
    }
    fake.calls.length = 0;
    for (const source of ["board", "deliveries", "cutoffs"] as const) {
      await expect(deps[source](crossShop(7))).rejects.toThrow("location_access_denied");
    }
    expect(await loadPulseSection(deps, crossShop(7), "inventory")).toMatchObject({ state: "error", code: "forbidden" });
    expect(fake.calls).toEqual([]);
  });

  it("keeps shop keys separate and patches board viewer identity on a warm cache", async () => {
    const deps = pulseDeps(client as never);
    const c = crossShop();
    for (const source of ["board", "deliveries", "cutoffs"] as const) {
      fake.calls.length = 0;
      await deps[source](c);
      await deps[source]({ ...c, locationId: LOC });
      const query = { board: "rpc:station_business_date", deliveries: "from:vendor_deliveries", cutoffs: "from:vendor_cutoffs" }[source];
      expect(fake.calls.filter((x) => x === query)).toHaveLength(2);
    }
    fake.calls.length = 0;
    const board = await deps.board({ ...c, auth: { ...c.auth, user: { ...c.auth.user, id: "second-director" } } });
    expect(board.viewerId).toBe("second-director");
    expect(board.viewerLevel).toBe(8);
    expect(fake.calls).toEqual([]);
  });
});

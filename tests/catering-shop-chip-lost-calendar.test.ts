/**
 * Wave 1 branch C: shop chip on pipeline cards + lost orders on the insights calendar.
 * Lost is DISPLAY ONLY: totals must not move.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { shopChipLabel } from "@/lib/catering/pipeline-shared";
import { mapLead, withLocationNames, type DbLeadRow } from "@/lib/catering/pipeline";
import {
  SHOW_LOST_STORAGE_KEY,
  calendarEventsToPlot,
  lostUndatedNoteCount,
  readShowLost,
  writeShowLost,
  type LostCalendarEvent,
} from "@/lib/catering/lost-calendar-shared";
import { groupEventsByDate, stageDot, type CalendarEvent } from "@/lib/catering/insights-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// A tiny chainable Supabase fake -----------------------------------------------------
const state: {
  lost: Array<Record<string, unknown>>;
  /** location_id of each lost lead with NO event date. */
  undatedRows: string[];
  locations: Array<{ id: string; name: string }>;
  scopes: unknown[];
  failLost: boolean;
} = { lost: [], undatedRows: [], locations: [], scopes: [], failLost: false };

const RPC_WINDOW = {
  leads_new: 4, by_source: { toast: 4 }, by_stage: { confirmed: 2 }, booked_events: 2, booked_value_cents: "123400",
  confirmed_events: 1, confirmed_value_cents: "100000", completed_events: 1, completed_value_cents: "23400",
  lost: 3, win_rate_bps: 5000, avg_headcount: 20, pipeline_open_value_cents: "5000",
};
const RPC = {
  this_week: RPC_WINDOW, this_month: RPC_WINDOW, last_30: RPC_WINDOW, all_time: RPC_WINDOW,
  calendar: [{ id: "b1", event_date: "2026-10-08", time_window: null, name: "Booked", headcount: 10, source: "toast", stage: "confirmed", location_id: "L1", value_cents: 100000 }],
  feedback: { average_rating: 4.5, count: 2 },
};

/**
 * The fake APPLIES the predicates it is given (stage is implied lost for the pipeline rows in
 * state): `.in("location_id", ids)`, the event_date window and `.range()`. So a test that
 * puts a cross-shop row in the fixture proves isolation instead of assuming it.
 */
function query(table: string, head: boolean) {
  const q: Record<string, unknown> = {};
  let undated = false;
  let scope: string[] | null = null;
  let gte: string | null = null;
  let lte: string | null = null;
  let range: [number, number] | null = null;
  const chain = () => q;
  for (const m of ["select", "eq", "not", "order", "returns", "limit"]) q[m] = chain;
  q.is = () => { undated = true; return q; };
  q.in = (_c: string, ids: unknown) => { state.scopes.push(ids); scope = ids as string[]; return q; };
  q.gte = (_c: string, v: string) => { gte = v; return q; };
  q.lte = (_c: string, v: string) => { lte = v; return q; };
  q.range = (f: number, t: number) => { range = [f, t]; return q; };
  q.then = (res: (v: unknown) => unknown) => {
    if (table === "catering_pipeline" && state.failLost) {
      return Promise.resolve(res({ data: null, count: null, error: { message: "boom" } }));
    }
    if (table === "catering_pipeline") {
      const inScope = (loc: unknown) => scope === null || scope.includes(loc as string);
      if (head || undated) {
        return Promise.resolve(res({ count: state.undatedRows.filter(inScope).length, data: null, error: null }));
      }
      let rows = state.lost.filter(
        (r) => inScope(r.location_id) && (gte === null || String(r.event_date) >= gte) && (lte === null || String(r.event_date) <= lte),
      );
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return Promise.resolve(res({ data: rows, error: null }));
    }
    if (table === "locations") return Promise.resolve(res({ data: state.locations, error: null }));
    return Promise.resolve(res({ data: [], error: null })); // customer_feedback
  };
  return q;
}
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    rpc: async () => ({ data: RPC, error: null }),
    from: (table: string) => ({
      select: (_c: string, opts?: { head?: boolean }) => query(table, !!opts?.head),
    }),
  }),
}));

import { loadCateringInsightsV2 } from "@/lib/catering/insights";
import { getServiceRoleClient } from "@/lib/supabase-server";

const actor = (role: string, locations: string[]) =>
  ({ user: { role }, locations }) as unknown as Parameters<typeof loadCateringInsightsV2>[0];

beforeEach(() => {
  state.lost = []; state.undatedRows = []; state.locations = []; state.scopes = []; state.failLost = false;
});

const baseRow = (over: Partial<DbLeadRow> = {}): DbLeadRow => ({
  id: "x", customer_id: null, contact_name: "C", company: null, event_date: null, headcount: null,
  contact_phone: null, delivery_address: null, time_window: null, event_type: null, dietary_notes: null,
  event_name: null, dropoff_door: null, stage: "inquiry", lead_source: null, location_id: "loc-1",
  notes: null, follow_up_date: null, estimated_revenue_cents: null, assigned_to: null, created_by: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: null, ...over,
});

describe("pipeline shop chip", () => {
  it("label is the location NAME from the locations table, not the code (prod codes are crossed)", async () => {
    // Prod truth: code EM is P Street, MEP is Capitol Hill. The name read must win.
    state.locations = [{ id: "loc-em", name: "P Street" }, { id: "loc-mep", name: "Capitol Hill" }];
    const leads = [mapLead(baseRow({ id: "a", location_id: "loc-em" })), mapLead(baseRow({ id: "b", location_id: "loc-mep" }))];
    const out = await withLocationNames(getServiceRoleClient(), leads);
    expect(out.map((l) => shopChipLabel(l))).toEqual(["P Street", "Capitol Hill"]);
  });
  it("a tenant-wide lead has no label (fallback shown), and the helper only takes a name", () => {
    expect(shopChipLabel({ locationName: null })).toBeNull();
    expect(shopChipLabel({ locationName: "  " })).toBeNull();
    expect(shopChipLabel({ locationName: " Capitol Hill " })).toBe("Capitol Hill");
    expect(shopChipLabel({ locationName: null, ...({ locationCode: "EM" } as object) })).toBeNull();
  });
  it("the chip is wired on the lead card and the search card, with no code lookup in the client", () => {
    const src = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
    expect(src.match(/<ShopChip /g)?.length).toBe(2);
    expect(src).not.toMatch(/locationCode|location_code|"EM"|"MEP"/);
  });
});

describe("show-lost toggle storage", () => {
  const throwing = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  it("defaults ON when nothing is stored, when storage is missing, and when storage throws", () => {
    expect(readShowLost({ getItem: () => null })).toBe(true);
    expect(readShowLost(null)).toBe(true);
    expect(readShowLost(throwing)).toBe(true);
  });
  it("write never throws with blocked or missing storage", () => {
    expect(() => writeShowLost(false, throwing)).not.toThrow();
    expect(() => writeShowLost(false, null)).not.toThrow();
  });
  it("remembers OFF and ON across reads", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    writeShowLost(false, st);
    expect(m.get(SHOW_LOST_STORAGE_KEY)).toBe("0");
    expect(readShowLost(st)).toBe(false);
    writeShowLost(true, st);
    expect(readShowLost(st)).toBe(true);
  });
});

describe("lost on the calendar", () => {
  it("the undated note follows the toggle: shown only when Show lost is ON and there are undated rows", () => {
    expect(lostUndatedNoteCount(true, 3)).toBe(3);
    expect(lostUndatedNoteCount(false, 3)).toBe(0);
    expect(lostUndatedNoteCount(true, 0)).toBe(0);
  });
  const booked: CalendarEvent = { id: "b", eventDate: "2026-10-08", timeWindow: null, name: "B", headcount: 1, source: null, stage: "confirmed", locationId: "L", valueCents: 100 };
  const lost: LostCalendarEvent = { id: "l", eventDate: "2026-10-08", timeWindow: null, name: "L", headcount: 1, source: null, stage: "lost", locationId: "L", valueCents: 50 };
  it("plots lost on its event date when shown, hides it when off", () => {
    const on = groupEventsByDate(calendarEventsToPlot([booked], [lost], true));
    expect(on.get("2026-10-08")!.map((e) => e.stage)).toEqual(["confirmed", "lost"]);
    const off = groupEventsByDate(calendarEventsToPlot([booked], [lost], false));
    expect(off.get("2026-10-08")!.map((e) => e.stage)).toEqual(["confirmed"]);
  });
  it("lost gets a muted dot, distinct from the booked stages", () => {
    expect(stageDot("lost")).toContain("opacity-50");
    expect(stageDot("lost")).not.toBe(stageDot("confirmed"));
  });
  it("greyed + struck-through rendering and the undated note are in the component", () => {
    const src = readFileSync("components/catering/InsightsCalendar.tsx", "utf8");
    expect(src).toContain("line-through");
    expect(src).toContain("lost-undated-note");
    expect(src).toContain("lostUndatedNoteCount(showLost, lostUndatedCount)");
    expect(src).toContain("catering.insights.calendar.lost_undated");
  });
  it("new strings exist in en and es", () => {
    for (const k of [
      "catering.insights.calendar.show_lost", "catering.insights.calendar.lost_undated",
      "catering.insights.calendar_lost_count", "catering.pipeline.shop_chip_aria", "catering.pipeline.shop_none",
    ]) {
      expect((en as Record<string, string>)[k], `en ${k}`).toBeTruthy();
      expect((es as Record<string, string>)[k], `es ${k}`).toBeTruthy();
    }
  });
});

describe("loader: lost is display only", () => {
  it("windows (every money total and count) and the booked calendar are identical with lost rows present", async () => {
    const without = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    state.lost = [
      { id: "l1", event_date: "2026-10-09", time_window: null, event_name: null, company: "Acme", contact_name: "Z", headcount: 50, lead_source: "toast", location_id: "L1", estimated_revenue_cents: "999900" },
      { id: "l2", event_date: "2026-10-12", time_window: null, event_name: "Big", company: null, contact_name: "Y", headcount: 99, lead_source: null, location_id: "L1", estimated_revenue_cents: null },
    ];
    state.undatedRows = ["L1", "L1", "L1", "L1", "L1"];
    const withLost = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    expect(withLost.windows).toEqual(without.windows);
    expect(withLost.calendar).toEqual(without.calendar);
    expect(withLost.lostCalendar.map((e) => e.name)).toEqual(["Acme", "Big"]);
    expect(withLost.lostCalendar.every((e) => e.stage === "lost")).toBe(true);
    expect(withLost.lostCalendar[0]!.valueCents).toBe(999900);
    expect(withLost.lostUndatedCount).toBe(5);
    expect(without.lostCalendar).toEqual([]);
  });
  it("lost reads fail soft: an erroring lost read leaves the v2 figures unchanged and the lost list empty", async () => {
    const ok = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    state.failLost = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    expect(failed.windows).toEqual(ok.windows);
    expect(failed.calendar).toEqual(ok.calendar);
    expect(failed.lostCalendar).toEqual([]);
    expect(failed.lostUndatedCount).toBe(0);
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith("[catering-insights]"))).toBe(true);
    spy.mockRestore();
  });
  const lostRow = (id: string, date: string, loc: string, name = id) => ({
    id, event_date: date, time_window: null, event_name: name, company: null, contact_name: null,
    headcount: 1, lead_source: null, location_id: loc, estimated_revenue_cents: 100,
  });
  it("GM isolation: a GM gets only their own shop's dated lost events AND undated count; the owner gets all", async () => {
    state.lost = [lostRow("mine", "2026-10-09", "L1"), lostRow("theirs", "2026-10-10", "L2"), lostRow("mine2", "2026-10-11", "L1")];
    state.undatedRows = ["L1", "L2", "L2", "L2"];
    const gm = await loadCateringInsightsV2(actor("gm", ["L1"]), "2026-10-06");
    expect(gm.lostCalendar.map((e) => e.id)).toEqual(["mine", "mine2"]);
    expect(gm.lostUndatedCount).toBe(1);
    const owner = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    expect(owner.lostCalendar.map((e) => e.id)).toEqual(["mine", "theirs", "mine2"]);
    expect(owner.lostUndatedCount).toBe(4);
  });
  it("the lost window is applied: rows outside -30/+90 days are not plotted", async () => {
    state.lost = [lostRow("in", "2026-10-09", "L1"), lostRow("old", "2026-08-01", "L1"), lostRow("far", "2027-03-01", "L1")];
    const out = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    expect(out.lostCalendar.map((e) => e.id)).toEqual(["in"]);
  });
  it("the lost read is paged: more than 1000 rows come back whole, none silently truncated", async () => {
    state.lost = Array.from({ length: 1200 }, (_, i) => lostRow(`r${i}`, "2026-10-09", "L1"));
    const out = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    expect(out.lostCalendar).toHaveLength(1200);
  });
});

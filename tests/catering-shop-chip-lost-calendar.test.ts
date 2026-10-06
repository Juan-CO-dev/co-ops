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
  undated: number;
  locations: Array<{ id: string; name: string }>;
  scopes: unknown[];
} = { lost: [], undated: 0, locations: [], scopes: [] };

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

function query(table: string, head: boolean) {
  const q: Record<string, unknown> = {};
  let isUndated = false;
  const chain = () => q;
  for (const m of ["select", "eq", "gte", "lte", "not", "order", "returns", "limit"]) q[m] = chain;
  q.is = () => { isUndated = true; return q; };
  q.in = (_c: string, ids: unknown) => { state.scopes.push(ids); return q; };
  q.then = (res: (v: unknown) => unknown) => {
    if (table === "catering_pipeline") {
      return Promise.resolve(res(head || isUndated ? { count: state.undated, data: null, error: null } : { data: state.lost, error: null }));
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
  state.lost = []; state.undated = 0; state.locations = []; state.scopes = [];
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
    expect(src).toContain("lostUndatedCount > 0");
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
    state.undated = 5;
    const withLost = await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    expect(withLost.windows).toEqual(without.windows);
    expect(withLost.calendar).toEqual(without.calendar);
    expect(withLost.lostCalendar.map((e) => e.name)).toEqual(["Acme", "Big"]);
    expect(withLost.lostCalendar.every((e) => e.stage === "lost")).toBe(true);
    expect(withLost.lostCalendar[0]!.valueCents).toBe(999900);
    expect(withLost.lostUndatedCount).toBe(5);
    expect(without.lostCalendar).toEqual([]);
  });
  it("lost reads are location-scoped like the RPC: a GM is scoped, an all-locations owner is not", async () => {
    await loadCateringInsightsV2(actor("owner", []), "2026-10-06");
    expect(state.scopes).toEqual([]);
    await loadCateringInsightsV2(actor("gm", ["L1"]), "2026-10-06");
    // feedback + lost list + lost undated count all carry the actor's shop list
    expect(state.scopes).toEqual([["L1"], ["L1"], ["L1"]]);
  });
});

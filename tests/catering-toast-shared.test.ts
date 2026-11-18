/** Item 21 PR 2: the pure rules behind house rows on the not-rung list, their suggestions and the pipeline label. */
import { describe, expect, it } from "vitest";
import {
  houseNotInToastOrder, houseRowListed, mergePipelineReconciliation, suggestionsFor,
  type CateringToastPlanRow, type HouseStatusRow,
} from "@/lib/catering/catering-toast-shared";

const status = (over: Partial<HouseStatusRow> = {}): HouseStatusRow => ({
  lead_id: "lead", location_id: "shop", event_date: "2026-11-20", lead_source: "portal", ring_code: "CO-4KM7R",
  headcount: 20, value_cents: 50000, toast_origin: false, status: "not_rung_in_toast", ...over,
});
const plan = (over: Partial<CateringToastPlanRow> = {}): CateringToastPlanRow => ({
  lead_id: "lead", location_id: "shop", order_guid: "o", check_guid: "c", toast_snapshot_id: "s", business_date: "2026-11-20",
  evidence: "amount_date", check_total_cents: 50000, lead_value_cents: 50000, amount_diff_cents: 0, amount_mismatch: false,
  dual_code: false, owner: null, owner_lead_id: null, blocked: false, ...over,
});

describe("house rows on the not-rung list", () => {
  it("lists only not-rung rows of an enabled shop", () => {
    expect(houseRowListed(status(), { enabled: true, includeToastOriginLeads: false })).toBe(true);
    expect(houseRowListed(status(), { enabled: false, includeToastOriginLeads: false })).toBe(false);
    for (const s of ["matched", "amount_mismatch", "no_ring_expected"] as const) {
      expect(houseRowListed(status({ status: s }), { enabled: true, includeToastOriginLeads: false })).toBe(false);
    }
  });
  it("keeps Toast-origin leads off until they can link by origin (Astra r3 #4)", () => {
    expect(houseRowListed(status({ toast_origin: true }), { enabled: true, includeToastOriginLeads: false })).toBe(false);
    expect(houseRowListed(status({ toast_origin: true }), { enabled: true, includeToastOriginLeads: true })).toBe(true);
  });
  it("becomes a NotInToastOrder named by its ring code, valued by the lead, with no ready time", () => {
    expect(houseNotInToastOrder(status())).toEqual({
      order_id: "lead", lead_id: "lead", location_id: "shop", event_date: "2026-11-20", order_number: "CO-4KM7R",
      handoff_time: null, event_timestamp: null, headcount: 20, total_cents: 50000, source: "house",
    });
    expect(houseNotInToastOrder(status({ ring_code: null, value_cents: null })).order_number).toBeNull();
  });
});

describe("suggestions never clear a row; they rank and they name conflicts", () => {
  it("ranks origin over code over amount, then the smaller difference", () => {
    const s = suggestionsFor("lead", [
      plan({ check_guid: "amt-far", amount_diff_cents: 4000 }),
      plan({ check_guid: "amt-near", amount_diff_cents: -100 }),
      plan({ check_guid: "code", evidence: "ring_code", amount_diff_cents: 9000, amount_mismatch: true }),
    ]);
    expect(s.best?.checkGuid).toBe("code");
    expect(s.count).toBe(3);
    expect(suggestionsFor("lead", [plan({ check_guid: "amt-far", amount_diff_cents: 4000 }), plan({ check_guid: "amt-near", amount_diff_cents: -100 })]).best?.checkGuid).toBe("amt-near");
    expect(suggestionsFor("lead", [plan({ evidence: "ring_code" }), plan({ check_guid: "o", evidence: "toast_origin" })]).best?.evidence).toBe("toast_origin");
  });
  it("a blocked pair (unlinked / not a match) is never offered again", () => {
    expect(suggestionsFor("lead", [plan({ blocked: true })])).toEqual({ best: null, count: 0, conflicts: 0 });
  });
  it("an owned or dual-code check is a conflict, never a suggestion; a check this lead already owns is neither", () => {
    const s = suggestionsFor("lead", [
      plan({ check_guid: "ez", owner: "ezcater", evidence: "ring_code" }),
      plan({ check_guid: "other", owner: "house", owner_lead_id: "someone" }),
      plan({ check_guid: "dual", dual_code: true, evidence: "ring_code" }),
      plan({ check_guid: "mine", owner: "house", owner_lead_id: "lead" }),
    ]);
    expect(s).toEqual({ best: null, count: 0, conflicts: 3 });
  });
  it("reads only its own lead's rows", () => {
    expect(suggestionsFor("lead", [plan({ lead_id: "else" })]).count).toBe(0);
  });
});

describe("the pipeline label partitions an unchanged total", () => {
  const raw = (parts: Record<string, [number, number, number]>, total: number) => ({
    total_events: Object.values(parts).reduce((a, p) => a + p[0], 0), total_value_cents: total,
    total_unvalued: Object.values(parts).reduce((a, p) => a + p[2], 0),
    parts: Object.fromEntries(Object.entries(parts).map(([k, [events, cents, unvalued]]) => [k, { events, value_cents: cents, unvalued }])),
  });
  it("sums windows and keeps every part", () => {
    const merged = mergePipelineReconciliation([
      raw({ rung_in_toast: [1, 50000, 0], not_rung: [2, 38000, 0] }, 88000),
      raw({ ezcater_sourced: [1, 70000, 0], toast_origin: [1, 12000, 0], no_ring_expected: [1, 0, 1] }, 82000),
    ]);
    expect(merged).toEqual({ totalCents: 170000, totalEvents: 6, unvalued: 1,
      parts: { rung_in_toast: 50000, toast_origin: 12000, ezcater_sourced: 70000, no_ring_expected: 0, not_rung: 38000 } });
  });
  it("refuses a partition that does not sum to its total (never a wrong label)", () => {
    expect(mergePipelineReconciliation([raw({ rung_in_toast: [1, 50000, 0] }, 60000)])).toBeNull();
    expect(mergePipelineReconciliation([{ parts: { bogus: { events: 1, value_cents: 5, unvalued: 0 } }, total_value_cents: 5, total_events: 1, total_unvalued: 0 }])).toBeNull();
  });
});

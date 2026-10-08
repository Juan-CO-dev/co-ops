import { describe, expect, it } from "vitest";
import { capturedDayPulse, type PulseCapturedOrder } from "@/lib/toast/capture-pulse-shared";

const order = (changes: Partial<PulseCapturedOrder> = {}): PulseCapturedOrder => ({
  deleted: false, voided: false, excessFood: false,
  checks: [{ checkGuid: "check", amountCents: 1100, deleted: false, voided: false }],
  selections: [
    { check_guid: "check", selection_guid: "sub", parent_selection_guid: null, item_guid: "item", name: "Sub", quantity: 2, voided: false, deleted: false },
    { check_guid: "check", selection_guid: "mod", parent_selection_guid: "sub", item_guid: "modifier", name: "Extra", quantity: 2, voided: false, deleted: false },
  ], ...changes,
});
describe("capture pulse", () => {
  it("uses check net amount once despite modifiers and quantities", () => {
    expect(capturedDayPulse("2026-10-07", [order()]).aggregate).toEqual({ businessDate: "2026-10-07", netCents: 1100, checks: 1, avgTicketCents: 1100, units: 2 });
  });
  it("excludes deleted, voided and excess orders and dead checks from money and units", () => {
    const values = [order({ deleted: true }), order({ voided: true }), order({ excessFood: true }),
      order({ checks: [{ checkGuid: "check", amountCents: 1100, deleted: true, voided: false }] }),
      order({ checks: [{ checkGuid: "check", amountCents: 1100, deleted: false, voided: true }] })];
    expect(capturedDayPulse("2026-10-07", values)).toMatchObject({ aggregate: { netCents: 0, checks: 0, units: 0 }, rows: [] });
  });
  it("excludes gift-card checks and selections from sales and units", () => {
    expect(capturedDayPulse("2026-10-07", [order({ salesChannel: "gift_card" }), order()]))
      .toMatchObject({ aggregate: { netCents: 1100, checks: 1, units: 2 } });
    expect(capturedDayPulse("2026-10-07", [order({ salesChannel: "gift_card" })]).rows).toEqual([]);
  });
  it("completed empty days aggregate to real zero", () => {
    expect(capturedDayPulse("2026-10-07", []).aggregate).toMatchObject({ netCents: 0, checks: 0, avgTicketCents: null, units: 0 });
  });
  it("counts a live check even when it contains no captured item selections", () => {
    expect(capturedDayPulse("2026-10-07", [order({ selections: [] })])).toMatchObject({
      aggregate: { netCents: 1100, checks: 1, units: 0 }, rows: [],
    });
  });
  it("refuses to turn an eligible check with missing money into fabricated zero", () => {
    expect(() => capturedDayPulse("2026-10-07", [order({ checks: [{ checkGuid: "check", amountCents: null, deleted: false, voided: false }] })]))
      .toThrow("capture_pulse_amount_missing");
  });
});

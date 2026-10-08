import { describe, expect, it } from "vitest";
import { captureCateringContext, cateringCaptureRunError } from "@/lib/toast/capture-catering-shared";
import { extractToastOrders } from "@/lib/toast/catering-orders-shared";

const now = Date.parse("2026-10-07T18:00:00Z");
const dining = [
  { guid: "ez-one", name: "EZ Cater", updated_at: new Date(now).toISOString() },
  { guid: "ez-two", name: "Ezcater", updated_at: new Date(now).toISOString() },
  { guid: "house", name: "Catering", updated_at: new Date(now).toISOString() },
];
const channels = dining.map((row) => ({ dining_option_label: row.name, channel: "catering", provider: row.guid === "house" ? "house" : "ezCater", reviewed_at: new Date(now).toISOString() }));
const orders = (guid: string) => extractToastOrders([{ guid: "order", businessDate: 20261007, diningOption: { guid }, checks: [] }]);

describe("capture catering classification", () => {
  it("joins both reviewed ezCater labels through GUID without comparing their spelling", () => {
    for (const guid of ["ez-one", "ez-two"]) {
      expect(captureCateringContext(orders(guid), dining, channels, now).classifications.get("order")).toBe("ezcater");
    }
    expect(captureCateringContext(orders("house"), dining, channels, now).classifications.get("order")).toBe("catering");
  });
  it("reports stale or missing config rather than silently classifying nothing", () => {
    expect(() => captureCateringContext(orders("missing"), dining, channels, now)).toThrow("capture_catering_config_stale");
    expect(() => captureCateringContext([], [], channels, now)).toThrow("capture_catering_config_stale");
    expect(() => captureCateringContext(orders("house"), dining, channels, now + 3600_001)).toThrow("capture_catering_config_stale");
  });
  it("refuses unreviewed mappings and never fuzzy-matches new labels", () => {
    expect(() => captureCateringContext(orders("house"), dining, [], now)).toThrow("capture_catering_channel_unreviewed");
    const unreviewed = channels.map((row) => ({ ...row, reviewed_at: null }));
    expect(() => captureCateringContext(orders("house"), dining, unreviewed, now)).toThrow("capture_catering_channel_unreviewed");
  });
  it("retains third-party attribution without claiming a house lead", () => {
    const rows = orders("house").map((order) => ({ ...order, thirdPartyProvider: "partner" }));
    expect(captureCateringContext(rows, dining, channels, now).classifications.get("order")).toBe("third_party");
  });
});

describe("capture catering coverage health", () => {
  const run = { finished_at: new Date(now).toISOString(), catering_status: "complete" as const, catering_error_code: null };
  it("requires positive sink completion even after capture finished", () => {
    expect(cateringCaptureRunError({ ...run, catering_status: "pending" }, "2026-10-07", now)).toBe("capture_catering_pending");
    expect(cateringCaptureRunError({ ...run, catering_status: "degraded", catering_error_code: "capture_catering_config_stale" }, "2026-10-07", now)).toBe("capture_catering_config_stale");
  });
  it("checks rolling-day freshness without mislabeling historical backfills stale", () => {
    expect(cateringCaptureRunError(run, "2026-10-07", now)).toBeNull();
    const old = { ...run, finished_at: new Date(now - 20 * 60_000 - 1).toISOString() };
    expect(cateringCaptureRunError(old, "2026-10-07", now)).toBe("capture_catering_stale");
    expect(cateringCaptureRunError(old, "2026-10-06", now)).toBe("capture_catering_stale");
    expect(cateringCaptureRunError(old, "2026-10-05", now)).toBeNull();
  });
});

describe("capture catering cancellation", () => {
  it("maps deleted and excess-food orders to cancellation instead of new leads", () => {
    for (const flags of [{ deleted: true }, { excessFood: true }, { voided: true }]) {
      const [summary] = extractToastOrders([{ guid: "cancelled", businessDate: 20261007, ...flags, checks: [] }]);
      expect(summary?.voided).toBe(true);
    }
  });
  it("omits deleted checks including their amounts, items and contacts", () => {
    const [summary] = extractToastOrders([{ guid: "deleted-check", businessDate: 20261007, checks: [
      { deleted: true, totalAmount: 100, customer: { firstName: "Synthetic" }, selections: [{ item: { guid: "item" }, displayName: "Sub", quantity: 1 }] },
      { totalAmount: 10, selections: [] },
    ] }]);
    expect(summary).toMatchObject({ totalCents: 1000, items: [], customer: null });
  });
});

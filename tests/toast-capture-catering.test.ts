import { describe, expect, it } from "vitest";
import { captureCateringContext, cateringCaptureRunError, cateringCoverage } from "@/lib/toast/capture-catering-shared";
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
  it("treats absent options and unreviewed labels as per-order diagnostics", () => {
    for (const guid of ["missing", "house"]) {
      const result = captureCateringContext(orders(guid), dining, [], now);
      expect(result.classifications.get("order")).toBe("not_catering");
      expect(result.diagnostics.get("order")).toBe(guid === "missing" ? "capture_catering_option_missing" : "capture_catering_channel_unreviewed");
    }
    expect(captureCateringContext([], [], [], now).diagnostics.size).toBe(0);
  });
  it("old reviewed config remains usable and an unknown order never poisons its peers", () => {
    const mixed = [...orders("missing"), ...orders("house").map(o => ({ ...o, guid: "known" }))];
    const result = captureCateringContext(mixed, dining, channels, now + 3600_001);
    expect(result.classifications.get("order")).toBe("not_catering");
    expect(result.classifications.get("known")).toBe("catering");
    expect(result.diagnostics.size).toBe(1);
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

describe("cateringCoverage (digest polish item 12)", () => {
  const now = Date.parse("2026-10-08T14:00:00Z");
  it("no run, or a pending pass with no named error, is pending", () => {
    expect(cateringCoverage(null, "2026-10-08", now)).toEqual({ state: "pending" });
    expect(cateringCoverage({ finished_at: "2026-10-08T13:55:00Z", catering_status: "pending", catering_error_code: null }, "2026-10-08", now)).toEqual({ state: "pending" });
  });
  it("a pending pass WITH a named error, a degraded pass, or a stale capture is an error", () => {
    expect(cateringCoverage({ finished_at: "2026-10-08T13:55:00Z", catering_status: "pending", catering_error_code: "capture_catering_deadline" }, "2026-10-08", now))
      .toEqual({ state: "error", code: "capture_catering_deadline" });
    expect(cateringCoverage({ finished_at: "2026-10-08T13:55:00Z", catering_status: "degraded", catering_error_code: null }, "2026-10-08", now).state).toBe("error");
    expect(cateringCoverage({ finished_at: "2026-10-08T10:00:00Z", catering_status: "complete", catering_error_code: null }, "2026-10-08", now))
      .toEqual({ state: "error", code: "capture_catering_stale" });
  });
  it("a fresh complete pass is ready", () => {
    expect(cateringCoverage({ finished_at: "2026-10-08T13:55:00Z", catering_status: "complete", catering_error_code: null }, "2026-10-08", now)).toEqual({ state: "ready" });
  });
});

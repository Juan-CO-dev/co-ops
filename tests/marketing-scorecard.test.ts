import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ROLES } from "../lib/roles";
import { MARKETING_SCORECARD_ROLES } from "../lib/marketing/scorecard-shared";
import {
  baselineDrift, baselineWeeklyAverage, classifyToastChecks, computeOrderTaps, computeScorecard,
  costPerExtraDirectOnlineOrder, costPerTap, ezcaterLargeOrder, LARGE_CHECK_CENTS, manualMetric,
  scorecardWindows, tapEtDay, windowDays,
  type ChannelDay, type ScorecardInput, type ToastCheck,
} from "../lib/marketing/scorecard-shared";

const day = "2026-10-26";
const channel = (overrides: Partial<ChannelDay> = {}): ChannelDay => ({ locationId: "shop-a", day,
  channel: "online", provider: null, checks: 1, orders: 1, cents: 10000, amountMissing: false, ...overrides });
const input = (overrides: Partial<ScorecardInput> = {}): ScorecardInput => ({ window: { from: day, to: day },
  locationIds: ["shop-a"], capturedDays: [{ locationId: "shop-a", day }], channels: [], ezcater: [],
  unknownLabels: [], largeChecks: [], pipeline: null,
  directOnlineOrders: overrides.channels?.filter(row => ["online", "app", "delivery"].includes(row.channel))
    .map(row => ({ locationId: row.locationId, day: row.day, orders: row.orders })) ?? [], ...overrides });
const check = (overrides: Partial<ToastCheck> = {}): ToastCheck => ({ locationId: "shop-a", day,
  checkGuid: "check-a", orderGuid: "order-a", channel: "online", provider: null, label: "Web",
  saleClass: "sale", amountCents: 10000, ...overrides });

describe("marketing calendar windows", () => {
  it.each(["2026-03-02", "2026-10-26"])("keeps seven calendar days across DST from %s", start => {
    const result = scorecardWindows(start, start === "2026-03-02" ? "2026-03-09T04:00:00Z" : "2026-11-02T05:00:00Z");
    expect(result.weeks[0]?.complete).toBe(true);
    expect(windowDays(result.weeks[0]!)).toHaveLength(7);
    expect(windowDays(result.baseline!)).toHaveLength(28);
    expect(result.baselineWeeks).toHaveLength(4);
    expect(result.weeks[1]?.daysSoFar).toBe(1);
  });
  it.each(["2026-10-26", "2026-10-28"])("anchors baseline and spend weeks to D (%s), not Monday", d => {
    const result = scorecardWindows(d, "2026-11-05T17:00:00Z");
    expect(result.weeks[0]?.from).toBe(d);
    expect(result.baseline?.to).toBe(d === "2026-10-26" ? "2026-10-25" : "2026-10-27");
    expect(result.weeks[0]?.compare).toBe(true);
    expect(result.weeks[1]?.compare).toBe(false);
    expect(result.weeks[1]?.daysSoFar).toBe(d === "2026-10-26" ? 4 : 2);
  });
  it("uses ET midnight, not UTC midnight, to complete a spend week", () => {
    expect(scorecardWindows(day, "2026-11-02T04:59:59Z").weeks[0]?.complete).toBe(false);
    expect(scorecardWindows(day, "2026-11-02T05:00:00Z").weeks[0]?.complete).toBe(true);
  });
  it("falls back to four complete Mon-Sun weeks when D is unset or in the future", () => {
    const result = scorecardWindows(null, "2026-10-28T15:00:00Z");
    expect(result.noBaseline).toBe(true);
    expect(result.baseline).toBeNull();
    expect(result.weeks[0]?.from).toBe("2026-09-28");
    expect(result.weeks[3]?.to).toBe("2026-10-25");
    expect(result.weeks.every(week => week.complete && !week.compare)).toBe(true);
    expect(scorecardWindows("2026-11-02", "2026-10-28T15:00:00Z").weeks).toEqual(result.weeks);
    expect(result.yoy).toEqual({ state: "unavailable", captureBegan: "2026-10-07" });
  });
  it("rejects malformed or impossible dates and reversed windows", () => {
    expect(() => windowDays({ from: "2026-02-30", to: "2026-03-02" })).toThrow("date_invalid");
    expect(() => windowDays({ from: "2026-03-02", to: "2026-03-01" })).toThrow("window_invalid");
  });
});

describe("sales classification", () => {
  it("pins SQL eligibility, exclusion and ezCater flag thresholds to the pure constant", () => {
    const sql = readFileSync(new URL("../supabase/migrations/0289_marketing_scorecard.sql", import.meta.url), "utf8");
    const executable = sql.replace(/--[^\n]*/g, "");
    const thresholds = [...executable.matchAll(/(?:amount_cents|subtotal_cents)\s*(?:<=|>)\s*(\d+)/g)]
      .map(match => Number(match[1]));
    expect(thresholds).toEqual([LARGE_CHECK_CENTS, LARGE_CHECK_CENTS, LARGE_CHECK_CENTS]);
  });
  it("counts exactly $5k, excludes $5k + 1 cent Toast checks, flags and counts ezCater", () => {
    expect(LARGE_CHECK_CENTS).toBe(500000);
    const normalized = classifyToastChecks([check({ amountCents: 500000 }), check({ checkGuid: "large", amountCents: 500001 })]);
    const result = computeScorecard(input({ ...normalized, ezcater: [{ locationId: "shop-a", day, orders: 1,
      cents: 500001, amountMissing: false, largeOrders: Number(ezcaterLargeOrder(500001)), reconciliation: { matched: 1 } }] }));
    expect(normalized.largeChecks).toEqual([{ locationId: "shop-a", day, channel: "online", amountCents: 500001 }]);
    expect(result.classifiedCents.value).toBe(1000001);
    expect(result.ezcater.cents.value).toBe(500001);
    expect(result.ezcater.largeOrders).toBe(1);
    expect(ezcaterLargeOrder(500000)).toBe(false);
    expect(ezcaterLargeOrder(null)).toBe(false);
  });
  it("excludes non-sales and linked Toast ezCater checks, deduplicates checks and orders", () => {
    const normalized = classifyToastChecks([check(), check(), check({ checkGuid: "split" }),
      ...["gift_card", "void", "excess_food", "ezcater_linked"].map(saleClass => check({ saleClass, checkGuid: saleClass }))]);
    expect(normalized.channels[0]).toMatchObject({ checks: 2, orders: 1, cents: 20000 });
  });
  it("counts an order appearing across direct channels/providers only once", () => {
    const normalized = classifyToastChecks([check(), check({ checkGuid: "split", channel: "delivery", provider: "tds" })]);
    const result = computeScorecard(input(normalized));
    expect(normalized.channels).toHaveLength(2);
    expect(result.directOnlineOrders.value).toBe(1);
    expect(result.directOnlineOrdersPerDay.value).toBe(1);
  });
  it("separates unknown labels including no dining option and excludes unknown money/counts", () => {
    const normalized = classifyToastChecks([check(), check({ checkGuid: "u", channel: "unknown", label: null, amountCents: 200 }),
      check({ checkGuid: "v", channel: "unknown", label: "Unreviewed", amountCents: 1 })]);
    const result = computeScorecard(input(normalized));
    expect(result.unknownLabels.map(row => row.label)).toEqual(["(no dining option)", "Unreviewed"]);
    expect(result.classifiedCents.value).toBe(10000);
    expect(result.directOnlineOrders.value).toBe(1);
    expect(result.onlineDirectShare).toMatchObject({ state: "partial", value: 1, reasons: ["unknown_share"] });
    expect(result.onlineDirectOrderShare.state).toBe("partial");
  });
  it.each([[200, false], [201, true]])("unknown threshold is strictly >2%% (%s)", (cents, partial) => {
    const result = computeScorecard(input({ channels: [channel()], unknownLabels: [{ locationId: "shop-a", day,
      label: "Unreviewed", checks: 1, cents, amountMissing: false }] }));
    expect(result.unknownTooHigh).toBe(partial);
    expect(result.totalDirectShare.state).toBe(partial ? "partial" : "ok");
  });
  it("unknown-only windows have no computable share", () => {
    const result = computeScorecard(input({ unknownLabels: [{ locationId: "shop-a", day,
      label: "Unreviewed", checks: 1, cents: 10000, amountMissing: false }] }));
    expect(result.unknownTooHigh).toBe(true);
    expect(result.onlineDirectShare).toMatchObject({ state: "unavailable", reasons: ["zero_denominator"] });
  });
  it("marks null amounts partial without inventing $0 observations", () => {
    const result = computeScorecard(input(classifyToastChecks([check({ amountCents: null })])));
    expect(result.classifiedCents).toEqual({ state: "partial", value: 0, reasons: ["amount_missing"] });
    expect(result.directOnlineOrders).toEqual({ state: "ok", value: 1 });
    expect(result.onlineDirectShare.state).toBe("unavailable");
  });
  it("preserves known unknown-label sums while disclosing missing amounts in shares", () => {
    const normalized = classifyToastChecks([check(), check({ checkGuid: "u1", channel: "unknown", amountCents: 100 }),
      check({ checkGuid: "u2", channel: "unknown", amountCents: null })]);
    expect(normalized.channels).toHaveLength(1);
    expect(normalized.unknownLabels[0]).toMatchObject({ cents: 100, checks: 2, amountMissing: true });
    expect(computeScorecard(input(normalized)).totalDirectShare).toMatchObject({ state: "partial", reasons: ["amount_missing"] });
  });
  it("keeps Delivery Services direct, separates marketplace providers, and keeps pipeline beside catering", () => {
    const result = computeScorecard(input({ channels: [channel({ channel: "delivery" }),
      channel({ channel: "dine_in" }), channel({ channel: "catering" }),
      channel({ channel: "third_party", provider: "uber_eats" }), channel({ channel: "third_party", provider: null })],
      pipeline: [{ locationId: "shop-a", day, completedEvents: 2, cents: 99000 }] }));
    expect(result.onlineDirectShare.value).toBeCloseTo(1 / 3);
    expect(result.totalDirectShare.value).toBe(0.6);
    expect(result.dineInPoints.value).toBe(0.2);
    expect(result.toastDeliveryServices.orders.value).toBe(1);
    expect(result.marketplace.map(row => row.provider)).toEqual(["uber_eats", null]);
    expect(result.marketplace[0]?.share.value).toBe(0.2);
    expect(result.directCatering.cents.value).toBe(10000);
    expect(result.pipeline.cents.value).toBe(99000);
    expect(result.classifiedCents.value).toBe(50000);
  });
});

describe("coverage and all shops", () => {
  it("keeps ezCater coverage independent of Toast and missing amounts in other sources", () => {
    const ezcater = [{ locationId: "shop-a", day, orders: 2, cents: 12000,
      amountMissing: false, largeOrders: 0, reconciliation: { matched: 2 } }];
    for (const capturedDays of [[], [{ locationId: "shop-a", day }]]) {
      const result = computeScorecard(input({ capturedDays, ezcater, channels: [channel({ cents: null, amountMissing: true })] }));
      expect(result.ezcater.orders).toEqual({ state: "ok", value: 2 });
      expect(result.ezcater.cents).toEqual({ state: "ok", value: 12000 });
      expect(result.ezcater.averageTicket).toEqual({ state: "ok", value: 6000 });
    }
    expect(computeScorecard(input({ capturedDays: [], ezcater: [] })).ezcater.orders).toEqual({ state: "ok", value: 0 });
    const absent = computeScorecard(input({ ezcater: null })).ezcater;
    for (const metric of [absent.orders, absent.cents, absent.averageTicket]) expect(metric.state).toBe("unavailable");
    const missing = computeScorecard(input({ capturedDays: [], ezcater: [{ ...ezcater[0]!, cents: null, amountMissing: true }] })).ezcater;
    expect(missing.orders).toEqual({ state: "ok", value: 2 });
    expect(missing.cents).toMatchObject({ state: "partial", reasons: ["amount_missing"] });
    expect(missing.averageTicket).toMatchObject({ state: "partial", reasons: ["amount_missing"] });
  });
  it("distinguishes a captured zero day from no capture", () => {
    expect(computeScorecard(input()).directOnlineOrders).toEqual({ state: "ok", value: 0 });
    expect(computeScorecard(input({ capturedDays: [] })).directOnlineOrders).toEqual({ state: "unavailable", value: null, reasons: ["no_capture"] });
  });
  it("does not pre-program closed days; duplicate runs do not inflate coverage", () => {
    const result = computeScorecard(input({ window: { from: day, to: "2026-11-01" },
      channels: [channel({ orders: 4 })], capturedDays: [{ locationId: "shop-a", day }, { locationId: "shop-a", day }] }));
    expect(result.coverage).toEqual({ capturedDays: 1, expectedDays: 7, capturedCalendarDays: 1 });
    expect(result.directOnlineOrdersPerDay).toEqual({ state: "partial", value: 4, reasons: ["coverage_gap"] });
  });
  it("sums money and counts before computing shares, excludes out-of-lens/window facts", () => {
    const result = computeScorecard(input({ locationIds: ["shop-a", "shop-b"],
      capturedDays: [{ locationId: "shop-a", day }, { locationId: "shop-b", day }],
      channels: [channel({ cents: 100, orders: 1 }), channel({ channel: "third_party", cents: 900, orders: 9 }),
        channel({ locationId: "shop-b", cents: 9000, orders: 90 }),
        channel({ locationId: "shop-c", cents: 999999 }), channel({ day: "2026-10-25", cents: 999999 })] }));
    expect(result.onlineDirectShare.value).toBe(0.91);
    expect(result.onlineDirectOrderShare.value).toBe(0.91);
    expect(result.directOnlineOrdersPerDay.value).toBe(91);
    expect(result.coverage.expectedDays).toBe(2);
  });
  it("flags a missing shop even when another shop captured that day", () => {
    const result = computeScorecard(input({ locationIds: ["shop-a", "shop-b"], channels: [channel()] }));
    expect(result.coverage).toMatchObject({ capturedDays: 1, expectedDays: 2 });
    expect(result.totalDirectShare.state).toBe("partial");
  });
});

describe("ET order taps and derived metrics", () => {
  it.each([["2026-03-09T03:59:59Z", "2026-03-08"], ["2026-03-09T04:00:00Z", "2026-03-09"],
    ["2026-11-02T04:59:59Z", "2026-11-01"], ["2026-11-02T05:00:00Z", "2026-11-02"]])("buckets %s in ET", (instant, date) => {
    expect(tapEtDay(instant)).toBe(date);
  });
  const taps = { window: { from: day, to: day }, installed: true, counterOn: day, rows: [], storeKeys: ["first"] };
  it("distinguishes absent installation, off counter, and a zero after counter_on", () => {
    expect(computeOrderTaps({ ...taps, installed: false }).total).toMatchObject({ reasons: ["counter_not_installed"] });
    expect(computeOrderTaps({ ...taps, counterOn: null }).total).toMatchObject({ reasons: ["counter_off"] });
    expect(computeOrderTaps({ ...taps, counterOn: "2026-10-27" }).total.state).toBe("unavailable");
    expect(computeOrderTaps(taps).total).toEqual({ state: "ok", value: 0 });
    expect(computeOrderTaps({ ...taps, window: { from: "2026-10-25", to: day } }).total).toEqual({ state: "partial", value: 0, reasons: ["counter_off"] });
  });
  it("includes retired codes, excludes unattributed from coded taps, keeps ET dates intact", () => {
    const result = computeOrderTaps({ ...taps, rows: [
      { day, storeKey: "first", adCode: "retired", active: false, clickCount: 4 },
      { day, storeKey: "first", adCode: "retired", active: false, clickCount: 3 },
      { day, storeKey: "first", adCode: "unattributed", active: true, clickCount: 2 },
      { day, storeKey: "other", adCode: "outside", active: true, clickCount: 100 },
    ] });
    expect(result.total.value).toBe(9);
    expect(result.coded.value).toBe(7);
    expect(result.groups[0]).toMatchObject({ active: false, clickCount: 7 });
  });
  it("excludes visits from order totals and splits each ad intent and keeps delivery outside a shop lens", () => {
    const rows = [
      { day, storeKey: "first", adCode: "campaign", active: true, clickCount: 2, intent: "pickup" as const },
      { day, storeKey: "first", adCode: "campaign", active: true, clickCount: 3, intent: "visit" as const },
      { day, storeKey: "any", adCode: "campaign", active: true, clickCount: 4, intent: "delivery" as const },
      { day, storeKey: "first", adCode: "campaign", active: true, clickCount: 1 },
    ];
    const all = computeOrderTaps({ ...taps, rows, storeKeys: ["first", "any"] });
    expect(all.total.value).toBe(7);
    expect(all.coded.value).toBe(7);
    const withoutVisits = computeOrderTaps({ ...taps, rows: rows.filter(row => row.intent !== "visit"), storeKeys: ["first", "any"] });
    expect(costPerTap(manualMetric(700), all.coded)).toEqual(costPerTap(manualMetric(700), withoutVisits.coded));
    expect(costPerTap(manualMetric(700), all.coded).value).toBe(100);
    const visitsOnly = computeOrderTaps({ ...taps, rows: rows.filter(row => row.intent === "visit") });
    expect(visitsOnly.total.value).toBe(0);
    expect(visitsOnly.coded.value).toBe(0);
    expect(visitsOnly.groups).toEqual([]);
    expect(costPerTap(manualMetric(700), visitsOnly.coded)).toMatchObject({ reasons: ["zero_denominator"] });
    expect(all.intents).toEqual([{ adCode: "campaign", active: true, pickup: 2, visit: 3, delivery: 4, legacy: 1 }]);
    expect(all.groups.reduce((sum, row) => sum + row.clickCount, 0)).toBe(7);
    const shop = computeOrderTaps({ ...taps, rows });
    expect(shop.total.value).toBe(3);
    expect(shop.intents[0]?.delivery).toBe(0);
  });
  it("requires both cost-per-tap inputs and preserves explicit zero spend", () => {
    expect(costPerTap(manualMetric(1000), manualMetric(4)).value).toBe(250);
    expect(costPerTap(manualMetric(0), manualMetric(4))).toEqual({ state: "ok", value: 0 });
    expect(costPerTap(manualMetric(null), manualMetric(4)).state).toBe("unavailable");
    expect(costPerTap(manualMetric(1000), manualMetric(0))).toMatchObject({ reasons: ["zero_denominator"] });
  });
  it("uses a positive seven-day lift, requires baseline and complete week", () => {
    const spend = manualMetric(7000), baseline = manualMetric(10);
    expect(costPerExtraDirectOnlineOrder(spend, manualMetric(12), baseline, true).value).toBe(500);
    for (const count of [10, 9]) expect(costPerExtraDirectOnlineOrder(spend, manualMetric(count), baseline, true)).toMatchObject({ reasons: ["no_lift"] });
    expect(costPerExtraDirectOnlineOrder(spend, manualMetric(12), null, true)).toMatchObject({ reasons: ["no_baseline"] });
    expect(costPerExtraDirectOnlineOrder(spend, manualMetric(12), baseline, false)).toMatchObject({ reasons: ["incomplete_week"] });
    expect(costPerExtraDirectOnlineOrder(manualMetric(null), manualMetric(12), baseline, true).state).toBe("unavailable");
    expect(costPerExtraDirectOnlineOrder(manualMetric(0), manualMetric(12), baseline, true).value).toBe(0);
  });
  it("propagates partial inputs and computes baseline weekly total / 4", () => {
    const partial = { state: "partial" as const, value: 28, reasons: ["coverage_gap" as const] };
    expect(baselineWeeklyAverage(partial)).toEqual({ ...partial, value: 7 });
    expect(costPerTap(manualMetric(100), partial)).toMatchObject({ state: "partial", reasons: ["coverage_gap"] });
    expect(costPerExtraDirectOnlineOrder(manualMetric(100), partial, manualMetric(10), true).state).toBe("partial");
  });
  it("uses strict baseline drift thresholds", () => {
    expect(baselineDrift(1100, 1000, 0.501, 0.5)).toBe(false);
    expect(baselineDrift(1101, 1000, 0.5, 0.5)).toBe(true);
    expect(baselineDrift(1000, 1000, 0.5011, 0.5)).toBe(true);
  });
  it.each(Object.keys(ROLES))("has explicit role membership for %s", role => {
    expect((MARKETING_SCORECARD_ROLES as readonly string[]).includes(role)).toBe(["moo", "owner", "cgs"].includes(role));
  });
});

it('caps spend history at twelve complete weeks plus the current week', () => {
  const result = scorecardWindows('2025-01-01', '2026-11-01T17:00:00Z');
  expect(result.weeks.filter(week => week.complete)).toHaveLength(12);
  expect(result.weeks.filter(week => !week.complete)).toHaveLength(1);
  expect(result.olderWeeksHidden).toBe(true);
  expect(result.baselineWeeks).toHaveLength(4);
  expect(result.baseline).toEqual({ from: '2024-12-04', to: '2024-12-31' });
});

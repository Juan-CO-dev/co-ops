import { etCalendarDate, etYmdMinusDays } from "../operational-day";

export const LARGE_CHECK_CENTS = 500000;
export const CAPTURE_BEGAN = "2026-10-07";
export type MetricReason = "no_capture" | "coverage_gap" | "amount_missing" | "unknown_share"
  | "zero_denominator" | "counter_not_installed" | "counter_off" | "not_entered"
  | "not_switched_on" | "no_baseline" | "no_lift" | "incomplete_week";
export type Metric = { state: "ok"; value: number }
  | { state: "partial"; value: number; reasons: MetricReason[] }
  | { state: "unavailable"; value: null; reasons: MetricReason[] };
export const unavailable = (reason: MetricReason): Metric => ({ state: "unavailable", value: null, reasons: [reason] });
function metric(value: number, reasons: MetricReason[] = []): Metric {
  const unique = [...new Set(reasons)];
  return unique.length ? { state: "partial", value, reasons: unique } : { state: "ok", value };
}
function reasonsOf(value: Metric): MetricReason[] { return value.state === "ok" ? [] : value.reasons; }
export interface DateWindow { from: string; to: string }
const addDays = (day: string, count: number) => etYmdMinusDays(day, -count);
function dateNumber(day: string): number {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== day) throw new Error("date_invalid");
  return parsed / 86400000;
}
export function windowDays(window: DateWindow): string[] {
  const count = dateNumber(window.to) - dateNumber(window.from) + 1;
  if (count < 1 || count > 366) throw new Error("window_invalid");
  return Array.from({ length: count }, (_, index) => addDays(window.from, index));
}
const inside = (day: string, window: DateWindow) => day >= window.from && day <= window.to;
export interface ScorecardWeek extends DateWindow { week: number; complete: boolean; daysSoFar: number; compare: boolean }

/** Calendar arithmetic, never elapsed 24-hour durations across a DST boundary. */
export function scorecardWindows(firstAdSpend: string | null, nowIso: string) {
  const today = etCalendarDate(nowIso);
  dateNumber(today);
  if (firstAdSpend !== null) dateNumber(firstAdSpend);
  const beforeSpend = firstAdSpend === null || today < firstAdSpend;
  const baseline = firstAdSpend === null ? null : { from: addDays(firstAdSpend, -28), to: addDays(firstAdSpend, -1) };
  const baselineWeeks = baseline === null ? [] : Array.from({ length: 4 }, (_, index) => ({
    from: addDays(baseline.from, index * 7), to: addDays(baseline.from, index * 7 + 6),
  }));
  const weeks: ScorecardWeek[] = [];
  if (beforeSpend) {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = addDays(today, -((weekday + 6) % 7));
    for (let index = 0; index < 4; index++) {
      const from = addDays(monday, -28 + index * 7);
      weeks.push({ from, to: addDays(from, 6), week: index + 1, complete: true, daysSoFar: 7, compare: false });
    }
  } else {
    const elapsed = dateNumber(today) - dateNumber(firstAdSpend!);
    for (let index = 0; index <= Math.floor(elapsed / 7); index++) {
      const from = addDays(firstAdSpend!, index * 7);
      const to = addDays(from, 6);
      const complete = to < today;
      weeks.push({ from, to, week: index + 1, complete, daysSoFar: complete ? 7 : elapsed % 7 + 1, compare: complete });
    }
  }
  return { today, baseline, baselineWeeks, weeks, noBaseline: firstAdSpend === null,
    yoy: { state: "unavailable" as const, captureBegan: CAPTURE_BEGAN } };
}

export type SalesChannel = "online" | "app" | "delivery" | "dine_in" | "takeout" | "third_party" | "catering" | "unknown";
/** The loader attaches locationId to the per-location RPC output. orders is DISTINCT order_guid per day/channel. */
export interface ChannelDay {
  locationId: string; day: string; channel: SalesChannel; provider: string | null;
  checks: number; orders: number; cents: number | null; amountMissing: boolean;
}
export interface ToastCheck {
  locationId: string; day: string; checkGuid: string; orderGuid: string; channel: SalesChannel;
  provider: string | null; label: string | null; saleClass: string; amountCents: number | null;
}
export interface UnknownLabel { locationId: string; day: string; label: string; checks: number; cents: number | null; amountMissing: boolean }
export interface LargeCheck { locationId: string; day: string; channel: SalesChannel; amountCents: number }
/** Reference normalization for check-level inputs. SQL applies the same threshold before aggregation. */
export function classifyToastChecks(checks: readonly ToastCheck[]) {
  const channels = new Map<string, ChannelDay & { orderIds: Set<string> }>();
  const directOrders = new Map<string, { locationId: string; day: string; ids: Set<string> }>();
  const unknownLabels = new Map<string, UnknownLabel>();
  const largeChecks: LargeCheck[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    if (check.saleClass !== "sale") continue;
    const identity = JSON.stringify([check.locationId, check.checkGuid]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (check.amountCents !== null && check.amountCents > LARGE_CHECK_CENTS) {
      largeChecks.push({ locationId: check.locationId, day: check.day, channel: check.channel, amountCents: check.amountCents });
      continue;
    }
    if (["online", "app", "delivery"].includes(check.channel)) {
      const key = JSON.stringify([check.locationId, check.day]);
      const group = directOrders.get(key) ?? { locationId: check.locationId, day: check.day, ids: new Set<string>() };
      group.ids.add(check.orderGuid);
      directOrders.set(key, group);
    }
    if (check.channel === "unknown") {
      const label = check.label ?? "(no dining option)";
      const key = JSON.stringify([check.locationId, check.day, label]);
      const row = unknownLabels.get(key) ?? { locationId: check.locationId, day: check.day, label, checks: 0, cents: 0, amountMissing: false };
      row.checks++;
      row.cents = (row.cents ?? 0) + (check.amountCents ?? 0);
      row.amountMissing ||= check.amountCents === null;
      unknownLabels.set(key, row);
      continue;
    }
    const key = JSON.stringify([check.locationId, check.day, check.channel, check.provider]);
    const row = channels.get(key) ?? { locationId: check.locationId, day: check.day, channel: check.channel,
      provider: check.provider, checks: 0, orders: 0, cents: 0, amountMissing: false, orderIds: new Set<string>() };
    row.checks++;
    row.orderIds.add(check.orderGuid);
    row.orders = row.orderIds.size;
    row.amountMissing ||= check.amountCents === null;
    row.cents = (row.cents ?? 0) + (check.amountCents ?? 0);
    channels.set(key, row);
  }
  return { channels: [...channels.values()].map(({ orderIds: _ids, ...row }) => row), unknownLabels: [...unknownLabels.values()], largeChecks,
    directOnlineOrders: [...directOrders.values()].map(row => ({ locationId: row.locationId, day: row.day, orders: row.ids.size })) };
}
export interface EzcaterDay {
  locationId: string; day: string; orders: number; cents: number | null;
  amountMissing: boolean; largeOrders: number; reconciliation: Readonly<Record<string, number>>;
}
/** ezCater is flagged but counted; callers supply already deduplicated orders. */
export function ezcaterLargeOrder(amountCents: number | null): boolean { return amountCents !== null && amountCents > LARGE_CHECK_CENTS; }
export interface PipelineDay { locationId: string; day: string; completedEvents: number; cents: number | null }
export interface ScorecardInput {
  window: DateWindow; locationIds: readonly string[];
  capturedDays: readonly { locationId: string; day: string }[];
  channels: readonly ChannelDay[]; ezcater: readonly EzcaterDay[];
  /** Authoritative distinct orders across ALL direct-online channels/providers, from the read RPC. */
  directOnlineOrders: readonly { locationId: string; day: string; orders: number }[];
  unknownLabels: readonly UnknownLabel[]; largeChecks: readonly LargeCheck[];
  /** null means that the independent CO-OPS pipeline source is unavailable. */
  pipeline: readonly PipelineDay[] | null;
}

/** Shares are fractions (0..1). Sum cents/counts across shops BEFORE division. */
export function computeScorecard(input: ScorecardInput) {
  const dates = windowDays(input.window);
  const shops = new Set(input.locationIds);
  const accepts = (row: { locationId: string; day: string }) => shops.has(row.locationId) && inside(row.day, input.window);
  const captures = input.capturedDays.filter(accepts);
  const captured = new Set(captures.map(row => JSON.stringify([row.locationId, row.day])));
  const capturedCalendarDays = new Set(captures.map(row => row.day)).size;
  const expectedDays = dates.length * shops.size;
  const coverage = { capturedDays: captured.size, expectedDays, capturedCalendarDays };
  const coverageReasons: MetricReason[] = captured.size < expectedDays ? ["coverage_gap"] : [];
  const rows = input.channels.filter(accepts);
  const ez = input.ezcater.filter(accepts);
  const known = rows.filter(row => row.channel !== "unknown");
  const sum = (values: readonly ChannelDay[], key: "cents" | "checks" | "orders") => values.reduce((total, row) => total + (row[key] ?? 0), 0);
  const online = known.filter(row => ["online", "app", "delivery"].includes(row.channel));
  const onlineOrders = input.directOnlineOrders.filter(accepts).reduce((total, row) => total + row.orders, 0);
  const store = known.filter(row => ["dine_in", "takeout"].includes(row.channel));
  const catering = known.filter(row => row.channel === "catering");
  const marketplace = known.filter(row => row.channel === "third_party");
  const ezCents = ez.reduce((total, row) => total + (row.cents ?? 0), 0);
  const ezOrders = ez.reduce((total, row) => total + row.orders, 0);
  const classifiedCents = sum(known, "cents") + ezCents;
  const unknownLabels = input.unknownLabels.filter(accepts);
  const unknownCents = unknownLabels.reduce((total, row) => total + (row.cents ?? 0), 0);
  const unknownTooHigh = unknownCents > classifiedCents * 0.02;
  const missing = known.some(row => row.amountMissing || row.cents === null) || ez.some(row => row.amountMissing || row.cents === null)
    || unknownLabels.some(row => row.amountMissing || row.cents === null);
  const moneyReasons: MetricReason[] = [...coverageReasons, ...(missing ? ["amount_missing" as const] : [])];
  const shareReasons: MetricReason[] = [...moneyReasons, ...(unknownTooHigh ? ["unknown_share" as const] : [])];
  const value = (number: number, reasons = coverageReasons): Metric => captured.size === 0 ? unavailable("no_capture") : metric(number, reasons);
  const share = (numerator: number, denominator: number, reasons = shareReasons): Metric => captured.size === 0
    ? unavailable("no_capture") : denominator === 0 ? unavailable("zero_denominator") : metric(numerator / denominator, reasons);
  const directCents = sum(online, "cents") + sum(store, "cents") + sum(catering, "cents");
  const providers = [...new Set(marketplace.map(row => row.provider))].map(provider => {
    const group = marketplace.filter(row => row.provider === provider);
    return { provider, cents: value(sum(group, "cents"), moneyReasons), share: share(sum(group, "cents"), classifiedCents) };
  });
  const reconciliation: Record<string, number> = {};
  for (const row of ez) for (const [status, count] of Object.entries(row.reconciliation)) reconciliation[status] = (reconciliation[status] ?? 0) + count;
  const pipeline = input.pipeline?.filter(accepts);
  return {
    coverage, classifiedCents: value(classifiedCents, moneyReasons), unknownTooHigh,
    unknownLabels, largeChecks: input.largeChecks.filter(accepts),
    onlineDirectShare: share(sum(online, "cents"), sum(online, "cents") + sum(marketplace, "cents")),
    onlineDirectOrderShare: share(onlineOrders, onlineOrders + sum(marketplace, "orders"),
      [...coverageReasons, ...(unknownTooHigh ? ["unknown_share" as const] : [])]),
    totalDirectShare: share(directCents, classifiedCents),
    dineInPoints: share(sum(known.filter(row => row.channel === "dine_in"), "cents"), classifiedCents),
    directOnlineOrders: value(onlineOrders),
    // All-shop rate is summed orders per captured calendar day, with shop-day gaps disclosed.
    directOnlineOrdersPerDay: capturedCalendarDays === 0 ? unavailable("no_capture") : value(onlineOrders / capturedCalendarDays),
    toastDeliveryServices: { cents: value(sum(known.filter(row => row.channel === "delivery"), "cents"), moneyReasons),
      orders: value(sum(known.filter(row => row.channel === "delivery"), "orders")) },
    marketplace: providers,
    directCatering: { checks: value(sum(catering, "checks")), cents: value(sum(catering, "cents"), moneyReasons) },
    pipeline: pipeline === undefined ? { events: unavailable("no_capture"), cents: unavailable("no_capture") }
      : { events: metric(pipeline.reduce((total, row) => total + row.completedEvents, 0)),
        cents: metric(pipeline.reduce((total, row) => total + (row.cents ?? 0), 0), pipeline.some(row => row.cents === null) ? ["amount_missing"] : []) },
    ezcater: { orders: value(ezOrders), cents: value(ezCents, moneyReasons), averageTicket: share(ezCents, ezOrders, moneyReasons),
      largeOrders: ez.reduce((total, row) => total + row.largeOrders, 0), reconciliation },
  };
}

export interface TapDay { day: string; storeKey: string; adCode: string; active: boolean; clickCount: number }
/** Used only for instant-valued source data; RPC day_et dates must remain dates. */
export const tapEtDay = (instant: string): string => etCalendarDate(instant);
export function computeOrderTaps(input: { window: DateWindow; installed: boolean; counterOn: string | null;
  rows: readonly TapDay[]; storeKeys: readonly string[] }) {
  const days = windowDays(input.window);
  const stores = new Set(input.storeKeys);
  const rows = input.rows.filter(row => stores.has(row.storeKey) && inside(row.day, input.window)
    && input.counterOn !== null && row.day >= input.counterOn);
  const groups = new Map<string, { storeKey: string; adCode: string; active: boolean; clickCount: number }>();
  for (const row of rows) {
    const key = JSON.stringify([row.storeKey, row.adCode]);
    const group = groups.get(key) ?? { storeKey: row.storeKey, adCode: row.adCode, active: row.active, clickCount: 0 };
    group.clickCount += row.clickCount;
    groups.set(key, group);
  }
  const state = (count: number): Metric => !input.installed ? unavailable("counter_not_installed")
    : input.counterOn === null || input.window.to < input.counterOn ? unavailable("counter_off")
      : metric(count, days.some(day => day < input.counterOn!) ? ["counter_off"] : []);
  return { total: state(rows.reduce((total, row) => total + row.clickCount, 0)),
    coded: state(rows.filter(row => row.adCode !== "unattributed").reduce((total, row) => total + row.clickCount, 0)), groups: [...groups.values()] };
}

/** null means not entered; explicit zero is a real observation. Spend is all shops. */
export const manualMetric = (value: number | null): Metric => value === null ? unavailable("not_entered") : metric(value);
export function costPerTap(metaSpend: Metric, codedTaps: Metric): Metric {
  if (metaSpend.value === null || codedTaps.value === null) return { state: "unavailable", value: null, reasons: [...new Set([...reasonsOf(metaSpend), ...reasonsOf(codedTaps)])] };
  if (codedTaps.value <= 0) return unavailable("zero_denominator");
  return metric(metaSpend.value / codedTaps.value, [...reasonsOf(metaSpend), ...reasonsOf(codedTaps)]);
}
export function costPerExtraDirectOnlineOrder(metaSpend: Metric, weekOrdersPerDay: Metric,
  baselineOrdersPerDay: Metric | null, completeWeek: boolean): Metric {
  if (!completeWeek) return unavailable("incomplete_week");
  if (baselineOrdersPerDay === null) return unavailable("no_baseline");
  const inputs = [metaSpend, weekOrdersPerDay, baselineOrdersPerDay];
  if (inputs.some(input => input.value === null)) return { state: "unavailable", value: null, reasons: [...new Set(inputs.flatMap(reasonsOf))] };
  const lift = (weekOrdersPerDay.value! - baselineOrdersPerDay.value!) * 7;
  if (lift <= 0) return unavailable("no_lift");
  return metric(metaSpend.value! / lift, inputs.flatMap(reasonsOf));
}
export function baselineWeeklyAverage(total: Metric): Metric {
  return total.value === null ? total : metric(total.value / 4, reasonsOf(total));
}
/** A live/snapshot discrepancy is meaningful above $1 OR 0.1 percentage point. */
export function baselineDrift(liveCents: number, snapshotCents: number, liveShare: number, snapshotShare: number): boolean {
  return Math.abs(liveCents - snapshotCents) > 100 || Math.abs(liveShare - snapshotShare) > 0.001 + Number.EPSILON;
}

/**
 * Digest v2 — the management summary (Juan, 2026-10-08: "the digest is the summary the upper
 * management gets so they don't have to drill down into the app"). PURE: facts in, numbers out,
 * zero I/O, client-safe. The server loader (lib/report-digests-v2.ts) reads; the composer
 * (lib/report-digests-v2-compose.ts) writes the words.
 *
 * Three laws every function here keeps:
 *   - UNKNOWN IS NEVER ZERO. A source that does not exist or a day with no completed capture is
 *     `unavailable`; a failed read is `error`; only a real empty day is an empty list.
 *   - THE NIGHTLY DESCRIBES DAY D AND LOOKS AT D+1 (CC correction 10-08): deliveries due, order
 *     cutoffs and catering are about TOMORROW; everything else is the business day that ended.
 *   - REUSE THE HOUSE RULES. Net sales = `capturedDayPulse` (the pulse's rules); cutoff tiebreak
 *     = `cutoffForOrderDay`; the clear rule for a cutoff = an order at or beyond `confirmed`.
 */
import { capturedDayPulse, type PulseCapturedOrder } from "@/lib/toast/capture-pulse-shared";
import { pctDelta } from "@/lib/midshift-sales-shared";
import { cutoffForOrderDay, cutoffMinutes, type CutoffRow, type RhythmRow, type RhythmSkip } from "@/lib/vendor-rhythm-shared";
import { etDayFromDate } from "@/lib/et-day-shared";
import { addDays, etClock, etWallTime } from "@/lib/report-digests-shared";
import type { LaborSummary } from "@/lib/toast/labor-shared";
import type { NotInToastOrder } from "@/lib/catering/not-in-toast-shared";

/** A loaded area: the value, a source that is not there (yet), or a read that failed. */
export type Loaded<T> = { kind: "ok"; value: T } | { kind: "unavailable"; reason: string } | { kind: "error" };
export const ok = <T,>(value: T): Loaded<T> => ({ kind: "ok", value });
export const unavailable = <T,>(reason: string): Loaded<T> => ({ kind: "unavailable", reason });
export const failed = <T,>(): Loaded<T> => ({ kind: "error" });

/** The ET calendar day of an instant. */
export function etDayOf(iso: string): string {
  return etClock(new Date(iso)).day;
}

/** The lookahead day of a nightly digest for business day `day`: D + 1 in America/New_York. */
export function lookaheadDay(day: string): string {
  return addDays(day, 1);
}

// ── 1 + 6. Sales (Toast capture) ─────────────────────────────────────────────────────────────

export interface SalesOrderInput extends PulseCapturedOrder { snapshotId: string }
export interface SalesDiscountRow { snapshotId: string; checkGuid: string; name: string | null; amountCents: number | null }

/** One captured day as the loader hands it over. */
export interface SalesSummaryInput { orders: SalesOrderInput[]; discounts: SalesDiscountRow[]; configDegraded: boolean }

export interface SalesDaySummary {
  netCents: number;
  checks: number;
  avgCheckCents: number | null;
  /** Net on orders whose REVIEWED channel is third_party (Uber Eats, DoorDash, Grubhub…). */
  thirdPartyCents: number;
  thirdPartySharePct: number | null;
  /** Net by reviewed channel, largest first; `null` channel = an unmapped dining option. */
  channels: Array<{ channel: string | null; netCents: number; checks: number }>;
  /** Top-level live selections by units (capture selections carry no price — $ per item is not available). */
  topItems: Array<{ name: string; units: number }>;
  discounts: Array<{ name: string | null; count: number; cents: number }>;
  voids: { orders: number; checks: number; units: number };
  /** An unreviewed or missing dining-option label touched the day (partial channel data). */
  configDegraded: boolean;
}

/** Same exclusions as capturedDayPulse: deleted / voided / excess-food orders and gift cards. */
function countedOrder(o: PulseCapturedOrder): boolean {
  return !(o.deleted || o.voided || o.excessFood || o.salesChannel === "gift_card");
}

/**
 * One day's sales from captured orders. The headline net and check count come from
 * `capturedDayPulse` itself (it THROWS capture_pulse_amount_missing on a live check with no
 * amount — the caller turns that into "not available", never $0).
 */
export function summarizeSalesDay(date: string, orders: readonly SalesOrderInput[], discounts: readonly SalesDiscountRow[], configDegraded: boolean, topN = 10): SalesDaySummary {
  const pulse = capturedDayPulse(date, orders).aggregate;
  const byChannel = new Map<string | null, { netCents: number; checks: number }>();
  const items = new Map<string, number>();
  const liveChecks = new Set<string>();
  let thirdPartyCents = 0;
  const voids = { orders: 0, checks: 0, units: 0 };
  for (const o of orders) {
    if (o.deleted) continue;
    if (o.voided) { voids.orders += 1; continue; }
    if (!countedOrder(o)) continue;
    const live = new Set<string>();
    for (const c of o.checks) {
      if (c.deleted) continue;
      if (c.voided) { voids.checks += 1; continue; }
      live.add(c.checkGuid);
      liveChecks.add(`${o.snapshotId}|${c.checkGuid}`);
      const ch = byChannel.get(o.salesChannel ?? null) ?? { netCents: 0, checks: 0 };
      ch.netCents += c.amountCents ?? 0;
      ch.checks += 1;
      byChannel.set(o.salesChannel ?? null, ch);
      if (o.salesChannel === "third_party") thirdPartyCents += c.amountCents ?? 0;
    }
    for (const s of o.selections) {
      if (s.parent_selection_guid !== null || s.deleted || !live.has(s.check_guid)) continue;
      if (s.voided) { voids.units += s.quantity; continue; }
      items.set(s.name, (items.get(s.name) ?? 0) + s.quantity);
    }
  }
  const disc = new Map<string, { name: string | null; count: number; cents: number }>();
  for (const d of discounts) {
    if (!liveChecks.has(`${d.snapshotId}|${d.checkGuid}`)) continue;
    const key = d.name?.trim() || "";
    const row = disc.get(key) ?? { name: d.name?.trim() || null, count: 0, cents: 0 };
    row.count += 1;
    row.cents += d.amountCents ?? 0;
    disc.set(key, row);
  }
  return {
    netCents: pulse.netCents,
    checks: pulse.checks,
    avgCheckCents: pulse.avgTicketCents,
    thirdPartyCents,
    thirdPartySharePct: pulse.netCents > 0 ? Math.round((thirdPartyCents / pulse.netCents) * 100) : null,
    channels: [...byChannel].map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.netCents - a.netCents || String(a.channel).localeCompare(String(b.channel))),
    topItems: [...items].map(([name, units]) => ({ name, units }))
      .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name)).slice(0, topN),
    discounts: [...disc.values()].sort((a, b) => b.cents - a.cents || String(a.name).localeCompare(String(b.name))),
    voids,
    configDegraded,
  };
}

/** Day D vs the same weekday a week earlier, whole percent (null when uncomparable). */
export function salesDeltaPct(today: SalesDaySummary, lastWeek: SalesDaySummary | null): number | null {
  return lastWeek ? pctDelta(today.netCents, lastWeek.netCents) : null;
}

export interface SalesFacts {
  today: SalesDaySummary;
  /** null = no completed capture for D-7 (the delta is then said to be unavailable). */
  lastWeek: SalesDaySummary | null;
}

// ── 1 + 7. Catering money (0195 split) and tomorrow ──────────────────────────────────────────

export interface CateringNightFacts {
  /** Unlinked ezCater orders for D+1 at this shop, captured at compose time. */
  toRingInToast?: NotInToastOrder[];
  /** Events dated D at the shop: the 0195 split by real stage. Never added to POS net. */
  day: { orders: number; completedCents: number; confirmedCents: number };
  /** Booked (confirmed/out) for D+1. */
  tomorrow: Array<{ id: string; name: string; timeWindow: string | null; headcount: number | null; isDelivery: boolean }>;
}

// ── 2. Ordering ──────────────────────────────────────────────────────────────────────────────

export interface PoFact {
  id: string; displayCode: string; vendorId: string; status: string;
  createdAt: string; confirmedAt: string | null; placedAt: string | null;
  placedByName: string | null;
  /** Σ qty × price at order; null when NO line has a price. */
  totalCents: number | null;
  /** Lines with no price yet (a draft has none until Confirm). */
  unpricedLines: number;
}
export interface VendorFact { id: string; name: string; sourceKind: "vendor" | "store"; active: boolean }
export interface VendorCutoff extends CutoffRow { vendorId: string }
export interface WalkFact { eventId: string; walkedAt: string }
export interface WalkLineFact { eventId: string; skuId: string; vendorId: string | null; orderQty: number; parQty: number | null; impliedOnHandOz: number | null; skuName: string }

/**
 * The LATEST observation per SKU across a set of walks (Astra r2 P2): a 09:00 walk that finds a
 * SKU stocked clears the 07:00 walk that found it short. A SKU a later walk did not cover (a
 * partial walk) keeps its earlier observation. Ties on the walk instant break on event id.
 */
export function latestPerSku(walks: readonly WalkFact[], lines: readonly WalkLineFact[]): WalkLineFact[] {
  const at = new Map(walks.map((w) => [w.eventId, Date.parse(w.walkedAt)]));
  const latest = new Map<string, WalkLineFact>();
  for (const l of lines) {
    const t = at.get(l.eventId);
    if (t === undefined) continue;
    const prev = latest.get(l.skuId);
    const pt = prev ? at.get(prev.eventId)! : -Infinity;
    if (!prev || t > pt || (t === pt && l.eventId > prev.eventId)) latest.set(l.skuId, l);
  }
  return [...latest.values()];
}

export interface OrderingInput {
  day: string;
  locationId: string;
  now: Date;
  /** POs at the shop: created D-1..D+1, plus every still-open one (bounded by the loader). */
  pos: readonly PoFact[];
  vendors: readonly VendorFact[];
  cutoffs: readonly VendorCutoff[];
  walks: readonly WalkFact[];
  walkLines: readonly WalkLineFact[];
  rhythm: readonly RhythmRow[];
  skips: ReadonlyArray<RhythmSkip>;
  /** POs a delivery was recorded against (vendor_deliveries.purchase_order_id). */
  receivedPoIds: ReadonlySet<string>;
}

const AT_OR_BEYOND_CONFIRMED = new Set(["confirmed", "placed", "invoiced", "received", "reconciled"]);
const OPEN_ORDER = new Set(["confirmed", "placed", "invoiced"]);
const DAY_MS = 86_400_000;

/** The instant a vendor's governing cutoff falls on ET day `day` at the shop, or null. */
export function cutoffInstant(cutoffs: readonly VendorCutoff[], vendorId: string, locationId: string, day: string): { time: string; at: Date } | null {
  // Another shop's row never governs here (cutoffForOrderDay falls back to ANY row on the dow).
  const rows = cutoffs.filter((c) => c.vendorId === vendorId && (c.locationId === null || c.locationId === locationId));
  const time = cutoffForOrderDay(rows, locationId, etDayFromDate(day).dow);
  const mins = time === null ? null : cutoffMinutes(time);
  return time === null || mins === null ? null : { time, at: etWallTime(day, mins) };
}

export interface MissedCutoff { vendorId: string; vendorName: string; cutoffTime: string; suggestedLines: number }
export interface OrderingDay {
  placed: PoFact[];
  /** Drafts (and confirmed-but-never-sent orders) created on D. */
  unsent: PoFact[];
  /** Cutoff passed, no order at or beyond confirmed, and the walk suggested items. */
  missed: MissedCutoff[];
  /** Cutoff passed with no order and NO walk in the window — nothing proves it either way. */
  unverified: Array<{ vendorId: string; vendorName: string; cutoffTime: string }>;
  /** An order did go in for a cutoff, but after it. */
  late: Array<{ vendorId: string; vendorName: string; cutoffTime: string; displayCode: string }>;
}

/**
 * Day D's ordering. A cutoff's WINDOW is the 24 h before it: a walk or an order inside it belongs
 * to this cutoff (the evening walk before a morning cutoff), one before it belonged to the
 * previous order day's. A cutoff still in the future at `now` is not judged.
 */
export function orderingForDay(input: OrderingInput): OrderingDay {
  const { day, locationId, now } = input;
  const vendorName = new Map(input.vendors.map((v) => [v.id, v.name]));
  const placed = input.pos.filter((p) => p.placedAt !== null && etDayOf(p.placedAt) === day)
    .sort((a, b) => a.placedAt!.localeCompare(b.placedAt!));
  const unsent = input.pos.filter((p) => (p.status === "draft" || p.status === "confirmed") && etDayOf(p.createdAt) === day)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const missed: MissedCutoff[] = [];
  const unverified: OrderingDay["unverified"] = [];
  const late: OrderingDay["late"] = [];
  const dayEnd = etWallTime(addDays(day, 1), 0).getTime();
  for (const v of input.vendors) {
    if (v.sourceKind !== "vendor" || !v.active) continue;
    const cut = cutoffInstant(input.cutoffs, v.id, locationId, day);
    if (!cut || cut.at.getTime() > now.getTime()) continue;
    const from = cut.at.getTime() - DAY_MS;
    const orderedAt = (p: PoFact) => Date.parse(p.placedAt ?? p.confirmedAt ?? p.createdAt);
    const orders = input.pos.filter((p) => p.vendorId === v.id && AT_OR_BEYOND_CONFIRMED.has(p.status)
      && orderedAt(p) > from && orderedAt(p) < dayEnd);
    if (orders.some((p) => orderedAt(p) <= cut.at.getTime())) continue;
    const name = vendorName.get(v.id) ?? v.name;
    const after = orders.sort((a, b) => orderedAt(a) - orderedAt(b))[0];
    if (after) { late.push({ vendorId: v.id, vendorName: name, cutoffTime: cut.time, displayCode: after.displayCode }); continue; }
    const inWindow = input.walks.filter((w) => { const t = Date.parse(w.walkedAt); return t > from && t <= cut.at.getTime(); });
    if (inWindow.length === 0) { unverified.push({ vendorId: v.id, vendorName: name, cutoffTime: cut.time }); continue; }
    const suggested = latestPerSku(inWindow, input.walkLines.filter((l) => l.vendorId === v.id)).filter((l) => l.orderQty > 0).length;
    if (suggested > 0) missed.push({ vendorId: v.id, vendorName: name, cutoffTime: cut.time, suggestedLines: suggested });
  }
  const byTime = <T extends { cutoffTime: string; vendorName: string }>(a: T, b: T) => a.cutoffTime.localeCompare(b.cutoffTime) || a.vendorName.localeCompare(b.vendorName);
  return { placed, unsent, missed: missed.sort(byTime), unverified: unverified.sort(byTime), late: late.sort(byTime) };
}

export interface DeliveryDue { po: PoFact; vendorName: string; orderDay: string; deliveryDay: string }
export interface DeliveriesLookahead {
  /** Open orders whose truck lands on D+1 by the vendor's rhythm. */
  due: DeliveryDue[];
  /** Open orders whose truck was due before D+1 and has no delivery recorded. */
  overdue: DeliveryDue[];
  /** Open orders with no rhythm pair for their order day — no honest delivery date to state. */
  undated: Array<{ po: PoFact; vendorName: string }>;
}

/**
 * Deliveries due TOMORROW (D+1). An open order (confirmed / placed / invoiced, no delivery
 * recorded against it) lands on its order day + the rhythm's lead for that order day (the pair
 * the vendor page authors, 0182). A truck inside an active skip window is cancelled, not moved.
 */
export function deliveriesLookahead(input: Pick<OrderingInput, "day" | "locationId" | "pos" | "vendors" | "rhythm" | "skips" | "receivedPoIds">): DeliveriesLookahead {
  const tomorrow = lookaheadDay(input.day);
  const vendorName = new Map(input.vendors.map((v) => [v.id, v.name]));
  const out: DeliveriesLookahead = { due: [], overdue: [], undated: [] };
  for (const po of input.pos) {
    if (!OPEN_ORDER.has(po.status) || input.receivedPoIds.has(po.id)) continue;
    const name = vendorName.get(po.vendorId) ?? "—";
    const orderDay = etDayOf(po.placedAt ?? po.confirmedAt ?? po.createdAt);
    const pair = input.rhythm.find((r) => r.vendorId === po.vendorId && r.locationId === input.locationId && r.orderDow === etDayFromDate(orderDay).dow);
    if (!pair) { out.undated.push({ po, vendorName: name }); continue; }
    const deliveryDay = addDays(orderDay, pair.leadDays);
    if (input.skips.some((s) => s.vendorId === po.vendorId && deliveryDay >= s.skipFrom && deliveryDay <= s.skipThrough)) continue;
    const row = { po, vendorName: name, orderDay, deliveryDay };
    if (deliveryDay === tomorrow) out.due.push(row);
    else if (deliveryDay < tomorrow) out.overdue.push(row);
  }
  const sort = (a: { vendorName: string; po: PoFact }, b: { vendorName: string; po: PoFact }) => a.vendorName.localeCompare(b.vendorName) || a.po.displayCode.localeCompare(b.po.displayCode);
  out.due.sort(sort); out.overdue.sort(sort); out.undated.sort(sort);
  return out;
}

export interface CutoffTomorrow { vendorId: string; vendorName: string; cutoffTime: string; hasDraft: boolean; ordered: boolean }

/**
 * Order cutoffs TOMORROW (D+1): every active regular vendor whose governing cutoff falls on
 * dow(D+1) at this shop, earliest first, with whether a draft is waiting (a draft created on D or
 * D+1) or an order is already in (at or beyond confirmed, inside the cutoff's 24 h window).
 */
export function cutoffsTomorrow(input: Pick<OrderingInput, "day" | "locationId" | "pos" | "vendors" | "cutoffs">): CutoffTomorrow[] {
  const tomorrow = lookaheadDay(input.day);
  const out: CutoffTomorrow[] = [];
  for (const v of input.vendors) {
    if (v.sourceKind !== "vendor" || !v.active) continue;
    const cut = cutoffInstant(input.cutoffs, v.id, input.locationId, tomorrow);
    if (!cut) continue;
    const mine = input.pos.filter((p) => p.vendorId === v.id);
    const hasDraft = mine.some((p) => p.status === "draft" && (etDayOf(p.createdAt) === input.day || etDayOf(p.createdAt) === tomorrow));
    const ordered = mine.some((p) => AT_OR_BEYOND_CONFIRMED.has(p.status) && Date.parse(p.placedAt ?? p.confirmedAt ?? p.createdAt) > cut.at.getTime() - DAY_MS);
    out.push({ vendorId: v.id, vendorName: v.name, cutoffTime: cut.time, hasDraft, ordered });
  }
  return out.sort((a, b) => a.cutoffTime.localeCompare(b.cutoffTime) || a.vendorName.localeCompare(b.vendorName));
}

// ── 3. Receiving ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryFact {
  id: string; vendorId: string; vendorName: string; sourceKind: "vendor" | "store";
  /** invoice_total (dollars → cents), else Σ qty × unit price, else null. */
  cents: number | null;
  matchState: string; hasReceipt: boolean; poDisplayCode: string | null;
  discrepancies: { short: number; over: number; damaged: number; substitution: number };
}
export interface CreditFact { vendorName: string; reason: string; amountCents: number | null }
export interface ReceivingFacts {
  deliveries: DeliveryFact[];
  credits: CreditFact[];
  /** Unlinked inbound invoices at the shop waiting for a manager. */
  invoicesPendingReview: number;
}

/** Dollars as stored (numeric/string) → integer cents, or null. */
export function dollarsToCents(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Σ cents where known; `unknown` counts the rows that had none (never treated as $0). */
export function sumKnown(values: ReadonlyArray<number | null>): { cents: number; unknown: number } {
  let cents = 0; let unknown = 0;
  for (const v of values) { if (v === null) unknown += 1; else cents += v; }
  return { cents, unknown };
}

// ── 4. Inventory ─────────────────────────────────────────────────────────────────────────────

export interface InventoryFacts {
  /** The day's walk (submitted par passes on D); null = no walk on D. */
  walk: { walks: number; belowPar: Array<{ name: string }>; out: Array<{ name: string }> } | null;
  /** Prep tossed on D, grouped by item + unit, largest first. */
  waste: Array<{ name: string; qty: number; unit: string | null }>;
  /** Store-run receipts on D (vendors.source_kind = store); unknownCents counts runs with no $. */
  storeRuns: { runs: number; cents: number; unknownCents: number };
}

/** The walk lines of D's walks → below par (order suggested) and out (implied on hand 0). */
export function walkSnapshot(walks: readonly WalkFact[], lines: readonly WalkLineFact[]): InventoryFacts["walk"] {
  if (walks.length === 0) return null;
  const mine = latestPerSku(walks, lines);
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
  return {
    walks: walks.length,
    belowPar: uniq(mine.filter((l) => l.orderQty > 0).map((l) => l.skuName)),
    out: uniq(mine.filter((l) => l.impliedOnHandOz === 0).map((l) => l.skuName)),
  };
}

/** Toss rows → grouped by (name, unit), largest quantity first. */
export function groupWaste(rows: ReadonlyArray<{ name: string; qty: number; unit: string | null }>): InventoryFacts["waste"] {
  const m = new Map<string, { name: string; qty: number; unit: string | null }>();
  for (const r of rows) {
    if (!(r.qty > 0)) continue;
    const key = `${r.name}|${r.unit ?? ""}`;
    const g = m.get(key) ?? { name: r.name, qty: 0, unit: r.unit };
    g.qty += r.qty;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

// ── 8. People ────────────────────────────────────────────────────────────────────────────────

export interface PeopleFacts {
  retrains: { assignedToday: number; open: number };
}

// ── The bundle the composer reads ────────────────────────────────────────────────────────────

export interface ShopV2Facts {
  /** D + 1 (America/New_York). */
  lookahead: string;
  sales: Loaded<SalesFacts>;
  catering: Loaded<CateringNightFacts>;
  ordering: Loaded<{ day: OrderingDay; deliveries: DeliveriesLookahead; cutoffsTomorrow: CutoffTomorrow[]; vendorNames: Record<string, string> }>;
  receiving: Loaded<ReceivingFacts>;
  inventory: Loaded<InventoryFacts>;
  people: Loaded<PeopleFacts>;
  /** Toast time entries for D (0224). Absent = labor not loaded on this branch of the build. */
  labor?: Loaded<LaborSummary>;
}

/** How many shops an aggregate covers: a shop whose area failed or is unavailable is NOT a zero. */
export interface Coverage { covered: number; total: number }

/**
 * The all-shop totals the level-8+ unified digest adds (Astra r2 P2). EVERY aggregate carries its
 * coverage — the composer renders "not available" when no shop is covered and "partial (1 of 2
 * shops)" when some are — and every money sum carries the count of rows whose amount is unknown.
 * A failed read never becomes an authoritative $0 / 0.
 */
export interface AllShopTotals {
  shops: number;
  sales: Coverage & { netCents: number; checks: number; thirdPartyCents: number; lastWeekCents: number | null };
  catering: Coverage & { completedCents: number; confirmedCents: number };
  ordering: Coverage & { placed: number; placedCents: number; unpriced: number; missed: number; dueTomorrow: number };
  receiving: Coverage & { deliveries: number; cents: number; unknownCents: number };
}

export function allShopTotals(shops: ReadonlyArray<ShopV2Facts | undefined>): AllShopTotals {
  const total = shops.length;
  const t: AllShopTotals = {
    shops: total,
    sales: { covered: 0, total, netCents: 0, checks: 0, thirdPartyCents: 0, lastWeekCents: 0 },
    catering: { covered: 0, total, completedCents: 0, confirmedCents: 0 },
    ordering: { covered: 0, total, placed: 0, placedCents: 0, unpriced: 0, missed: 0, dueTomorrow: 0 },
    receiving: { covered: 0, total, deliveries: 0, cents: 0, unknownCents: 0 },
  };
  let lastWeekComplete = true;
  for (const s of shops) {
    if (!s) continue;
    if (s.sales.kind === "ok") {
      t.sales.covered += 1;
      t.sales.netCents += s.sales.value.today.netCents;
      t.sales.checks += s.sales.value.today.checks;
      t.sales.thirdPartyCents += s.sales.value.today.thirdPartyCents;
      if (s.sales.value.lastWeek) t.sales.lastWeekCents! += s.sales.value.lastWeek.netCents; else lastWeekComplete = false;
    }
    if (s.catering.kind === "ok") {
      t.catering.covered += 1;
      t.catering.completedCents += s.catering.value.day.completedCents;
      t.catering.confirmedCents += s.catering.value.day.confirmedCents;
    }
    if (s.ordering.kind === "ok") {
      t.ordering.covered += 1;
      const placed = s.ordering.value.day.placed;
      const money = sumKnown(placed.map((p) => p.totalCents));
      t.ordering.placed += placed.length;
      t.ordering.placedCents += money.cents;
      t.ordering.unpriced += money.unknown + placed.filter((p) => p.totalCents !== null && p.unpricedLines > 0).length;
      t.ordering.missed += s.ordering.value.day.missed.length;
      t.ordering.dueTomorrow += s.ordering.value.deliveries.due.length;
    }
    if (s.receiving.kind === "ok") {
      t.receiving.covered += 1;
      const regular = s.receiving.value.deliveries.filter((d) => d.sourceKind === "vendor");
      const money = sumKnown(regular.map((d) => d.cents));
      t.receiving.deliveries += regular.length;
      t.receiving.cents += money.cents;
      t.receiving.unknownCents += money.unknown;
    }
  }
  // A combined week-over-week delta needs EVERY covered shop's last week; partial would mislead.
  if (!lastWeekComplete || t.sales.covered === 0 || t.sales.covered < total) t.sales.lastWeekCents = null;
  return t;
}

/**
 * Catering morning digest additions (Juan, 2026-10-08: "maybe staff scheduled for that day, how
 * inventory is doing for the coming up catering"). PURE, zero I/O, client-safe.
 *
 *   - LOGISTICS: ready-by time (the stored handoff time; there is no separate prep-ready column),
 *     special instructions lifted from the machine notes only, payment status.
 *   - INVENTORY READINESS: today's reserved W4a demand flattened to SKUs by the W4b core
 *     (deriveCateringSkuDemand) against its advisory on-hand; a SKU never counted at the shop says
 *     "on hand not counted yet" instead of a number — stock is never invented.
 *   - STAFF: today's station assignments / claims (stations module) behind a StaffSource seam; the
 *     schedule itself is "not connected" until a schedule source (7shifts) is wired.
 */
import { orderedStationEvents, type StationEvent } from "@/lib/assignments-shared";

/**
 * The customer's special instructions, from the MACHINE lines only (a human's free notes may hold
 * anything and never reach an email): Toast's `Special request: "…"` lines and ezCater's per-item
 * ` — "…"` suffix. Order kept, duplicates dropped, each capped.
 */
export function specialInstructions(notes: string | null | undefined, max = 4): string[] {
  if (!notes) return [];
  const out: string[] = [];
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    const toast = /^Special request:\s*"(.+)"$/.exec(line);
    const ez = /^•\s.*\s—\s"(.+)"$/.exec(line);
    const text = (toast?.[1] ?? ez?.[1])?.trim();
    if (text && !out.includes(text)) out.push(text.length > 140 ? `${text.slice(0, 139)}…` : text);
  }
  return out.slice(0, max);
}

export type PaymentState =
  | { kind: "platform" }
  | { kind: "paid"; cents: number }
  | { kind: "due"; cents: number }
  | { kind: "none" };

/**
 * Payment status for an order: a platform order (ezCater / Toast) is paid on the platform; else the
 * accepted quote's payment rows decide (any due row → due; otherwise paid rows → paid).
 */
export function paymentState(leadSource: string | null, payments: ReadonlyArray<{ status: string; amountCents: number }>): PaymentState {
  if (leadSource === "ezcater" || leadSource === "toast_catering") return { kind: "platform" };
  const due = payments.filter((p) => p.status === "due").reduce((a, p) => a + p.amountCents, 0);
  if (due > 0) return { kind: "due", cents: due };
  const paid = payments.filter((p) => p.status === "paid").reduce((a, p) => a + p.amountCents, 0);
  return paid > 0 ? { kind: "paid", cents: paid } : { kind: "none" };
}

// ── Inventory readiness ──────────────────────────────────────────────────────────────────────

export interface ReadinessRow {
  skuName: string;
  needOz: number;
  /** Advisory on-hand (received − used); null when the SKU was never counted here or has no pack size. */
  onHandOz: number | null;
  shortOz: number | null;
  orderPacks: number | null;
  counted: boolean;
}
export interface CateringReadiness {
  rows: ReadinessRow[];
  /** Choice slots (customer picks) — cannot be flattened to SKUs until chosen. */
  unresolvedChoiceLines: number;
  /** Item / sub refs with no (complete) recipe. */
  noRecipeLines: number;
}

/**
 * The W4b rows → readiness. A SKU with no count EVER at the shop keeps its need and loses its
 * on-hand number (the advisory received − used is not a count, and before the first physical count
 * it would be a guess dressed as stock).
 */
export function readinessFrom(
  w4b: { rows: ReadonlyArray<{ skuName: string; skuId: string; totalOz: number; onHandOz: number | null; shortfallOz: number | null; suggestOrderPacks: number | null }>; unresolvedChoiceLines: number; noRecipeLines: number },
  countedSkuIds: ReadonlySet<string>,
): CateringReadiness {
  return {
    rows: w4b.rows.map((r) => {
      const counted = countedSkuIds.has(r.skuId);
      return {
        skuName: r.skuName, needOz: r.totalOz, counted,
        onHandOz: counted ? r.onHandOz : null,
        shortOz: counted ? r.shortfallOz : null,
        orderPacks: counted ? r.suggestOrderPacks : null,
      };
    }).sort((a, b) => Number((b.shortOz ?? 0) > 0) - Number((a.shortOz ?? 0) > 0) || a.skuName.localeCompare(b.skuName)),
    unresolvedChoiceLines: w4b.unresolvedChoiceLines,
    noRecipeLines: w4b.noRecipeLines,
  };
}

// ── Staff (the schedule seam) ────────────────────────────────────────────────────────────────

export interface StaffOnStation { firstName: string; station: string; source: "assigned" | "claimed" }
export interface StaffRoster {
  /** Where the names came from. "stations" until a schedule source is connected. */
  source: "stations";
  /** A real schedule (7shifts) is not connected yet; the digest says so. */
  scheduleConnected: false;
  onStation: StaffOnStation[];
}
/**
 * THE SEAM. A schedule source answers "who works at this shop today". Today the only source is the
 * stations module (assignments + claims); 7shifts plugs in here later with its own `source`.
 */
export interface StaffSource {
  roster(locationId: string, businessDate: string): Promise<StaffRoster>;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** One shop/day's station events → who is on which station now (the latest event per person). */
export function stationRoster(
  events: readonly StationEvent[],
  people: ReadonlyMap<string, string>,
  stations: ReadonlyMap<string, string>,
): StaffOnStation[] {
  const latest = new Map<string, StationEvent>();
  for (const e of orderedStationEvents(events)) latest.set(e.userId, e);
  const out: StaffOnStation[] = [];
  for (const e of latest.values()) {
    if (!e.stationId || !e.source) continue;
    out.push({ firstName: firstName(people.get(e.userId) ?? "—"), station: stations.get(e.stationId) ?? "—", source: e.source });
  }
  return out.sort((a, b) => a.station.localeCompare(b.station) || a.firstName.localeCompare(b.firstName));
}

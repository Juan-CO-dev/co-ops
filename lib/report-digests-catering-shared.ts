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
  /** The COUNT-ANCHORED on-hand in oz (last census count + received − consumed since, all in oz);
   *  null when the SKU has no valid count-anchored balance at the shop. */
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
 * The count-anchored balance per SKU from the counts reader's rows (deriveOnHand, the same family
 * as the counts / variance surface): ONLY a weight row anchored by a real census count with a
 * derivable balance qualifies. A par-estimate or inferred anchor, a count-dimension (units) row, or
 * a null balance is NOT a balance in oz, so the SKU reads "on hand not counted yet".
 */
export function countAnchoredBalances(rows: ReadonlyArray<{ skuId: string; dimension: string; anchorSource?: string | null; onHandOz?: number | null }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.dimension !== "weight" || r.anchorSource !== "census" || r.onHandOz == null || !Number.isFinite(r.onHandOz)) continue;
    out.set(r.skuId, r.onHandOz);
  }
  return out;
}

/**
 * W4b DEMAND (oz per SKU, the flatten) + the count-anchored BALANCE → readiness. The W4b stock side
 * (loadInStockPacks: packs received minus entered quantities, unit-mixed) is deliberately NOT read —
 * 10 cases received and 64 oz used is not -54 of anything (Astra r2 P2).
 */
export function readinessFrom(
  w4b: { rows: ReadonlyArray<{ skuName: string; skuId: string; totalOz: number; contentOz: number | null }>; unresolvedChoiceLines: number; noRecipeLines: number },
  balances: ReadonlyMap<string, number>,
): CateringReadiness {
  return {
    rows: w4b.rows.map((r) => {
      const onHand = balances.get(r.skuId);
      if (onHand === undefined) return { skuName: r.skuName, needOz: r.totalOz, counted: false, onHandOz: null, shortOz: null, orderPacks: null };
      const shortOz = Math.max(0, r.totalOz - Math.max(0, onHand));
      return {
        skuName: r.skuName, needOz: r.totalOz, counted: true, onHandOz: onHand, shortOz,
        orderPacks: shortOz > 0 && r.contentOz && r.contentOz > 0 ? Math.ceil(shortOz / r.contentOz) : null,
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

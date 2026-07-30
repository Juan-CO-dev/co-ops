/**
 * Manager physical-count math — PURE (client-safe, zero I/O, no server imports;
 * fully unit-testable). The `*-shared.ts` pattern (AGENTS.md): the counts server
 * lib (lib/counts.ts) and its vitest suite both import from here.
 *
 * Juan's model — RECEIVING FEEDS, COUNTS VERIFY, THE DIFFERENCE IS VARIANCE:
 *   on-hand(sku) = anchor  +  received_since_anchor  −  consumed_since_anchor
 *   where anchor = the latest active count EVENT's summed resolved oz for that SKU
 *   (the manager's ground-truth snapshot), and the two "since" terms are derived
 *   from the ledgers (receiving lines / live productions) — all IN OZ (council A3:
 *   oz kills the mixed-unit class). VARIANCE = the newest count minus what the
 *   PREVIOUS count + intervening ledger activity PREDICTED — i.e. what the count
 *   verified against the derived expectation. A reason code (waste / over-portion
 *   / uncounted / unknown) annotates the delta; the code itself is a display seam
 *   kept simple on the count note.
 *
 * ── COUNCIL L5 (counts) ────────────────────────────────────────────────────────
 * One count EVENT per session/location; lines are DISJOINT BY LAW (full containers
 * + loose-below + a partial-container annotation). Each line resolves oz at write
 * (L3) and the event's anchor is the SUM of its line oz per SKU. Anchor age is
 * surfaced; a ledger row dated between the anchor and now flags the anchor STALE
 * (retro-edit awareness) — computed here, not stored.
 *
 * ── COUNCIL L8 (shrinkage) ──────────────────────────────────────────────────────
 * The shrinkage delta (count vs derived) is exactly the variance term below,
 * surfaced with a reason code.
 *
 * Everything returns null rather than guessing when an input is missing (A3):
 * a null drift is an ADVISORY, never a fabricated number.
 */

import {
  buildPackChain,
  walkChainToOz,
  chainLeafUnitsFrom,
  chainCountLeafMeasure,
  type PackChainLevel,
} from "@/lib/pack-chain-shared";
import { ozForRecipeInput, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";

/** A count line as entered by the manager, before oz resolution. */
export interface CountLineInput {
  skuId: string;
  /** Chain level (or a legacy pack/measure label) this line is counted at. */
  levelLabel: string;
  qty: number;
  /** Disjoint-by-law (L5): a loose unit below a full container. */
  isLoose: boolean;
  /** A partially-consumed container: 0 < f <= 1. null = a whole container. */
  partialFraction: number | null;
}

/** Reason-code display seam for a variance/shrinkage delta (L8). Kept simple. */
export type CountVarianceReason = "waste" | "over_portion" | "uncounted" | "unknown";
export const COUNT_VARIANCE_REASONS: readonly CountVarianceReason[] = [
  "waste",
  "over_portion",
  "uncounted",
  "unknown",
] as const;

/** Why a count line could not resolve to oz. */
export type CountLineOzFailure = "bad_qty" | "bad_fraction" | "unresolvable";
/** Result of resolving ONE count line to oz-at-write. */
export type CountLineOzResult =
  | { ok: true; oz: number }
  | { ok: false; reason: CountLineOzFailure };

/**
 * Resolve one count line to oz (council L3, resolved at write). The base oz for
 * `qty` at `levelLabel` is walked through the SKU's chain (ozForRecipeInput —
 * pointer-directed; unchained SKUs resolve via the legacy/measure path). A
 * partial_fraction (a partly-used container) scales the WHOLE line: a fraction
 * only makes sense on a single container, so callers set qty=1 + partialFraction=f
 * for "half a tub". is_loose does NOT change the math — it is the disjointness
 * annotation (full vs loose) so the anchor never double-counts; the loose qty is
 * a real count at the loose level. Returns a typed failure (never a wrong number)
 * on a bad qty/fraction or an unresolvable level.
 */
export function resolveCountLineOz(
  line: Pick<CountLineInput, "levelLabel" | "qty" | "partialFraction">,
  sku: RecipeInputSku,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): CountLineOzResult {
  // F3: a count line requires a POSITIVE qty — a zero-qty line counts nothing and
  // can't anchor. (The migration CHECK is qty >= 0 for schema tolerance; the app
  // is the authority for count semantics.)
  if (!Number.isFinite(line.qty) || line.qty <= 0) return { ok: false, reason: "bad_qty" };
  if (line.partialFraction != null && !(line.partialFraction > 0 && line.partialFraction <= 1)) {
    return { ok: false, reason: "bad_fraction" };
  }
  const base = ozForRecipeInput(line.qty, line.levelLabel, sku, measuresByLabel);
  if (base == null || !Number.isFinite(base)) return { ok: false, reason: "unresolvable" };
  const frac = line.partialFraction ?? 1;
  const oz = base * frac;
  return Number.isFinite(oz) && oz >= 0 ? { ok: true, oz } : { ok: false, reason: "unresolvable" };
}

// ── Dimension-aware resolution (SKU top-tier PR-C, LOCK 4) ──────────────────────
// A count line anchors in ONE of two spaces:
//   - WEIGHT: the entered level is oz-resolvable → resolved_oz (as today).
//   - COUNT: the chain terminates in a COUNT measure (packaging/cleaning/misc,
//     no honest ounce) → resolved_units in LEAF units, resolved_oz NULL.
// resolveCountLineOz above is the weight path (unchanged). resolveCountLineDim
// below tries weight FIRST, then falls back to count-space — so a raw oz chain is
// always weight-anchored and only a genuinely non-oz-resolvable count-terminated
// chain anchors in count-space. A line that is neither is unresolvable (rejected).

/** A count line resolved to its anchoring dimension. */
export type CountLineDimResult =
  | { ok: true; dimension: "weight"; oz: number }
  | { ok: true; dimension: "count"; units: number }
  | { ok: false; reason: CountLineOzFailure };

/**
 * Resolve one count line to its anchoring dimension (PR-C). Weight FIRST (an
 * oz-resolvable chain — raw SKUs — always anchors in oz, unchanged behavior); if
 * the line can't reach ounces, try COUNT-space: when the SKU's chain terminates in
 * a registered COUNT measure and the entered level is a chain label, resolve to
 * LEAF UNITS = qty × leafUnitsFrom(level) × partialFraction. A partial fraction on
 * a count line scales the leaf-unit total the same way it scales oz (half a
 * container of loose units = half its leaf-unit content). Anything else is
 * unresolvable — the write path rejects it loudly (a count line with no anchor
 * can't verify stock). PURE.
 */
export function resolveCountLineDim(
  line: Pick<CountLineInput, "levelLabel" | "qty" | "partialFraction">,
  sku: RecipeInputSku,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): CountLineDimResult {
  // Weight path first (byte-identical to today for oz-resolvable chains).
  const oz = resolveCountLineOz(line, sku, measuresByLabel);
  if (oz.ok) return { ok: true, dimension: "weight", oz: oz.oz };
  // A qty/fraction problem is a hard failure in either space — don't paper over it.
  if (oz.reason === "bad_qty" || oz.reason === "bad_fraction") return { ok: false, reason: oz.reason };

  // Count-space fallback: the chain must terminate in a COUNT measure, and the
  // entered level must be a chain label whose structural walk to the leaf resolves.
  const levels = sku.packChain;
  if (levels == null || levels.length === 0) return { ok: false, reason: "unresolvable" };
  const chain = buildPackChain(levels);
  if (chainCountLeafMeasure(chain, measuresByLabel) == null) return { ok: false, reason: "unresolvable" };
  const perContainer = chainLeafUnitsFrom(chain, line.levelLabel);
  if (perContainer == null) return { ok: false, reason: "unresolvable" };
  const frac = line.partialFraction ?? 1;
  const units = line.qty * perContainer * frac;
  return Number.isFinite(units) && units >= 0
    ? { ok: true, dimension: "count", units }
    : { ok: false, reason: "unresolvable" };
}

/**
 * Sum resolved line oz per SKU into an anchor snapshot. Lines are disjoint by law
 * (L5) so a plain sum is correct — a full-container line and a loose-below line for
 * the same SKU add (they count different physical stock). Callers pass the
 * already-resolved oz per line (persisted resolved_oz) — this stays pure.
 */
export function sumAnchorOzBySku(
  lines: ReadonlyArray<{ skuId: string; resolvedOz: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) out.set(l.skuId, (out.get(l.skuId) ?? 0) + (Number.isFinite(l.resolvedOz) ? l.resolvedOz : 0));
  return out;
}

/**
 * F1 — PER-SKU ANCHOR RESOLUTION (pure). Events are immutable sessions; there is no
 * single "anchor event". Given every active count line across a location's events
 * (each tagged with its event id + that event's counted_at), resolve, per SKU:
 *   - ANCHOR  = the summed resolved oz of the lines from the most-recent event
 *               (by counted_at) that counted that SKU, and that event's counted_at;
 *   - PREV    = the summed oz from the next-most-recent event that counted it
 *               (null when the SKU was counted in only one event → variance advisory);
 *   - loose/partial line counts of the anchor lines (F6 read-side annotations).
 * A spot count of ONE SKU therefore never strands any other SKU's anchor — each
 * SKU ranks ITS OWN counting events independently.
 */
export interface CountLineForAnchor {
  countEventId: string;
  /** ISO counted_at of the line's event (the ranking key). */
  eventCountedAt: string;
  skuId: string;
  resolvedOz: number;
  isLoose: boolean;
  partialFraction: number | null;
}
export interface SkuAnchor {
  skuId: string;
  anchorAt: string;
  anchorOz: number;
  looseLineCount: number;
  partialLineCount: number;
  /** ISO counted_at of the previous counting event for this SKU. null = first count. */
  prevAt: string | null;
  /** Summed oz of the previous count for this SKU. null = no earlier count. */
  prevOz: number | null;
}

export function resolvePerSkuAnchors(lines: ReadonlyArray<CountLineForAnchor>): Map<string, SkuAnchor> {
  // Group lines by SKU → by event.
  const bySkuEvent = new Map<string, Map<string, CountLineForAnchor[]>>();
  for (const l of lines) {
    let byEvent = bySkuEvent.get(l.skuId);
    if (!byEvent) { byEvent = new Map(); bySkuEvent.set(l.skuId, byEvent); }
    const arr = byEvent.get(l.countEventId) ?? [];
    arr.push(l);
    byEvent.set(l.countEventId, arr);
  }
  const out = new Map<string, SkuAnchor>();
  for (const [skuId, byEvent] of bySkuEvent) {
    // Rank the events that counted THIS SKU, newest first (by counted_at).
    const eventIds = [...byEvent.keys()].sort((a, b) => {
      const ta = Date.parse(byEvent.get(a)![0]!.eventCountedAt);
      const tb = Date.parse(byEvent.get(b)![0]!.eventCountedAt);
      return tb - ta;
    });
    const anchorLines = byEvent.get(eventIds[0]!)!;
    const prevLines = eventIds[1] != null ? byEvent.get(eventIds[1])! : null;
    const sumOz = (ls: CountLineForAnchor[]): number =>
      ls.reduce((s, l) => s + (Number.isFinite(l.resolvedOz) ? l.resolvedOz : 0), 0);
    out.set(skuId, {
      skuId,
      anchorAt: anchorLines[0]!.eventCountedAt,
      anchorOz: sumOz(anchorLines),
      looseLineCount: anchorLines.filter((l) => l.isLoose === true).length,
      partialLineCount: anchorLines.filter((l) => l.partialFraction != null).length,
      prevAt: prevLines ? prevLines[0]!.eventCountedAt : null,
      prevOz: prevLines ? sumOz(prevLines) : null,
    });
  }
  return out;
}

// ── Count-space per-SKU anchor (SKU top-tier PR-C, LOCK 4) ─────────────────────
// The count-space twin of resolvePerSkuAnchors: same per-SKU newest-event ranking
// (F1 — a spot count of one SKU never strands another's anchor), but the anchor is
// summed LEAF UNITS (resolvedUnits), not oz. Only count-anchored lines flow here;
// the server partitions by anchor_dimension so a SKU never mixes spaces.

/** A count-anchored line for per-SKU unit-anchor resolution. */
export interface CountLineForUnitAnchor {
  countEventId: string;
  eventCountedAt: string;
  skuId: string;
  resolvedUnits: number;
  isLoose: boolean;
  partialFraction: number | null;
}
export interface SkuUnitAnchor {
  skuId: string;
  anchorAt: string;
  anchorUnits: number;
  looseLineCount: number;
  partialLineCount: number;
  prevAt: string | null;
  /** Summed leaf units of the previous count for this SKU. null = no earlier count. */
  prevUnits: number | null;
}

export function resolvePerSkuUnitAnchors(
  lines: ReadonlyArray<CountLineForUnitAnchor>,
): Map<string, SkuUnitAnchor> {
  const bySkuEvent = new Map<string, Map<string, CountLineForUnitAnchor[]>>();
  for (const l of lines) {
    let byEvent = bySkuEvent.get(l.skuId);
    if (!byEvent) { byEvent = new Map(); bySkuEvent.set(l.skuId, byEvent); }
    const arr = byEvent.get(l.countEventId) ?? [];
    arr.push(l);
    byEvent.set(l.countEventId, arr);
  }
  const out = new Map<string, SkuUnitAnchor>();
  for (const [skuId, byEvent] of bySkuEvent) {
    const eventIds = [...byEvent.keys()].sort((a, b) => {
      const ta = Date.parse(byEvent.get(a)![0]!.eventCountedAt);
      const tb = Date.parse(byEvent.get(b)![0]!.eventCountedAt);
      return tb - ta;
    });
    const anchorLines = byEvent.get(eventIds[0]!)!;
    const prevLines = eventIds[1] != null ? byEvent.get(eventIds[1])! : null;
    const sumUnits = (ls: CountLineForUnitAnchor[]): number =>
      ls.reduce((s, l) => s + (Number.isFinite(l.resolvedUnits) ? l.resolvedUnits : 0), 0);
    out.set(skuId, {
      skuId,
      anchorAt: anchorLines[0]!.eventCountedAt,
      anchorUnits: sumUnits(anchorLines),
      looseLineCount: anchorLines.filter((l) => l.isLoose === true).length,
      partialLineCount: anchorLines.filter((l) => l.partialFraction != null).length,
      prevAt: prevLines ? prevLines[0]!.eventCountedAt : null,
      prevUnits: prevLines ? sumUnits(prevLines) : null,
    });
  }
  return out;
}

/**
 * DIMENSION-FLIP reconciliation (adversarial review 2026-07-28 HIGH). A SKU whose
 * chain was replaced ACROSS dimensions between counts (weight-terminated →
 * count-terminated, or back — a legitimate supersede-as-a-SET chain edit) has
 * historical lines in BOTH spaces, so it lands in BOTH per-SKU anchor maps and
 * would render TWICE (duplicate React key, contradictory on-hand). The per-SKU
 * law is "latest counted line wins" — this extends it across dimensions: for a
 * SKU present in both maps, keep the dimension of its MOST RECENT anchor and
 * delete it from the stale one. Ties (identical anchor timestamps) keep COUNT —
 * the newer write path, and a same-instant flip means the chain now terminates
 * in count-space. PURE (mutates only the two maps passed in).
 */
export function reconcileAnchorDimensions<
  W extends { anchorAt: string },
  C extends { anchorAt: string },
>(weight: Map<string, W>, count: Map<string, C>): void {
  for (const [skuId, w] of [...weight]) {
    const c = count.get(skuId);
    if (!c) continue;
    if (Date.parse(c.anchorAt) >= Date.parse(w.anchorAt)) weight.delete(skuId);
    else count.delete(skuId);
  }
}

/** Per-SKU on-hand computation inputs (all in oz; nulls make drift advisory). */
export interface OnHandInput {
  skuId: string;
  /** Latest active count-event summed oz for this SKU. null = never counted. */
  anchorOz: number | null;
  /** When the anchor count happened (ISO). null = never counted. */
  anchorAt: string | null;
  /** Received oz since the anchor (from receiving resolved_oz). null = can't derive. */
  receivedSinceOz: number | null;
  /** Consumed oz since the anchor (from live productions input_oz). null = can't derive. */
  consumedSinceOz: number | null;
  /** True when a ledger row exists dated between the anchor and now that could
   *  invalidate the drift derivation (retro-edit staleness flag, L5). */
  anchorStale: boolean;
}

export interface OnHandResult {
  skuId: string;
  anchorOz: number | null;
  anchorAt: string | null;
  anchorAgeDays: number | null;
  /** received_since − consumed_since IN OZ. null when either side can't derive (A3). */
  driftOz: number | null;
  /** anchor + drift. null when anchor OR drift is null (advisory). */
  onHandOz: number | null;
  anchorStale: boolean;
}

/** Whole-day count between two ISO timestamps (floor); null if either missing. */
export function anchorAgeDays(anchorAt: string | null, now: number): number | null {
  if (!anchorAt) return null;
  const t = Date.parse(anchorAt);
  if (Number.isNaN(t)) return null;
  const ms = now - t;
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * The ET business date of a timestamp (drift spec 2026-07-31). Toast business
 * dates are Eastern-calendar days (mirrors the sales cron's yesterdayYmd
 * formatting). The sales-depletion window TILES by this date:
 *   since-window   = business_date >= etBusinessDate(anchorAt) — the anchor's
 *     own day is INCLUDED (morning-count bias: counts precede the day's sales;
 *     an evening count over-subtracts at most that day's direct sales —
 *     documented advisory slop; events carry no per-event timestamp).
 *   between-window = [etBusinessDate(prevAt), etBusinessDate(anchorAt)) —
 *     half-open, so consecutive count periods never double-claim a day.
 */
export function etBusinessDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Is the sales-depletion term for a window UNTRUSTWORTHY? (hardening 2026-07-31,
 * council P1 — the silent-zero taint). The materialized ledger is written one
 * day per nightly cron, best-effort — a MISSING day (pull succeeded, materialize
 * failed / never ran) reads as zero sales and silently inflates on-hand. Two
 * cases force the sales term to null (advisory), matching how the production
 * term already null-taints when it can't derive cleanly:
 *   1. a GAP date (a day with sales events but no depletion rows) falls in the
 *      window [fromDate, untilExclusive) — coverage is incomplete.
 *   2. a BETWEEN window collapsed to empty (untilExclusive <= fromDate — two
 *      counts on the same ET day): the intra-day sales fraction is unknowable
 *      at day grain, so variance stays advisory rather than counting 0.
 * `untilExclusive` null = the open since-window (case 2 never applies). Dates
 * are YYYY-MM-DD (lexicographically sortable). Pure.
 */
export function salesWindowUntrustworthy(
  gapDates: ReadonlySet<string>,
  fromDate: string,
  untilExclusive: string | null,
): boolean {
  if (untilExclusive !== null && untilExclusive <= fromDate) return true; // collapsed between-window
  for (const g of gapDates) {
    if (g >= fromDate && (untilExclusive === null || g < untilExclusive)) return true;
  }
  return false;
}

/**
 * Compute on-hand for one SKU (Juan's feed/verify model). Drift is oz-native
 * (A3). Any null on the derive side → driftOz null → onHandOz null (advisory,
 * never a fabricated number). A SKU never counted (anchorOz null) has no anchor
 * to drift from → onHandOz null.
 */
export function computeOnHand(input: OnHandInput, now: number): OnHandResult {
  const driftOz =
    input.receivedSinceOz == null || input.consumedSinceOz == null
      ? null
      : input.receivedSinceOz - input.consumedSinceOz;
  const onHandOz =
    input.anchorOz == null || driftOz == null ? null : input.anchorOz + driftOz;
  return {
    skuId: input.skuId,
    anchorOz: input.anchorOz,
    anchorAt: input.anchorAt,
    anchorAgeDays: anchorAgeDays(input.anchorAt, now),
    driftOz,
    onHandOz,
    anchorStale: input.anchorStale,
  };
}

/** Per-SKU variance of a NEW count vs what the PREVIOUS count + ledger predicted. */
export interface VarianceInput {
  skuId: string;
  /** The newest count's summed oz for this SKU (the ground truth just recorded). */
  newCountOz: number;
  /** The previous count's summed oz. null = no earlier count (no variance yet). */
  prevCountOz: number | null;
  /** Received oz between the two counts. null = can't derive → advisory variance. */
  receivedBetweenOz: number | null;
  /** Consumed oz between the two counts. null = can't derive → advisory variance. */
  consumedBetweenOz: number | null;
}

export interface VarianceResult {
  skuId: string;
  /** newCount − (prevCount + received_between − consumed_between). null = advisory. */
  varianceOz: number | null;
  /** The predicted on-hand at the new count (prev + received − consumed). */
  predictedOz: number | null;
  newCountOz: number;
}

/**
 * Variance = newCount − predicted, predicted = prevCount + received_between −
 * consumed_between (Juan: "the difference is variance"). Negative variance =
 * counted LESS than predicted (shrinkage / waste / over-portion / uncounted-usage);
 * positive = counted MORE (an uncounted receipt, or an earlier over-count).
 * Advisory-null when there is no prior count or a derive side is missing (A3).
 */
export function computeVariance(input: VarianceInput): VarianceResult {
  if (
    input.prevCountOz == null ||
    input.receivedBetweenOz == null ||
    input.consumedBetweenOz == null
  ) {
    return { skuId: input.skuId, varianceOz: null, predictedOz: null, newCountOz: input.newCountOz };
  }
  const predictedOz = input.prevCountOz + input.receivedBetweenOz - input.consumedBetweenOz;
  return { skuId: input.skuId, varianceOz: input.newCountOz - predictedOz, predictedOz, newCountOz: input.newCountOz };
}

// ── Count-space on-hand + delta (SKU top-tier PR-C, LOCK 4) ─────────────────────
// A count-anchored SKU (packaging/cleaning/misc — a count-terminated chain) has NO
// oz and NO consumption artifact: nobody logs "used 2 lids". So its model is
// leaner and its VOICE is different:
//   on-hand(units) = anchor_units + received_units_since   (no consumed term — there
//                    is no consumption ledger for these; it's a pure count + intake)
//   used_or_lost   = (prev_anchor + received_between) − new_anchor   ← ADVISORY
// The count-to-count delta is "used or lost since last count" — NEVER "variance" or
// "loss" (which would imply a fault the system can't attribute). received_units
// derive READ-TIME from level-aware receiving (received_qty_at_level × chain
// multipliers); a missing/unknown intake side → null (advisory, never fabricated).

/** Per-SKU count-space on-hand inputs (all in LEAF UNITS; nulls make intake advisory). */
export interface OnHandUnitsInput {
  skuId: string;
  /** Latest count-event summed leaf units for this SKU. null = never counted. */
  anchorUnits: number | null;
  anchorAt: string | null;
  /** Leaf units RECEIVED since the anchor (derived read-time from receiving). null
   *  = can't derive a clean intake term (advisory, never a fabricated number). */
  receivedUnitsSince: number | null;
  anchorStale: boolean;
}
export interface OnHandUnitsResult {
  skuId: string;
  anchorUnits: number | null;
  anchorAt: string | null;
  anchorAgeDays: number | null;
  /** anchor + received-since. null when anchor OR intake can't derive (advisory). */
  onHandUnits: number | null;
  anchorStale: boolean;
}

/**
 * Count-space on-hand for one SKU. on-hand = anchor + received-since (no consumed
 * term — packaging/cleaning has no consumption ledger). Any null → onHandUnits null
 * (advisory). PURE.
 */
export function computeOnHandUnits(input: OnHandUnitsInput, now: number): OnHandUnitsResult {
  const onHandUnits =
    input.anchorUnits == null || input.receivedUnitsSince == null
      ? null
      : input.anchorUnits + input.receivedUnitsSince;
  return {
    skuId: input.skuId,
    anchorUnits: input.anchorUnits,
    anchorAt: input.anchorAt,
    anchorAgeDays: anchorAgeDays(input.anchorAt, now),
    onHandUnits,
    anchorStale: input.anchorStale,
  };
}

/** Per-SKU count-space "used or lost since last count" inputs (LEAF UNITS). */
export interface UsedOrLostInput {
  skuId: string;
  /** The newest count's summed leaf units (ground truth just recorded). */
  newCountUnits: number;
  /** The previous count's summed leaf units. null = no earlier count. */
  prevCountUnits: number | null;
  /** Leaf units received between the two counts (read-time from receiving). null =
   *  can't derive → advisory. */
  receivedBetweenUnits: number | null;
}
export interface UsedOrLostResult {
  skuId: string;
  /** (prev + received_between) − new. POSITIVE = fewer on the shelf than the prior
   *  count + intake predicted (used or lost — the common case for packaging). A
   *  NEGATIVE value = MORE than expected (an uncounted intake / earlier under-count).
   *  null = advisory (no prior count or the intake side can't derive). */
  usedOrLostUnits: number | null;
  newCountUnits: number;
}

/**
 * Count-space "used or lost since last count" (ADVISORY — never labeled variance /
 * loss, which would imply an attributable fault the system can't know for goods
 * with no consumption artifact). = (prevCount + receivedBetween) − newCount. PURE;
 * advisory-null when there's no prior count or the intake side is missing (A3).
 */
export function computeUsedOrLost(input: UsedOrLostInput): UsedOrLostResult {
  if (input.prevCountUnits == null || input.receivedBetweenUnits == null) {
    return { skuId: input.skuId, usedOrLostUnits: null, newCountUnits: input.newCountUnits };
  }
  const predicted = input.prevCountUnits + input.receivedBetweenUnits;
  return { skuId: input.skuId, usedOrLostUnits: predicted - input.newCountUnits, newCountUnits: input.newCountUnits };
}

/**
 * Convenience: resolve a batch of count lines to oz using a per-SKU RecipeInputSku
 * map + the measure registry, returning the resolved lines AND the first
 * unresolvable one (so the write path can reject loudly rather than store a null —
 * a count line with no oz can't anchor). Pure; the server lib supplies the maps.
 */
export type ResolveCountLinesResult =
  | { ok: true; resolved: Array<CountLineInput & { resolvedOz: number }> }
  | { ok: false; badLine: CountLineInput; reason: CountLineOzFailure | "unknown_sku" };

export function resolveCountLines(
  lines: ReadonlyArray<CountLineInput>,
  skuById: Map<string, RecipeInputSku>,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): ResolveCountLinesResult {
  const resolved: Array<CountLineInput & { resolvedOz: number }> = [];
  for (const line of lines) {
    const sku = skuById.get(line.skuId);
    if (!sku) return { ok: false, badLine: line, reason: "unknown_sku" };
    const r = resolveCountLineOz(line, sku, measuresByLabel);
    if (!r.ok) return { ok: false, badLine: line, reason: r.reason };
    resolved.push({ ...line, resolvedOz: r.oz });
  }
  return { ok: true, resolved };
}

/** A count line resolved to its persisted shape: weight lines carry resolvedOz;
 *  count lines carry resolvedUnits (resolvedOz stays null — no honest ounce). */
export type ResolvedCountLine = CountLineInput & {
  anchorDimension: "weight" | "count";
  resolvedOz: number | null;
  resolvedUnits: number | null;
};
export type ResolveCountLinesDimResult =
  | { ok: true; resolved: ResolvedCountLine[] }
  | { ok: false; badLine: CountLineInput; reason: CountLineOzFailure | "unknown_sku" };

/**
 * Dimension-aware batch resolution (PR-C write path). Each line resolves to either
 * a weight anchor (resolvedOz, resolvedUnits null) or a count anchor (resolvedUnits
 * in leaf units, resolvedOz null). An unresolvable line rejects the whole event
 * loudly (a count line with no anchor can't verify stock — the 0160 rule holds,
 * now spanning both dimensions). Pure; the server lib supplies the maps.
 */
export function resolveCountLinesDim(
  lines: ReadonlyArray<CountLineInput>,
  skuById: Map<string, RecipeInputSku>,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): ResolveCountLinesDimResult {
  const resolved: ResolvedCountLine[] = [];
  for (const line of lines) {
    const sku = skuById.get(line.skuId);
    if (!sku) return { ok: false, badLine: line, reason: "unknown_sku" };
    const r = resolveCountLineDim(line, sku, measuresByLabel);
    if (!r.ok) return { ok: false, badLine: line, reason: r.reason };
    if (r.dimension === "weight") {
      resolved.push({ ...line, anchorDimension: "weight", resolvedOz: r.oz, resolvedUnits: null });
    } else {
      resolved.push({ ...line, anchorDimension: "count", resolvedOz: null, resolvedUnits: r.units });
    }
  }
  return { ok: true, resolved };
}

/** Root→leaf chain labels for a level picker (mirrors receiving's ordering). */
export function chainLabelsInWalkOrder(levels: PackChainLevel[]): string[] {
  if (levels.length === 0) return [];
  const byId = new Map(levels.map((l) => [l.id, l]));
  const pointedAt = new Set<string>();
  for (const l of levels) if (l.containsLevelId != null) pointedAt.add(l.containsLevelId);
  const roots = levels.filter((l) => !pointedAt.has(l.id));
  if (roots.length !== 1 || !roots[0]) {
    return [...levels].sort((a, b) => a.displayOrdinal - b.displayOrdinal).map((l) => l.label);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = roots[0];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur.label);
    cur = cur.containsLevelId != null ? byId.get(cur.containsLevelId) : undefined;
  }
  return out;
}

/** Unused re-export to keep buildPackChain/walkChainToOz reachable from tests
 *  that assert the shared math wires the spine (no behavior). */
export { buildPackChain, walkChainToOz };

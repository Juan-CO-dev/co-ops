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
  if (!Number.isFinite(line.qty) || line.qty < 0) return { ok: false, reason: "bad_qty" };
  if (line.partialFraction != null && !(line.partialFraction > 0 && line.partialFraction <= 1)) {
    return { ok: false, reason: "bad_fraction" };
  }
  const base = ozForRecipeInput(line.qty, line.levelLabel, sku, measuresByLabel);
  if (base == null || !Number.isFinite(base)) return { ok: false, reason: "unresolvable" };
  const frac = line.partialFraction ?? 1;
  const oz = base * frac;
  return Number.isFinite(oz) && oz >= 0 ? { ok: true, oz } : { ok: false, reason: "unresolvable" };
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

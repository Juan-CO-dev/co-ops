/**
 * Admin cost — the PURE half (zero I/O, no server imports), split out per the
 * house `*-shared.ts` law so the derivation that decides what a SKU costs can be
 * test-pinned instead of only being reachable through a service-role page load.
 *
 * lib/admin/cost.ts re-exports everything here, so existing server consumers keep
 * their import paths unchanged.
 *
 * ── WHY THE CHAIN IS A REQUIRED ARGUMENT ────────────────────────────────────
 *
 * `skuContentOz` resolves ounces from a SKU's active PACK CHAIN when it has one,
 * and falls back to the legacy flat trio (units_per_pack × each_size ×
 * oz-per-measure) only when it does not. This function used to call it WITHOUT a
 * chain, so /admin/skus and /admin/vendors/[id] rode the legacy path while the
 * menu-costing board derived from `graph.skuPack`, which carries the chain.
 *
 * The flat trio is a MIRROR, not a source of truth: `replaceSkuPackChain` derives
 * and writes it on every chain save, explicitly as a stopgap, and explicitly
 * NON-FATALLY ("chain saved; flat fields stale"). The ordinary SKU edit path
 * writes `units_per_pack` directly without touching the chain. So the two
 * derivations agree only for as long as that mirror stays in sync — verified
 * true across all 182 live SKUs on 2026-08-21, and one failed sync away from
 * silently splitting the cost board from the catalog screens.
 *
 * Passing the chain is therefore not an optimization, it is the correctness
 * condition — and the argument is REQUIRED rather than optional because an
 * optional one is exactly how the blindness returns the first time a new caller
 * forgets it.
 */
import type { MeasureUnitOption } from "@/lib/admin/skus";
import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";
import type { ResolvedPack } from "@/lib/sku-versions-shared";
import { skuContentOz, skuCostPerOz, type MeasureUnitFactor } from "@/lib/recipe-math";

/** The chain map both admin pages already load (ONE query, the loadRecipeGraph law). */
export type SkuChainMap = ReadonlyMap<string, PackChainLevel[]>;

/** The flat pack fields a SkuView carries, as `skuContentOz` wants them. */
export interface SkuCostShape {
  id: string;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  avgOzPerEach: number | null;
}

/** measure label → factor, the lookup `skuContentOz` resolves units through. */
export function measureFactorMap(measures: MeasureUnitOption[]): Map<string, MeasureUnitFactor> {
  return new Map<string, MeasureUnitFactor>(
    measures.map((x) => [x.label, { dimension: x.dimension, toBaseFactor: x.toBaseFactor }]),
  );
}

/**
 * cost/oz per SKU = current price ÷ content_oz, CHAIN-AWARE.
 *
 * null when the SKU has no current price OR no resolvable content_oz — the two
 * are indistinguishable downstream and both mean "this line cannot be costed",
 * which is the same contract lib/admin/menu-costing.ts's board states.
 */
export function computeSkuCostPerOz(
  skus: SkuCostShape[],
  prices: Map<string, number>,
  measures: MeasureUnitOption[],
  chains: SkuChainMap,
): Map<string, number | null> {
  const m = measureFactorMap(measures);
  const out = new Map<string, number | null>();
  for (const s of skus) {
    out.set(s.id, skuCostPerOz(prices.get(s.id) ?? null, contentOzForSku(s, chains.get(s.id) ?? null, m)));
  }
  return out;
}

/**
 * content_oz for ONE SKU — the single derivation every dollar figure on the admin
 * cost surfaces rides ($/oz, the received-oz ledger, consumed dollars).
 *
 * Kept as one named function rather than three inline `skuContentOz` calls
 * because the three numbers must move together: a $/oz that is chain-aware while
 * consumed-dollars is not would put two disagreeing figures in the SAME drawer.
 */
export function contentOzForSku(
  sku: Omit<SkuCostShape, "id">,
  chain: PackChainLevel[] | null,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  return skuContentOz(
    {
      unitsPerPack: sku.unitsPerPack,
      eachSize: sku.eachSize,
      eachMeasure: sku.eachMeasure,
      avgOzPerEach: sku.avgOzPerEach,
      packChain: chain,
    },
    measuresByLabel,
  );
}

/** One delivery line as the SKU receiving ledger reads it (W04/B043). */
export interface ReceivedLineFacts {
  /** `qty_received`: the count AT the received level when a level was named, else root packs. */
  qty: number;
  /** `received_level_label`; null on legacy rows (= the root pack). */
  levelLabel: string | null;
  /** `resolved_oz`, frozen at write time through the pack chain in force then. */
  resolvedOz: number | null;
  /** `unit_price` as entered: a ROOT-pack price from a vendor (the root in force THEN), a per-LEVEL price from a store run. */
  linePrice: number | null;
  /** The SKU's current root-pack price, used when the line carries none. */
  currentRootPrice: number | null;
  /** Today's content oz of ONE root pack (pairs with `currentRootPrice`). */
  contentOz: number | null;
  /** Today's root level label (chain root, else the flat pack format). */
  rootLabel: string | null;
  /** Content oz of ONE root pack in force at the delivery's shop when the line was written (W04 r1); null = unknown. */
  receivedRootOz: number | null;
  /** That pack's root label; null = unknown. */
  receivedRootLabel: string | null;
  /** True for a store-run line, whose `linePrice` is per received level. */
  priceIsPerLevel: boolean;
}

const positiveOrNull = (n: number | null): number | null => (n != null && Number.isFinite(n) && n > 0 ? n : null);

/**
 * What ONE received line adds to the ledger, in oz and dollars (W04/B043, r1). A line entered at an INNER
 * level ("bag", or an inner-pack scan) is not a whole case: its oz is the frozen `resolved_oz`, so a later
 * chain edit cannot rewrite history. Its FROZEN root-pack price converts through the pack in force at
 * that shop when it was received (that oz over THAT root's oz), so neither a later case-size edit nor a
 * global default differing from the shop's own pack moves historical dollars. A line with no price is
 * valued at today's price over today's root. Null = cannot be known honestly; the caller excludes and
 * counts it, never guesses.
 */
export function receivedLineContribution(l: ReceivedLineFacts): { oz: number | null; dollars: number | null } {
  const level = l.levelLabel?.trim() || null;
  const rootThen = l.receivedRootLabel ?? l.rootLabel;
  const atRoot = level == null || (rootThen != null && level === rootThen);
  const stored = l.resolvedOz != null && Number.isFinite(l.resolvedOz) && l.resolvedOz >= 0 ? l.resolvedOz : null;
  const now = positiveOrNull(l.contentOz);
  const then = positiveOrNull(l.receivedRootOz);
  const oz = stored ?? (atRoot && (then ?? now) != null ? l.qty * (then ?? now)! : null);
  let dollars: number | null = null;
  if (l.linePrice != null) {
    if (l.priceIsPerLevel) dollars = l.qty * l.linePrice;
    else {
      const rootsThen = atRoot ? l.qty : stored != null && then != null ? stored / then : null;
      dollars = rootsThen != null ? rootsThen * l.linePrice : null;
    }
  } else if (l.currentRootPrice != null) {
    const rootsNow = stored != null && now != null ? stored / now : atRoot ? l.qty : null;
    dollars = rootsNow != null ? rootsNow * l.currentRootPrice : null;
  }
  return { oz, dollars: dollars != null && Number.isFinite(dollars) ? dollars : null };
}

/** A SKU's flat pack fields (the mirror), as the ledger reads them beside its versions. */
export interface FlatPackFacts {
  pack_format: string | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  avgOzPerEach: number | null;
}

/**
 * One root pack's content oz and label under `pack` (a pack in force at some instant, W04 r1). A chain
 * answers from its levels; a pre-chain baseline from the flat pack it preserved. With NO pack in force:
 * a SKU that has versions had none then (unknown, never today's guess); a SKU that never had one has
 * only ever had its flat pack, which answers.
 */
export function rootConversionOf(
  flat: FlatPackFacts,
  pack: ResolvedPack | undefined,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  skuHasVersions: boolean,
): { rootOz: number | null; rootLabel: string | null } {
  if (!pack) {
    if (skuHasVersions) return { rootOz: null, rootLabel: null };
    return { rootOz: contentOzForSku(flat, null, measuresByLabel), rootLabel: flat.pack_format };
  }
  if (pack.levels.length > 0) {
    return { rootOz: contentOzForSku(flat, pack.levels, measuresByLabel), rootLabel: chainRootLabel(buildPackChain(pack.levels)) };
  }
  if (pack.flat) {
    const f = pack.flat;
    const eachSize = f.each_size == null ? null : Number(f.each_size);
    return {
      rootOz: contentOzForSku({ unitsPerPack: f.units_per_pack, eachSize: Number.isFinite(eachSize) ? eachSize : null, eachMeasure: f.each_measure, avgOzPerEach: flat.avgOzPerEach }, null, measuresByLabel),
      rootLabel: f.pack_format,
    };
  }
  return { rootOz: null, rootLabel: null };
}

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
  /**
   * How many of the received level ONE root pack held in that pack (W04 r2): the container count
   * (a case of 12 bottles = 12), independent of any weight estimate. null = unknown.
   */
  receivedLevelsPerRoot: number | null;
  /** True for a store-run line, whose `linePrice` is per received level. */
  priceIsPerLevel: boolean;
}

const positiveOrNull = (n: number | null): number | null => (n != null && Number.isFinite(n) && n > 0 ? n : null);

/**
 * What ONE received line adds to the ledger, in oz and dollars (W04/B043, r1). A line entered at an INNER
 * level ("bag", or an inner-pack scan) is not a whole case: its oz is the frozen `resolved_oz`, so a later
 * chain edit cannot rewrite history. Its FROZEN root-pack price converts through the CONTAINER COUNT of the
 * pack in force at that shop when it was received (W04 r2: 2 bottles of a 12-bottle case = 1/6 case), so
 * neither a later case-size edit, a global default differing from the shop's own pack, nor a change to
 * the SKU's average weight moves historical dollars. A line with no price is
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
      // W04 r2: root packs = qty over the CONTAINER COUNT of the pack in force then, never a ratio
      // of ounces (those ride the SKU's current average weight, and observed weights).
      const perRoot = positiveOrNull(l.receivedLevelsPerRoot);
      const rootsThen = atRoot ? l.qty : perRoot != null ? l.qty / perRoot : null;
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
  /** The inner container the flat pack counts (`each_container_label`); null = none named. */
  eachContainerLabel: string | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  avgOzPerEach: number | null;
}

/** What `rootConversionOf` answers: one root's oz and label, and each container's count per root. */
export interface RootConversion {
  rootOz: number | null;
  rootLabel: string | null;
  /**
   * Container label -> how many of it ONE root pack holds (the root itself = 1), walked from the
   * pack's container counts alone (W04 r2). A count-measure leaf (case -> 12 each) is listed under
   * its measure label. Weight estimates never enter it.
   */
  levelsPerRoot: ReadonlyMap<string, number>;
}

/** Container counts per root of a chain, from the root down (null-safe: a malformed chain answers nothing). */
function chainLevelsPerRoot(levels: PackChainLevel[], measuresByLabel: Map<string, MeasureUnitFactor>): Map<string, number> {
  const out = new Map<string, number>();
  const chain = buildPackChain(levels);
  const root = chainRootLabel(chain);
  let cur = root != null ? chain.byLabel.get(root) : undefined;
  let count = 1;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return new Map(); // cycle: nothing is known
    seen.add(cur.id);
    if (!out.has(cur.label)) out.set(cur.label, count);
    if (!Number.isFinite(cur.containsQty) || cur.containsQty <= 0) break;
    const inner = count * cur.containsQty;
    if (cur.containsLevelId != null) {
      cur = chain.byId.get(cur.containsLevelId);
      count = inner;
      continue;
    }
    const unit = cur.containsMeasureUnit;
    if (unit != null && measuresByLabel.get(unit)?.dimension === "count" && !out.has(unit)) out.set(unit, inner);
    break;
  }
  return out;
}

/** Container counts per root of a flat pack (pack_format = 1, each container = units_per_pack). */
function flatLevelsPerRoot(root: string | null, eachLabel: string | null, unitsPerPack: number | null): Map<string, number> {
  const out = new Map<string, number>();
  const r = root?.trim();
  if (r) out.set(r, 1);
  const e = eachLabel?.trim();
  if (e && e !== r && unitsPerPack != null && Number.isFinite(unitsPerPack) && unitsPerPack > 0) out.set(e, unitsPerPack);
  return out;
}

/**
 * The container count of `level` per root in a conversion (exact label first, then trimmed and
 * case-insensitive), or null when that pack did not hold such a container.
 */
export function levelsPerRootOf(conv: RootConversion, level: string | null): number | null {
  const label = level?.trim();
  if (!label) return null;
  const exact = conv.levelsPerRoot.get(label);
  if (exact != null) return exact;
  const lower = label.toLowerCase();
  for (const [k, v] of conv.levelsPerRoot) if (k.trim().toLowerCase() === lower) return v;
  return null;
}

/**
 * One root pack's content oz and label under `pack` (a pack in force at some instant, W04 r1), and
 * each container's count per root (W04 r2). A chain answers from its levels; a pre-chain baseline
 * from the flat pack it preserved. With NO pack in force: a SKU that has versions had none then
 * (unknown, never today's guess); a SKU that never had one has only ever had its flat pack, which answers.
 */
export function rootConversionOf(
  flat: FlatPackFacts,
  pack: ResolvedPack | undefined,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  skuHasVersions: boolean,
): RootConversion {
  const none: RootConversion = { rootOz: null, rootLabel: null, levelsPerRoot: new Map() };
  if (!pack) {
    if (skuHasVersions) return none;
    return {
      rootOz: contentOzForSku(flat, null, measuresByLabel),
      rootLabel: flat.pack_format,
      levelsPerRoot: flatLevelsPerRoot(flat.pack_format, flat.eachContainerLabel, flat.unitsPerPack),
    };
  }
  if (pack.levels.length > 0) {
    return {
      rootOz: contentOzForSku(flat, pack.levels, measuresByLabel),
      rootLabel: chainRootLabel(buildPackChain(pack.levels)),
      levelsPerRoot: chainLevelsPerRoot(pack.levels, measuresByLabel),
    };
  }
  if (pack.flat) {
    const f = pack.flat;
    const eachSize = f.each_size == null ? null : Number(f.each_size);
    return {
      rootOz: contentOzForSku({ unitsPerPack: f.units_per_pack, eachSize: Number.isFinite(eachSize) ? eachSize : null, eachMeasure: f.each_measure, avgOzPerEach: flat.avgOzPerEach }, null, measuresByLabel),
      rootLabel: f.pack_format,
      levelsPerRoot: flatLevelsPerRoot(f.pack_format, f.each_container_label, f.units_per_pack),
    };
  }
  return none;
}

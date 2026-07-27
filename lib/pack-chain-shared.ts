/**
 * Per-SKU pack-chain conversion spine — PURE (client-safe, zero I/O, no server
 * imports; fully unit-testable). The `*-shared.ts` pattern (AGENTS.md): the
 * client SkuForm chain editor and the server loaders/validation both import
 * from here.
 *
 * The chain (migration 0159 sku_pack_levels) stores an arbitrary-depth purchase
 * hierarchy per SKU: e.g. Capicola  case -> 4 log ; log -> 34 oz. Each level
 * either POINTS to the next level down (contains_level_id) or TERMINATES in a
 * measure unit (contains_measure_unit). walkChainToOz walks it POINTER-directed
 * — it follows contains_level_id, NEVER display_ordinal.
 *
 * ── THE DETACHED-SIBLING TRAP (council top find, builder) ──────────────────
 * In the brief's own Capicola example, entering the levels as flat ordinal rows
 * (case, log, slice) and walking by ordinal yields 54.4 oz/case instead of the
 * correct 136 — because 'slice' is nobody's contains_unit. A pointer-directed
 * walk either resolves correctly (case -> log -> oz = 136) or fails LOUDLY
 * (returns a typed unreachable result) when a level dangles. It NEVER silently
 * produces 54.4. That guarantee is the reason this module exists; the L7
 * CAPICOLA regression test pins it.
 *
 * Leaf semantics mirror recipe-math's ozPerMeasureUnit EXACTLY so the legacy
 * two-level flat-field math and the chain walk agree byte-for-byte on the 56
 * clean backfills (L7 parity invariant):
 *   - weight-dim leaf → contains_qty × measure.toBaseFactor (→ oz)
 *   - count/volume leaf → contains_qty × avgOzPerEach (the SKU's human-entered
 *     average; null when unset → the whole walk is unresolvable, never guessed).
 */

import type { MeasureUnitFactor } from "@/lib/recipe-math";

/** One chain level, as loaded from sku_pack_levels (active rows only). */
export interface PackChainLevel {
  id: string;
  label: string;
  containsQty: number;
  /** Pointer to the next level down (this level holds containsQty of THAT level). */
  containsLevelId: string | null;
  /** Terminal measure-unit label (this level holds containsQty of that unit). */
  containsMeasureUnit: string | null;
  /** DISPLAY ONLY — never drives the walk. */
  displayOrdinal: number;
}

/** Why a walk could not resolve — surfaced loudly-typed, never as a wrong number. */
export type PackChainWalkFailure =
  | "unknown_label" // no active level with the requested label
  | "cycle" // contains_level_id pointers loop
  | "dangling_pointer" // a contains_level_id points at no active level
  | "missing_measure" // the leaf's measure unit isn't in the registry
  | "missing_avg"; // count/volume leaf but the SKU has no avg_oz_per_each

export interface PackChainWalkOk {
  ok: true;
  /** Total ounces in ONE of the starting label's container. */
  oz: number;
}
export interface PackChainWalkErr {
  ok: false;
  reason: PackChainWalkFailure;
}
export type PackChainWalkResult = PackChainWalkOk | PackChainWalkErr;

/** Index active chain levels by id and by label for O(1) pointer/label lookup. */
export interface PackChain {
  byId: Map<string, PackChainLevel>;
  byLabel: Map<string, PackChainLevel>;
  levels: PackChainLevel[];
}

/**
 * Label-collision check (L1, pure): a chain label must NOT equal any active
 * measure_units label (else "case" and "oz" would live in the same namespace and
 * ozForRecipeInput couldn't tell a container from a unit). Returns the first
 * colliding label, or null when clean. The write path (lib/admin/pack-chain.ts)
 * calls this against the live measure_units set before persisting.
 */
export function firstLabelMeasureCollision(
  labels: readonly string[],
  measureLabels: ReadonlySet<string>,
): string | null {
  for (const raw of labels) {
    const label = raw.trim();
    if (measureLabels.has(label)) return label;
  }
  return null;
}

/** Build the lookup indices for one SKU's active chain levels. */
export function buildPackChain(levels: PackChainLevel[]): PackChain {
  const byId = new Map<string, PackChainLevel>();
  const byLabel = new Map<string, PackChainLevel>();
  for (const l of levels) {
    byId.set(l.id, l);
    // First-wins on label collisions; the write path guarantees uniqueness among
    // active rows (partial UNIQUE index + app validation), so this is defensive.
    if (!byLabel.has(l.label)) byLabel.set(l.label, l);
  }
  return { byId, byLabel, levels };
}

/**
 * Ounces contained in ONE unit of `fromLabel`, walking the chain POINTER-directed.
 *
 *   oz(level) = containsQty × ( oz(pointed-to level)              if contains_level_id
 *                             | measure.toBaseFactor              if weight-dim leaf
 *                             | avgOzPerEach                      if count/volume leaf )
 *
 * Returns a loudly-typed failure (never a wrong number) on: unknown start label,
 * a pointer cycle, a dangling pointer, an unregistered leaf measure, or a
 * count/volume leaf with no avg. avgOzPerEach is the SKU-level average (same one
 * recipe-math uses); pass null when the SKU hasn't set it.
 */
export function walkChainToOz(
  chain: PackChain,
  fromLabel: string,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  avgOzPerEach: number | null,
): PackChainWalkResult {
  const start = chain.byLabel.get(fromLabel);
  if (!start) return { ok: false, reason: "unknown_label" };
  return walkFromLevel(chain, start, measuresByLabel, avgOzPerEach, new Set());
}

function walkFromLevel(
  chain: PackChain,
  level: PackChainLevel,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  avgOzPerEach: number | null,
  visiting: Set<string>,
): PackChainWalkResult {
  if (visiting.has(level.id)) return { ok: false, reason: "cycle" };

  if (level.containsLevelId != null) {
    const next = chain.byId.get(level.containsLevelId);
    if (!next) return { ok: false, reason: "dangling_pointer" };
    const nextVisiting = new Set(visiting).add(level.id);
    const inner = walkFromLevel(chain, next, measuresByLabel, avgOzPerEach, nextVisiting);
    if (!inner.ok) return inner;
    const total = level.containsQty * inner.oz;
    return { ok: true, oz: total };
  }

  // Leaf: contains_measure_unit is set (CHECK guarantees exactly-one, but be
  // defensive if the DB constraint were ever bypassed).
  const unit = level.containsMeasureUnit;
  if (unit == null) return { ok: false, reason: "dangling_pointer" };
  const measure = measuresByLabel.get(unit);
  if (!measure) return { ok: false, reason: "missing_measure" };
  const per = ozPerLeafUnit(measure, avgOzPerEach);
  if (per == null) return { ok: false, reason: "missing_avg" };
  const total = level.containsQty * per;
  return Number.isFinite(total) ? { ok: true, oz: total } : { ok: false, reason: "missing_avg" };
}

/**
 * oz contributed by ONE leaf measure unit — mirrors recipe-math's
 * ozPerMeasureUnit EXACTLY (the parity guarantee): weight → toBaseFactor;
 * count/volume → the SKU's avg (null when unset). Kept as a local copy rather
 * than imported so this module has zero coupling beyond the type; both must
 * change together (the L7 parity test is the tripwire).
 */
function ozPerLeafUnit(measure: MeasureUnitFactor, avgOzPerEach: number | null): number | null {
  if (measure.dimension === "weight") return measure.toBaseFactor;
  return avgOzPerEach != null && Number.isFinite(avgOzPerEach) ? avgOzPerEach : null;
}

/**
 * The chain's ROOT label = the single level nobody points at (no other active
 * level has contains_level_id === this.id). Used by skuContentOz's chain path
 * (content_oz = oz of one root container). Returns null when there is no unique
 * root (zero levels, or a malformed multi-root chain — validation rejects those
 * on write, but the reader stays defensive).
 */
export function chainRootLabel(chain: PackChain): string | null {
  if (chain.levels.length === 0) return null;
  const pointedAt = new Set<string>();
  for (const l of chain.levels) {
    if (l.containsLevelId != null) pointedAt.add(l.containsLevelId);
  }
  const roots = chain.levels.filter((l) => !pointedAt.has(l.id));
  return roots.length === 1 && roots[0] ? roots[0].label : null;
}

/**
 * Total reachability + leaf-termination check for a whole chain (L7 totality
 * invariant + the validation lib's acyclic/reachable rule). Returns ok when:
 *  - there is a unique root,
 *  - every level is reachable from the root by following contains_level_id,
 *  - the walk from the root terminates in a measure unit (no cycle, no dangling).
 * A DETACHED SIBLING (a level nobody points at, besides the root) makes the walk
 * from the root ignore it → not-all-reachable → fails here. That's the trap,
 * caught structurally.
 */
export function validateChainReachable(
  chain: PackChain,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  avgOzPerEach: number | null,
): PackChainWalkResult {
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return { ok: false, reason: "unknown_label" };
  const walk = walkChainToOz(chain, rootLabel, measuresByLabel, avgOzPerEach);
  if (!walk.ok) return walk;
  // Count levels visited on the root path; must equal the total (else a detached
  // sibling / fork exists that the pointer walk never touched).
  const onPath = countReachable(chain, rootLabel);
  if (onPath !== chain.levels.length) return { ok: false, reason: "dangling_pointer" };
  return walk;
}

function countReachable(chain: PackChain, rootLabel: string): number {
  const start = chain.byLabel.get(rootLabel);
  if (!start) return 0;
  let count = 0;
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = start;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    count += 1;
    cur = cur.containsLevelId != null ? chain.byId.get(cur.containsLevelId) : undefined;
  }
  return count;
}

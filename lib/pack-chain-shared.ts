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

/**
 * SKU classes that gate the leaf law (council 2026-07-28, PR-A). Kept as a bare
 * union here (not imported from catalog-shared) so this module has ZERO coupling
 * beyond the MeasureUnitFactor type — the class-awareness is a single string
 * compare (`=== "raw"`), never a dependency. catalog-shared's SkuClass is the
 * same union; callers pass that value through.
 */
export type PackChainSkuClass = "raw" | "packaging" | "cleaning" | "misc";

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

// ── The validation split (council 2026-07-28, PR-A) ─────────────────────────
// validateChainReachable (above) conflates two distinct questions: is the chain
// STRUCTURALLY sound (single root, acyclic, all-reachable, terminates in a
// registered measure)?  AND is it OZ-RESOLVABLE (the walk to oz succeeds — which
// for a count/volume leaf needs the SKU's avg_oz_per_each)?  A structurally
// perfect count-terminated chain (case → 12 each, no avg) FAILS the second but
// not the first — yet the old single check flagged it "unverified", crying wolf
// on every packaging SKU (Disclosure D2). The split below lets the badge be
// class-aware: structural breaks are unverified for EVERY class; oz-unresolvability
// is unverified ONLY for raw (which feeds depletion/cost). The pure oz walk is
// NEVER touched — this is a NEW read over the same primitives.

/**
 * STRUCTURAL validity of a whole chain, WITHOUT requiring oz-resolvability.
 * ok when: there is a unique root, every level is reachable from it by following
 * contains_level_id, the root path is acyclic, and it terminates in a leaf whose
 * contains_measure_unit is a REGISTERED measure of ANY dimension (weight/volume/
 * count) — no avg_oz_per_each needed. This is the "the chain is well-formed and
 * ends in a real unit" check; whether that unit converts to ounces is a separate
 * question (walkChainToOz / oz-resolvability).
 *
 * Reuses the loud typed failure reasons: `unknown_label` (no unique root),
 * `cycle`, `dangling_pointer` (unreachable / detached-sibling / fork), and
 * `missing_measure` (leaf points at an unregistered unit). It never returns
 * `missing_avg` — that is precisely the oz-only concern this function excludes.
 */
export function validateChainStructure(
  chain: PackChain,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): PackChainWalkResult {
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return { ok: false, reason: "unknown_label" };
  // Walk the root path structurally: follow pointers (detecting cycles), and at
  // the leaf require a registered measure of any dimension (NOT oz-resolvability).
  const start = chain.byLabel.get(rootLabel);
  if (!start) return { ok: false, reason: "unknown_label" };
  const visiting = new Set<string>();
  let cur: PackChainLevel | undefined = start;
  while (cur) {
    if (visiting.has(cur.id)) return { ok: false, reason: "cycle" };
    visiting.add(cur.id);
    if (cur.containsLevelId != null) {
      const next = chain.byId.get(cur.containsLevelId);
      if (!next) return { ok: false, reason: "dangling_pointer" };
      cur = next;
      continue;
    }
    // Leaf: must point at a registered measure unit (any dimension).
    const unit = cur.containsMeasureUnit;
    if (unit == null) return { ok: false, reason: "dangling_pointer" };
    if (!measuresByLabel.has(unit)) return { ok: false, reason: "missing_measure" };
    break; // structurally terminated in a real unit
  }
  // Totality: every level must be on the root path (no detached sibling / fork).
  const onPath = countReachable(chain, rootLabel);
  if (onPath !== chain.levels.length) return { ok: false, reason: "dangling_pointer" };
  return { ok: true, oz: 0 }; // oz is not meaningful here; the flag is `ok`
}

/**
 * The single source of truth for the "chain unverified" badge (council PR-A,
 * cried-wolf law). A chain is UNVERIFIED iff it is structurally INVALID for ANY
 * class, OR it is oz-UNRESOLVABLE and the SKU is class `raw` (raw feeds
 * depletion/cost, so its chain must reach ounces). Non-raw structurally-valid
 * count-terminated chains are COMPLETE BY DESIGN — never unverified.
 *
 *   unverified ⇔ !structurallyValid  OR  ( skuClass === "raw" AND !ozResolvable )
 *
 * Both the read path (app/admin/skus/page.tsx) and the SkuCatalogClient consume
 * this — one predicate, no drift.
 */
export function isChainUnverified(
  chain: PackChain,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  avgOzPerEach: number | null,
  skuClass: PackChainSkuClass,
): boolean {
  if (chain.levels.length === 0) return false; // no chain ≠ unverified (that's "no pack info")
  if (!validateChainStructure(chain, measuresByLabel).ok) return true;
  if (skuClass !== "raw") return false; // count-terminated non-raw = complete by design
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return true; // defensive (structure already checked this)
  return !walkChainToOz(chain, rootLabel, measuresByLabel, avgOzPerEach).ok;
}

// ── Count-space math (SKU top-tier PR-C, LOCK 4) ────────────────────────────────
// A count-terminated chain (packaging/cleaning/misc leaf is a bare count measure
// like "each") has NO honest ounce, but it DOES have a structural unit count: how
// many leaf units one container holds. This is a PURE STRUCTURAL walk — it never
// touches avg_oz_per_each, measures, or oz. It multiplies containsQty down the
// pointer path to the leaf. The count surface anchors + reorders in these units
// ("2 cases + 3 loose = 27 units") when the chain doesn't reach ounces.

/**
 * Leaf units contained in ONE unit of `fromLabel`, walking the chain
 * POINTER-directed and multiplying `containsQty` at every level down to the leaf.
 * PURE + structural — no measures, no avg, no oz. The leaf itself contributes its
 * own `containsQty` (e.g. `case → 12 each` counts the leaf's 12; `case → 4 log ;
 * log → 6 each` = 4 × 6 = 24). Returns null on: unknown start label, a pointer
 * cycle, or a dangling pointer (loudly-null, never a wrong count). NOTE: this does
 * NOT require the leaf to be a COUNT measure — it's a raw structural multiply; the
 * caller decides whether count-space applies (see chainCountLeafMeasure).
 */
export function chainLeafUnitsFrom(chain: PackChain, fromLabel: string): number | null {
  const start = chain.byLabel.get(fromLabel);
  if (!start) return null;
  let product = 1;
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = start;
  while (cur) {
    if (seen.has(cur.id)) return null; // cycle
    seen.add(cur.id);
    if (!Number.isFinite(cur.containsQty) || cur.containsQty <= 0) return null;
    product *= cur.containsQty;
    if (cur.containsLevelId == null) break; // leaf reached
    const next = chain.byId.get(cur.containsLevelId);
    if (!next) return null; // dangling pointer
    cur = next;
  }
  return Number.isFinite(product) ? product : null;
}

/**
 * Leaf units in ONE ROOT container (the whole pack, in count-space). Convenience
 * over chainLeafUnitsFrom(root). Null when there's no unique root or the walk
 * fails. Used for count-space content ("a case = 12 units") + reorder framing.
 */
export function chainLeafUnitsPerRoot(chain: PackChain): number | null {
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return null;
  return chainLeafUnitsFrom(chain, rootLabel);
}

/**
 * The chain's count-leaf measure label — the leaf's contains_measure_unit WHEN it
 * is a registered COUNT-dimension measure (the "each" case). Returns null when the
 * chain doesn't terminate cleanly in a count measure (a weight/volume leaf, a
 * malformed chain, or an unregistered unit). This is the discriminator the count
 * surface uses: a count-leaf measure present ⇒ count-space anchoring is available
 * for a non-oz-resolvable line; absent ⇒ the line must resolve in oz or is
 * unresolvable. PURE.
 */
export function chainCountLeafMeasure(
  chain: PackChain,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): string | null {
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return null;
  const start = chain.byLabel.get(rootLabel);
  if (!start) return null;
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = start;
  while (cur) {
    if (seen.has(cur.id)) return null; // cycle
    seen.add(cur.id);
    if (cur.containsLevelId == null) {
      // Leaf: is its measure a registered COUNT-dimension unit?
      const unit = cur.containsMeasureUnit;
      if (unit == null) return null;
      const measure = measuresByLabel.get(unit);
      return measure && measure.dimension === "count" ? unit : null;
    }
    const next = chain.byId.get(cur.containsLevelId);
    if (!next) return null; // dangling pointer
    cur = next;
  }
  return null;
}

/**
 * A human-readable chain descriptor for the SKU catalog ("Case → 4 log → 34 oz" /
 * "Case → 12 each"), walking root→leaf pointer-directed. Each hop reads
 * "<label> → <containsQty> <next label|measure>". PURE — no i18n needed (labels +
 * measure units are already the manager's own words). Returns null when the chain
 * is empty or has no unique root (the caller falls back to the flat format).
 */
export function formatChainDescriptor(chain: PackChain): string | null {
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return null;
  const start = chain.byLabel.get(rootLabel);
  if (!start) return null;
  const parts: string[] = [start.label];
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = start;
  while (cur) {
    if (seen.has(cur.id)) return null; // cycle → bail to flat fallback
    seen.add(cur.id);
    if (cur.containsLevelId != null) {
      const next = chain.byId.get(cur.containsLevelId);
      if (!next) return null; // dangling
      parts.push(`${cur.containsQty} ${next.label}`);
      cur = next;
      continue;
    }
    // Leaf: qty × its measure unit.
    if (cur.containsMeasureUnit == null) return null;
    parts.push(`${cur.containsQty} ${cur.containsMeasureUnit}`);
    break;
  }
  return parts.join(" → ");
}

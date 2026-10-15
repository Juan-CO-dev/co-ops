/**
 * THE ALWAYS-SENTENCE PACK MODEL (catalog Phase 2b; spec §4 "The pack editor is always the sentence
 * editor"). PURE, client-safe. A chain is shown and edited as
 *
 *     1 [case] holds [6] [bag]; each [bag] weighs [5] [lb]
 *
 * containers[0] is the root (what you order by); containers[i].qty is how many containers[i] sit
 * inside containers[i-1] (the root's own qty is always "1"); the leaf is what ONE last container
 * weighs or holds. Valid chains are linear (0159: single root, every level on one pointer path), so
 * the sentence expresses every one of them; a non-linear chain reads back as null.
 *
 * The writer still runs the full validation (lib/admin/pack-chain.ts validateSubmission) — this
 * model only refuses what a person can fix in the sentence itself, by name.
 */
import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";
import type { StarterChainLevel } from "@/lib/admin/catalog-shared";

export interface SentenceContainer { label: string; qty: string }
export interface SentenceDraft { containers: SentenceContainer[]; leafQty: string; leafUnit: string }
export type SentenceError = "empty_label" | "duplicate_label" | "label_is_measure_unit" | "bad_qty" | "no_leaf_unit" | "unknown_measure";

/** The live chain as a sentence; null for an empty or non-linear chain. */
export function sentenceFromLevels(levels: readonly PackChainLevel[]): SentenceDraft | null {
  if (levels.length === 0) return null;
  const chain = buildPackChain([...levels]);
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return null;
  const containers: SentenceContainer[] = [];
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = chain.byLabel.get(rootLabel);
  let parentQty = "1";
  while (cur) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    containers.push({ label: cur.label, qty: parentQty });
    if (cur.containsLevelId == null) {
      if (seen.size !== levels.length || cur.containsMeasureUnit == null) return null;
      return { containers, leafQty: String(cur.containsQty), leafUnit: cur.containsMeasureUnit };
    }
    parentQty = String(cur.containsQty);
    cur = chain.byId.get(cur.containsLevelId);
  }
  return null;
}

function positive(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The sentence as the index-linked chain the writer takes (root first), or the first problem by name. */
export function levelsFromSentence(
  draft: SentenceDraft,
  measureLabels: ReadonlySet<string>,
): { ok: true; levels: StarterChainLevel[] } | { ok: false; error: SentenceError; index: number } {
  const n = draft.containers.length;
  if (n === 0) return { ok: false, error: "empty_label", index: 0 };
  // A container named like a unit — in ANY case ("LB", "Oz") — is refused: the walk could not tell
  // a container from a unit (stricter than the writer's exact match, never looser).
  const measuresLower = new Set([...measureLabels].map((m) => m.toLowerCase()));
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const label = draft.containers[i]!.label.trim();
    if (!label) return { ok: false, error: "empty_label", index: i };
    if (measuresLower.has(label.toLowerCase())) return { ok: false, error: "label_is_measure_unit", index: i };
    const key = label.toLowerCase();
    if (seen.has(key)) return { ok: false, error: "duplicate_label", index: i };
    seen.add(key);
    if (i > 0 && positive(draft.containers[i]!.qty) == null) return { ok: false, error: "bad_qty", index: i };
  }
  const leafQty = positive(draft.leafQty);
  if (leafQty == null) return { ok: false, error: "bad_qty", index: n - 1 };
  if (!draft.leafUnit.trim()) return { ok: false, error: "no_leaf_unit", index: n - 1 };
  // The leaf must be a REGISTERED unit, exactly as spelled — the writer's unknown_measure, by name.
  if (!measureLabels.has(draft.leafUnit.trim())) return { ok: false, error: "unknown_measure", index: n - 1 };
  const levels: StarterChainLevel[] = draft.containers.map((c, i) => i < n - 1
    ? { label: c.label.trim(), containsQty: positive(draft.containers[i + 1]!.qty)!, containsIndex: i + 1, containsMeasureUnit: null }
    : { label: c.label.trim(), containsQty: leafQty, containsIndex: null, containsMeasureUnit: draft.leafUnit.trim() });
  return { ok: true, levels };
}

/**
 * Which units may end the sentence. A RAW item feeds cost and depletion, so it ends in a WEIGHT
 * ("each bag weighs 5 lb") — the per-piece weight lives in the sentence, never in a hidden avg —
 * except that a chain which ALREADY ends in a count/volume unit keeps that choice (it converts
 * through the item's existing per-piece weight, shown read-only). Supplies may end in any unit.
 */
export function leafUnitChoices(
  units: ReadonlyArray<{ label: string; dimension: "weight" | "volume" | "count" }>,
  skuClass: string,
  currentLeafUnit: string | null,
): string[] {
  if (skuClass !== "raw") return units.map((u) => u.label);
  const weights = units.filter((u) => u.dimension === "weight").map((u) => u.label);
  return currentLeafUnit && !weights.includes(currentLeafUnit) && units.some((u) => u.label === currentLeafUnit)
    ? [...weights, currentLeafUnit]
    : weights;
}

/**
 * Demand signals (item 4 PR 1): THE SCORING CONTRACT and THE PASS RULE. Pure. Fixed in code before any run.
 *
 * ── THE UNIT ────────────────────────────────────────────────────────────────────────────────
 * One scored row = shop x target x decision lead x valid date (x hour or product where the target has one).
 * `leadDays` = valid date - decision date, in ET calendar days (0 = the decision's own day).
 *
 * ── THE FORMULAS ────────────────────────────────────────────────────────────────────────────
 *   WAPE = sum |F - A| / sum A          bias = sum (F - A) / sum A
 * When sum A is 0 the score is UNDEFINED (null, shown as a dash) and left out of every pooling.
 * A row with no actual (the day was not captured) or no forecast in EITHER arm leaves BOTH arms and is
 * counted. A missing day is never scored as zero.
 *
 * ── ONE SCOPE = ONE TARGET x ONE DECISION LEAD (Astra r2 P2 #2) ─────────────────────────────
 * Every gate of the pass rule is evaluated INSIDE one scope. Pooling is permitted only across the shops
 * and the valid dates of that scope; `scoreScope` throws `mixed_scope` on anything else. So:
 *   · a gain at lead 1 cannot outweigh a loss at the scheduling lead, and never authorizes it;
 *   · dollar errors and ounce errors are never added together;
 *   · episodes are counted inside the scope (an event with no scored row at this lead is not evidence here).
 * A passing qualification NAMES what it authorizes: the model hash, the target, the lead, the shops in its
 * evidence, the evidence run and the holdout read. `authorizes()` is an exact match on all of them.
 *
 * ── BIAS IS COMPARED IN ABSOLUTE VALUE ──────────────────────────────────────────────────────
 * "Bias no worse" means |candidate bias| <= |baseline bias|. A more negative bias is numerically smaller
 * and is not better.
 */
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import type { EvidenceClass } from "./evidence-shared";

export const DEMAND_TARGETS = ["labor_day_cents", "labor_hour_cents", "par_product_day_oz", "prep_item_day_units"] as const;
export type DemandTarget = (typeof DEMAND_TARGETS)[number];
/** The unit a target's errors are in. Two targets with different units are never pooled; neither are two with the same. */
export const TARGET_UNIT: Record<DemandTarget, "cents" | "oz" | "par_unit"> = {
  labor_day_cents: "cents", labor_hour_cents: "cents", par_product_day_oz: "oz", prep_item_day_units: "par_unit",
};

/** THE PASS RULE. Changing a number here is a new rule: every earlier qualification was made under the old one. */
export const PASS_RULE = Object.freeze({
  /** At least 5% relative WAPE gain, pooled inside the scope, on the holdout. */
  minRelGain: 0.05,
  /** Neither shop more than 1% worse (relative WAPE). */
  shopMaxRelLoss: 0.01,
  /** At least 8 independent episodes with a scored row in the scope. */
  minEpisodes: 8,
  /** Week-block bootstrap of the relative gain; the bound is the 5th percentile (the lower end of a two-sided 90% interval). */
  bootstrapSamples: 2000,
  bootstrapQuantile: 0.05,
  /** Fewer distinct weeks than this cannot be resampled into anything: the bound is undefined and the gate fails. */
  minWeekBlocks: 4,
  /** The resampling stream is fixed, so a score is the same on every machine and every run. */
  seed: 20261117,
});

export interface ScoreScope { target: DemandTarget; leadDays: number }

/** One unit of both arms against the frozen target. */
export interface PairedRow {
  shopId: string;
  target: DemandTarget;
  leadDays: number;
  validDate: string;
  /** Hour ("07"), product or item id; "" for a day-grain target. */
  unitKey: string;
  baseline: number | null;
  candidate: number | null;
  /** The frozen target. null = the day was not covered: excluded from both arms and counted. */
  actual: number | null;
  /** The candidate signal's episode active on this row (contiguous days of one event), or null when the signal was silent. */
  episodeId: string | null;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export interface ErrorStat { value: number | null; n: number; excluded: number; sumErr: number; sumAbsErr: number; sumActual: number }
function errors(rows: ReadonlyArray<{ forecast: number | null; actual: number | null }>): Omit<ErrorStat, "value"> {
  let n = 0, excluded = 0, sumErr = 0, sumAbsErr = 0, sumActual = 0;
  for (const r of rows) {
    if (!finite(r.forecast) || !finite(r.actual)) { excluded += 1; continue; }
    n += 1; sumErr += r.forecast - r.actual; sumAbsErr += Math.abs(r.forecast - r.actual); sumActual += r.actual;
  }
  return { n, excluded, sumErr, sumAbsErr, sumActual };
}
/** WAPE = sum|F-A| / sum A. Undefined (null) when sum A is 0. */
export function wapeOf(rows: ReadonlyArray<{ forecast: number | null; actual: number | null }>): ErrorStat {
  const e = errors(rows);
  return { ...e, value: e.sumActual > 0 ? e.sumAbsErr / e.sumActual : null };
}
/** bias = sum(F-A) / sum A, signed. Undefined (null) when sum A is 0. */
export function biasOf(rows: ReadonlyArray<{ forecast: number | null; actual: number | null }>): ErrorStat {
  const e = errors(rows);
  return { ...e, value: e.sumActual > 0 ? e.sumErr / e.sumActual : null };
}

/** The par coverage SIMULATION: what a covered amount would have left short or over against what was used. */
export function coverageSim(coveredOz: number, actualOz: number): { shortfallOz: number; overCoverOz: number } {
  return { shortfallOz: Math.max(actualOz - coveredOz, 0), overCoverOz: Math.max(coveredOz - actualOz, 0) };
}

/** The slow / normal / busy call against the realized class. Weekend days are their own class. */
export function classAccuracy(rows: ReadonlyArray<{ forecast: string | null; actual: string | null }>): { n: number; correct: number; value: number | null; excluded: number } {
  let n = 0, correct = 0, excluded = 0;
  for (const r of rows) {
    if (r.forecast === null || r.actual === null) { excluded += 1; continue; }
    n += 1; if (r.forecast === r.actual) correct += 1;
  }
  return { n, correct, value: n > 0 ? correct / n : null, excluded };
}

/**
 * Episode ids for a signal's active days: contiguous calendar days of ONE event key are one episode, named by
 * the event and its first day. The id carries no shop, so one shutdown at two shops is one episode.
 * Returns `${eventKey}|${date}` -> episode id.
 */
export function episodeIdsFor(active: ReadonlyArray<{ date: string; eventKey: string }>): Map<string, string> {
  const byKey = new Map<string, Set<string>>();
  for (const a of active) (byKey.get(a.eventKey) ?? byKey.set(a.eventKey, new Set()).get(a.eventKey)!).add(a.date);
  const out = new Map<string, string>();
  for (const [eventKey, dates] of byKey) {
    let first: string | null = null, prev: string | null = null;
    for (const date of [...dates].sort()) {
      if (prev === null || addDaysEt(prev, 1) !== date) first = date;
      out.set(`${eventKey}|${date}`, `${eventKey}:${first}`);
      prev = date;
    }
  }
  return out;
}

export interface ArmScore { wape: number | null; bias: number | null; sumAbsErr: number; sumErr: number; sumActual: number }
export interface ShopScore { n: number; baseline: ArmScore; candidate: ArmScore; relGain: number | null }
export interface ScopeResult extends ShopScore {
  scope: ScoreScope;
  excluded: { missingActual: number; missingForecast: number };
  byShop: Record<string, ShopScore>;
  /** Distinct episodes with at least one scored row in THIS scope. */
  episodes: number;
  weekBlocks: number;
  /** The bootstrap bound on the relative gain; null when it cannot be computed. */
  bootstrapLower: number | null;
}

type Usable = PairedRow & { baseline: number; candidate: number; actual: number };
function arm(rows: ReadonlyArray<Usable>, pick: (r: Usable) => number): ArmScore {
  let sumAbsErr = 0, sumErr = 0, sumActual = 0;
  for (const r of rows) { const e = pick(r) - r.actual; sumErr += e; sumAbsErr += Math.abs(e); sumActual += r.actual; }
  return { wape: sumActual > 0 ? sumAbsErr / sumActual : null, bias: sumActual > 0 ? sumErr / sumActual : null, sumAbsErr, sumErr, sumActual };
}
/** Relative WAPE gain of the candidate over the baseline. Undefined when the baseline WAPE is undefined or 0. */
function relGainOf(baseline: ArmScore, candidate: ArmScore): number | null {
  if (baseline.wape === null || candidate.wape === null || !(baseline.wape > 0)) return null;
  return (baseline.wape - candidate.wape) / baseline.wape;
}
function shopScore(rows: ReadonlyArray<Usable>): ShopScore {
  const baseline = arm(rows, (r) => r.baseline), candidate = arm(rows, (r) => r.candidate);
  return { n: rows.length, baseline, candidate, relGain: relGainOf(baseline, candidate) };
}

/** The Monday of a date's ISO week: the bootstrap's block. */
export function weekBlockOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysEt(date, -((dow + 6) % 7));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Resample whole weeks (all shops of a week together) and read the low quantile of the relative gain. */
function bootstrapLower(rows: ReadonlyArray<Usable>, scope: ScoreScope): { lower: number | null; weekBlocks: number } {
  const blocks = new Map<string, { b: number; c: number }>();
  for (const r of rows) {
    const k = weekBlockOf(r.validDate);
    const s = blocks.get(k) ?? { b: 0, c: 0 };
    s.b += Math.abs(r.baseline - r.actual); s.c += Math.abs(r.candidate - r.actual);
    blocks.set(k, s);
  }
  const list = [...blocks.keys()].sort().map((k) => blocks.get(k)!);
  if (list.length < PASS_RULE.minWeekBlocks) return { lower: null, weekBlocks: list.length };
  const rand = mulberry32(fnv1a(`${scope.target}|${scope.leadDays}|${PASS_RULE.seed}`));
  const gains: number[] = [];
  for (let i = 0; i < PASS_RULE.bootstrapSamples; i += 1) {
    let b = 0, c = 0;
    for (let j = 0; j < list.length; j += 1) { const pick = list[Math.floor(rand() * list.length)]!; b += pick.b; c += pick.c; }
    // sum A cancels in the ratio of two WAPEs over the same rows.
    if (b > 0) gains.push((b - c) / b);
  }
  if (gains.length === 0) return { lower: null, weekBlocks: list.length };
  gains.sort((x, y) => x - y);
  return { lower: gains[Math.min(gains.length - 1, Math.floor(PASS_RULE.bootstrapQuantile * gains.length))]!, weekBlocks: list.length };
}

/** Score ONE scope. Rows of another target or lead are a programming error and throw `mixed_scope`. */
export function scoreScope(rows: ReadonlyArray<PairedRow>, scope: ScoreScope): ScopeResult {
  const usable: Usable[] = [];
  const excluded = { missingActual: 0, missingForecast: 0 };
  for (const r of rows) {
    if (r.target !== scope.target || r.leadDays !== scope.leadDays) throw new Error("mixed_scope");
    if (!finite(r.actual)) { excluded.missingActual += 1; continue; }
    if (!finite(r.baseline) || !finite(r.candidate)) { excluded.missingForecast += 1; continue; }
    usable.push(r as Usable);
  }
  const byShop: Record<string, ShopScore> = {};
  for (const shopId of [...new Set(usable.map((r) => r.shopId))].sort()) byShop[shopId] = shopScore(usable.filter((r) => r.shopId === shopId));
  const boot = bootstrapLower(usable, scope);
  return {
    scope: { target: scope.target, leadDays: scope.leadDays }, ...shopScore(usable), excluded, byShop,
    episodes: new Set(usable.map((r) => r.episodeId).filter((e): e is string => e !== null)).size,
    weekBlocks: boot.weekBlocks, bootstrapLower: boot.lower,
  };
}

export type QualificationFailure =
  | "evidence_not_e2" | "holdout_missing" | "score_undefined" | "gain_below_min" | "bootstrap_lower_not_above_zero"
  | "shop_worse" | "bias_worse" | "sign_mismatch" | "episodes_below_min";

/** What a passing qualification authorizes: exactly this, and nothing next to it. */
export interface QualifiedScope {
  modelHash: string;
  target: DemandTarget;
  leadDays: number;
  /** The shops whose holdout rows are in the evidence, sorted. */
  shopIds: string[];
  evidenceRunId: string;
  holdoutReadId: string;
}

export interface QualificationInput {
  scope: ScoreScope;
  modelHash: string;
  /** The evidence class of the HOLDOUT rows. Only E2 can pass. */
  evidenceClass: EvidenceClass;
  dev: ScopeResult;
  /** null = the holdout has not been read for this model hash and scope. */
  holdout: ScopeResult | null;
  evidenceRunId: string;
  holdoutReadId: string;
}
export interface Qualification { pass: boolean; failures: QualificationFailure[]; scope: ScoreScope; modelHash: string; authorized: QualifiedScope | null }

const sameScope = (a: ScoreScope, b: ScoreScope): boolean => a.target === b.target && a.leadDays === b.leadDays;
const EPS = 1e-12;

/** THE PASS RULE for one scope. Every failed gate is named; a pass names what it authorizes. */
export function qualify(input: QualificationInput): Qualification {
  if (!sameScope(input.dev.scope, input.scope) || (input.holdout !== null && !sameScope(input.holdout.scope, input.scope))) throw new Error("mixed_scope");
  const failures: QualificationFailure[] = [];
  const h = input.holdout;
  if (input.evidenceClass !== "E2") failures.push("evidence_not_e2");
  if (h === null) failures.push("holdout_missing");
  else {
    if (h.relGain === null || h.baseline.bias === null || h.candidate.bias === null) failures.push("score_undefined");
    else {
      if (h.relGain < PASS_RULE.minRelGain - EPS) failures.push("gain_below_min");
      if (Math.abs(h.candidate.bias) > Math.abs(h.baseline.bias) + EPS) failures.push("bias_worse");
      if (!(input.dev.relGain !== null && input.dev.relGain > 0 && h.relGain > 0)) failures.push("sign_mismatch");
    }
    if (!(h.bootstrapLower !== null && h.bootstrapLower > 0)) failures.push("bootstrap_lower_not_above_zero");
    if (Object.values(h.byShop).some((s) => s.relGain !== null && s.relGain < -PASS_RULE.shopMaxRelLoss - EPS)) failures.push("shop_worse");
    if (h.episodes < PASS_RULE.minEpisodes) failures.push("episodes_below_min");
  }
  const pass = failures.length === 0;
  return {
    pass, failures, scope: input.scope, modelHash: input.modelHash,
    authorized: pass && h !== null ? {
      modelHash: input.modelHash, target: input.scope.target, leadDays: input.scope.leadDays,
      shopIds: Object.keys(h.byShop).sort(), evidenceRunId: input.evidenceRunId, holdoutReadId: input.holdoutReadId,
    } : null,
  };
}

/** Does this qualification authorize THIS use? The exact model, target, lead and shop, or nothing. */
export function authorizes(q: QualifiedScope | null, use: { modelHash: string; target: DemandTarget; leadDays: number; shopId: string }): boolean {
  return q !== null && q.modelHash === use.modelHash && q.target === use.target && q.leadDays === use.leadDays && q.shopIds.includes(use.shopId);
}

/** In a combined model each signal must help when left out and added back: the full model's WAPE is strictly lower. Same scope only. */
export function signalHelpsInCombination(full: ScopeResult, without: ScopeResult): boolean {
  if (!sameScope(full.scope, without.scope)) throw new Error("mixed_scope");
  return full.candidate.wape !== null && without.candidate.wape !== null && full.candidate.wape < without.candidate.wape - EPS;
}

/**
 * DYNAMIC PARS — the nightly RUN's pure assembly rules.
 *
 * PURE: client-safe, zero I/O, no server imports. Extracted out of lib/dynamic-pars.ts
 * under the AGENTS.md rule "new mixed modules should separate pure math so it CAN be
 * tested" — lib/dynamic-pars.ts carries `import "server-only"`, so anything left inside it
 * is unreachable from vitest, and three of the decisions below are exactly the ones a
 * regression would be silent about:
 *
 *   · the product-grain rollup PER DATE (a primary flip must not read as demand collapse),
 *   · the hysteresis prior + the simulated budget (the idempotence of a re-invocation
 *     lives entirely in which rows these two count),
 *   · the run tally (the reason histogram IS this phase's success measure).
 *
 * lib/dynamic-pars.ts holds the I/O and the ORDER; this module holds the arithmetic.
 */
import { rollupUsageByProduct } from "@/lib/products-shared";
import { DYNAMIC_PARS, type DayClass, type ParReasonCode } from "@/lib/dynamic-pars-shared";

/** The state home for one (sku, day-class) slot. Two values, ever. */
export const slotKey = (skuId: string, dayClass: DayClass): string => `${skuId}:${dayClass}`;

// ─────────────────────────────────────────────────────────────────────────────
// The product-grain rollup, per date
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum `value` per (date, sku), then apply the ONE shipped product rollup to each date so
 * twins net at product grain while the map stays SKU-keyed.
 *
 * WHY PER DATE AND NOT OVER THE WHOLE WINDOW (r1-3): depletion rows are stamped with the
 * RESOLVED member, so at SKU grain a primary flip reads as demand collapse on one twin and
 * a spike on the other. Rolling the WINDOW would fix the total and still leave the daily
 * series — which is what velocity and the peak floor read — wrong on exactly the days the
 * flip straddles. `rollupUsageByProduct` (lib/products-shared.ts, test-pinned) is reused
 * rather than re-expressed: a second rollup is a second opinion about how twins net.
 *
 * Zero and non-finite values are dropped, so an absent key means "no demand", never "0 oz
 * recorded" — which is the distinction computeBaseRate's TRUE-ZERO rule depends on.
 */
export function rollupPerDate<T>(
  source: ReadonlyArray<T>,
  dateOf: (r: T) => string,
  skuOf: (r: T) => string,
  valueOf: (r: T) => number,
  productBySku: ReadonlyMap<string, string>,
): Map<string, Map<string, number>> {
  const raw = new Map<string, Map<string, number>>();
  for (const r of source) {
    const date = dateOf(r);
    if (!date) continue;
    const v = valueOf(r);
    if (!Number.isFinite(v) || v === 0) continue;
    const sku = skuOf(r);
    const perSku = raw.get(date) ?? new Map<string, number>();
    perSku.set(sku, (perSku.get(sku) ?? 0) + v);
    raw.set(date, perSku);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [date, perSku] of raw) out.set(date, rollupUsageByProduct(perSku, productBySku));
  return out;
}

/** One SKU's slice of a (date → sku → oz) map, in the shape the pure core wants. */
export function perSkuSeries(
  byDate: ReadonlyMap<string, ReadonlyMap<string, number>>,
  skuId: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [date, perSku] of byDate) {
    const v = perSku.get(skuId);
    if (v != null && v !== 0) out.set(date, v);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The hysteresis prior + the simulated budget
// ─────────────────────────────────────────────────────────────────────────────

/** A `par_auto_moves` row, as much of it as these two rules read. */
export interface LedgerPriorInputRow {
  skuId: string;
  dayClass: string;
  runDate: string;
  outcome: string;
  currentPar: number | null;
  suggestedPar: number | null;
  generationId: string | null;
}

/** A `par_suggestion_actions` row, as much of it as the budget reads. */
export interface SuggestionActionRow {
  skuId: string;
  dayClass: string;
  action: string;
}

export interface LedgerPrior {
  suggestedPar: number | null;
  generationId: string | null;
  /** sign(suggested − current) on the previous run. 0 = no move proposed. */
  direction: number;
}

export interface PriorAndBudget {
  priorBySlot: Map<string, LedgerPrior>;
  budgetSpentBySlot: Set<string>;
}

/**
 * THE PRIOR AND THE BUDGET, and the two exclusions that make a re-invocation idempotent.
 *
 * ① THE PRIOR is the newest row STRICTLY BEFORE `runDateEt`. Excluding this run's own row
 *    is what lets the nightly job be invoked twice for one date and reach the same verdict:
 *    the first invocation's opinion is about to be deleted and replaced, so treating it as
 *    "what the previous run thought" would make the second invocation confirm a direction
 *    against itself and auto-apply something the first one only suggested.
 *
 * ② THE BUDGET counts `applied` rows ALWAYS — they record a REAL par write, which really
 *    did spend the week's move — but counts `would_apply` rows only from EARLIER runs, for
 *    the same reason: a retry must not suppress what the first invocation allowed
 *    (projects r3 P2-10). Reverts count too (r2-8 final form: they are non-manual-origin
 *    par writes and the budget is what stops a revert war); ACCEPTS ARE FREE, because the
 *    incentive must never punish engagement, and dismisses change nothing at all.
 *
 * The budget is a COUNT OVER THE RECOMPUTABLE LEDGER, not a persistent counter (projects
 * r3 P2-7). In shadow that is a genuine longitudinal simulation of the guard; on the day a
 * location goes live the counter is not phantom-spent, because live mode's `applied` rows
 * are the only ones that will exist going forward and the simulated ones age out of the
 * 7-day window inside a week.
 *
 * `rows` must arrive newest-first (run_date DESC, id DESC) — the caller's stable order.
 */
export function derivePriorAndBudget(
  rows: ReadonlyArray<LedgerPriorInputRow>,
  actions: ReadonlyArray<SuggestionActionRow>,
  args: { runDateEt: string; budgetFrom: string },
): PriorAndBudget {
  const priorBySlot = new Map<string, LedgerPrior>();
  const budgetCount = new Map<string, number>();

  for (const r of rows) {
    if (r.dayClass !== "weekday" && r.dayClass !== "weekend") continue;
    const key = slotKey(r.skuId, r.dayClass);

    if (r.runDate < args.runDateEt && !priorBySlot.has(key)) {
      priorBySlot.set(key, {
        suggestedPar: r.suggestedPar,
        generationId: r.generationId,
        direction:
          r.suggestedPar != null && r.currentPar != null
            ? Math.sign(r.suggestedPar - r.currentPar)
            : 0,
      });
    }

    if (r.runDate < args.budgetFrom) continue;
    const counts =
      r.outcome === "applied" ||
      (r.outcome === "would_apply" && r.runDate < args.runDateEt);
    if (counts) budgetCount.set(key, (budgetCount.get(key) ?? 0) + 1);
  }

  for (const a of actions) {
    if (a.action !== "revert") continue;
    if (a.dayClass !== "weekday" && a.dayClass !== "weekend") continue;
    const key = slotKey(a.skuId, a.dayClass);
    budgetCount.set(key, (budgetCount.get(key) ?? 0) + 1);
  }

  const budgetSpentBySlot = new Set<string>();
  for (const [key, n] of budgetCount) {
    if (n >= DYNAMIC_PARS.BUDGET_MOVES) budgetSpentBySlot.add(key);
  }
  return { priorBySlot, budgetSpentBySlot };
}

/**
 * Has the direction been confirmed across two consecutive runs (r1-6)?
 *
 * Step-rounding a continuous target oscillates 2.49 <-> 2.51 forever without this. A prior
 * that proposed NO move (direction 0) confirms nothing — the first night of any new move
 * is always a suggestion, and the second is the earliest it can become an auto-move.
 */
export function directionConfirmed(
  prior: LedgerPrior | null | undefined,
  currentPar: number | null,
  roundedTarget: number,
): boolean {
  if (prior == null || prior.direction === 0 || currentPar == null) return false;
  return prior.direction === Math.sign(roundedTarget - currentPar);
}

// ─────────────────────────────────────────────────────────────────────────────
// The run tally — the reason histogram this phase is measured by
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of a ledger row the tally reads. */
export interface TallyRow {
  outcome: string;
  tier: string;
  suppressedBy: string | null;
  reasonCode: ParReasonCode;
}

export interface ParRunCounts {
  rows: number;
  wouldApply: number;
  applied: number;
  suggestion: number;
  advisoryNull: number;
  suppressedBy: Record<string, number>;
  byReason: Record<string, number>;
}

/**
 * The ONE run-level audit row's payload. 282 per-SKU rows a night would be ~21x the entire
 * audit log annually (r3), so the night's whole story has to fit in this object: how many
 * rows, what each guard stopped, and the full reason histogram — which IS the reason lane,
 * recorded every night whether or not anyone opens the walker.
 */
export function tallyRun(ledger: ReadonlyArray<TallyRow>): ParRunCounts {
  const counts: ParRunCounts = {
    rows: ledger.length, wouldApply: 0, applied: 0, suggestion: 0, advisoryNull: 0,
    suppressedBy: {}, byReason: {},
  };
  for (const r of ledger) {
    if (r.outcome === "would_apply") counts.wouldApply += 1;
    if (r.outcome === "applied") counts.applied += 1;
    if (r.outcome === "advisory_null") counts.advisoryNull += 1;
    if (r.tier === "suggestion") counts.suggestion += 1;
    if (r.suppressedBy != null) {
      counts.suppressedBy[r.suppressedBy] = (counts.suppressedBy[r.suppressedBy] ?? 0) + 1;
    }
    counts.byReason[r.reasonCode] = (counts.byReason[r.reasonCode] ?? 0) + 1;
  }
  return counts;
}

/**
 * W4c-a catering surplus — which released reservations are a real CANCELLATION (audit W22/B124). Pure, no I/O.
 *
 * A `released` prep-demand row is written by more than a cancellation: every re-reserve (quote revise,
 * re-confirm), a reschedule (0329) and a shop transfer (0225) retire the lead's reserved rows and append a
 * fresh copy. Counting every released row as surplus made revised, rescheduled, transferred and completed
 * orders show up as leftover food that does not exist. A released row is surplus ONLY when all three hold:
 *   1. its lead holds NO reserved or consumed row anywhere (any shop) — the order is not still on, and was
 *      not served;
 *   2. its lead's stage is `lost`, `inquiry` or `quote_sent` — the order was actually called off;
 *   3. it belongs to the lead's LAST release batch: its `created_at` equals the `created_at` of the lead's
 *      most recently released row. `created_at` defaults to now(), fixed per transaction, so one reserve /
 *      transfer / reschedule batch shares one value; `released_at` cannot identify a batch (the 0225
 *      transfer stamps clock_timestamp(), row by row). Earlier batches are superseded copies, not more food.
 */
export interface ReleasedCandidate {
  pipeline_id: string;
  created_at: string;
}

export interface CancellationContext {
  /** Leads with at least one reserved or consumed row, at any shop. */
  liveByPipeline: ReadonlySet<string>;
  /** The lead's current stage. A lead missing here is treated as not cancelled. */
  stageByPipeline: ReadonlyMap<string, string>;
  /** The created_at of each lead's most recently released row (its last release batch). */
  latestBatchCreatedAt: ReadonlyMap<string, string>;
}

export const CANCELLED_STAGES: ReadonlySet<string> = new Set(["lost", "inquiry", "quote_sent"]);

export function selectCancellationRows<T extends ReleasedCandidate>(released: readonly T[], ctx: CancellationContext): T[] {
  return released.filter((r) => {
    if (ctx.liveByPipeline.has(r.pipeline_id)) return false;
    const stage = ctx.stageByPipeline.get(r.pipeline_id);
    if (stage === undefined || !CANCELLED_STAGES.has(stage)) return false;
    return ctx.latestBatchCreatedAt.get(r.pipeline_id) === r.created_at;
  });
}

/** The created_at of each lead's most recently released row (a tie on released_at: the later created_at). */
export function latestReleaseBatch(rows: ReadonlyArray<{ pipeline_id: string; created_at: string; released_at: string | null }>): Map<string, string> {
  const best = new Map<string, { releasedAt: number; createdAt: string }>();
  for (const r of rows) {
    if (r.released_at == null) continue;
    const at = Date.parse(r.released_at);
    const cur = best.get(r.pipeline_id);
    if (!cur || at > cur.releasedAt || (at === cur.releasedAt && r.created_at > cur.createdAt)) {
      best.set(r.pipeline_id, { releasedAt: at, createdAt: r.created_at });
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.createdAt]));
}

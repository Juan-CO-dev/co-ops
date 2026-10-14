/**
 * Mid-day prep — CLIENT-SAFE pure rules the page, the form and the finalize share.
 *
 * Astra Phase A review P1 #2 (BC-013/034), reproduced on the branch: 0215's Phase 1 RPC now
 * derives `inputs.total` (LINE + BACK UP) for a batch item, and the Phase 2 page read any
 * `inputs.total` as "the opener prepped this" — so counting 2 + 8 initialised the row as a
 * SAVED bottling of 10, and finalize could close the instance without a single batch save.
 *
 * The rule, in one place: on a BATCH item a Phase 2 save exists ONLY when the live completion
 * carries a `batch` object (the Phase 2 RPC writes it; the Phase 1 RPC never does). On every
 * other item the pre-0215 rule stands — `inputs.total` is the Phase 2 write.
 *
 * "Batch item" here is IDENTITY — `recipe.batch_mode` — never eligibility (Astra r2 P1): a
 * batch_mode recipe the graph cannot resolve is still a batch recipe, so its count is never a
 * save and it blocks finalize (the row shows "recipe needs fixing") until a GM fixes the recipe
 * and the row is saved explicitly.
 */
import { batchFormFromRecord, readBatchFromPrepData, type BatchFormValue } from "@/lib/batch-prep-shared";

export interface MidDayPhase2RowSeed {
  /** The number the "prepped / bottled" box starts with; null = nothing saved yet. */
  initialPrepped: number | null;
  /** The batch half already saved today (batch items only). */
  initialBatch: BatchFormValue | null;
  /** True iff a Phase 2 save exists for this row. Drives the "saved" badge and the finalize gate. */
  saved: boolean;
}

function readTotal(prepData: unknown): number | null {
  if (prepData === null || prepData === undefined || typeof prepData !== "object") return null;
  const inputs = (prepData as { inputs?: unknown }).inputs;
  if (inputs === null || inputs === undefined || typeof inputs !== "object") return null;
  const total = (inputs as { total?: unknown }).total;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

/** What the Phase 2 row starts with, from the item's live completion (Phase 1's count row, or a Phase 2 save). */
export function midDayPhase2RowSeed(prepData: unknown, batchMode: boolean): MidDayPhase2RowSeed {
  if (batchMode) {
    const record = readBatchFromPrepData(prepData);
    return record
      ? { initialPrepped: record.bottled, initialBatch: batchFormFromRecord(record), saved: true }
      : { initialPrepped: null, initialBatch: null, saved: false };
  }
  const total = readTotal(prepData);
  return { initialPrepped: total, initialBatch: null, saved: total !== null };
}

/**
 * The template items whose Phase 2 save is still missing and would be hidden by a count:
 * batch_mode items (per `batchModeByTemplateItemId` — identity, not eligibility) without a
 * `batch` object on their live completion. Finalize refuses while this is non-empty.
 */
export function midDayFinalizeBlockers(
  templateItems: ReadonlyArray<{ id: string }>,
  liveCompletions: ReadonlyArray<{ templateItemId: string; completedAt: string; prepData: unknown }>,
  batchModeByTemplateItemId: Record<string, boolean>,
): string[] {
  const latest = new Map<string, { completedAt: string; prepData: unknown }>();
  for (const c of liveCompletions) {
    const prev = latest.get(c.templateItemId);
    if (!prev || c.completedAt > prev.completedAt) latest.set(c.templateItemId, { completedAt: c.completedAt, prepData: c.prepData });
  }
  const out: string[] = [];
  for (const it of templateItems) {
    if (batchModeByTemplateItemId[it.id] !== true) continue;
    if (!midDayPhase2RowSeed(latest.get(it.id)?.prepData, true).saved) out.push(it.id);
  }
  return out;
}

/** One row of the read-only finalized mid-day view (B1 #2). */
export interface MidDayFinalizedRow {
  id: string;
  label: string;
  /** System key (prep_meta.section, else station, else "Misc") — render via resolveSectionLabel. */
  section: string;
  parUnit: string | null;
  /** max(par − counted on hand, 0); null when the item has no par or no count. */
  need: number | null;
  /** What the Phase 2 save recorded (bottled on a batch item); null = never saved. */
  made: number | null;
}

function readOnHand(prepData: unknown): number | null {
  if (prepData === null || prepData === undefined || typeof prepData !== "object") return null;
  const inputs = (prepData as { inputs?: unknown }).inputs;
  if (inputs === null || inputs === undefined || typeof inputs !== "object") return null;
  const onHand = (inputs as { onHand?: unknown }).onHand;
  return typeof onHand === "number" && Number.isFinite(onHand) ? onHand : null;
}

/**
 * B1 #2 — the rows of a FINALIZED mid-day prep (status phase2_complete), read-only: per
 * template item (template order) the latest live completion's count gives the need and its
 * Phase 2 save gives "made". "Made" follows midDayPhase2RowSeed, so a Phase 1 count is never
 * shown as made and a batch item shows its BOTTLED number, never the derived count total.
 */
export function midDayFinalizedRows(
  templateItems: ReadonlyArray<{
    id: string;
    label: string;
    station?: string | null;
    prepMeta?: { section?: string | null; parValue?: number | null; parUnit?: string | null } | null;
  }>,
  liveCompletions: ReadonlyArray<{ templateItemId: string; completedAt: string; prepData: unknown }>,
  batchModeByTemplateItemId: Record<string, boolean> = {},
): MidDayFinalizedRow[] {
  const latest = new Map<string, { completedAt: string; prepData: unknown }>();
  for (const c of liveCompletions) {
    const prev = latest.get(c.templateItemId);
    if (!prev || c.completedAt > prev.completedAt) latest.set(c.templateItemId, { completedAt: c.completedAt, prepData: c.prepData });
  }
  return templateItems.map((it) => {
    const prepData = latest.get(it.id)?.prepData;
    const par = it.prepMeta?.parValue ?? null;
    const onHand = readOnHand(prepData);
    const seed = midDayPhase2RowSeed(prepData, batchModeByTemplateItemId[it.id] === true);
    return {
      id: it.id,
      label: it.label,
      section: it.prepMeta?.section ?? it.station ?? "Misc",
      parUnit: it.prepMeta?.parUnit ?? null,
      need: par !== null && onHand !== null ? Math.max(par - onHand, 0) : null,
      made: seed.saved ? seed.initialPrepped : null,
    };
  });
}

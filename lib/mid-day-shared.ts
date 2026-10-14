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
  /** The item name FROZEN in the record's snapshot (C.44); the template label only without one. */
  label: string;
  /** System key (snapshot section, else prep_meta.section, else station, else "Misc") — render via resolveSectionLabel. */
  section: string;
  parUnit: string | null;
  /** The saved need: a batch save's need_for_line, else max(snapshot par − counted on hand, 0); null when no par or no count. */
  need: number | null;
  /** What the Phase 2 save recorded (bottled on a batch save); null = never saved. */
  made: number | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && v !== undefined && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The C.44 snapshot the save froze (prep_data.snapshot), or null when the record carries none. */
function readSnapshot(prepData: unknown): { section: string | null; itemName: string | null; parValue: number | null; parUnit: string | null } | null {
  const snap = asRecord(asRecord(prepData)?.snapshot);
  if (!snap) return null;
  return {
    section: typeof snap.section === "string" && snap.section !== "" ? snap.section : null,
    itemName: typeof snap.itemName === "string" && snap.itemName !== "" ? snap.itemName : null,
    parValue: finiteOrNull(snap.parValue),
    parUnit: typeof snap.parUnit === "string" ? snap.parUnit : null,
  };
}

/**
 * What a persisted mid-day record says was MADE, read from the record's own shape — never from
 * today's batch-mode flag (Astra review: switching a recipe to batch mode after finalize must not
 * blank history, and vice versa):
 *  - a `batch` object → a batch Phase 2 save → its BOTTLED number;
 *  - else `inputs.total` is a Phase 2 save UNLESS the record is a batch Phase 1 count: the only
 *    writer of a total without a Phase 2 save is 0215's Phase 1 RPC, which always writes
 *    `inputs.backUp` and never the `overUnder` key (every Phase 2 save since 0064 writes it;
 *    pre-0215 Phase 1 never wrote a total or a backUp, so legacy 0061/0062 saves read as made).
 */
export function midDayMadeFromRecord(prepData: unknown): number | null {
  const batch = readBatchFromPrepData(prepData);
  if (batch) return batch.bottled;
  const total = readTotal(prepData);
  if (total === null) return null;
  const rec = asRecord(prepData)!;
  const inputs = asRecord(rec.inputs);
  const phase1BatchCount = !("overUnder" in rec) && typeof inputs?.backUp === "number";
  return phase1BatchCount ? null : total;
}

/**
 * B1 #2 — the rows of a FINALIZED mid-day prep (status phase2_complete), read-only.
 *
 * THE UNIVERSE IS THE SAVED RECORDS (Astra re-review, C.44): one row per template item that has
 * a live completion on the instance (its latest one) — never today's active template list. An
 * item deactivated after finalize keeps its saved row; an item added after finalize, which has
 * no record, does not appear. (Mid-day Phase 1 submits an entry for every item, so the records
 * are exactly the items that existed when the prep ran; mid-day has no 0197-style finalize
 * universe of its own — finalize only gates unsaved batch rows.)
 *
 * History is read from the RECORD: name, section, par and unit come from the snapshot the save
 * froze, the need from the saved batch need or the snapshot par, and "made" from the record's
 * own shape (midDayMadeFromRecord). Template metadata only fills in for a record with no
 * snapshot. Order: still-listed items in template order, then the rest by section, name, id.
 */
export function midDayFinalizedRows(
  templateItems: ReadonlyArray<{
    id: string;
    label: string;
    station?: string | null;
    prepMeta?: { section?: string | null; parValue?: number | null; parUnit?: string | null } | null;
  }>,
  liveCompletions: ReadonlyArray<{ templateItemId: string; completedAt: string; prepData: unknown }>,
): MidDayFinalizedRow[] {
  const latest = new Map<string, { completedAt: string; prepData: unknown }>();
  for (const c of liveCompletions) {
    const prev = latest.get(c.templateItemId);
    if (!prev || c.completedAt > prev.completedAt) latest.set(c.templateItemId, { completedAt: c.completedAt, prepData: c.prepData });
  }
  const templateIndex = new Map(templateItems.map((it, i) => [it.id, i] as const));

  const rows: MidDayFinalizedRow[] = [];
  for (const [id, { prepData }] of latest) {
    const it = templateItems[templateIndex.get(id) ?? -1];
    const snap = readSnapshot(prepData);
    const par = snap ? snap.parValue : (it?.prepMeta?.parValue ?? null);
    const onHand = finiteOrNull(asRecord(asRecord(prepData)?.inputs)?.onHand);
    const savedBatchNeed = readBatchFromPrepData(prepData)?.needForLine ?? null;
    rows.push({
      id,
      label: snap?.itemName ?? it?.label ?? "—",
      section: snap?.section ?? it?.prepMeta?.section ?? it?.station ?? "Misc",
      parUnit: snap ? snap.parUnit : (it?.prepMeta?.parUnit ?? null),
      need: savedBatchNeed ?? (par !== null && onHand !== null ? Math.max(par - onHand, 0) : null),
      made: midDayMadeFromRecord(prepData),
    });
  }

  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return rows.sort((a, b) => {
    const ia = templateIndex.get(a.id);
    const ib = templateIndex.get(b.id);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return cmp(a.section, b.section) || cmp(a.label, b.label) || cmp(a.id, b.id);
  });
}

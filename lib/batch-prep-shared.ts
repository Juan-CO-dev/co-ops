/**
 * Batch vs bottle — CLIENT-SAFE pure core (plan S r4, Phase A). Zero I/O, no server imports.
 *
 * Juan (2026-10-06): "Prep is conflating 2 things, creating the recipe batch and getting it
 * ready for service… we make the minimum batch, bottle 2 for service and leave the other 2 in
 * a single container to bottle when needed." The model (S): the bulk container is COUNTED at
 * every prep session (last night's AM prep BACK UP or the opener's two-box recount at
 * opening; the mid-day Phase 1 two-box count at mid-day). A batch row enters batches made,
 * what they came out to, what was bottled for the line and what (if anything) was tossed;
 * ingredients deplete once per BATCH, never per bottle.
 *
 * Everything here is PREVIEW + validation math for the two rows and the parsers for the
 * stored `batch` object. The RPCs (0215) are authoritative and re-derive all of it; this
 * module exists so the row can show the same numbers the server will accept and so the
 * arithmetic is testable without a database.
 */

/** Addendum 2 (Juan): one tap from this list; only `other` opens a short required note. */
export const OVER_BATCH_REASON_CODES = ["catering_order", "busy_day_expected", "prepping_ahead", "other"] as const;
export type OverBatchReasonCode = (typeof OVER_BATCH_REASON_CODES)[number];
export interface OverBatchReason { code: OverBatchReasonCode; note: string | null }

/** The stepper's native range is 0/1/2/3; above it the row asks "Are you sure?" once (a typo guard, never a block). */
export const BATCH_STEPPER_MAX = 3;

/** What a batch row sends with its save (the `p_batch` wire shape, camelCase on the client). */
export interface BatchEntry {
  /** Whole batches made, >= 0. */
  batches: number;
  /** Measured output in the item's par unit; required when batches > 0 (pre-filled batches × yield). */
  cameOutTo: number | null;
  /** This session's toss of the counted bulk backup, 0 <= tossed <= backupBefore. */
  tossed: number;
  overBatchReason: OverBatchReason | null;
}

export type BatchValidationCode =
  | "batches_missing"
  | "invalid_batch_count"
  | "came_out_to_missing"
  | "invalid_came_out_to"
  | "invalid_tossed"
  | "tossed_exceeds_backup"
  | "bottled_missing"
  | "invalid_bottled"
  | "bottled_exceeds_available"
  | "over_batch_reason_missing"
  | "over_batch_note_required"
  | "invalid_over_batch_reason";

export function isOverBatchReasonCode(v: unknown): v is OverBatchReasonCode {
  return typeof v === "string" && (OVER_BATCH_REASON_CODES as readonly string[]).includes(v);
}

/** need_for_line = max(0, par − LINE). Null when either side is unknown (par-null item, no count). */
export function needForLine(par: number | null, line: number | null): number | null {
  if (par === null || line === null || !Number.isFinite(par) || !Number.isFinite(line)) return null;
  return Math.max(0, par - line);
}

/** Ruling B: what can reach the line this session. */
export function availableForLine(backupBefore: number, tossed: number, cameOutTo: number): number {
  return backupBefore - tossed + cameOutTo;
}

/** Ruling B: backup_after = before − tossed + came_out_to − bottled. */
export function backupAfter(backupBefore: number, tossed: number, cameOutTo: number, bottled: number): number {
  return availableForLine(backupBefore, tossed, cameOutTo) - bottled;
}

/**
 * Minimum whole batches so that (backup − tossed) + batches × yield >= need. Null when the
 * need is unknown (par-null item): then there is no "minimum" and the over-batch gate is off.
 */
export function minBatches(need: number | null, backupBefore: number, tossed: number, yieldPerBatch: number): number | null {
  if (need === null) return null;
  if (!(yieldPerBatch > 0)) return null;
  const onHandBulk = backupBefore - tossed;
  if (onHandBulk >= need) return 0;
  return Math.ceil((need - onHandBulk) / yieldPerBatch);
}

export function isOverBatch(batches: number, minimum: number | null): boolean {
  return minimum !== null && batches > minimum;
}

export function needsTypoGuard(batches: number): boolean {
  return batches > BATCH_STEPPER_MAX;
}

/** The pre-fill for "came out to": the usual amount, batches × the recipe's yield. */
export function defaultCameOutTo(batches: number, yieldPerBatch: number): number {
  return batches * yieldPerBatch;
}

/** The opener's two boxes → the Phase 1 total the RPC derives (line + back up); null unless both present. */
export function recountTotal(line: number | null, backUp: number | null): number | null {
  if (line === null || backUp === null) return null;
  if (!Number.isFinite(line) || !Number.isFinite(backUp) || line < 0 || backUp < 0) return null;
  return line + backUp;
}

/** Whole non-negative number (the stepper's output; also what the RPC's regex accepts). */
export function isWholeCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function validateOverBatchReason(
  raw: unknown,
): { ok: true; reason: OverBatchReason | null } | { ok: false; code: "invalid_over_batch_reason" | "over_batch_note_required" } {
  if (raw === null || raw === undefined) return { ok: true, reason: null };
  if (typeof raw !== "object") return { ok: false, code: "invalid_over_batch_reason" };
  const r = raw as Record<string, unknown>;
  if (!isOverBatchReasonCode(r.code)) return { ok: false, code: "invalid_over_batch_reason" };
  const note = typeof r.note === "string" ? r.note.trim() : "";
  if (r.code === "other" && note.length === 0) return { ok: false, code: "over_batch_note_required" };
  return { ok: true, reason: { code: r.code, note: note.length > 0 ? note : null } };
}

/**
 * The row's client-side mirror of the RPC gates, in the RPC's order, so a row never POSTs a
 * payload the server would refuse. `bottled` is the row's opener_prepped / prepped number.
 */
export function validateBatchEntry(
  entry: { batches: unknown; cameOutTo: unknown; tossed: unknown; overBatchReason: unknown },
  ctx: { bottled: number | null; backupBefore: number; need: number | null; yieldPerBatch: number },
): { ok: true; entry: BatchEntry; minBatches: number | null; backupAfter: number } | { ok: false; code: BatchValidationCode } {
  if (entry.batches === null || entry.batches === undefined) return { ok: false, code: "batches_missing" };
  if (!isWholeCount(entry.batches)) return { ok: false, code: "invalid_batch_count" };
  const batches = entry.batches;
  let cameOutTo: number;
  if (batches > 0) {
    if (entry.cameOutTo === null || entry.cameOutTo === undefined) return { ok: false, code: "came_out_to_missing" };
    if (typeof entry.cameOutTo !== "number" || !Number.isFinite(entry.cameOutTo) || entry.cameOutTo < 0) return { ok: false, code: "invalid_came_out_to" };
    cameOutTo = entry.cameOutTo;
  } else {
    if (entry.cameOutTo !== null && entry.cameOutTo !== undefined && entry.cameOutTo !== 0) return { ok: false, code: "invalid_came_out_to" };
    cameOutTo = 0;
  }
  const tossedRaw = entry.tossed === null || entry.tossed === undefined ? 0 : entry.tossed;
  if (typeof tossedRaw !== "number" || !Number.isFinite(tossedRaw) || tossedRaw < 0) return { ok: false, code: "invalid_tossed" };
  if (tossedRaw > ctx.backupBefore) return { ok: false, code: "tossed_exceeds_backup" };
  if (ctx.bottled === null) return { ok: false, code: "bottled_missing" };
  if (!Number.isFinite(ctx.bottled) || ctx.bottled < 0) return { ok: false, code: "invalid_bottled" };
  const available = availableForLine(ctx.backupBefore, tossedRaw, cameOutTo);
  if (ctx.bottled > available) return { ok: false, code: "bottled_exceeds_available" };
  const min = minBatches(ctx.need, ctx.backupBefore, tossedRaw, ctx.yieldPerBatch);
  const reason = validateOverBatchReason(entry.overBatchReason);
  if (!reason.ok) return { ok: false, code: reason.code };
  if (isOverBatch(batches, min) && reason.reason === null) return { ok: false, code: "over_batch_reason_missing" };
  return {
    ok: true,
    entry: { batches, cameOutTo, tossed: tossedRaw, overBatchReason: reason.reason },
    minBatches: min,
    backupAfter: available - ctx.bottled,
  };
}

/** The wire shape the RPC reads (`p_batch`); snake_case, numbers as numbers. */
export function toBatchPayload(entry: BatchEntry): {
  batches: number; came_out_to: number | null; tossed: number;
  over_batch_reason: { code: OverBatchReasonCode; note: string | null } | null;
} {
  return {
    batches: entry.batches,
    came_out_to: entry.batches > 0 ? entry.cameOutTo : 0,
    tossed: entry.tossed,
    over_batch_reason: entry.overBatchReason ? { code: entry.overBatchReason.code, note: entry.overBatchReason.note } : null,
  };
}

/** Eligibility as the lib and the RPC both see it (ruling 8 / Astra r3 #2). */
export type BatchEligibility = "single_box" | "batched" | "blocked";
export function batchEligibility(ctx: { batchMode: boolean; outputCount: number; yieldPerBatch: number | null; resolvable: boolean }): BatchEligibility {
  if (!ctx.batchMode) return "single_box";
  if (ctx.outputCount !== 1 || ctx.yieldPerBatch === null || !(ctx.yieldPerBatch > 0) || !ctx.resolvable) return "blocked";
  return "batched";
}

/**
 * One registry item's batch context as the forms receive it (loaded server-side by
 * lib/batch-prep.ts loadBatchContextForItems; the type lives here so client components can
 * name it without importing the service-role module).
 */
export interface BatchItemContext {
  itemId: string;
  recipeId: string;
  recipeName: string;
  batchMode: boolean;
  shelfLifeDays: number;
  outputCount: number;
  /** The item's own output yield (par units per batch) on that recipe; null when 0 / unknown. */
  yieldPerBatch: number | null;
  /** batch_mode AND one output AND it is this item AND yield > 0 — what the RPC calls is_batch. */
  isBatch: boolean;
  /** single_box = not batch_mode; batched = isBatch; blocked = batch_mode but ineligible (the row refuses to save). */
  eligibility: BatchEligibility;
}

/** Shelf life: "made on" + shelf_life_days is before today → the backup is past its life. */
export function isPastShelfLife(madeOnIso: string | null, shelfLifeDays: number, todayIso: string): boolean {
  if (madeOnIso === null || !(shelfLifeDays > 0)) return false;
  const made = new Date(`${madeOnIso.slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${todayIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(made.getTime()) || Number.isNaN(today.getTime())) return false;
  const ageDays = Math.floor((today.getTime() - made.getTime()) / 86_400_000);
  return ageDays > shelfLifeDays;
}

/** The stored `batch` object (prep_data.phase2.batch at opening, prep_data.batch at mid-day), read back. */
export interface BatchRecord {
  batches: number;
  cameOutTo: number;
  bottled: number;
  tossed: number;
  backupBefore: number;
  backupAfter: number;
  lineCount: number | null;
  needForLine: number | null;
  minBatches: number | null;
  yieldAtTime: number | null;
  recipeId: string | null;
  overBatchReason: OverBatchReason | null;
  producedAt: string | null;
  madeBy: string | null;
  phase1PrepNeed: number | null;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * Reject-whole parser for the stored batch object: the four load-bearing numbers must be
 * finite or the record is null (a half-parsed batch row would render a confident wrong
 * backup). Every other field degrades to null.
 */
export function parseBatchRecord(raw: unknown): BatchRecord | null {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const batches = num(r.batches);
  const bottled = num(r.bottled);
  const backupBefore = num(r.backup_before);
  const backupAfter = num(r.backup_after);
  if (batches === null || bottled === null || backupBefore === null || backupAfter === null) return null;
  const cameOutTo = num(r.came_out_to) ?? 0;
  const tossed = num(r.tossed) ?? 0;
  const reason = validateOverBatchReason(r.over_batch_reason ?? null);
  return {
    batches, cameOutTo, bottled, tossed, backupBefore, backupAfter,
    lineCount: num(r.line_count),
    needForLine: num(r.need_for_line),
    minBatches: num(r.min_batches),
    yieldAtTime: num(r.yield_at_time),
    recipeId: str(r.recipe_id),
    overBatchReason: reason.ok ? reason.reason : null,
    producedAt: str(r.produced_at),
    madeBy: str(r.made_by),
    phase1PrepNeed: num(r.phase1_prep_need),
  };
}

/** Read the batch object off a completion's prep_data (opening nests it under phase2; mid-day is a sibling key). */
export function readBatchFromPrepData(prepData: unknown): BatchRecord | null {
  if (prepData === null || prepData === undefined || typeof prepData !== "object") return null;
  const p = prepData as Record<string, unknown>;
  if (p.phase2 && typeof p.phase2 === "object") {
    const fromPhase2 = parseBatchRecord((p.phase2 as Record<string, unknown>).batch);
    if (fromPhase2) return fromPhase2;
  }
  return parseBatchRecord(p.batch);
}

// ─────────────────────────────────────────────────────────────────────────────
// The row (opening Phase 2 / mid-day Phase 2) — form value + context
// ─────────────────────────────────────────────────────────────────────────────

/** The batch row's controlled form value. `batches` starts at 0 (= bottling from the backup only). */
export interface BatchFormValue {
  batches: number;
  /** null = untouched → the row pre-fills batches × yield at save. */
  cameOutTo: number | null;
  tossed: number;
  overBatchReason: OverBatchReason | null;
}

export function emptyBatchFormValue(): BatchFormValue {
  return { batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null };
}

/** Hydrate the row from a persisted batch object (a re-opened or reloaded row). */
export function batchFormFromRecord(r: BatchRecord): BatchFormValue {
  return { batches: r.batches, cameOutTo: r.cameOutTo, tossed: r.tossed, overBatchReason: r.overBatchReason };
}

/** The wire entry the row POSTs (`entry.batch`): the form value with came_out_to resolved to the pre-fill. */
export function batchEntryFromForm(v: BatchFormValue, yieldPerBatch: number): BatchEntry {
  return {
    batches: v.batches,
    cameOutTo: v.batches > 0 ? (v.cameOutTo ?? defaultCameOutTo(v.batches, yieldPerBatch)) : null,
    tossed: v.tossed,
    overBatchReason: v.overBatchReason,
  };
}

/**
 * What the row knows about the item before any typing: the recipe, the counted bulk backup
 * (the opener's recount BACK UP, else last night's closing BACK UP; the mid-day Phase 1 BACK
 * UP), the LINE count, the need, the last "made on", the session's recorded toss, and whether
 * the recipe is usable at all. Assembled server-side (loaders) or client-side from the
 * snapshot + batch context; the RPC re-derives every number and is the authority.
 */
export interface BatchRowContext {
  recipeName: string;
  yieldPerBatch: number;
  shelfLifeDays: number;
  /** The counted bulk container BEFORE this session; null = unknown (the RPC refuses: backup_unknown). */
  backupBefore: number | null;
  lineCount: number | null;
  /** need_for_line = max(0, par − LINE); null on a par-null item (no minimum, no over-batch gate). */
  need: number | null;
  parUnit: string | null;
  /** Last batch's produced_at for this item at this location (shelf-life red state); null = none on record. */
  madeOn: string | null;
  /** batch_mode but ineligible (multi-output / no yield / unresolvable) — the row BLOCKS. */
  blocked: boolean;
}

/** The P0001 codes save_phase2_item_atomic / save_mid_day_phase2_item_atomic raise for the batch contract (0215). */
export const BATCH_CONTRACT_CODES = [
  "batch_payload_required",
  "batch_payload_not_allowed",
  "template_item_not_in_instance",
  "batch_recipe_unresolved",
  "backup_unknown",
  "batches_missing",
  "invalid_batch_count",
  "came_out_to_missing",
  "invalid_came_out_to",
  "invalid_tossed",
  "tossed_exceeds_backup",
  "invalid_bottled",
  "bottled_exceeds_available",
  "over_batch_reason_missing",
  "over_batch_note_required",
  "invalid_over_batch_reason",
] as const;
export type BatchContractCode = (typeof BATCH_CONTRACT_CODES)[number];
export function isBatchContractCode(v: unknown): v is BatchContractCode {
  return typeof v === "string" && (BATCH_CONTRACT_CODES as readonly string[]).includes(v);
}

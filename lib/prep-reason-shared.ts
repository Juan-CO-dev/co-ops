/**
 * Off-need prep reasons — the ONE pure validator shared by opening Phase 2
 * (app/api/opening/prep/item/route.ts) and mid-day Phase 2 (lib/prep.ts
 * saveMidDayPhase2Item). B11a-floor: mid-day's reason was client-only; it now
 * runs the same rule opening has always run on the server.
 *
 * Client-safe (zero I/O) per the `*-shared.ts` pattern.
 *
 * The rule (opening's, unchanged):
 *   · over  → category in OVER_REASON_CATEGORIES; a management_directive names who
 *             directed it (a users.id); "other" needs a note.
 *   · under → category in UNDER_REASON_CATEGORIES; a note is ALWAYS required.
 *   · when is a reason REQUIRED? Only when there is a numeric need and the amount is off
 *     it. A BATCH row (0215, eligibility "batched") is exempt on the OVER side — bottling
 *     more than the line need is governed by the over-batch reason instead
 *     (save_phase2_item_atomic: `IF NOT v_is_batch AND v_delta > 0 …`); the UNDER side
 *     still requires a reason, exactly as opening's RPC does.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OVER_REASON_CATEGORIES = [
  "management_directive",
  "clear_fridge_space",
  "prevent_expiration",
  "forecast_busy",
  "bulk_efficiency",
  "other",
] as const;
export const UNDER_REASON_CATEGORIES = [
  "ingredient_unavailable",
  "equipment_issue",
  "time_constraint",
  "staff_shortage",
  "other",
] as const;

export type OverReasonCategory = (typeof OVER_REASON_CATEGORIES)[number];
export type UnderReasonCategory = (typeof UNDER_REASON_CATEGORIES)[number];

const OVER_SET: ReadonlySet<string> = new Set(OVER_REASON_CATEGORIES);
const UNDER_SET: ReadonlySet<string> = new Set(UNDER_REASON_CATEGORIES);

export interface ValidOverReason {
  reasonCategory: OverReasonCategory;
  directedBy: string | null;
  freeText: string | null;
}
export interface ValidUnderReason {
  reasonCategory: UnderReasonCategory;
  freeText: string;
}

export type ReasonField = "reasonCategory" | "directedBy" | "freeText";
export type ReasonCheck<T> = { ok: true; value: T } | { ok: false; field: ReasonField };

/** An over-need reason: category in set; directedBy for management_directive; a note for "other". */
export function validateOverReason(raw: Record<string, unknown>): ReasonCheck<ValidOverReason> {
  if (typeof raw.reasonCategory !== "string" || !OVER_SET.has(raw.reasonCategory)) {
    return { ok: false, field: "reasonCategory" };
  }
  const directedBy = raw.directedBy === null || raw.directedBy === undefined ? null : raw.directedBy;
  if (directedBy !== null && (typeof directedBy !== "string" || !UUID_RE.test(directedBy))) {
    return { ok: false, field: "directedBy" };
  }
  if (raw.reasonCategory === "management_directive" && directedBy === null) {
    return { ok: false, field: "directedBy" };
  }
  const freeText = raw.freeText === null || raw.freeText === undefined ? null : raw.freeText;
  if (freeText !== null && typeof freeText !== "string") return { ok: false, field: "freeText" };
  if (raw.reasonCategory === "other" && (freeText === null || freeText.trim() === "")) {
    return { ok: false, field: "freeText" };
  }
  return {
    ok: true,
    value: {
      reasonCategory: raw.reasonCategory as OverReasonCategory,
      directedBy: directedBy as string | null,
      freeText: (freeText as string | null) ?? null,
    },
  };
}

/** An under-need reason: category in set; a note is always required. */
export function validateUnderReason(raw: Record<string, unknown>): ReasonCheck<ValidUnderReason> {
  if (typeof raw.reasonCategory !== "string" || !UNDER_SET.has(raw.reasonCategory)) {
    return { ok: false, field: "reasonCategory" };
  }
  if (typeof raw.freeText !== "string" || raw.freeText.trim() === "") {
    return { ok: false, field: "freeText" };
  }
  return { ok: true, value: { reasonCategory: raw.reasonCategory as UnderReasonCategory, freeText: raw.freeText } };
}

/**
 * Which reason the save REQUIRES: "over", "under" or null (none). No numeric need → none;
 * at the need → none; above it on a batch row → none (the over-batch gate owns that).
 */
export function requiredOffNeedReason(args: {
  prepped: number;
  need: number | null;
  isBatch: boolean;
}): "over" | "under" | null {
  const { prepped, need, isBatch } = args;
  if (need === null || !Number.isFinite(need) || !Number.isFinite(prepped)) return null;
  if (prepped === need) return null;
  if (prepped > need) return isBatch ? null : "over";
  return "under";
}

/** The mid-day wire shape (prep_data.overUnder): one capture with a `kind`. */
export interface OffNeedCapture {
  kind: "over" | "under";
  reasonCategory: string;
  directedBy: string | null;
  freeText: string | null;
}

export type OffNeedCheck =
  | { ok: true }
  | { ok: false; field: "overUnder" | "overUnder.kind" | `overUnder.${ReasonField}` };

/**
 * Mid-day Phase 2: the capture the client sent against what the amount requires. A capture
 * that is present is shape-checked even when not required (opening validates a present
 * overPar/underPar the same way); a required one must be present and of the right kind.
 */
export function checkOffNeedCapture(args: {
  prepped: number;
  need: number | null;
  isBatch: boolean;
  capture: OffNeedCapture | null;
}): OffNeedCheck {
  const required = requiredOffNeedReason(args);
  const { capture } = args;
  if (capture === null) return required === null ? { ok: true } : { ok: false, field: "overUnder" };
  if (required !== null && capture.kind !== required) return { ok: false, field: "overUnder.kind" };
  const raw = capture as unknown as Record<string, unknown>;
  const check = capture.kind === "over" ? validateOverReason(raw) : validateUnderReason(raw);
  return check.ok ? { ok: true } : { ok: false, field: `overUnder.${check.field}` };
}

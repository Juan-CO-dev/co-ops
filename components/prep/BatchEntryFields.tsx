"use client";

/**
 * BatchEntryFields — the batch half of a prep row (0215 batch vs bottle, plan S r4 Phase A).
 *
 * Shared by the opening Phase 2 row and the mid-day Phase 2 row. Juan (2026-10-06): "we
 * make the minimum batch, bottle 2 for service and leave the other 2 in a single container
 * to bottle when needed." The row therefore asks three things beside the existing
 * "prepped" box (which on a batch item means BOTTLED for the line):
 *
 *   · batches made — a 0/1/2/3 stepper (addendum 2), whole numbers, a typo nudge past 3;
 *   · came out to — pre-filled batches × yield, editable (Phase B's yield numerator);
 *   · toss — one tap marks the counted bulk backup as thrown out (clearable);
 *
 * and, when batches exceed the minimum the counted backup + need imply, ONE tap on a reason
 * (`catering_order | busy_day_expected | prepping_ahead | other`, note only for other).
 * Everything shown is the same arithmetic the RPC re-derives (lib/batch-prep-shared.ts);
 * the server is the authority, this is the preview that keeps a row from POSTing what the
 * server would refuse.
 */

import { useState } from "react";

import {
  BATCH_STEPPER_MAX,
  OVER_BATCH_REASON_CODES,
  availableForLine,
  backupAfter,
  defaultCameOutTo,
  isOverBatch,
  isPastShelfLife,
  minBatches,
  needsTypoGuard,
  validateBatchEntry,
  type BatchFormValue,
  type BatchRowContext,
  type BatchValidationCode,
  type OverBatchReasonCode,
} from "@/lib/batch-prep-shared";
import { formatDateLabel } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";

const bk = (k: string): TranslationKey => k as TranslationKey;

export interface BatchEntryFieldsProps {
  value: BatchFormValue;
  onChange: (next: BatchFormValue) => void;
  /** Fires a persist with the given value (blur / tap); undefined = the parent saves on its own cadence. */
  onCommit?: (next: BatchFormValue) => void;
  ctx: BatchRowContext;
  /** The row's prepped box = BOTTLED for the line; null until typed. */
  bottled: number | null;
  disabled?: boolean;
  /** Show the inline validation line (after a save attempt / show-problems). */
  showErrors?: boolean;
  /** The last failed save's server code, when it is a batch contract code; renders through the same key family. */
  serverErrorCode?: string | null;
  language: Language;
  /** Today's operational date (YYYY-MM-DD) for the shelf-life red state. */
  todayIso: string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const CHIP =
  "inline-flex min-h-[44px] items-center rounded-full border-2 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";
const CHIP_OFF = "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text";
const CHIP_ON = "border-co-gold-deep bg-co-gold/20 text-co-text";
const NUM =
  "inline-flex h-11 w-24 items-center rounded-md border-2 px-3 text-base font-semibold text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

export function BatchEntryFields({
  value,
  onChange,
  onCommit,
  ctx,
  bottled,
  disabled = false,
  showErrors = false,
  serverErrorCode = null,
  language,
  todayIso,
  t,
}: BatchEntryFieldsProps) {
  const [cameOutTouched, setCameOutTouched] = useState(value.cameOutTo !== null);

  const backupBefore = ctx.backupBefore;
  const usual = defaultCameOutTo(value.batches, ctx.yieldPerBatch);
  const cameOutTo = value.batches > 0 ? (value.cameOutTo ?? usual) : 0;
  const min = backupBefore !== null ? minBatches(ctx.need, backupBefore, value.tossed, ctx.yieldPerBatch) : null;
  const over = isOverBatch(value.batches, min);
  const available = backupBefore !== null ? availableForLine(backupBefore, value.tossed, cameOutTo) : null;
  const after = backupBefore !== null && bottled !== null ? backupAfter(backupBefore, value.tossed, cameOutTo, bottled) : null;
  const pastShelfLife = isPastShelfLife(ctx.madeOn, ctx.shelfLifeDays, todayIso);

  const validation =
    backupBefore === null
      ? ({ ok: false, code: "backup_unknown" } as const)
      : validateBatchEntry(
          { batches: value.batches, cameOutTo: value.batches > 0 ? cameOutTo : null, tossed: value.tossed, overBatchReason: value.overBatchReason },
          { bottled, backupBefore, need: ctx.need, yieldPerBatch: ctx.yieldPerBatch },
        );
  const inlineCode: BatchValidationCode | "backup_unknown" | null = validation.ok ? null : validation.code;

  const commit = (next: BatchFormValue) => {
    onChange(next);
    onCommit?.(next);
  };

  const setBatches = (n: number) => {
    const batches = Math.max(0, n);
    // The pre-fill follows the stepper until the prepper types their own number.
    const next: BatchFormValue = {
      ...value,
      batches,
      cameOutTo: cameOutTouched ? value.cameOutTo : null,
      // A reason only makes sense above the minimum; dropping back clears it.
      overBatchReason: isOverBatch(batches, min) ? value.overBatchReason : null,
    };
    commit(next);
  };

  const unit = ctx.parUnit ? ` ${ctx.parUnit}` : "";

  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-co-border-2 bg-co-bg p-2.5 text-xs">
      {/* Header: recipe, yield, counted backup, made-on */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold uppercase tracking-[0.12em] text-co-text-muted">{t(bk("prep.batch.title"))}</span>
        <span className="text-co-text">{ctx.recipeName}</span>
        <span className="text-co-text-muted">{t(bk("prep.batch.recipe_yield"), { yield: ctx.yieldPerBatch, unit: ctx.parUnit ?? "" })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {backupBefore !== null ? (
          <span className="font-semibold text-co-text">{t(bk("prep.batch.backup_counted"), { n: `${backupBefore}${unit}` })}</span>
        ) : (
          <span role="alert" className="font-semibold text-co-cta-text">{t(bk("prep.batch.backup_unknown"))}</span>
        )}
        {ctx.lineCount !== null ? (
          <span className="text-co-text-muted">{t(bk("prep.batch.line_counted"), { n: `${ctx.lineCount}${unit}` })}</span>
        ) : null}
        {ctx.madeOn !== null ? (
          <span className={pastShelfLife ? "font-bold text-co-cta-text" : "text-co-text-muted"}>
            {t(bk("prep.batch.made_on"), { date: formatDateLabel(ctx.madeOn.slice(0, 10), language) })}
            {pastShelfLife ? ` · ${t(bk("prep.batch.past_shelf_life"), { days: ctx.shelfLifeDays })}` : ""}
          </span>
        ) : null}
      </div>

      {ctx.blocked ? (
        <p role="alert" className="font-semibold text-co-cta-text">
          {t(bk(ctx.blockedReason === "unresolved" ? "prep.batch.blocked_unresolved" : "prep.batch.blocked"))}
        </p>
      ) : (
        <>
          {/* Stepper */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold uppercase tracking-[0.12em] text-co-text-muted">{t(bk("prep.batch.batches_label"))}</span>
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                className={`${CHIP} ${CHIP_OFF} min-w-[44px] justify-center`}
                disabled={disabled || value.batches === 0}
                aria-label={t(bk("prep.batch.stepper_minus_aria"))}
                onClick={() => setBatches(value.batches - 1)}
              >
                −
              </button>
              <span className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border-2 border-co-border-2 bg-co-surface text-base font-semibold text-co-text tabular-nums" aria-live="polite">
                {value.batches}
              </span>
              <button
                type="button"
                className={`${CHIP} ${CHIP_OFF} min-w-[44px] justify-center`}
                disabled={disabled}
                aria-label={t(bk("prep.batch.stepper_plus_aria"))}
                onClick={() => setBatches(value.batches + 1)}
              >
                +
              </button>
            </div>
            {min !== null ? (
              <span className="text-co-text-muted">{t(bk("prep.batch.min_batches"), { n: min })}</span>
            ) : null}
            {needsTypoGuard(value.batches) ? (
              <span className="font-semibold text-co-gold-text">{t(bk("prep.batch.typo_guard"), { n: value.batches, max: BATCH_STEPPER_MAX })}</span>
            ) : null}
          </div>

          {/* Came out to */}
          {value.batches > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="font-bold uppercase tracking-[0.12em] text-co-text-muted" htmlFor={`came-out-${ctx.recipeName}`}>
                {t(bk("prep.batch.came_out_to"))}
              </label>
              <input
                id={`came-out-${ctx.recipeName}`}
                type="text"
                inputMode="decimal"
                value={value.cameOutTo === null ? String(usual) : String(value.cameOutTo)}
                disabled={disabled}
                aria-label={t(bk("prep.batch.came_out_to_aria"), { recipe: ctx.recipeName })}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  setCameOutTouched(true);
                  if (raw === "") { onChange({ ...value, cameOutTo: null }); return; }
                  const n = Number(raw);
                  if (Number.isFinite(n)) onChange({ ...value, cameOutTo: n });
                }}
                onBlur={disabled ? undefined : () => onCommit?.(value)}
                className={`${NUM} border-co-border-2 bg-co-surface hover:border-co-text`}
              />
              <span className="text-co-text-muted">{t(bk("prep.batch.came_out_to_hint"), { n: `${usual}${unit}` })}</span>
            </div>
          ) : null}

          {/* Toss */}
          {backupBefore !== null && backupBefore > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`${CHIP} ${value.tossed > 0 ? "border-co-cta-text bg-co-danger-surface text-co-text" : CHIP_OFF}`}
                disabled={disabled}
                aria-pressed={value.tossed > 0}
                onClick={() => commit({ ...value, tossed: value.tossed > 0 ? 0 : backupBefore })}
              >
                {value.tossed > 0 ? t(bk("prep.batch.toss_undo")) : t(bk("prep.batch.toss"), { n: `${backupBefore}${unit}` })}
              </button>
              {value.tossed > 0 ? (
                <span className="font-semibold text-co-cta-text">{t(bk("prep.batch.tossed_badge"), { n: `${value.tossed}${unit}` })}</span>
              ) : null}
            </div>
          ) : null}

          {/* Over-batch reason — ALWAYS when above the minimum (addendum 2) */}
          {over ? (
            <div className="flex flex-col gap-1.5">
              <span className="font-bold uppercase tracking-[0.12em] text-co-text-muted">{t(bk("prep.batch.reason_title"))}</span>
              <div className="flex flex-wrap gap-1.5">
                {OVER_BATCH_REASON_CODES.map((code: OverBatchReasonCode) => {
                  const on = value.overBatchReason?.code === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                      disabled={disabled}
                      aria-pressed={on}
                      onClick={() => {
                        const next: BatchFormValue = { ...value, overBatchReason: { code, note: on ? (value.overBatchReason?.note ?? null) : null } };
                        // `other` waits for its note before persisting; the three one-tap codes save at once.
                        if (code === "other") onChange(next); else commit(next);
                      }}
                    >
                      {t(bk(`prep.batch.reason.${code}`))}
                    </button>
                  );
                })}
              </div>
              {value.overBatchReason?.code === "other" ? (
                <input
                  type="text"
                  value={value.overBatchReason.note ?? ""}
                  disabled={disabled}
                  maxLength={200}
                  placeholder={t(bk("prep.batch.reason_note_placeholder"))}
                  aria-label={t(bk("prep.batch.reason_note_placeholder"))}
                  onChange={(e) => onChange({ ...value, overBatchReason: { code: "other", note: e.target.value } })}
                  onBlur={disabled ? undefined : () => onCommit?.(value)}
                  className="min-h-[44px] w-full rounded-md border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                />
              ) : null}
            </div>
          ) : null}

          {/* Preview + guardrail */}
          {available !== null ? (
            <p className={inlineCode === "bottled_exceeds_available" ? "font-semibold text-co-cta-text" : "text-co-text-muted"}>
              {t(bk("prep.batch.preview"), {
                available: `${available}${unit}`,
                after: after !== null ? `${after}${unit}` : "—",
              })}
            </p>
          ) : null}
          {(showErrors || inlineCode === "bottled_exceeds_available" || inlineCode === "tossed_exceeds_backup") && inlineCode !== null ? (
            <p role="alert" className="font-semibold text-co-cta-text">{t(bk(`prep.batch.error.${inlineCode}`))}</p>
          ) : null}
          {serverErrorCode && serverErrorCode !== inlineCode ? (
            <p role="alert" className="font-semibold text-co-cta-text">{t(bk(`prep.batch.error.${serverErrorCode}`))}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

"use client";

/**
 * UnderParModal — Phase 2 under-par capture modal.
 *
 * Triggered when openerPrepped < parValue. Captures:
 *   - reasonCategory dropdown (5 options)
 *   - freeText textarea — REQUIRED (operational urgency justifies friction;
 *     matches Step 4 RPC validation)
 *
 * Save sets local form state on the parent (phase2.underPar); submit-on-form-
 * submit per locked Sub-decision (f). Modal does NOT make API calls.
 *
 * Warning copy (per locked Sub-decision (h)) shown at all times so operators
 * understand the consequence: under-par submission fires an urgent
 * notification to KH+ at this location + MoO + Owner inside the
 * submit_opening_atomic RPC transaction (Step 4).
 *
 * Reason category labels reuse `notifications.under_par_alert.reason.*` keys
 * shipped in Step 5 (single source of truth for the reason vocabulary).
 */

import { useState } from "react";

import type { TranslationKey } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";

export type UnderParReasonCategory =
  | "ingredient_unavailable"
  | "equipment_issue"
  | "time_constraint"
  | "staff_shortage"
  | "other";

export interface UnderParCapture {
  reasonCategory: UnderParReasonCategory;
  /** REQUIRED non-empty per Step 4 RPC validation + design doc §3.3. */
  freeText: string;
}

const REASON_OPTIONS: ReadonlyArray<{
  value: UnderParReasonCategory;
  labelKey: TranslationKey;
}> = [
  {
    value: "ingredient_unavailable",
    labelKey: "notifications.under_par_alert.reason.ingredient_unavailable",
  },
  {
    value: "equipment_issue",
    labelKey: "notifications.under_par_alert.reason.equipment_issue",
  },
  {
    value: "time_constraint",
    labelKey: "notifications.under_par_alert.reason.time_constraint",
  },
  {
    value: "staff_shortage",
    labelKey: "notifications.under_par_alert.reason.staff_shortage",
  },
  {
    value: "other",
    labelKey: "notifications.under_par_alert.reason.other",
  },
];

const UNDER_PAR_REASON_VALUES: ReadonlySet<string> = new Set(
  REASON_OPTIONS.map((o) => o.value),
);

/**
 * Runtime guard validating an untyped string (e.g. a persisted
 * prep_data->phase2 over_under_reason_category) against the canonical reason
 * vocabulary. Derived from REASON_OPTIONS so the validation set and the
 * dropdown render from the same single source — no parallel list to drift.
 */
export function isUnderParReasonCategory(
  value: string,
): value is UnderParReasonCategory {
  return UNDER_PAR_REASON_VALUES.has(value);
}

interface UnderParModalProps {
  open: boolean;
  itemLabel: string;
  initial: UnderParCapture | null;
  onSave: (capture: UnderParCapture) => void;
  onCancel: () => void;
}

export function UnderParModal({
  open,
  itemLabel,
  initial,
  onSave,
  onCancel,
}: UnderParModalProps) {
  const { t } = useTranslation();

  const [reason, setReason] = useState<UnderParReasonCategory>(
    initial?.reasonCategory ?? "ingredient_unavailable",
  );
  const [freeText, setFreeText] = useState<string>(initial?.freeText ?? "");

  // Reset state when the modal opens with a new initial value. Render-phase
  // compare instead of an effect — a synchronous reset in an effect body would
  // trip react-hooks/set-state-in-effect.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (open !== prevOpen || initial !== prevInitial) {
    setPrevOpen(open);
    setPrevInitial(initial);
    if (open) {
      setReason(initial?.reasonCategory ?? "ingredient_unavailable");
      setFreeText(initial?.freeText ?? "");
    }
  }

  if (!open) return null;

  const trimmedFreeText = freeText.trim();
  const canSave = trimmedFreeText.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ reasonCategory: reason, freeText: trimmedFreeText });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="underpar-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-co-text/40 sm:items-center sm:px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-t-2xl border-2 border-co-border bg-co-surface p-5 shadow-xl sm:rounded-2xl">
        <h3
          id="underpar-modal-title"
          className="text-lg font-extrabold leading-tight text-co-text"
        >
          {t("opening.under_par.modal_title", { item: itemLabel })}
        </h3>

        <p
          role="alert"
          className="mt-3 rounded-md border-2 border-co-danger bg-[#FFE4E4] p-3 text-xs font-medium leading-snug text-co-text"
        >
          {t("opening.under_par.warning")}
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
              {t("opening.under_par.reason_label")}
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as UnderParReasonCategory)}
              className="
                mt-1.5 inline-flex h-11 w-full items-center rounded-md border-2 border-co-border-2 bg-co-surface px-3
                text-base font-semibold text-co-text
                transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            >
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
              {t("opening.under_par.free_text_label")}
            </label>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={t("opening.under_par.free_text_placeholder")}
              rows={3}
              aria-required={true}
              aria-invalid={!canSave}
              className="
                mt-1.5 w-full rounded-md border-2 border-co-border-2 bg-co-surface px-3 py-2
                text-sm text-co-text
                transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="
              inline-flex min-h-[44px] items-center justify-center rounded-md border-2 border-co-border-2 bg-co-surface px-4
              text-sm font-bold uppercase tracking-[0.12em] text-co-text
              transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={[
              "inline-flex min-h-[44px] items-center justify-center rounded-md px-4",
              "text-sm font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              canSave
                ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
                : "border-2 border-co-border-2 bg-co-surface text-co-text-faint cursor-not-allowed",
            ].join(" ")}
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

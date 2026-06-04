"use client";

/**
 * OverParModal — Phase 2 over-par capture modal.
 *
 * Triggered when openerPrepped > parValue. Captures:
 *   - reasonCategory dropdown (6 options including 'other')
 *   - directedBy dropdown — visible only when reasonCategory === 'management_directive';
 *     populated with users at level >= 6 (AGM+) at this location
 *   - freeText textarea — required when reasonCategory === 'other'
 *
 * Save sets local form state on the parent (phase2.overPar); submit-on-form-
 * submit per locked Sub-decision (f). Modal does NOT make API calls.
 *
 * Per locked Surface D (a): directedBy required when reasonCategory ===
 * 'management_directive' (accountability tagging architectural intent).
 */

import { useState } from "react";

import type { TranslationKey } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";

export type OverParReasonCategory =
  | "management_directive"
  | "clear_fridge_space"
  | "prevent_expiration"
  | "forecast_busy"
  | "bulk_efficiency"
  | "other";

export interface OverParCapture {
  reasonCategory: OverParReasonCategory;
  directedBy: string | null;
  freeText: string | null;
}

const REASON_OPTIONS: ReadonlyArray<{
  value: OverParReasonCategory;
  labelKey: TranslationKey;
}> = [
  { value: "management_directive", labelKey: "opening.over_par.reason.management_directive" },
  { value: "clear_fridge_space", labelKey: "opening.over_par.reason.clear_fridge_space" },
  { value: "prevent_expiration", labelKey: "opening.over_par.reason.prevent_expiration" },
  { value: "forecast_busy", labelKey: "opening.over_par.reason.forecast_busy" },
  { value: "bulk_efficiency", labelKey: "opening.over_par.reason.bulk_efficiency" },
  { value: "other", labelKey: "opening.over_par.reason.other" },
];

export interface ManagerOption {
  /** users.id */
  id: string;
  /** display name */
  name: string;
  /** role code (for visual hint, optional) */
  role?: string;
}

interface OverParModalProps {
  open: boolean;
  itemLabel: string;
  /** Initial capture state — null to render fresh; populated to render edit. */
  initial: OverParCapture | null;
  /** AGM+ at this location (pre-loaded by Server Component). */
  managers: ReadonlyArray<ManagerOption>;
  onSave: (capture: OverParCapture) => void;
  onCancel: () => void;
}

export function OverParModal({
  open,
  itemLabel,
  initial,
  managers,
  onSave,
  onCancel,
}: OverParModalProps) {
  const { t } = useTranslation();

  const [reason, setReason] = useState<OverParReasonCategory>(
    initial?.reasonCategory ?? "management_directive",
  );
  const [directedBy, setDirectedBy] = useState<string | null>(
    initial?.directedBy ?? null,
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
      setReason(initial?.reasonCategory ?? "management_directive");
      setDirectedBy(initial?.directedBy ?? null);
      setFreeText(initial?.freeText ?? "");
    }
  }

  if (!open) return null;

  const requireDirectedBy = reason === "management_directive";
  const requireFreeText = reason === "other";
  const trimmedFreeText = freeText.trim();
  const directedByValid = !requireDirectedBy || directedBy !== null;
  const freeTextValid = !requireFreeText || trimmedFreeText.length > 0;
  const canSave = directedByValid && freeTextValid;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      reasonCategory: reason,
      directedBy: requireDirectedBy ? directedBy : null,
      freeText: trimmedFreeText.length > 0 ? trimmedFreeText : null,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="overpar-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-co-text/40 sm:items-center sm:px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-t-2xl border-2 border-co-border bg-co-surface p-5 shadow-xl sm:rounded-2xl">
        <h3
          id="overpar-modal-title"
          className="text-lg font-extrabold leading-tight text-co-text"
        >
          {t("opening.over_par.modal_title", { item: itemLabel })}
        </h3>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
              {t("opening.over_par.reason_label")}
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as OverParReasonCategory)}
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

          {requireDirectedBy ? (
            <div>
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
                {t("opening.over_par.directed_by_label")}
              </label>
              <select
                value={directedBy ?? ""}
                onChange={(e) => setDirectedBy(e.target.value || null)}
                aria-required={true}
                aria-invalid={!directedByValid}
                className="
                  mt-1.5 inline-flex h-11 w-full items-center rounded-md border-2 border-co-border-2 bg-co-surface px-3
                  text-base font-semibold text-co-text
                  transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              >
                <option value="">
                  {t("opening.over_par.directed_by_placeholder")}
                </option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.role ? ` (${m.role})` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-co-text-dim">
                {t("opening.over_par.directed_by_helper")}
              </p>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
              {t("opening.over_par.free_text_label")}
            </label>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={
                requireFreeText
                  ? t("opening.over_par.free_text_placeholder_required")
                  : t("opening.over_par.free_text_placeholder_optional")
              }
              rows={3}
              aria-required={requireFreeText}
              aria-invalid={!freeTextValid}
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

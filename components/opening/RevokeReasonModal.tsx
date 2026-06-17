"use client";

/**
 * RevokeReasonModal — Phase 2 §8.4 STRUCTURED-path revoke reason capture (C.53
 * Lane D). Reuses the OverParModal shell pattern (no new shell).
 *
 * This modal is the SECOND step of the revoke flow and only opens when the SERVER
 * has decided the structured path is required (a no-reason revoke returned
 * `invalid_entry_shape`). The client NEVER predicts the silent-vs-structured
 * boundary itself (clock skew, 60s edge) — it reacts to the server's response.
 *
 * Captures:
 *   - reasonCategory radio: 're_enter_count' | 'other'
 *   - note textarea — required when reasonCategory === 'other' (lib re-validates)
 *
 * onSubmit POSTs through the parent's revoke dispatcher and resolves with the
 * outcome. On a "revoked" outcome the modal closes; otherwise it surfaces an
 * inline error and stays open so the prepper can retry.
 */

import { useState } from "react";

import type { TranslationKey } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";

import type {
  Phase2RevokeOutcome,
  Phase2RevokeReason,
} from "./OpeningPrepEntry";

const REASON_OPTIONS: ReadonlyArray<{
  value: Phase2RevokeReason;
  labelKey: TranslationKey;
}> = [
  { value: "re_enter_count", labelKey: "opening.phase2.revoke.reason.re_enter_count" },
  { value: "other", labelKey: "opening.phase2.revoke.reason.other" },
];

interface RevokeReasonModalProps {
  open: boolean;
  itemLabel: string;
  /**
   * Fires the structured revoke. Resolves with the server outcome — the modal
   * closes on "revoked" and shows an inline error otherwise.
   */
  onSubmit: (
    reason: Phase2RevokeReason,
    note: string | null,
  ) => Promise<Phase2RevokeOutcome>;
  /** Closes the modal (cancel button + post-success). */
  onClose: () => void;
}

export function RevokeReasonModal({
  open,
  itemLabel,
  onSubmit,
  onClose,
}: RevokeReasonModalProps) {
  const { t } = useTranslation();

  const [reason, setReason] = useState<Phase2RevokeReason>("re_enter_count");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Reset state when the modal opens fresh. Render-phase compare instead of an
  // effect (a synchronous reset in an effect body trips set-state-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setReason("re_enter_count");
      setNote("");
      setSubmitting(false);
      setErrorCode(null);
    }
  }

  if (!open) return null;

  const requireNote = reason === "other";
  const trimmedNote = note.trim();
  const noteValid = !requireNote || trimmedNote.length > 0;
  const canSubmit = noteValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorCode(null);
    const outcome = await onSubmit(reason, trimmedNote.length > 0 ? trimmedNote : null);
    if (outcome.status === "revoked") {
      onClose();
      return;
    }
    // needs_reason can't happen here (a reason was sent); treat as error.
    setSubmitting(false);
    setErrorCode(outcome.status === "error" ? outcome.code : "fallback");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-co-text/40 sm:items-center sm:px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-t-2xl border-2 border-co-border bg-co-surface p-5 shadow-xl sm:rounded-2xl">
        <h3
          id="revoke-modal-title"
          className="text-lg font-extrabold leading-tight text-co-text"
        >
          {t("opening.phase2.revoke.modal_title", { item: itemLabel })}
        </h3>
        <p className="mt-1.5 text-sm text-co-text-dim">
          {t("opening.phase2.revoke.modal_help")}
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
              {t("opening.phase2.revoke.reason_label")}
            </legend>
            {REASON_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-sm font-medium text-co-text"
              >
                <input
                  type="radio"
                  name="revoke-reason"
                  value={opt.value}
                  checked={reason === opt.value}
                  onChange={() => setReason(opt.value)}
                  className="h-4 w-4 accent-co-gold-deep"
                />
                {t(opt.labelKey)}
              </label>
            ))}
          </fieldset>

          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
              {t("opening.phase2.revoke.note_label")}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                requireNote
                  ? t("opening.phase2.revoke.note_placeholder_required")
                  : t("opening.phase2.revoke.note_placeholder_optional")
              }
              rows={3}
              aria-required={requireNote}
              aria-invalid={!noteValid}
              className="
                mt-1.5 w-full rounded-md border-2 border-co-border-2 bg-co-surface px-3 py-2
                text-sm text-co-text
                transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            />
          </div>

          {errorCode ? (
            <p role="alert" className="text-sm font-medium text-co-danger">
              {t("opening.phase2.revoke.error")}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="
              inline-flex min-h-[44px] items-center justify-center rounded-md border-2 border-co-border-2 bg-co-surface px-4
              text-sm font-bold uppercase tracking-[0.12em] text-co-text
              transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
              disabled:cursor-not-allowed disabled:text-co-text-faint
            "
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={[
              "inline-flex min-h-[44px] items-center justify-center rounded-md px-4",
              "text-sm font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              canSubmit
                ? "border-2 border-co-danger bg-co-surface text-co-text hover:bg-co-danger-surface"
                : "border-2 border-co-border-2 bg-co-surface text-co-text-faint cursor-not-allowed",
            ].join(" ")}
          >
            {submitting
              ? t("opening.phase2.revoke.submitting")
              : t("opening.phase2.revoke.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * OpeningSectionVerify — Phase 1 section-header verify CTA + verified-state
 * indicator + section-disabled guard for NULL-closer-count items.
 * (Section-verify was absorbed into Phase 1 per C.53 §10; authored as Phase 2
 * pre-§10, hence the C.50 references below. i18n keys re-namespaced to
 * opening.section_verify.* per FT.2.)
 *
 * Per C.50 §1 + §4: opener verifies a section as a whole when all items in
 * the section have closer counts that look consistent with what the closer
 * recorded. Per-item recount drill-in (OpeningRecountPanel) handles the
 * exception path. Section-verify is DISABLED when any item in the section
 * has NULL closer_count without an opener_recount populated (per Step 11
 * Lock 3 sentinel handling) — the disabled state forces the opener to
 * recount the un-counted items before they can section-verify the rest.
 *
 * Verified state in client memory is a boolean; verified_at + verified_by
 * are server-side at submit (Step 13 RPC populates
 * opening_section_verifications via submit_opening_atomic). The form's
 * verified-state indicator shows "Verified ✓" inline; full attribution
 * (timestamp + name) renders in the read-only banner post-submit.
 *
 * Append-only convention nuance: per CO-OPS append-only philosophy, if
 * opener un-verifies and re-verifies multiple times before submit, only
 * the final state in client memory is dispatched at submit. Server stores
 * one row per submit; multi-toggle in client state doesn't create multiple
 * rows. The append-only chain applies to historical records across submits;
 * not to in-form-state iterations within a single submission.
 *
 * Header-only component — owns the verify CTA + indicator + disabled
 * guard. Section card chrome (border, padding, item rendering) lives in
 * OpeningPrepEntry which composes this component into its section header.
 * Smaller scope than OpeningVerificationStation (Phase 1's whole-card
 * pattern); avoids duplicating per-item Phase 2 state rendering across
 * components.
 */

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

interface OpeningSectionVerifyProps {
  /** System-key match value (English `prep_meta.section`, e.g., "Cooks"). */
  sectionKey: string;
  /** Translated section display string (resolved via resolveTemplateItemContent). */
  sectionDisplay: string;
  /** Current verified state in client memory. */
  verified: boolean;
  /** True when the section has any item with NULL closer_count + no recount. */
  disabled: boolean;
  /**
   * Reason for disabled state. Currently only one disabled-reason exists
   * ("null_items_unrecounted"); typed as a discriminated union for forward
   * extension if more disabled-reasons emerge.
   */
  disabledReason: "null_items_unrecounted" | null;
  onToggleVerified: () => void;
  language: Language;
}

export function OpeningSectionVerify({
  sectionKey: _sectionKey,
  sectionDisplay,
  verified,
  disabled,
  disabledReason,
  onToggleVerified,
  language: _language,
}: OpeningSectionVerifyProps) {
  const { t } = useTranslation();

  const buttonLabel = verified
    ? t("opening.section_verify.verified_button")
    : t("opening.section_verify.cta");

  const ariaLabel = verified
    ? `${t("opening.section_verify.verified_button")} — ${sectionDisplay}`
    : `${t("opening.section_verify.cta")} — ${sectionDisplay}`;

  const disabledMessage =
    disabled && disabledReason === "null_items_unrecounted"
      ? t("opening.section_verify.disabled_null_items")
      : null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={disabled ? undefined : onToggleVerified}
        disabled={disabled}
        aria-pressed={verified}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        className={[
          "inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3",
          "text-xs font-bold uppercase tracking-[0.12em]",
          "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
          disabled
            ? "cursor-not-allowed border-2 border-co-border bg-co-surface text-co-text-dim opacity-70"
            : verified
              ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
              : "border-2 border-co-border-2 bg-co-surface text-co-text hover:border-co-text",
        ].join(" ")}
      >
        <span aria-hidden>{verified ? "✓" : "○"}</span>
        {buttonLabel}
      </button>
      {disabledMessage ? (
        <p
          role="note"
          className="max-w-xs text-right text-[10px] italic leading-snug text-co-text-dim"
        >
          {disabledMessage}
        </p>
      ) : null}
    </div>
  );
}

"use client";

/**
 * OpeningChecklistItem — single item row inside an OpeningVerificationStation.
 *
 * Renders translated label (system-key match per C.38: original `item.label`
 * is the source-of-truth match key; Spanish display via translations.es.label).
 * Items with expects_count=true render an inline OpeningCountInput.
 * Disclosure toggle reveals OpeningItemAddon (comment + disabled photo).
 *
 * Form state: parent passes the entry value + onChange callback. This
 * component does NOT own state. Tick is per-station (handled by
 * OpeningVerificationStation), but each item shows the inherited tick
 * indicator visually.
 */

import { useState } from "react";

import type { ChecklistTemplateItem } from "@/lib/types";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { Language } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";

import { OpeningCountInput } from "./OpeningCountInput";
import { OpeningItemAddon } from "./OpeningItemAddon";

export interface OpeningItemFormValue {
  countValue: number | null;
  photoId: string | null;
  notes: string | null;
  ticked: boolean;
  /** C.53 Phase 1 — morning recount on spot-check items. NULL when no recount entered.
   *  REQUIRED on items where snapshot closer_count IS NULL;
   *  OPTIONAL otherwise (opener-initiated correction). */
  openerRecount: number | null;
}

interface OpeningChecklistItemProps {
  item: ChecklistTemplateItem;
  value: OpeningItemFormValue;
  onChange: (next: OpeningItemFormValue) => void;
  language: Language;
  /** True when item is ticked but expected count is null. Drives error styling. */
  hasMissingCountError: boolean;
  /**
   * C.53 Phase 1 — closer_count from snapshot materialized at instance create.
   * Tri-state per the parent's closerSnapshotsMap lookup:
   *   - `undefined`: item has NO snapshot row → non-spot-check item (cleanliness
   *     tick / temp reading); recount UI NOT rendered.
   *   - `null`:      item HAS a snapshot row with closer_count IS NULL →
   *     NULL-source spot-check (no closing data captured); recount UI rendered
   *     prominently with required-state styling.
   *   - number:      item HAS a snapshot row with closer_count captured →
   *     recount UI rendered as an optional correction affordance.
   *
   * Made optional in Build #3 PR 4 (3c form-split + closerCount threading)
   * 2026-05-26: Aggie's pre-existing prop declaration was `number | null` and
   * unused; promoting to tri-state lets the parent send `undefined` for items
   * outside the snapshot universe without a separate isSpotCheck prop.
   */
  closerCount?: number | null;
  /**
   * C.53 Commit B Finding A — server-truth verify lock. True once Phase 1 has
   * landed (instance.status !== 'open'). When locked, the row's tick indicator
   * renders DONE for everyone (independent of this browser's local form) and the
   * recount input is read-only, so a second opener can't re-enter values into a
   * verification beat that's already once-per-instance committed.
   */
  verificationLocked?: boolean;
}

export function OpeningChecklistItem({
  item,
  value,
  onChange,
  language,
  hasMissingCountError,
  closerCount,
  verificationLocked,
}: OpeningChecklistItemProps) {
  const { t } = useTranslation();
  const [addonOpen, setAddonOpen] = useState<boolean>(
    value.notes !== null || value.photoId !== null,
  );

  const resolved = resolveTemplateItemContent(item, language);

  // Tri-state spot-check signal (see closerCount JSDoc above).
  //   isSpotCheck = closer_count snapshot exists for this item
  //   isNullSource = snapshot exists AND closer_count IS NULL (recount REQUIRED)
  const isSpotCheck = closerCount !== undefined;
  const isNullSource = closerCount === null;

  // Numeric-input recount handler — empty string → null, valid number → number,
  // invalid → ignore (input rejects). Pattern mirrors OpeningRecountPanel +
  // OpeningCountInput.
  const handleRecountChange = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange({ ...value, openerRecount: null });
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      onChange({ ...value, openerRecount: parsed });
    }
  };

  // Finding A — when the verify beat is locked (Phase 1 already landed), the row
  // renders DONE regardless of this browser's (possibly empty) local form.
  const displayTicked = verificationLocked || value.ticked;
  const tickIcon = displayTicked ? "✓" : "·";
  const tickClass = displayTicked
    ? "bg-co-gold text-co-text border-co-text"
    : "bg-co-surface text-co-text-dim border-co-border-2";

  const hasAddonContent = value.notes !== null && value.notes.length > 0;
  const showAddonButton = !addonOpen;

  return (
    <li className="flex flex-col gap-2 border-t border-co-border py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={[
            "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
            "text-sm font-bold",
            tickClass,
          ].join(" ")}
        >
          {tickIcon}
        </span>

        <div className="flex flex-1 flex-col gap-2">
          <p className="text-sm font-medium text-co-text">{resolved.label}</p>

          {item.expectsCount ? (
            <div className="flex items-center gap-2">
              <OpeningCountInput
                value={value.countValue}
                onChange={(next) => onChange({ ...value, countValue: next })}
                placeholder={t("opening.item.count_input_placeholder")}
                ariaLabel={t("opening.item.count_input_aria", { item: resolved.label })}
                required={value.ticked}
                hasError={hasMissingCountError}
              />
              {hasMissingCountError ? (
                <span className="text-xs text-co-danger">
                  {t("opening.item.count_required_inline")}
                </span>
              ) : null}
            </div>
          ) : null}

          {addonOpen ? (
            <OpeningItemAddon
              notes={value.notes}
              onNotesChange={(next) => onChange({ ...value, notes: next })}
              itemLabel={resolved.label}
            />
          ) : showAddonButton ? (
            <button
              type="button"
              onClick={() => setAddonOpen(true)}
              className="
                self-start text-xs font-medium uppercase tracking-[0.12em]
                text-co-text-muted hover:text-co-text
                transition focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60
              "
            >
              {hasAddonContent
                ? t("opening.item.add_addon_with_content")
                : t("opening.item.add_addon")}
            </button>
          ) : null}

          {/* C.53 spot-check recount section — rendered only for items in the
              closer-count-snapshot universe (isSpotCheck === closerCount !== undefined).
              NULL-source items (closerCount === null) show "—" with danger styling +
              required-state on the recount input. Captured items show the closer
              value + optional-correction styling on the recount input. */}
          {isSpotCheck ? (
            <div
              className={[
                "mt-1 flex items-center gap-3 rounded-md border-2 px-3 py-2 text-sm",
                isNullSource
                  ? "border-co-danger bg-[#FFE4E4]"
                  : "border-co-border-2 bg-co-bg",
              ].join(" ")}
            >
              <span
                className={[
                  "shrink-0 text-xs font-bold uppercase tracking-[0.12em]",
                  isNullSource ? "text-co-danger" : "text-co-text-muted",
                ].join(" ")}
              >
                {t("opening.phase2.recount_label")}
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={value.openerRecount === null ? "" : String(value.openerRecount)}
                onChange={(e) => handleRecountChange(e.target.value)}
                disabled={verificationLocked}
                aria-label={`${t("opening.phase2.recount_label")} — ${resolved.label}`}
                aria-required={isNullSource}
                className={[
                  "inline-flex h-9 w-20 items-center rounded-md border-2 px-2",
                  "text-base font-semibold text-co-text",
                  "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
                  verificationLocked ? "cursor-not-allowed opacity-70" : "",
                  isNullSource
                    ? "border-co-danger bg-co-surface hover:border-co-text"
                    : "border-co-border-2 bg-co-surface hover:border-co-text",
                ].join(" ")}
              />
              <span className="ml-auto text-xs font-medium text-co-text-muted tabular-nums">
                {closerCount === null ? "—" : String(closerCount)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

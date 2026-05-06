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
}

interface OpeningChecklistItemProps {
  item: ChecklistTemplateItem;
  value: OpeningItemFormValue;
  onChange: (next: OpeningItemFormValue) => void;
  language: Language;
  /** True when item is ticked but expected count is null. Drives error styling. */
  hasMissingCountError: boolean;
}

export function OpeningChecklistItem({
  item,
  value,
  onChange,
  language,
  hasMissingCountError,
}: OpeningChecklistItemProps) {
  const { t } = useTranslation();
  const [addonOpen, setAddonOpen] = useState<boolean>(
    value.notes !== null || value.photoId !== null,
  );

  const resolved = resolveTemplateItemContent(item, language);

  const tickIcon = value.ticked ? "✓" : "·";
  const tickClass = value.ticked
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
        </div>
      </div>
    </li>
  );
}

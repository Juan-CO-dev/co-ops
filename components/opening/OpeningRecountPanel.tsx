"use client";

/**
 * OpeningRecountPanel — Phase 1 per-item drill-in for opener_recount input.
 * (Recount drill-in was absorbed into Phase 1 per C.53 §10; authored as Phase 2
 * pre-§10, hence the C.50 references below. i18n keys re-namespaced to
 * opening.recount.* per FT.2.)
 *
 * Per C.50 §1: when opener spots an item that looks off within a section,
 * they tap into the item to expand a recount input. Opener enters the
 * corrected count → opener_recount populated for THAT item only;
 * section-verify still covers the other items in the section. Recount
 * becomes ground_truth for that item; other items in the section get
 * ground_truth from closer_count via section-verify path.
 *
 * Per Step 11 Lock 3 sentinel handling: when an item has NULL closer_count
 * (no AM Prep yesterday, item not linked, first-day case), the recount is
 * REQUIRED — section-verify is disabled for the parent section until all
 * NULL items have recounts populated.
 *
 * Inline panel — not a modal. Tab/Esc handling natural. Auto-focus on
 * mount for fast operator entry. Save dispatches the value (or null on
 * empty/invalid); cancel collapses without saving. Re-opening the panel
 * pre-fills with the previously-saved value (allowing edits).
 *
 * Numeric input semantics: `inputMode="decimal"` for numeric soft keyboards
 * on mobile (matches existing Phase 2 input pattern in OpeningPrepEntry).
 * Empty string → null (treated as "no recount"); valid number → number;
 * invalid input → ignored (input rejects on parse failure).
 */

import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

interface OpeningRecountPanelProps {
  itemId: string;
  itemLabel: string;
  /** Pre-existing recount value (NULL when first-time recount; number when editing). */
  initialValue: number | null;
  onSave: (value: number | null) => void;
  onCancel: () => void;
  language: Language;
}

export function OpeningRecountPanel({
  itemId: _itemId,
  itemLabel,
  initialValue,
  onSave,
  onCancel,
  language: _language,
}: OpeningRecountPanelProps) {
  const { t } = useTranslation();
  const [stringValue, setStringValue] = useState<string>(
    initialValue !== null ? String(initialValue) : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount for immediate operator entry.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    const trimmed = stringValue.trim();
    if (trimmed === "") {
      onSave(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      onSave(parsed);
    }
    // Invalid → ignore; user keeps editing.
  };

  return (
    <div
      role="region"
      aria-label={`${t("opening.recount.label")} — ${itemLabel}`}
      className="mt-2 flex flex-col gap-3 rounded-md border-2 border-co-border-2 bg-co-bg p-3"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">
          {t("opening.recount.label")}
        </span>
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={stringValue}
          onChange={(e) => setStringValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          aria-label={`${t("opening.recount.label")} — ${itemLabel}`}
          className={[
            "inline-flex h-11 w-24 items-center rounded-md border-2 px-3",
            "text-base font-semibold text-co-text",
            "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            "border-co-border-2 bg-co-surface hover:border-co-text",
          ].join(" ")}
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="
            inline-flex min-h-[44px] items-center justify-center rounded-md
            border-2 border-co-text bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
            transition hover:bg-co-gold-deep
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          {t("opening.recount.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="
            inline-flex min-h-[44px] items-center justify-center rounded-md
            border-2 border-co-border-2 bg-co-surface px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text-muted
            transition hover:border-co-text hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          {t("opening.recount.cancel")}
        </button>
      </div>
    </div>
  );
}

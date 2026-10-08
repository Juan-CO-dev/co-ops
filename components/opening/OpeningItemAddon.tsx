"use client";

/** Per-item discrepancy comment; photo upload stays hidden until it is available. */

import { useTranslation } from "@/lib/i18n/provider";

interface OpeningItemAddonProps {
  notes: string | null;
  onNotesChange: (next: string | null) => void;
  itemLabel: string;
  /**
   * C.53 Finding D — when the verify beat is locked (Phase 1 already landed),
   * the discrepancy comment is a persisted value shown read-only: a second
   * opener sees opener A's note but can't edit a once-per-instance-committed
   * field.
   */
  disabled?: boolean;
}

export function OpeningItemAddon({
  notes,
  onNotesChange,
  itemLabel,
  disabled = false,
}: OpeningItemAddonProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md border border-co-border bg-co-surface-2 p-3">
      {/* Comment textarea — live, bound to parent state */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
          {t("opening.item.comment_label")}
        </span>
        <textarea
          value={notes ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            // Empty string → null; preserves form state cleanliness for
            // submission (server validation trims + null-checks).
            onNotesChange(raw.length > 0 ? raw : null);
          }}
          placeholder={t("opening.item.comment_placeholder")}
          aria-label={t("opening.item.comment_aria", { item: itemLabel })}
          rows={2}
          disabled={disabled}
          className="
            min-h-[64px] w-full rounded-md border-2 border-co-border-2 bg-co-surface
            px-3 py-2 text-sm text-co-text
            transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            disabled:cursor-not-allowed disabled:opacity-70
          "
        />
      </label>
    </div>
  );
}

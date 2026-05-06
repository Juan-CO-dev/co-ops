"use client";

/**
 * OpeningItemAddon — combined per-item discrepancy add-on (comment +
 * disabled photo button). Used inside OpeningChecklistItem when expanded.
 *
 * Per Surface 3 + the Phase 6 photo-deferral decision:
 *   - Comment: live textarea bound to parent state (notes column on
 *     checklist_completions).
 *   - Photo: visible-but-disabled icon button with translated tooltip.
 *     Phase 6 ships PhotoUploader as the only surface change; form state
 *     shape stays forward-compatible (photoId: string | null in
 *     OpeningEntry remains today, always null in PR 2).
 *
 * Tick state independence (per Q-B refinement): this add-on only writes
 * `notes` (and, in Phase 6, `photoId`). It NEVER reads or writes `ticked`.
 * Photo + comment persist through any tick state changes — opener can
 * untick → re-tick a station and the comment they typed stays.
 */

import { useTranslation } from "@/lib/i18n/provider";

interface OpeningItemAddonProps {
  notes: string | null;
  onNotesChange: (next: string | null) => void;
  itemLabel: string;
}

export function OpeningItemAddon({
  notes,
  onNotesChange,
  itemLabel,
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
          className="
            min-h-[64px] w-full rounded-md border-2 border-co-border-2 bg-co-surface
            px-3 py-2 text-sm text-co-text
            transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        />
      </label>

      {/* Photo button — disabled with Phase 6 tooltip per Surface 3 +
          photo-deferral decision. Form state shape stays forward-compat;
          Phase 6 swaps the disabled button for a real PhotoUploader. */}
      <div className="flex justify-end">
        <button
          type="button"
          disabled
          aria-label={t("opening.item.photo_pending_label")}
          title={t("opening.item.photo_pending_tooltip")}
          className="
            inline-flex h-9 w-9 items-center justify-center rounded-md
            border border-co-border-2 bg-co-surface text-co-text-dim
            opacity-40 cursor-not-allowed
          "
        >
          <CameraIcon />
        </button>
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

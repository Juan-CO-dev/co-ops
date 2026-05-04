"use client";

/**
 * PrepSection — Build #2 PR 1, Part 1.
 *
 * Generic section wrapper for AM Prep numeric sections (Veg, Cooks, Sides,
 * Sauces, Slicing). Renders:
 *
 *   ┌─ section card ──────────────────────────────────────┐
 *   │ SECTION HEADER (uppercase, mustard-deep accent)     │
 *   │ ─────────────────────────────────────────────────── │
 *   │ ITEM        │ PAR │ ONHAND │ BACKUP │ TOTAL         │  ← column headers
 *   │ ─────────────────────────────────────────────────── │
 *   │ Iceberg     │ 7m  │ [3.5 ] │ [2   ] │ [5.5 ]        │
 *   │ Onion       │ 8QT │ [4   ] │ [3   ] │ [7   ]        │
 *   │ ...                                                  │
 *   └──────────────────────────────────────────────────────┘
 *
 * MiscSection has a different shape (yes/no toggles + free text) and uses
 * its own internal layout; it still wraps in this same outer card via
 * `<PrepSection>` for visual consistency with the brand chrome.
 *
 * Section header brand chrome inherited from closing-client's StationGroup
 * (per SPEC_AMENDMENTS.md C.30 station-header prominence + C.38 system-key
 * vs display-string discipline):
 *   - Mustard-deep border-b accent under the title
 *   - text-lg font-bold uppercase tracking-[0.14em]
 *   - Non-interactive (no chevron, no collapse — AM Prep is single-page-
 *     single-submit; collapse isn't a feature)
 *
 * SYSTEM-KEY DISCIPLINE: `section` prop is the system key (English source-
 * of-truth from prep_meta.section); `sectionDisplay` is the rendered text
 * (translated via the existing translations JSONB on template items, OR
 * via am_prep.section.<lower-case> i18n keys when no template translation
 * exists).
 *
 * Empty-state rendering: when `templateItemCount === 0`, renders the
 * am_prep.section.empty key. Probably never fires in production (sections
 * with no items wouldn't be seeded) but the shell stays predictable.
 */

import type { ReactNode } from "react";

import { useTranslation } from "@/lib/i18n/provider";

export interface PrepSectionProps {
  /** SECTION SYSTEM-KEY (English source-of-truth). Used for ARIA + data attrs. */
  section: string;
  /** Display string (translated). Renders as the visible header text. */
  sectionDisplay: string;
  /** Number of items in this section — drives the empty-state branch. */
  templateItemCount: number;
  /** Pre-computed column header descriptors for this section's table. */
  columnHeaders: ReadonlyArray<{ key: string; label: string }>;
  /** Section row content. The section component (e.g., VegSection) maps
   * its template items through PrepRow and passes the rendered nodes here. */
  children: ReactNode;
}

export function PrepSection({
  section,
  sectionDisplay,
  templateItemCount,
  columnHeaders,
  children,
}: PrepSectionProps) {
  const { t } = useTranslation();

  // Grid template-columns string mirrors PrepRow's grid: label flex + N
  // fixed-width cells. Section component is responsible for passing the
  // right number of column headers; this section just renders them in the
  // same grid track shape.
  const gridTemplateColumns = `minmax(0, 1fr) repeat(${columnHeaders.length}, minmax(48px, 56px))`;

  return (
    <section
      data-section={section}
      aria-label={t("am_prep.section.aria", { section: sectionDisplay })}
      className="rounded-2xl border-2 border-co-border bg-co-surface"
    >
      {/* Section header — non-interactive; mustard-deep accent line per
          SPEC_AMENDMENTS.md C.30 (matches StationGroup style). */}
      <div className="px-4 pt-3 pb-2">
        <h3
          className="
            inline-block text-lg font-bold uppercase tracking-[0.14em] text-co-text
            border-b-2 border-co-gold-deep pb-0.5
          "
        >
          {sectionDisplay}
        </h3>
      </div>

      {templateItemCount === 0 ? (
        <div className="px-4 pb-3 text-sm text-co-text-dim italic">
          {t("am_prep.section.empty", { section: sectionDisplay })}
        </div>
      ) : (
        <div className="px-3 pb-3">
          {/* Column headers — same grid track shape as PrepRow. Numeric
              sections render the header strip; sections with no columns
              (Misc) skip it and let their internal row layout speak for
              itself. */}
          {columnHeaders.length > 0 ? (
            <div
              className="
                grid items-end gap-1.5 pb-1 border-b-2 border-co-border-2
                text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim
              "
              style={{ gridTemplateColumns }}
            >
              {/* First grid cell is empty — aligns under the row label column. */}
              <div />
              {columnHeaders.map((col) => (
                <div key={col.key} className="text-center">
                  {col.label}
                </div>
              ))}
            </div>
          ) : null}

          {/* Rows. */}
          <div className="flex flex-col">{children}</div>
        </div>
      )}
    </section>
  );
}

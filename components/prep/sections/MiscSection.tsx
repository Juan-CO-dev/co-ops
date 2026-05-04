"use client";

/**
 * MiscSection — Build #2 PR 1, Part 1.
 *
 * Renders the "Misc" prep section. Different shape from the numeric sections —
 * each row is a yes/no toggle pair (with optional free-text notes), not a
 * column-based numeric table.
 *
 * Items typically (per Image 1):
 *   - Meatball mix - ready? Y/N
 *   - Meatballs - ready to cook? Y/N
 *   - Meatballs - for reheat? Y/N
 *   - Cook Bacon? Y/N (with optional notes)
 *
 * Plus a section-level free-form notes area at the end (rendered as the
 * last item with column = "free_text").
 *
 * Toggle pair pattern (locked):
 *   - Two chip-style buttons side by side: YES | NO
 *   - aria-pressed on the selected chip
 *   - Selected: bg-co-gold (Mustard fill) + text-co-text + border-co-text
 *   - Unselected: bg-co-surface + text-co-text-muted + border-co-border-2
 *   - Active hover: border-co-text on unselected; bg-co-gold-deep on selected
 *
 * Section is read-only in Part 1 (controlled-input shape from parent shell).
 */

import { useTranslation } from "@/lib/i18n/provider";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { ChecklistTemplateItem } from "@/lib/types";

import { PrepSection } from "../PrepSection";
import type { RawPrepInputs } from "../types";

const SECTION_KEY = "Misc";

export interface MiscSectionProps {
  templateItems: ChecklistTemplateItem[];
  rawValues: Record<string, RawPrepInputs>;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
}

/**
 * Inner Misc row — yes/no toggle pair + optional free-text textarea (when
 * the template item's prep_meta.columns includes "free_text").
 *
 * Receives the same `onChange` shape as the numeric rows, but raw values
 * passed are stringly-typed:
 *   - "true" / "false" for yesNo (parent parses to boolean at submit time)
 *   - free text passes through as-is for freeText
 *
 * Keeping the onChange signature uniform across all sections lets the
 * parent shell wire one callback for everything.
 */
function MiscRow({
  templateItemId,
  itemLabel,
  yesNo,
  freeText,
  hasFreeText,
  onChange,
  disabled,
}: {
  templateItemId: string;
  itemLabel: string;
  yesNo: boolean | undefined;
  freeText: string | undefined;
  hasFreeText: boolean;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const isYes = yesNo === true;
  const isNo = yesNo === false;

  const yesLabel = t("am_prep.misc.yes");
  const noLabel = t("am_prep.misc.no");
  const yesAria = t("am_prep.misc.toggle_aria", {
    item: itemLabel,
    state: isYes ? yesLabel : isNo ? noLabel : "—",
  });

  return (
    <div className="flex flex-col gap-2 py-2 border-b border-co-border last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-co-text leading-tight flex-1 min-w-0">
          {itemLabel}
        </span>
        {/* Toggle pair — chip style. Always shows YES + NO side-by-side; one
            is "selected" via aria-pressed + Mustard fill. */}
        <div
          role="group"
          aria-label={yesAria}
          className="inline-flex shrink-0 gap-1.5"
        >
          <button
            type="button"
            aria-pressed={isYes}
            disabled={disabled}
            onClick={() => onChange(templateItemId, "yesNo", "true")}
            className={[
              "inline-flex min-h-[36px] min-w-[44px] items-center justify-center rounded-md",
              "border-2 px-3 text-xs font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              "disabled:cursor-not-allowed disabled:opacity-60",
              isYes
                ? "border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
                : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text",
            ].join(" ")}
          >
            {yesLabel}
          </button>
          <button
            type="button"
            aria-pressed={isNo}
            disabled={disabled}
            onClick={() => onChange(templateItemId, "yesNo", "false")}
            className={[
              "inline-flex min-h-[36px] min-w-[44px] items-center justify-center rounded-md",
              "border-2 px-3 text-xs font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              "disabled:cursor-not-allowed disabled:opacity-60",
              isNo
                ? "border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
                : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text",
            ].join(" ")}
          >
            {noLabel}
          </button>
        </div>
      </div>

      {hasFreeText ? (
        <label className="block">
          <span className="sr-only">{t("am_prep.misc.notes_label")}</span>
          <textarea
            value={freeText ?? ""}
            onChange={(e) => onChange(templateItemId, "freeText", e.target.value)}
            placeholder={t("am_prep.misc.notes_placeholder")}
            rows={2}
            disabled={disabled}
            className="
              w-full rounded-md border-2 border-co-border bg-white
              px-3 py-2 text-sm text-co-text
              focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40
              disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-co-surface-2
            "
          />
        </label>
      ) : null}
    </div>
  );
}

export function MiscSection({ templateItems, rawValues, onChange, disabled }: MiscSectionProps) {
  const { t, language } = useTranslation();
  const sectionDisplay = (() => {
    const first = templateItems[0];
    if (first) {
      const resolved = resolveTemplateItemContent(first, language);
      if (resolved.station) return resolved.station;
    }
    return t("am_prep.section.misc");
  })();

  // Misc has no numeric column headers — just an empty header row to maintain
  // the visual section card consistency. Pass an empty columnHeaders array;
  // PrepSection handles the no-columns case gracefully (renders the section
  // card without the column header strip).
  return (
    <PrepSection
      section={SECTION_KEY}
      sectionDisplay={sectionDisplay}
      templateItemCount={templateItems.length}
      columnHeaders={[]}
    >
      <div className="flex flex-col">
        {templateItems.map((item) => {
          const resolved = resolveTemplateItemContent(item, language);
          const meta = item.prepMeta;
          if (!meta) return null;
          const inputs = rawValues[item.id] ?? {};
          const hasFreeText = meta.columns.includes("free_text");
          return (
            <MiscRow
              key={item.id}
              templateItemId={item.id}
              itemLabel={resolved.label}
              yesNo={inputs.yesNo}
              freeText={inputs.freeText}
              hasFreeText={hasFreeText}
              onChange={onChange}
              disabled={disabled}
            />
          );
        })}
      </div>
    </PrepSection>
  );
}

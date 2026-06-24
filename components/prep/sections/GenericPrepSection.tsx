"use client";

/**
 * GenericPrepSection — shape-driven numeric section (Item/Inventory Spine, Task 3).
 *
 * One component replaces the five near-identical numeric section wrappers
 * (Veg / Cooks / Sides / Sauces / Slicing). It's data-driven: the caller passes
 * the section slug, its shape (a numeric PrepSectionShape), and the column set
 * from the section def (e.g. ["par","on_hand","back_up","total"]). The component
 * derives column headers + the editable input columns from `columns`, and the
 * auto-calc-total gate from whether `columns` includes "total".
 *
 * yes_no sections are NOT handled here — the caller routes those to MiscSection
 * (different row shape: toggle pair + optional free text). This component only
 * handles the numeric shapes (on_hand / portioned / line).
 *
 * Structure mirrors the old VegSection/CooksSection wrappers exactly: resolve a
 * section display name (DB label → first item's station → slug), build column
 * headers via the column translation keys, then map templateItems → PrepRow.
 */

import { useTranslation } from "@/lib/i18n/provider";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import { resolveSectionLabel } from "@/lib/prep-sections";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ChecklistTemplateItem, PrepColumn, PrepSectionShape } from "@/lib/types";

import { PrepRow } from "../PrepRow";
import { PrepSection } from "../PrepSection";
import type { RawPrepInputs } from "../types";

/** Numeric input column type — matches PrepRow's `inputColumns` prop element type. */
type NumericInputColumn = Exclude<PrepColumn, "par" | "yes_no" | "free_text">;

const NUMERIC_INPUT_COLUMNS: ReadonlySet<NumericInputColumn> = new Set([
  "on_hand",
  "portioned",
  "line",
  "back_up",
  "total",
]);

/** Type-predicate narrowing filter: keeps only the numeric input columns. */
function isNumericInputColumn(col: PrepColumn): col is NumericInputColumn {
  return NUMERIC_INPUT_COLUMNS.has(col as NumericInputColumn);
}

export interface GenericPrepSectionProps {
  /** Section slug (system key, English source-of-truth). */
  section: string;
  /** Numeric shape only; the caller routes yes_no → MiscSection. */
  shape: PrepSectionShape;
  /** Column set from the section def, in render order (e.g. ["par","on_hand","back_up","total"]). */
  columns: PrepColumn[];
  /** Pre-narrowed (via narrowPrepTemplateItem) and pre-filtered to this section. */
  templateItems: ChecklistTemplateItem[];
  rawValues: Record<string, RawPrepInputs>;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
  /** Per-row, per-field validation errors. Optional. */
  errors?: Record<string, Partial<Record<keyof RawPrepInputs, string>>>;
  /** DB-backed section labels (slug → { en, es }); preferred over the i18n fallback. */
  sectionLabels?: Record<string, { en: string; es: string | null }>;
}

export function GenericPrepSection({
  section,
  shape: _shape,
  columns,
  templateItems,
  rawValues,
  onChange,
  disabled,
  errors,
  sectionLabels,
}: GenericPrepSectionProps) {
  const { t, language } = useTranslation();

  // Resolve section display name. Prefers the DB-backed section label (Sections
  // First-Class), then the first item's translations JSONB (per C.38). There is
  // no per-slug i18n key for arbitrary sections, so the final fallback is the
  // slug itself.
  const sectionDisplay = (() => {
    const fallback = (() => {
      const first = templateItems[0];
      if (first) {
        const resolved = resolveTemplateItemContent(first, language);
        if (resolved.station) return resolved.station;
      }
      return section;
    })();
    return resolveSectionLabel(sectionLabels ?? {}, section, language, fallback);
  })();

  // Column headers — one per entry in `columns`, in order (par + the input
  // columns). Reuses the same translation keys as PrepRow's
  // COLUMN_TRANSLATION_KEY map (am_prep.column.<col>).
  const columnHeaders = columns.map((col) => ({
    key: col,
    label: t(`am_prep.column.${col}` as TranslationKey),
  }));

  // Editable numeric input cells — `columns` minus par/yes_no/free_text.
  const inputColumns: ReadonlyArray<NumericInputColumn> = columns.filter(isNumericInputColumn);

  // Auto-calc TOTAL when this section's column set includes "total". PrepRow
  // reads this via its autoCalcTotal prop (Task 4 step 1; added here so this
  // component compiles).
  const autoCalcTotal = columns.includes("total");

  return (
    <PrepSection
      section={section}
      sectionDisplay={sectionDisplay}
      templateItemCount={templateItems.length}
      columnHeaders={columnHeaders}
    >
      {templateItems.map((item) => {
        const resolved = resolveTemplateItemContent(item, language);
        const meta = item.prepMeta;
        // narrowPrepTemplateItem upstream guarantees prepMeta is non-null for
        // prep-template items; this is a defensive guard for the type narrowing.
        if (!meta) return null;
        return (
          <PrepRow
            key={item.id}
            templateItemId={item.id}
            section={section}
            sectionDisplay={sectionDisplay}
            label={resolved.label}
            parValue={meta.parValue}
            parUnit={meta.parUnit}
            specialInstruction={resolved.specialInstruction}
            inputColumns={inputColumns}
            rawInputs={rawValues[item.id] ?? {}}
            onChange={onChange}
            disabled={disabled}
            rowErrors={errors?.[item.id]}
            autoCalcTotal={autoCalcTotal}
          />
        );
      })}
    </PrepSection>
  );
}

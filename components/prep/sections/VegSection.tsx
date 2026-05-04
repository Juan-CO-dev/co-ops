"use client";

/**
 * VegSection — Build #2 PR 1, Part 1.
 *
 * Renders the "Veg" prep section. Columns: PAR / ON HAND / BACK UP / TOTAL.
 *
 * Items typically: Iceberg, Onion, Basil, Radish, Cucumber, Tomato (per
 * Image 1 source). Tomato has special_instruction = "Prep Daily" with
 * parValue = null — handled by PrepRow's parDisplay branch.
 *
 * Section is read-only in Part 1 (controlled-input shape: receives values
 * + onChange from parent shell, which passes empty values + no-op onChange).
 * Part 2 wires real state.
 */

import { useTranslation } from "@/lib/i18n/provider";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { ChecklistTemplateItem } from "@/lib/types";

import { PrepRow } from "../PrepRow";
import { PrepSection } from "../PrepSection";
import type { RawPrepInputs } from "../types";

const SECTION_KEY = "Veg";
const INPUT_COLUMNS = ["on_hand", "back_up", "total"] as const;

export interface VegSectionProps {
  /** Pre-narrowed (via narrowPrepTemplateItem) and pre-filtered to section="Veg". */
  templateItems: ChecklistTemplateItem[];
  rawValues: Record<string, RawPrepInputs>;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
  /** Per-row, per-field validation errors. Optional. */
  errors?: Record<string, Partial<Record<keyof RawPrepInputs, string>>>;
}

export function VegSection({ templateItems, rawValues, onChange, disabled, errors }: VegSectionProps) {
  const { t, language } = useTranslation();
  // Resolve section display name. Pulled from the first item's translations
  // JSONB (per C.38) or falls back to the am_prep.section.veg i18n key.
  const sectionDisplay = (() => {
    const first = templateItems[0];
    if (first) {
      const resolved = resolveTemplateItemContent(first, language);
      if (resolved.station) return resolved.station;
    }
    return t("am_prep.section.veg");
  })();

  const columnHeaders = [
    { key: "par", label: t("am_prep.column.par") },
    { key: "on_hand", label: t("am_prep.column.on_hand") },
    { key: "back_up", label: t("am_prep.column.back_up") },
    { key: "total", label: t("am_prep.column.total") },
  ];

  return (
    <PrepSection
      section={SECTION_KEY}
      sectionDisplay={sectionDisplay}
      templateItemCount={templateItems.length}
      columnHeaders={columnHeaders}
    >
      {templateItems.map((item) => {
        const resolved = resolveTemplateItemContent(item, language);
        const meta = item.prepMeta;
        // narrowPrepTemplateItem upstream guarantees prepMeta is non-null
        // for prep-template items; this is a defensive guard for the type
        // narrowing here (TS doesn't know about the upstream invariant).
        if (!meta) return null;
        return (
          <PrepRow
            key={item.id}
            templateItemId={item.id}
            section={SECTION_KEY}
            sectionDisplay={sectionDisplay}
            label={resolved.label}
            parValue={meta.parValue}
            parUnit={meta.parUnit}
            specialInstruction={resolved.specialInstruction}
            inputColumns={INPUT_COLUMNS}
            rawInputs={rawValues[item.id] ?? {}}
            onChange={onChange}
            disabled={disabled}
            rowErrors={errors?.[item.id]}
          />
        );
      })}
    </PrepSection>
  );
}

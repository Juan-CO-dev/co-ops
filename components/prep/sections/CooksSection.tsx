"use client";

/**
 * CooksSection — Build #2 PR 1, Part 1.
 *
 * Renders the "Cooks" prep section. Columns: PAR / ON HAND / TOTAL.
 *
 * Note the absence of BACK UP — Cooks-section items (Vodka sauce, Marinara,
 * Compound Butter, Caramelized onion, Jus) are typically prepped end-to-end
 * with no separate "unbottled" stage. The 3-column layout reflects that
 * operational reality.
 *
 * Section is read-only in Part 1 (controlled-input shape from parent shell).
 */

import { useTranslation } from "@/lib/i18n/provider";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { ChecklistTemplateItem } from "@/lib/types";

import { PrepRow } from "../PrepRow";
import { PrepSection } from "../PrepSection";
import type { RawPrepInputs } from "../types";

const SECTION_KEY = "Cooks";
const INPUT_COLUMNS = ["on_hand", "total"] as const;

export interface CooksSectionProps {
  templateItems: ChecklistTemplateItem[];
  rawValues: Record<string, RawPrepInputs>;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
  errors?: Record<string, Partial<Record<keyof RawPrepInputs, string>>>;
}

export function CooksSection({ templateItems, rawValues, onChange, disabled, errors }: CooksSectionProps) {
  const { t, language } = useTranslation();
  const sectionDisplay = (() => {
    const first = templateItems[0];
    if (first) {
      const resolved = resolveTemplateItemContent(first, language);
      if (resolved.station) return resolved.station;
    }
    return t("am_prep.section.cooks");
  })();

  const columnHeaders = [
    { key: "par", label: t("am_prep.column.par") },
    { key: "on_hand", label: t("am_prep.column.on_hand") },
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
            specialInstruction={meta.specialInstruction}
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

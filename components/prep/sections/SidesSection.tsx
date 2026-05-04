"use client";

/**
 * SidesSection — Build #2 PR 1, Part 1.
 *
 * Renders the "Sides" prep section. Columns: PAR / PORTIONED / BACK UP / TOTAL.
 *
 * "Portioned" replaces "On Hand" semantically — sides (Tuna Salad, Egg Salad,
 * Onion Dip, Chix Salad, Antipasto Pasta, Cannoli Cream) are pre-portioned
 * into service-ready containers. PORTIONED counts the ready-to-serve cups;
 * BACK UP is the bulk batch waiting to be portioned.
 *
 * Section is read-only in Part 1 (controlled-input shape from parent shell).
 */

import { useTranslation } from "@/lib/i18n/provider";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { ChecklistTemplateItem } from "@/lib/types";

import { PrepRow } from "../PrepRow";
import { PrepSection } from "../PrepSection";
import type { RawPrepInputs } from "../types";

const SECTION_KEY = "Sides";
const INPUT_COLUMNS = ["portioned", "back_up", "total"] as const;

export interface SidesSectionProps {
  templateItems: ChecklistTemplateItem[];
  rawValues: Record<string, RawPrepInputs>;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
  errors?: Record<string, Partial<Record<keyof RawPrepInputs, string>>>;
}

export function SidesSection({ templateItems, rawValues, onChange, disabled, errors }: SidesSectionProps) {
  const { t, language } = useTranslation();
  const sectionDisplay = (() => {
    const first = templateItems[0];
    if (first) {
      const resolved = resolveTemplateItemContent(first, language);
      if (resolved.station) return resolved.station;
    }
    return t("am_prep.section.sides");
  })();

  const columnHeaders = [
    { key: "par", label: t("am_prep.column.par") },
    { key: "portioned", label: t("am_prep.column.portioned") },
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

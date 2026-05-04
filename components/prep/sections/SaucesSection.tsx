"use client";

/**
 * SaucesSection — Build #2 PR 1, Part 1.
 *
 * Renders the "Sauces" prep section. Columns: PAR / LINE / BACK UP / TOTAL.
 *
 * "Line" replaces "On Hand" semantically — sauces (Aioli, HC Aioli, HP Mayo,
 * Mustard Aioli, Horsey Mayo, Salsa Verde, Dukes, Vin) are bottled and live
 * on the line during service. LINE counts squeeze-bottles ready on the line;
 * BACK UP is the un-bottled bulk in the walk-in.
 *
 * Section is read-only in Part 1 (controlled-input shape from parent shell).
 */

import { useTranslation } from "@/lib/i18n/provider";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { ChecklistTemplateItem, PrepInputs } from "@/lib/types";

import { PrepRow } from "../PrepRow";
import { PrepSection } from "../PrepSection";

const SECTION_KEY = "Sauces";
const INPUT_COLUMNS = ["line", "back_up", "total"] as const;

export interface SaucesSectionProps {
  templateItems: ChecklistTemplateItem[];
  values: Record<string, PrepInputs>;
  onChange: (templateItemId: string, field: keyof PrepInputs, rawValue: string) => void;
  disabled?: boolean;
}

export function SaucesSection({ templateItems, values, onChange, disabled }: SaucesSectionProps) {
  const { t, language } = useTranslation();
  const sectionDisplay = (() => {
    const first = templateItems[0];
    if (first) {
      const resolved = resolveTemplateItemContent(first, language);
      if (resolved.station) return resolved.station;
    }
    return t("am_prep.section.sauces");
  })();

  const columnHeaders = [
    { key: "par", label: t("am_prep.column.par") },
    { key: "line", label: t("am_prep.column.line") },
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
            specialInstruction={meta.specialInstruction}
            inputColumns={INPUT_COLUMNS}
            inputs={values[item.id] ?? {}}
            onChange={onChange}
            disabled={disabled}
          />
        );
      })}
    </PrepSection>
  );
}

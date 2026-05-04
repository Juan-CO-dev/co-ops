"use client";

/**
 * AmPrepForm — Build #2 PR 1, Part 1 (read-only structural skeleton).
 *
 * Top-level component for the AM Prep form. Groups templateItems by
 * prep_meta.section (system-key per C.38) and mounts the 6 section
 * components in canonical order: Veg → Cooks → Sides → Sauces → Slicing
 * → Misc.
 *
 * PART 1 SCOPE (this file): purely structural. Receives templateItems +
 * `values` Record<templateItemId, PrepInputs> + `onChange` callback. Part
 * 1's parent shell passes empty values + no-op onChange — no submission
 * state, no validation, no dirty tracking, no API calls. Visual layout
 * + brand chrome + i18n only.
 *
 * PART 2 SCOPE (next commit): replaces the parent's empty-values + no-op
 * onChange with real state management:
 *   - Owns the values Map state
 *   - Dirty tracking (compare against initial values)
 *   - Submit handler invoking POST /api/prep/submit
 *   - Validation (numeric parsing, error surface)
 *   - Read-only mode after instance.status === 'confirmed'
 *
 * Section grouping discipline (per C.38): groups by `prepMeta.section` —
 * the typed enum-valued accessor that's been narrowed via
 * narrowPrepTemplateItem upstream. The lib has already enforced the
 * station/section sync invariant; this component trusts the narrowed
 * shape and groups by the typed key. Items lacking prepMeta (defensive)
 * are dropped from rendering with a warn-only log; the upstream narrower
 * would have already thrown on shape errors, so this branch is a true
 * defensive no-op.
 */

import { useMemo } from "react";

import type {
  ChecklistTemplateItem,
  PrepInputs,
  PrepSection as PrepSectionEnum,
} from "@/lib/types";

import { CooksSection } from "./sections/CooksSection";
import { MiscSection } from "./sections/MiscSection";
import { SaucesSection } from "./sections/SaucesSection";
import { SidesSection } from "./sections/SidesSection";
import { SlicingSection } from "./sections/SlicingSection";
import { VegSection } from "./sections/VegSection";

// Canonical section render order. Matches the operational flow of an AM
// Prep handoff (per Image 1 source): produce → cooks → portioned sides
// → sauces → slicing → misc Y/N + bacon notes.
const SECTION_ORDER: ReadonlyArray<PrepSectionEnum> = [
  "Veg",
  "Cooks",
  "Sides",
  "Sauces",
  "Slicing",
  "Misc",
];

export interface AmPrepFormProps {
  /**
   * Pre-narrowed via narrowPrepTemplateItem (lib/prep.ts). Items WITHOUT
   * prepMeta (cleaning items mistakenly mounted here, etc.) are dropped
   * defensively — the upstream narrower already throws on shape errors.
   */
  templateItems: ChecklistTemplateItem[];
  /** Operator-supplied values keyed by templateItemId. Empty in Part 1's parent shell. */
  values: Record<string, PrepInputs>;
  /**
   * Per-cell change callback. Field name is the camelCase key on PrepInputs;
   * value is the raw string from the input element (or "true"/"false" for
   * Misc yes/no toggles). Parent owns parsing + state.
   */
  onChange: (templateItemId: string, field: keyof PrepInputs, rawValue: string) => void;
  /** Read-only display (after submit). Disables all inputs across all sections. */
  disabled?: boolean;
}

export function AmPrepForm({
  templateItems,
  values,
  onChange,
  disabled = false,
}: AmPrepFormProps) {
  // Group by section system-key (per C.38). Items without prepMeta are
  // logged + dropped defensively — narrowPrepTemplateItem upstream throws
  // on shape errors, so this branch is a true defensive no-op for current
  // data.
  const itemsBySection = useMemo(() => {
    const groups = new Map<PrepSectionEnum, ChecklistTemplateItem[]>();
    for (const section of SECTION_ORDER) groups.set(section, []);
    for (const item of templateItems) {
      if (!item.prepMeta) {
        // Defensive — should not happen for prep templates after narrowing.
        console.warn(
          `[AmPrepForm] template_item ${item.id} has no prepMeta; dropping. ` +
            `narrowPrepTemplateItem upstream should have caught this.`,
        );
        continue;
      }
      const list = groups.get(item.prepMeta.section);
      if (list) list.push(item);
    }
    // Sort each group by display_order to preserve operational flow within
    // a section (Iceberg before Onion within Veg, etc.).
    for (const list of groups.values()) {
      list.sort((a, b) => a.displayOrder - b.displayOrder);
    }
    return groups;
  }, [templateItems]);

  return (
    <div className="flex flex-col gap-4">
      {/* Section components mount in canonical order. Each section receives
          its filtered slice of templateItems; sections with zero items
          render the am_prep.section.empty state via PrepSection. */}
      <VegSection
        templateItems={itemsBySection.get("Veg") ?? []}
        values={values}
        onChange={onChange}
        disabled={disabled}
      />
      <CooksSection
        templateItems={itemsBySection.get("Cooks") ?? []}
        values={values}
        onChange={onChange}
        disabled={disabled}
      />
      <SidesSection
        templateItems={itemsBySection.get("Sides") ?? []}
        values={values}
        onChange={onChange}
        disabled={disabled}
      />
      <SaucesSection
        templateItems={itemsBySection.get("Sauces") ?? []}
        values={values}
        onChange={onChange}
        disabled={disabled}
      />
      <SlicingSection
        templateItems={itemsBySection.get("Slicing") ?? []}
        values={values}
        onChange={onChange}
        disabled={disabled}
      />
      <MiscSection
        templateItems={itemsBySection.get("Misc") ?? []}
        values={values}
        onChange={onChange}
        disabled={disabled}
      />

      {/* Part 2 lands the submit affordance + validation + read-only mode
          banner here. Part 1 ships the structural skeleton only. */}
    </div>
  );
}

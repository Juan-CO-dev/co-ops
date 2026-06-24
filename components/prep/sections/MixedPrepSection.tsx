"use client";

/**
 * MixedPrepSection — per-line input-types render (Slice 1, PR A).
 *
 * Renders a section whose lines do NOT all share the section's default shape —
 * i.e. a HETEROGENEOUS section. Each line picks its own control from its
 * `prep_meta.columns` (via shapeFromColumns), so a single section can hold a
 * numeric line next to a yes_no toggle next to a free_text question.
 *
 * The homogeneous sections (today's 6 seeded sections) NEVER route here — the
 * caller (AmPrepForm) only dispatches a section to MixedPrepSection when at
 * least one line's shape differs from the section default. This keeps the
 * uniform render (GenericPrepSection / MiscSection) byte-identical for every
 * existing section; MixedPrepSection only exists for the mixed case PR B
 * introduces.
 *
 * Because the lines can't share one column-header strip (each numeric line may
 * carry a different column set), this component passes an EMPTY columnHeaders to
 * PrepSection (which skips the header strip — PrepSection gates on
 * columnHeaders.length > 0). Numeric lines instead render a tiny per-row inline
 * column-label caption so a sighted operator still sees what each cell means;
 * screen-reader operators are covered by PrepRow's per-cell ARIA labels
 * (section · item · column), which are unchanged.
 *
 * Per-control faithfulness:
 *   - numeric (on_hand / portioned / line) → a <PrepRow>, same props the uniform
 *     GenericPrepSection passes (inputColumns = the line's columns minus
 *     par/yes_no/free_text; autoCalcTotal = columns.includes("total")).
 *   - yes_no → the SAME toggle-pair + optional free_text note MiscSection
 *     renders. MiscRow is module-private to MiscSection (not exported), so the
 *     markup is replicated here faithfully — identical i18n keys + brand tokens.
 *   - free_text → a labeled textarea writing `freeText` via onChange.
 */

import { useTranslation } from "@/lib/i18n/provider";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import { resolveSectionLabel, shapeFromColumns } from "@/lib/prep-sections";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ChecklistTemplateItem, PrepColumn } from "@/lib/types";

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

export interface MixedPrepSectionProps {
  /** Section slug (system key, English source-of-truth). */
  section: string;
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

/**
 * yes_no row — replicated faithfully from MiscSection's (module-private) MiscRow.
 * Same toggle-pair markup, same i18n keys, same brand tokens, same optional
 * free_text note. Kept in lockstep with MiscRow so a yes_no line in a mixed
 * section is visually indistinguishable from a Misc-section yes_no row.
 */
function MixedYesNoRow({
  templateItemId,
  itemLabel,
  yesNo,
  freeText,
  hasFreeText,
  onChange,
  disabled,
  yesNoError,
}: {
  templateItemId: string;
  itemLabel: string;
  yesNo: boolean | undefined;
  freeText: string | undefined;
  hasFreeText: boolean;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
  yesNoError?: string;
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
        <div role="group" aria-label={yesAria} className="inline-flex shrink-0 gap-1.5">
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

      {yesNoError ? (
        <span role="alert" className="text-[11px] leading-tight text-co-cta font-semibold">
          {yesNoError}
        </span>
      ) : null}

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

/**
 * free_text row — a labeled textarea writing `freeText`. Distinct from the
 * yes_no row's optional note: this is the WHOLE control for a text-only
 * question line (columns === ["free_text"]).
 */
function MixedFreeTextRow({
  templateItemId,
  itemLabel,
  freeText,
  onChange,
  disabled,
  freeTextError,
}: {
  templateItemId: string;
  itemLabel: string;
  freeText: string | undefined;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
  freeTextError?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 py-2 border-b border-co-border last:border-b-0">
      <label className="block">
        <span className="text-sm font-semibold text-co-text leading-tight">{itemLabel}</span>
        <textarea
          value={freeText ?? ""}
          onChange={(e) => onChange(templateItemId, "freeText", e.target.value)}
          placeholder={t("am_prep.misc.notes_placeholder")}
          rows={2}
          disabled={disabled}
          className="
            mt-1.5 w-full rounded-md border-2 border-co-border bg-white
            px-3 py-2 text-sm text-co-text
            focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40
            disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-co-surface-2
          "
        />
      </label>
      {freeTextError ? (
        <span role="alert" className="text-[11px] leading-tight text-co-cta font-semibold">
          {freeTextError}
        </span>
      ) : null}
    </div>
  );
}

export function MixedPrepSection({
  section,
  templateItems,
  rawValues,
  onChange,
  disabled,
  errors,
  sectionLabels,
}: MixedPrepSectionProps) {
  const { t, language } = useTranslation();

  // Resolve section display name — same 3-tier resolution as GenericPrepSection
  // (DB label → first item's station → slug).
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

  return (
    <PrepSection
      section={section}
      sectionDisplay={sectionDisplay}
      templateItemCount={templateItems.length}
      // Mixed lines can't share one header strip — pass empty so PrepSection
      // skips it (it gates on columnHeaders.length > 0). Numeric lines render
      // their own inline per-row column labels below.
      columnHeaders={[]}
    >
      <div className="flex flex-col">
        {templateItems.map((item) => {
          const resolved = resolveTemplateItemContent(item, language);
          const meta = item.prepMeta;
          if (!meta) return null;
          const it = shapeFromColumns(meta.columns);
          const inputs = rawValues[item.id] ?? {};

          if (it === "yes_no") {
            return (
              <MixedYesNoRow
                key={item.id}
                templateItemId={item.id}
                itemLabel={resolved.label}
                yesNo={inputs.yesNo}
                freeText={inputs.freeText}
                hasFreeText={meta.columns.includes("free_text")}
                onChange={onChange}
                disabled={disabled}
                yesNoError={errors?.[item.id]?.yesNo}
              />
            );
          }

          if (it === "free_text") {
            return (
              <MixedFreeTextRow
                key={item.id}
                templateItemId={item.id}
                itemLabel={resolved.label}
                freeText={inputs.freeText}
                onChange={onChange}
                disabled={disabled}
                freeTextError={errors?.[item.id]?.freeText}
              />
            );
          }

          // Numeric line (on_hand / portioned / line). Same PrepRow props
          // GenericPrepSection passes. inputColumns = this line's columns minus
          // par/yes_no/free_text; autoCalcTotal driven by whether the line's
          // own columns include "total".
          const inputColumns: ReadonlyArray<NumericInputColumn> =
            meta.columns.filter(isNumericInputColumn);
          const autoCalcTotal = meta.columns.includes("total");
          // Inline per-row column labels (PAR + each input column) — the mixed
          // section has no shared header strip, so a tiny caption keeps the
          // numeric cells legible for sighted operators. ARIA covers the rest.
          const captionColumns: PrepColumn[] = meta.columns.filter(
            (c) => c === "par" || isNumericInputColumn(c),
          );
          return (
            <div key={item.id} className="flex flex-col">
              <div
                className="
                  grid items-end gap-1.5 pt-1.5
                  text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim
                "
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) repeat(${captionColumns.length}, minmax(48px, 56px))`,
                }}
                aria-hidden="true"
              >
                <div />
                {captionColumns.map((col) => (
                  <div key={col} className="text-center">
                    {t(`am_prep.column.${col}` as TranslationKey)}
                  </div>
                ))}
              </div>
              <PrepRow
                templateItemId={item.id}
                section={section}
                sectionDisplay={sectionDisplay}
                label={resolved.label}
                parValue={meta.parValue}
                parUnit={meta.parUnit}
                specialInstruction={resolved.specialInstruction}
                inputColumns={inputColumns}
                rawInputs={inputs}
                onChange={onChange}
                disabled={disabled}
                rowErrors={errors?.[item.id]}
                autoCalcTotal={autoCalcTotal}
              />
            </div>
          );
        })}
      </div>
    </PrepSection>
  );
}

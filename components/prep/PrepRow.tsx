"use client";

/**
 * PrepRow — Build #2 PR 1, Part 1.
 *
 * Generic row primitive for AM Prep numeric sections (Veg, Cooks, Sides,
 * Sauces, Slicing). Renders:
 *
 *   ┌────────────────┬──────┬──────┬──────┬──────┐
 *   │ Item label     │ PAR  │ <in> │ <in> │ <in> │
 *   │ (special note) │ (RO) │      │      │      │
 *   └────────────────┴──────┴──────┴──────┴──────┘
 *
 * Layout: CSS grid with the label column flexing and numeric columns at
 * fixed widths (per the locked compressed-table strategy — fits 4 columns
 * + label at 320px viewport without horizontal scroll).
 *
 * The PAR cell is read-only (displays prep_meta.parValue + parUnit). Operator
 * input cells render via PrepNumericCell. Misc-section rows have a different
 * shape (yes/no + free text) and use MiscRow inside MiscSection rather than
 * this primitive.
 *
 * Controlled-input shape per Part 1 lock:
 *   - `inputs` carries the current values for this row (subset of PrepInputs)
 *   - `onChange(field, value)` fires per cell change; parent owns state
 *
 * The row does NOT validate — it's a thin display + dispatch layer. Validation
 * lives in AmPrepForm (Part 2).
 *
 * Translation handling per C.37 + C.38: section name + column labels resolve
 * via t() (UI-scaffolding strings, not registry content). Item label resolves
 * via the parent component which has already passed it through
 * resolveTemplateItemContent (template-content translation per C.38). Special
 * instruction text is also pre-resolved by the parent.
 */

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PrepColumn } from "@/lib/types";

import { PrepNumericCell } from "./PrepNumericCell";
import type { RawPrepInputs } from "./types";

/**
 * Maps each numeric PrepColumn (system-key snake_case) to the camelCase
 * field name on RawPrepInputs (and PrepInputs) it controls.
 *
 * `par` is read-only (no input field; displayed value comes from
 * prep_meta.parValue + parUnit). Excluded from this map; the row treats
 * it specially.
 */
const COLUMN_INPUT_FIELD: Record<
  Exclude<PrepColumn, "par" | "yes_no" | "free_text">,
  Exclude<keyof RawPrepInputs, "yesNo" | "freeText">
> = {
  on_hand: "onHand",
  portioned: "portioned",
  line: "line",
  back_up: "backUp",
  total: "total",
};

const COLUMN_TRANSLATION_KEY: Record<PrepColumn, TranslationKey> = {
  par: "am_prep.column.par",
  on_hand: "am_prep.column.on_hand",
  portioned: "am_prep.column.portioned",
  line: "am_prep.column.line",
  back_up: "am_prep.column.back_up",
  total: "am_prep.column.total",
  yes_no: "am_prep.column.yes_no",
  free_text: "am_prep.column.free_text",
};

export interface PrepRowProps {
  /** Stable id (template_item_id) — used for React key + onChange dispatch. */
  templateItemId: string;
  /**
   * SECTION SYSTEM-KEY (English source-of-truth per C.38). Used in ARIA
   * labels via translation interpolation; never used as a render-string
   * directly (display name comes from `sectionDisplay`).
   */
  section: string;
  /** Display string for the section (translated via template translations). */
  sectionDisplay: string;
  /** Item label, already resolved through resolveTemplateItemContent. */
  label: string;
  /** PAR value for the read-only PAR cell. */
  parValue: number | null;
  /** Unit suffix for the PAR cell ("QT", "BTL", "BAG", null for unit-less). */
  parUnit: string | null;
  /** Optional special instruction (e.g., "Prep Daily" for Tomato). */
  specialInstruction: string | null;
  /**
   * Operator-input column descriptors for this row, in render order. The PAR
   * column always renders first (fixed); these are the editable columns.
   * Length: 1–3 depending on the section.
   *
   * For numeric sections this is some subset of:
   *   ["on_hand"], ["on_hand", "back_up", "total"], ["portioned", "back_up", "total"], etc.
   */
  inputColumns: ReadonlyArray<Exclude<PrepColumn, "par" | "yes_no" | "free_text">>;
  /**
   * Current operator-typed raw values for this row. Numeric fields are
   * strings (preserves "3.", "0.0" during typing); AmPrepForm parses to
   * PrepInputs only at submission time.
   */
  rawInputs: RawPrepInputs;
  /**
   * Per-cell change callback. Field name is the camelCase key on
   * RawPrepInputs (resolved by the row from the column descriptor); value
   * is the raw string from the input element.
   *
   * Parent owns parsing/validation; row stays dumb.
   */
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  /** Read-only display (after submit). Disables all inputs. */
  disabled?: boolean;
  /**
   * Optional per-field validation error map. AmPrepForm sets a string
   * (translated) for each field that failed parse/validate. Renders below
   * the input cell as brand-Red text. Empty/missing → no error UI.
   */
  rowErrors?: Partial<Record<keyof RawPrepInputs, string>>;
}

export function PrepRow({
  templateItemId,
  section: _section, // reserved for future use (e.g., section-aware analytics);
  // currently unused — sectionDisplay is what renders, but we keep the
  // system-key prop in the public API for downstream consumers per C.38.
  sectionDisplay,
  label,
  parValue,
  parUnit,
  specialInstruction,
  inputColumns,
  rawInputs,
  onChange,
  disabled = false,
  rowErrors,
}: PrepRowProps) {
  const { t } = useTranslation();
  // PAR cell display: "{value} {unit}" — or just the value if unit is null,
  // or the special instruction if parValue is null (e.g., "Prep Daily" for
  // Tomato has no PAR number).
  const parDisplay = (() => {
    if (parValue !== null) {
      return parUnit
        ? t("am_prep.row.par_value_with_unit", { value: parValue, unit: parUnit })
        : String(parValue);
    }
    return specialInstruction ?? "";
  })();

  return (
    <div
      // Grid: label flexes; PAR + N input cells at fixed widths.
      // 1fr label + repeat(inputCount + 1, fixed-width-cell)
      // Mobile: each cell ~52px; sm: bumps to ~64px.
      className="
        grid items-center gap-1.5 py-1.5
        border-b border-co-border last:border-b-0
      "
      style={{
        gridTemplateColumns: `minmax(0, 1fr) repeat(${inputColumns.length + 1}, minmax(48px, 56px))`,
      }}
    >
      {/* Label cell (flex column) — item name + optional special instruction below. */}
      <div className="flex flex-col gap-0.5 min-w-0 pr-1">
        <span className="text-sm font-semibold text-co-text leading-tight truncate">
          {label}
        </span>
        {specialInstruction && parValue !== null ? (
          // Special instruction renders below label only when there's also a
          // PAR number (e.g., a "Prep Daily" hint alongside an actual count).
          // When parValue is null, the instruction takes over the PAR cell
          // display instead (see parDisplay above) — don't double-render.
          <span className="text-[10px] text-co-text-dim italic truncate">
            {specialInstruction}
          </span>
        ) : null}
      </div>

      {/* PAR cell — read-only display. */}
      <div className="text-center">
        <span className="text-xs sm:text-sm font-semibold text-co-text-muted tabular-nums">
          {parDisplay}
        </span>
      </div>

      {/* Operator-input cells. */}
      {inputColumns.map((col) => {
        const field = COLUMN_INPUT_FIELD[col];
        const colLabel = t(COLUMN_TRANSLATION_KEY[col]);
        const ariaLabel = t("am_prep.row.input_aria", {
          section: sectionDisplay,
          item: label,
          column: colLabel,
        });
        // Read raw string directly — no Number() round-trip per Part 2 lock.
        const stringValue = rawInputs[field] ?? "";
        const fieldError = rowErrors?.[field];
        return (
          <div key={col} className="flex flex-col gap-0.5">
            <PrepNumericCell
              value={stringValue}
              onChange={(raw) => onChange(templateItemId, field, raw)}
              ariaLabel={ariaLabel}
              disabled={disabled}
            />
            {fieldError ? (
              <span
                role="alert"
                className="text-[10px] leading-tight text-co-cta text-center"
              >
                {fieldError}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

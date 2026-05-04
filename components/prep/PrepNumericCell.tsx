"use client";

/**
 * PrepNumericCell — Build #2 PR 1, Part 1.
 *
 * Shared numeric input primitive for AM Prep form rows. Used by every
 * prep section component (Veg, Cooks, Sides, Sauces, Slicing) for the
 * operator-supplied numeric fields (on_hand, portioned, line, back_up,
 * total).
 *
 * Pattern (locked from ChecklistItem.tsx count-input):
 *   - type="text" + inputMode="decimal" — avoids browser spinner controls,
 *     surfaces the native numeric pad on iOS/Android.
 *   - Accepts partial values ("", "3", "3.", "3.5") to support natural typing;
 *     parent (AmPrepForm in Part 2) parses + validates at submit time.
 *   - tabular-nums for column-scan affinity across rows.
 *   - `text-sm` (14px) on mobile to fit the compressed-table layout per the
 *     locked column strategy; sm: bumps to text-base (16px) when there's
 *     room.
 *
 * Brand chrome inherited from ChecklistItem expand-panel inputs:
 *   - rounded-md, border-2 border-co-border (idle) → border-co-gold + ring
 *     on focus.
 *   - White input fill against the Mayo-tinted card background — preserves
 *     contrast for typed values.
 *
 * Controlled-input shape per Part 1 lock: caller passes value (string) +
 * onChange. Part 1's parent shell passes empty values + no-op onChange;
 * Part 2's AmPrepForm wires the real state. Component itself stays dumb.
 */

import type { ChangeEvent } from "react";

export interface PrepNumericCellProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * ARIA label for the input. Built by the section component from the
   * `am_prep.row.input_aria` translation key with section + item + column
   * params resolved.
   */
  ariaLabel: string;
  disabled?: boolean;
  /**
   * Read-only variant for computed-cell semantics (e.g., auto-calculated
   * TOTAL fields in Veg/Sides/Sauces/Slicing — operator can't type into
   * them, value derives from sibling source fields). Distinct from
   * `disabled` (which means form-level not-editable, e.g., post-submit /
   * in-flight / confirmed-instance read-only mode):
   *   - readOnly: cell is computed; preserves keyboard accessibility
   *     (focusable, value selectable) but rejects typed input
   *   - disabled: cell is unavailable; not focusable, fully muted
   * When both are set, disabled wins visually (uniform muting).
   */
  readOnly?: boolean;
  /** Optional placeholder text (e.g., "0"). Empty by default. */
  placeholder?: string;
}

export function PrepNumericCell({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  readOnly = false,
  placeholder,
}: PrepNumericCellProps) {
  // TODO smoke-test: 14px (text-sm) input font on mobile is WCAG-legible per
  // calculation but untested on real phones. If smoke surfaces cramped feel,
  // revisit by either (a) bumping to text-base (16px) and accepting horizontal
  // scroll on smallest viewports, or (b) reducing PAR cell width to claw back
  // pixels for input cells. Captured during Build #2 PR 1 Part 1 surface
  // review when the compressed-table strategy was locked.
  // readOnly variant: muted bg + suppress focus border ring (cell is
  // computed, not editable). disabled wins visually when both set.
  const baseClasses =
    "w-full rounded-md border-2 border-co-border " +
    "px-1.5 py-1.5 sm:px-2 sm:py-2 text-sm sm:text-base text-center tabular-nums " +
    "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-co-surface-2";
  const editableClasses =
    "bg-white text-co-text focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40";
  const readOnlyClasses =
    "bg-co-surface-2 text-co-text-muted cursor-default focus:outline-none";

  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      // Mobile-first sizing per the locked compressed-table strategy:
      //   - w-full inside its grid cell (fills allotted column width)
      //   - text-sm (14px) baseline; sm: text-base (16px) at tablet+
      //   - text-center for digit alignment (works with tabular-nums)
      //   - tabular-nums so 9 vs 10 vs 100 don't shift column width
      className={`${baseClasses} ${readOnly ? readOnlyClasses : editableClasses}`}
    />
  );
}

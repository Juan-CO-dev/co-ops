"use client";

/**
 * OpeningCountInput — controlled numeric input for fridge temperature
 * readings. Used by OpeningChecklistItem for items with expects_count=true.
 *
 * Decimal-aware (e.g., "38.5"). Empty string → null in state. Threshold
 * (≤41°F, ≤0°F) is shown in the parent label as guidance text; this
 * component does NOT enforce the threshold (per BUILD_3_OPENING_REPORT_DESIGN.md
 * §2.3: "discrepancies don't block opening").
 *
 * Form state model: parent owns the value (number | null). Component
 * accepts the raw value + onChange callback.
 */

import { useId } from "react";

interface OpeningCountInputProps {
  value: number | null;
  onChange: (next: number | null) => void;
  placeholder?: string;
  ariaLabel: string;
  /** When true, renders with error border. Used when item is ticked but value is missing. */
  required?: boolean;
  hasError?: boolean;
  disabled?: boolean;
}

export function OpeningCountInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  required = false,
  hasError = false,
  disabled = false,
}: OpeningCountInputProps) {
  const inputId = useId();
  const stringValue = value === null ? "" : String(value);

  return (
    <input
      id={inputId}
      type="text"
      inputMode="decimal"
      value={stringValue}
      onChange={(e) => {
        // Counts/temperatures are >= 0 — strip any "-" so a negative can't
        // be typed (input-level block), then parse. Defense in depth: the
        // parse path below also rejects negatives.
        const raw = e.target.value.replace(/-/g, "").trim();
        if (raw === "") {
          onChange(null);
          return;
        }
        // Only commit finite, non-negative numeric values. A negative (or
        // NaN) is treated as invalid — leave state unchanged (matches the
        // form's "invalid → no commit" expectation).
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) {
          onChange(parsed);
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-required={required}
      aria-invalid={hasError}
      disabled={disabled}
      className={[
        "inline-flex h-11 w-24 items-center rounded-md border-2 px-3",
        "text-base font-semibold text-co-text",
        "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        hasError
          ? "border-co-danger bg-co-surface"
          : "border-co-border-2 bg-co-surface hover:border-co-text",
        disabled && "opacity-50",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

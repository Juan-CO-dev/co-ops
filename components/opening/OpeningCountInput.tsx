"use client";

/**
 * OpeningCountInput — controlled numeric input for fridge temperature
 * readings. Used by OpeningChecklistItem for items with expects_count=true.
 *
 * Decimal-aware (e.g., "38.5"). Empty string → null in state. The box keeps what was
 * TYPED as a local draft (audit W14 / B021): re-rendering String(value) dropped the point
 * of "38." and the next key made 385. Same rule as OpeningPrepEntry's NumericInput — the
 * parent's number moves only when the draft means a number (parseDecimalDraft: "38" and
 * "38." commit 38; a decimal comma reads as a point), an invalid draft commits nothing, and
 * blur tidies the draft back to the committed value. Threshold
 * (≤41°F, ≤0°F) is shown in the parent label as guidance text; this
 * component does NOT enforce the threshold (per BUILD_3_OPENING_REPORT_DESIGN.md
 * §2.3: "discrepancies don't block opening").
 *
 * Form state model: parent owns the value (number | null). Component
 * accepts the raw value + onChange callback.
 */

import { useId, useState } from "react";

import { draftOf, parseDecimalDraft } from "@/lib/prep-display-shared";

interface OpeningCountInputProps {
  value: number | null;
  onChange: (next: number | null) => void;
  placeholder?: string;
  ariaLabel: string;
  /** When true, renders with error border. Used when item is ticked but value is missing. */
  required?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  primary?: boolean;
}

export function OpeningCountInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  required = false,
  hasError = false,
  disabled = false,
  primary = false,
}: OpeningCountInputProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(() => draftOf(value));
  // Re-sync from the prop with the during-render prev-compare (never an effect): only when
  // the value changed from OUTSIDE the box, i.e. the draft no longer means it.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    const d = parseDecimalDraft(draft);
    const draftMeans = d.kind === "empty" ? null : d.kind === "invalid" ? undefined : d.value;
    if (draftMeans !== value) setDraft(draftOf(value));
  }
  const invalid = !disabled && parseDecimalDraft(draft).kind === "invalid";

  return (
    <input
      data-whats-left-field={primary ? "primary" : undefined}
      id={inputId}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        // Counts/temperatures are >= 0 — strip any "-" so a negative can't be typed
        // (input-level block). Defense in depth: parseDecimalDraft rejects signs too.
        const raw = e.target.value.replace(/-/g, "");
        setDraft(raw);
        const d = parseDecimalDraft(raw);
        if (d.kind === "empty") onChange(null);
        // "38." already means 38; "." alone means nothing yet. An invalid draft ("4o")
        // commits nothing — the parent keeps its last valid number.
        else if ((d.kind === "number" || d.kind === "partial") && d.value !== null) onChange(d.value);
      }}
      // Blur shows the committed value: "38." → "38", and a draft that never became a
      // number goes back to the last one that did (the box has no hint line of its own).
      onBlur={() => setDraft(draftOf(value))}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-required={required}
      aria-invalid={hasError || invalid}
      disabled={disabled}
      className={[
        "inline-flex h-11 w-24 items-center rounded-md border-2 px-3",
        "text-base font-semibold text-co-text",
        "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        hasError || invalid
          ? "border-co-cta-text bg-co-surface"
          : "border-co-border-2 bg-co-surface hover:border-co-text",
        disabled && "opacity-50",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

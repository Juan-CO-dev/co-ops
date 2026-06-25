"use client";

/**
 * MultiSelectChips — a simple, on-brand multi-select rendered as a wrap of
 * toggle chips (checkbox-list semantics). Used for vendor categories + order
 * types (both ≥1 required, both registry-backed). Keeps the "checklist-first"
 * admin feel: tap a chip to include/exclude. No external dropdown library.
 */

export interface ChipOption {
  id: string;
  label: string;
}

export function MultiSelectChips({
  options,
  selectedIds,
  onToggle,
  disabled,
  ariaLabel,
}: {
  options: ChipOption[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="mt-1 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selectedIds.has(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onToggle(o.id)}
            className={
              "inline-flex min-h-[40px] items-center rounded-full border-2 px-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50 " +
              (on
                ? "border-co-gold-deep bg-co-gold text-co-text"
                : "border-co-border bg-co-surface text-co-text-muted hover:border-co-text")
            }
          >
            {on ? "✓ " : ""}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

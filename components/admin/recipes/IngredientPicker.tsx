"use client";

/**
 * IngredientPicker — the searchable ingredient field (catalog redesign Phase 1, 2026-10-15).
 * An ARIA 1.2 combobox: type to filter (lib/ingredient-picker-shared.ts), ↑/↓ to move (clamped,
 * and the active row scrolls into view), Enter to choose, Escape to close back to the current
 * choice. Options are 44px rows that work by tap (mousedown keeps focus in the input so a tap
 * never blurs the list away). The list flows in the page (no absolute overlay), so it never
 * clips at phone width; rows truncate long names instead of widening the page.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  filterIngredientOptions,
  INGREDIENT_RESULT_LIMIT,
  moveActive,
  type IngredientKind,
  type IngredientOption,
} from "@/lib/ingredient-picker-shared";

const rk = (k: string): TranslationKey => k as TranslationKey;

const fieldCls =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function IngredientPicker({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: IngredientOption[];
  /** The chosen option, or null. A line whose target is no longer offered passes a synthesised option. */
  value: IngredientOption | null;
  onChange: (next: IngredientOption | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(value === null);
  const [active, setActive] = useState(0);

  const { matches, total } = useMemo(
    () => filterIngredientOptions(options, query, INGREDIENT_RESULT_LIMIT),
    [options, query],
  );

  // P3-8: the keyboard's active row is always visible inside the scrolling list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, baseId]);

  const kindLabel = (k: IngredientKind) => t(rk(`recipes.picker.kind.${k}`));
  const vendorLabel = (o: IngredientOption) => (o.kind === "sku" ? (o.vendorName ?? t(rk("recipes.picker.no_vendor"))) : null);

  const choose = (o: IngredientOption) => {
    onChange(o);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => moveActive(i, 1, matches.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => moveActive(i, -1, matches.length));
    } else if (e.key === "Enter") {
      const o = matches[active];
      if (open && o) {
        e.preventDefault();
        choose(o);
      }
    } else if (e.key === "Escape" && value) {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  if (value && !open) {
    return (
      <div className="mt-1 flex min-h-[44px] items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface pl-3">
        <span className="min-w-0 truncate text-base text-co-text">
          {[value.name, vendorLabel(value), kindLabel(value.kind)].filter(Boolean).join(" · ")}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={t(rk("recipes.picker.change_aria"), { name: value.name })}
          onClick={() => {
            setOpen(true);
            setActive(0);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="inline-flex min-h-[44px] shrink-0 items-center px-3 text-xs font-bold text-co-text underline underline-offset-2 disabled:opacity-50"
        >
          {t(rk("recipes.picker.change"))}
        </button>
      </div>
    );
  }

  const activeOption = matches[active];
  return (
    <div className="mt-1">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeOption ? optionId(active) : undefined}
        aria-label={t(rk("recipes.picker.label"))}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className={fieldCls}
        value={query}
        disabled={disabled}
        placeholder={t(rk("recipes.picker.placeholder"))}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t(rk("recipes.picker.results"))}
          className="mt-1 max-h-72 overflow-y-auto rounded-lg border-2 border-co-border bg-co-surface"
        >
          {matches.length === 0 ? (
            <li role="presentation" className="flex min-h-[44px] items-center px-3 text-sm text-co-text-muted">
              {t(rk("recipes.picker.no_matches"))}
            </li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.key}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 px-3 text-sm text-co-text ${i === active ? "bg-co-surface-2" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate font-bold">{o.name}</span>
                {vendorLabel(o) ? (
                  <span className="max-w-[40%] shrink-0 truncate text-xs text-co-text-muted">{vendorLabel(o)}</span>
                ) : null}
                <span className="shrink-0 rounded bg-co-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-co-text">
                  {kindLabel(o.kind)}
                </span>
              </li>
            ))
          )}
          {total > matches.length ? (
            <li role="presentation" className="px-3 py-2 text-xs text-co-text-muted">
              {t(rk("recipes.picker.more"), { n: total - matches.length })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

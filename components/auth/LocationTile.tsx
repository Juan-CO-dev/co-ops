"use client";

/**
 * Tile representing a location for the tile-flow login (Phase 2 Session 4).
 *
 * Mobile-first: 96×96 minimum tap target (here 120px). Mustard accent on
 * focus / hover.
 */

interface LocationTileProps {
  name: string;
  code: string;
  onSelect: () => void;
  disabled?: boolean;
}

export function LocationTile({ name, code, onSelect, disabled = false }: LocationTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={`Select location ${name}`}
      className="
        group relative flex min-h-[120px] w-full flex-col items-center justify-center
        gap-2 rounded-2xl border-2 border-co-border bg-co-surface px-4 py-6
        shadow-sm transition
        hover:border-co-gold hover:shadow-md hover:-translate-y-0.5
        active:translate-y-0 active:bg-co-surface-2 active:shadow-sm
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0
      "
    >
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {code}
      </span>
      <span className="text-xl font-bold leading-tight text-co-text">{name}</span>
    </button>
  );
}

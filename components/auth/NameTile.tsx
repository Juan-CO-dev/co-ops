"use client";

/**
 * Tile representing a user name for the tile-flow login (Phase 2 Session 4).
 *
 * Used after location + role have been picked. Tapping a name advances to
 * the PIN keypad with the user_id pre-bound for the /api/auth/pin call.
 */

interface NameTileProps {
  name: string;
  onSelect: () => void;
  disabled?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] ?? "").toUpperCase() + (parts[parts.length - 1]?.[0] ?? "").toUpperCase();
}

export function NameTile({ name, onSelect, disabled = false }: NameTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={`Select user ${name}`}
      className="
        group relative flex min-h-[120px] w-full flex-col items-center justify-center
        gap-3 rounded-2xl border-2 border-co-border bg-co-surface px-4 py-6
        shadow-sm transition
        hover:border-co-gold hover:shadow-md hover:-translate-y-0.5
        active:translate-y-0 active:bg-co-surface-2 active:shadow-sm
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0
      "
    >
      <span
        className="
          flex h-12 w-12 items-center justify-center rounded-full bg-co-gold
          text-base font-extrabold tracking-tight text-co-text
        "
        aria-hidden
      >
        {initials(name)}
      </span>
      <span className="text-base font-semibold leading-tight text-co-text">{name}</span>
    </button>
  );
}

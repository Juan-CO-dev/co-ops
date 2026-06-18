"use client";

/**
 * Tile representing a role at a location (Phase 2 Session 4).
 *
 * Color stripe is the role's brand color from the design tokens (--role-*),
 * giving floor staff a quick visual association.
 */

import { ROLES, type RoleCode } from "@/lib/roles";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

interface RoleTileProps {
  role: RoleCode;
  onSelect: () => void;
  disabled?: boolean;
}

export function RoleTile({ role, onSelect, disabled = false }: RoleTileProps) {
  const { t } = useTranslation();
  const def = ROLES[role];
  const roleLabel = t(`role.${role}` as TranslationKey);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={t("auth.tiles.select_role", { role: roleLabel })}
      className="
        group relative flex min-h-[120px] w-full flex-col items-center justify-center
        gap-2 overflow-hidden rounded-2xl border-2 border-co-border bg-co-surface
        px-4 py-6 shadow-sm transition
        hover:border-co-gold hover:shadow-md hover:-translate-y-0.5
        active:translate-y-0 active:bg-co-surface-2 active:shadow-sm
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0
      "
    >
      <span
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ background: def.color }}
        aria-hidden
      />
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {def.shortLabel}
      </span>
      <span className="text-lg font-bold leading-tight text-co-text">{roleLabel}</span>
    </button>
  );
}

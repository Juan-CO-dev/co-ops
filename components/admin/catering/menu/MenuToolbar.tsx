"use client";

/** MenuToolbar — filter chips (single select) + search + "Preview as customer" switch. Pure client state, owned by MenuClient. */

import type { TranslationKey } from "@/lib/i18n/types";
import type { MenuFilterChip, Translate } from "@/lib/admin/catering/menu-view-shared";

const CHIPS: Array<{ id: MenuFilterChip; key: TranslationKey }> = [
  { id: "all", key: "admin.catering.menu.chip_all" },
  { id: "on_menu", key: "admin.catering.menu.chip_on_menu" },
  { id: "hidden", key: "admin.catering.menu.chip_hidden" },
  { id: "toast", key: "admin.catering.menu.chip_toast" },
  { id: "catering", key: "admin.catering.menu.chip_catering" },
];

export function MenuToolbar({ chip, onChip, query, onQuery, preview, onPreview, t }: {
  chip: MenuFilterChip;
  onChip: (c: MenuFilterChip) => void;
  query: string;
  onQuery: (q: string) => void;
  preview: boolean;
  onPreview: (v: boolean) => void;
  t: Translate;
}) {
  const chipCls = (on: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold transition ${
      on ? "border-co-gold bg-co-surface-2 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div role="group" aria-label={t("admin.catering.menu.chips_aria")} className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => onChip(c.id)} className={chipCls(chip === c.id)}>
            {t(c.key)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("admin.catering.menu.search_placeholder")}
          aria-label={t("admin.catering.menu.search_aria")}
          className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text lg:w-56"
        />
        <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 text-xs font-bold text-co-text" title={t("admin.catering.menu.preview_hint")}>
          <input type="checkbox" checked={preview} onChange={(e) => onPreview(e.target.checked)} aria-label={t("admin.catering.menu.preview_toggle")} className="h-5 w-5 accent-co-gold" />
          {t("admin.catering.menu.preview_toggle")}
        </label>
      </div>
    </div>
  );
}

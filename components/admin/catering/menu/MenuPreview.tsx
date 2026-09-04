"use client";

/**
 * MenuPreview — "what does a customer see under this heading?" The SAME grouped rows as the
 * editor, read-only, showing only rows customers can order, with price ("from" for sized rows),
 * feeds, and the catering-only tag. No cart, no pricing rules — a labeling aid, not the builder.
 */

import type { Language } from "@/lib/i18n/types";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import { displayName, groupTitleKey, type MenuGroup, type Translate } from "@/lib/admin/catering/menu-view-shared";

/** One rendered preview row — an item with active sizes expands into one row per size. */
type PreviewRow = { key: string; name: string; price: string; feeds: number | null; cateringOnly: boolean };

export function MenuPreview({ groups, language, money, t }: {
  groups: MenuGroup[];
  language: Language;
  money: (c: number | null) => string;
  t: Translate;
}) {
  const visible = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.cateringAvailable) }))
    .filter((g) => g.rows.length > 0);
  if (visible.length === 0) return <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.preview_empty")}</p>;

  // Mirrors the real order builder: a registry item's ACTIVE sizes are separate purchasable
  // lines (one row each); with no active sizes it sells as a single unit at its menu price.
  // A portionable sub prices "from" its whole-unit price — sizing happens at order time there.
  const rowsFor = (it: AdminMenuItem): PreviewRow[] => {
    const activeSizes = it.kind === "item" ? it.sizes.filter((s) => s.active) : [];
    if (activeSizes.length > 0) {
      return activeSizes.map((s) => ({
        key: `${it.kind}:${it.id}:${s.id}`,
        name: `${displayName(it, language)} · ${s.label}`,
        price: money(s.priceCents),
        feeds: s.serves ?? it.serves,
        cateringOnly: it.cateringOnly,
      }));
    }
    const price = it.kind === "menu_item" && it.cateringPortionable === true
      ? t("admin.catering.menu.preview_from", { price: money(it.menuPriceCents) })
      : money(it.menuPriceCents);
    return [{ key: `${it.kind}:${it.id}`, name: displayName(it, language), price, feeds: it.serves, cateringOnly: it.cateringOnly }];
  };

  return (
    <section aria-label={t("admin.catering.menu.preview_toggle")} className="flex flex-col gap-6">
      <p className="text-xs text-co-text-muted">{t("admin.catering.menu.preview_hint")}</p>
      {visible.map((g) => {
        const key = groupTitleKey(g.label);
        return (
          <section key={g.label}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{key ? t(key) : g.label}</h2>
            <ul className="flex flex-col divide-y divide-co-border/60 overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface">
              {g.rows.flatMap(rowsFor).map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-4 p-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-extrabold text-co-text">{row.name}</span>
                      {row.cateringOnly && <span className="rounded-full bg-co-gold/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">{t("admin.catering.menu.badge_catering_only")}</span>}
                    </span>
                    {row.feeds != null && <span className="text-[11px] text-co-text-dim">{t("admin.catering.menu.preview_feeds", { n: row.feeds })}</span>}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-co-cta-text">{row.price}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

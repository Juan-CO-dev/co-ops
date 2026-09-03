"use client";

/**
 * MenuPreview — "what does a customer see under this heading?" The SAME grouped rows as the
 * editor, read-only, showing only rows customers can order, with price ("from" for sized rows),
 * feeds, and the catering-only tag. No cart, no pricing rules — a labeling aid, not the builder.
 */

import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import type { MenuGroup } from "@/lib/admin/catering/menu-view-shared";
import { groupTitle } from "./MenuSectionList";
import type { T } from "./MenuRow";

export function MenuPreview({ groups, language, money, t }: {
  groups: MenuGroup[];
  language: string;
  money: (c: number | null) => string;
  t: T;
}) {
  const visible = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.cateringAvailable) }))
    .filter((g) => g.rows.length > 0);
  if (visible.length === 0) return <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.preview_empty")}</p>;

  const priceOf = (it: AdminMenuItem) => {
    if (it.kind === "item" && it.sizes.length > 0) {
      const min = Math.min(...it.sizes.map((s) => s.priceCents));
      return t("admin.catering.menu.preview_from", { price: money(min) });
    }
    return money(it.menuPriceCents);
  };

  return (
    <div className="flex flex-col gap-6" aria-label={t("admin.catering.menu.preview_toggle")}>
      <p className="text-xs text-co-text-muted">{t("admin.catering.menu.preview_hint")}</p>
      {visible.map((g) => (
        <section key={g.label}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{groupTitle(g.label, t)}</h2>
          <ul className="flex flex-col divide-y divide-co-border/60 overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface">
            {g.rows.map((it) => (
              <li key={`${it.kind}:${it.id}`} className="flex items-center justify-between gap-4 p-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-extrabold text-co-text">{language === "es" ? it.nameEs ?? it.name : it.name}</span>
                    {it.cateringOnly && <span className="rounded-full bg-co-gold/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">{t("admin.catering.menu.badge_catering_only")}</span>}
                  </span>
                  {it.serves != null && <span className="text-[11px] text-co-text-dim">{t("admin.catering.menu.preview_feeds", { n: it.serves })}</span>}
                </span>
                <span className="shrink-0 text-sm font-bold text-co-cta-text">{priceOf(it)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

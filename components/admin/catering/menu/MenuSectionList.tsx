"use client";

/**
 * MenuSectionList — the Packages card first (customers see packages first), then one
 * CollapsibleSection per group in CUSTOMER order (grouping computed by the caller via
 * groupAdminRows). Header = translated group label + "N on the menu of M" (D5) + the raw Toast
 * sections that fed the group. Sections with ≤ 6 rows default open (existing rule).
 */

import type { ReactNode } from "react";

import type { TranslationKey } from "@/lib/i18n/types";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import { sectionSummary, type MenuGroup } from "@/lib/admin/catering/menu-view-shared";
import type { T } from "./MenuRow";

/** Merged labels are code-owned words → translated; Toast headings are tenant data → verbatim. */
export function groupTitle(label: string, t: T): string {
  const key: Record<string, TranslationKey> = {
    Drinks: "admin.catering.menu.section_drinks",
    Sides: "admin.catering.menu.section_sides",
    Desserts: "admin.catering.menu.section_desserts",
    More: "admin.catering.menu.section_more",
  };
  const k = key[label];
  return k ? t(k) : label;
}

export function MenuSectionList({ groups, packageCount, t, renderRow }: {
  groups: MenuGroup[];
  packageCount: number;
  t: T;
  renderRow: (item: AdminMenuItem) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="co-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-co-text">{t("admin.catering.menu.packages_title")}</span>
          <span className="block text-xs text-co-text-muted">{t("admin.catering.menu.packages_body")}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-co-text-muted">{t("admin.catering.menu.packages_count", { n: packageCount })}</span>
          <a href="/admin/catering/packages" className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold text-co-text transition hover:text-co-cta-text">
            {t("admin.catering.menu.packages_link")}
          </a>
        </span>
      </div>

      {groups.length === 0 && <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.no_results")}</p>}

      {groups.map((g) => {
        const s = sectionSummary(g.rows);
        const id = `menu-section-${g.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        return (
          <CollapsibleSection
            key={g.label}
            idBase={id}
            title={groupTitle(g.label, t)}
            count={t("admin.catering.menu.section_summary", { on: s.on, total: s.total })}
            defaultOpen={g.rows.length <= 6}
            badge={
              g.rawSections.length > 0 && (g.rawSections.length > 1 || g.rawSections[0] !== g.label) ? (
                <span className="text-[11px] text-co-text-dim">{t("admin.catering.menu.source_line", { section: g.rawSections.join(" · ") })}</span>
              ) : null
            }
          >
            <ul className="flex flex-col gap-1.5">{g.rows.map((it) => renderRow(it))}</ul>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

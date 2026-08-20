"use client";

/**
 * ItemsClient — /admin/items shell: the central item registry (Items Central
 * Page, 2026-07-07). Pipeline position: SKUs → recipes → ITEMS → checklists.
 * Items grouped by section; each row = ItemRow (readiness badge + producing-
 * recipe link + MoO+ editor). Add-item = GM+. Prep-list concerns (sections
 * editing, per-location enable/pars) live in the checklist-templates admin.
 */

import { useTranslation } from "@/lib/i18n/provider";
import { orderedSectionSlugs, sectionLabelByLang } from "@/lib/prep-sections";
import { EmptyState } from "@/components/EmptyState";
import type { ChecklistRegistryItem } from "@/lib/admin/templates";
import type { ItemsAdminView } from "@/lib/admin/items";
import type { Readiness } from "@/lib/readiness";
import { ItemRow } from "./ItemRow";
import { AddItemForm } from "./AddItemForm";

export function ItemsClient({
  view,
  itemReadiness,
}: {
  view: ItemsAdminView;
  itemReadiness: Record<string, Readiness>;
}) {
  const { t, language } = useTranslation();
  const canAdd = view.actorLevel >= 7;

  // Group by section, standard sections first; null section → "—" bucket.
  const groups = new Map<string, ChecklistRegistryItem[]>();
  for (const r of view.registry) {
    const key = r.section ?? "—";
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const sectionKeys: string[] = orderedSectionSlugs(view.sections);
  for (const k of groups.keys()) if (!sectionKeys.includes(k)) sectionKeys.push(k);

  return (
    <div className="mt-4 flex flex-col gap-6">
      <p className="rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2 text-xs font-bold text-co-text">
        {t("admin.templates.global_blast_radius_note")}
      </p>

      {canAdd ? (
        <AddItemForm sections={view.sections} units={view.units} actorLevel={view.actorLevel} />
      ) : null}

      {/* view.registry is empty (no items yet) — previously rendered nothing at all,
          since every section's items.length===0 branch returns null (council C2
          adoption sweep). */}
      {view.registry.length === 0 ? <EmptyState message={t("admin.items.empty")} /> : null}

      {sectionKeys.map((section) => {
        const items = groups.get(section) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={section}>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">
              {t("admin.templates.section_label")}: {sectionLabelByLang(view.sections, section, language)}
            </h2>
            <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {items.map((r) => (
                <ItemRow
                  key={r.itemId}
                  item={r}
                  actorLevel={view.actorLevel}
                  sections={view.sections}
                  units={view.units}
                  language={language}
                  itemQuestions={view.itemQuestions.filter((q) => q.itemId === r.itemId)}
                  readiness={itemReadiness[r.itemId] ?? null}
                  producingRecipeId={view.producingRecipeByItem[r.itemId] ?? null}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

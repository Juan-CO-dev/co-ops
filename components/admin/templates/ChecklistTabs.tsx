"use client";

/**
 * ChecklistTabs (Items Central Page, 2026-07-07) — the tab IA for the prep-
 * checklist admin. Tab bar: Sections | <each location.code · name>. Item
 * definitions moved to /admin/items; the first tab is now prep-report STRUCTURE
 * (sections + section questions).
 *
 * Default tab = Sections when actorLevel ≥ 8 (sections editing is MoO+), else
 * the first accessible location (AGM+ live in the per-location world).
 *
 * Renders <SectionsTab> or the selected <LocationChecklistTab>.
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { ChecklistAdminView } from "@/lib/admin/templates";
import { SectionsTab } from "./SectionsTab";
import { LocationChecklistTab } from "./LocationChecklistTab";

type TabId = "sections" | string; // "sections" or a locationId

export function ChecklistTabs({
  view,
}: {
  view: ChecklistAdminView;
}) {
  const { t } = useTranslation();

  const defaultTab: TabId =
    view.actorLevel >= 8 ? "sections" : (view.locations[0]?.locationId ?? "sections");
  const [active, setActive] = useState<TabId>(defaultTab);

  const chip = (selected: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-lg border-2 px-3 text-sm font-bold transition ${
      selected
        ? "border-co-gold-deep bg-co-gold text-co-text"
        : "border-co-border bg-co-surface text-co-text hover:border-co-text"
    }`;

  const selectedLocation =
    active === "sections" ? null : view.locations.find((l) => l.locationId === active) ?? null;

  return (
    <div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t("admin.templates.tabs_label")}>
        <button
          type="button"
          role="tab"
          aria-selected={active === "sections"}
          onClick={() => setActive("sections")}
          className={chip(active === "sections")}
        >
          {t("admin.templates.tab_sections")}
        </button>
        {view.locations.map((loc) => (
          <button
            key={loc.locationId}
            type="button"
            role="tab"
            aria-selected={active === loc.locationId}
            onClick={() => setActive(loc.locationId)}
            className={chip(active === loc.locationId)}
          >
            {loc.code} · {loc.name}
          </button>
        ))}
      </div>

      {active === "sections" ? (
        <SectionsTab
          sections={view.sections}
          sectionQuestions={view.sectionQuestions}
          actorLevel={view.actorLevel}
          registryNamesBySection={view.registryNamesBySection}
        />
      ) : selectedLocation ? (
        <LocationChecklistTab
          key={selectedLocation.locationId}
          view={selectedLocation}
          subtype={view.subtype}
          registry={view.registry}
          sections={view.sections}
          units={view.units}
        />
      ) : null}
    </div>
  );
}

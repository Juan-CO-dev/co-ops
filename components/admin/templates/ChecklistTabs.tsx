"use client";

/**
 * ChecklistTabs (Item/Inventory Spine 2B′) — the 3-tab (checklist-first) IA for
 * the prep-checklist admin. Tab bar: Global | <each location.code · name>.
 * Default tab = Global when actorLevel ≥ 7 (GM+ can author the registry), else
 * the first accessible location (AGM+ live in the per-location world).
 *
 * Renders <GlobalRegistryTab> or the selected <LocationChecklistTab>. Chip
 * styling mirrors the location chips in the prior list page.
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { ChecklistAdminView } from "@/lib/admin/templates";
import { GlobalRegistryTab } from "./GlobalRegistryTab";
import { LocationChecklistTab } from "./LocationChecklistTab";

type TabId = "global" | string; // "global" or a locationId

export function ChecklistTabs({ view }: { view: ChecklistAdminView }) {
  const { t } = useTranslation();

  const defaultTab: TabId =
    view.actorLevel >= 7 ? "global" : (view.locations[0]?.locationId ?? "global");
  const [active, setActive] = useState<TabId>(defaultTab);

  const chip = (selected: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-lg border-2 px-3 text-sm font-bold transition ${
      selected
        ? "border-co-gold-deep bg-co-gold text-co-text"
        : "border-co-border bg-co-surface text-co-text hover:border-co-text"
    }`;

  const selectedLocation =
    active === "global" ? null : view.locations.find((l) => l.locationId === active) ?? null;

  return (
    <div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t("admin.templates.tabs_label")}>
        <button
          type="button"
          role="tab"
          aria-selected={active === "global"}
          onClick={() => setActive("global")}
          className={chip(active === "global")}
        >
          {t("admin.templates.tab_global")}
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

      {active === "global" ? (
        <GlobalRegistryTab registry={view.registry} sections={view.sections} actorLevel={view.actorLevel} />
      ) : selectedLocation ? (
        <LocationChecklistTab
          key={selectedLocation.locationId}
          view={selectedLocation}
          subtype={view.subtype}
          registry={view.registry}
        />
      ) : null}
    </div>
  );
}

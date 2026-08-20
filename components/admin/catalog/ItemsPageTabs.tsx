"use client";

/**
 * ItemsPageTabs — the /admin/items top-level view switcher. Default view =
 * Catalog (the master list); second view = the classic prep registry (existing
 * ItemsClient, untouched). Both are passed as ReactNode slots so this wrapper
 * owns only the tab state (zero regression to either surface).
 */
import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";

type View = "catalog" | "registry";

export function ItemsPageTabs({ catalog, registry }: { catalog: React.ReactNode; registry: React.ReactNode }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("catalog");

  const tab = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition ${
      active ? "border-co-gold-deep bg-co-gold/25 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;

  return (
    <div>
      <div className="mt-4 flex gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={view === "catalog"} className={tab(view === "catalog")} onClick={() => setView("catalog")}>
          {t("admin.catalog.view.catalog")}
        </button>
        <button type="button" role="tab" aria-selected={view === "registry"} className={tab(view === "registry")} onClick={() => setView("registry")}>
          {t("admin.catalog.view.registry")}
        </button>
      </div>
      <div className="mt-1">{view === "catalog" ? catalog : registry}</div>
    </div>
  );
}

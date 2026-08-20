"use client";

/**
 * MenuTabs — two-tab shell for /admin/catering/menu: the existing catering-flag
 * manager (Menu) and the Toast crosswalk (Toast, read-track 1). MenuClient is
 * untouched; this wrapper only switches which panel renders.
 */
import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { MenuClient } from "./MenuClient";
import { ToastTab } from "./ToastTab";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import type { ToastMapState } from "@/lib/admin/toast-map";
import type { EzcaterAdminState } from "@/lib/admin/ezcater-map";

export function MenuTabs({ items, toastState, ezcaterState, canWrite }: {
  items: AdminMenuItem[];
  toastState: ToastMapState;
  ezcaterState: EzcaterAdminState;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"menu" | "toast">("menu");
  const tabCls = (on: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition ${
      on ? "border-co-gold bg-co-gold/20 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;
  return (
    <div className="mt-4">
      <div role="tablist" aria-label={t("admin.toast.tabs_aria")} className="flex gap-2">
        <button type="button" role="tab" aria-selected={tab === "menu"} onClick={() => setTab("menu")} className={tabCls(tab === "menu")}>
          {t("admin.toast.tab_menu")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "toast"} onClick={() => setTab("toast")} className={tabCls(tab === "toast")}>
          {t("admin.toast.tab_toast")}
        </button>
      </div>
      {tab === "menu" ? <MenuClient items={items} canWrite={canWrite} /> : <ToastTab state={toastState} ezcater={ezcaterState} canWrite={canWrite} />}
    </div>
  );
}

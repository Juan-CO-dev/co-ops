/**
 * /admin/catering/menu — GM+ catering-menu flag editor (identity arc PR-2).
 *
 * Server component: re-gate >=7 (mirrors the hub card minLevel + the route/lib floor),
 * load the item registry with its catering flags, hand to the client (toggle-per-item,
 * Tier-A step-up gated). The admin shell (auth + level>=6 + providers) lives in the layout.
 */

import { redirect } from "next/navigation";

import type { TranslationKey } from "@/lib/i18n/types";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadAdminCateringMenu, MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";
import { loadToastMapState } from "@/lib/admin/toast-map";
import { loadEzcaterAdminState } from "@/lib/admin/ezcater-map";
import { MenuTabs } from "@/components/admin/catering/menu/MenuTabs";

export default async function AdminCateringMenuPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < MENU_ADMIN_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [items, toastState, ezcaterState] = await Promise.all([loadAdminCateringMenu(auth), loadToastMapState(auth), loadEzcaterAdminState(auth)]);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.catering.menu.title" as TranslationKey)}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.catering.menu.subtitle" as TranslationKey)}</p>
      <MenuTabs items={items} toastState={toastState} ezcaterState={ezcaterState} canWrite={level >= MENU_ADMIN_MIN} />
    </div>
  );
}

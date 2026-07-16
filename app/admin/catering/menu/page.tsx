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
import { loadAdminMenuItems, MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";
import { MenuClient } from "@/components/admin/catering/menu/MenuClient";

export default async function AdminCateringMenuPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < MENU_ADMIN_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const items = await loadAdminMenuItems(auth);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.catering.menu.title" as TranslationKey)}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.catering.menu.subtitle" as TranslationKey)}</p>
      <MenuClient items={items} canWrite={level >= MENU_ADMIN_MIN} />
    </div>
  );
}

/**
 * /admin/catering — the Catering KB sub-hub (Wave 1 slice 1A).
 *
 * Cards link to each KB editor; a card shows only if the viewer's level meets
 * that editor's floor (three-layer agreement: this UI gate matches the route +
 * lib floors). The admin shell (auth boundary, level>=6, providers) lives in
 * app/admin/layout.tsx; this page re-gates >=6 defensively per the C.39 pattern.
 */

import { redirect } from "next/navigation";
import Link from "next/link";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";

const EDITORS: { id: string; i18nKey: TranslationKey; href: string; minLevel: number }[] = [
  { id: "packages",    i18nKey: "admin.catering.hub.packages",    href: "/admin/catering/packages",    minLevel: 6 },
  { id: "menu",        i18nKey: "admin.catering.hub.menu",        href: "/admin/catering/menu",        minLevel: 7 },
  { id: "pricing",     i18nKey: "admin.catering.hub.pricing",     href: "/admin/catering/pricing",     minLevel: 8 },
  { id: "capacity",    i18nKey: "admin.catering.hub.capacity",    href: "/admin/catering/capacity",    minLevel: 7 },
  { id: "zones",       i18nKey: "admin.catering.hub.zones",       href: "/admin/catering/zones",       minLevel: 7 },
  { id: "faq",         i18nKey: "admin.catering.hub.faq",         href: "/admin/catering/faq",         minLevel: 6 },
  { id: "prep-demand",  i18nKey: "admin.catering.prep_demand.card" as TranslationKey, href: "/admin/catering/prep-demand",  minLevel: 6 },
  { id: "fulfillment", i18nKey: "admin.catering.hub.fulfillment" as TranslationKey,   href: "/admin/catering/fulfillment", minLevel: 7 },
];

export default async function AdminCateringHubPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const visible = EDITORS.filter((e) => level >= e.minLevel);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.catering.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.catering.subtitle")}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((e) => (
          <Link key={e.id} href={e.href} className="co-card co-card-interactive block p-4 text-co-text">
            <span className="font-semibold">{serverT(lang, e.i18nKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

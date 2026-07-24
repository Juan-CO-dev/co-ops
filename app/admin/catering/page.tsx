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
import { loadPackageLocations } from "@/lib/admin/catering/packages";
import { loadPerishableSurplus, SURPLUS_READ_MIN } from "@/lib/catering/surplus";

const EDITORS: { id: string; i18nKey: TranslationKey; href: string; minLevel: number }[] = [
  { id: "packages",    i18nKey: "admin.catering.hub.packages",    href: "/admin/catering/packages",    minLevel: 6 },
  { id: "menu",        i18nKey: "admin.catering.hub.menu",        href: "/admin/catering/menu",        minLevel: 7 },
  { id: "pricing",     i18nKey: "admin.catering.hub.pricing",     href: "/admin/catering/pricing",     minLevel: 8 },
  { id: "rate-rules",  i18nKey: "admin.catering.hub.rate_rules" as TranslationKey, href: "/admin/catering/rate-rules", minLevel: 8 },
  { id: "capacity",    i18nKey: "admin.catering.hub.capacity",    href: "/admin/catering/capacity",    minLevel: 7 },
  { id: "zones",       i18nKey: "admin.catering.hub.zones",       href: "/admin/catering/zones",       minLevel: 7 },
  { id: "faq",         i18nKey: "admin.catering.hub.faq",         href: "/admin/catering/faq",         minLevel: 6 },
  { id: "prep-demand",  i18nKey: "admin.catering.prep_demand.card" as TranslationKey, href: "/admin/catering/prep-demand",  minLevel: 6 },
  { id: "lto",         i18nKey: "admin.catering.hub.lto" as TranslationKey,           href: "/admin/catering/lto",         minLevel: 6 },
  { id: "fulfillment", i18nKey: "admin.catering.hub.fulfillment" as TranslationKey,   href: "/admin/catering/fulfillment", minLevel: 7 },
];

export default async function AdminCateringHubPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const visible = EDITORS.filter((e) => level >= e.minLevel);

  // Perishable surplus count for the prep-demand card badge (catering_mgr+ only).
  let surplusCount = 0;
  if (level >= SURPLUS_READ_MIN) {
    try {
      const from = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const dt = new Date(Date.UTC(
        Number(from.split("-")[0]),
        Number(from.split("-")[1]) - 1,
        Number(from.split("-")[2]) + 14,
      ));
      const to = dt.toISOString().slice(0, 10);
      const locations = await loadPackageLocations(auth);
      const results = await Promise.all(
        locations.map((loc) => loadPerishableSurplus(auth, { locationId: loc.id, from, to })),
      );
      surplusCount = results.reduce((acc, lines) => acc + lines.length, 0);
    } catch {
      // Non-fatal: badge silently absent on error.
    }
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.catering.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.catering.subtitle")}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((e) => (
          <Link key={e.id} href={e.href} className="co-card co-card-interactive flex items-center justify-between gap-2 p-4 text-co-text">
            <span className="font-semibold">{serverT(lang, e.i18nKey)}</span>
            {e.id === "prep-demand" && surplusCount > 0 && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">
                {serverT(lang, "admin.catering.hub.surplus_count" as TranslationKey, { n: surplusCount })}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

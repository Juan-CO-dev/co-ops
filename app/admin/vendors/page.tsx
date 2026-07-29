/**
 * /admin/vendors (Vendor Directory v2, Slice A) — list + Add (GM+).
 *
 * Server component: gate ≥6 (mirrors app/admin/users/page.tsx), load vendors +
 * categories server-side via the lib loaders, hand to the client surface. The
 * admin shell (auth boundary, role floor ≥6, providers) lives in
 * app/admin/layout.tsx; this page re-gates ≥6 defensively per the C.39 pattern.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadVendors, loadCategories, loadOrderTypes, loadVendorOrderingWeek } from "@/lib/admin/vendors";
import { operationalDayOfWeek } from "@/lib/items";
import { VendorListClient } from "@/components/admin/vendors/VendorListClient";
import { OrderingCalendar } from "@/components/admin/vendors/OrderingCalendar";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminVendorsPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const level = ROLES[auth.user.role].level;

  const [vendors, categories, orderTypes, orderingWeek] = await Promise.all([
    loadVendors(auth),
    loadCategories(auth),
    loadOrderTypes(auth),
    loadVendorOrderingWeek(auth),
  ]);
  // Today's operational weekday (0=Sun..6=Sat) for the calendar highlight, in
  // the operational TZ (America/New_York — both CO locations are in DC).
  const todayNy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const todayWeekday = operationalDayOfWeek(todayNy);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.vendors.title")}
        subtitle={serverT(lang, "admin.vendors.subtitle")}
      />
      <div className="mt-4">
        <OrderingCalendar entries={orderingWeek} todayWeekday={todayWeekday} language={lang} />
      </div>
      <VendorListClient vendors={vendors} categories={categories} orderTypes={orderTypes} actorLevel={level} />
    </div>
  );
}

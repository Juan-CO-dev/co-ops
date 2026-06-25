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
import { loadVendors, loadCategories, loadOrderTypes } from "@/lib/admin/vendors";
import { VendorListClient } from "@/components/admin/vendors/VendorListClient";

export default async function AdminVendorsPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const level = ROLES[auth.user.role].level;

  const [vendors, categories, orderTypes] = await Promise.all([
    loadVendors(auth),
    loadCategories(auth),
    loadOrderTypes(auth),
  ]);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.vendors.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.vendors.subtitle")}</p>
      <VendorListClient vendors={vendors} categories={categories} orderTypes={orderTypes} actorLevel={level} />
    </div>
  );
}

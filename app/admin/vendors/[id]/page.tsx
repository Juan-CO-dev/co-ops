/**
 * /admin/vendors/[id] (Vendor Directory v2, Slice A) — vendor detail editor.
 *
 * Server gate ≥6 (mirrors the list page); notFound() if the vendor is missing.
 * Loads the vendor + categories server-side and hands them to the client editor,
 * which renders core/notes/contacts/ordering cards gated per the actor's level
 * (MoO+ core+active, GM+ notes+edit/remove contacts&ordering, AGM+ append).
 */

import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getVendor, loadCategories, loadOrderTypes } from "@/lib/admin/vendors";
import { loadSkus, loadPackFormats, loadMeasureUnits } from "@/lib/admin/skus";
import { VendorDetailClient } from "@/components/admin/vendors/VendorDetailClient";

export default async function AdminVendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const level = ROLES[auth.user.role].level;

  const sb = getServiceRoleClient();
  const [vendor, categories, orderTypes, skus, packFormats, measureUnits, locRes] =
    await Promise.all([
      getVendor(auth, id),
      loadCategories(auth),
      loadOrderTypes(auth),
      loadSkus(auth, { vendorId: id }),
      loadPackFormats(auth),
      loadMeasureUnits(auth),
      sb.from("locations").select("id, name").eq("active", true).order("name"),
    ]);
  if (!vendor) notFound();
  const skuLocations = (locRes.data ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
  }));

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{vendor.name}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.vendors.detail.subtitle")}</p>
      <VendorDetailClient
        vendor={vendor}
        categories={categories}
        orderTypes={orderTypes}
        skus={skus}
        skuLocations={skuLocations}
        skuPackFormats={packFormats}
        skuMeasureUnits={measureUnits}
        actorLevel={level}
      />
    </div>
  );
}

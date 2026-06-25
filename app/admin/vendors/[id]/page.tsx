import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getVendor, VENDOR_READ_MIN_LEVEL, VENDOR_FULL_MIN_LEVEL } from "@/lib/admin/vendors";
import { VendorEditForm } from "@/components/admin/vendors/VendorEditForm";

export default async function AdminVendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireSessionFromHeaders(`/admin/vendors/${id}`);
  const level = ROLES[auth.user.role].level;
  if (level < VENDOR_READ_MIN_LEVEL) redirect("/dashboard");
  const lang = auth.user.language;

  const vendor = await getVendor(auth, id);
  if (!vendor) notFound();

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{vendor.name}</h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {vendor.active ? serverT(lang, "admin.vendors.badge.active") : serverT(lang, "admin.vendors.badge.inactive")}
      </p>
      <VendorEditForm vendor={vendor} canManageFull={level >= VENDOR_FULL_MIN_LEVEL} />
    </div>
  );
}

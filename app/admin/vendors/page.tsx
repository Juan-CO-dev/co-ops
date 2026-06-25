import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadVendors, VENDOR_READ_MIN_LEVEL, VENDOR_FULL_MIN_LEVEL } from "@/lib/admin/vendors";
import { VendorAdminClient } from "@/components/admin/vendors/VendorAdminClient";

export default async function AdminVendorsPage() {
  const auth = await requireSessionFromHeaders("/admin/vendors");
  const level = ROLES[auth.user.role].level;
  if (level < VENDOR_READ_MIN_LEVEL) redirect("/dashboard");
  const lang = auth.user.language;

  const vendors = await loadVendors(auth);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.vendors.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.vendors.subtitle")}</p>
      <VendorAdminClient
        vendors={vendors}
        canManageFull={level >= VENDOR_FULL_MIN_LEVEL}
        actorLevel={level}
      />
    </div>
  );
}

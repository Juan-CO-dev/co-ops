import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { canManageInboundAliases } from "@/lib/admin/inbound-settings-shared";
import { loadInboundAliases, loadInboundShops } from "@/lib/admin/inbound-settings";
import { InboundAliasesPanel } from "@/components/admin/InboundSettings";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminLocationsPage() {
  const auth = await requireSessionFromHeaders("/admin/locations");
  if (!canManageInboundAliases(auth.user.role)) redirect("/dashboard");
  const [shops, aliases] = await Promise.all([loadInboundShops(auth), loadInboundAliases(auth)]);
  return <div>
    <PageHeader title={serverT(auth.user.language, "admin.inbound.locations_title")} subtitle={serverT(auth.user.language, "admin.inbound.locations_note")} />
    <InboundAliasesPanel shops={shops} aliases={aliases} />
  </div>;
}

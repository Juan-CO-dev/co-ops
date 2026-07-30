import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AdminAuditPage() {
  const auth = await requireSessionFromHeaders("/admin/audit");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      showBackLink={false}
      title={serverT(lang, "admin.audit.ph.title")}
      description={serverT(lang, "admin.audit.ph.description")}
      features={[
        serverT(lang, "admin.audit.ph.feature.filter"),
        serverT(lang, "admin.audit.ph.feature.highlight"),
        serverT(lang, "admin.audit.ph.feature.diff"),
        serverT(lang, "admin.audit.ph.feature.immutable"),
      ]}
      shippingIn={serverT(lang, "admin.audit.ph.shipping")}
    />
  );
}

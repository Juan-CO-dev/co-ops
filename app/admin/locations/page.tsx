import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AdminLocationsPage() {
  const auth = await requireSessionFromHeaders("/admin/locations");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      showBackLink={false}
      title={serverT(lang, "admin.locations.ph.title")}
      description={serverT(lang, "admin.locations.ph.description")}
      features={[
        serverT(lang, "admin.locations.ph.feature.crud"),
        serverT(lang, "admin.locations.ph.feature.type"),
        serverT(lang, "admin.locations.ph.feature.autoassign"),
        serverT(lang, "admin.locations.ph.feature.stepup"),
      ]}
      shippingIn={serverT(lang, "admin.locations.ph.shipping")}
    />
  );
}

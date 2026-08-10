import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function RollupsPage() {
  const auth = await requireSessionFromHeaders("/rollups");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "rollups.ph.title")}
      description={serverT(lang, "rollups.ph.description")}
      features={[
        serverT(lang, "rollups.ph.feature.totals"),
        serverT(lang, "rollups.ph.feature.completeness"),
        serverT(lang, "rollups.ph.feature.cache"),
        serverT(lang, "rollups.ph.feature.forecast"),
      ]}
      shippingIn={serverT(lang, "rollups.ph.shipping")}
    />
  );
}

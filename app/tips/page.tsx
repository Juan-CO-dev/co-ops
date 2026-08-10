import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function TipPoolPage() {
  const auth = await requireSessionFromHeaders("/tips");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "tips.ph.title")}
      description={serverT(lang, "tips.ph.description")}
      features={[
        serverT(lang, "tips.ph.feature.hours"),
        serverT(lang, "tips.ph.feature.rate"),
        serverT(lang, "tips.ph.feature.distribution"),
        serverT(lang, "tips.ph.feature.status"),
      ]}
      shippingIn={serverT(lang, "tips.ph.shipping")}
    />
  );
}

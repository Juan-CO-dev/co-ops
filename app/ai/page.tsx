import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AIInsightsPage() {
  const auth = await requireSessionFromHeaders("/ai");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "ai.ph.title")}
      description={serverT(lang, "ai.ph.description")}
      features={[
        serverT(lang, "ai.ph.feature.synthesis"),
        serverT(lang, "ai.ph.feature.alerts"),
        serverT(lang, "ai.ph.feature.correlation"),
        serverT(lang, "ai.ph.feature.compare"),
        serverT(lang, "ai.ph.feature.forecast"),
      ]}
      shippingIn={serverT(lang, "ai.ph.shipping")}
    />
  );
}

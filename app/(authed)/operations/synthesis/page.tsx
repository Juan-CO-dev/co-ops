import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function SynthesisPage() {
  const auth = await requireSessionFromHeaders("/operations/synthesis");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "synthesis.ph.title")}
      description={serverT(lang, "synthesis.ph.description")}
      features={[
        serverT(lang, "synthesis.ph.feature.rollup"),
        serverT(lang, "synthesis.ph.feature.overlay"),
        serverT(lang, "synthesis.ph.feature.reports"),
        serverT(lang, "synthesis.ph.feature.handoff"),
        serverT(lang, "synthesis.ph.feature.drill"),
      ]}
      shippingIn={serverT(lang, "synthesis.ph.shipping")}
    />
  );
}

import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function TrainingPage() {
  const auth = await requireSessionFromHeaders("/training");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "training.ph.title")}
      description={serverT(lang, "training.ph.description")}
      features={[
        serverT(lang, "training.ph.feature.positions"),
        serverT(lang, "training.ph.feature.status"),
        serverT(lang, "training.ph.feature.signoff"),
        serverT(lang, "training.ph.feature.reports"),
      ]}
      shippingIn={serverT(lang, "training.ph.shipping")}
    />
  );
}

import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function DeepCleaningPage() {
  const auth = await requireSessionFromHeaders("/deep-cleaning");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "deep_cleaning.ph.title")}
      description={serverT(lang, "deep_cleaning.ph.description")}
      features={[
        serverT(lang, "deep_cleaning.ph.feature.frequency"),
        serverT(lang, "deep_cleaning.ph.feature.autoschedule"),
        serverT(lang, "deep_cleaning.ph.feature.verification_photo"),
        serverT(lang, "deep_cleaning.ph.feature.overdue"),
      ]}
      shippingIn={serverT(lang, "deep_cleaning.ph.shipping")}
    />
  );
}

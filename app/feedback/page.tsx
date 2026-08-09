import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function FeedbackPage() {
  const auth = await requireSessionFromHeaders("/feedback");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "feedback.ph.title")}
      description={serverT(lang, "feedback.ph.description")}
      features={[
        serverT(lang, "feedback.ph.feature.rating"),
        serverT(lang, "feedback.ph.feature.followup"),
        serverT(lang, "feedback.ph.feature.response_loop"),
        serverT(lang, "feedback.ph.feature.handoff"),
      ]}
      shippingIn={serverT(lang, "feedback.ph.shipping")}
    />
  );
}

import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AnnouncementsPage() {
  const auth = await requireSessionFromHeaders("/announcements");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "announcements.ph.title")}
      description={serverT(lang, "announcements.ph.description")}
      features={[
        serverT(lang, "announcements.ph.feature.priority"),
        serverT(lang, "announcements.ph.feature.ack"),
        serverT(lang, "announcements.ph.feature.targeting"),
        serverT(lang, "announcements.ph.feature.scope"),
        serverT(lang, "announcements.ph.feature.banner"),
      ]}
      shippingIn={serverT(lang, "announcements.ph.shipping")}
    />
  );
}

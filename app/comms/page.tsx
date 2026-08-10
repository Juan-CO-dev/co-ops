import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function InternalCommsPage() {
  const auth = await requireSessionFromHeaders("/comms");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "comms.ph.title")}
      description={serverT(lang, "comms.ph.description")}
      features={[
        serverT(lang, "comms.ph.feature.threads"),
        serverT(lang, "comms.ph.feature.mentions"),
        serverT(lang, "comms.ph.feature.receipts"),
        serverT(lang, "comms.ph.feature.photos"),
      ]}
      shippingIn={serverT(lang, "comms.ph.shipping")}
    />
  );
}

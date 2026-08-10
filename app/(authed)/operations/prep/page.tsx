import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function PrepSheetPage() {
  const auth = await requireSessionFromHeaders("/operations/prep");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "prep.ph.title")}
      description={serverT(lang, "prep.ph.description")}
      features={[
        serverT(lang, "prep.ph.feature.pars"),
        serverT(lang, "prep.ph.feature.onhand"),
        serverT(lang, "prep.ph.feature.formula"),
        serverT(lang, "prep.ph.feature.no_forecast"),
        serverT(lang, "prep.ph.feature.locks"),
      ]}
      shippingIn={serverT(lang, "prep.ph.shipping")}
    />
  );
}

import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AdminParsPage() {
  const auth = await requireSessionFromHeaders("/admin/pars");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      showBackLink={false}
      title={serverT(lang, "admin.pars.ph.title")}
      description={serverT(lang, "admin.pars.ph.description")}
      features={[
        serverT(lang, "admin.pars.ph.feature.location"),
        serverT(lang, "admin.pars.ph.feature.grouped"),
        serverT(lang, "admin.pars.ph.feature.overrides"),
        serverT(lang, "admin.pars.ph.feature.inline"),
      ]}
      shippingIn={serverT(lang, "admin.pars.ph.shipping")}
    />
  );
}

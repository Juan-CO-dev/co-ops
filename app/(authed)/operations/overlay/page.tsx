import { PlaceholderCard } from "@/components/PlaceholderCard";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function ShiftOverlayPage() {
  const auth = await requireSessionFromHeaders("/operations/overlay");
  const lang = auth.user.language;
  return (
    <PlaceholderCard
      title={serverT(lang, "overlay.ph.title")}
      description={serverT(lang, "overlay.ph.description")}
      features={[
        serverT(lang, "overlay.ph.feature.cash"),
        serverT(lang, "overlay.ph.feature.vendor_people"),
        serverT(lang, "overlay.ph.feature.strategic"),
        serverT(lang, "overlay.ph.feature.executive"),
        serverT(lang, "overlay.ph.feature.forecast"),
        serverT(lang, "overlay.ph.feature.edit_window"),
      ]}
      shippingIn={serverT(lang, "overlay.ph.shipping")}
    />
  );
}

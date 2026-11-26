/**
 * /admin/catering/delivery — catering delivery D2: the per-shop delivery settings (migration 0356): on / off, the
 * shop's couriers, the driver's share of the gratuity. Owner / CGS / MoO only, by trusted ROLE (the same rule the
 * routes and the writer apply); anyone else is sent back to the catering hub. While `DELIVERY_TRACKING` is off the page
 * says so (its hub tile is hidden); before 0356 is applied it says the settings are not installed. It never shows a
 * switch that could only fail. The admin shell (auth boundary, StepUpProvider) is app/admin/layout.tsx.
 */
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { DeliverySettings } from "@/components/admin/catering/DeliverySettings";
import { canManageDeliverySettings } from "@/lib/delivery/access-shared";
import { loadDeliverySettings, type DeliverySettingsView } from "@/lib/delivery/settings";

export const dynamic = "force-dynamic";

export default async function AdminCateringDeliveryPage() {
  const auth = await requireSessionFromHeaders("/admin/catering/delivery");
  if (!canManageDeliverySettings(auth.role)) redirect("/admin/catering");
  const lang = auth.user.language;
  const t = (key: string) => serverT(lang, `admin.catering.delivery.${key}` as TranslationKey);
  let view: DeliverySettingsView | "unavailable";
  try { view = await loadDeliverySettings(auth); }
  catch { view = "unavailable"; }
  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mt-4">
        {view === "unavailable" ? <p role="alert" className="co-card p-4 text-sm font-bold text-co-cta-text">{t("error.settings_unavailable")}</p>
          : view.state === "off" ? <p role="status" className="co-card p-4 text-sm font-bold text-co-text-muted">{t("off")}</p>
          : view.state === "not_installed" ? <p role="status" className="co-card p-4 text-sm font-bold text-co-warning-text">{t("not_installed")}</p>
          : <DeliverySettings shops={view.shops} />}
      </div>
    </div>
  );
}

/**
 * /admin/catering/toast — item 21 PR 5: the catering ↔ Toast settings, per shop (migration 0350), and "orders not
 * matched yet". Owner / CGS / MoO only, by trusted ROLE (the same rule the routes and the writer apply); anyone else is
 * sent back to the catering hub. Before 0344 / 0350 are applied the page says the settings are not installed; it never
 * shows a switch that could only fail. The admin shell (auth boundary, StepUpProvider) is app/admin/layout.tsx.
 */
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { CateringToastSettings } from "@/components/admin/catering/CateringToastSettings";
import { canManageCateringToastSettings, type CateringToastSettingsView } from "@/lib/catering/catering-toast-settings-shared";
import { loadCateringToastSettings } from "@/lib/catering/catering-toast-settings";

export const dynamic = "force-dynamic";

export default async function AdminCateringToastPage() {
  const auth = await requireSessionFromHeaders("/admin/catering/toast");
  if (!canManageCateringToastSettings(auth.role)) redirect("/admin/catering");
  const lang = auth.user.language;
  const t = (key: string) => serverT(lang, `admin.catering.toast.${key}` as TranslationKey);
  let view: CateringToastSettingsView | "unavailable";
  try { view = await loadCateringToastSettings(auth); }
  catch { view = "unavailable"; }
  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mt-4">
        {view === "unavailable" ? <p role="alert" className="co-card p-4 text-sm font-bold text-co-cta-text">{t("error.settings_unavailable")}</p>
          : view.state === "not_installed" ? <p role="status" className="co-card p-4 text-sm font-bold text-co-warning-text">{t("not_installed")}</p>
          : <CateringToastSettings shops={view.shops} readiness={view.readiness} />}
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadChecklistAdminView, type PrepSubtype } from "@/lib/admin/templates";
import { ChecklistTabs } from "@/components/admin/templates/ChecklistTabs";
import { PageHeader } from "@/components/ui/PageHeader";

function isPrepSubtype(v: string): v is PrepSubtype {
  return v === "am_prep" || v === "mid_day_prep";
}

export default async function AdminChecklistSubtypePage({
  params,
}: { params: Promise<{ subtype: string }> }) {
  const { subtype } = await params;
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard"); // AGM+ may enter
  if (!isPrepSubtype(subtype)) redirect("/admin/checklist-templates");
  const lang = auth.user.language;

  const view = await loadChecklistAdminView(auth, subtype);

  return (
    <div>
      <PageHeader
        title={serverT(lang, `admin.templates.subtype.${subtype}` as TranslationKey)}
        subtitle={serverT(lang, "admin.templates.subtitle")}
      />
      <ChecklistTabs view={view} />
    </div>
  );
}

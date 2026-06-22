import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { getPrepTemplateDetail, AdminTemplateError } from "@/lib/admin/templates";
import { PrepTemplateEditor } from "@/components/admin/templates/PrepTemplateEditor";

export default async function AdminPrepTemplateDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 7) redirect("/dashboard");
  const lang = auth.user.language;

  let detail: Awaited<ReturnType<typeof getPrepTemplateDetail>>;
  try {
    detail = await getPrepTemplateDetail(auth, id);
  } catch (e) {
    if (e instanceof AdminTemplateError) redirect("/admin/checklist-templates");
    throw e;
  }

  return (
    <div>
      <Link href="/admin/checklist-templates" className="text-sm font-bold text-co-text-muted hover:text-co-text">
        ← {serverT(lang, "admin.templates.back_to_list")}
      </Link>
      <h1 className="mt-2 text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, `admin.templates.subtype.${detail.prepSubtype}` as TranslationKey)}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{detail.name}</p>
      <PrepTemplateEditor templateId={detail.id} prepSubtype={detail.prepSubtype} items={detail.items} />
    </div>
  );
}

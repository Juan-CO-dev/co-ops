import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listPrepTemplates } from "@/lib/admin/templates";

export default async function AdminPrepTemplatesPage({
  searchParams,
}: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 7) redirect("/dashboard");
  const lang = auth.user.language;
  const sp = await searchParams;

  const sb = getServiceRoleClient();
  const { data: locRows } = await sb.from("locations").select("id, name, code").eq("active", true).order("name");
  const all = (locRows ?? []).map((r) => r as { id: string; name: string; code: string });
  const actorAll = isAllLocationsAccess({ role: auth.user.role, locations: auth.locations });
  const accessible = actorAll ? all : all.filter((l) => auth.locations.includes(l.id));

  const selected = sp.location && accessible.some((l) => l.id === sp.location)
    ? sp.location
    : accessible[0]?.id ?? null;

  const templates = selected ? await listPrepTemplates(auth, selected) : [];

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.templates.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.templates.subtitle")}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {accessible.map((loc) => (
          <Link
            key={loc.id}
            href={`/admin/checklist-templates?location=${loc.id}`}
            className={`inline-flex min-h-[44px] items-center rounded-lg border-2 px-3 text-sm font-bold transition ${
              loc.id === selected ? "border-co-gold-deep bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text hover:border-co-text"
            }`}
          >
            {loc.code} · {loc.name}
          </Link>
        ))}
      </div>

      <ul className="mt-5 flex flex-col gap-3">
        {templates.map((t) => (
          <li key={t.id}>
            <Link
              href={`/admin/checklist-templates/${t.id}`}
              className="flex items-center justify-between rounded-xl border-2 border-co-border bg-co-surface p-4 transition hover:border-co-text"
            >
              <span>
                <span className="block text-base font-extrabold text-co-text">
                  {serverT(lang, `admin.templates.subtype.${t.prepSubtype}` as TranslationKey)}
                </span>
                <span className="block text-sm text-co-text-muted">{t.name}</span>
              </span>
              <span className="text-sm text-co-text-muted">
                {serverT(lang, "admin.templates.item_count").replace("{count}", String(t.activeItemCount))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

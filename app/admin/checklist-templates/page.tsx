import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PrepSubtype } from "@/lib/admin/templates";

/** Checklist-first IA: list the prep checklist TYPES; each links to its tabbed page. */
const SUBTYPES: PrepSubtype[] = ["am_prep", "mid_day_prep"];

export default async function AdminChecklistTypesPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard"); // AGM+ may enter
  const lang = auth.user.language;

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.templates.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.templates.subtitle")}</p>

      <ul className="mt-5 flex flex-col gap-3">
        {SUBTYPES.map((subtype) => (
          <li key={subtype}>
            <Link
              href={`/admin/checklist-templates/${subtype}`}
              className="flex items-center justify-between rounded-xl border-2 border-co-border bg-co-surface p-4 transition hover:border-co-text"
            >
              <span className="block text-base font-extrabold text-co-text">
                {serverT(lang, `admin.templates.subtype.${subtype}` as TranslationKey)}
              </span>
              <span className="text-sm text-co-text-muted">{serverT(lang, "admin.templates.open")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

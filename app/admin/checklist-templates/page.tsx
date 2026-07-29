import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES, getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  loadNeedsLinkQueue,
  loadLinkTargets,
  NEEDS_LINK_WRITE_MIN,
} from "@/lib/admin/needs-link";
import { NeedsLinkQueue } from "@/components/admin/templates/NeedsLinkQueue";

/**
 * Lists hub (The Master List, spec §3; Template Builder spec §0). The single
 * authoring surface for every list type, plus the needs-link queue at the root
 * (spec §4). Prep subtypes (am_prep / mid_day_prep) open their existing editor;
 * opening / closing / deep_cleaning are listed here with their editors delegated
 * to the builder arc (PR-1/PR-2). The "report definitions" ghost card is gone
 * (Template Builder §0 lie 2 — the checklist template IS the report template).
 */

/** Prep subtypes have a live per-list editor at /[subtype]. */
const PREP_SUBTYPES = ["am_prep", "mid_day_prep"] as const;
/** Other template TYPES surfaced in the hub navigation (editors pending). */
const OTHER_LIST_TYPES = ["opening", "closing", "deep_cleaning"] as const;

export default async function AdminListsReportsPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard"); // AGM+ may enter
  const lang = auth.user.language;
  const level = getRoleLevel(auth.user.role);

  const [needsLinkRows, linkTargets] = await Promise.all([
    loadNeedsLinkQueue(auth),
    loadLinkTargets(auth),
  ]);

  const cardCls =
    "flex items-center justify-between rounded-xl border-2 border-co-border bg-co-surface p-4 transition hover:border-co-text";

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.templates.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.templates.subtitle")}</p>

      {/* Needs-link queue (spec §4). */}
      <section className="mt-6">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
            {serverT(lang, "admin.templates.needs_link.title")}
          </h2>
          {needsLinkRows.length > 0 && (
            <span className="inline-flex items-center rounded-full border border-co-cta/50 bg-co-cta/10 px-2 py-0.5 text-[11px] font-bold text-co-cta">
              {needsLinkRows.length}
            </span>
          )}
        </div>
        <p className="mb-3 mt-1 text-xs text-co-text-muted">{serverT(lang, "admin.templates.needs_link.subtitle")}</p>
        <NeedsLinkQueue rows={needsLinkRows} targets={linkTargets} canLink={level >= NEEDS_LINK_WRITE_MIN} />
      </section>

      {/* All list types + report definitions. */}
      <section className="mt-8">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
          {serverT(lang, "admin.templates.lists_heading")}
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {PREP_SUBTYPES.map((subtype) => (
            <li key={subtype}>
              <Link href={`/admin/checklist-templates/${subtype}`} className={cardCls}>
                <span className="block text-base font-extrabold text-co-text">
                  {serverT(lang, `admin.templates.subtype.${subtype}` as TranslationKey)}
                </span>
                <span className="text-sm text-co-text-muted">{serverT(lang, "admin.templates.open")}</span>
              </Link>
            </li>
          ))}
          {OTHER_LIST_TYPES.map((type) => (
            <li key={type}>
              <div className={cardCls + " cursor-default opacity-70"}>
                <span className="block text-base font-extrabold text-co-text">
                  {serverT(lang, `admin.templates.type.${type}` as TranslationKey)}
                </span>
                <span className="text-sm text-co-text-muted">{serverT(lang, "admin.templates.editor_pending")}</span>
              </div>
            </li>
          ))}
          {/* The "report definitions" ghost card is deleted (spec §0 lie 2): the
              checklist template IS the report template — report knobs live inside
              the template editor, not a phantom entity. */}
        </ul>
      </section>
    </div>
  );
}

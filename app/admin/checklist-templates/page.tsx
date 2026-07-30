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
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Lists hub (The Master List, spec §3; Template Builder spec §0). The single
 * authoring surface for every list type, plus the needs-link queue at the root
 * (spec §4). Prep subtypes (am_prep / mid_day_prep) open their existing editor;
 * closing + opening open the live builder (PR-1/PR-2). The "report definitions"
 * ghost card is gone (Template Builder §0 lie 2 — the checklist template IS the
 * report template).
 *
 * deep_cleaning is NOT a pending EDITOR — /deep-cleaning is a placeholder surface
 * (Module #15, unbuilt: no templates in prod, no operator surface). Its card is
 * kept (the type is planned) but rendered HONESTLY (spec §0 lie 1): muted, no
 * link, "Arrives with Deep Cleaning (Module #15)" — not the misleading "editor
 * coming soon" (which implies an editor is the only thing missing).
 */

/** Prep subtypes have a live per-list editor at /[subtype]. */
const PREP_SUBTYPES = ["am_prep", "mid_day_prep"] as const;
/** Types with a LIVE builder page (static segment). PR-1: closing. PR-2: opening. */
const LIVE_BUILDER_TYPES = ["closing", "opening"] as const;
/** Types with a planned card but no editor + no operator surface yet. Rendered
 *  muted, no link, module-honest (deep_cleaning = Module #15, unbuilt). */
const MODULE_PENDING_TYPES = ["deep_cleaning"] as const;

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
    "co-card co-card-interactive flex items-center justify-between p-4";

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.templates.title")}
        subtitle={serverT(lang, "admin.templates.subtitle")}
      />

      {/* All list types FIRST — the primary navigation (owner ruling 2026-07-30:
          the needs-link queue was pushing the editors below an endless scroll). */}
      <section className="mt-6">
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
          {LIVE_BUILDER_TYPES.map((type) => (
            <li key={type}>
              <Link href={`/admin/checklist-templates/${type}`} className={cardCls}>
                <span className="block text-base font-extrabold text-co-text">
                  {serverT(lang, `admin.templates.type.${type}` as TranslationKey)}
                </span>
                <span className="text-sm text-co-text-muted">{serverT(lang, "admin.templates.open")}</span>
              </Link>
            </li>
          ))}
          {MODULE_PENDING_TYPES.map((type) => (
            <li key={type} aria-disabled="true">
              <div className="co-card flex cursor-default items-center justify-between p-4 opacity-60">
                <span className="block text-base font-extrabold text-co-text-muted">
                  {serverT(lang, `admin.templates.type.${type}` as TranslationKey)}
                </span>
                <span className="text-sm text-co-text-muted">
                  {serverT(lang, "admin.templates.arrives_with_module")}
                </span>
              </div>
            </li>
          ))}
          {/* The "report definitions" ghost card is deleted (spec §0 lie 2): the
              checklist template IS the report template — report knobs live inside
              the template editor, not a phantom entity. */}
        </ul>
      </section>

      {/* Needs-link queue (spec §4) — COLLAPSED by default (owner ruling
          2026-07-30: "those should be collapsed and opened as needed"). The
          count chip stays visible in the collapsed header (D2 alert slot). */}
      <section className="mt-8">
        <CollapsibleSection
          idBase="hub-needs-link"
          title={serverT(lang, "admin.templates.needs_link.title")}
          badge={
            needsLinkRows.length > 0 ? (
              <span className="inline-flex items-center rounded-full border border-co-cta/50 bg-co-cta/10 px-2 py-0.5 text-[11px] font-bold text-co-cta">
                {needsLinkRows.length}
              </span>
            ) : null
          }
        >
          <p className="mb-3 text-xs text-co-text-muted">{serverT(lang, "admin.templates.needs_link.subtitle")}</p>
          <NeedsLinkQueue rows={needsLinkRows} targets={linkTargets} canLink={level >= NEEDS_LINK_WRITE_MIN} />
        </CollapsibleSection>
      </section>
    </div>
  );
}

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES, getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadTemplateBuilderView, runTemplateDoctor, loadReferenceTargets } from "@/lib/admin/template-builder";
import { loadPrepOverview } from "@/lib/admin/prep-overview";
import { loadLinkTargets } from "@/lib/admin/needs-link";
import { TemplateBuilderClient } from "@/components/admin/template-builder/TemplateBuilderClient";
import { PrepOverviewPanel } from "@/components/admin/template-builder/PrepOverviewPanel";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * /admin/checklist-templates/opening — the Template Builder on OPENING (spec
 * §7/§10 PR-2). Static segment: it wins over the sibling `[subtype]` dynamic
 * route (which gates prep subtypes and redirects everything else), so am_prep /
 * mid_day_prep still open the prep editor while `opening` opens THIS builder —
 * exactly as `closing` does.
 *
 * OPENING SHAPE (spec §7): Phase-1 rows are editable-surface (the two same-day
 * fills work on them exactly as on closing); Phase-2 rows are the AM-Prep
 * verification MIRRORS (prep_meta.openingPhase2 = true), rendered READ-ONLY —
 * the "Managed by AM Prep" badge + drawer, no es-fill form (their translations
 * mirror from AM Prep), no spine-link (they share the AM-prep item's item_id),
 * and excluded from the needs-link / es-fill Doctor counts (mirror-aware
 * classifiers, template-builder-shared). The client is type-aware; pass
 * type="opening" via the loaded view.
 *
 * AGM+ (level >= 6) may READ (matches the hub floor + needs-link READ floor);
 * the two same-day FILLS are GM+ (level >= 7, Tier-A step-up) — enforced at the
 * fill routes AND gated in the client via `canFill`.
 *
 * WRITE SCOPE (spec §1, PR-3): the two same-day fills (es translations + spine link,
 * on Phase-1 rows) write in place; STRUCTURAL edits (add / relabel / describe /
 * disable / enable / reorder / required-flip / role) are drafted in the client and
 * PUBLISHED as a new version effective next operational day (apply-now = today,
 * gated). Phase-2 mirror rows are never draft-edited (the §5 seal).
 */
export default async function AdminOpeningBuilderPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard"); // AGM+ may enter
  const lang = auth.user.language;
  const level = getRoleLevel(auth.user.role);

  const [view, doctor, linkTargets, referenceTargets, prepOverview] = await Promise.all([
    loadTemplateBuilderView(auth, "opening"),
    runTemplateDoctor(auth, "opening"),
    loadLinkTargets(auth),
    loadReferenceTargets(auth, "opening"),
    loadPrepOverview(auth),
  ]);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.templates.type.opening")}
        subtitle={serverT(lang, "admin.templates.subtitle")}
      />

      <TemplateBuilderClient
        view={view}
        doctor={doctor}
        linkTargets={linkTargets}
        referenceTargets={referenceTargets}
        canFill={level >= 7}
      />

      {/* Read-only prep overview + prep Doctor (PR-3/4) — LAST + advisory; every fix
          deep-links to the prep editor. Not folded into the opening Doctor totals. */}
      <div className="mt-6">
        <PrepOverviewPanel overview={prepOverview} />
      </div>
    </div>
  );
}

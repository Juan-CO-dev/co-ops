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
 * /admin/checklist-templates/closing — the Template Builder on CLOSING (spec
 * §7; PR-1). Static segment: it wins over the sibling `[subtype]` dynamic route
 * (which gates prep subtypes and redirects everything else), so am_prep /
 * mid_day_prep still open the prep editor while `closing` opens THIS builder.
 *
 * AGM+ (level >= 6) may READ (matches the hub floor + needs-link READ floor);
 * the two same-day FILLS are GM+ (level >= 7, Tier-A step-up) — enforced at the
 * fill routes AND gated in the client via `canFill`.
 *
 * WRITE SCOPE (spec §1, PR-3): the two same-day fills (es translations + spine link)
 * write in place; STRUCTURAL edits (add / relabel / describe / disable / enable /
 * reorder / required-flip / role) are drafted in the client and PUBLISHED as a new
 * version effective next operational day (apply-now = today, gated + Tier-A step-up).
 */
export default async function AdminClosingBuilderPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard"); // AGM+ may enter
  const lang = auth.user.language;
  const level = getRoleLevel(auth.user.role);

  const [view, doctor, linkTargets, referenceTargets, prepOverview] = await Promise.all([
    loadTemplateBuilderView(auth, "closing"),
    runTemplateDoctor(auth, "closing"),
    loadLinkTargets(auth),
    loadReferenceTargets(auth, "closing"),
    loadPrepOverview(auth),
  ]);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.templates.type.closing")}
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
          deep-links to the prep editor. Not folded into the closing Doctor totals. */}
      <div className="mt-6">
        <PrepOverviewPanel overview={prepOverview} />
      </div>
    </div>
  );
}

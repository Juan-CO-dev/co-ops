import Link from "next/link";
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES, getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadTemplateBuilderView, runTemplateDoctor } from "@/lib/admin/template-builder";
import { loadLinkTargets } from "@/lib/admin/needs-link";
import { TemplateBuilderClient } from "@/components/admin/template-builder/TemplateBuilderClient";

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
 * WRITE SCOPE (spec §1): this PR ships the builder UI but the only writes wired
 * are PR-0's two same-day fills (es translations + spine link). Structural edits
 * arrive with PR-3's publish/versioning engine — the client renders no structural
 * affordances (a "editing arrives with Publish" note instead).
 */
export default async function AdminClosingBuilderPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard"); // AGM+ may enter
  const lang = auth.user.language;
  const level = getRoleLevel(auth.user.role);

  const [view, doctor, linkTargets] = await Promise.all([
    loadTemplateBuilderView(auth, "closing"),
    runTemplateDoctor(auth, "closing"),
    loadLinkTargets(auth),
  ]);

  return (
    <div>
      <Link href="/admin/checklist-templates" className="text-sm font-bold text-co-text-muted hover:text-co-text">
        ← {serverT(lang, "admin.templates.back_to_list")}
      </Link>
      <h1 className="mt-2 text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.templates.type.closing")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.templates.subtitle")}</p>

      <TemplateBuilderClient
        view={view}
        doctor={doctor}
        linkTargets={linkTargets}
        canFill={level >= 7}
      />
    </div>
  );
}

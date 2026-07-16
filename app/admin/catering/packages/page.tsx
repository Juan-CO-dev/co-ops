/**
 * /admin/catering/packages (Catering KB — Wave 1, slice 1A) — packages editor.
 *
 * Server component: gate ≥6 (catering.kb.packages.write). The admin shell (auth
 * boundary, level ≥6, providers incl. StepUpProvider) lives in app/admin/layout.tsx;
 * this page re-gates ≥6 defensively per the C.39 pattern and redirects below the
 * floor. Loads the packages the actor can see (globals + own locations, or all
 * for level 9+) + active locations for the create form's optional select.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadPackages, loadPackageLocations, PACKAGE_READ_MIN } from "@/lib/admin/catering/packages";
import { PackagesClient } from "@/components/admin/catering/packages/PackagesClient";

export default async function AdminCateringPackagesPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < PACKAGE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [packages, locations] = await Promise.all([
    loadPackages(auth),
    loadPackageLocations(auth),
  ]);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.catering.packages.title" as TranslationKey)}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.catering.packages.subtitle" as TranslationKey)}
      </p>
      <PackagesClient packages={packages} locations={locations} actorLevel={level} />
    </div>
  );
}

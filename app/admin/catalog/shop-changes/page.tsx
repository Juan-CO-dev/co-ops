/**
 * /admin/catalog/shop-changes — every shop's own recipe versions and menu settings, with Promote / Leave (catalog
 * Phase 3b; spec §6, the Director of Operations). Server component: the admin layout holds the auth boundary, the
 * level-6 floor and StepUpProvider; this page re-gates at MoO+ (8) before any read, and the lib re-checks the floor
 * AND the role rule (loadShopChanges — the social media manager is refused by ROLE there, never only here). Every
 * row links to that shop's view of the item (?location=<shop>).
 */
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import { loadShopChanges } from "@/lib/catalog/shop-changes";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { PageHeader } from "@/components/ui/PageHeader";
import { ShopChangesClient } from "@/components/catalog/ShopChangesClient";

export default async function ShopChangesPage() {
  const auth = await requireSessionFromHeaders("/admin");
  if (auth.level < GLOBAL_VERSION_WRITE_MIN) redirect("/admin");
  let view;
  try {
    view = await loadShopChanges(auth);
  } catch (e) {
    if (e instanceof RecipeVersionError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4">
      <PageHeader title={serverT(auth.user.language, "catalog.changes.title")} />
      <ShopChangesClient view={view} />
    </div>
  );
}

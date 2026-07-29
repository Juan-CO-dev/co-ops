/**
 * /admin/items — THE Items Master Catalog (2026-07-26). Two top-level views via
 * a client switcher: Catalog (default, NEW — every items-universe entity + its
 * routing dossier) and the classic Prep registry (existing ItemsClient, zero
 * regression). Server component: gate ≥6 (mirrors admin/skus); admin shell owns
 * auth+chrome. Both the registry view and the catalog load server-side; the
 * catalog batch-loads once (loadRecipeGraph law).
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadItemsAdminView, ITEMS_READ_MIN } from "@/lib/admin/items";
import { loadCatalogView } from "@/lib/admin/catalog";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import type { Readiness } from "@/lib/readiness";
import { ItemsClient } from "@/components/admin/items/ItemsClient";
import { CatalogClient } from "@/components/admin/catalog/CatalogClient";
import { ItemsPageTabs } from "@/components/admin/catalog/ItemsPageTabs";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminItemsPage() {
  const auth = await requireSessionFromHeaders("/admin/items");
  const level = getRoleLevel(auth.user.role);
  if (level < ITEMS_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [view, entities] = await Promise.all([
    loadItemsAdminView(auth),
    loadCatalogView(auth),
  ]);

  let itemReadiness: Record<string, Readiness> = {};
  try {
    const g = await loadGraphReadiness(auth);
    itemReadiness = Object.fromEntries(
      [...g.itemReadiness.entries()].filter(([, r]) => r.status !== "ready"),
    );
  } catch (e) {
    console.error("readiness load failed (rendering without badges)", e);
  }

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.catalog.title")}
        subtitle={serverT(lang, "admin.catalog.subtitle")}
      />
      <ItemsPageTabs
        catalog={<CatalogClient entities={entities} actorLevel={level} />}
        registry={<ItemsClient view={view} itemReadiness={itemReadiness} />}
      />
    </div>
  );
}

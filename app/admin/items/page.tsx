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
import { loadActiveShopsForReadiness, loadGraphReadiness } from "@/lib/admin/readiness-load";
import { itemsLandingView } from "@/lib/admin/readiness-scope-shared";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import type { Readiness } from "@/lib/readiness";
import { ItemsClient } from "@/components/admin/items/ItemsClient";
import { CatalogClient } from "@/components/admin/catalog/CatalogClient";
import { ItemsPageTabs } from "@/components/admin/catalog/ItemsPageTabs";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminItemsPage({ searchParams }: {
  searchParams: Promise<{ view?: string; location?: string }>;
}) {
  const auth = await requireSessionFromHeaders("/admin/items");
  const level = getRoleLevel(auth.user.role);
  if (level < ITEMS_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;
  const sp = await searchParams;
  // A shop-scoped link (the hub's attributed readiness) opens the REGISTRY tab — the one that reads the scoped
  // readiness; the catalog tab's readiness stays the default's (loadCatalogView, global by intent).
  // ?location= is read through the shop-context getter and the one resolver (route contract). Absent or "global" =
  // the default — never the remembered shop: this view's scope is what the link asked for.
  const explicit = shopParamFor("/admin/items", searchParamValues(sp));
  const initialView = itemsLandingView({ view: sp.view, location: explicit });
  const shops = await loadActiveShopsForReadiness();
  const scope = explicit && explicit !== "global" && shops.some((s) => s.id === explicit)
    ? await resolveShopId(shops.map((s) => s.id), explicit) : null;
  const scopeName = scope ? shops.find((s) => s.id === scope)?.name ?? null : null;

  const [view, entities] = await Promise.all([
    loadItemsAdminView(auth),
    loadCatalogView(auth),
  ]);

  let itemReadiness: Record<string, Readiness> = {};
  try {
    const g = await loadGraphReadiness(auth, scope);
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
      <p className="mt-2 text-sm text-co-text-muted">
        {scope === null ? serverT(lang, "readiness.scope.default") : serverT(lang, "readiness.scope.shop", { shop: scopeName ?? "" })}
        {scope !== null ? <> · <a href="/admin/items?view=registry" className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{serverT(lang, "readiness.scope.show_default")}</a></> : null}
      </p>
      <ItemsPageTabs
        key={initialView}
        initialView={initialView}
        catalog={<CatalogClient entities={entities} actorLevel={level} />}
        registry={<ItemsClient view={view} itemReadiness={itemReadiness} shopScope={scope} />}
      />
    </div>
  );
}

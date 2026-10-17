/**
 * /admin/catalog/sku/[id] — the connected item page for a bought item (catalog Phase 2b; spec §4).
 * Server component: the admin layout holds the auth boundary, the level-6 floor and StepUpProvider;
 * this page re-gates defensively (C.39). The shop comes from THE one resolver (resolveShopId over the
 * shops the actor may work in — catalogShopAllowed: a membership, or MoO+ for every shop, D2);
 * `?location=global` shows the default. The client is KEYED by (SKU, shop), so a switch remounts it.
 * Every read is a catalog act: the social media manager (level 6) is refused by the lib (403 → the
 * dashboard), and a shop-owned SKU only ever offers its owner.
 * `/admin/skus` keeps working; Phase 1's skuCatalogHref still lands on its row, which links here.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { CatalogItemError, loadSkuItemView } from "@/lib/catalog/sku-item";
import { itemClientKey, readJobParam } from "@/lib/catalog/sku-item-shared";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { readFocusParam } from "@/lib/admin/product-item-links-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkuItemClient } from "@/components/catalog/SkuItemClient";
import { loadItemJobsStrip } from "@/lib/catalog/jobs";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CatalogSkuPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const auth = await requireSessionFromHeaders("/admin");
  if (auth.level < 6) redirect("/dashboard");

  const sb = getServiceRoleClient();
  const [{ data: locs, error }, { data: sku, error: skuErr }] = await Promise.all([
    sb.from("locations").select("id, name").eq("active", true).order("name").order("id").returns<Array<{ id: string; name: string }>>(),
    sb.from("vendor_items").select("id, location_id").eq("id", id).maybeSingle<{ id: string; location_id: string | null }>(),
  ]);
  if (error) throw new Error(`catalog sku page locations: ${error.message}`);
  if (skuErr) throw new Error(`catalog sku page sku: ${skuErr.message}`);
  if (!sku) notFound();
  // The switcher follows the writers' rules: a membership, or MoO+ for every active shop (D2) — and a
  // SHOP-OWNED SKU has no other shop (0259's owner rule), so only its owner is offered.
  const shops = (locs ?? []).filter((l) => catalogShopAllowed(auth, l.id) && (sku.location_id === null || sku.location_id === l.id));
  const explicit = shopParamFor(`/admin/catalog/sku/${id}`, searchParamValues(sp));
  const scope = explicit === "global" ? null : await resolveShopId(shops.map((s) => s.id), explicit ?? null);

  let view, jobs;
  try {
    view = await loadSkuItemView(auth, id, scope, shops);
    // Owned pack/price defaults may be global; jobs still belong to the owner shop.
    jobs = view.sku.active ? await loadItemJobsStrip(auth, id, sku.location_id ?? scope) : undefined;
  } catch (e) {
    if (e instanceof ShopOwnedError && e.status === 404) notFound();
    if (e instanceof ShopOwnedError && e.status === 403) redirect("/dashboard");
    if (e instanceof CatalogItemError && e.status === 404) notFound();
    if (e instanceof CatalogItemError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <PageHeader title={view.sku.name} subtitle={serverT(auth.user.language, "catalog.item.kind_bought")} />
      {/* ONE client per (SKU, shop): a ?location= switch REMOUNTS it, so no draft, preview or chosen
          conversion from the previous shop survives into this one (Astra 2b#5). */}
      <SkuItemClient key={itemClientKey(view.sku.id, view.scope)} view={view} jobs={jobs} job={readJobParam(sp.job)} requestId={readFocusParam(sp.request)} />
    </div>
  );
}

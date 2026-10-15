/**
 * /admin/catalog/menu-item/[id] — the connected MENU ITEM page (catalog Phase 3b; spec §3, §4).
 * Server component: the admin layout holds the auth boundary, the level-6 floor and StepUpProvider; this page
 * re-gates defensively. Reads are level 6+ (the social media manager refused by ROLE in the lib —
 * loadMenuItemPageView — and sent to the dashboard). `?location=global` shows the global menu; `?location=<shop>`
 * any active shop (a shop the viewer can't change reads, with a way forward to one they can); no parameter → the one
 * resolver over the shops the viewer may work in (catalogShopAllowed: a membership, or MoO+ for every shop), else
 * the global menu. The client is KEYED by (menu item, scope), so a shop switch remounts it. Mirrors the recipe page.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { loadMenuItemPageView } from "@/lib/catalog/menu-item-page";
import { pageClientKey } from "@/lib/catalog/recipe-item-shared";
import { MenuShopError } from "@/lib/admin/menu-item-shop";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { MenuItemClient } from "@/components/catalog/MenuItemClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Level 6+ reads the menu item page (operational managers and up), as the lib's view rule. */
const MENU_PAGE_READ_MIN = 6;

export default async function CatalogMenuItemPage({
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
  if (auth.level < MENU_PAGE_READ_MIN) redirect("/dashboard");

  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name").order("id")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`catalog menu page locations: ${error.message}`);
  const active = (locs ?? []).map((l) => l.id);
  // The shops this viewer works in (the writers' rule, D2): a membership, or MoO+ for every active shop.
  const mine = active.filter((l) => catalogShopAllowed(auth, l));
  const explicit = shopParamFor(`/admin/catalog/menu-item/${id}`, searchParamValues(sp));
  const scope = explicit === "global" ? null
    : explicit && mine.includes(explicit) ? await resolveShopId(mine, explicit)
    // Another active shop's settings read, read-only — the page offers "Change it for <your shop>".
    : explicit && active.includes(explicit) ? explicit
    : mine.length > 0 ? await resolveShopId(mine, null) : null;

  let view;
  try {
    view = await loadMenuItemPageView(auth, id, scope);
  } catch (e) {
    if (e instanceof MenuShopError && e.status === 404) notFound();
    if (e instanceof MenuShopError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  if (!view) notFound();
  const lang = auth.user.language;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <PageHeader title={lang === "es" && view.here.nameEs ? view.here.nameEs : view.here.name} subtitle={serverT(lang, "catalog.menu.kind")} />
      {/* ONE client per (menu item, shop): a ?location= switch REMOUNTS it, so no draft or preview from the previous
          shop survives into this one. */}
      <MenuItemClient key={pageClientKey("menu", view.item.id, view.scope)} view={view} />
    </div>
  );
}

/**
 * /admin/catalog/notices — a GM's RECIPE UPDATES for one shop (catalog Phase 3b; spec §6): another shop changed a
 * recipe this shop copied, or a recipe this shop rides got a new default. Server component: the admin layout holds the
 * auth boundary, the level-6 floor and StepUpProvider; this page re-gates at the GM floor (7) before any read, and the
 * lib binds the shop (loadShopNotices: the shop write gate — GM floor, the role rule, the shop bind).
 *
 * WHICH SHOP: `?location=<shop>` through the one getter, then the one resolver (explicit → remembered → first) over the
 * shops this viewer works in (catalogShopAllowed: a membership, or MoO+ for every active shop). Shops are ids and names
 * — never codes. The shop chips WRAP at 375px (no sideways scroller).
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { loadShopNotices } from "@/lib/catalog/shop-changes";
import { noticesHref } from "@/lib/catalog/recipe-item-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecipeNoticesClient } from "@/components/catalog/RecipeNoticesClient";

export default async function RecipeNoticesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const auth = await requireSessionFromHeaders("/admin");
  if (auth.level < RECIPE_SHOP_WRITE_MIN) redirect("/admin");
  const lang = auth.user.language;

  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name").order("id")
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`notices page locations: ${error.message}`);
  // The shops this viewer works in (the writers' rule): a membership, or MoO+ for every active shop.
  const shops = (locs ?? []).filter((l) => catalogShopAllowed(auth, l.id));
  const mine = shops.map((s) => s.id);
  const explicit = shopParamFor("/admin/catalog/notices", searchParamValues(sp));
  const shopId = mine.length === 0 ? null : await resolveShopId(mine, explicit ?? null);

  let notices: Awaited<ReturnType<typeof loadShopNotices>> = [];
  if (shopId) {
    try {
      notices = await loadShopNotices(auth, shopId);
    } catch (e) {
      // The lib's own gate (the role rule, the shop bind) refused: never a crash.
      if (e instanceof RecipeVersionError && e.status === 403) redirect("/dashboard");
      throw e;
    }
  }
  const pill = (on: boolean) =>
    `inline-flex min-h-[44px] max-w-full items-center break-words rounded-full border-2 px-4 text-sm font-bold ${on ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
      <PageHeader title={serverT(lang, "catalog.notices.title")} subtitle={serverT(lang, "catalog.notices.intro")} />
      {shops.length > 1 ? (
        <nav aria-label={serverT(lang, "catalog.notices.pick_shop")} className="flex flex-wrap gap-2">
          {shops.map((s) => (
            <Link key={s.id} href={noticesHref(s.id)} aria-current={shopId === s.id ? "page" : undefined} className={pill(shopId === s.id)}>{s.name}</Link>
          ))}
        </nav>
      ) : null}
      {shopId ? <RecipeNoticesClient shopId={shopId} notices={notices} /> : <p className="text-sm text-co-text-muted">{serverT(lang, "catalog.notices.none")}</p>}
    </div>
  );
}

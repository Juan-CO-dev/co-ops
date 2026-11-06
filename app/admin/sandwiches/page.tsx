import Link from "next/link";
import { redirect } from "next/navigation";
import { SandwichesClient } from "@/components/admin/sandwiches/SandwichesClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportLinks } from "@/components/reports-export/ExportLinks";
import { loadSandwiches } from "@/lib/admin/sandwiches";
import { canViewSandwiches } from "@/lib/admin/sandwiches-shared";
import { newSandwichJobHref } from "@/lib/catalog/jobs-shared";
import { serverT } from "@/lib/i18n/server";
import { canReadReportLocation } from "@/lib/locations";
import { catalogWriteRoleAllowed } from "@/lib/sku-versions-shared";
import { getRoleLevel } from "@/lib/roles";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";

export default async function SandwichesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSessionFromHeaders("/admin/sandwiches");
  if (!canViewSandwiches(auth.user.role)) redirect("/dashboard");
  const lang = auth.user.language;
  const sp = await searchParams;
  const explicit = shopParamFor("/admin/sandwiches", searchParamValues(sp));
  const actor = { role: auth.user.role, locations: auth.locations };
  if (explicit && explicit !== "global" && !canReadReportLocation(actor, explicit)) redirect("/dashboard");
  const { data, error } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`sandwiches locations: ${error.message}`);
  const shops = (data ?? []).filter(shop => canReadReportLocation(actor, shop.id));
  if (explicit && explicit !== "global" && !shops.some(shop => shop.id === explicit)) redirect("/dashboard");
  const scope = await resolveShopId(shops.map(shop => shop.id), explicit === "global" ? undefined : explicit);
  const view = scope ? await loadSandwiches(auth, scope) : null;
  const canEditShop = getRoleLevel(auth.user.role) >= 7;
  return <div className="min-w-0 space-y-4">
    <PageHeader title={serverT(lang, "admin.sandwiches.title")} subtitle={serverT(lang, "admin.sandwiches.subtitle")} />
    <nav aria-label={serverT(lang, "admin.menu_costing.shop_switcher")} className="flex flex-wrap gap-2">
      {shops.map(shop => <Link key={shop.id} href={`/admin/sandwiches?location=${encodeURIComponent(shop.id)}`}
        aria-current={scope === shop.id ? "page" : undefined}
        className={`inline-flex min-h-[44px] max-w-full items-center break-words rounded-lg border-2 px-4 py-2 text-sm font-bold ${scope === shop.id ? "border-co-gold-deep bg-co-surface-2" : "border-co-border bg-co-surface"}`}>
        {shop.name}
      </Link>)}
    </nav>
    {scope && view ? <>
      {canEditShop && <Link href={newSandwichJobHref(scope)} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-4 text-sm font-bold">
        {serverT(lang, "catalog.jobs.sandwich.title")}
      </Link>}
      <ExportLinks family="costing" language={lang} query={{ location: scope }}
        caption={serverT(lang, "admin.menu_costing.export_scope", { scope: shops.find(shop => shop.id === scope)?.name ?? "" })} />
      <SandwichesClient key={scope} view={view} scope={scope} canEditShop={canEditShop} canOpenSkuItem={catalogWriteRoleAllowed(auth.user.role, getRoleLevel(auth.user.role))} />
    </> : <p>{serverT(lang, "admin.pars.no_location")}</p>}
  </div>;
}

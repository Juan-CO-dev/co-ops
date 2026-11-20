import Link from "next/link";
import { notFound } from "next/navigation";
import { DemandSignalsClient } from "@/components/admin/demand-signals/DemandSignalsClient";
import { canViewDemandSignals, demandSignalShops } from "@/lib/demand-signals/access-shared";
import { demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import { loadSignalsPage } from "@/lib/demand-signals/signals-page";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShop } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * Item 4 PR 5: the demand signals page. A READ a manager plans by: the next two weeks day by day (the forecast
 * we hold and the events in force), the events entered by hand (GM+ may add, correct and take back their own
 * shop's), and how fresh each feed is. It changes no order, no par and no schedule.
 * DARK behind DEMAND_SIGNALS: unset, the page does not exist (404) and reads nothing. Who: a GM for their own
 * shops, MoO / Owner / CGS for any; everyone else 404 (by trusted role, never a level).
 */
export default async function DemandSignalsPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/demand-signals");
  if (!canViewDemandSignals(auth.role) || !demandSignalsEnabled(process.env.DEMAND_SIGNALS)) notFound();
  const language = auth.user.language;
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  const shops = demandSignalShops(auth.role, auth.locations, (data ?? []) as { id: string; name: string }[]);
  if (shops.length === 0) notFound();
  const sp = await searchParams;
  const shop = await resolveShop(shops, shopParamFor("/admin/demand-signals", searchParamValues(sp)));
  if (!shop) notFound();
  const page = await loadSignalsPage(sb, { actor: { role: auth.role, locations: auth.locations }, shop, nowIso: new Date().toISOString() });
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "signals.title")}</h1>
    <p className="text-co-text-muted">{serverT(language, "signals.intro")}</p>
    {shops.length > 1 && <nav aria-label={serverT(language, "signals.shop_picker")} className="flex flex-wrap gap-2">{shops.map((s) =>
      <Link key={s.id} href={`/admin/demand-signals?location=${s.id}`} aria-current={s.id === shop.id ? "page" : undefined}
        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{s.name}</Link>)}</nav>}
    {page.state === "unavailable" && <p className="co-card p-4 text-co-text-muted">{serverT(language, "signals.state.unavailable")}</p>}
    {page.state === "unreadable" && <p role="alert" className="co-card p-4 font-bold text-co-cta-text">{serverT(language, "signals.state.unreadable")}</p>}
    {page.state === "ok" && <DemandSignalsClient key={shop.id} data={page} />}
  </div>;
}

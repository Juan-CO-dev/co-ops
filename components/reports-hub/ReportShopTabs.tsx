import Link from "next/link";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { reportNavigationHref } from "@/lib/report-navigation";
import { getServiceRoleClient } from "@/lib/supabase-server";

export interface ReportShopTabsProps {
  path: string;
  params: Record<string, string | undefined>;
  locationId: string;
  language: Language;
  viewer: { level: number; locations: string[] };
  supportsAll?: boolean;
  allowedLocationIds?: string[];
}

export async function ReportShopTabs(props: ReportShopTabsProps) {
  let query = getServiceRoleClient().from("locations").select("id,name").eq("active", true).order("name");
  if (props.viewer.level < REPORT_ALL_LOCATIONS_LEVEL) query = query.in("id", props.viewer.locations);
  if (props.allowedLocationIds) {
    if (!props.allowedLocationIds.length) return null;
    query = query.in("id", props.allowedLocationIds);
  }
  const { data, error } = await query;
  if (error) throw new Error(`report locations: ${error.message}`);
  return <ReportShopTabLinks {...props} shops={data ?? []} />;
}

export function ReportShopTabLinks({ path, params, locationId, language, viewer, supportsAll = true, allowedLocationIds, shops }: ReportShopTabsProps & { shops: Array<{ id: string; name: string }> }) {
  const visible = shops.filter(shop => (!allowedLocationIds || allowedLocationIds.includes(shop.id)) && (viewer.level >= REPORT_ALL_LOCATIONS_LEVEL || viewer.locations.includes(shop.id)));
  const tabs = [...visible, ...(supportsAll && viewer.level >= REPORT_ALL_LOCATIONS_LEVEL ? [{ id: "all", name: serverT(language, "reports.hub.all") }] : [])];
  return <nav className="mb-4 flex flex-wrap gap-2" aria-label={serverT(language, "dashboard.location.switcher_aria")}>
    {tabs.map(shop => <Link key={shop.id} href={reportNavigationHref(path, params, shop.id)} aria-current={shop.id === locationId ? "page" : undefined}
      className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition ${shop.id === locationId ? "border-co-text bg-co-gold text-co-text" : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text"}`}>{shop.name}</Link>)}
  </nav>;
}

/**
 * /admin/skus (Item/Inventory Spine — vendor mini-arc, Slice C1) — the global
 * SKU catalog. Lists ALL SKUs with a vendor filter + (GM+) add / edit / reassign
 * / deactivate.
 *
 * Server component: gate ≥6 (mirrors app/admin/vendors/page.tsx). The admin
 * shell (auth boundary, role floor ≥6, providers) lives in app/admin/layout.tsx;
 * this page re-gates ≥6 defensively per the C.39 pattern. Loads all SKUs +
 * active vendors (for filter + assign dropdown) + active locations.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadSkus, loadPackFormats, loadMeasureUnits } from "@/lib/admin/skus";
import { loadVendors } from "@/lib/admin/vendors";
import { loadCurrentSkuPrices, computeSkuCostPerOz, loadSkuUsageMap, loadSkuReceivingLedger } from "@/lib/admin/cost";
import { SkuCatalogClient } from "@/components/admin/skus/SkuCatalogClient";

export default async function AdminSkusPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < 6) redirect("/dashboard");
  const lang = auth.user.language;

  const sb = getServiceRoleClient();
  const [skus, vendors, packFormats, measureUnits, locRes] = await Promise.all([
    loadSkus(auth),
    loadVendors(auth),
    loadPackFormats(auth),
    loadMeasureUnits(auth),
    sb.from("locations").select("id, name").eq("active", true).order("name"),
  ]);

  const activeVendors = vendors
    .filter((v) => v.active)
    .map((v) => ({ id: v.id, name: v.name }));
  const locations = (locRes.data ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
  }));

  const prices = await loadCurrentSkuPrices(skus.map((s) => s.id));
  const costPerOz = computeSkuCostPerOz(skus, prices, measureUnits);
  const usage = await loadSkuUsageMap();
  const skuCost: Record<string, { currentPrice: number | null; costPerOz: number | null; usedBy: string[] }> =
    Object.fromEntries(skus.map((s) => [s.id, { currentPrice: prices.get(s.id) ?? null, costPerOz: costPerOz.get(s.id) ?? null, usedBy: usage.get(s.id) ?? [] }]));
  const ledgerMap = await loadSkuReceivingLedger(auth, skus.map((s) => s.id));
  const skuLedger: Record<string, import("@/lib/admin/cost").SkuReceivingLedger> = Object.fromEntries([...ledgerMap.entries()]);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.skus.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.skus.subtitle")}</p>
      <SkuCatalogClient
        skus={skus}
        vendors={activeVendors}
        locations={locations}
        packFormats={packFormats}
        measureUnits={measureUnits}
        skuCost={skuCost}
        skuLedger={skuLedger}
        actorLevel={level}
        canManage={level >= 7}
      />
    </div>
  );
}

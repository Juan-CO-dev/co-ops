/**
 * /admin/vendors/[id] (Vendor Directory v2, Slice A) — vendor detail editor.
 *
 * Server gate ≥6 (mirrors the list page); notFound() if the vendor is missing.
 * Loads the vendor + categories server-side and hands them to the client editor,
 * which renders core/notes/contacts/ordering cards gated per the actor's level
 * (MoO+ core+active, GM+ notes+edit/remove contacts&ordering, AGM+ append).
 */

import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getVendor, loadCategories, loadOrderTypes } from "@/lib/admin/vendors";
import { loadSkus, loadPackFormats, loadMeasureUnits } from "@/lib/admin/skus";
import { loadCurrentSkuPrices, computeSkuCostPerOz, loadSkuUsageMap, loadSkuReceivingLedger, loadSkuConsumption, type SkuConsumption } from "@/lib/admin/cost";
import { skuPackComplete, skuReadiness, type Readiness } from "@/lib/readiness";
import { loadSkuPackChains } from "@/lib/prep-consumption";
import { buildPackChain, isChainUnverified, type PackChainLevel } from "@/lib/pack-chain-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { VendorDetailClient } from "@/components/admin/vendors/VendorDetailClient";

export default async function AdminVendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  const level = ROLES[auth.user.role].level;

  const sb = getServiceRoleClient();
  const [vendor, categories, orderTypes, skus, packFormats, measureUnits, locRes] =
    await Promise.all([
      getVendor(auth, id),
      loadCategories(auth),
      loadOrderTypes(auth),
      loadSkus(auth, { vendorId: id }),
      loadPackFormats(auth),
      loadMeasureUnits(auth),
      sb.from("locations").select("id, name").eq("active", true).order("name"),
    ]);
  if (!vendor) notFound();
  const skuLocations = (locRes.data ?? []).map((r) => ({
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
  const consumptionMap = await loadSkuConsumption(auth, skus.map((s) => s.id));
  const skuConsumption: Record<string, SkuConsumption> = Object.fromEntries([...consumptionMap.entries()]);

  // ── Pack chains (batch, ONE query — loadRecipeGraph law) so VendorSkusCard's
  //    SkuBuilder (PR-C) seeds Section B without a lazy GET + shows the class-aware
  //    "unverified" badge, AND skuPackComplete is chain-aware. Mirrors
  //    app/admin/skus/page.tsx. ──
  const chainMap = await loadSkuPackChains(skus.map((s) => s.id));
  const measuresByLabel = new Map<string, MeasureUnitFactor>(
    measureUnits.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }]),
  );
  const chainsBySku: Record<string, PackChainLevel[]> = {};
  const chainUnverifiedBySku: Record<string, boolean> = {};
  for (const [skuId, levels] of chainMap.entries()) {
    if (levels.length === 0) continue;
    chainsBySku[skuId] = levels;
    const s = skus.find((x) => x.id === skuId);
    const unverified = isChainUnverified(
      buildPackChain(levels), measuresByLabel, s?.avgOzPerEach ?? null, s?.skuClass ?? "raw",
    );
    if (unverified) chainUnverifiedBySku[skuId] = true;
  }

  const skuReadinessMap: Record<string, Readiness> = {};
  for (const s of skus) {
    const r = skuReadiness({
      active: s.active,
      packComplete: skuPackComplete(s, chainMap.get(s.id) ?? null, measuresByLabel, s.skuClass),
      hasPrice: prices.has(s.id),
      deliveryCount: ledgerMap.get(s.id)?.deliveries.length ?? 0,
    });
    if (r && r.status !== "ready") skuReadinessMap[s.id] = r;
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{vendor.name}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.vendors.detail.subtitle")}</p>
      <VendorDetailClient
        vendor={vendor}
        categories={categories}
        orderTypes={orderTypes}
        skus={skus}
        skuLocations={skuLocations}
        skuPackFormats={packFormats}
        skuMeasureUnits={measureUnits}
        skuCost={skuCost}
        skuLedger={skuLedger}
        skuConsumption={skuConsumption}
        skuReadiness={skuReadinessMap}
        skuChains={chainsBySku}
        skuChainUnverified={chainUnverifiedBySku}
        actorLevel={level}
      />
    </div>
  );
}

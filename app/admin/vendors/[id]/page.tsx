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
import { getVendor, loadCategories, loadOrderTypes, loadVendorCutoffs } from "@/lib/admin/vendors";
import { loadVendorRhythmPairs, loadVendorRhythmSkips, rhythmSchemaReady } from "@/lib/vendor-rhythm";
import { loadVendorOutstandingCredits } from "@/lib/credits";
import { formatCents } from "@/lib/i18n/format";
import { loadSkus, loadPackFormats, loadMeasureUnits, loadLocationSkuSettings } from "@/lib/admin/skus";
import { listProducts, ProductError, type ProductView } from "@/lib/products";
import { loadCurrentSkuPrices, computeSkuCostPerOz, loadSkuUsageMap, loadSkuReceivingLedger, loadSkuConsumption, type SkuConsumption } from "@/lib/admin/cost";
import { skuPackComplete, skuReadiness, type Readiness } from "@/lib/readiness";
import { loadSkuPackChains } from "@/lib/prep-consumption";
import { buildPackChain, isChainUnverified, type PackChainLevel } from "@/lib/pack-chain-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { VendorDetailClient } from "@/components/admin/vendors/VendorDetailClient";
import { PageHeader } from "@/components/ui/PageHeader";

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
  const [
    vendor,
    categories,
    orderTypes,
    skus,
    packFormats,
    measureUnits,
    locRes,
    outstandingCredits,
    cutoffs,
    // Dynamic Pars P1: the rhythm surface. All three degrade to empty/false while
    // migration 0182 (GATE M1) is unapplied — the probe never throws, so this page
    // renders identically before and after the gate.
    rhythmPairs,
    rhythmSkips,
    rhythmReady,
  ] = await Promise.all([
    getVendor(auth, id),
    loadCategories(auth),
    loadOrderTypes(auth),
    loadSkus(auth, { vendorId: id }),
    loadPackFormats(auth),
    loadMeasureUnits(auth),
    sb.from("locations").select("id, name").eq("active", true).order("name"),
    loadVendorOutstandingCredits(auth, id), // AGM+ (matches this page's ≥6 gate)
    loadVendorCutoffs(auth, id), // VO-7 cutoffs (AGM+)
    loadVendorRhythmPairs(id),
    loadVendorRhythmSkips(id),
    rhythmSchemaReady(sb),
  ]);
  if (!vendor) notFound();
  const skuLocations = (locRes.data ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
  }));

  // ── Pack chains (batch, ONE query — loadRecipeGraph law) so VendorSkusCard's
  //    SkuBuilder (PR-C) seeds Section B without a lazy GET + shows the class-aware
  //    "unverified" badge, skuPackComplete is chain-aware, AND $/oz rides the same
  //    oz resolution as the costing board (2026-08-21). Loaded HERE, above the cost
  //    derivation, because computeSkuCostPerOz now requires it. Mirrors
  //    app/admin/skus/page.tsx. ──
  const chainMap = await loadSkuPackChains(skus.map((s) => s.id));

  const prices = await loadCurrentSkuPrices(skus.map((s) => s.id));
  const costPerOz = computeSkuCostPerOz(skus, prices, measureUnits, chainMap);
  const usage = await loadSkuUsageMap();
  const skuCost: Record<string, { currentPrice: number | null; costPerOz: number | null; usedBy: string[] }> =
    Object.fromEntries(skus.map((s) => [s.id, { currentPrice: prices.get(s.id) ?? null, costPerOz: costPerOz.get(s.id) ?? null, usedBy: usage.get(s.id) ?? [] }]));
  const ledgerMap = await loadSkuReceivingLedger(auth, skus.map((s) => s.id));
  const skuLedger: Record<string, import("@/lib/admin/cost").SkuReceivingLedger> = Object.fromEntries([...ledgerMap.entries()]);
  const consumptionMap = await loadSkuConsumption(auth, skus.map((s) => s.id));
  const skuConsumption: Record<string, SkuConsumption> = Object.fromEntries([...consumptionMap.entries()]);

  // Per-location overlay rows (VO-7) so VendorSkusCard's SkuBuilder edit view seeds Section D.
  // Product registry (0179) — feeds the SKU form membership picker. Degrades to
  // "no products, no picker" until migration 0179 is applied (GATE M1), and
  // membership is read from the registry rather than from SKU_COLS.
  let productList: ProductView[] = [];
  try {
    productList = await listProducts(auth);
  } catch (e) {
    if (!(e instanceof ProductError && e.code === "products_schema_pending")) throw e;
  }
  const products = productList.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  const productIdBySku: Record<string, string> = {};
  for (const p of productList) {
    for (const m of p.members) productIdBySku[m.skuId] = p.id;
  }

  const overlayMap = await loadLocationSkuSettings(auth, skus.map((s) => s.id));
  const overlaysBySku: Record<string, import("@/components/admin/skus/SkuLocationOverlay").LocationSkuOverlayView[]> =
    Object.fromEntries([...overlayMap.entries()]);

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
      <PageHeader
        title={vendor.name}
        subtitle={serverT(lang, "admin.vendors.detail.subtitle")}
      />
      {/* Outstanding vendor credits (spec D3) — visible before the next order.
          Rendered only when there are open credits; a null total shows a dash
          (money law: never a false $0.00). */}
      {outstandingCredits ? (
        <p className="mt-3 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2 text-sm text-co-text">
          {serverT(lang, "admin.vendors.credits.outstanding", {
            amount: outstandingCredits.totalCents != null ? formatCents(outstandingCredits.totalCents, lang) : "—",
            n: outstandingCredits.deliveriesCount,
          })}
        </p>
      ) : null}
      <VendorDetailClient
        vendor={vendor}
        categories={categories}
        orderTypes={orderTypes}
        cutoffs={cutoffs}
        rhythmPairs={rhythmPairs}
        rhythmSkips={rhythmSkips}
        rhythmSchemaReady={rhythmReady}
        locations={skuLocations}
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
        skuOverlays={overlaysBySku}
        skuProducts={products}
        skuProductIdBySku={productIdBySku}
        actorLevel={level}
      />
    </div>
  );
}

import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuAttributionsForItem } from "@/lib/prep-consumption-graph";
import { selectSalesDepletion } from "@/lib/depletion-shared";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { deriveCapturedSalesConsumption } from "@/lib/catering/toast-sales";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { loadSalesCoverageDisclosure, type EffectiveSalesWindow, type EffectiveSalesRow } from "@/lib/toast/effective-depletion";
import { itemIdentity, probeItemMap, shadowAmounts, type ItemIdentity, type ProductionEvidence, type ToastMap, type TransferEvidence } from "./pass2-shared";
import { packageShadowAmounts } from "./shadow-package";
import type { DepletionLink } from "./depletion-shared";

type Client = ReturnType<typeof getServiceRoleClient>;
export interface ReconciledWindow { locationId?: string; fromDate: string; untilDateExclusive?: string | null; skuIds?: string[] }
type Order = { id: string; snapshot_id: string; lead_id: string; location_id: string; event_date: string; status: string | null };
type Decision = Omit<ToastMap, "toast_item_name"> & { location_id: string; identity_key: string; status: string; evidence: string | null };

/** PASS 3 reads live source snapshots and live prep evidence, never the shadow
 * ledger or pre-flag Toast aggregates. Explicit entry point also powers OFF shadow comparisons. */
export async function loadReconciledSalesWindow(sb: Client, window: ReconciledWindow,
  options: { includeEzcater?: boolean } = {}): Promise<EffectiveSalesWindow> {
  const end = window.untilDateExclusive ?? etCalendarDate(new Date().toISOString());
  const graph = await loadRecipeGraph();
  const readOrders = () => selectAllRows<Order>((from, to) => sb.from("ezcater_orders")
    .select("id,snapshot_id,lead_id,location_id,event_date,status").not("snapshot_id", "is", null).not("lead_id", "is", null)
    .gte("event_date", window.fromDate).lt("event_date", end).order("id").range(from, to));
  const readLinks = () => selectAllRows<DepletionLink & { location_id: string; business_date: string }>((from, to) => {
    let q = sb.from("ezcater_current_toast_links").select("location_id,business_date,toast_snapshot_id,toast_order_guid,check_guid")
      .gte("business_date", window.fromDate).lt("business_date", end);
    if (window.locationId) q = q.eq("location_id", window.locationId);
    return q.order("location_id").order("business_date").order("toast_snapshot_id").order("check_guid").range(from, to);
  });
  const readLeads = () => selectAllRows<{ id: string; location_id: string; stage: string }>((from, to) => sb.from("catering_pipeline")
    .select("id,location_id,stage").eq("lead_source", "ezcater").order("id").range(from, to));
  const [orders, links, leads, productions, transfers, locations] = await Promise.all([
    readOrders(), readLinks(), readLeads(),
    selectAllRows<ProductionEvidence>((from, to) => sb.from("productions").select("location_id,output_item_id,produced_at")
      .is("revoked_at", null).is("superseded_at", null).gte("produced_at", `${etYmdMinusDays(window.fromDate, 2)}T00:00:00Z`)
      .lt("produced_at", `${etYmdMinusDays(end, -1)}T00:00:00Z`).order("id").range(from, to)),
    selectAllRows<TransferEvidence & { resource_id: string }>((from, to) => sb.from("audit_log").select("resource_id,occurred_at,metadata")
      .eq("resource_table", "catering_pipeline").in("action", ["catering.pipeline.transfer_location", "ezcater.location_reassigned"])
      .gte("occurred_at", `${etYmdMinusDays(window.fromDate, 1)}T00:00:00Z`).order("id").range(from, to)),
    selectAllRows<{ id: string }>((from, to) => sb.from("locations").select("id").eq("active", true)
      .not("toast_restaurant_guid", "is", null).order("id").range(from, to)),
  ]);
  const actualTransfers = transfers.filter((row) => !["manual_location_kept", "manual_location_conflict"].includes(row.metadata?.result ?? ""));
  if (actualTransfers.some((row) => !row.metadata?.from_location_id || !row.metadata?.to_location_id)) {
    throw new Error("ezcater_transfer_evidence_incomplete");
  }
  const byLead = new Map(leads.map((lead) => [lead.id, lead]));
  const rows: EffectiveSalesRow[] = [];
  const unresolvedDays = new Set<string>();
  const manifests: Parameters<typeof loadSalesCoverageDisclosure>[2] = [];
  const locationIds = window.locationId ? [window.locationId] : [...new Set([...locations.map((r) => r.id), ...leads.map((r) => r.location_id)])];
  // Source-day loader performs its own generation fence. Derive afresh so a late
  // link removes all of a check's base selections AND modifiers immediately.
  for (const locationId of locationIds) {
    for (let date = window.fromDate; date < end; date = etYmdMinusDays(date, -1)) {
      const day = await loadCapturedToastDay(locationId, date);
      if (!day) continue;
      const consumption = await deriveCapturedSalesConsumption(locationId, date, day,
        links.filter((link) => link.location_id === locationId && link.business_date === date));
      const produced = new Set(productions.filter((p) => p.location_id === locationId && etCalendarDate(p.produced_at) === date).map((p) => p.output_item_id));
      const attributed = consumption.prepConsumed.flatMap((item) => perUnitSkuAttributionsForItem(graph, item.itemId)
        .map((row) => ({ ...row, itemId: item.itemId, oz: row.oz * item.units })));
      const selected = selectSalesDepletion(consumption.skuConsumed, attributed, produced);
      for (const [sku_id, direct_oz] of selected) rows.push({ location_id: locationId, business_date: date, sku_id, direct_oz,
        flattened_oz: consumption.skuConsumed.find((r) => r.skuId === sku_id)?.flattenedOz ?? 0 });
      const degraded = consumption.configDegraded || consumption.missingPointerCount > 0 ||
        !!consumption.unmappedToastItems.length || !!consumption.packageIssues.length ||
        !!consumption.modifierStats.portionNeeded.length || !!consumption.diagnostics?.poisoned_recipes.length;
      manifests.push({ location_id: locationId, business_date: date, run_id: consumption.captureRunId,
        status: degraded ? "degraded" : "success", computed_at: day.coverage.finishedAt, aggregate_count: 0, attribution_count: 0,
        suspect_check_count: consumption.suspectedCatering.length, suspect_qty: 0, counted_qty: 0 });
    }
  }
  if (options.includeEzcater !== false) {
    const [maps, decisions] = await Promise.all([
      selectAllRows<ToastMap & { location_id: string }>((from, to) => sb.from("toast_menu_map")
        .select("id,location_id,toast_item_guid,toast_item_name,item_id,menu_item_id,package_id").eq("active", true)
        .eq("match_status", "confirmed").eq("is_modifier", false).eq("disposition", "deplete").order("id").range(from, to)),
      selectAllRows<Decision>((from, to) => sb.from("ezcater_item_map")
        .select("location_id,identity_key,status,evidence,toast_item_guid,item_id,menu_item_id,package_id")
        .order("location_id").order("identity_key").range(from, to)),
    ]);
    for (const order of orders) {
      const lead = byLead.get(order.lead_id);
      if (!lead || lead.stage === "lost" || /cancel|reject|fail/i.test(order.status ?? "")) continue;
      const locationId = lead.location_id;
      if (window.locationId && locationId !== window.locationId) continue;
      const items = await selectAllRows<ItemIdentity & { quantity: number; ordinal: number }>((from, to) => sb.from("ezcater_order_items")
        .select("ordinal,provider_item_uuid,menu_item_size_id,pos_item_id,name,quantity,options")
        .eq("order_id", order.id).eq("snapshot_id", order.snapshot_id).eq("is_current", true).order("ordinal").range(from, to));
      const unresolved = () => unresolvedDays.add(`${locationId}:${order.event_date}`);
      if (!items.length) unresolved();
      for (const item of items) {
        const identity = itemIdentity(item);
        if (!identity) { unresolved(); continue; }
        const decision = decisions.find((d) => d.location_id === locationId && d.identity_key === identity);
        if (decision?.status === "ignored") continue;
        const probe = probeItemMap(item, maps.filter((m) => m.location_id === locationId));
        const target = decision?.status === "confirmed" ? decision : (item.options?.length ? null : probe.confirmed);
        if (!target) { unresolved(); continue; }
        if (item.options?.length && decision?.evidence !== "reviewed" && decision?.evidence !== "reviewed_direct") { unresolved(); continue; }
        const evidence = actualTransfers.filter((t) => t.resource_id === order.lead_id);
        const amounts = target.package_id
          ? await packageShadowAmounts(sb, graph, target.package_id, Number(item.quantity), locationId, order.event_date, productions, evidence, new AbortController().signal)
          : shadowAmounts(graph, target, Number(item.quantity), locationId, order.event_date, productions, evidence);
        if (!amounts.length && Number(item.quantity) > 0) unresolved();
        for (const amount of amounts) rows.push({ location_id: locationId, business_date: order.event_date, sku_id: amount.sku_id,
          direct_oz: amount.shadow_oz, flattened_oz: amount.flattened_oz });
      }
    }
  }
  // A concurrent provider refresh, transfer or reconciliation must not create a
  // mixed source total. Let the caller retry the entire read.
  const [afterOrders, afterLinks, afterLeads] = await Promise.all([readOrders(), readLinks(), readLeads()]);
  if (JSON.stringify([orders, links, leads]) !== JSON.stringify([afterOrders, afterLinks, afterLeads])) throw new Error("ezcater_depletion_read_changed");
  const merged = new Map<string, EffectiveSalesRow>();
  for (const row of rows) {
    if (window.skuIds && !window.skuIds.includes(row.sku_id)) continue;
    const key = `${row.location_id}:${row.business_date}:${row.sku_id}`, previous = merged.get(key);
    if (previous) { previous.direct_oz += row.direct_oz; previous.flattened_oz += row.flattened_oz; }
    else merged.set(key, { ...row });
  }
  for (const manifest of manifests) if (unresolvedDays.has(`${manifest.location_id}:${manifest.business_date}`)) manifest.status = "degraded";
  const coverage = await loadSalesCoverageDisclosure(sb, { ...window, untilDateExclusive: end }, manifests, true);
  for (const key of unresolvedDays) {
    const [locationId, date] = key.split(":");
    const disclosure = coverage.byLocation[locationId!];
    if (disclosure) {
      disclosure.degraded = true;
      if (!disclosure.degradedDates.includes(date!)) disclosure.degradedDates.push(date!);
    }
    coverage.degraded = true;
  }
  return { rows: [...merged.values()], coverage };
}

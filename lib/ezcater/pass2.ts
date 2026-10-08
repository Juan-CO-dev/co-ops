import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { loadEffectiveSalesRows } from "@/lib/toast/effective-depletion";
import { etYmdMinusDays } from "@/lib/operational-day";
import { captureBudget } from "@/lib/toast/capture-runner";
import { loadKnownToastOrderCodes, toastCodeSelectionKey } from "./toast-codes";
import { packageShadowAmounts } from "./shadow-package";
import { itemIdentity, matchSelection, orderCodeTokens, probeItemMap, shadowAmounts,
  type ItemIdentity, type LinkOrder, type LinkSelection, type ProductionEvidence, type ToastMap, type TransferEvidence } from "./pass2-shared";

type Order = LinkOrder & { snapshot_id: string; lead_id: string; status: string | null };
type Item = ItemIdentity & { ordinal: number; quantity: number; options: unknown[] };
type Review = { source: "ezcater" | "toast"; code: string; identity_key: string; candidates: string[] };

/** Only this SHADOW writer runs after capture. No operational depletion call consumes its tables. */
export async function materializeEzcaterShadow(fromDate: string, toDate: string, deadlineAt = Date.now() + 20_000) {
  if (deadlineAt <= Date.now()) return { processed: 0, failed: 0, deferred: true };
  const budget = captureBudget(deadlineAt - Date.now());
  try { return await budget.wait(() => materialize(fromDate, toDate, deadlineAt, budget.signal)); }
  finally { budget.close(); }
}
async function materialize(fromDate: string, toDate: string, deadlineAt: number, signal: AbortSignal) {
  const sb = getServiceRoleClient();
  // Explicit deploy skew result, before any graph/provider work. Other errors
  // remain failures, never a fabricated empty map or successful zero depletion.
  const schema = await sb.from("ezcater_item_map").select("identity_key").range(0, 0).abortSignal(signal);
  if (schema.error) {
    if (["42P01", "42703", "PGRST205", "PGRST204"].includes(schema.error.code)) {
      return { processed: 0, failed: 0, deferred: false, skipped: "ezcater_schema_missing" };
    }
    throw new Error("ezcater_shadow_schema_unavailable");
  }
  // Include neighbours in candidate universe, otherwise a window edge fabricates uniqueness.
  const orders = await selectAllRows<Order>((from, to) => sb.from("ezcater_orders")
    .select("id,location_id,event_date,order_number,snapshot_id,lead_id,status")
    .not("snapshot_id", "is", null).not("lead_id", "is", null)
    .gte("event_date", etYmdMinusDays(fromDate, 2)).lte("event_date", etYmdMinusDays(toDate, -2))
    .order("id").range(from, to).abortSignal(signal));
  const leads = await selectAllRows<{ id: string; location_id: string; stage: string }>((from, to) => sb.from("catering_pipeline")
    .select("id,location_id,stage").eq("lead_source", "ezcater").order("id").range(from, to).abortSignal(signal));
  const byLead = new Map(leads.map((l) => [l.id, l]));
  // Manual assignment wins even while provider caterer differs.
  for (const order of orders) order.location_id = byLead.get(order.lead_id)?.location_id ?? order.location_id;
  const targets = orders.filter((o) => o.event_date! >= fromDate && o.event_date! <= toDate);
  if (!targets.length) return { processed: 0, failed: 0, deferred: false };
  const graph = await loadRecipeGraph();
  const maps = await selectAllRows<ToastMap & { location_id: string }>((from, to) => sb.from("toast_menu_map")
    .select("id,location_id,toast_item_guid,toast_item_name,item_id,menu_item_id,package_id").eq("active", true).eq("match_status", "confirmed").eq("is_modifier", false).eq("disposition", "deplete")
    .order("id").range(from, to).abortSignal(signal));
  const decisions = await selectAllRows<{ location_id: string; identity_key: string; status: string; toast_map_id: string | null }>((from, to) => sb.from("ezcater_item_map")
    .select("location_id,identity_key,status,toast_map_id").order("location_id").order("identity_key").range(from, to).abortSignal(signal));
  // Read failures abort the run: enabling PASS 3 cannot bypass old-shop evidence.
  const transferAudit = await selectAllRows<TransferEvidence & { resource_id: string }>((from, to) => sb.from("audit_log")
    .select("resource_id,occurred_at,metadata").eq("resource_table", "catering_pipeline")
    .in("action", ["catering.pipeline.transfer_location", "ezcater.location_reassigned"])
    .gte("occurred_at", `${etYmdMinusDays(fromDate, 1)}T00:00:00Z`).order("id").range(from, to).abortSignal(signal));
  // The observation shares an audit action with provider transfers but moved
  // nothing. Do not invent a transfer or fail the gate for its intentional shape.
  const transfers = transferAudit.filter((t) => !["manual_location_kept", "manual_location_conflict"].includes(t.metadata?.result ?? ""));
  // An enabled future depletion lane must refuse incomplete late-transfer audit
  // evidence. The cross-shop check below runs in shadow too, before graduation.
  if (process.env.EZCATER_DEPLETION_ENABLED === "1" && transfers.some((t) =>
    !t.metadata?.from_location_id || !t.metadata?.to_location_id)) throw new Error("ezcater_transfer_evidence_incomplete");
  const locations = await selectAllRows<{ id: string; toast_restaurant_guid: string | null }>((from, to) => sb.from("locations")
    .select("id,toast_restaurant_guid").eq("active", true).order("id").range(from, to).abortSignal(signal));
  const productions = await selectAllRows<ProductionEvidence>((from, to) => sb.from("productions")
    .select("location_id,output_item_id,produced_at").is("revoked_at", null).is("superseded_at", null)
    // Broad UTC boundary, then exact ET calendar filter in shadowAmounts (DST safe).
    .gte("produced_at", `${etYmdMinusDays(fromDate, 2)}T00:00:00Z`).lt("produced_at", `${etYmdMinusDays(toDate, -2)}T00:00:00Z`)
    .order("id").range(from, to).abortSignal(signal));
  const toastLeads = await selectAllRows<{ order_guid: string; lead_id: string | null; location_id: string }>((from, to) => sb.from("toast_catering_orders")
    .select("order_guid,lead_id,location_id").not("lead_id", "is", null).eq("voided", false)
    .gte("business_date", etYmdMinusDays(fromDate, 1)).lte("business_date", etYmdMinusDays(toDate, -1))
    .order("id").range(from, to).abortSignal(signal));
  const dayCache = new Map<string, Awaited<ReturnType<typeof loadCapturedToastDay>>>();
  const codeCache = new Map<string, Map<string, string[]>>();
  const baseline = await loadEffectiveSalesRows(sb, { fromDate, untilDateExclusive: etYmdMinusDays(toDate, -1) });
  let processed = 0, failed = 0;
  for (const order of targets) {
    if (Date.now() >= deadlineAt || signal.aborted) break;
    try {
      const reviews: Review[] = [];
      const links: Array<LinkSelection & { toast_snapshot_id: string }> = [];
      const active = byLead.get(order.lead_id)?.stage !== "lost" && !/cancel|reject|fail/i.test(order.status ?? "");
      let covered = true;
      for (const delta of [1, 0, -1]) {
        const date = etYmdMinusDays(order.event_date!, delta), key = `${order.location_id}:${date}`;
        if (!dayCache.has(key)) dayCache.set(key, await loadCapturedToastDay(order.location_id, date));
        const day = dayCache.get(key);
        if (!day) { covered = false; continue; }
        if (!codeCache.has(key)) {
          const restaurant = locations.find((l) => l.id === order.location_id)?.toast_restaurant_guid;
          const catering = day.orders.filter((r) => r.salesChannel?.toLowerCase() === "catering" && !r.voided && !r.deleted && !r.excessFood);
          codeCache.set(key, restaurant && catering.length ? await loadKnownToastOrderCodes(restaurant, date,
            orders.filter((o) => o.location_id === order.location_id && o.order_number).map((o) => o.order_number!),
            { deadlineAt, signal, expectedVersions: new Map(catering.map((r) => [r.orderGuid, r.modifiedAt])) }) : new Map());
        }
        for (const ring of day.orders) {
          if (ring.voided || ring.deleted || ring.excessFood) continue;
          for (const selection of ring.selections) {
            if (selection.voided || selection.deleted) continue;
            const candidate: LinkSelection = { location_id: order.location_id, business_date: date,
              order_guid: ring.orderGuid, snapshot_id: ring.snapshotId, check_guid: selection.check_guid,
              selection_guid: selection.selection_guid, codes: [selection.name, ...orderCodeTokens(selection.name),
                ...(codeCache.get(key)?.get(toastCodeSelectionKey(ring.orderGuid, selection.check_guid, selection.selection_guid)) ?? [])] };
            const match = matchSelection(candidate, orders);
            if (match.orderId === order.id && active) links.push({ ...candidate, toast_snapshot_id: ring.snapshotId });
            else if (active && match.reason !== "normalized_code" && match.candidates.includes(order.id)) reviews.push({ source: "toast", code: match.reason,
              identity_key: `${ring.orderGuid}:${selection.selection_guid}`, candidates: match.candidates });
          }
        }
      }
      if (active && !links.length) reviews.push({ source: "toast", code: covered ? "unmatched_code" : "capture_missing",
        identity_key: order.id, candidates: [] });
      for (const link of links) {
        const duplicate = toastLeads.find((t) => t.location_id === order.location_id && t.order_guid === link.order_guid && t.lead_id !== order.lead_id);
        if (duplicate?.lead_id) reviews.push({ source: "toast", code: "duplicate_lead", identity_key: duplicate.lead_id, candidates: [duplicate.lead_id] });
      }
      const items = await selectAllRows<Item>((from, to) => sb.from("ezcater_order_items")
        .select("ordinal,provider_item_uuid,menu_item_size_id,pos_item_id,name,quantity,options")
        .eq("order_id", order.id).eq("snapshot_id", order.snapshot_id).eq("is_current", true).order("ordinal").range(from, to).abortSignal(signal));
      const itemMaps: Array<Record<string, unknown>> = [];
      const shadow: Array<Record<string, unknown>> = [];
      for (const item of items) {
        const identity = itemIdentity(item);
        if (!identity) { reviews.push({ source: "ezcater", code: "missing_item_identity", identity_key: String(item.ordinal), candidates: [] }); continue; }
        const localMaps = maps.filter((m) => m.location_id === order.location_id);
        const decision = decisions.find((m) => m.location_id === order.location_id && m.identity_key === identity);
        if (decision?.status === "ignored") continue;
        const probe = probeItemMap(item, localMaps);
        // A base POS target cannot establish the meaning of selected options.
        if (item.options.length) { probe.confirmed = null; probe.evidence = null; }
        if (decision?.status === "confirmed" && decision.toast_map_id) {
          probe.confirmed = localMaps.find((m) => m.id === decision.toast_map_id) ?? null;
          probe.evidence = probe.confirmed ? "reviewed" : null;
        }
        itemMaps.push({ identity_key: identity, provider_item_uuid: item.provider_item_uuid, menu_item_size_id: item.menu_item_size_id,
          pos_item_id: item.pos_item_id?.trim() || null, toast_item_guid: probe.confirmed?.toast_item_guid ?? null,
          toast_map_id: probe.confirmed?.id ?? null, package_id: probe.confirmed?.package_id ?? null,
          item_id: probe.confirmed?.item_id ?? null, menu_item_id: probe.confirmed?.menu_item_id ?? null,
          status: probe.confirmed ? "confirmed" : "review", evidence: probe.evidence, candidates: probe.candidates });
        if (!probe.confirmed) { reviews.push({ source: "ezcater", code: probe.reason, identity_key: identity, candidates: probe.candidates }); continue; }
        if (item.options.length && probe.evidence !== "reviewed") {
          reviews.push({ source: "ezcater", code: "options_unmapped", identity_key: identity, candidates: [] });
          continue;
        }
        if (!active) continue;
        const evidence = transfers.filter((t) => t.resource_id === order.lead_id);
        const amounts = probe.confirmed.package_id
          ? await packageShadowAmounts(sb, graph, probe.confirmed.package_id, Number(item.quantity), order.location_id, order.event_date!, productions, evidence, signal)
          : shadowAmounts(graph, probe.confirmed, Number(item.quantity), order.location_id, order.event_date!, productions, evidence);
        if (!amounts.length && Number(item.quantity) > 0) reviews.push({ source: "ezcater", code: "recipe_unresolved", identity_key: identity, candidates: [] });
        for (const amount of amounts) {
          const current = baseline.find((r) => r.location_id === order.location_id && r.business_date === order.event_date && r.sku_id === amount.sku_id);
          shadow.push({ ...amount, ordinal: item.ordinal, current_day_sales_oz: current?.direct_oz ?? null });
        }
      }
      signal.throwIfAborted();
      const published = await sb.rpc("publish_ezcater_shadow", { p_order_id: order.id, p_snapshot_id: order.snapshot_id,
        p_location_id: order.location_id, p_payload: { links, maps: itemMaps, reviews, shadow } }).abortSignal(signal);
      if (published.error) throw new Error("ezcater_shadow_publish_failed");
      processed++;
    } catch { failed++; }
  }
  return { processed, failed, deferred: processed + failed < targets.length };
}

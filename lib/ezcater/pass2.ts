import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { loadEffectiveSalesRows } from "@/lib/toast/effective-depletion";
import { etYmdMinusDays } from "@/lib/operational-day";
import { captureBudget } from "@/lib/toast/capture-runner";
import { itemIdentity, matchSelection, orderCodeTokens, probeItemMap, shadowAmounts,
  type ItemIdentity, type LinkOrder, type LinkSelection, type ProductionEvidence, type ToastMap } from "./pass2-shared";

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
    .select("location_id,toast_item_guid,toast_item_name,item_id,menu_item_id").eq("active", true).eq("match_status", "confirmed")
    .order("id").range(from, to).abortSignal(signal));
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
        for (const ring of day.orders) {
          if (ring.voided || ring.deleted || ring.excessFood) continue;
          for (const selection of ring.selections) {
            if (selection.voided || selection.deleted) continue;
            const candidate: LinkSelection = { location_id: order.location_id, business_date: date,
              order_guid: ring.orderGuid, snapshot_id: ring.snapshotId, check_guid: selection.check_guid,
              selection_guid: selection.selection_guid, codes: [selection.name, ...(selection.ezcater_codes ?? []), ...orderCodeTokens(selection.name)] };
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
        const probe = probeItemMap(item, maps.filter((m) => m.location_id === order.location_id));
        itemMaps.push({ identity_key: identity, provider_item_uuid: item.provider_item_uuid, menu_item_size_id: item.menu_item_size_id,
          pos_item_id: item.pos_item_id, toast_item_guid: probe.confirmed?.toast_item_guid ?? null,
          item_id: probe.confirmed?.item_id ?? null, menu_item_id: probe.confirmed?.menu_item_id ?? null,
          status: probe.confirmed ? "confirmed" : "review", evidence: probe.evidence, candidates: probe.candidates });
        if (!probe.confirmed) { reviews.push({ source: "ezcater", code: probe.reason, identity_key: identity, candidates: probe.candidates }); continue; }
        if (item.options.length) reviews.push({ source: "ezcater", code: "options_unmapped", identity_key: identity, candidates: [] });
        if (!active) continue;
        const amounts = shadowAmounts(graph, probe.confirmed, Number(item.quantity), order.location_id, order.event_date!, productions);
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

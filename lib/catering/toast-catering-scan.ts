/**
 * Toast catering scan — SERVER-ONLY core (catering inbox A1.2). No operator actor.
 *
 * For each Toast-connected location and each business date asked for: pull `ordersBulk`, lift
 * order summaries (pure), classify against the location's catering dining options (the
 * `toast_ingest_exclusions` rows of kind dining_option) and Toast's own catering source, then:
 *   catering, unseen   → ledger row + lead at `confirmed` (paid at placement — spec A1.2),
 *                        assigned to the catering manager; external_ref "toast:<guid>".
 *   catering, seen     → refresh the ledger row when toast_modified_at changed; if the order is
 *                        now VOIDED and the lead is open → system move to `lost`.
 *   ezcater ring       → ledger row only (`attributed_to_ezcater`); the ezCater webhook owns it.
 *   not catering       → nothing.
 * Ledger-first; never throws per order (each order's outcome is its processing_result); a
 * per-location Toast/API failure is reported in the result, never thrown across locations.
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { toastGet, ToastApiError } from "@/lib/toast/client";
import { toastBusinessDate } from "@/lib/toast/orders";
import { fetchDiningOptionNames } from "@/lib/toast/config";
import { loadActiveExclusions } from "@/lib/catering/toast-sales";
import { classifyToastOrder, extractToastOrders, toastLeadFields, toastOrderNotes, type ToastOrderSummary } from "@/lib/toast/catering-orders-shared";
import { mergeMachineNotes } from "@/lib/catering/machine-notes-shared";
import { resolveCateringManager, systemMoveStage, type ExistingLead } from "@/lib/catering/system-intake";
import { isPipelineStage } from "@/lib/catering/pipeline";
import { canTransition } from "@/lib/catering/pipeline-shared";

const PAGE_SIZE = 100;
const ACTOR_CONTEXT = "toast_catering_scan";

export interface ScanLocationResult { locationId: string; ok: boolean; error?: string; seen: number; catering: number; ezcater: number; createdLeads: number; lostLeads: number; refreshed: number }

async function fetchOrders(restaurantGuid: string, ymd: string): Promise<ToastOrderSummary[]> {
  const bd = toastBusinessDate(ymd);
  const all: ToastOrderSummary[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const json = await toastGet<unknown>(`/orders/v2/ordersBulk?businessDate=${bd}&page=${page}&pageSize=${PAGE_SIZE}`, restaurantGuid);
    const rawCount = Array.isArray(json) ? json.length : -1;
    try { all.push(...extractToastOrders(json)); }
    catch (err) { throw new ToastApiError(502, "bad_payload", err instanceof Error ? err.message : "bad orders payload"); }
    if (rawCount < PAGE_SIZE) break;
  }
  return all;
}

type LedgerRow = { id: string; voided: boolean; toast_modified_at: string | null; lead_id: string | null; classification: string };

async function scanLocation(locationId: string, restaurantGuid: string, dates: string[]): Promise<ScanLocationResult> {
  const sb = getServiceRoleClient();
  const res: ScanLocationResult = { locationId, ok: true, seen: 0, catering: 0, ezcater: 0, createdLeads: 0, lostLeads: 0, refreshed: 0 };
  const names = await fetchDiningOptionNames(restaurantGuid);
  const exclusions = (await loadActiveExclusions()).filter((e) => e.kind === "dining_option" && (e.locationId == null || e.locationId === locationId));
  const cateringDiningOptions = exclusions.map((e) => e.value);
  const assignee = await resolveCateringManager(sb, locationId);

  for (const ymd of dates) {
    const orders = await fetchOrders(restaurantGuid, ymd);
    for (const o of orders) {
      res.seen += 1;
      const cls = classifyToastOrder(o, { diningOptionNames: names, cateringDiningOptions });
      if (cls === "not_catering") continue;
      const diningOptionName = o.diningOptionGuid ? names.get(o.diningOptionGuid) ?? null : null;
      const { data: existing, error: exErr } = await sb.from("toast_catering_orders")
        .select("id, voided, toast_modified_at, lead_id, classification").eq("order_guid", o.guid).maybeSingle<LedgerRow>();
      if (exErr) continue; // next run retries; nothing written
      const base = {
        location_id: locationId, order_guid: o.guid, business_date: o.businessDate, source: o.source, dining_option: diningOptionName,
        classification: cls, voided: o.voided, promised_at: o.promisedAt, toast_modified_at: o.modifiedAt,
        customer_name: o.customer?.name ?? null, customer_phone: o.customer?.phone ?? null, headcount: o.headcount,
        total_cents: o.totalCents, items: o.items, last_seen_at: new Date().toISOString(),
      };

      if (cls === "ezcater") {
        res.ezcater += 1;
        if (!existing) await sb.from("toast_catering_orders").insert({ ...base, processing_result: "attributed_to_ezcater" });
        else await sb.from("toast_catering_orders").update({ last_seen_at: base.last_seen_at, voided: o.voided, toast_modified_at: o.modifiedAt }).eq("id", existing.id);
        continue;
      }

      res.catering += 1;
      if (!existing) {
        // Ledger first, then the lead. A voided-at-first-sight order is ledgered, never a lead.
        const { data: ledger, error: lErr } = await sb.from("toast_catering_orders")
          .insert({ ...base, processing_result: o.voided ? "voided_before_seen" : "pending_lead" }).select("id").maybeSingle<{ id: string }>();
        if (lErr || !ledger || o.voided) continue;
        const fields = toastLeadFields(o, { diningOptionName });
        // `catering_pipeline` has no `is_delivery` column — it exists on the pure type for the
        // notes/tests only; drop it before the insert (see plan Task 5 note).
        const { is_delivery: _isDelivery, ...leadCols } = fields;
        const { data: lead, error: insErr } = await sb.from("catering_pipeline")
          .insert({ ...leadCols, location_id: locationId, assigned_to: assignee, created_by: null }).select("id").maybeSingle<{ id: string }>();
        if (insErr || !lead) {
          await sb.from("toast_catering_orders").update({ processing_result: insErr?.code === "23505" ? "duplicate_external_ref" : "error:lead_insert" }).eq("id", ledger.id);
          continue;
        }
        const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: null, to_stage: "confirmed", note: `Toast catering order ${o.guid} (scan)`, actor_id: null });
        void audit({ actorId: null, actorRole: null, action: "catering.pipeline.create", resourceTable: "catering_pipeline", resourceId: lead.id,
          metadata: { actor_context: ACTOR_CONTEXT, lead_source: "toast_catering", external_ref: fields.external_ref, location_id: locationId, stage: "confirmed", assigned_to: assignee, source: o.source, dining_option: diningOptionName }, ipAddress: null, userAgent: null });
        await sb.from("toast_catering_orders").update({ lead_id: lead.id, processing_result: evErr ? "created_lead_no_trail" : "created_lead" }).eq("id", ledger.id);
        res.createdLeads += 1;
        continue;
      }

      // Seen before. Unchanged → nothing. Changed → refresh ledger (+ lead fields); newly voided → lost.
      const changed = (existing.toast_modified_at ?? null) !== (o.modifiedAt ?? null) || existing.voided !== o.voided;
      if (!changed) { await sb.from("toast_catering_orders").update({ last_seen_at: base.last_seen_at }).eq("id", existing.id); continue; }
      await sb.from("toast_catering_orders").update({ ...base, processing_result: existing.lead_id ? "refreshed" : "refreshed_no_lead" }).eq("id", existing.id);
      res.refreshed += 1;
      if (!existing.lead_id) continue;
      const { data: leadRow } = await sb.from("catering_pipeline").select("id, stage, notes").eq("id", existing.lead_id).maybeSingle<{ id: string; stage: string; notes: string | null }>();
      if (!leadRow || !isPipelineStage(leadRow.stage)) continue;
      const lead: ExistingLead = { id: leadRow.id, stage: leadRow.stage };
      if (o.voided && !existing.voided) {
        if (canTransition(lead.stage, "lost")) {
          const outcome = await systemMoveStage(sb, lead, "lost", `Toast order ${o.guid} voided (scan)`, ACTOR_CONTEXT);
          await sb.from("toast_catering_orders").update({ processing_result: outcome === "moved" ? "voided_lead_lost" : `voided_${outcome}` }).eq("id", existing.id);
          if (outcome === "moved") res.lostLeads += 1;
        } else {
          await sb.from("toast_catering_orders").update({ processing_result: "voided_illegal_transition" }).eq("id", existing.id);
        }
        continue;
      }
      // Fields refresh in place; human notes preserved through the marked block.
      const fields = toastLeadFields(o, { diningOptionName });
      await sb.from("catering_pipeline").update({
        headcount: fields.headcount, event_date: fields.event_date, time_window: fields.time_window,
        estimated_revenue_cents: fields.estimated_revenue_cents, delivery_address: fields.delivery_address,
        notes: mergeMachineNotes("Toast order", leadRow.notes, toastOrderNotes(o, diningOptionName)), updated_at: new Date().toISOString(),
      }).eq("id", lead.id);
      await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note: `Toast order ${o.guid} modified (scan)`, actor_id: null });
      void audit({ actorId: null, actorRole: null, action: "catering.pipeline.edit", resourceTable: "catering_pipeline", resourceId: lead.id,
        metadata: { actor_context: ACTOR_CONTEXT, reason: "toast_order_modified", fields: ["headcount", "event_date", "time_window", "estimated_revenue_cents", "delivery_address", "notes"] }, ipAddress: null, userAgent: null });
    }
  }
  return res;
}

/** Every Toast-connected active location, the given business dates (YYYY-MM-DD). Per-location failures are reported, never thrown. */
export async function scanToastCateringForAllLocations(dates: string[]): Promise<ScanLocationResult[]> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id, toast_restaurant_guid").eq("active", true)
    .not("toast_restaurant_guid", "is", null).returns<Array<{ id: string; toast_restaurant_guid: string }>>();
  if (error) throw new Error(`toast-catering-scan locations: ${error.message}`);
  const out: ScanLocationResult[] = [];
  for (const loc of data ?? []) {
    try { out.push(await scanLocation(loc.id, loc.toast_restaurant_guid, dates)); }
    catch (e) { out.push({ locationId: loc.id, ok: false, error: e instanceof Error ? e.message : String(e), seen: 0, catering: 0, ezcater: 0, createdLeads: 0, lostLeads: 0, refreshed: 0 }); }
  }
  return out;
}

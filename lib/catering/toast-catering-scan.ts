/**
 * Toast catering scan — SERVER-ONLY core (catering inbox A1.2). No operator actor.
 *
 * For each Toast-connected location and each business date asked for: pull `ordersBulk`, lift
 * order summaries (pure), classify against the location's catering dining options (the
 * `toast_ingest_exclusions` rows of kind dining_option) and Toast's own catering source, then:
 *   catering, unseen   → ledger row + lead at `confirmed` (paid at placement — spec A1.2),
 *                        assigned to the catering manager; external_ref "toast:<guid>".
 *   catering, seen     → refresh the ledger row when toast_modified_at/voided changed (compared
 *                        as instants, never as strings — see `toastOrderChanged`); if the order
 *                        is now VOIDED and the lead is open → system move to `lost`. A ledgered
 *                        catering order that still has no lead (a prior insert failed, or the
 *                        ledger predates lead creation) gets another shot at a lead every scan —
 *                        the stranded-ledger recovery.
 *   ezcater ring       → ledger row only (`attributed_to_ezcater`); the ezCater webhook owns it.
 *   third-party ring   → ledger row only (`attributed_to_third_party`); a real order on someone
 *                        else's platform, never ours to run as a lead.
 *   not catering       → nothing.
 * An order whose businessDate didn't parse is SKIPPED, never ledgered — `business_date` is
 * NOT NULL on the table and a guessed date would be a fabricated fact.
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
import { classifyToastOrder, extractToastOrders, toastLeadFields, toastOrderChanged, toastOrderNotes, type ToastOrderSummary } from "@/lib/toast/catering-orders-shared";
import { mergeMachineNotes } from "@/lib/catering/machine-notes-shared";
import { resolveCateringManager, systemMoveStage, type ExistingLead } from "@/lib/catering/system-intake";
import { isPipelineStage } from "@/lib/catering/pipeline";
import { canTransition } from "@/lib/catering/pipeline-shared";

const PAGE_SIZE = 100;
const ACTOR_CONTEXT = "toast_catering_scan";

export interface ScanLocationResult {
  locationId: string; ok: boolean; error?: string; seen: number; catering: number;
  /** ezcater ring + third-party ring orders, ledgered but never a lead. */
  attributed: number;
  createdLeads: number; lostLeads: number; refreshed: number; skipped: number; errors: number;
}

type ServiceClient = ReturnType<typeof getServiceRoleClient>;
type EnsureLeadOutcome = "created" | "adopted" | "duplicate" | "error";

/** Insert (or adopt) the pipeline lead for a catering order and link it to its ledger row.
 *  Never throws — every branch writes the ledger's processing_result and returns an outcome. */
async function ensureLead(
  sb: ServiceClient,
  o: ToastOrderSummary,
  locationId: string,
  diningOptionName: string | null,
  assignee: string | null,
  ledgerId: string,
): Promise<EnsureLeadOutcome> {
  const fields = toastLeadFields(o, { diningOptionName });
  const { data: lead, error: insErr } = await sb.from("catering_pipeline")
    .insert({ ...fields, location_id: locationId, assigned_to: assignee, created_by: null })
    .select("id").maybeSingle<{ id: string }>();

  if (insErr || !lead) {
    if (insErr?.code === "23505") {
      // Another pass (or a race) already created this lead. Adopt it rather than orphan the
      // ledger row — never a second lead for one Toast order.
      const { data: existingLead } = await sb.from("catering_pipeline")
        .select("id").eq("external_ref", fields.external_ref).maybeSingle<{ id: string }>();
      if (existingLead) {
        await sb.from("toast_catering_orders").update({ lead_id: existingLead.id, processing_result: "adopted_lead" }).eq("id", ledgerId);
        return "adopted";
      }
      await sb.from("toast_catering_orders").update({ processing_result: "duplicate_external_ref" }).eq("id", ledgerId);
      return "duplicate";
    }
    await sb.from("toast_catering_orders").update({ processing_result: "error:lead_insert" }).eq("id", ledgerId);
    return "error";
  }

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: null, to_stage: "confirmed", note: `Toast catering order ${o.guid} (scan)`, actor_id: null });
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.create", resourceTable: "catering_pipeline", resourceId: lead.id,
    metadata: { actor_context: ACTOR_CONTEXT, lead_source: "toast_catering", external_ref: fields.external_ref, location_id: locationId, stage: "confirmed", assigned_to: assignee, source: o.source, dining_option: diningOptionName }, ipAddress: null, userAgent: null });
  await sb.from("toast_catering_orders").update({ lead_id: lead.id, processing_result: evErr ? "created_lead_no_trail" : "created_lead" }).eq("id", ledgerId);
  return "created";
}

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

type LedgerRow = { id: string; voided: boolean; toast_modified_at: string | null; lead_id: string | null; processing_result: string };

function emptyResult(locationId: string, ok: boolean, error?: string): ScanLocationResult {
  return { locationId, ok, error, seen: 0, catering: 0, attributed: 0, createdLeads: 0, lostLeads: 0, refreshed: 0, skipped: 0, errors: 0 };
}

async function scanLocation(locationId: string, restaurantGuid: string, dates: string[]): Promise<ScanLocationResult> {
  const sb = getServiceRoleClient();
  const res = emptyResult(locationId, true);
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
      if (o.businessDate === null) { res.skipped += 1; continue; } // NOT NULL column; never guess the date
      const diningOptionName = o.diningOptionGuid ? names.get(o.diningOptionGuid) ?? null : null;
      const { data: existing, error: exErr } = await sb.from("toast_catering_orders")
        .select("id, voided, toast_modified_at, lead_id, processing_result").eq("order_guid", o.guid).maybeSingle<LedgerRow>();
      if (exErr) { res.errors += 1; continue; } // next run retries; nothing written
      const base = {
        location_id: locationId, order_guid: o.guid, business_date: o.businessDate, source: o.source, dining_option: diningOptionName,
        classification: cls, voided: o.voided, promised_at: o.promisedAt, toast_modified_at: o.modifiedAt,
        customer_name: o.customer?.name ?? null, customer_phone: o.customer?.phone ?? null, headcount: o.headcount,
        total_cents: o.totalCents, items: o.items, last_seen_at: new Date().toISOString(),
      };

      if (cls === "ezcater" || cls === "third_party") {
        res.attributed += 1;
        const processingResult = cls === "ezcater" ? "attributed_to_ezcater" : "attributed_to_third_party";
        if (!existing) {
          const { error: insErr } = await sb.from("toast_catering_orders").insert({ ...base, processing_result: processingResult });
          if (insErr) res.errors += 1;
        } else {
          const { error: updErr } = await sb.from("toast_catering_orders").update({ last_seen_at: base.last_seen_at, voided: o.voided, toast_modified_at: o.modifiedAt }).eq("id", existing.id);
          if (updErr) res.errors += 1;
        }
        continue;
      }

      res.catering += 1;
      if (!existing) {
        // Ledger first, then the lead. A voided-at-first-sight order is ledgered, never a lead.
        const { data: ledger, error: lErr } = await sb.from("toast_catering_orders")
          .insert({ ...base, processing_result: o.voided ? "voided_before_seen" : "pending_lead" }).select("id").maybeSingle<{ id: string }>();
        if (lErr) { res.errors += 1; continue; }
        if (!ledger || o.voided) continue;
        const outcome = await ensureLead(sb, o, locationId, diningOptionName, assignee, ledger.id);
        if (outcome === "created") res.createdLeads += 1;
        if (outcome === "error") res.errors += 1;
        continue;
      }

      // Seen before. Unchanged → touch last_seen_at. Changed → refresh ledger (+ lead fields);
      // newly voided → lost. Either way, a catering order stranded without a lead (a prior
      // insert failed, or the ledger predates lead creation) gets another shot every scan.
      const changed = toastOrderChanged({ modifiedAt: existing.toast_modified_at, voided: existing.voided }, { modifiedAt: o.modifiedAt, voided: o.voided });
      if (changed) {
        const { error: refreshErr } = await sb.from("toast_catering_orders").update({ ...base, processing_result: existing.lead_id ? "refreshed" : "refreshed_no_lead" }).eq("id", existing.id);
        if (refreshErr) { res.errors += 1; continue; }
        res.refreshed += 1;
      } else {
        const { error: touchErr } = await sb.from("toast_catering_orders").update({ last_seen_at: base.last_seen_at }).eq("id", existing.id);
        if (touchErr) { res.errors += 1; continue; }
      }

      if (!existing.lead_id && existing.processing_result !== "voided_before_seen" && !o.voided) {
        const outcome = await ensureLead(sb, o, locationId, diningOptionName, assignee, existing.id);
        if (outcome === "created") res.createdLeads += 1;
        if (outcome === "error") res.errors += 1;
      }

      if (!changed || !existing.lead_id) continue;

      const { data: leadRow, error: leadReadErr } = await sb.from("catering_pipeline").select("id, stage, notes").eq("id", existing.lead_id).maybeSingle<{ id: string; stage: string; notes: string | null }>();
      if (leadReadErr) { res.errors += 1; continue; }
      if (!leadRow || !isPipelineStage(leadRow.stage)) continue;
      const lead: ExistingLead = { id: leadRow.id, stage: leadRow.stage };
      if (o.voided && !existing.voided) {
        if (lead.stage === "out") {
          // Juan's ruling (2026-09-04): a void that lands after the order was marked OUT must
          // NOT move to `lost` — `lost` hides what actually happened (the food went out the
          // door). Leave the stage alone; flag it for a human to check for a comp/refund.
          const note = `Toast order ${o.guid} voided after it was marked out (scan) — needs review: comp/refund?${o.voidedAt ? ` (voidDate: ${o.voidedAt})` : ""}`;
          const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note, actor_id: null });
          const { error: updErr } = await sb.from("toast_catering_orders").update({ processing_result: "voided_after_out_needs_review" }).eq("id", existing.id);
          if (evErr || updErr) res.errors += 1;
        } else if (canTransition(lead.stage, "lost")) {
          const outcome = await systemMoveStage(sb, lead, "lost", `Toast order ${o.guid} voided (scan)`, ACTOR_CONTEXT);
          const { error: updErr } = await sb.from("toast_catering_orders").update({ processing_result: outcome === "moved" ? "voided_lead_lost" : `voided_${outcome}` }).eq("id", existing.id);
          if (updErr) res.errors += 1;
          if (outcome === "moved") res.lostLeads += 1;
        } else {
          const { error: updErr } = await sb.from("toast_catering_orders").update({ processing_result: "voided_illegal_transition" }).eq("id", existing.id);
          if (updErr) res.errors += 1;
        }
        continue;
      }
      // Fields refresh in place; human notes preserved through the marked block.
      const fields = toastLeadFields(o, { diningOptionName });
      const { error: leadUpdErr } = await sb.from("catering_pipeline").update({
        headcount: fields.headcount, event_date: fields.event_date, time_window: fields.time_window,
        estimated_revenue_cents: fields.estimated_revenue_cents, delivery_address: fields.delivery_address,
        notes: mergeMachineNotes("Toast order", leadRow.notes, toastOrderNotes(o, diningOptionName)), updated_at: new Date().toISOString(),
      }).eq("id", lead.id);
      if (leadUpdErr) { res.errors += 1; continue; }
      const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note: `Toast order ${o.guid} modified (scan)`, actor_id: null });
      if (evErr) { res.errors += 1; continue; }
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
    catch (e) { out.push(emptyResult(loc.id, false, e instanceof Error ? e.message : String(e))); }
  }
  return out;
}

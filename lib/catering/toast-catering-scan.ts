/** Capture-backed catering processing, with the original scanner retained until the env flip. */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { toastLeadFields, toastOrderChanged, toastOrderNotes, type ToastOrderSummary, type ToastOrderClass } from "@/lib/toast/catering-orders-shared";
import { mergeMachineNotes } from "@/lib/catering/machine-notes-shared";
import { resolveCateringManager, systemMoveStage, type ExistingLead } from "@/lib/catering/system-intake";
import { isPipelineStage } from "@/lib/catering/pipeline";
import { canTransition } from "@/lib/catering/pipeline-shared";

import { cateringCoverage, type CateringCaptureRun } from "@/lib/toast/capture-catering-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
const ACTOR_CONTEXT = "toast_catering_scan";

export interface ScanLocationResult {
  locationId: string; ok: boolean; error?: string; seen: number; catering: number;
  /** ezcater ring + third-party ring orders, ledgered but never a lead. */
  attributed: number;
  createdLeads: number; lostLeads: number; refreshed: number; skipped: number; errors: number;
  /** Checks whose totalAmount did not parse — the lead total is short by that much and this says so. */
  unparsedAmounts: number;
  diagnostics?: Record<string, number>;
  /** Dates skipped because no completed capture exists for them yet (pending, not a failure). */
  pendingDates?: string[];
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
  signal: AbortSignal,
): Promise<EnsureLeadOutcome> {
  const fields = toastLeadFields(o, { diningOptionName });
  const { data: lead, error: insErr } = await sb.from("catering_pipeline")
    .insert({ ...fields, location_id: locationId, assigned_to: assignee, created_by: null })
    .select("id").abortSignal(signal).maybeSingle<{ id: string }>();

  if (insErr || !lead) {
    if (insErr?.code === "23505") {
      // Another pass (or a race) already created this lead. Adopt it rather than orphan the
      // ledger row — never a second lead for one Toast order.
      const { data: existingLead } = await sb.from("catering_pipeline")
        .select("id").eq("external_ref", fields.external_ref).abortSignal(signal).maybeSingle<{ id: string }>();
      if (existingLead) {
        const linked = await sb.from("toast_catering_orders").update({ lead_id: existingLead.id, processing_result: "adopted_lead" }).eq("id", ledgerId).select("id").abortSignal(signal).maybeSingle<{ id: string }>();
        return linked.error || !linked.data ? "error" : "adopted";
      }
      await sb.from("toast_catering_orders").update({ processing_result: "duplicate_external_ref" }).eq("id", ledgerId).abortSignal(signal);
      return "duplicate";
    }
    await sb.from("toast_catering_orders").update({ processing_result: "error:lead_insert" }).eq("id", ledgerId).abortSignal(signal);
    return "error";
  }

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: null, to_stage: "confirmed", note: `Toast catering order ${o.guid} (scan)`, actor_id: null }).abortSignal(signal);
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.create", resourceTable: "catering_pipeline", resourceId: lead.id,
    metadata: { actor_context: ACTOR_CONTEXT, lead_source: "toast_catering", external_ref: fields.external_ref, location_id: locationId, stage: "confirmed", assigned_to: assignee, source: o.source, dining_option: diningOptionName }, ipAddress: null, userAgent: null });
  const linked = await sb.from("toast_catering_orders").update({ lead_id: lead.id, processing_result: evErr ? "created_lead_no_trail" : "created_lead" }).eq("id", ledgerId).select("id").abortSignal(signal).maybeSingle<{ id: string }>();
  return evErr || linked.error || !linked.data ? "error" : "created";
}

type LedgerRow = { id: string; order_guid: string; classification: ToastOrderClass; voided: boolean; toast_modified_at: string | null; lead_id: string | null; processing_result: string };

function emptyResult(locationId: string, ok: boolean, error?: string): ScanLocationResult {
  return { locationId, ok, error, seen: 0, catering: 0, attributed: 0, createdLeads: 0, lostLeads: 0, refreshed: 0, skipped: 0, errors: 0, unparsedAmounts: 0 };
}

export async function processToastCateringOrders(
  locationId: string,
  orders: readonly ToastOrderSummary[],
  context: { names: ReadonlyMap<string, string>; classifications: ReadonlyMap<string, ToastOrderClass>; diagnostics?: ReadonlyMap<string, string> },
  signal: AbortSignal,
): Promise<ScanLocationResult> {
  const sb = getServiceRoleClient();
  const res = emptyResult(locationId, true);
  const names = context.names;
  const assignee = await resolveCateringManager(sb, locationId, signal);
  // A map correction can remove an order from catering. Read existing ledger identities
  // for ALL incoming orders, in bounded batches rather than one query per retail sale.
  const orderGuids = [...new Set(orders.map((order) => order.guid))];
  const existingByGuid = new Map<string, LedgerRow>();
  for (let from = 0; from < orderGuids.length; from += 100) {
    signal.throwIfAborted();
    const prior = await sb.from("toast_catering_orders")
      .select("id, order_guid, classification, voided, toast_modified_at, lead_id, processing_result")
      .eq("location_id", locationId).in("order_guid", orderGuids.slice(from, from + 100))
      .abortSignal(signal).returns<LedgerRow[]>();
    if (prior.error) throw new Error("capture_catering_ledger_read_failed");
    // order_guid is unique: a 100-guid chunk cannot exceed the response's row limit.
    for (const row of prior.data ?? []) existingByGuid.set(row.order_guid, row);
  }
  for (const o of orders) {
    signal.throwIfAborted();
    res.seen += 1;
    res.unparsedAmounts += o.unparsedAmounts;
    const cls = context.classifications.get(o.guid);
    if (!cls) throw new Error("capture_catering_classification_missing");
    if (o.businessDate === null) { res.skipped += 1; continue; } // NOT NULL column; never guess the date
    const diningOptionName = o.diningOptionGuid ? names.get(o.diningOptionGuid) ?? null : null;
    const existing = existingByGuid.get(o.guid);
    if (existing?.toast_modified_at && (!o.modifiedAt || Date.parse(existing.toast_modified_at) > Date.parse(o.modifiedAt))) { res.skipped += 1; continue; }
    const diagnostic = context.diagnostics?.get(o.guid);
    if (diagnostic) {
      res.diagnostics ??= {};
      res.diagnostics[diagnostic] = (res.diagnostics[diagnostic] ?? 0) + 1;
    }
    if (cls === "not_catering" && !existing && !diagnostic) continue;
    const base = {
      location_id: locationId, order_guid: o.guid, business_date: o.businessDate, source: o.source, dining_option: diningOptionName,
      classification: cls, voided: o.voided, promised_at: o.promisedAt, toast_modified_at: o.modifiedAt,
      customer_name: o.customer?.name ?? null, customer_phone: o.customer?.phone ?? null, headcount: o.headcount,
      total_cents: o.totalCents, items: o.items, last_seen_at: new Date().toISOString(),
    };

    if (cls !== "catering") {
      if (cls !== "not_catering") res.attributed += 1;
      const processingResult = diagnostic ?? (cls === "ezcater" ? "attributed_to_ezcater"
        : cls === "third_party" ? "attributed_to_third_party" : "reclassified_not_catering");
      if (!existing) {
        const { error: insErr } = await sb.from("toast_catering_orders").insert({ ...base, processing_result: processingResult }).abortSignal(signal);
        if (insErr) res.errors += 1;
      } else {
        // Correct the projection, but never silently undo an already-operated house lead.
        // Preserve this marker across retries until a human resolves the linked lead.
        const needsReview = existing.processing_result === "reclassification_needs_review"
          || (!!existing.lead_id && existing.classification !== cls);
        const updated = await sb.from("toast_catering_orders").update({ ...base,
          processing_result: diagnostic ?? (needsReview ? "reclassification_needs_review" : processingResult),
        }).eq("id", existing.id).select("id").abortSignal(signal).maybeSingle<{ id: string }>();
        if (updated.error || !updated.data || (needsReview && !diagnostic)) res.errors += 1;
      }
      continue;
    }

    res.catering += 1;
    if (existing?.processing_result === "reclassification_needs_review") {
      const updated = await sb.from("toast_catering_orders").update({ ...base,
        processing_result: "reclassification_needs_review",
      }).eq("id", existing.id).select("id").abortSignal(signal).maybeSingle<{ id: string }>();
      // Human review remains necessary even if the map flips back. No new lead or stage move.
      res.errors += 1;
      if (updated.error || !updated.data) res.errors += 1;
      continue;
    }
    if (!existing) {
      // Ledger first, then the lead. A voided-at-first-sight order is ledgered, never a lead.
      const { data: ledger, error: lErr } = await sb.from("toast_catering_orders")
        .insert({ ...base, processing_result: o.voided ? "voided_before_seen" : "pending_lead" }).select("id").abortSignal(signal).maybeSingle<{ id: string }>();
      if (lErr) { res.errors += 1; continue; }
      if (!ledger || o.voided) continue;
      const outcome = await ensureLead(sb, o, locationId, diningOptionName, assignee, ledger.id, signal);
      if (outcome === "created") res.createdLeads += 1;
      if (outcome === "error") res.errors += 1;
      continue;
    }

    // Seen before. Unchanged → touch last_seen_at. Changed → refresh ledger (+ lead fields);
    // newly voided → lost. Either way, a catering order stranded without a lead (a prior
    // insert failed, or the ledger predates lead creation) gets another shot every scan.
    const retryRefresh = ["refresh_pending", "voided_update_failed", "voided_event_failed"].includes(existing.processing_result);
    const changed = existing.classification !== cls || retryRefresh || toastOrderChanged({ modifiedAt: existing.toast_modified_at, voided: existing.voided }, { modifiedAt: o.modifiedAt, voided: o.voided });
    if (changed) {
      const { error: refreshErr } = await sb.from("toast_catering_orders").update({ ...base, processing_result: existing.lead_id ? "refresh_pending" : "refreshed_no_lead" }).eq("id", existing.id).abortSignal(signal);
      if (refreshErr) { res.errors += 1; continue; }
      res.refreshed += 1;
    } else {
      const { error: touchErr } = await sb.from("toast_catering_orders").update({ last_seen_at: base.last_seen_at }).eq("id", existing.id).abortSignal(signal);
      if (touchErr) { res.errors += 1; continue; }
    }

    if (!existing.lead_id && existing.processing_result !== "voided_before_seen" && !o.voided) {
      const outcome = await ensureLead(sb, o, locationId, diningOptionName, assignee, existing.id, signal);
      if (outcome === "created") res.createdLeads += 1;
      if (outcome === "error") res.errors += 1;
    }

    if (!changed || !existing.lead_id) continue;

    const { data: leadRow, error: leadReadErr } = await sb.from("catering_pipeline").select("id, stage, notes").eq("id", existing.lead_id).abortSignal(signal).maybeSingle<{ id: string; stage: string; notes: string | null }>();
    if (leadReadErr) { res.errors += 1; continue; }
    if (!leadRow || !isPipelineStage(leadRow.stage)) { res.errors += 1; continue; }
    const lead: ExistingLead = { id: leadRow.id, stage: leadRow.stage };
    if (o.voided && (!existing.voided || retryRefresh)) {
      if (lead.stage === "out") {
        // Juan's ruling (2026-09-04): a void that lands after the order was marked OUT must
        // NOT move to `lost` — `lost` hides what actually happened (the food went out the
        // door). Leave the stage alone; flag it for a human to check for a comp/refund.
        const note = `Toast order ${o.guid} voided after it was marked out (scan) — needs review: comp/refund?${o.voidedAt ? ` (voidDate: ${o.voidedAt})` : ""}`;
        const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note, actor_id: null }).abortSignal(signal);
        const { error: updErr } = await sb.from("toast_catering_orders").update({ processing_result: evErr ? "refresh_pending" : "voided_after_out_needs_review" }).eq("id", existing.id).abortSignal(signal);
        if (evErr || updErr) res.errors += 1;
      } else if (canTransition(lead.stage, "lost")) {
        const outcome = await systemMoveStage(sb, lead, "lost", `Toast order ${o.guid} voided (scan)`, ACTOR_CONTEXT, signal);
        const { error: updErr } = await sb.from("toast_catering_orders").update({ processing_result: outcome === "moved" ? "voided_lead_lost" : `voided_${outcome}` }).eq("id", existing.id).abortSignal(signal);
        if (updErr || outcome === "update_failed" || outcome === "event_failed") res.errors += 1;
        if (outcome === "moved") res.lostLeads += 1;
      } else {
        const { error: updErr } = await sb.from("toast_catering_orders").update({ processing_result: "voided_illegal_transition" }).eq("id", existing.id).abortSignal(signal);
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
    }).eq("id", lead.id).abortSignal(signal);
    if (leadUpdErr) { res.errors += 1; continue; }
    const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note: `Toast order ${o.guid} modified (scan)`, actor_id: null }).abortSignal(signal);
    if (evErr) { res.errors += 1; continue; }
    void audit({ actorId: null, actorRole: null, action: "catering.pipeline.edit", resourceTable: "catering_pipeline", resourceId: lead.id,
      metadata: { actor_context: ACTOR_CONTEXT, reason: "toast_order_modified", fields: ["headcount", "event_date", "time_window", "estimated_revenue_cents", "delivery_address", "notes"] }, ipAddress: null, userAgent: null });
    const refreshed = await sb.from("toast_catering_orders").update({ processing_result: "refreshed" }).eq("id", existing.id).select("id").abortSignal(signal).maybeSingle<{ id: string }>();
    if (refreshed.error || !refreshed.data) res.errors += 1;
  }
  if (res.errors > 0) { res.ok = false; res.error = "capture_catering_processing_failed"; }
  return res;
}

/** Report persisted capture/sink health; capture itself owns the only Toast API pull. */
export async function scanToastCateringForAllLocations(dates: string[]): Promise<ScanLocationResult[]> {
  if (process.env.DEPLETION_SOURCE !== "capture") {
    const { scanToastCateringForAllLocations: legacyScan } = await import("./toast-catering-scan-legacy");
    return legacyScan(dates);
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id").eq("active", true)
    .not("toast_restaurant_guid", "is", null).returns<Array<{ id: string }>>();
  if (error) throw new Error("capture_catering_locations_read_failed");
  const out: ScanLocationResult[] = [];
  for (const location of data ?? []) {
    const result = emptyResult(location.id, true);
    try {
      for (const date of [...new Set(dates)]) {
        const run = await sb.from("toast_capture_runs").select("id,catering_status,catering_error_code,finished_at")
          .eq("location_id", location.id).eq("business_date", date).eq("status", "completed")
          .order("finished_at", { ascending: false }).limit(1)
          .maybeSingle<CateringCaptureRun>();
        // A failed READ is still a failure; a date with no completed capture yet is pending (item 12).
        if (run.error) throw new Error("capture_catering_coverage_missing");
        const coverage = cateringCoverage(run.data ?? null, date);
        if (coverage.state === "pending") { (result.pendingDates ??= []).push(date); continue; }
        if (coverage.state === "error") throw new Error(coverage.code);
        const rows = await selectAllRows<{ classification: string; processing_result: string }>((from, to) => sb
          .from("toast_catering_orders").select("classification,processing_result")
          .eq("location_id", location.id).eq("business_date", date).order("id").range(from, to));
        for (const row of rows) {
          result.seen += 1;
          if (["capture_catering_channel_unreviewed", "capture_catering_option_missing"].includes(row.processing_result)) {
            result.diagnostics ??= {};
            result.diagnostics[row.processing_result] = (result.diagnostics[row.processing_result] ?? 0) + 1;
          }
          if (row.classification === "catering") result.catering += 1;
          else if (row.classification !== "not_catering") result.attributed += 1;
          if (row.processing_result.startsWith("error:") || ["pending_lead", "refresh_pending", "voided_update_failed", "voided_event_failed", "created_lead_no_trail", "duplicate_external_ref", "refreshed_no_lead", "reclassification_needs_review"].includes(row.processing_result)) result.errors += 1;
        }
      }
      if (result.errors) { result.ok = false; result.error = "capture_catering_processing_failed"; }
    } catch (error) {
      result.ok = false;
      const code = error instanceof Error ? error.message : "";
      result.error = ["capture_catering_coverage_missing", "capture_catering_stale", "capture_catering_config_stale", "capture_catering_channel_unreviewed", "capture_catering_pending", "capture_catering_deadline", "capture_catering_processing_failed"].includes(code) ? code : "capture_catering_degraded";
    }
    out.push(result);
  }
  return out;
}

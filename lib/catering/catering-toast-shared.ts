/**
 * Item 21 PR 2 — the pure rules for house (non-ezCater) catering leads on the "not rung in Toast" list.
 *
 * Read with migration 0344 and docs/runbooks/catering-toast.md. What these rules promise:
 *  - A house lead is listed while the database says it is `not_rung_in_toast` and its shop's `enabled` is on. A
 *    SUGGESTION never removes it (plan r2 F7): only a current link (PR 3+) or a human "no Toast ring expected" does.
 *  - Toast-origin leads (created FROM a Toast order) stay off the list until the shop links them by origin
 *    (`include_toast_origin_leads`, which the database permits only with `origin_auto_link_enabled`): they are rung in
 *    Toast by construction (Astra r3 #4).
 *  - A suggestion is never a check another source owns, never a dual-code check, never a pair a person unlinked or
 *    marked not-a-match (the tombstone). Those are counted as conflicts so the person knows why.
 *  - The pipeline label partitions the UNCHANGED 0232 pipeline value; a partition that does not sum to its total is
 *    refused (null) rather than shown.
 * Zero I/O. Client-safe.
 */
import type { NotInToastOrder } from "./not-in-toast-shared";
import type { CateringValues } from "@/lib/sales-reports-shared";

/** One row of `catering_reconciliation_status` (0344). No contact, note or payload column exists in it. */
export interface HouseStatusRow {
  lead_id: string;
  location_id: string;
  event_date: string;
  lead_source: string | null;
  ring_code: string | null;
  headcount: number | null;
  value_cents: number | null;
  toast_origin: boolean;
  status: "matched" | "amount_mismatch" | "not_rung_in_toast" | "no_ring_expected";
}
export const HOUSE_STATUS_COLUMNS = "lead_id,location_id,event_date,lead_source,ring_code,headcount,value_cents,toast_origin,status";

export interface CateringToastShopSettings { enabled: boolean; includeToastOriginLeads: boolean }
export const CATERING_TOAST_SETTINGS_COLUMNS = "location_id,enabled,include_toast_origin_leads";

export function houseRowListed(row: HouseStatusRow, settings: CateringToastShopSettings): boolean {
  if (!settings.enabled || row.status !== "not_rung_in_toast") return false;
  return !row.toast_origin || settings.includeToastOriginLeads;
}

/** The same shape the four consumers already render: named by the ring code, valued by the lead, no ready time. */
export function houseNotInToastOrder(row: HouseStatusRow): NotInToastOrder {
  return {
    order_id: row.lead_id, lead_id: row.lead_id, location_id: row.location_id, event_date: row.event_date,
    order_number: row.ring_code, handoff_time: null, event_timestamp: null,
    headcount: row.headcount === null ? null : Number(row.headcount),
    total_cents: row.value_cents === null ? null : Number(row.value_cents), source: "house",
  };
}

export type ToastEvidence = "toast_origin" | "ring_code" | "amount_date";
export const TOAST_EVIDENCE: readonly ToastEvidence[] = ["toast_origin", "ring_code", "amount_date"];

/** One row of `plan_catering_toast` (0344). */
export interface CateringToastPlanRow {
  lead_id: string; location_id: string; order_guid: string; check_guid: string; toast_snapshot_id: string;
  business_date: string; evidence: ToastEvidence; check_total_cents: number | null; lead_value_cents: number | null;
  amount_diff_cents: number | null; amount_mismatch: boolean; dual_code: boolean;
  owner: "ezcater" | "house" | null; owner_lead_id: string | null; blocked: boolean;
}

export interface ToastSuggestion {
  orderGuid: string; checkGuid: string; businessDate: string; evidence: ToastEvidence;
  checkTotalCents: number | null; amountDiffCents: number | null; amountMismatch: boolean;
}
export interface HouseSuggestions { best: ToastSuggestion | null; count: number; conflicts: number }

const rank = (e: ToastEvidence) => TOAST_EVIDENCE.indexOf(e);
const absDiff = (r: CateringToastPlanRow) => r.amount_diff_cents === null ? Number.POSITIVE_INFINITY : Math.abs(Number(r.amount_diff_cents));

/** THE order of a lead's candidate checks: strongest evidence, then closest amount, then date, then identity. The
 * suggestion line and the link panel (PR 3) both use it, so "the suggested check" is the panel's first open row. */
export function compareToastCandidates(a: CateringToastPlanRow, b: CateringToastPlanRow): number {
  return rank(a.evidence) - rank(b.evidence) || absDiff(a) - absDiff(b)
    || a.business_date.localeCompare(b.business_date) || a.order_guid.localeCompare(b.order_guid) || a.check_guid.localeCompare(b.check_guid);
}

export function suggestionsFor(leadId: string, rows: readonly CateringToastPlanRow[]): HouseSuggestions {
  const open: CateringToastPlanRow[] = [];
  let conflicts = 0;
  for (const r of rows) {
    if (r.lead_id !== leadId || r.blocked) continue;
    if (r.owner === "house" && r.owner_lead_id === leadId) continue;
    if (r.owner !== null || r.dual_code) { conflicts += 1; continue; }
    open.push(r);
  }
  open.sort(compareToastCandidates);
  const top = open[0];
  return {
    best: top ? {
      orderGuid: top.order_guid, checkGuid: top.check_guid, businessDate: top.business_date, evidence: top.evidence,
      checkTotalCents: top.check_total_cents === null ? null : Number(top.check_total_cents),
      amountDiffCents: top.amount_diff_cents === null ? null : Number(top.amount_diff_cents), amountMismatch: top.amount_mismatch,
    } : null,
    count: open.length, conflicts,
  };
}

/** Group a shop's event dates into planner windows of at most `max` days (the planner refuses wider). */
export function plannerWindows(dates: readonly string[], max = 62): Array<{ from: string; to: string }> {
  const sorted = [...new Set(dates)].sort();
  const out: Array<{ from: string; to: string }> = [];
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && day(d) - day(last.from) <= max) last.to = d;
    else out.push({ from: d, to: d });
  }
  return out;
}

export const PIPELINE_PARTS = ["rung_in_toast", "toast_origin", "ezcater_sourced", "no_ring_expected", "not_rung"] as const;
export type PipelinePart = (typeof PIPELINE_PARTS)[number];
export interface PipelineReconciliationRaw {
  total_events: number | string; total_value_cents: number | string; total_unvalued: number | string;
  parts: Record<string, { events: number | string; value_cents: number | string; unvalued: number | string }>;
}
export interface PipelineReconciliation { totalCents: number; totalEvents: number; unvalued: number; parts: Record<PipelinePart, number> }

export function mergePipelineReconciliation(raws: readonly PipelineReconciliationRaw[]): PipelineReconciliation | null {
  const out: PipelineReconciliation = { totalCents: 0, totalEvents: 0, unvalued: 0,
    parts: { rung_in_toast: 0, toast_origin: 0, ezcater_sourced: 0, no_ring_expected: 0, not_rung: 0 } };
  for (const raw of raws) {
    let sum = 0;
    for (const [key, part] of Object.entries(raw.parts ?? {})) {
      if (!(PIPELINE_PARTS as readonly string[]).includes(key)) return null;
      const cents = Number(part.value_cents);
      if (!Number.isFinite(cents)) return null;
      out.parts[key as PipelinePart] += cents;
      sum += cents;
    }
    const total = Number(raw.total_value_cents);
    if (!Number.isFinite(total) || sum !== total) return null;
    out.totalCents += total;
    out.totalEvents += Number(raw.total_events);
    out.unvalued += Number(raw.total_unvalued);
  }
  return out;
}

/** The label belongs to the total it is printed under: same money (completed + confirmed/out), same event count, same
 * unvalued count as the block-3 read the page DISPLAYED. Anything else is a different snapshot (review r1 P2 #2). */
export function pipelineLabelMatchesDisplayed(label: PipelineReconciliation, displayed: CateringValues): boolean {
  return label.totalCents === displayed.completedCents + displayed.confirmedCents
    && label.totalEvents === displayed.completedEvents + displayed.confirmedEvents
    && label.unvalued === displayed.completedUnvalued + displayed.confirmedUnvalued;
}

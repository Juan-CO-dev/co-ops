/**
 * Catering delivery D3 — the MONEY-FREE delivery fact every passive surface reads (plan r6 section 6.2), and its pure
 * shaping. Zero I/O, no clock. Client-safe.
 *
 * The day plan, the Dashboard's catering block and "Needs you", mid-shift and the pipeline card all show a lead's
 * delivery through THIS fact and `deliveryStateOf` (`status-shared.ts`). There is no second state rule.
 *
 * WHAT THE FACT CARRIES: ids, enums, booleans and instants. NEVER money, a name, an address, a courier's label, a
 * reference or a note — `lib/delivery/day.ts` selects no such column, and the tests pin both the columns and the
 * serialized fact.
 */
import { orderQuoteOf } from "./quote-shared";
import { deliveryStateOf, keptForShop, latestJob, toBookSoon } from "./status-shared";
import type { DeliveryLeadStage, DeliveryQuoteStatus, DeliveryState, DeliveryStatus, OrderQuoteKind } from "./types-shared";

/** One job of a lead, as the state rule needs it, plus the two instants a status line shows. */
export interface DeliveryDayJob {
  attemptNo: number;
  status: DeliveryStatus;
  /** `closed_at is null`. */
  open: boolean;
  /** `delivery_jobs.location_id`: the shop the job was recorded for. */
  pickupShopId: string;
  /** A pickup decision exists for (this job, the lead's CURRENT shop). */
  keptForCurrentShop: boolean;
  /** When the current status happened, as entered. Information only: it never orders or decides anything. */
  at: string;
  /** The booked pick-up time, when one was entered. */
  pickupAt: string | null;
}
/** One lead of the delivery fact: ALL its jobs (the latest is the highest `attemptNo`, never a time). */
export interface DeliveryDayLead {
  leadId: string;
  stage: DeliveryLeadStage;
  currentShopId: string | null;
  orderQuote: { kind: OrderQuoteKind; isDelivery: boolean | null };
  isEzcater: boolean;
  jobs: DeliveryDayJob[];
}
/**
 * `off` = nothing to show and nothing was asked beyond the switch (the env switch, the shop's own switch, 0356 not on
 * the database, or a viewer the status gate refuses). `ok: false` = a real read failure: NEVER read as "to book".
 */
export type DeliveryDayResult = { ok: true; leads: DeliveryDayLead[] } | { ok: false } | { off: true };

/** What a row shows: the derived state, the instant that goes with it, and the job's own status. */
export interface DeliveryRowState {
  /** `unknown` = the delivery read failed ("Couldn't load delivery"). */
  readonly state: DeliveryState | "unknown";
  /** booked / cancel_needed / pickup_mismatch: the booked pick-up time; on the way, delivered, problem: when that happened. */
  readonly at: string | null;
  /** The status of the job the state is about; null when the state is about no job. */
  readonly status: DeliveryStatus | null;
  /** Set ONLY by `attachDelivery` for a viewer who may not manage deliveries, on a state that needs a manager
   *  (`cancel_needed`, `pickup_mismatch`): the line reads "tell a manager", not an action. Absent everywhere else. */
  readonly tellManager?: true;
}
export const DELIVERY_UNKNOWN: DeliveryRowState = { state: "unknown", at: null, status: null };

// ── Rows → the fact ─────────────────────────────────────────────────────────
export interface DayLeadRow { id: string; location_id: string | null; stage: DeliveryLeadStage; lead_source: string | null }
export interface DayJobRow {
  id: string; pipeline_id: string; location_id: string; attempt_no: number; closed_at: string | null; status: DeliveryStatus; status_at: string; pickup_at: string | null;
}
export interface DayDecisionRow { job_id: string; lead_location_id: string }
export interface DayQuoteRow { id: string; pipeline_id: string; status: DeliveryQuoteStatus; is_delivery: boolean; created_at: string }
export interface DayEzcaterRow { lead_id: string | null }

/**
 * The fact from the loader's rows. Leads sorted by id, jobs by attempt (a stable fact whatever order the rows came in).
 * The order quote is `orderQuoteOf` over the live revision of each of the lead's quote families; ezCater-ness is the
 * source label OR an `ezcater_orders` row naming the lead (the label is editable, so it is never sufficient alone).
 */
export function deliveryDayLeads(rows: {
  leads: readonly DayLeadRow[]; jobs: readonly DayJobRow[]; decisions: readonly DayDecisionRow[]; quotes: readonly DayQuoteRow[]; ezcater: readonly DayEzcaterRow[];
}): DeliveryDayLead[] {
  const ez = new Set(rows.ezcater.map((e) => e.lead_id).filter((id): id is string => typeof id === "string"));
  const decisions = rows.decisions.map((d) => ({ jobId: d.job_id, leadLocationId: d.lead_location_id }));
  const seen = new Set<string>();
  const out: DeliveryDayLead[] = [];
  for (const lead of [...rows.leads].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    const quote = orderQuoteOf(rows.quotes.filter((q) => q.pipeline_id === lead.id)
      .map((q) => ({ id: q.id, status: q.status, isDelivery: q.is_delivery === true, createdAt: q.created_at })));
    out.push({
      leadId: lead.id, stage: lead.stage, currentShopId: lead.location_id, orderQuote: { kind: quote.kind, isDelivery: quote.isDelivery },
      isEzcater: lead.lead_source === "ezcater" || ez.has(lead.id),
      jobs: rows.jobs.filter((j) => j.pipeline_id === lead.id).sort((a, b) => a.attempt_no - b.attempt_no).map((j) => ({
        attemptNo: j.attempt_no, status: j.status, open: j.closed_at === null, pickupShopId: j.location_id,
        keptForCurrentShop: keptForShop(decisions, j.id, lead.location_id), at: j.status_at, pickupAt: j.pickup_at,
      })),
    });
  }
  return out;
}

// ── The fact → what a row shows ─────────────────────────────────────────────
const AT_PICKUP: ReadonlySet<DeliveryState> = new Set<DeliveryState>(["booked", "cancel_needed", "pickup_mismatch"]);
const AT_STATUS: ReadonlySet<DeliveryState> = new Set<DeliveryState>(["on_the_way", "delivered", "problem"]);

/** The states that are about NO job (`deliveryStateOf` answers `attemptNo: null` for exactly these). */
const ABOUT_NO_JOB: ReadonlySet<DeliveryState> = new Set<DeliveryState>(["to_book", "to_book_soon", "provider_managed", "none"]);

/**
 * THE row of a derived state and the job it is about: which instant goes with it, and the job's status. The one place
 * this is decided — the server's row (`deliveryRowStateOf`) and the row a panel publishes from its GET
 * (`publishedRowOf`, chip-shared.ts) both come through here. It derives no state: `state` is `deliveryStateOf`'s.
 * A state that is about no job carries neither an instant nor a status, whatever job is handed in.
 */
export function rowStateFor(state: DeliveryState, job: { status: DeliveryStatus; at: string; pickupAt: string | null } | null): DeliveryRowState {
  const about = ABOUT_NO_JOB.has(state) ? null : job;
  return { state, at: !about ? null : AT_PICKUP.has(state) ? about.pickupAt : AT_STATUS.has(state) ? about.at : null, status: about ? about.status : null };
}

/** A lead's row state, from `deliveryStateOf` ONLY. `soon` = the caller's "inside the shop's catering lead window". */
export function deliveryRowStateOf(lead: DeliveryDayLead, soon = false): DeliveryRowState {
  const { state, attemptNo } = deliveryStateOf({ stage: lead.stage, currentShopId: lead.currentShopId, orderQuote: lead.orderQuote, isEzcater: lead.isEzcater, jobs: lead.jobs, soon });
  const about = attemptNo === null ? null : lead.jobs.find((j) => j.attemptNo === attemptNo) ?? latestJob(lead.jobs);
  return rowStateFor(state, about);
}
/** The same row inside (or outside) the caller's window: only `to_book` changes. */
export function rowStateSoon(row: DeliveryRowState, soon: boolean): DeliveryRowState {
  const state = toBookSoon(row.state, soon);
  return state === row.state ? row : { ...row, state };
}

/** The states that need a PERSON now ("Needs you", the block's alerts). `to_book` outside the window is not one yet. */
export const DELIVERY_NEEDS_PERSON = ["to_book_soon", "cancel_needed", "problem", "pickup_mismatch"] as const satisfies readonly DeliveryState[];
export function deliveryNeedsPerson(state: DeliveryRowState["state"]): boolean {
  return (DELIVERY_NEEDS_PERSON as readonly string[]).includes(state);
}
/** The states a lead with NO order row on the day is still alerted for: the order is gone from the day, the courier is not. */
export const DELIVERY_ALERT_STATES = ["cancel_needed", "pickup_mismatch"] as const satisfies readonly DeliveryState[];
export type DeliveryAlertState = (typeof DELIVERY_ALERT_STATES)[number];
export interface DeliveryAlert { readonly leadId: string; readonly state: DeliveryAlertState; readonly at: string | null }
const isAlertState = (s: DeliveryRowState["state"]): s is DeliveryAlertState => (DELIVERY_ALERT_STATES as readonly string[]).includes(s);

/** The alerts of a delivery fact: its leads with no order row among `orderIds`, in a state that still needs a person. */
export function deliveryAlerts(leads: readonly DeliveryDayLead[], orderIds: ReadonlySet<string>): DeliveryAlert[] {
  const out: DeliveryAlert[] = [];
  for (const lead of leads) {
    if (orderIds.has(lead.leadId)) continue;
    const row = deliveryRowStateOf(lead);
    if (isAlertState(row.state)) out.push({ leadId: lead.leadId, state: row.state, at: row.at });
  }
  return out;
}

/**
 * Rows keyed by lead id (mid-shift's events, the pulse's catering rows) with their delivery state attached.
 * off → the SAME array, untouched (no key added: the payload is what it was before D3); a failed read → every row
 * reads `unknown` ("Couldn't load delivery"), never "to book"; ok → the lead's state, and no key when there is nothing
 * to show (`none`, or a lead the fact does not hold).
 * `canAct` = the viewer passes the delivery WRITE gate at this shop (`deliveryWriteAllowed`). Without it, the two states
 * only a manager can settle carry `tellManager` (a key holder is told to tell a manager, never to cancel a courier).
 */
export function attachDelivery<T extends { id: string }>(rows: T[], result: DeliveryDayResult | null, canAct = true): Array<T & { delivery?: DeliveryRowState }> {
  if (result === null || "off" in result) return rows;
  if (!result.ok) return rows.map((r) => ({ ...r, delivery: DELIVERY_UNKNOWN }));
  const byLead = new Map(result.leads.map((l) => [l.leadId, l]));
  return rows.map((r) => {
    const lead = byLead.get(r.id);
    const state = lead ? deliveryRowStateOf(lead) : null;
    if (!state || state.state === "none") return r;
    return { ...r, delivery: !canAct && (DELIVERY_ALERT_STATES as readonly string[]).includes(state.state) ? { ...state, tellManager: true as const } : state };
  });
}

/** A status line's TEXT colour (text roles only; a state that needs a person is red text, never a fill). */
export const DELIVERY_TONE_TEXT: Record<DeliveryTone, string> = {
  alert: "font-semibold text-co-cta-text", warn: "font-semibold text-co-warning-text", ok: "text-co-confirm-text", muted: "text-co-text-muted",
};

// ── The words ───────────────────────────────────────────────────────────────
/**
 * The ONE label of a row state, for every surface (the catering block, mid-shift, the pulse, the pipeline chip). The
 * caller formats `time` (an instant) in the viewer's language and fills `{time}`. `none` shows nothing: null.
 * Status only: no money, no courier name, no reference.
 */
export type DeliveryLabelKey =
  | "catering.delivery_state.to_book" | "catering.delivery_state.to_book_soon" | "catering.delivery_state.booked" | "catering.delivery_state.booked_at"
  | "catering.delivery_state.picked_up" | "catering.delivery_state.picked_up_at" | "catering.delivery_state.on_the_way"
  | "catering.delivery_state.delivered" | "catering.delivery_state.delivered_at" | "catering.delivery_state.problem"
  | "catering.delivery_state.cancel_needed" | "catering.delivery_state.pickup_mismatch" | "catering.delivery_state.provider_managed"
  | "catering.delivery_state.cancel_needed_tell" | "catering.delivery_state.pickup_mismatch_tell"
  | "catering.delivery_state.unknown";
export type DeliveryTone = "alert" | "warn" | "ok" | "muted";
export interface DeliveryLabel { key: DeliveryLabelKey; time: string | null; tone: DeliveryTone }

export function deliveryLabel(row: DeliveryRowState | null | undefined): DeliveryLabel | null {
  if (!row) return null;
  // A viewer who cannot manage deliveries (a key holder or shift lead on mid-shift) is not handed an action.
  if (row.tellManager && row.state === "cancel_needed") return { key: "catering.delivery_state.cancel_needed_tell", time: null, tone: "alert" };
  if (row.tellManager && row.state === "pickup_mismatch") return { key: "catering.delivery_state.pickup_mismatch_tell", time: null, tone: "alert" };
  const timed = (withTime: DeliveryLabelKey, bare: DeliveryLabelKey, tone: DeliveryTone): DeliveryLabel =>
    (row.at ? { key: withTime, time: row.at, tone } : { key: bare, time: null, tone });
  switch (row.state) {
    case "none": return null;
    case "unknown": return { key: "catering.delivery_state.unknown", time: null, tone: "muted" };
    case "to_book": return { key: "catering.delivery_state.to_book", time: null, tone: "warn" };
    case "to_book_soon": return { key: "catering.delivery_state.to_book_soon", time: null, tone: "alert" };
    case "booked": return timed("catering.delivery_state.booked_at", "catering.delivery_state.booked", "ok");
    // The food has left only from `picked_up` on; a courier still heading to the shop is "on the way". The row's instant
    // is the CURRENT status's: only while that status IS `picked_up` is it the pick-up time. A later status (heading to
    // or at the drop-off) says "Picked up" with NO time — its own time is not when the food was picked up.
    case "on_the_way":
      if (row.status === "picked_up") return timed("catering.delivery_state.picked_up_at", "catering.delivery_state.picked_up", "ok");
      if (row.status === "en_route_dropoff" || row.status === "at_dropoff") return { key: "catering.delivery_state.picked_up", time: null, tone: "ok" };
      return { key: "catering.delivery_state.on_the_way", time: null, tone: "ok" };
    case "delivered": return timed("catering.delivery_state.delivered_at", "catering.delivery_state.delivered", "ok");
    case "problem": return { key: "catering.delivery_state.problem", time: null, tone: "alert" };
    case "cancel_needed": return { key: "catering.delivery_state.cancel_needed", time: null, tone: "alert" };
    case "pickup_mismatch": return { key: "catering.delivery_state.pickup_mismatch", time: null, tone: "alert" };
    case "provider_managed": return { key: "catering.delivery_state.provider_managed", time: null, tone: "muted" };
  }
}

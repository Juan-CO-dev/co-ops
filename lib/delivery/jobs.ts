/**
 * Catering delivery (D1) — THE service-role reader / writer lib over migration 0356. Server-only. The D2 routes
 * (`app/api/catering/pipeline/[id]/delivery/**`) call these entry points and nothing else. Read with AGENTS.md "Catering delivery".
 *
 * EVERY ENTRY POINT, IN THIS ORDER:
 *   1. the switch (`DELIVERY_TRACKING`): off = a loader answers "off" with NO query; a write throws 503 `delivery_off`;
 *   2. the gate, by trusted role, BEFORE ANY I/O;
 *   3. the database. A write first reads the shop's own switch: OFF MEANS OFF for every writer (409 `delivery_off`).
 * A VIEWER'S QUERIES NAME ONLY WHAT THEIR TIER MAY SEE (status / detail / cost / history): a hidden column is never
 * selected and redacted afterwards. And what is returned is bound to the shop the gates were judged for: a lead that
 * changed shop during the reads is loaded again (`loadLeadDelivery`), then `delivery_busy`.
 * READS. `loadLeadDelivery` decides the view in the lib: a viewer who passes the status gate at the lead's CURRENT shop
 * gets `view: "lead"` (detail and cost added by their own gates — a status-only viewer receives no money, no external
 * reference, no note); a viewer who passes no lead-scoped gate but the JOB-scoped history gate for at least one job
 * (the pickup shop's AGM / GM after the order moved away) gets `view: "history"` with those jobs only — no lead state,
 * no other shop's job, no cost; anyone else gets null (a 404 at the route). Lists are paged; id lists are chunked.
 * WRITES. One RPC each; the gate binds to the shop the person SAW (`expectedShopId`) before the call, and SQL refuses
 * `shop_moved` under the lead lock when the lead is no longer there, then re-checks the actor on the locked users row.
 * Each writer inserts its own destructive audit row in the same transaction, so this module never calls audit().
 * NOT INSTALLED (42P01 / 42883 / PGRST202 / PGRST205) = `view: "not_installed"` on a read, 503 `delivery_unavailable`
 * on a write. Never a 500, never a silent zero.
 * NOTHING OUTBOUND: no courier, webhook, email or text is called from here.
 */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import {
  type DeliveryActor, deliveryActorOf, deliveryCostReadAllowed, deliveryDetailReadAllowed, deliveryJobHistoryReadAllowed, deliveryReadPossible, deliveryStatusReadAllowed,
  deliveryWriteAllowed,
} from "./access-shared";
import { boundedDeliveryRead } from "./bounded";
import { deliveryTrackingOn } from "./config";
import { orderCost, type OrderCost } from "./cost-shared";
import { DeliveryError, deliveryErrorFrom, deliveryErrorStatus, deliveryOff, type DeliverySqlRefusal } from "./errors";
import { splitHead } from "./gratuity-shared";
import { orderQuoteOf } from "./quote-shared";
import { readShopDeliverySettings } from "./settings";
import { deliveryStateOf, keptForShop, latestJob, type ManualDeliveryStatus } from "./status-shared";
import type {
  DeliveryBookedVia, DeliveryCostComponent, DeliveryCostRow, DeliveryGratuitySplit, DeliveryJob, DeliveryJobEvent, DeliveryLeadStage,
  DeliveryPickupDecision, DeliveryShopSettings, DeliveryState, DeliveryStatus, OrderQuote, OrderQuoteKind, QuoteCandidate,
} from "./types-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
/** Ids per `.in()` list: 100 uuids stay far inside the request line. */
const IN_CHUNK = 100;
function chunks<T>(list: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
/** A failed page is a named error (not installed → 503), never an empty list. */
async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>): Promise<T[]> {
  return selectAllRows<T>(async (from, to) => {
    const res = await build(from, to);
    if (res.error) throw deliveryErrorFrom(res.error);
    return res;
  });
}

/** A query whose column list is chosen at run time (the viewer's tier): the client cannot derive its row type, so it is stated. */
type RowsResult<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>;
const rowsOf = <T>(query: unknown): RowsResult<T> => query as RowsResult<T>;

// ── Rows ────────────────────────────────────────────────────────────────────
export const LEAD_COLUMNS = "id,location_id,stage,lead_source";
export const QUOTE_COLUMNS = "id,status,is_delivery,gratuity_cents,delivery_fee_cents,created_at";
export const JOB_COLUMNS = "id,pipeline_id,location_id,quote_id,confirm_event_id,booked_via,provider_label,external_ref,attempt_no,pickup_at,dropoff_at,closed_at,created_by,created_at,status,status_seq,status_at";
export const EVENT_COLUMNS = "id,job_id,seq,status,occurred_at,recorded_at,source,actor_id,note";
export const COST_COLUMNS = "id,job_id,component,semantics,amount_cents,money_identity,source,provider_ref,observed_at,corrects_id,actor_id,note";
export const SPLIT_COLUMNS = "id,pipeline_id,job_id,quote_id,kind,gratuity_cents,driver_bps,driver_cents,crew_cents,recorded_at,recorded_by,reason,supersedes_id";
export const DECISION_COLUMNS = "id,job_id,lead_location_id,decided_by,decided_at,note";

interface LeadRow { id: string; location_id: string | null; stage: DeliveryLeadStage; lead_source: string | null }
interface QuoteRow { id: string; status: QuoteCandidate["status"]; is_delivery: boolean; gratuity_cents: number; delivery_fee_cents: number; created_at: string }
interface JobRow {
  id: string; pipeline_id: string; location_id: string; quote_id: string | null; confirm_event_id: string | null; booked_via: DeliveryBookedVia;
  provider_label: string; external_ref: string | null; attempt_no: number; pickup_at: string | null; dropoff_at: string | null; closed_at: string | null;
  created_by: string; created_at: string; status: DeliveryStatus; status_seq: number; status_at: string;
}
interface EventRow { id: string; job_id: string; seq: number; status: DeliveryStatus; occurred_at: string; recorded_at: string; source: DeliveryJobEvent["source"]; actor_id: string | null; note: string | null }
interface CostRow {
  id: string; job_id: string; component: DeliveryCostComponent; semantics: DeliveryCostRow["semantics"]; amount_cents: number; money_identity: string;
  source: DeliveryCostRow["source"]; provider_ref: string | null; observed_at: string; corrects_id: string | null; actor_id: string | null; note: string | null;
}
interface SplitRow {
  id: string; pipeline_id: string; job_id: string | null; quote_id: string | null; kind: "split" | "void"; gratuity_cents: number; driver_bps: number;
  driver_cents: number; crew_cents: number; recorded_at: string; recorded_by: string | null; reason: string | null; supersedes_id: string | null;
}
interface DecisionRow { id: string; job_id: string; lead_location_id: string; decided_by: string; decided_at: string; note: string | null }

const toCandidate = (r: QuoteRow): QuoteCandidate =>
  ({ id: r.id, status: r.status, isDelivery: r.is_delivery === true, gratuityCents: r.gratuity_cents, deliveryFeeCents: r.delivery_fee_cents, createdAt: r.created_at });
const toJob = (r: JobRow): DeliveryJob => ({
  id: r.id, pipelineId: r.pipeline_id, locationId: r.location_id, quoteId: r.quote_id, confirmEventId: r.confirm_event_id, bookedVia: r.booked_via,
  providerLabel: r.provider_label, externalRef: r.external_ref, attemptNo: r.attempt_no, pickupAt: r.pickup_at, dropoffAt: r.dropoff_at, closedAt: r.closed_at,
  createdBy: r.created_by, createdAt: r.created_at, status: r.status, statusSeq: r.status_seq, statusAt: r.status_at,
});
const toEvent = (r: EventRow): DeliveryJobEvent =>
  ({ id: r.id, jobId: r.job_id, seq: r.seq, status: r.status, occurredAt: r.occurred_at, recordedAt: r.recorded_at, source: r.source, actorId: r.actor_id, note: r.note });
const toCost = (r: CostRow): DeliveryCostRow => ({
  id: r.id, jobId: r.job_id, component: r.component, semantics: r.semantics, amountCents: r.amount_cents, moneyIdentity: r.money_identity, source: r.source,
  providerRef: r.provider_ref, observedAt: r.observed_at, correctsId: r.corrects_id, actorId: r.actor_id, note: r.note,
});
const toSplit = (r: SplitRow): DeliveryGratuitySplit => ({
  id: r.id, pipelineId: r.pipeline_id, jobId: r.job_id, quoteId: r.quote_id, kind: r.kind, gratuityCents: r.gratuity_cents, driverBps: r.driver_bps,
  driverCents: r.driver_cents, crewCents: r.crew_cents, recordedAt: r.recorded_at, recordedBy: r.recorded_by, reason: r.reason, supersedesId: r.supersedes_id,
});
const toDecision = (r: DecisionRow): DeliveryPickupDecision =>
  ({ id: r.id, jobId: r.job_id, leadLocationId: r.lead_location_id, decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.note });

// ── Reads (ungated: each caller has bound its gate) ─────────────────────────
async function readLead(sb: Sb, leadId: string): Promise<LeadRow | null> {
  const { data, error } = await sb.from("catering_pipeline").select(LEAD_COLUMNS).eq("id", leadId).maybeSingle<LeadRow>();
  if (error) throw deliveryErrorFrom(error);
  return data ?? null;
}
/** ezCater-ness is durable: the source label OR an ezcater_orders row naming the lead (the label is editable). SQL twin: delivery_lead_is_ezcater. */
async function readIsEzcater(sb: Sb, lead: LeadRow): Promise<boolean> {
  if (lead.lead_source === "ezcater") return true;
  const { data, error } = await sb.from("ezcater_orders").select("id").eq("lead_id", lead.id).order("id").range(0, 0);
  if (error) throw deliveryErrorFrom(error);
  return (data ?? []).length > 0;
}
/** The candidates of the order-quote selection: the LIVE revision of each of the lead's quote families (0120; `loadQuotesForLead`'s definition). */
async function readQuoteCandidates(sb: Sb, leadId: string): Promise<QuoteCandidate[]> {
  const rows = await pages<QuoteRow>((from, to) => sb.from("catering_quotes").select(QUOTE_COLUMNS).eq("pipeline_id", leadId).is("superseded_at", null)
    .order("created_at").order("id").range(from, to));
  return rows.map(toCandidate);
}
async function readJobs(sb: Sb, leadId: string): Promise<DeliveryJob[]> {
  const rows = await pages<JobRow>((from, to) => sb.from("delivery_job_current").select(JOB_COLUMNS).eq("pipeline_id", leadId).order("attempt_no").order("id").range(from, to));
  return rows.map(toJob);
}
async function readEvents(sb: Sb, jobIds: readonly string[]): Promise<DeliveryJobEvent[]> {
  const out: DeliveryJobEvent[] = [];
  for (const ids of chunks(jobIds)) {
    out.push(...(await pages<EventRow>((from, to) => sb.from("delivery_job_events").select(EVENT_COLUMNS).in("job_id", ids).order("job_id").order("seq").range(from, to))).map(toEvent));
  }
  return out;
}
async function readCosts(sb: Sb, jobIds: readonly string[]): Promise<DeliveryCostRow[]> {
  const out: DeliveryCostRow[] = [];
  for (const ids of chunks(jobIds)) {
    out.push(...(await pages<CostRow>((from, to) => sb.from("delivery_job_costs").select(COST_COLUMNS).in("job_id", ids).order("observed_at").order("id").range(from, to))).map(toCost));
  }
  return out;
}
async function readSplits(sb: Sb, leadId: string): Promise<DeliveryGratuitySplit[]> {
  const rows = await pages<SplitRow>((from, to) => sb.from("delivery_gratuity_splits").select(SPLIT_COLUMNS).eq("pipeline_id", leadId).order("recorded_at").order("id").range(from, to));
  return rows.map(toSplit);
}
async function readDecisions(sb: Sb, jobIds: readonly string[]): Promise<DeliveryPickupDecision[]> {
  const out: DeliveryPickupDecision[] = [];
  for (const ids of chunks(jobIds)) {
    out.push(...(await pages<DecisionRow>((from, to) => sb.from("delivery_pickup_decisions").select(DECISION_COLUMNS).in("job_id", ids).order("decided_at").order("id").range(from, to))).map(toDecision));
  }
  return out;
}

/** Everything the ledger knows about one lead's delivery. UNGATED and with money: for server code that has bound its own gate. */
export interface LeadDeliveryFacts {
  leadId: string;
  /** The lead's CURRENT shop (scope follows the lead). */
  shopId: string | null;
  stage: DeliveryLeadStage;
  isEzcater: boolean;
  candidates: QuoteCandidate[];
  orderQuote: OrderQuote;
  /** Every job, ascending attemptNo (the latest is the last). */
  jobs: DeliveryJob[];
  events: DeliveryJobEvent[];
  costs: DeliveryCostRow[];
  splits: DeliveryGratuitySplit[];
  pickupDecisions: DeliveryPickupDecision[];
  /** The CURRENT shop's settings; null = no row (off). */
  settings: DeliveryShopSettings | null;
}
export async function loadLeadDeliveryFacts(sb: Sb, leadId: string): Promise<LeadDeliveryFacts | null> {
  const lead = await readLead(sb, leadId);
  return lead ? factsOf(sb, lead) : null;
}
async function factsOf(sb: Sb, lead: LeadRow): Promise<LeadDeliveryFacts> {
  const leadId = lead.id;
  const [isEzcater, candidates, jobs, splits, settings] = await Promise.all([
    readIsEzcater(sb, lead), readQuoteCandidates(sb, leadId), readJobs(sb, leadId), readSplits(sb, leadId),
    lead.location_id ? readShopDeliverySettings(sb, lead.location_id) : Promise.resolve(null),
  ]);
  const ids = jobs.map((j) => j.id);
  const [events, costs, pickupDecisions] = ids.length === 0 ? [[], [], []] as [DeliveryJobEvent[], DeliveryCostRow[], DeliveryPickupDecision[]]
    : await Promise.all([readEvents(sb, ids), readCosts(sb, ids), readDecisions(sb, ids)]);
  return { leadId: lead.id, shopId: lead.location_id, stage: lead.stage, isEzcater, candidates, orderQuote: orderQuoteOf(candidates), jobs, events, costs, splits,
    pickupDecisions, settings };
}

/** THE derived state of a lead's delivery from its facts (`deliveryStateOf`; `soon` is the caller's clock). */
export function leadDeliveryState(facts: Pick<LeadDeliveryFacts, "stage" | "shopId" | "orderQuote" | "isEzcater" | "jobs" | "pickupDecisions">, soon = false): { state: DeliveryState; attemptNo: number | null } {
  return deliveryStateOf({
    stage: facts.stage, currentShopId: facts.shopId, orderQuote: { kind: facts.orderQuote.kind, isDelivery: facts.orderQuote.isDelivery }, isEzcater: facts.isEzcater, soon,
    jobs: facts.jobs.map((j) => ({ attemptNo: j.attemptNo, status: j.status, open: j.closedAt === null, pickupShopId: j.locationId,
      keptForCurrentShop: keptForShop(facts.pickupDecisions, j.id, facts.shopId) })),
  });
}

// ── The gated view ──────────────────────────────────────────────────────────
//
// THREE PROJECTIONS. The viewer's tier is decided BEFORE reading and picks every query's column list; each relation is
// read ONCE per load (one job set for the whole answer). A restricted query or column is issued only when its gate passed (a tier-hidden column is never SELECTed for a
// viewer who may not see it — redacting a fetched row is not the rule):
//   status  — the lead, ezCater-ness, the quote candidates WITHOUT money, the jobs WITHOUT reference, the pickup
//             decisions WITHOUT note, the shop's switch. No event, no cost, no split.
//   detail  — adds the jobs' external reference, the events (with notes), the decisions' notes, the shop's couriers.
//   cost    — adds the costs, the gratuity chain, the quotes' gratuity and delivery fee, the shop's driver share.
//   history — JOB-scoped, for the pickup shop's managers after the order moved away: only jobs whose pickup shop the
//             viewer is a member of (filtered in the query AND again on the rows), with their events.
export const STATUS_QUOTE_COLUMNS = "id,root_id,status,is_delivery,created_at,superseded_at";
export const STATUS_JOB_COLUMNS = "id,pipeline_id,location_id,booked_via,provider_label,attempt_no,pickup_at,dropoff_at,closed_at,status,status_seq,status_at";
export const STATUS_DECISION_COLUMNS = "id,job_id,lead_location_id";
export const STATUS_SETTINGS_COLUMNS = "location_id,enabled";
export const HISTORY_JOB_COLUMNS = "id,pipeline_id,location_id,provider_label,external_ref,attempt_no,pickup_at,dropoff_at,status,status_seq,status_at";
/** The moved-order LIST (D2): the job only. No reference (that is the history read's), no author, no quote, no confirm event. */
export const MOVED_JOB_COLUMNS = "id,pipeline_id,location_id,provider_label,attempt_no,pickup_at,dropoff_at,status,status_at,created_at";
/** How often a load starts over when the lead changed shop under it, before it answers `delivery_busy`. */
export const LOAD_ATTEMPTS = 3;

/** What a key holder may see of the job the state is about. No money, no external reference, no note, no customer field. */
export interface DeliveryStatusDto { attemptNo: number; status: DeliveryStatus; statusAt: string; providerLabel: string; pickupAt: string | null; dropoffAt: string | null }
/** One job for the pickup shop's managers after the order moved away. No lead state, no other job, no cost. */
export interface DeliveryJobHistoryDto {
  jobId: string; attemptNo: number; status: DeliveryStatus; statusAt: string; providerLabel: string; externalRef: string | null;
  pickupAt: string | null; dropoffAt: string | null; pickupShopId: string; events: DeliveryJobEvent[];
}
export type LeadDeliveryView =
  | { view: "off" }
  | { view: "not_installed" }
  | {
      view: "lead"; leadId: string; shopId: string | null; enabled: boolean; isEzcater: boolean;
      orderQuote: { kind: OrderQuoteKind; isDelivery: boolean | null };
      state: DeliveryState;
      /** The job the state is about, else the latest job; null when the lead has none. */
      status: DeliveryStatusDto | null;
      /** Detail gate. */
      detail?: { jobs: DeliveryJob[]; events: DeliveryJobEvent[]; pickupDecisions: DeliveryPickupDecision[]; manualProviders: string[] };
      /** Cost gate. */
      cost?: { costs: DeliveryCostRow[]; orderCost: OrderCost; splits: DeliveryGratuitySplit[]; splitHead: DeliveryGratuitySplit | null; candidates: QuoteCandidate[]; gratuityDriverBps: number | null };
    }
  | { view: "history"; leadId: string; movedToShopId: string | null; jobs: DeliveryJobHistoryDto[] };

interface StatusQuoteRow { id: string; root_id: string | null; status: QuoteCandidate["status"]; is_delivery: boolean; created_at: string; superseded_at: string | null }
type StatusJobRow = Pick<JobRow, "id" | "pipeline_id" | "location_id" | "booked_via" | "provider_label" | "attempt_no" | "pickup_at" | "dropoff_at" | "closed_at" | "status" | "status_seq" | "status_at">;
type HistoryJobRow = Pick<JobRow, "id" | "pipeline_id" | "location_id" | "provider_label" | "external_ref" | "attempt_no" | "pickup_at" | "dropoff_at" | "status" | "status_seq" | "status_at">;

async function shopSetting<T>(sb: Sb, columns: string, shopId: string | null): Promise<T | null> {
  if (!shopId) return null;
  const { data, error } = await sb.from("delivery_settings").select(columns).eq("location_id", shopId).maybeSingle<T>();
  if (error) throw deliveryErrorFrom(error);
  return data ?? null;
}

/**
 * OFF MEANS OFF, for the pickup shop's reads too (review DELIV2-r1): of `shops`, the ones whose `delivery_settings` row
 * is enabled. No row = off. A shop that was on, has jobs, and was turned off answers nothing until it is on again.
 */
async function enabledShops(sb: Sb, shops: readonly string[]): Promise<string[]> {
  const on = new Set<string>();
  for (const ids of chunks(shops)) {
    const rows = await pages<{ location_id: string; enabled: boolean }>((from, to) => sb.from("delivery_settings").select(STATUS_SETTINGS_COLUMNS).in("location_id", ids)
      .order("location_id").range(from, to));
    for (const r of rows) if (r.enabled === true) on.add(r.location_id);
  }
  return shops.filter((shop) => on.has(shop));
}

/**
 * The lead view for a viewer who PASSED the status gate at `lead.location_id`.
 *
 * THE TIER IS DECIDED BEFORE ANYTHING IS READ, AND EACH RELATION IS READ ONCE (review DELIV1-r2). The viewer's tier
 * (status, + detail, + cost) picks the column list of every query up front; the lead's jobs are then read ONCE, and the
 * status, the detail and the cost coverage are all derived from THAT ONE job set — events, costs and pickup decisions
 * are read for exactly those job ids. Reading the jobs once per tier let a replacement job recorded between two reads
 * appear in `detail.jobs` while the cost aggregate still covered the older set: "complete: $30" beside a job whose cost
 * is unknown. Now a job that appears after the one read is simply not in this response, consistently everywhere, and
 * the cost can never be `complete` over fewer jobs than the response shows. The same holds for the quotes (the order
 * quote and the cost tier's candidates are one read) and the shop's settings.
 * The per-tier SELECT rule stands: a status-only viewer's one job query names no restricted column.
 */
async function leadView(sb: Sb, who: DeliveryActor, lead: LeadRow, soon: boolean): Promise<Extract<LeadDeliveryView, { view: "lead" }>> {
  const leadId = lead.id, shopId = lead.location_id;
  const detail = deliveryDetailReadAllowed(who, shopId), cost = deliveryCostReadAllowed(who, shopId);
  // Typed `string`: the client must not try to parse a union of column lists into a row type.
  const jobColumns: string = detail ? JOB_COLUMNS : STATUS_JOB_COLUMNS;
  const quoteColumns: string = cost ? QUOTE_COLUMNS : STATUS_QUOTE_COLUMNS;
  const decisionColumns: string = detail ? DECISION_COLUMNS : STATUS_DECISION_COLUMNS;
  const settingColumns = [STATUS_SETTINGS_COLUMNS, ...(detail ? ["manual_providers"] : []), ...(cost ? ["gratuity_driver_bps"] : [])].join(",");

  // ONE read each: the jobs (THE job set of this response), the quotes, the settings.
  const [isEzcater, quotes, jobs, setting] = await Promise.all([
    readIsEzcater(sb, lead),
    pages<StatusQuoteRow & Partial<QuoteRow>>((from, to) => rowsOf(sb.from("catering_quotes").select(quoteColumns).eq("pipeline_id", leadId).is("superseded_at", null)
      .order("created_at").order("id").range(from, to))),
    pages<StatusJobRow & Partial<JobRow>>((from, to) => rowsOf(sb.from("delivery_job_current").select(jobColumns).eq("pipeline_id", leadId).order("attempt_no").order("id").range(from, to))),
    shopSetting<{ location_id: string; enabled: boolean; manual_providers?: unknown; gratuity_driver_bps?: number }>(sb, settingColumns, shopId),
  ]);
  const jobIds = jobs.map((j) => j.id);
  // Everything below is read for exactly those job ids.
  const decisions: Array<{ id: string; job_id: string; lead_location_id: string } & Partial<DecisionRow>> = [];
  for (const ids of chunks(jobIds)) {
    decisions.push(...await pages<{ id: string; job_id: string; lead_location_id: string } & Partial<DecisionRow>>((from, to) => rowsOf(sb.from("delivery_pickup_decisions").select(decisionColumns)
      .in("job_id", ids).order("job_id").order("id").range(from, to))));
  }
  const inSet = new Set(jobIds);
  const kept = decisions.filter((d) => inSet.has(d.job_id)).map((d) => ({ jobId: d.job_id, leadLocationId: d.lead_location_id }));

  const quote = orderQuoteOf(quotes.map((q) => ({ id: q.id, status: q.status, isDelivery: q.is_delivery === true, createdAt: q.created_at })));
  const derived = deliveryStateOf({
    stage: lead.stage, currentShopId: shopId, orderQuote: { kind: quote.kind, isDelivery: quote.isDelivery }, isEzcater, soon,
    jobs: jobs.map((j) => ({ attemptNo: j.attempt_no, status: j.status, open: j.closed_at === null, pickupShopId: j.location_id, keptForCurrentShop: keptForShop(kept, j.id, shopId) })),
  });
  const about = jobs.find((j) => j.attempt_no === derived.attemptNo) ?? jobs.reduce<(typeof jobs)[number] | null>((best, j) => (!best || j.attempt_no > best.attempt_no ? j : best), null);
  const view: Extract<LeadDeliveryView, { view: "lead" }> = {
    view: "lead", leadId, shopId, enabled: setting?.enabled === true, isEzcater, orderQuote: { kind: quote.kind, isDelivery: quote.isDelivery }, state: derived.state,
    status: about ? { attemptNo: about.attempt_no, status: about.status, statusAt: about.status_at, providerLabel: about.provider_label, pickupAt: about.pickup_at, dropoffAt: about.dropoff_at } : null,
  };
  if (detail) {
    const events = jobIds.length === 0 ? [] : (await readEvents(sb, jobIds)).filter((e) => inSet.has(e.jobId));
    view.detail = { jobs: jobs.map((j) => toJob(j as JobRow)), events,
      pickupDecisions: decisions.filter((d) => inSet.has(d.job_id)).map((d) => toDecision(d as DecisionRow)),
      manualProviders: Array.isArray(setting?.manual_providers) ? setting.manual_providers.filter((p): p is string => typeof p === "string") : [] };
  }
  if (cost) {
    const [costs, splits] = await Promise.all([
      jobIds.length === 0 ? Promise.resolve([] as DeliveryCostRow[]) : readCosts(sb, jobIds).then((rows) => rows.filter((r) => inSet.has(r.jobId))),
      readSplits(sb, leadId),
    ]);
    // Coverage is over THE job set: a job with no cost row in it makes the order partial, never complete.
    view.cost = { costs, orderCost: orderCost(jobIds.map((jobId) => ({ jobId, costs }))), splits, splitHead: splitHead(splits),
      candidates: quotes.map((q) => toCandidate(q as QuoteRow)), gratuityDriverBps: setting?.gratuity_driver_bps ?? null };
  }
  return view;
}

/**
 * The pickup shop's AGM / GM after the order moved away: the jobs recorded FOR THEIR SHOP only. Filtered BY
 * CONSTRUCTION — the query names only the viewer's own shops, and the rows are filtered again — so whatever else exists
 * on the lead (a replacement booked at the new shop) can never be in the answer.
 */
async function historyView(sb: Sb, who: DeliveryActor, lead: LeadRow): Promise<Extract<LeadDeliveryView, { view: "history" }> | null> {
  const member = who.locations.filter((shop) => deliveryJobHistoryReadAllowed(who, shop));
  if (member.length === 0) return null;
  // The pickup shop's own switch: history for a job at a shop that is off is nothing.
  const shops = await enabledShops(sb, member);
  if (shops.length === 0) return null;
  const mine: HistoryJobRow[] = [];
  for (const ids of chunks(shops)) {
    const rows = await pages<HistoryJobRow>((from, to) => sb.from("delivery_job_current").select(HISTORY_JOB_COLUMNS).eq("pipeline_id", lead.id).in("location_id", ids)
      .order("attempt_no").order("id").range(from, to));
    mine.push(...rows.filter((j) => j.pipeline_id === lead.id && shops.includes(j.location_id)));
  }
  if (mine.length === 0) return null;
  mine.sort((a, b) => a.attempt_no - b.attempt_no);
  const own = new Set(mine.map((j) => j.id));
  const events = (await readEvents(sb, [...own])).filter((e) => own.has(e.jobId));
  return { view: "history", leadId: lead.id, movedToShopId: lead.location_id, jobs: mine.map((j) => ({
    jobId: j.id, attemptNo: j.attempt_no, status: j.status, statusAt: j.status_at, providerLabel: j.provider_label, externalRef: j.external_ref,
    pickupAt: j.pickup_at, dropoffAt: j.dropoff_at, pickupShopId: j.location_id, events: events.filter((e) => e.jobId === j.id) })) };
}

/**
 * A lead's delivery for THIS viewer, or null (nothing they may see, or no such lead: a 404 at the route).
 * `soon` = the caller's "inside the shop's catering lead window" (it owns the clock).
 *
 * WHAT IS RETURNED IS BOUND TO THE SHOP THE GATES WERE JUDGED FOR (review DELIV1-r1, P1). The reads are separate
 * requests, so a transfer can commit between them: A's GM starts loading a lead at A (lead-scoped gates pass), the lead
 * moves to B, B records a replacement job, and the later reads would hand A's GM B's job. So, after ALL reads of an
 * attempt, the lead's shop is READ AGAIN; if it is not the shop the gates used, everything read is DISCARDED and the
 * load starts over against the new shop (at most `LOAD_ATTEMPTS` times, then the named, retryable `delivery_busy`).
 * WHY THAT IS SOUND: a job can be recorded at the destination shop only after the transfer committed (the writer reads
 * the lead's shop under the lead lock the transfer holds). So any read that saw a destination job ran after the
 * transfer's commit, and the re-read, which runs after every such read, sees the moved shop. An answer is returned only
 * when the shop before and after the reads is the same one — the one its gates were judged for. (A lead that left and
 * came BACK between the two reads is again at the judged shop, where this viewer's lead-scoped gates hold for every
 * job of the lead.) Independently, the history view filters by construction (`historyView`).
 */
export async function loadLeadDelivery(actor: AuthContext, leadId: string, deps: { client?: Sb; soon?: boolean } = {}): Promise<LeadDeliveryView | null> {
  if (!deliveryTrackingOn()) return { view: "off" };
  const who = deliveryActorOf(actor);
  if (!deliveryReadPossible(who)) throw new DeliveryError(403, "forbidden");
  const sb = deps.client ?? getServiceRoleClient();
  try {
    for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt += 1) {
      const lead = await readLead(sb, leadId);
      if (!lead) return null;
      const view = deliveryStatusReadAllowed(who, lead.location_id) ? await leadView(sb, who, lead, deps.soon === true) : await historyView(sb, who, lead);
      // The lead's shop AFTER every read of this attempt.
      const after = await readLead(sb, leadId);
      if (!after) return null;
      if (after.location_id === lead.location_id) return view;
      // It moved under the reads: nothing read in this attempt is returned.
    }
    throw new DeliveryError(deliveryErrorStatus("delivery_busy"), "delivery_busy");
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "delivery_unavailable") return { view: "not_installed" };
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError(500, "generic");
  }
}

// ── The pickup shop's entry point after an order moved away (D2) ─────────────
/** How far back the list looks (by the job's `created_at`). A moved order's delivery is settled within days. */
export const MOVED_DELIVERY_WINDOW_DAYS = 90;
/**
 * One row of "Deliveries booked here for orders that moved". The job only: no customer field, no lead state, no cost,
 * no reference, no note. The detail is the history-only read (`loadLeadDelivery`, `view: "history"`).
 */
export interface MovedDeliveryRow {
  leadId: string; jobId: string; attemptNo: number; status: DeliveryStatus; statusAt: string; providerLabel: string;
  pickupAt: string | null; dropoffAt: string | null; pickupShopId: string; pickupShopName: string | null;
  movedToShopId: string | null; movedToShopName: string | null;
}
type MovedJobRow = Pick<JobRow, "id" | "pipeline_id" | "location_id" | "provider_label" | "attempt_no" | "pickup_at" | "dropoff_at" | "status" | "status_at" | "created_at">;
/**
 * The jobs recorded FOR a shop this AGM / GM belongs to whose order now sits at a shop they do NOT read (so the lead is
 * gone from their pipeline). Exactly the set the history gate opens: `deliveryJobHistoryReadAllowed` for the job, the
 * pickup shop's own switch ON (`enabledShops`: off means off), and no lead-scoped status read. Anyone else or the switch
 * off = [] with no query; no enabled shop or 0356 missing = []. Any other failure is THROWN (the caller says
 * "couldn't load", never an empty list). The query names only the list's own columns. Newest first. `now` is the caller's clock.
 */
export async function loadMovedDeliveries(actor: AuthContext, deps: { client?: Sb; now?: Date } = {}): Promise<MovedDeliveryRow[]> {
  if (!deliveryTrackingOn()) return [];
  const who = deliveryActorOf(actor);
  const member = [...new Set(who.locations)].sort().filter((shop) => deliveryJobHistoryReadAllowed(who, shop));
  if (member.length === 0) return [];
  const sb = deps.client ?? getServiceRoleClient();
  const since = new Date((deps.now ?? new Date()).getTime() - MOVED_DELIVERY_WINDOW_DAYS * 86_400_000).toISOString();
  try {
    const shops = await enabledShops(sb, member);
    if (shops.length === 0) return [];
    const jobs: MovedJobRow[] = [];
    for (const ids of chunks(shops)) {
      const rows = await pages<MovedJobRow>((from, to) => sb.from("delivery_job_current").select(MOVED_JOB_COLUMNS).in("location_id", ids).gte("created_at", since)
        .order("created_at").order("id").range(from, to));
      jobs.push(...rows.filter((j) => shops.includes(j.location_id)));
    }
    if (jobs.length === 0) return [];
    const leadShop = new Map<string, string | null>();
    for (const ids of chunks([...new Set(jobs.map((j) => j.pipeline_id))].sort())) {
      const rows = await pages<{ id: string; location_id: string | null }>((from, to) => sb.from("catering_pipeline").select("id,location_id").in("id", ids).order("id").range(from, to));
      for (const r of rows) leadShop.set(r.id, r.location_id);
    }
    const moved = jobs.filter((j) => {
      if (!leadShop.has(j.pipeline_id)) return false;
      const current = leadShop.get(j.pipeline_id) ?? null;
      return current !== j.location_id && !deliveryStatusReadAllowed(who, current);
    });
    if (moved.length === 0) return [];
    const names = new Map<string, string>();
    const shopIds = [...new Set(moved.flatMap((j) => [j.location_id, leadShop.get(j.pipeline_id) ?? null]).filter((id): id is string => id !== null))].sort();
    for (const ids of chunks(shopIds)) {
      const rows = await pages<{ id: string; name: string }>((from, to) => sb.from("locations").select("id,name").in("id", ids).order("id").range(from, to));
      for (const r of rows) names.set(r.id, r.name);
    }
    // Newest first, by when the job was recorded (a list order only: nothing is decided by it).
    moved.sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return moved.map((j) => {
      const current = leadShop.get(j.pipeline_id) ?? null;
      return { leadId: j.pipeline_id, jobId: j.id, attemptNo: j.attempt_no, status: j.status, statusAt: j.status_at, providerLabel: j.provider_label, pickupAt: j.pickup_at,
        dropoffAt: j.dropoff_at, pickupShopId: j.location_id, pickupShopName: names.get(j.location_id) ?? null, movedToShopId: current,
        movedToShopName: current ? names.get(current) ?? null : null };
    });
  } catch (error) {
    // Not installed = nothing to list. Any other failure is the caller's to show.
    if (error instanceof DeliveryError && error.code === "delivery_unavailable") return [];
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError(500, "generic");
  }
}

/** The pickup shop's result for a page: the rows, or an explicit "couldn't load" (never a silent empty list). */
export type MovedDeliveries = { ok: true; rows: MovedDeliveryRow[] } | { ok: false };
/** Bounded like every delivery read that rides beside other data (`boundedDeliveryRead`): a read that throws OR hangs is
 *  `{ ok: false }` after `DELIVERY_READ_DEADLINE_MS`, so the pipeline page it sits on always renders. */
export async function loadMovedDeliveriesSafe(actor: AuthContext, deps: { client?: Sb; now?: Date; deadlineMs?: number } = {}): Promise<MovedDeliveries> {
  return boundedDeliveryRead(async (): Promise<MovedDeliveries> => ({ ok: true, rows: await loadMovedDeliveries(actor, deps) }), deps.deadlineMs);
}

// ── Writes ──────────────────────────────────────────────────────────────────
/**
 * Before the writer is called, in this order: the switch; the write gate at the shop the person SAW (no I/O yet); then
 * that shop's own switch — OFF MEANS OFF, for every writer, with no exception (an open job at a shop that is turned off
 * waits until it is turned on again). SQL refuses the same three under the lead lock; this read only saves the call.
 */
async function openWrite(actor: AuthContext, expectedShopId: string | null, client: Sb | undefined): Promise<Sb> {
  if (!deliveryTrackingOn()) throw deliveryOff();
  if (!deliveryWriteAllowed(deliveryActorOf(actor), expectedShopId)) throw new DeliveryError(403, "forbidden");
  const sb = client ?? getServiceRoleClient();
  const setting = await shopSetting<{ location_id: string; enabled: boolean }>(sb, STATUS_SETTINGS_COLUMNS, expectedShopId);
  if (setting?.enabled !== true) throw new DeliveryError(deliveryErrorStatus("delivery_off"), "delivery_off");
  return sb;
}
async function call<T extends Record<string, unknown>>(sb: Sb, fn: string, args: Record<string, unknown>, uniqueViolation?: DeliverySqlRefusal): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw deliveryErrorFrom(error, uniqueViolation);
  // A writer always answers an object; anything else is a failure, never a silent success.
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DeliveryError(500, "generic");
  return data as T;
}

/**
 * A job-level route names its lead in the URL (`/pipeline/[id]/delivery/[jobId]/...`). The job must be THAT lead's:
 * `pipeline_id` never changes, so one read after the gate is enough. Anything else is `job_not_found` (404), before the
 * writer. Read from the view like every other job read, and it names the two ids only (no tier-restricted column).
 */
async function assertJobOfLead(sb: Sb, jobId: string, leadId: string | null | undefined): Promise<void> {
  if (leadId === null || leadId === undefined) return;
  const { data, error } = await sb.from("delivery_job_current").select("id,pipeline_id").eq("id", jobId).maybeSingle<{ id: string; pipeline_id: string }>();
  if (error) throw deliveryErrorFrom(error);
  if (!data || data.pipeline_id !== leadId) throw new DeliveryError(404, "job_not_found");
}

export interface RecordDeliveryJobInput {
  leadId: string;
  /** The lead's shop as the person saw it. */
  expectedShopId: string | null;
  providerLabel: string;
  externalRef: string | null;
  /** `manual` = a courier we booked outside CO-OPS; `provider_native` = the courier ezCater sent (ezCater leads only). */
  bookedVia: Exclude<DeliveryBookedVia, "co_ops_api">;
  pickupAt: string | null;
  dropoffAt: string | null;
  /** Null = not known yet (the cost stays UNKNOWN, not zero). */
  costCents: number | null;
  note: string | null;
}
export async function recordManualDeliveryJob(actor: AuthContext, input: RecordDeliveryJobInput, deps: { client?: Sb } = {}): Promise<{ jobId: string; attemptNo: number }> {
  const sb = await openWrite(actor, input.expectedShopId, deps.client);
  const out = await call<{ job_id?: unknown; attempt_no?: unknown }>(sb, "record_manual_delivery_job", {
    p_actor_id: actor.user.id, p_lead_id: input.leadId, p_expected_shop: input.expectedShopId, p_provider_label: input.providerLabel,
    p_external_ref: input.externalRef, p_booked_via: input.bookedVia, p_pickup_at: input.pickupAt, p_dropoff_at: input.dropoffAt,
    p_cost_cents: input.costCents, p_note: input.note,
  }, "delivery_job_open");
  if (typeof out.job_id !== "string" || typeof out.attempt_no !== "number") throw new DeliveryError(500, "generic");
  return { jobId: out.job_id, attemptNo: out.attempt_no };
}

export interface RecordDeliveryEventInput {
  jobId: string; expectedShopId: string | null;
  /** The lead the route named; when given, the job must be that lead's (`job_not_found`). */
  leadId?: string | null;
  /** The status the person saw (a stale one is `status_moved`). */
  expectedStatus: DeliveryStatus;
  status: ManualDeliveryStatus;
  /** When it happened, as entered. Information only; null = now. */
  occurredAt: string | null;
  note: string | null;
}
export async function recordDeliveryEvent(actor: AuthContext, input: RecordDeliveryEventInput, deps: { client?: Sb } = {}):
  Promise<{ jobId: string; status: DeliveryStatus; statusSeq: number; closed: boolean; splitId: string | null }> {
  const sb = await openWrite(actor, input.expectedShopId, deps.client);
  await assertJobOfLead(sb, input.jobId, input.leadId);
  const out = await call<{ job_id?: unknown; status?: unknown; status_seq?: unknown; closed?: unknown; split_id?: unknown }>(sb, "record_delivery_event", {
    p_actor_id: actor.user.id, p_job_id: input.jobId, p_expected_shop: input.expectedShopId, p_expected_status: input.expectedStatus,
    p_status: input.status, p_occurred_at: input.occurredAt, p_note: input.note,
  });
  if (typeof out.job_id !== "string" || typeof out.status !== "string" || typeof out.status_seq !== "number") throw new DeliveryError(500, "generic");
  return { jobId: out.job_id, status: out.status as DeliveryStatus, statusSeq: out.status_seq, closed: out.closed === true, splitId: typeof out.split_id === "string" ? out.split_id : null };
}

export interface RecordDeliveryCostInput {
  jobId: string; expectedShopId: string | null; component: DeliveryCostComponent;
  /** The lead the route named; when given, the job must be that lead's (`job_not_found`). */
  leadId?: string | null;
  /** A credit is <= 0; every other component is >= 0. An explicit 0 is a record ("no charge"). */
  amountCents: number;
  /** Null = a first observation; else the CURRENT head of that figure, and `note` (the reason) is required. */
  correctsId: string | null;
  note: string | null;
}
export async function recordDeliveryCost(actor: AuthContext, input: RecordDeliveryCostInput, deps: { client?: Sb } = {}): Promise<{ costId: string }> {
  const sb = await openWrite(actor, input.expectedShopId, deps.client);
  await assertJobOfLead(sb, input.jobId, input.leadId);
  const out = await call<{ cost_id?: unknown }>(sb, "record_delivery_cost", {
    p_actor_id: actor.user.id, p_job_id: input.jobId, p_expected_shop: input.expectedShopId, p_component: input.component,
    p_amount_cents: input.amountCents, p_corrects_id: input.correctsId, p_note: input.note,
  }, input.correctsId === null ? "cost_exists" : "not_current_head");
  if (typeof out.cost_id !== "string") throw new DeliveryError(500, "generic");
  return { costId: out.cost_id };
}

export async function keepDeliveryPickup(actor: AuthContext, input: { jobId: string; expectedShopId: string | null; note: string | null; leadId?: string | null }, deps: { client?: Sb } = {}):
  Promise<{ decisionId: string }> {
  const sb = await openWrite(actor, input.expectedShopId, deps.client);
  await assertJobOfLead(sb, input.jobId, input.leadId);
  const out = await call<{ decision_id?: unknown }>(sb, "keep_delivery_pickup", {
    p_actor_id: actor.user.id, p_job_id: input.jobId, p_expected_shop: input.expectedShopId, p_note: input.note,
  }, "already_kept");
  if (typeof out.decision_id !== "string") throw new DeliveryError(500, "generic");
  return { decisionId: out.decision_id };
}

export interface RecordGratuitySplitInput {
  leadId: string; expectedShopId: string | null;
  /** `recompute` = the quote changed after delivery; `void` = the delivery recorded as delivered never happened. */
  mode: "recompute" | "void";
  /** The head the person saw; null = they saw none. */
  expectedHeadId: string | null;
  reason: string;
}
/** RECORDED ONLY: this pays nothing. The payroll and legal treatment of the driver's share is UNVERIFIED. */
export async function recordDeliveryGratuitySplit(actor: AuthContext, input: RecordGratuitySplitInput, deps: { client?: Sb } = {}):
  Promise<{ splitId: string; kind: "split" | "void"; jobId: string | null; gratuityCents: number; driverBps: number; driverCents: number; crewCents: number }> {
  const sb = await openWrite(actor, input.expectedShopId, deps.client);
  const out = await call<Record<string, unknown>>(sb, "record_delivery_gratuity_split", {
    p_actor_id: actor.user.id, p_lead_id: input.leadId, p_expected_shop: input.expectedShopId, p_mode: input.mode,
    p_expected_head: input.expectedHeadId, p_reason: input.reason,
  }, "split_moved");
  const n = (k: string) => (typeof out[k] === "number" ? out[k] as number : null);
  const g = n("gratuity_cents"), bps = n("driver_bps"), d = n("driver_cents"), c = n("crew_cents");
  if (typeof out.split_id !== "string" || (out.kind !== "split" && out.kind !== "void") || g === null || bps === null || d === null || c === null) throw new DeliveryError(500, "generic");
  return { splitId: out.split_id, kind: out.kind, jobId: typeof out.job_id === "string" ? out.job_id : null, gratuityCents: g, driverBps: bps, driverCents: d, crewCents: c };
}

/**
 * Catering delivery (D4) — the delivery ECONOMICS read for one shop and one period (plan r6 section 6.3). Server-only.
 * The fifth section of /reports/sales/catering. The rules are pure, in ./economics-shared.ts; this module only reads.
 *
 * IN THIS ORDER:
 *   1. the switch (`DELIVERY_TRACKING`): off = `{ kind: "off" }` with NO query;
 *   2. the COST gate at the shop, by trusted role, BEFORE ANY I/O: refused = `{ kind: "off" }` with NO query (the
 *      report page's own gates decide who opens the page; this gate decides who reads delivery money);
 *   3. the shop's own switch (`delivery_settings`, ONE read): off, no row, or 0356 not on the database =
 *      `{ kind: "off" }` with ZERO further queries. Off means off;
 *   4. the reads. Each relation is read ONCE, paged, with its id lists chunked; the number of relations is fixed (it
 *      never grows with the number of orders).
 * WHICH ORDERS: leads AT THIS SHOP NOW whose EVENT DATE falls in the period, that are delivery orders
 * (`isDeliveryOrder`). Scope follows the lead; a job's pickup shop never decides it.
 * WHAT IS RETURNED IS BOUND TO THE SHOP THE GATE WAS JUDGED FOR: the reads are separate requests, so after ALL of them
 * the leads' shops are read again; if one moved away, everything is discarded and the load starts over (the lib's rule,
 * `LOAD_ATTEMPTS`), then it fails.
 * A FAILED READ IS ITS OWN RESULT: `{ kind: "failed" }`. Never zeros, never an empty report, and never a throw — the
 * section says "couldn't load" and the four sales sections beside it are untouched. `loadDeliveryEconomicsBounded` adds
 * a deadline, so a read that never answers cannot hold the page either.
 * The queries name no customer field, no note, no reason, no reference, and NO pipeline-value source: nothing read here
 * is a sales figure, and nothing here is ever added to one.
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { deliveryActorOf, deliveryCostReadAllowed } from "./access-shared";
import { deliveryTrackingOn } from "./config";
import type { CostFoldRow } from "./cost-shared";
import { deliveryEconomics, isDeliveryOrder, type DeliveryEconomicsReport, type EconomicsJob, type OrderEconomicsInput } from "./economics-shared";
import { DeliveryError, deliveryErrorFrom } from "./errors";
import type { SplitFoldRow } from "./gratuity-shared";
import { LOAD_ATTEMPTS } from "./jobs";
import type { DeliveryBookedVia, DeliveryLeadStage, DeliveryStatus, QuoteCandidate } from "./types-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
type Paged<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>;

/** Ids per `.in()` list: 100 uuids stay far inside the request line. */
const IN_CHUNK = 100;
/** How long the report page waits for this section before it says "couldn't load". */
export const DELIVERY_ECONOMICS_DEADLINE_MS = 8_000;

// The columns of each read: exactly what the rules use.
export const ECON_SETTINGS_COLUMNS = "location_id,enabled,gratuity_driver_bps";
export const ECON_LEAD_COLUMNS = "id,location_id,stage,lead_source,event_date";
export const ECON_EZCATER_COLUMNS = "id,lead_id";
export const ECON_QUOTE_COLUMNS = "id,pipeline_id,status,is_delivery,gratuity_cents,delivery_fee_cents,created_at";
export const ECON_JOB_COLUMNS = "id,pipeline_id,booked_via,provider_label,attempt_no,status";
export const ECON_COST_COLUMNS = "id,job_id,component,semantics,amount_cents,money_identity,observed_at,corrects_id";
export const ECON_SPLIT_COLUMNS = "id,pipeline_id,job_id,kind,gratuity_cents,driver_bps,driver_cents,crew_cents,supersedes_id";
export const ECON_RECHECK_COLUMNS = "id,location_id";

interface LeadRow { id: string; location_id: string | null; stage: DeliveryLeadStage; lead_source: string | null; event_date: string | null }
interface QuoteRow { id: string; pipeline_id: string; status: QuoteCandidate["status"]; is_delivery: boolean; gratuity_cents: number; delivery_fee_cents: number; created_at: string }
interface JobRow { id: string; pipeline_id: string; booked_via: DeliveryBookedVia; provider_label: string; attempt_no: number; status: DeliveryStatus }
interface CostRow { id: string; job_id: string; component: CostFoldRow["component"]; semantics: CostFoldRow["semantics"]; amount_cents: number; money_identity: string; observed_at: string; corrects_id: string | null }
interface SplitRow { id: string; pipeline_id: string; job_id: string | null; kind: "split" | "void"; gratuity_cents: number; driver_bps: number; driver_cents: number; crew_cents: number; supersedes_id: string | null }

export interface DeliveryEconomicsScope { locationId: string }
export interface DeliveryEconomicsRange { from: string; to: string; empty?: boolean }
export type DeliveryEconomicsResult =
  /** Nothing renders: the switch, the shop's switch, 0356 not installed, or a viewer who may not read delivery money. */
  | { kind: "off"; reason: "switch" | "forbidden" | "shop" | "not_installed" }
  /** The read failed (or did not answer in time). The section says so; it never shows zeros. */
  | { kind: "failed" }
  | { kind: "ok"; locationId: string; from: string; to: string; report: DeliveryEconomicsReport };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function chunks<T>(list: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
/** The whole set or a named error: a failed page is never an empty list. */
async function pages<T>(build: (from: number, to: number) => Paged<T>): Promise<T[]> {
  return selectAllRows<T>(async (from, to) => {
    const res = await build(from, to);
    if (res.error) throw deliveryErrorFrom(res.error);
    return res;
  });
}
/** One relation, read once for an id list: chunked and paged, the rows of every chunk together. */
async function byIds<T>(ids: readonly string[], build: (chunk: string[], from: number, to: number) => Paged<T>): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of chunks(ids)) out.push(...await pages<T>((from, to) => build(chunk, from, to)));
  return out;
}
function group<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(row); else out.set(k, [row]);
  }
  return out;
}

/** One attempt: the report, or null when a lead left the shop while it was being read. */
async function readOnce(sb: Sb, shopId: string, range: DeliveryEconomicsRange, driverBps: number | null): Promise<DeliveryEconomicsReport | null> {
  const leads = await pages<LeadRow>((from, to) => sb.from("catering_pipeline").select(ECON_LEAD_COLUMNS).eq("location_id", shopId)
    .gte("event_date", range.from).lte("event_date", range.to).order("event_date").order("id").range(from, to));
  // Bound to the shop by the query AND again on the rows.
  const mine = leads.filter((l) => l.location_id === shopId);
  if (mine.length === 0) return deliveryEconomics([]);
  const leadIds = mine.map((l) => l.id).sort();

  const [ezcater, quotes, jobs, splits] = await Promise.all([
    byIds<{ id: string; lead_id: string | null }>(leadIds, (ids, from, to) => sb.from("ezcater_orders").select(ECON_EZCATER_COLUMNS).in("lead_id", ids).order("id").range(from, to)),
    byIds<QuoteRow>(leadIds, (ids, from, to) => sb.from("catering_quotes").select(ECON_QUOTE_COLUMNS).in("pipeline_id", ids).is("superseded_at", null)
      .order("created_at").order("id").range(from, to)),
    byIds<JobRow>(leadIds, (ids, from, to) => sb.from("delivery_job_current").select(ECON_JOB_COLUMNS).in("pipeline_id", ids).order("pipeline_id").order("attempt_no").order("id").range(from, to)),
    byIds<SplitRow>(leadIds, (ids, from, to) => sb.from("delivery_gratuity_splits").select(ECON_SPLIT_COLUMNS).in("pipeline_id", ids).order("pipeline_id").order("recorded_at").order("id").range(from, to)),
  ]);
  const inScope = new Set(leadIds);
  const scopedJobs = jobs.filter((j) => inScope.has(j.pipeline_id));
  // Costs are read for exactly the jobs of this response: coverage can never be judged over another job set.
  const jobIds = scopedJobs.map((j) => j.id).sort();
  const jobSet = new Set(jobIds);
  const costs = (await byIds<CostRow>(jobIds, (ids, from, to) => sb.from("delivery_job_costs").select(ECON_COST_COLUMNS).in("job_id", ids).order("job_id").order("observed_at").order("id").range(from, to)))
    .filter((c) => jobSet.has(c.job_id));

  // The leads' shops AFTER every read: a lead that moved away takes the whole attempt with it.
  const after = await byIds<{ id: string; location_id: string | null }>(leadIds, (ids, from, to) => sb.from("catering_pipeline").select(ECON_RECHECK_COLUMNS).in("id", ids).order("id").range(from, to));
  const still = new Map(after.map((l) => [l.id, l.location_id]));
  if (leadIds.some((id) => still.get(id) !== shopId)) return null;

  const ezcaterLeads = new Set(ezcater.map((e) => e.lead_id).filter((id): id is string => id !== null));
  const quotesOf = group(quotes, (q) => q.pipeline_id), jobsOf = group(scopedJobs, (j) => j.pipeline_id), splitsOf = group(splits, (s) => s.pipeline_id);
  const costsOf = group(costs, (c) => c.job_id);
  const inputs: OrderEconomicsInput[] = [];
  for (const lead of mine) {
    const leadJobs: EconomicsJob[] = (jobsOf.get(lead.id) ?? []).map((j) => ({ id: j.id, attemptNo: j.attempt_no, status: j.status, bookedVia: j.booked_via, providerLabel: j.provider_label }));
    const input: OrderEconomicsInput = {
      leadId: lead.id, eventDate: lead.event_date, stage: lead.stage,
      // Durable ezCater-ness: the source label OR an ezcater_orders row naming the lead (the label is editable).
      isEzcater: lead.lead_source === "ezcater" || ezcaterLeads.has(lead.id),
      candidates: (quotesOf.get(lead.id) ?? []).map((q): QuoteCandidate => ({ id: q.id, status: q.status, isDelivery: q.is_delivery === true, gratuityCents: q.gratuity_cents,
        deliveryFeeCents: q.delivery_fee_cents, createdAt: q.created_at })),
      jobs: leadJobs,
      costs: leadJobs.flatMap((j) => costsOf.get(j.id) ?? []).map((c): CostFoldRow => ({ id: c.id, jobId: c.job_id, component: c.component, semantics: c.semantics, amountCents: c.amount_cents,
        moneyIdentity: c.money_identity, observedAt: c.observed_at, correctsId: c.corrects_id })),
      splits: (splitsOf.get(lead.id) ?? []).map((s): SplitFoldRow => ({ id: s.id, jobId: s.job_id, kind: s.kind, gratuityCents: s.gratuity_cents, driverBps: s.driver_bps,
        driverCents: s.driver_cents, crewCents: s.crew_cents, supersedesId: s.supersedes_id })),
      driverBps,
    };
    if (isDeliveryOrder(input)) inputs.push(input);
  }
  return deliveryEconomics(inputs);
}

/**
 * The delivery economics of ONE shop over [from, to] (event dates), for `actor`. Never throws.
 * `actor` is the auth context (trusted role, active flag, live memberships).
 */
export async function loadDeliveryEconomics(sb: Sb, actor: Parameters<typeof deliveryActorOf>[0], scope: DeliveryEconomicsScope, range: DeliveryEconomicsRange): Promise<DeliveryEconomicsResult> {
  if (!deliveryTrackingOn()) return { kind: "off", reason: "switch" };
  if (!UUID.test(scope.locationId) || !deliveryCostReadAllowed(deliveryActorOf(actor), scope.locationId)) return { kind: "off", reason: "forbidden" };
  if (!DAY.test(range.from) || !DAY.test(range.to)) return { kind: "failed" };
  const shopId = scope.locationId;
  try {
    const setting = await sb.from("delivery_settings").select(ECON_SETTINGS_COLUMNS).eq("location_id", shopId).maybeSingle<{ location_id: string; enabled: boolean; gratuity_driver_bps: number }>();
    if (setting.error) throw deliveryErrorFrom(setting.error);
    if (setting.data?.enabled !== true) return { kind: "off", reason: "shop" };
    if (range.empty === true || range.from > range.to) return { kind: "ok", locationId: shopId, from: range.from, to: range.to, report: deliveryEconomics([]) };
    for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt += 1) {
      const report = await readOnce(sb, shopId, range, setting.data.gratuity_driver_bps ?? null);
      if (report) return { kind: "ok", locationId: shopId, from: range.from, to: range.to, report };
    }
    return { kind: "failed" };
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "delivery_unavailable") return { kind: "off", reason: "not_installed" };
    return { kind: "failed" };
  }
}

/**
 * The report page's call: the default client, and a DEADLINE. Resolves `{ kind: "failed" }` when the read has not
 * answered in `deadlineMs`; never rejects. So a delivery read that hangs or fails costs the page this one section.
 */
export async function loadDeliveryEconomicsBounded(actor: Parameters<typeof deliveryActorOf>[0], scope: DeliveryEconomicsScope, range: DeliveryEconomicsRange,
  deps: { client?: Sb; deadlineMs?: number } = {}): Promise<DeliveryEconomicsResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The switch and the gate answer before a client exists: off stays zero work.
    const read = Promise.resolve().then(() => loadDeliveryEconomics(deps.client ?? (deliveryTrackingOn() ? getServiceRoleClient() : (null as never)), actor, scope, range));
    const late = new Promise<DeliveryEconomicsResult>((resolve) => { timer = setTimeout(() => resolve({ kind: "failed" }), deps.deadlineMs ?? DELIVERY_ECONOMICS_DEADLINE_MS); });
    return await Promise.race([read, late]);
  } catch {
    return { kind: "failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

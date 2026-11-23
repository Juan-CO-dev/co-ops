/**
 * Catering delivery D3 — the ONE loader of the money-free delivery fact (plan r6 section 6.2). Service role. Server-only.
 *
 * EVERY ENTRY POINT, IN THIS ORDER (the D1 law):
 *   1. the switch (`DELIVERY_TRACKING`): off = `{ off: true }` with NO query;
 *   2. the gate, by trusted role, BEFORE ANY I/O: the STATUS read (`deliveryStatusReadAllowed`) at the shop — a viewer
 *      it refuses gets `{ off: true }`, also with no query;
 *   3. the shop's own switch (`delivery_settings.enabled`, no row = off): ONE read; off, or 0356 not on the database
 *      (42P01 / 42883 / PGRST202 / PGRST205) = `{ off: true }` and ZERO further queries;
 *   4. the reads. A real failure = `{ ok: false }`: it is never an empty list, so nothing reads "to book" from it.
 *
 * THE SELECTS NAME NO MONEY, NAME, ADDRESS, COURIER LABEL, REFERENCE OR NOTE (the column lists below are pinned by
 * tests/delivery-day.test.ts and run against the real 0356 schema by tests/delivery-loader-schema-check.test.ts).
 *
 * `loadDeliveryDay` — a shop's day. Its lead set, read here:
 *   (a) leads at the shop with `event_date` = the day in confirmed / out / completed;
 *   (b) EVERY lead at the shop — any date, any stage — that has an OPEN job (read from `delivery_job_current where
 *       closed_at is null` first; small by construction: one open job per lead). This is the set that carries a rejected
 *       order whose courier is still booked.
 * `loadDeliveryStates` — the same fact for a list of lead ids (the pipeline's cards), each lead judged at its CURRENT shop.
 *
 * A fixed number of query KINDS; every list is paged and every id list is chunked. And the D1 rule for a reader that
 * spans several requests: after ALL reads the leads' shops are read AGAIN, and a lead that is no longer at the shop its
 * gate was judged for is DROPPED (nothing read about it is returned).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { deliveryActorOf, deliveryStatusReadAllowed, type DeliveryActor } from "./access-shared";
import { deliveryTrackingOn } from "./config";
import {
  deliveryDayLeads, deliveryRowStateOf, type DayDecisionRow, type DayEzcaterRow, type DayJobRow, type DayLeadRow, type DayQuoteRow, type DeliveryDayLead,
  type DeliveryDayResult, type DeliveryRowState,
} from "./day-shared";
import { DELIVERY_NOT_INSTALLED } from "./errors";

type Sb = SupabaseClient;

export const DAY_SETTINGS_COLUMNS = "location_id,enabled";
export const DAY_LEAD_COLUMNS = "id,location_id,stage,lead_source";
export const DAY_OPEN_JOB_COLUMNS = "id,pipeline_id";
export const DAY_JOB_COLUMNS = "id,pipeline_id,location_id,attempt_no,closed_at,status,status_at,pickup_at";
export const DAY_DECISION_COLUMNS = "id,job_id,lead_location_id";
export const DAY_QUOTE_COLUMNS = "id,pipeline_id,status,is_delivery,created_at";
export const DAY_EZCATER_COLUMNS = "id,lead_id";
export const DAY_SHOP_RECHECK_COLUMNS = "id,location_id";
/** The stages an order of the day is in (`BOOKED_STAGES`, lib/catering/booked-events.ts). */
const DAY_STAGES = ["confirmed", "out", "completed"] as const;

/** Ids per `.in()` list: 100 uuids stay far inside the request line. */
const IN_CHUNK = 100;
async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...await read(ids.slice(i, i + IN_CHUNK)));
  return out;
}
class NotInstalled extends Error {}
/** A paged read: the whole set, or a throw (`NotInstalled` when 0356 is missing). Never a partial or empty list. */
function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<T[]> {
  return selectAllRows<T>(async (from, to) => {
    const res = await build(from, to);
    if (res.error?.code && DELIVERY_NOT_INSTALLED.has(res.error.code)) throw new NotInstalled();
    return res as { data: T[] | null; error: { message: string } | null };
  });
}

/** The shops among `shopIds` whose own switch is on. Throws `NotInstalled` when 0356 is not on the database. */
async function enabledShops(sb: Sb, shopIds: readonly string[]): Promise<Set<string>> {
  const rows = await inChunks([...shopIds], (chunk) => pages<{ location_id: string; enabled: boolean }>((from, to) =>
    sb.from("delivery_settings").select(DAY_SETTINGS_COLUMNS).in("location_id", chunk).order("location_id").range(from, to)));
  return new Set(rows.filter((r) => r.enabled === true).map((r) => r.location_id));
}

/**
 * The fact for these lead rows: their jobs (ALL of them), the pickup decisions, the live quote revisions, the ezCater
 * rows naming them — then the shop re-check. `shopOf` is the shop each lead's gate was judged for.
 */
async function factFor(sb: Sb, leads: readonly DayLeadRow[]): Promise<DeliveryDayLead[]> {
  const ids = [...new Set(leads.map((l) => l.id))];
  if (ids.length === 0) return [];
  const [jobs, quotes, ezcater] = await Promise.all([
    inChunks(ids, (chunk) => pages<DayJobRow>((from, to) => sb.from("delivery_job_current").select(DAY_JOB_COLUMNS).in("pipeline_id", chunk)
      .order("pipeline_id").order("attempt_no").order("id").range(from, to))),
    inChunks(ids, (chunk) => pages<DayQuoteRow>((from, to) => sb.from("catering_quotes").select(DAY_QUOTE_COLUMNS).in("pipeline_id", chunk).is("superseded_at", null)
      .order("created_at").order("id").range(from, to))),
    inChunks(ids, (chunk) => pages<DayEzcaterRow>((from, to) => sb.from("ezcater_orders").select(DAY_EZCATER_COLUMNS).in("lead_id", chunk).order("id").range(from, to))),
  ]);
  const decisions = await inChunks(jobs.map((j) => j.id), (chunk) => pages<DayDecisionRow>((from, to) =>
    sb.from("delivery_pickup_decisions").select(DAY_DECISION_COLUMNS).in("job_id", chunk).order("job_id").order("id").range(from, to)));
  // AFTER every read: each lead's shop again. A lead that moved is dropped — a job recorded at the destination can
  // only have been seen after the transfer committed, and this read runs after that one.
  const after = new Map((await inChunks(ids, (chunk) => pages<{ id: string; location_id: string | null }>((from, to) =>
    sb.from("catering_pipeline").select(DAY_SHOP_RECHECK_COLUMNS).in("id", chunk).order("id").range(from, to)))).map((r) => [r.id, r.location_id]));
  const still = leads.filter((l) => after.has(l.id) && after.get(l.id) === l.location_id);
  return deliveryDayLeads({ leads: still, jobs, decisions, quotes, ezcater });
}

/**
 * A shop's delivery day for THIS viewer. `date` = the ET operational day (YYYY-MM-DD).
 * Queries when on: the shop's switch (1) · open jobs (1) · the day's leads (1) · the open jobs' leads at this shop
 * (0 when nothing is open) · then, only when there is a lead: jobs, quotes, ezCater rows, the shop re-check (1 each per
 * 100 leads) and the pickup decisions (0 when there is no job).
 */
export async function loadDeliveryDay(sb: Sb, actor: DeliveryActor, shopId: string, date: string): Promise<DeliveryDayResult> {
  if (!deliveryTrackingOn()) return { off: true };
  if (!deliveryStatusReadAllowed(actor, shopId)) return { off: true };
  try {
    if (!(await enabledShops(sb, [shopId])).has(shopId)) return { off: true };
    const [open, today] = await Promise.all([
      pages<{ id: string; pipeline_id: string }>((from, to) => sb.from("delivery_job_current").select(DAY_OPEN_JOB_COLUMNS).is("closed_at", null).order("id").range(from, to)),
      pages<DayLeadRow>((from, to) => sb.from("catering_pipeline").select(DAY_LEAD_COLUMNS).eq("location_id", shopId).eq("event_date", date).in("stage", [...DAY_STAGES])
        .order("id").range(from, to)),
    ]);
    const known = new Set(today.map((l) => l.id));
    const openIds = [...new Set(open.map((j) => j.pipeline_id))].filter((id) => !known.has(id));
    // (b): the open jobs' leads that sit at THIS shop now, whatever their date or stage.
    const withOpen = await inChunks(openIds, (chunk) => pages<DayLeadRow>((from, to) =>
      sb.from("catering_pipeline").select(DAY_LEAD_COLUMNS).eq("location_id", shopId).in("id", chunk).order("id").range(from, to)));
    const leads = [...today, ...withOpen].filter((l) => l.location_id === shopId);
    return { ok: true, leads: await factFor(sb, leads) };
  } catch (error) {
    if (error instanceof NotInstalled) return { off: true };
    return { ok: false };
  }
}

/** `off` = no chip anywhere. `states` holds ONLY the leads this viewer may read the status of, at a shop that is on. */
export type DeliveryStatesResult = { ok: true; states: Record<string, DeliveryRowState> } | { ok: false } | { off: true };

/**
 * The row state of each of these leads (the pipeline's cards): ONE batched read. Each lead is judged at its CURRENT
 * shop — the status gate and the shop's own switch — and a lead that fails either is simply absent. No "soon": the
 * caller has no day window, so a lead to book reads `to_book`.
 */
export async function loadDeliveryStates(sb: Sb, actor: DeliveryActor, leadIds: readonly string[]): Promise<DeliveryStatesResult> {
  if (!deliveryTrackingOn()) return { off: true };
  // The coarse refusal before the first query: a viewer no shop could admit.
  if (!actor.active || actor.role === "social_media_mgr") return { off: true };
  const ids = [...new Set(leadIds)];
  if (ids.length === 0) return { ok: true, states: {} };
  try {
    const rows = await inChunks(ids, (chunk) => pages<DayLeadRow>((from, to) => sb.from("catering_pipeline").select(DAY_LEAD_COLUMNS).in("id", chunk).order("id").range(from, to)));
    const readable = rows.filter((l) => l.location_id !== null && deliveryStatusReadAllowed(actor, l.location_id));
    if (readable.length === 0) return { off: true };
    const on = await enabledShops(sb, [...new Set(readable.map((l) => l.location_id!))]);
    const leads = readable.filter((l) => on.has(l.location_id!));
    if (leads.length === 0) return { off: true };
    const fact = await factFor(sb, leads);
    return { ok: true, states: Object.fromEntries(fact.map((lead) => [lead.leadId, deliveryRowStateOf(lead)])) };
  } catch (error) {
    if (error instanceof NotInstalled) return { off: true };
    return { ok: false };
  }
}

/**
 * The pipeline page's read: the listed leads' states for the signed-in person. The switch is checked BEFORE a client is
 * made, so with delivery tracking off this touches nothing. Never throws: a failure is `{ ok: false }`.
 */
export async function loadPipelineDeliveryStates(actor: AuthContext, leadIds: readonly string[], deps: { client?: Sb } = {}): Promise<DeliveryStatesResult> {
  if (!deliveryTrackingOn()) return { off: true };
  try {
    return await loadDeliveryStates(deps.client ?? getServiceRoleClient(), deliveryActorOf(actor), leadIds);
  } catch {
    return { ok: false };
  }
}

import "server-only";
/** Item 2 PR 2b: the server side of the ORDER fact layer. Reads the capture, builds with the pure
 * builder, writes ONLY through 0337's fact_replace_order_day. Sends nothing (no email, SMS or notice).
 * Order of reads is the safety: the day's fingerprint comes from the diff BEFORE the source is read,
 * and the RPC recomputes it under the day lock, so a capture that commits at any point in between is
 * refused fact_stale (or fact_payload_mismatch) and the next pass rebuilds the day.
 * Fix round 1 (review r1 #2, #3): every request carries an abort signal bounded by the pass deadline,
 * and every failed day is counted and named by a fixed code so the route can write its health row. */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { buildOrderDay, FACT_BUILDER_VERSION, type OrderDaySource } from "./order-facts-shared";
import { FACT_DAY_TIMEOUT_MS, FACT_FAILURE_SAMPLE, FACT_PASS_DAY_LIMIT } from "./config-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
const CHUNK = 100;

/** Every read carries `signal` (the day budget): an aborted request fails the read, never hangs it. */
export async function loadOrderDaySource(sb: Sb, locationId: string, businessDate: string, signal?: AbortSignal): Promise<OrderDaySource> {
  const sig = signal ?? new AbortController().signal;
  const pointers = await selectAllRows<{ snapshot_id: string; order_guid: string }>((from, to) => sb.from("toast_order_latest_pointers")
    .select("snapshot_id,order_guid").eq("location_id", locationId).eq("business_date", businessDate).order("order_guid").abortSignal(sig).range(from, to));
  const source: OrderDaySource = { locationId, businessDate, orders: [], checks: [], discounts: [], payments: [] };
  for (let start = 0; start < pointers.length; start += CHUNK) {
    if (sig.aborted) throw new Error("fact_day_timeout");
    const ids = pointers.slice(start, start + CHUNK).map((p) => p.snapshot_id);
    const [orders, checks, discounts, payments] = await Promise.all([
      selectAllRows<OrderDaySource["orders"][number]>((from, to) => sb.from("toast_orders")
        .select("snapshot_id:id,order_guid,opened_at,paid_at,closed_at,promised_at,source,revenue_center_guid,dining_option_guid,server_guid,deleted,voided,excess_food,third_party_provider_guid,third_party_provider_name,selection_units")
        .in("id", ids).order("id").abortSignal(sig).range(from, to)),
      selectAllRows<OrderDaySource["checks"][number]>((from, to) => sb.from("toast_order_checks")
        .select("snapshot_id,check_guid,amount_cents,tax_cents,total_cents,voided,deleted,accounting")
        .in("snapshot_id", ids).order("snapshot_id").order("check_guid").abortSignal(sig).range(from, to)),
      selectAllRows<OrderDaySource["discounts"][number]>((from, to) => sb.from("toast_check_discounts")
        .select("snapshot_id,check_guid,selection_guid,amount_cents")
        .in("snapshot_id", ids).order("snapshot_id").order("check_guid").order("ordinal").abortSignal(sig).range(from, to)),
      selectAllRows<OrderDaySource["payments"][number]>((from, to) => sb.from("toast_payments")
        .select("snapshot_id,check_guid,payment_guid,payment_status,refund_status,refund_amount_cents,refund_tip_cents,refund_business_date,sales_refund_cents")
        .in("snapshot_id", ids).order("snapshot_id").order("payment_guid").abortSignal(sig).range(from, to)),
    ]);
    if (orders.length !== ids.length) throw new Error("fact_source_snapshot_missing");
    source.orders.push(...orders); source.checks.push(...checks); source.discounts.push(...discounts); source.payments.push(...payments);
  }
  return source;
}

export type DayOutcome = "built" | "stale";
export interface StaleDay { locationId: string; businessDate: string; fingerprint: string }
/** Fixed codes only: a health row never carries a database message. */
export type DayFailure = "fact_day_timeout" | "fact_source_read_failed" | "fact_source_snapshot_missing" | "fact_replace_failed";

export async function buildOrderFactDay(sb: Sb, day: StaleDay, signal?: AbortSignal): Promise<DayOutcome> {
  const sig = signal ?? new AbortController().signal;
  let source: OrderDaySource;
  try {
    source = await loadOrderDaySource(sb, day.locationId, day.businessDate, sig);
  } catch (e) {
    throw new Error(e instanceof Error && e.message === "fact_source_snapshot_missing" ? "fact_source_snapshot_missing" : "fact_source_read_failed");
  }
  if (sig.aborted) throw new Error("fact_day_timeout");
  const payload = buildOrderDay(source);
  const { error } = await sb.rpc("fact_replace_order_day", {
    p_location_id: day.locationId, p_business_date: day.businessDate, p_builder_version: FACT_BUILDER_VERSION,
    p_fingerprint: day.fingerprint, p_orders: payload.orders, p_checks: payload.checks, p_lines: payload.lines, p_refunds: payload.refunds,
  }).abortSignal(sig);
  if (!error) return "built";
  // The source moved under the build: not a failure, the next diff finds the day again.
  if (/fact_stale|fact_payload_mismatch/.test(error.message)) return "stale";
  throw new Error("fact_replace_failed");
}

export async function listStaleOrderDays(sb: Sb, floor: string, limit = FACT_PASS_DAY_LIMIT, signal?: AbortSignal): Promise<StaleDay[]> {
  const call = sb.rpc("fact_order_days_stale", { p_floor: floor, p_limit: limit, p_builder_version: FACT_BUILDER_VERSION });
  const { data, error } = await (signal ? call.abortSignal(signal) : call);
  if (error || !Array.isArray(data)) throw new Error("fact_diff_failed");
  return (data as { day_location_id: string; day_business_date: string; day_fingerprint: string }[])
    .map((r) => ({ locationId: r.day_location_id, businessDate: r.day_business_date, fingerprint: r.day_fingerprint }));
}

export interface PassResult {
  stale: number; built: number; raced: number;
  /** every day that did not finish, timeouts included; the route writes cron.failure when > 0 */
  failed: number; timedOut: number; leftForNextPass: number;
  /** the first FACT_FAILURE_SAMPLE failed days, each by a fixed code */
  failures: { locationId: string; businessDate: string; error: DayFailure }[];
}

const NAMED_DAY_FAILURES: readonly string[] = ["fact_source_read_failed", "fact_source_snapshot_missing", "fact_replace_failed"];

/** An abort that fires `ms` from now (setTimeout), or when `parent` aborts. */
function abortAfter(ms: number, parent?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, ms));
  const onParent = () => ctl.abort();
  if (parent?.aborted) ctl.abort(); else parent?.addEventListener("abort", onParent);
  return { signal: ctl.signal, clear: () => { clearTimeout(timer); parent?.removeEventListener("abort", onParent); } };
}

/** One bounded pass: the diff, then one day per transaction. NOTHING runs past `deadlineAt` (review r1
 * #3): the diff and every day carry an abort signal; a day is STARTED only while a whole day budget
 * (`dayTimeoutMs`) is left, and is aborted at that budget or at the deadline, whichever comes first.
 * Every failed day is counted and named (review r1 #2). No stored resume state: whatever is still
 * stale is simply found again by the next pass. */
export async function runFactBuildPass(opts: { floor: string; deadlineAt: number; dayTimeoutMs?: number; now?: () => number; sb?: Sb }): Promise<PassResult> {
  const sb = opts.sb ?? getServiceRoleClient();
  const now = opts.now ?? Date.now;
  const dayTimeoutMs = opts.dayTimeoutMs ?? FACT_DAY_TIMEOUT_MS;
  const pass = abortAfter(opts.deadlineAt - now());
  try {
    const days = await listStaleOrderDays(sb, opts.floor, FACT_PASS_DAY_LIMIT, pass.signal);
    const result: PassResult = { stale: days.length, built: 0, raced: 0, failed: 0, timedOut: 0, leftForNextPass: 0, failures: [] };
    for (const [index, day] of days.entries()) {
      const at = now();
      if (at + dayTimeoutMs > opts.deadlineAt || pass.signal.aborted) { result.leftForNextPass = days.length - index; break; }
      const budget = abortAfter(Math.min(dayTimeoutMs, opts.deadlineAt - at), pass.signal);
      try {
        const outcome = await buildOrderFactDay(sb, day, budget.signal);
        if (outcome === "built") result.built++; else result.raced++;
      } catch (e) {
        const code: DayFailure = budget.signal.aborted ? "fact_day_timeout"
          : e instanceof Error && NAMED_DAY_FAILURES.includes(e.message) ? e.message as DayFailure : "fact_replace_failed";
        result.failed++;
        if (code === "fact_day_timeout") result.timedOut++;
        if (result.failures.length < FACT_FAILURE_SAMPLE) result.failures.push({ locationId: day.locationId, businessDate: day.businessDate, error: code });
      } finally {
        budget.clear();
      }
    }
    return result;
  } finally {
    pass.clear();
  }
}

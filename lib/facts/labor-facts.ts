import "server-only";
/** Item 2 PR 2c: the server side of the LABOR fact layer. Reads one company week through 0338's
 * fact_labor_week_source (the source AND its fingerprint in one statement), builds with the pure
 * builder, writes ONLY through fact_replace_labor_week, which recomputes the fingerprint under the week
 * lock: a 7shifts sync, a Toast pull, a link or a wage that commits in between is refused fact_stale
 * (or fact_payload_mismatch) and the next pass rebuilds the week. Sends nothing (no email, SMS, notice).
 * Every request carries an abort signal bounded by the pass deadline; every failed week is counted and
 * named by a fixed code (the order side's rules, PR 2b). */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { buildLaborWeek, laborWeekSourceFromJson } from "./labor-week-shared";
import { LABOR_BUILDER_VERSION, LABOR_PASS_WEEK_LIMIT, LABOR_WEEK_TIMEOUT_MS } from "./labor-config-shared";
import { FACT_FAILURE_SAMPLE } from "./config-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
export interface StaleWeek { weekStart: string }
export type WeekFailure = "fact_week_timeout" | "fact_source_read_failed" | "fact_replace_failed";
export interface LaborPassResult {
  stale: number; built: number; raced: number; failed: number; timedOut: number; leftForNextPass: number;
  failures: { weekStart: string; error: WeekFailure }[];
}

export async function listStaleLaborWeeks(sb: Sb, limit = LABOR_PASS_WEEK_LIMIT, signal?: AbortSignal): Promise<StaleWeek[]> {
  const call = sb.rpc("fact_labor_weeks_stale", { p_limit: limit, p_builder_version: LABOR_BUILDER_VERSION });
  const { data, error } = await (signal ? call.abortSignal(signal) : call);
  if (error || !Array.isArray(data)) throw new Error("fact_diff_failed");
  return (data as { week_start: string }[]).map((r) => ({ weekStart: String(r.week_start).slice(0, 10) }));
}

export async function buildLaborFactWeek(sb: Sb, week: StaleWeek, signal?: AbortSignal): Promise<"built" | "stale"> {
  const sig = signal ?? new AbortController().signal;
  let read: ReturnType<typeof laborWeekSourceFromJson>;
  try {
    const { data, error } = await sb.rpc("fact_labor_week_source", { p_week_start: week.weekStart, p_builder_version: LABOR_BUILDER_VERSION }).abortSignal(sig);
    if (error || data === null || typeof data !== "object") throw new Error("read");
    read = laborWeekSourceFromJson(data as Record<string, unknown>);
  } catch {
    throw new Error("fact_source_read_failed");
  }
  if (sig.aborted) throw new Error("fact_week_timeout");
  const payload = buildLaborWeek(read.source);
  const { error } = await sb.rpc("fact_replace_labor_week", {
    p_week_start: week.weekStart, p_builder_version: LABOR_BUILDER_VERSION, p_fingerprint: read.fingerprint,
    p_quarters: payload.quarters, p_days: payload.days, p_week: payload.week, p_salaried: payload.salaried,
  }).abortSignal(sig);
  if (!error) return "built";
  // The source moved (or a day closed) under the build: not a failure, the next diff finds the week again.
  if (/fact_stale|fact_payload_mismatch/.test(error.message)) return "stale";
  throw new Error("fact_replace_failed");
}

function abortAfter(ms: number, parent?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, ms));
  const onParent = () => ctl.abort();
  if (parent?.aborted) ctl.abort(); else parent?.addEventListener("abort", onParent);
  return { signal: ctl.signal, clear: () => { clearTimeout(timer); parent?.removeEventListener("abort", onParent); } };
}

/** One bounded pass: the diff, then one week per transaction, newest first. A week is STARTED only while
 * a whole week budget is left before `deadlineAt`; nothing runs past it. No stored resume state. */
export async function runLaborBuildPass(opts: { deadlineAt: number; weekTimeoutMs?: number; now?: () => number; sb?: Sb }): Promise<LaborPassResult> {
  const sb = opts.sb ?? getServiceRoleClient();
  const now = opts.now ?? Date.now;
  const weekTimeoutMs = opts.weekTimeoutMs ?? LABOR_WEEK_TIMEOUT_MS;
  const pass = abortAfter(opts.deadlineAt - now());
  try {
    const weeks = await listStaleLaborWeeks(sb, LABOR_PASS_WEEK_LIMIT, pass.signal);
    const result: LaborPassResult = { stale: weeks.length, built: 0, raced: 0, failed: 0, timedOut: 0, leftForNextPass: 0, failures: [] };
    for (const [index, week] of weeks.entries()) {
      const at = now();
      if (at + weekTimeoutMs > opts.deadlineAt || pass.signal.aborted) { result.leftForNextPass = weeks.length - index; break; }
      const budget = abortAfter(Math.min(weekTimeoutMs, opts.deadlineAt - at), pass.signal);
      try {
        if (await buildLaborFactWeek(sb, week, budget.signal) === "built") result.built++; else result.raced++;
      } catch (e) {
        const code: WeekFailure = budget.signal.aborted ? "fact_week_timeout"
          : e instanceof Error && e.message === "fact_source_read_failed" ? "fact_source_read_failed" : "fact_replace_failed";
        result.failed++;
        if (code === "fact_week_timeout") result.timedOut++;
        if (result.failures.length < FACT_FAILURE_SAMPLE) result.failures.push({ weekStart: week.weekStart, error: code });
      } finally {
        budget.clear();
      }
    }
    return result;
  } finally {
    pass.clear();
  }
}

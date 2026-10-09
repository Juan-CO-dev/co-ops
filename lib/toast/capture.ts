import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { lockLocationContext } from "@/lib/locations";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { toastConfigured, toastGet, toastGetPage } from "./client";
import { recordCaptureReconciliation } from "./capture-reconciliation";
import type { QuantityCapture } from "./capture-reconciliation-shared";
import { normalizeToastOrder } from "./capture-shared";
import { backfillDates, captureBudget, captureErrorCode, runCapturePages } from "./capture-runner";
import { persistCapturedCatering } from "./capture-catering";

export function captureEnabled(): boolean {
  return process.env.TOAST_ORDER_CAPTURE === "1" && process.env.TOAST_FIXTURES !== "1" && toastConfigured();
}
export interface CaptureDayResult {
  runId: string;
  pages: number;
  orders: number;
  skipped: boolean;
  reason?: string;
  reconciliation?: { status: "match" | "mismatch" | "skipped"; error: string | null };
  catering?: { ok: boolean; error: string | null };
}
const skipped = (reason: string) => ({ runId: "", pages: 0, orders: 0, skipped: true as const, reason });
type Budget = ReturnType<typeof captureBudget>;
function dbError(error: { code?: string } | null, fallback: string) {
  if (error) throw new Error(["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "") ? "capture_schema_missing" : fallback);
}

async function restaurantForLocation(locationId: string): Promise<string> {
  const { data, error } = await getServiceRoleClient().from("locations")
    .select("toast_restaurant_guid").eq("id", locationId).eq("active", true)
    .maybeSingle<{ toast_restaurant_guid: string | null }>();
  if (error || !data?.toast_restaurant_guid) throw new Error("capture_location_unavailable");
  return data.toast_restaurant_guid;
}

/** Manual callers must supply a server-authenticated actor; the bind precedes all I/O. */
export async function captureToastDay(actor: AuthContext, locationId: string, date: string) {
  if (getRoleLevel(actor.user.role) < 7 || !lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) {
    throw new Error("capture_forbidden");
  }
  return captureToastDaySystem(locationId, date);
}

const configKinds = [
  ["discounts", "toast_discounts"],
  ["revenueCenters", "toast_revenue_centers"],
  ["diningOptions", "toast_dining_options"],
] as const;
const configFreshUntil = new Map<string, number>();

async function cacheConfig(locationId: string, restaurantGuid: string, budget: Budget, backfill: boolean): Promise<void> {
  const sb = getServiceRoleClient();
  if ((configFreshUntil.get(`${locationId}:${restaurantGuid}`) ?? 0) > Date.now()) return;
  for (const [endpoint, table] of configKinds) {
    const rows: { location_id: string; guid: string; name: string; updated_at: string; behavior?: string | null }[] = [];
    const tokens = new Set<string>();
    let token: string | null = null;
    do {
      const response = await budget.request(() => toastGetPage<unknown>(`/config/v2/${endpoint}${token ? `?pageToken=${encodeURIComponent(token)}` : ""}`, restaurantGuid, budget.signal), backfill);
      if (!Array.isArray(response.data)) throw new Error("capture_config_bad_page");
      for (const raw of response.data) {
        if (!raw || typeof raw.guid !== "string" || typeof raw.name !== "string") throw new Error("capture_config_bad_row");
        rows.push({ location_id: locationId, guid: raw.guid, name: raw.name, updated_at: new Date().toISOString(),
          ...(endpoint === "diningOptions" ? { behavior: typeof raw.behavior === "string" ? raw.behavior : null } : {}) });
      }
      token = response.nextPageToken;
      if (token && (tokens.has(token) || tokens.size >= 100)) throw new Error("capture_config_page_limit");
      if (token) tokens.add(token);
    } while (token);
    for (let i = 0; i < rows.length; i += 100) {
      budget.check();
      const result = await sb.from(table).upsert(rows.slice(i, i + 100), { onConflict: "location_id,guid" }).abortSignal(budget.signal);
      if (result.error) throw new Error("capture_config_write_failed");
    }
  }
  // Mark fresh only after ALL pages and writes succeed; a partial cache cannot skip retries.
  configFreshUntil.set(`${locationId}:${restaurantGuid}`, Date.now() + 3600_000);
}

/** Trusted job-only entry. Restaurant identity is resolved from the location, never supplied. */
export async function captureToastDaySystem(locationId: string, date: string, options: { resume?: boolean; backfill?: boolean; reconcile?: boolean; debounce?: boolean; minInterval?: "5 minutes" | "1 hour"; signal?: AbortSignal } = {}): Promise<CaptureDayResult> {
  if (!captureEnabled()) return skipped("capture_disabled_or_fixture");
  const budget = captureBudget(options.backfill ? 30 * 60_000 : 60_000, options.signal);
  try { return await budget.wait(() => captureDay(locationId, date, options, budget)); }
  catch (error) {
    if (captureErrorCode(error) === "capture_schema_missing") return skipped("capture_schema_missing");
    throw error;
  } finally { budget.close(); }
}

async function captureDay(locationId: string, date: string, options: { resume?: boolean; backfill?: boolean; reconcile?: boolean; debounce?: boolean; minInterval?: "5 minutes" | "1 hour" }, budget: Budget) {
  backfillDates(date, date);
  budget.check();
  const restaurantGuid = await restaurantForLocation(locationId);
  const sb = getServiceRoleClient();
  budget.check();
  // Interrupted runs never publish. Sweep only this location, without rewriting completed history.
  const stale = await sb.from("toast_capture_runs").update({ status: "failed", error_code: "capture_stale", finished_at: new Date().toISOString() })
    .eq("location_id", locationId).eq("status", "running").lt("started_at", new Date(Date.now() - 3600_000).toISOString()).abortSignal(budget.signal);
  dbError(stale.error, "capture_stale_sweep_failed");
  budget.check();
  if (options.resume) {
    const previous = await sb.from("toast_capture_runs").select("id,pages,orders")
      .eq("location_id", locationId).eq("business_date", date).eq("status", "completed")
      .order("finished_at", { ascending: false }).limit(1)
      .maybeSingle<{ id: string; pages: number; orders: number }>();
    dbError(previous.error, "capture_resume_read_failed");
    budget.check();
    if (previous.data) return { runId: previous.data.id, pages: previous.data.pages, orders: previous.data.orders, skipped: true };
  }
  budget.check();
  const runId = randomUUID();
  const started = options.debounce
    ? await sb.rpc("toast_capture_claim", { p_run_id: runId, p_location_id: locationId, p_business_date: date, p_min_interval: options.minInterval ?? "5 minutes" }).abortSignal(budget.signal)
    : await sb.from("toast_capture_runs").insert({ id: runId, location_id: locationId, business_date: date, status: "running" }).abortSignal(budget.signal);
  dbError(started.error, "capture_manifest_start_failed");
  if (options.debounce && started.data !== true) {
    const latest = await sb.from("toast_capture_runs").select("status,catering_status,catering_error_code")
      .eq("location_id", locationId).eq("business_date", date).neq("status", "modified_completed").order("started_at", { ascending: false })
      .order("id", { ascending: false }).limit(1).abortSignal(budget.signal)
      .maybeSingle<{ status: string; catering_status: string; catering_error_code: string | null }>();
    dbError(latest.error, "capture_debounce_read_failed");
    if (latest.data?.status === "running") return skipped("capture_running");
    if (latest.data?.status !== "completed") return skipped("capture_recent_failure");
    return { ...skipped("capture_debounced"), catering: { ok: latest.data.catering_status === "complete",
      error: latest.data.catering_status === "complete" ? null : "capture_catering_degraded" } };
  }
  budget.check();
  const args = { p_run_id: runId, p_location_id: locationId, p_business_date: date };
  let configLoaded = false;
  let configFresh = true;
  const cateringOrders: unknown[] = [];
  const quantities: QuantityCapture[] = [];
  const result = await runCapturePages({
    async page(page) {
      if (!configLoaded) {
        try { await cacheConfig(locationId, restaurantGuid, budget, options.backfill === true); }
        catch { budget.check(); configFresh = false; }
        configLoaded = true;
      }
      return budget.request(() => toastGet<unknown>(`/orders/v2/ordersBulk?businessDate=${date.replaceAll("-", "")}&page=${page}&pageSize=100`, restaurantGuid, budget.signal), options.backfill === true);
    },
    async save(page, orders) {
      budget.check();
      const normalized = orders.map((raw) => {
        const order = normalizeToastOrder(raw, date);
        return { ...order, content_hash: createHash("sha256").update(JSON.stringify(order)).digest("hex") };
      });
      // Identical replay is idempotent even if the first response was lost after commit.
      const pageArgs = { ...args, p_page: page, p_orders: normalized };
      for (let attempt = 0; ; attempt++) {
        budget.check();
        let saved;
        try {
          saved = await budget.wait(() => sb.rpc("toast_capture_page", pageArgs).abortSignal(budget.signal));
        } catch (error) {
          budget.check();
          // PostgREST normally returns transport errors with status 0. A raw fetch
          // rejection has no status either; do not retry an HTTP/SQL failure.
          const status = (error as { status?: number } | null)?.status;
          if (status) throw new Error("capture_page_write_failed");
          if (attempt === 0) continue;
          throw new Error("capture_page_transport_failed");
        }
        if (saved.error && !saved.status && !saved.error.code) {
          budget.check();
          if (attempt === 0) continue;
          throw new Error("capture_page_transport_failed");
        }
        dbError(saved.error, "capture_page_write_failed");
        break;
      }
      cateringOrders.push(...orders);
      if (options.reconcile) quantities.push(...normalized.map(({ order, checks }) => ({ order, checks })));
    },
    async complete(pages) {
      budget.check();
      const completed = await sb.rpc("toast_capture_finish", { ...args, p_pages: pages }).abortSignal(budget.signal);
      dbError(completed.error, "capture_publish_failed");
    },
    async fail(code) {
      if (budget.signal.aborted) return; // swept on the next attempt; never extend the deadline
      const failed = await sb.from("toast_capture_runs").update({ status: "failed", error_code: code, finished_at: new Date().toISOString() })
        .eq("id", runId).eq("location_id", locationId).eq("business_date", date).eq("status", "running").select("id").abortSignal(budget.signal);
      if (failed.error || failed.data?.length !== 1) throw new Error("capture_manifest_fail_failed");
    },
  });
  // PII stays in this request. No catering write is attempted before successful finish.
  let catering: NonNullable<CaptureDayResult["catering"]>;
  try {
    const result = await budget.wait(() => persistCapturedCatering(locationId, cateringOrders, { configFresh, signal: budget.signal }));
    catering = { ok: result.ok, error: result.ok ? null : result.error ?? "capture_catering_processing_failed" };
    const stored = await sb.from("toast_capture_runs").update({
      catering_status: catering.ok ? "complete" : "degraded", catering_error_code: catering.error,
    }).eq("id", runId).eq("location_id", locationId).eq("status", "completed").select("id").abortSignal(budget.signal);
    if (stored.error || stored.data?.length !== 1) catering = { ok: false, error: "capture_catering_status_write_failed" };
  } catch {
    // An interrupted sink leaves pending, which scan explicitly treats as degraded.
    catering = { ok: false, error: budget.signal.aborted ? "capture_catering_deadline" : "capture_catering_processing_failed" };
  }
  let reconciliation: CaptureDayResult["reconciliation"];
  if (options.reconcile) {
    try { reconciliation = await recordCaptureReconciliation(locationId, date, runId, quantities, budget.signal); }
    catch (error) { reconciliation = { status: "skipped", error: captureErrorCode(error) }; }
  }
  return { runId, ...result, skipped: false, catering, ...(reconciliation ? { reconciliation } : {}) };
}

/** Read-only retention probe: consumes every page but persists no orders or manifest. */
export async function probeToastDate(locationId: string, date = "2025-10-01") {
  backfillDates(date, date);
  if (!captureEnabled()) return skipped("capture_disabled_or_fixture");
  const budget = captureBudget();
  try { return await budget.wait(async () => {
    const guid = await restaurantForLocation(locationId);
    return runCapturePages({
      page: (page) => budget.request(() => toastGet<unknown>(`/orders/v2/ordersBulk?businessDate=${date.replaceAll("-", "")}&page=${page}&pageSize=100`, guid, budget.signal)),
      save: async (_page, orders) => { budget.check(); for (const order of orders) normalizeToastOrder(order, date); },
      complete: async () => { budget.check(); }, fail: async () => {},
    });
  }); } finally { budget.close(); }
}

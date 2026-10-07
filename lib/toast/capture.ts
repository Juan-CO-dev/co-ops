import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { lockLocationContext } from "@/lib/locations";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { toastConfigured, toastGet, toastGetPage } from "./client";
import { normalizeToastOrder } from "./capture-shared";
import { backfillDates, captureRequest, runCapturePages } from "./capture-runner";

function requireLive(): void {
  if (!toastConfigured() || process.env.TOAST_FIXTURES === "1") throw new Error("capture_live_credentials_required");
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

async function cacheConfig(locationId: string, restaurantGuid: string): Promise<void> {
  const sb = getServiceRoleClient();
  if ((configFreshUntil.get(`${locationId}:${restaurantGuid}`) ?? 0) > Date.now()) return;
  for (const [endpoint, table] of configKinds) {
    const rows: { location_id: string; guid: string; name: string; updated_at: string; behavior?: string | null }[] = [];
    const tokens = new Set<string>();
    let token: string | null = null;
    do {
      const response = await captureRequest(() => toastGetPage<unknown>(`/config/v2/${endpoint}${token ? `?pageToken=${encodeURIComponent(token)}` : ""}`, restaurantGuid));
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
      const result = await sb.from(table).upsert(rows.slice(i, i + 100), { onConflict: "location_id,guid" });
      if (result.error) throw new Error("capture_config_write_failed");
    }
  }
  // Mark fresh only after ALL pages and writes succeed; a partial cache cannot skip retries.
  configFreshUntil.set(`${locationId}:${restaurantGuid}`, Date.now() + 3600_000);
}

/** Trusted job-only entry. Restaurant identity is resolved from the location, never supplied. */
export async function captureToastDaySystem(locationId: string, date: string, options: { resume?: boolean } = {}) {
  backfillDates(date, date);
  requireLive();
  const restaurantGuid = await restaurantForLocation(locationId);
  const sb = getServiceRoleClient();
  if (options.resume) {
    const previous = await sb.from("toast_capture_runs").select("id,pages,orders")
      .eq("location_id", locationId).eq("business_date", date).eq("status", "completed")
      .order("finished_at", { ascending: false }).limit(1)
      .maybeSingle<{ id: string; pages: number; orders: number }>();
    if (previous.error) throw new Error("capture_resume_read_failed");
    if (previous.data) return { runId: previous.data.id, pages: previous.data.pages, orders: previous.data.orders, skipped: true };
  }
  const runId = randomUUID();
  const started = await sb.from("toast_capture_runs").insert({ id: runId, location_id: locationId, business_date: date, status: "running" });
  if (started.error) throw new Error("capture_manifest_start_failed");
  const args = { p_run_id: runId, p_location_id: locationId, p_business_date: date };
  let configLoaded = false;
  const result = await runCapturePages({
    async page(page) {
      if (!configLoaded) { await cacheConfig(locationId, restaurantGuid); configLoaded = true; }
      return captureRequest(() => toastGet<unknown>(`/orders/v2/ordersBulk?businessDate=${date.replaceAll("-", "")}&page=${page}&pageSize=100`, restaurantGuid));
    },
    async save(page, orders) {
      const normalized = orders.map((raw) => {
        const order = normalizeToastOrder(raw, date);
        return { ...order, content_hash: createHash("sha256").update(JSON.stringify(order)).digest("hex") };
      });
      const saved = await sb.rpc("toast_capture_page", { ...args, p_page: page, p_orders: normalized });
      if (saved.error) throw new Error("capture_page_write_failed");
    },
    async complete(pages) {
      const completed = await sb.rpc("toast_capture_finish", { ...args, p_pages: pages });
      if (completed.error) throw new Error("capture_publish_failed");
    },
    async fail(code) {
      const failed = await sb.from("toast_capture_runs").update({ status: "failed", error_code: code, finished_at: new Date().toISOString() })
        .eq("id", runId).eq("location_id", locationId).eq("business_date", date).eq("status", "running").select("id");
      if (failed.error || failed.data?.length !== 1) throw new Error("capture_manifest_fail_failed");
    },
  });
  return { runId, ...result, skipped: false };
}

/** Read-only retention probe: consumes every page but persists no orders or manifest. */
export async function probeToastDate(locationId: string, date = "2025-10-01") {
  backfillDates(date, date);
  requireLive();
  const guid = await restaurantForLocation(locationId);
  return runCapturePages({
    page: (page) => captureRequest(() => toastGet<unknown>(`/orders/v2/ordersBulk?businessDate=${date.replaceAll("-", "")}&page=${page}&pageSize=100`, guid)),
    save: async (_page, orders) => { for (const order of orders) normalizeToastOrder(order, date); },
    complete: async () => {}, fail: async () => {},
  });
}

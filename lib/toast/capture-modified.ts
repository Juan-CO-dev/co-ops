import "server-only";
import { createHash } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { captureEnabled } from "./capture";
import { toastGet } from "./client";
import { captureBudget, captureErrorCode } from "./capture-runner";
import { MODIFIED_BATCH_SIZE, MODIFIED_DB_TIMEOUT_MS, MODIFIED_MAX_PAGES, MODIFIED_MAX_WINDOWS,
  modifiedWindow, normalizeModifiedOrder } from "./capture-modified-shared";

type Budget = ReturnType<typeof captureBudget>;
interface Shop { id: string; toast_restaurant_guid: string }
interface ShopResult { locationId: string; windows: number; pages: number; changed: number; error: string | null }

/** Bound each DB request independently as well as the whole invocation. */
async function database<T>(parent: Budget, work: (signal: AbortSignal) => PromiseLike<{ data: T; error: { code?: string } | null }>): Promise<T> {
  parent.check();
  const call = captureBudget(MODIFIED_DB_TIMEOUT_MS, parent.signal);
  try {
    const result = await call.wait(() => work(call.signal));
    parent.check();
    if (result.error) throw new Error(["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(result.error.code ?? "")
      ? "capture_schema_missing" : "capture_modified_db_failed");
    return result.data;
  } finally { call.close(); }
}

async function sweepShop(shop: Shop, budget: Budget): Promise<ShopResult> {
  const result: ShopResult = { locationId: shop.id, windows: 0, pages: 0, changed: 0, error: null };
  const sb = getServiceRoleClient();
  try {
    for (let n = 0; n < MODIFIED_MAX_WINDOWS; n++) {
      const cursor = await database(budget, (signal) => sb.rpc("toast_modified_begin", { p_location_id: shop.id }).abortSignal(signal));
      const window = modifiedWindow(cursor);
      if (!window) break;
      const seen = new Set<string>();
      let complete = false;
      for (let page = 1; page <= MODIFIED_MAX_PAGES; page++) {
        const query = new URLSearchParams({ startDate: window.start, endDate: window.end, page: String(page), pageSize: "100" });
        const raw = await budget.request(() => toastGet<unknown>(`/orders/v2/ordersBulk?${query}`, shop.toast_restaurant_guid, budget.signal));
        budget.check();
        if (!Array.isArray(raw) || raw.length > 100) throw new Error("capture_bad_page");
        const orders = raw.map((entry) => {
          const normalized = normalizeModifiedOrder(entry, window);
          if (seen.has(normalized.order.order_guid)) throw new Error("capture_modified_duplicate_order");
          seen.add(normalized.order.order_guid);
          return { ...normalized, content_hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
        });
        for (let i = 0; i < orders.length; i += MODIFIED_BATCH_SIZE) {
          const changed = await database(budget, (signal) => sb.rpc("toast_modified_save", {
            p_location_id: shop.id, p_orders: orders.slice(i, i + MODIFIED_BATCH_SIZE),
          }).abortSignal(signal));
          if (!Number.isInteger(changed) || changed < 0 || changed > Math.min(MODIFIED_BATCH_SIZE, orders.length - i)) {
            throw new Error("capture_modified_bad_save_result");
          }
          result.changed += changed;
        }
        result.pages++;
        if (raw.length < 100) {
          const advanced = await database(budget, (signal) => sb.rpc("toast_modified_complete", {
            p_location_id: shop.id, p_start: window.start, p_end: window.end,
          }).abortSignal(signal));
          if (advanced !== true) throw new Error("capture_modified_cursor_conflict");
          result.windows++;
          complete = true;
          break;
        }
      }
      if (!complete) throw new Error("capture_modified_page_limit");
    }
  } catch (error) { result.error = captureErrorCode(error); }
  return result;
}

/** Trusted pinger-only entry. Resolve restaurant identities from active locations. */
export async function captureModified(signal?: AbortSignal, remainingMs = 20_000) {
  const results: ShopResult[] = [];
  if (!captureEnabled()) return { failures: 0, results, skipped: true };
  if (remainingMs <= 0) return { failures: 0, results, skipped: true, reason: "capture_route_time_exhausted" };
  const duration = Math.min(20_000, remainingMs);
  const end = Date.now() + duration;
  const budget = captureBudget(duration, signal);
  try {
    const sb = getServiceRoleClient();
    const shops = await database(budget, (childSignal) => sb.from("locations").select("id,toast_restaurant_guid")
      .eq("active", true).not("toast_restaurant_guid", "is", null).order("id").abortSignal(childSignal));
    const locations = (shops ?? []) as Shop[];
    for (const [index, shop] of locations.entries()) {
      budget.check();
      // One slow shop cannot consume the shares reserved for the remaining shops.
      const share = captureBudget(Math.max(1, Math.floor((end - Date.now()) / (locations.length - index))), budget.signal);
      try { results.push(await sweepShop(shop, share)); }
      finally { share.close(); }
    }
    return { failures: results.filter((r) => r.error).length, results, skipped: false };
  } catch (error) {
    return { failures: results.filter((r) => r.error).length + 1, results, skipped: false, error: captureErrorCode(error) };
  } finally { budget.close(); }
}

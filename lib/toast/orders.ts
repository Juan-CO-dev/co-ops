/**
 * Toast orders pull (read-track 2). SERVER-ONLY fetch wrapper over the pure
 * flattenToastOrders normalizer (lib/toast/orders-shared.ts).
 *
 * `GET /orders/v2/ordersBulk?businessDate=YYYYMMDD&page=N&pageSize=100` —
 * paginated; we concatenate pages until a short page. Fixture mode returns the
 * checked-in sample on page 1 and [] afterwards (single-page fixture).
 */
import "server-only";

import { toastGet, ToastApiError } from "./client";
import { flattenToastOrders, type ToastSaleLine } from "./orders-shared";

const PAGE_SIZE = 100;

/** businessDate as Toast's YYYYMMDD integer-string from a YYYY-MM-DD date. */
export function toastBusinessDate(ymd: string): string {
  return ymd.replaceAll("-", "");
}

export async function fetchToastOrders(restaurantGuid: string, businessDateYmd: string): Promise<ToastSaleLine[]> {
  const bd = toastBusinessDate(businessDateYmd);
  const all: ToastSaleLine[] = [];
  for (let page = 1; page <= 50; page += 1) { // hard page cap — a day is never 5000 orders at CO scale
    const json = await toastGet<unknown>(`/orders/v2/ordersBulk?businessDate=${bd}&page=${page}&pageSize=${PAGE_SIZE}`, restaurantGuid);
    let lines: ToastSaleLine[];
    let rawCount: number;
    try {
      rawCount = Array.isArray(json) ? json.length : -1;
      lines = flattenToastOrders(json);
    } catch (err) {
      throw new ToastApiError(502, "bad_payload", err instanceof Error ? err.message : "bad orders payload");
    }
    all.push(...lines);
    if (rawCount < PAGE_SIZE) break; // short (or fixture) page = done
  }
  return all;
}

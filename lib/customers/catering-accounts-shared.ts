import { CUSTOMER_ALL_SHOPS_MIN } from "./access-shared";
import type { CustomerListSearchParams } from "./list-params-shared";
import { spendTotal, type DetailOrder } from "./profile-detail-shared";

export type CateringOrder = Pick<DetailOrder, "customer_id" | "business_date" | "total_cents" | "location_id" | "source_kind"> & { channel?: string };
export interface CateringPerson { id: string; full_name: string | null; merged_into: string | null; erased_at: string | null }
export interface CateringAccount {
  id: string; name: string | null; orders: number; spendCents: number | null; avgOrderCents: number | null;
  firstOrder: string; lastOrder: string; sources: DetailOrder["source_kind"][]; shops: string[]; allVisits: number; quiet: boolean;
}
export const CATERING_SORTS = ["spend", "orders", "recent", "quiet"] as const;
export type CateringSort = (typeof CATERING_SORTS)[number];
export interface CateringParams { sort: CateringSort; quiet: boolean; locationId: string | null; page: number }
const DAY = 86_400_000;
const dateMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Inputs are already shop-scoped catering orders; retain only live roots. */
export function cateringAccounts(orders: readonly CateringOrder[], people: readonly CateringPerson[],
  visitsById: ReadonlyMap<string, number> | Readonly<Record<string, number>>, todayEt: string) {
  const live = new Map(people.filter((p) => !p.merged_into && !p.erased_at).map((p) => [p.id, p]));
  const grouped = new Map<string, CateringOrder[]>();
  const kept = orders.filter((o) => live.has(o.customer_id));
  for (const order of kept) {
    const rows = grouped.get(order.customer_id) ?? [];
    rows.push(order);
    grouped.set(order.customer_id, rows);
  }
  const today = dateMs(todayEt);
  const rows: CateringAccount[] = [...grouped].map(([id, accountOrders]) => {
    const dates = accountOrders.map((o) => o.business_date).sort();
    const lastOrder = dates.at(-1)!;
    const spendCents = spendTotal(accountOrders);
    const allVisits = "get" in visitsById && typeof visitsById.get === "function"
      ? visitsById.get(id) ?? 0 : (visitsById as Readonly<Record<string, number>>)[id] ?? 0;
    return { id, name: live.get(id)!.full_name, orders: accountOrders.length, spendCents,
      avgOrderCents: spendCents === null ? null : Math.round(spendCents / accountOrders.length),
      firstOrder: dates[0]!, lastOrder, sources: [...new Set(accountOrders.map((o) => o.source_kind))].sort(),
      shops: [...new Set(accountOrders.map((o) => o.location_id))].sort(), allVisits,
      quiet: accountOrders.length >= 2 && today - dateMs(lastOrder) > 90 * DAY };
  });
  return { rows, summary: { accounts: rows.length, repeat: rows.filter((r) => r.orders >= 2).length,
    quiet: rows.filter((r) => r.quiet).length,
    spendCents: spendTotal(kept.filter((o) => dateMs(o.business_date) >= today - 364 * DAY && dateMs(o.business_date) <= today)) } };
}

export function sortCateringAccounts(rows: readonly CateringAccount[], sort: CateringSort) {
  return rows.filter((r) => sort !== "quiet" || r.quiet).sort((a, b) => {
    const tie = a.id.localeCompare(b.id);
    if (sort === "orders") return b.orders - a.orders || tie;
    if (sort === "recent") return b.lastOrder.localeCompare(a.lastOrder) || tie;
    if (sort === "quiet") return a.lastOrder.localeCompare(b.lastOrder) || tie;
    if (a.spendCents === null) return b.spendCents === null ? tie : 1;
    if (b.spendCents === null) return -1;
    return b.spendCents - a.spendCents || tie;
  });
}

export function parseCateringParams(raw: CustomerListSearchParams, level: number): CateringParams {
  const location = typeof raw.location === "string" ? raw.location : "";
  const page = typeof raw.page === "string" && /^-?\d+$/.test(raw.page) ? Number(raw.page) : 1;
  return { sort: CATERING_SORTS.find((sort) => sort === raw.sort) ?? "spend", quiet: raw.quiet === "1",
    locationId: level >= CUSTOMER_ALL_SHOPS_MIN && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(location) ? location : null,
    page: Number.isFinite(page) ? Math.max(1, Math.min(1_000_000, page)) : 1 };
}

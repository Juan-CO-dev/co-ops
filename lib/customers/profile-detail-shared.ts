import type { CustomerOrderRow } from "./stats-shared";

export interface DetailOrder extends CustomerOrderRow {
  id: string;
  customer_id: string;
  source_kind: "toast" | "catering" | "ezcater";
  contact_masked?: boolean;
}

export function spendTotal(orders: readonly { total_cents: number | null }[]): number | null {
  return orders.some((o) => o.total_cents === null || !Number.isFinite(o.total_cents))
    ? null : orders.reduce((sum, o) => sum + o.total_cents!, 0);
}

/** todayEt is an ET business date, not a timestamp. */
export function monthlyVisits(orders: readonly CustomerOrderRow[], todayEt: string, months = 12) {
  const end = new Date(`${todayEt}T00:00:00Z`);
  const count = Number.isFinite(months) ? Math.max(1, Math.min(120, Math.trunc(months))) : 12;
  return Array.from({ length: count }, (_, i) => {
    const month = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - count + i + 1, 1)).toISOString().slice(0, 7);
    const rows = orders.filter((o) => o.business_date.slice(0, 7) === month);
    return { month, visits: rows.length, spendCents: spendTotal(rows) };
  });
}

export function shopSplit(orders: readonly CustomerOrderRow[]) {
  const shops = new Map<string, CustomerOrderRow[]>();
  for (const order of orders) {
    const rows = shops.get(order.location_id) ?? [];
    rows.push(order);
    shops.set(order.location_id, rows);
  }
  return [...shops].map(([locationId, rows]) => ({ locationId, visits: rows.length,
    spendCents: spendTotal(rows), lastOrder: rows.map((o) => o.business_date).sort().at(-1)! }))
    .sort((a, b) => b.visits - a.visits || a.locationId.localeCompare(b.locationId));
}

export function orderHistory(orders: readonly DetailOrder[], requestedPage: number, pageSize = 25) {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.trunc(pageSize)) : 25;
  const pages = Math.max(1, Math.ceil(orders.length / size));
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.min(pages, Math.trunc(requestedPage))) : 1;
  const rows = [...orders].sort((a, b) => b.business_date.localeCompare(a.business_date) || a.id.localeCompare(b.id))
    .slice((page - 1) * size, page * size).map((o) => {
      const items = (o.items ?? []).filter((i) => typeof i?.name === "string" && Number.isFinite(i.qty))
        .map((i) => ({ name: i.name, qty: i.qty })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
      return { date: o.business_date, locationId: o.location_id, channel: o.channel, source: o.source_kind,
        totalCents: spendTotal([o]), items: items.slice(0, 3), moreItems: Math.max(0, items.length - 3) };
    });
  return { rows, total: orders.length, page, pages };
}

export function cateringSummary(orders: readonly DetailOrder[]) {
  const rows = orders.filter((o) => o.source_kind !== "toast" || o.channel === "catering");
  return rows.length ? { orders: rows.length, spendCents: spendTotal(rows),
    lastOrder: rows.map((o) => o.business_date).sort().at(-1)! } : null;
}

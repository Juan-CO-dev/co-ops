/**
 * Profile stats — PURE (client-safe). 0234. Visits, spend, favourite items, channel mix, last order,
 * frequency, computed from customer_orders rows (already bound to the viewer's shops by the loader).
 */
export interface CustomerOrderRow {
  business_date: string;
  channel: string;
  total_cents: number | null;
  items: { name: string; qty: number }[] | null;
  location_id: string;
}
export interface ProfileStats {
  visits: number;
  spendCents: number | null;
  unknownSpend: number;
  firstOrder: string | null;
  lastOrder: string | null;
  avgDaysBetween: number | null;
  channels: { channel: string; visits: number }[];
  favourites: { name: string; qty: number }[];
}

const DAY = 86_400_000;

export function profileStats(orders: readonly CustomerOrderRow[], favouriteCount = 3): ProfileStats {
  if (orders.length === 0) {
    return { visits: 0, spendCents: 0, unknownSpend: 0, firstOrder: null, lastOrder: null, avgDaysBetween: null, channels: [], favourites: [] };
  }
  let spend = 0;
  let unknownSpend = 0;
  const channels = new Map<string, number>();
  const items = new Map<string, number>();
  const dates = orders.map((o) => o.business_date).sort();
  for (const o of orders) {
    if (o.total_cents === null || !Number.isFinite(o.total_cents)) unknownSpend++;
    else spend += o.total_cents;
    channels.set(o.channel, (channels.get(o.channel) ?? 0) + 1);
    for (const i of o.items ?? []) {
      if (typeof i?.name !== "string" || !Number.isFinite(i.qty)) continue;
      items.set(i.name, (items.get(i.name) ?? 0) + i.qty);
    }
  }
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const distinctDays = new Set(dates).size;
  const span = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY;
  return {
    visits: orders.length,
    // An unknown order total never reads as $0: the sum is shown only when every order is known.
    spendCents: unknownSpend > 0 ? null : spend,
    unknownSpend,
    firstOrder: first,
    lastOrder: last,
    avgDaysBetween: distinctDays >= 2 ? Math.round((span / (distinctDays - 1)) * 10) / 10 : null,
    channels: [...channels].map(([channel, visits]) => ({ channel, visits })).sort((a, b) => b.visits - a.visits || a.channel.localeCompare(b.channel)),
    favourites: [...items].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, favouriteCount),
  };
}

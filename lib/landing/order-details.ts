import { serverT } from '@/lib/i18n/server';
import { formatClockTimeShort } from '@/lib/i18n/format';
import type { Language } from '@/lib/i18n/types';
import { closingToday, type WeeklyHours } from './hours-shared';

export interface OrderDetail { street: string; until: string | null; line: string }
export type OrderDetails = Readonly<Record<string, OrderDetail>>;
/** The second line under a shop's order button: its street and, when the static hours say
 * the shop opens today, today's closing time ("8th St SE · til 6 PM"). */
export function orderDetail(store: { street: string; openingHours: WeeklyHours | null }, language: Language, now: Date = new Date()): OrderDetail {
  const closes = closingToday(store.openingHours, now);
  const time = closes ? formatClockTimeShort(closes, language) : '';
  const until = time ? serverT(language, 'landing.hours.until', { time }) : null;
  return { street: store.street, until, line: until ? `${store.street} · ${until}` : store.street };
}
/** Every shop's line, computed once per request and handed to each order surface. */
export function orderDetailsByStore(stores: readonly { key: string; street: string; openingHours: WeeklyHours | null }[], language: Language, now: Date = new Date()): OrderDetails {
  return Object.fromEntries(stores.map(store => [store.key, orderDetail(store, language, now)]));
}

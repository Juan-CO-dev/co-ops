import { serverT } from '@/lib/i18n/server';
import type { Language } from '@/lib/i18n/types';
import { closingToday, formatClock, type WeeklyHours } from './hours-shared';

export interface OrderDetail { street: string; until: string | null; line: string }
/** The second line under a shop's order button: its street and, when the static hours say
 * the shop opens today, today's closing time ("8th St SE · til 6 PM"). Server-rendered per request. */
export function orderDetail(store: { street: string; openingHours: WeeklyHours | null }, language: Language, now: Date = new Date()): OrderDetail {
  const closes = closingToday(store.openingHours, now);
  const until = closes ? serverT(language, 'landing.hours.until', { time: formatClock(closes, language) }) : null;
  return { street: store.street, until, line: until ? `${store.street} · ${until}` : store.street };
}

/** Static opening hours only (tenant config). Never a live "open now" claim: holiday and
 * exception hours are not known here, so the page only says when today's hours END. */
export const LANDING_TIME_ZONE = 'America/New_York';
export interface WeeklyHours { days: readonly string[]; opens: string; closes: string }

/** The shop's weekday name ("Monday"…) at this instant, in the shops' own time zone. */
export function shopWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: LANDING_TIME_ZONE }).format(now);
}
/** Today's closing time ("18:00"), or null when the data says the shop is not open today
 * or the value is malformed — the page then shows nothing rather than a wrong time. */
export function closingToday(hours: WeeklyHours | null | undefined, now: Date): string | null {
  if (!hours || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.closes) || Number.isNaN(now.getTime())) return null;
  return hours.days.includes(shopWeekday(now)) ? hours.closes : null;
}
/** "18:00" → "6 PM" (en) / "6 p. m." (es); minutes only when not on the hour. */
export function formatClock(time: string, language: 'en' | 'es'): string {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const hour = hours % 12 || 12;
  const suffix = hours < 12 ? (language === 'es' ? 'a. m.' : 'AM') : (language === 'es' ? 'p. m.' : 'PM');
  return `${hour}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${suffix}`;
}

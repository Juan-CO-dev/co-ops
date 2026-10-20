/** Static opening hours only (tenant config). Never a live "open now" claim: holiday and
 * exception hours are not known here, so the page only says when today's hours END. */
export const LANDING_TIME_ZONE = 'America/New_York';
export interface WeeklyHours { days: readonly string[]; opens: string; closes: string }
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The shop's weekday name ("Monday"…) at this instant, in the shops' own time zone. */
export function shopWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: LANDING_TIME_ZONE }).format(now);
}
/** The whole hours shape: known weekday names, zero-padded 24 h opens/closes, opening before
 * closing on the same day. Anything else (incl. overnight hours) is not something we can state. */
export function validWeeklyHours(hours: unknown): hours is WeeklyHours {
  if (!hours || typeof hours !== 'object') return false;
  const { days, opens, closes } = hours as Record<string, unknown>;
  return Array.isArray(days) && days.every(day => typeof day === 'string' && WEEKDAYS.includes(day))
    && typeof opens === 'string' && CLOCK.test(opens) && typeof closes === 'string' && CLOCK.test(closes) && opens < closes;
}
/** Today's closing time ("18:00"), or null when the data says the shop is not open today
 * or anything is malformed — the page then shows nothing rather than a wrong time. Never throws. */
export function closingToday(hours: unknown, now: Date): string | null {
  try {
    if (!validWeeklyHours(hours) || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
    return hours.days.includes(shopWeekday(now)) ? hours.closes : null;
  } catch { return null; }
}

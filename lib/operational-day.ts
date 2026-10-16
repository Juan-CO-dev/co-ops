/**
 * Operational-day (America/New_York) date primitives — PURE, client-safe, zero
 * I/O (hardening 2026-07-31, council P1: the recurring UTC-vs-Eastern bug
 * family). CO operates on Eastern calendar days; `created_at`/`released_at` are
 * UTC timestamptz. Comparing a bare `YYYY-MM-DD` string against a timestamptz
 * (as several sites did) silently buckets late-evening ET rows into the wrong
 * operational day. These helpers convert correctly.
 *
 * NOTE: lib/counts-shared.ts `etBusinessDate` is the same calendar-date
 * primitive as `etCalendarDate` here; kept separate only to avoid touching the
 * counts module. Consolidation is tracked debt.
 */

const OPERATIONAL_TZ = "America/New_York";

/** Operational wall-clock HH:mm, independent of browser timezone and DST offset. */
export function etClockTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: OPERATIONAL_TZ,
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return `${parts.find(part => part.type === "hour")!.value}:${parts.find(part => part.type === "minute")!.value}`;
}

/** The ET calendar date (YYYY-MM-DD) an ISO/UTC instant falls on. en-CA → always
 *  zero-padded + lexicographically sortable. */
export function etCalendarDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: OPERATIONAL_TZ });
}

/**
 * The ET calendar date to DISPLAY for a stored value that is either a UTC
 * timestamp (`2026-10-14T02:00:00Z` -> `2026-10-13`: 10 PM EDT is still the
 * 13th) or already a bare `YYYY-MM-DD` operational date (returned untouched --
 * re-zoning a bare date would shift it a day west). Never `iso.slice(0, 10)`: that
 * is the UTC date and reads "tomorrow" for every row written after 8 PM ET
 * (B6 / #58). Unparseable input falls back to its first 10 characters.
 */
export function etDisplayDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (Number.isNaN(new Date(value).getTime())) return value.slice(0, 10);
  return etCalendarDate(value);
}

/**
 * The ET calendar date `days` before `ymd` — pure math on the calendar grid via
 * Date.UTC, immune to the runtime's zone AND to DST. Replaces the
 * `new Date(new Date().toLocaleString(..., {timeZone}))` round-trip antipattern:
 * parsing an ET-rendered wall-clock string in the runtime's own zone
 * double-applies the offset, which made a 09:00Z cron compute D-2 instead of
 * D-1 for the entire EST half of the year (council audit 2026-08-08, P1-2).
 */
export function etYmdMinusDays(ymd: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`etYmdMinusDays: bad ymd "${ymd}"`);
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - days)).toISOString().slice(0, 10);
}

/** The UTC offset (ms) of `instant` in the operational TZ. Negative west of UTC
 *  (ET is −4h EDT / −5h EST). Uses Intl to read the wall clock — DST-correct. */
function tzOffsetMs(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) m[p.type] = p.value;
  const hour = m.hour === "24" ? 0 : Number(m.hour);
  const asUtc = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), hour, Number(m.minute), Number(m.second));
  return asUtc - instant.getTime();
}

const EASTERN_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/**
 * THE ET wall-time → instant resolver (minutes after midnight on ET day `day`). One algorithm for
 * the whole app: the digest's `etWallTime` (lib/report-digests-shared) and the ordering/PO cutoff
 * conversion (`etWallClockToUtcIso` below) both delegate here, so their DST policy cannot diverge
 * (B7b review 2, 2026-10-14 — the ordering copy once resolved a skipped time backward while the
 * digest rolled it forward). Fixed-point iteration on the observed ET wall clock (moved verbatim
 * from the digest helper). DST policy:
 *   - SKIPPED hour (spring forward, 02:00–02:59 never happens): rolls FORWARD past the gap —
 *     2026-03-08 02:30 → 07:30Z (03:30 EDT). A cutoff there is not "missed" until the gap is over.
 *   - REPEATED hour (fall back, 01:00–01:59 happens twice): the FIRST (daylight-time) occurrence —
 *     2026-11-01 01:30 → 05:30Z (01:30 EDT).
 */
export function etWallMinutesInstant(day: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const target = Date.parse(`${day}T${hh}:${mm}:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(EASTERN_PARTS.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += target - wall;
  }
  return new Date(instant);
}

/**
 * The UTC instant of an ET WALL-CLOCK time ("HH:MM[:SS]", a Postgres `time` render) on the ET
 * calendar date `dateYmd`, as an ISO string — with the offset read AT THAT TIME, not at midnight.
 * "ET midnight + elapsed hours" is wrong for every time after 2 AM on a DST-transition day (review
 * of B7b D-63, 2026-10-14): on Sun 2026-11-01 an 11:00 cutoff came out as 10:00 EST, on Sun
 * 2026-03-08 as 12:00 EDT. Delegates to `etWallMinutesInstant` (the digest's resolver), so the DST
 * edge hours follow its policy: a skipped time rolls forward, a repeated time is its first
 * occurrence. Seconds are added after the minute resolves. Returns null on a malformed date or
 * time — never a fabricated instant.
 */
export function etWallClockToUtcIso(dateYmd: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !Number.isFinite(Date.parse(`${dateYmd}T00:00:00Z`))) return null;
  const parts = time.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}(\.\d+)?$/.test(p))) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2] ?? "0");
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  if (!Number.isFinite(s) || s < 0 || s >= 60) return null;
  const at = etWallMinutesInstant(dateYmd, h * 60 + Math.floor(m)).getTime() + Math.floor(s) * 1000;
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * The UTC instant range [startIso, endExclusiveIso) covering one ET operational
 * day `dateYmd` (YYYY-MM-DD). Use for timestamptz range filters:
 *   .gte("created_at", startIso).lt("created_at", endExclusiveIso)
 * DST-correct: resolve each ET midnight independently. The next midnight is
 * 23, 24, or 25 hours later, so adjacent days have no gap or overlap.
 */
export function operationalDayUtcRange(dateYmd: string): { startIso: string; endExclusiveIso: string } {
  const midnightIso = (ymd: string): string => {
    const naiveMidnightUtc = Date.parse(`${ymd}T00:00:00Z`);
    const off = tzOffsetMs(new Date(naiveMidnightUtc));
    return new Date(naiveMidnightUtc - off).toISOString(); // ET midnight = UTC midnight − offset
  };
  return { startIso: midnightIso(dateYmd), endExclusiveIso: midnightIso(etYmdMinusDays(dateYmd, -1)) };
}

/**
 * True once operational day `dateYmd` (YYYY-MM-DD, ET) has reached the ET wall-clock time
 * `hhmm` (24-hour "HH:mm"), or the day is already over; false before it, and for a day that
 * has not started. Business-day aware the only way CO's day works: the ET calendar date
 * (etCalendarDate) is the business day, so 00:30 on the 15th has NOT reached 18:00 on the
 * 15th, while any time on the 15th is past 18:00 on the 14th. DST-proof: compares the ET
 * date and the ET wall clock, never a computed offset.
 */
export function etReachedClockOn(nowIso: string, dateYmd: string, hhmm: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) throw new Error(`etReachedClockOn: bad ymd "${dateYmd}"`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new Error(`etReachedClockOn: bad time "${hhmm}"`);
  const today = etCalendarDate(nowIso);
  if (today !== dateYmd) return today > dateYmd;
  return etClockTime(nowIso) >= hhmm;
}

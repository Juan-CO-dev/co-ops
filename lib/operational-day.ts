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

/** The ET calendar date (YYYY-MM-DD) an ISO/UTC instant falls on. en-CA → always
 *  zero-padded + lexicographically sortable. */
export function etCalendarDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: OPERATIONAL_TZ });
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

/**
 * The UTC instant range [startIso, endExclusiveIso) covering one ET operational
 * day `dateYmd` (YYYY-MM-DD). Use for timestamptz range filters:
 *   .gte("created_at", startIso).lt("created_at", endExclusiveIso)
 * DST-correct: the offset is read at the day's own naive-UTC-midnight guess (DST
 * never flips within the ~4-5h correction), and the end is start + 24h so a
 * spring-forward/fall-back day still bounds its own rows without gap/overlap.
 */
export function operationalDayUtcRange(dateYmd: string): { startIso: string; endExclusiveIso: string } {
  const naiveMidnightUtc = Date.parse(`${dateYmd}T00:00:00Z`);
  const off = tzOffsetMs(new Date(naiveMidnightUtc));
  const startMs = naiveMidnightUtc - off; // ET-midnight = UTC-midnight − offset
  const endMs = startMs + 86_400_000;
  return { startIso: new Date(startMs).toISOString(), endExclusiveIso: new Date(endMs).toISOString() };
}

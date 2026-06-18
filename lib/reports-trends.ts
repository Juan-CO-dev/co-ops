import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TrendGranularity = "day" | "week" | "month";
export type TrendFamily = "par" | "temps" | "cash" | "completion";

export interface Viewer {
  userId: string;
  level: number;
}

/**
 * One time bucket. `key` is the bucket-start date (YYYY-MM-DD): the day itself,
 * the ISO-week Monday, or the first of the month. `hasData: false` → no report
 * in this bucket; render as a GAP, not a zero.
 */
export interface TrendBucket {
  key: string;
  hasData: boolean;
  underPar: number;
  overPar: number;
  tempFlags: number;
  cashOverShortCents: number | null; // null when no cash report OR family redacted
  completionPct: number | null;      // 0..100; null when no required items that bucket
}

export interface FamilyTotal {
  current: number | null;
  previous: number | null;
  delta: number | null; // current - previous; null when either side null
}

export interface TrendSeries {
  granularity: TrendGranularity;
  current: TrendBucket[];
  previous: TrendBucket[] | null; // null when compare is off
  totals: Record<TrendFamily, FamilyTotal>;
  cashVisible: boolean; // false for viewers < REPORTS_HUB_CASH_LEVEL (cash family omitted)
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure date / bucket / window helpers
//
// All math walks calendar days on YYYY-MM-DD strings anchored to UTC — no TZ
// conversion (we're walking calendar days, not converting zones), which
// sidesteps DST. Bucket keys ARE the bucket-start date, so current/previous
// windows built from bucket starts are disjoint by construction (no shared
// partial week/month at the boundary).
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many buckets each granularity shows (and the previous window mirrors). */
export const BUCKET_COUNT: Record<TrendGranularity, number> = { day: 30, week: 12, month: 6 };

export function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoWeekMonday(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function bucketStart(yyyymmdd: string, g: TrendGranularity): string {
  if (g === "day") return yyyymmdd;
  if (g === "week") return isoWeekMonday(yyyymmdd);
  return `${yyyymmdd.slice(0, 7)}-01`; // month
}

/** The bucket-start immediately before a given bucket-start. */
function prevBucketStart(bs: string, g: TrendGranularity): string {
  if (g === "day") return addDays(bs, -1);
  if (g === "week") return addDays(bs, -7);
  // month: first of previous month
  const y = Number(bs.slice(0, 4));
  const m = Number(bs.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

/** N bucket starts ending at `today`'s bucket, ascending. */
function bucketStartsEndingAt(today: string, g: TrendGranularity, n: number): string[] {
  const out: string[] = [];
  let bs = bucketStart(today, g);
  for (let i = 0; i < n; i++) {
    out.push(bs);
    bs = prevBucketStart(bs, g);
  }
  return out.reverse();
}

export interface TrendWindows {
  currentKeys: string[];           // ascending bucket starts
  previousKeys: string[] | null;   // ascending bucket starts, or null when compare off
  loadFrom: string;                // earliest date to query (inclusive)
  loadTo: string;                  // latest date to query (inclusive)
}

/** Build the current (and optional previous) bucket-key lists + the raw date span to load. */
export function computeWindows(today: string, g: TrendGranularity, compare: boolean): TrendWindows {
  const n = BUCKET_COUNT[g];
  const currentKeys = bucketStartsEndingAt(today, g, n);
  const curFrom = currentKeys[0]!; // n >= 1
  let previousKeys: string[] | null = null;
  let loadFrom = curFrom;
  if (compare) {
    const prev: string[] = [];
    let bs = prevBucketStart(curFrom, g);
    for (let i = 0; i < n; i++) {
      prev.push(bs);
      bs = prevBucketStart(bs, g);
    }
    previousKeys = prev.reverse();
    loadFrom = previousKeys[0]!;
  }
  return { currentKeys, previousKeys, loadFrom, loadTo: today };
}

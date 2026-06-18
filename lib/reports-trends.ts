import type { SupabaseClient } from "@supabase/supabase-js";
import { isPrepData } from "@/lib/prep";
import {
  REPORTS_HUB_CASH_LEVEL,
  checklistReportType,
  loadLocationTempItemIds,
  type ReportTypeKey,
} from "@/lib/reports-hub";
import { derivePrepHave, parStatusFromHave, isOutOfRangeTemp } from "@/lib/report-signals";

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

// ─────────────────────────────────────────────────────────────────────────────
// loadTrendSeries — bulk-load the window once, aggregate per bucket in memory.
//
// NOT a per-date loop over computeReportSignals (that is the N+1 / fetch-all-
// then-filter trap). We load all in-scope instances, their templates + required
// items + live completions, and cash reports for the FULL span (current ∪
// previous) in a handful of location-scoped queries, then fold each row into
// its bucket.
//
// SECURITY: every query filters location_id = args.locationId (the IDOR "bind
// the record" half; the page validated the param via lockLocationContext).
// Cash is omitted entirely for viewers below REPORTS_HUB_CASH_LEVEL.
// ─────────────────────────────────────────────────────────────────────────────

interface BucketAcc {
  hasData: boolean;
  underPar: number;
  overPar: number;
  tempFlags: number;
  doneSum: number;
  reqSum: number;
  cashSum: number;
  cashCount: number;
}

function emptyAcc(): BucketAcc {
  return { hasData: false, underPar: 0, overPar: 0, tempFlags: 0, doneSum: 0, reqSum: 0, cashSum: 0, cashCount: 0 };
}

export async function loadTrendSeries(
  service: SupabaseClient,
  args: {
    viewer: Viewer;
    locationId: string; // authorized upstream via lockLocationContext
    granularity: TrendGranularity;
    compare: boolean;
    today: string; // operationalNow(new Date()).date
  },
): Promise<TrendSeries> {
  const cashVisible = args.viewer.level >= REPORTS_HUB_CASH_LEVEL;
  const { currentKeys, previousKeys, loadFrom, loadTo } = computeWindows(
    args.today,
    args.granularity,
    args.compare,
  );

  const acc = new Map<string, BucketAcc>();
  const bump = (key: string): BucketAcc => {
    let a = acc.get(key);
    if (!a) {
      a = emptyAcc();
      acc.set(key, a);
    }
    return a;
  };

  // ── 1. Instances in span (IDOR-bound) ──
  const { data: instData } = await service
    .from("checklist_instances")
    .select("id, location_id, date, template_id")
    .eq("location_id", args.locationId)
    .gte("date", loadFrom)
    .lte("date", loadTo);
  const instances = (instData ?? []) as Array<{
    id: string;
    location_id: string;
    date: string;
    template_id: string;
  }>;

  // ── 2. Template → ReportTypeKey + required-item ids ──
  const tmplIds = [...new Set(instances.map((i) => i.template_id))];
  const typeByTmpl = new Map<string, ReportTypeKey>();
  const requiredByTmpl = new Map<string, Set<string>>();
  if (tmplIds.length) {
    const { data: tmpls } = await service
      .from("checklist_templates")
      .select("id, type, prep_subtype")
      .in("id", tmplIds);
    for (const t of (tmpls ?? []) as Array<{ id: string; type: string; prep_subtype: string | null }>) {
      const rt = checklistReportType(t.type, t.prep_subtype);
      if (rt) typeByTmpl.set(t.id, rt);
    }
    const { data: titems } = await service
      .from("checklist_template_items")
      .select("id, template_id, required")
      .in("template_id", tmplIds)
      .eq("active", true);
    for (const ti of (titems ?? []) as Array<{ id: string; template_id: string; required: boolean }>) {
      if (!ti.required) continue;
      let s = requiredByTmpl.get(ti.template_id);
      if (!s) {
        s = new Set<string>();
        requiredByTmpl.set(ti.template_id, s);
      }
      s.add(ti.id);
    }
  }

  // ── 3. Live completions for those instances ──
  const instIds = instances.map((i) => i.id);
  const compsByInst = new Map<
    string,
    Array<{ template_item_id: string; count_value: number | null; prep_data: unknown }>
  >();
  if (instIds.length) {
    const { data: comps } = await service
      .from("checklist_completions")
      .select("instance_id, template_item_id, count_value, prep_data")
      .in("instance_id", instIds)
      .is("superseded_at", null)
      .is("revoked_at", null);
    for (const c of (comps ?? []) as Array<{
      instance_id: string;
      template_item_id: string;
      count_value: number | null;
      prep_data: unknown;
    }>) {
      let list = compsByInst.get(c.instance_id);
      if (!list) {
        list = [];
        compsByInst.set(c.instance_id, list);
      }
      list.push({ template_item_id: c.template_item_id, count_value: c.count_value, prep_data: c.prep_data });
    }
  }

  // ── 4. Temp-item registry for the location ──
  const tempItemIds = await loadLocationTempItemIds(service, args.locationId);

  // ── 5. Fold each instance into its bucket ──
  for (const inst of instances) {
    const rt = typeByTmpl.get(inst.template_id);
    if (!rt) continue;
    const key = bucketStart(inst.date, args.granularity);
    const a = bump(key);
    a.hasData = true;

    const comps = compsByInst.get(inst.id) ?? [];
    const isMidDay = rt === "mid_day";

    for (const c of comps) {
      if (tempItemIds.has(c.template_item_id) && isOutOfRangeTemp(c.count_value)) {
        a.tempFlags++;
      }
      if (isPrepData(c.prep_data)) {
        const par = c.prep_data.snapshot.parValue;
        const have = derivePrepHave({
          isMidDay,
          onHand: c.prep_data.inputs.onHand ?? null,
          total: c.prep_data.inputs.total ?? null,
        });
        const status = parStatusFromHave(par, have);
        if (status === "under") a.underPar++;
        else if (status === "over") a.overPar++;
      }
    }

    const required = requiredByTmpl.get(inst.template_id);
    if (required && required.size > 0) {
      const completedIds = new Set(comps.map((c) => c.template_item_id));
      let done = 0;
      for (const reqId of required) if (completedIds.has(reqId)) done++;
      a.doneSum += done;
      a.reqSum += required.size;
    }
  }

  // ── 6. Cash reports (KH+ only) ──
  if (cashVisible) {
    const { data: cash } = await service
      .from("cash_reports")
      .select("location_id, report_date, over_short_cents")
      .eq("location_id", args.locationId)
      .gte("report_date", loadFrom)
      .lte("report_date", loadTo)
      .is("superseded_at", null);
    for (const r of (cash ?? []) as Array<{ location_id: string; report_date: string; over_short_cents: number | null }>) {
      const key = bucketStart(r.report_date, args.granularity);
      const a = bump(key);
      a.hasData = true;
      if (r.over_short_cents !== null) {
        a.cashSum += r.over_short_cents;
        a.cashCount++;
      }
    }
  }

  // ── 7. Materialize ordered buckets ──
  const toBucket = (key: string): TrendBucket => {
    const a = acc.get(key);
    if (!a || !a.hasData) {
      return { key, hasData: false, underPar: 0, overPar: 0, tempFlags: 0, cashOverShortCents: null, completionPct: null };
    }
    return {
      key,
      hasData: true,
      underPar: a.underPar,
      overPar: a.overPar,
      tempFlags: a.tempFlags,
      cashOverShortCents: cashVisible && a.cashCount > 0 ? a.cashSum : null,
      completionPct: a.reqSum > 0 ? Math.round((a.doneSum / a.reqSum) * 100) : null,
    };
  };

  const current = currentKeys.map(toBucket);
  const previous = previousKeys ? previousKeys.map(toBucket) : null;

  // ── 8. Family totals + deltas ──
  const sum = (buckets: TrendBucket[], pick: (b: TrendBucket) => number) =>
    buckets.reduce((s, b) => s + pick(b), 0);

  const cashSumOf = (buckets: TrendBucket[]): number | null => {
    const present = buckets.filter((b) => b.cashOverShortCents !== null);
    if (!present.length) return null;
    return present.reduce((s, b) => s + (b.cashOverShortCents ?? 0), 0);
  };

  const completionOf = (keys: string[]): number | null => {
    let done = 0;
    let req = 0;
    for (const k of keys) {
      const a = acc.get(k);
      if (a) {
        done += a.doneSum;
        req += a.reqSum;
      }
    }
    return req > 0 ? Math.round((done / req) * 100) : null;
  };

  const mkTotal = (cur: number | null, prev: number | null): FamilyTotal => ({
    current: cur,
    previous: prev,
    delta: cur !== null && prev !== null ? cur - prev : null,
  });

  const prevKeys = previousKeys ?? [];
  const totals: Record<TrendFamily, FamilyTotal> = {
    par: mkTotal(sum(current, (b) => b.underPar), previous ? sum(previous, (b) => b.underPar) : null),
    temps: mkTotal(sum(current, (b) => b.tempFlags), previous ? sum(previous, (b) => b.tempFlags) : null),
    cash: cashVisible
      ? mkTotal(cashSumOf(current), previous ? cashSumOf(previous) : null)
      : { current: null, previous: null, delta: null },
    completion: mkTotal(completionOf(currentKeys), previous ? completionOf(prevKeys) : null),
  };

  return { granularity: args.granularity, current, previous, totals, cashVisible };
}

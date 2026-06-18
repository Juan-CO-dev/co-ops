# Reports Hub Trend Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add operational-signal trend charts (par / temps / cash / completion) over Day/Week/Month with period-over-period comparison, on a `/reports/trends` page plus a dashboard widget, fed by one shared loader.

**Architecture:** A new `lib/reports-trends.ts` bulk-loads a date window's data once and aggregates per bucket in memory (no per-date `computeReportSignals` N+1). The bug-prone par-derivation math is factored into `lib/report-signals.ts` and shared with the existing hub loader. Hand-rolled SVG components render the charts (no chart-library dependency). Tier redaction (cash KH+) and the cross-location IDOR guard mirror the existing hub.

**Tech Stack:** Next.js 16 (App Router, Server Components, Turbopack), React 19, TypeScript strict + `noUncheckedIndexedAccess`, Supabase (service-role reads), Tailwind v4 CSS tokens. No test framework — verify via `tsc --noEmit` + `next build` + throwaway `tsx` smokes against live rows.

**Branch:** `claude/reports-trends` (already created; spec already committed there).

**Spec:** `docs/superpowers/specs/2026-06-17-reports-hub-trends-design.md`

---

## Key facts the implementer must respect (read before starting)

- **`prep_data.inputs.total` means different things by type.** AM-prep: it's the FINAL amount. Mid-day: it's a prepped DELTA on top of `onHand` (final = onHand + delta). Getting this wrong reports a reached-par mid-day item as "under." Task 1 factors this into `derivePrepHave` so it lives in exactly one place.
- **Temp flag** = a completion whose `template_item_id` is in the location's `maintenance_equipment` fridge registry (`loadLocationTempItemIds`) AND `count_value > 41` (`FRIDGE_DEFAULT_SAFE_MAX_F`). Never "any count_value > 41" — prep totals exceed 41 and would false-positive.
- **IDOR two halves:** the page validates the `?location=` param with `lockLocationContext`; the loader must bind `location_id = <authorized>` on EVERY query. Both are required.
- **Cash is KH+** (`REPORTS_HUB_CASH_LEVEL = 4`). For viewers below L4 the cash family is omitted from loader output (`cashVisible: false`), not just hidden in the UI.
- **Missing buckets are gaps, not zeros** (`hasData: false`). A day with no report ≠ "0 under par."
- **Live completions** = `.is("superseded_at", null).is("revoked_at", null)`.
- **Date math:** walk calendar days on `YYYY-MM-DD` strings anchored to UTC (sidesteps DST). The operational "today" comes from `operationalNow(new Date()).date` (from `lib/midshift.ts`), matching `/reports`.
- **noUncheckedIndexedAccess:** array index access returns `T | undefined`. Guard or use `!` only where a loop/length proves non-empty (comment it).
- **i18n:** flat dotted keys in `lib/i18n/en.json` + `lib/i18n/es.json`, kept at exact parity. New namespace `reports.trends.*`. Spanish is operational tú-form.

---

## File structure

- **Create `lib/report-signals.ts`** — pure, dependency-light signal-derivation helpers (`derivePrepHave`, `parStatusFromHave`, `isOutOfRangeTemp`). Shared by the hub loader and the trends loader.
- **Modify `lib/reports-hub.ts`** — export `checklistReportType`; rewire `computeReportSignals` to call the new helpers (behavior-preserving).
- **Create `lib/reports-trends.ts`** — `loadTrendSeries` + types + pure date/bucket/window helpers.
- **Create `components/trends/LineChart.tsx`**, **`BarChart.tsx`** — hand-rolled SVG primitives.
- **Create `components/trends/TrendCard.tsx`**, **`TrendControls.tsx`** — card shell (chart + headline + delta + how-to-read) and the Day/Week/Month + compare controls (server-rendered Links).
- **Create `app/(authed)/reports/trends/page.tsx`** — layout A (stacked cards).
- **Modify `app/(authed)/reports/page.tsx`** — add a "Trends" link.
- **Create `components/trends/TrendsWidget.tsx`** — layout B (2×2 grid) for the dashboard.
- **Modify `app/(authed)/dashboard/page.tsx`** — load a compact series + render the widget.
- **Modify `lib/i18n/en.json` + `lib/i18n/es.json`** — `reports.trends.*` keys.

---

### Task 1: Factor par/temp derivation into `lib/report-signals.ts` and rewire the hub loader

**Files:**
- Create: `lib/report-signals.ts`
- Modify: `lib/reports-hub.ts` (export `checklistReportType`; rewire `computeReportSignals`)
- Smoke: `scripts/smoke-report-signals.ts` (throwaway)

- [ ] **Step 1: Write the failing smoke**

Create `scripts/smoke-report-signals.ts`:

```ts
import {
  derivePrepHave,
  parStatusFromHave,
  isOutOfRangeTemp,
} from "@/lib/report-signals";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

// am_prep: total is FINAL → have = total ?? onHand
assert(derivePrepHave({ isMidDay: false, onHand: 5, total: 20 }) === 20, "am_prep have = total");
assert(derivePrepHave({ isMidDay: false, onHand: 5, total: null }) === 5, "am_prep have falls back to onHand");
assert(derivePrepHave({ isMidDay: false, onHand: null, total: null }) === null, "am_prep have null when both null");

// mid_day: total is DELTA → have = onHand + total
assert(derivePrepHave({ isMidDay: true, onHand: 8, total: 12 }) === 20, "mid_day have = onHand + delta");
assert(derivePrepHave({ isMidDay: true, onHand: null, total: null }) === null, "mid_day have null when both null");
assert(derivePrepHave({ isMidDay: true, onHand: 8, total: null }) === 8, "mid_day have = onHand when delta null");

// par status
assert(parStatusFromHave(20, 18) === "under", "under par");
assert(parStatusFromHave(20, 22) === "over", "over par");
assert(parStatusFromHave(20, 20) === "at", "at par");
assert(parStatusFromHave(null, 20) === "na", "na when no par");
assert(parStatusFromHave(20, null) === "na", "na when no have");

// temp flag
assert(isOutOfRangeTemp(42) === true, "42F is out of range");
assert(isOutOfRangeTemp(41) === false, "41F is in range (<=41 safe)");
assert(isOutOfRangeTemp(null) === false, "null is not a flag");

console.log("ALL PASS");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --env-file=.env.local scripts/smoke-report-signals.ts`
Expected: FAIL — `Cannot find module '@/lib/report-signals'`.

- [ ] **Step 3: Create `lib/report-signals.ts`**

```ts
/**
 * Pure signal-derivation helpers shared by the Reports Hub list/detail loader
 * (lib/reports-hub.ts computeReportSignals) and the trends loader
 * (lib/reports-trends.ts). Extracted so the bug-prone par math lives in ONE
 * place — a mid-day prepped DELTA vs an am-prep FINAL amount diverge here and
 * nowhere else (see AGENTS.md "Same field name, different meaning across types").
 */

import { FRIDGE_DEFAULT_SAFE_MAX_F } from "@/lib/maintenance";

export interface PrepHaveInput {
  /** True for mid-day prep (inputs.total is a prepped delta), false for am-prep/other (inputs.total is final). */
  isMidDay: boolean;
  onHand: number | null;
  total: number | null;
}

/**
 * The true on-hand amount to compare against par.
 *   - mid_day: inputs.total is a prepped DELTA → have = onHand + total
 *   - am_prep / other: inputs.total is the FINAL amount → have = total ?? onHand
 * Returns null when neither value is present.
 */
export function derivePrepHave({ isMidDay, onHand, total }: PrepHaveInput): number | null {
  if (isMidDay) {
    return onHand === null && total === null ? null : (onHand ?? 0) + (total ?? 0);
  }
  return total ?? onHand ?? null;
}

export type ParStatus = "under" | "over" | "at" | "na";

export function parStatusFromHave(par: number | null, have: number | null): ParStatus {
  if (par === null || have === null) return "na";
  if (have < par) return "under";
  if (have > par) return "over";
  return "at";
}

/**
 * True when a fridge-temp reading is out of safe range (> 41°F). The CALLER
 * must already know the completion's template_item_id is in the location's
 * temp-item registry — this only checks the count, never "any count > 41".
 */
export function isOutOfRangeTemp(countValue: number | null): boolean {
  return countValue !== null && countValue > FRIDGE_DEFAULT_SAFE_MAX_F;
}
```

- [ ] **Step 4: Run smoke to verify it passes**

Run: `npx tsx --env-file=.env.local scripts/smoke-report-signals.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Rewire `computeReportSignals` + export `checklistReportType` (behavior-preserving)**

In `lib/reports-hub.ts`:

1. Add the import near the top (after the existing `isPrepData` import):

```ts
import { derivePrepHave, parStatusFromHave, isOutOfRangeTemp } from "@/lib/report-signals";
```

2. Export the mapper — change `function checklistReportType(` to `export function checklistReportType(`.

3. In `computeReportSignals`, inside the `for (const r of rows)` loop, replace the temp-flag block:

```ts
    if (
      args.tempItemIds.has(r.template_item_id) &&
      r.count_value !== null &&
      r.count_value > FRIDGE_DEFAULT_SAFE_MAX_F
    ) {
      tempFlags++;
    }
```

with:

```ts
    if (args.tempItemIds.has(r.template_item_id) && isOutOfRangeTemp(r.count_value)) {
      tempFlags++;
    }
```

4. Replace the prep `have`/`displayTotal`/`parStatus` block (the `if (isPrepData(r.prep_data)) { ... }` body, from `const par =` through the `parStatus` if/else) with:

```ts
    if (isPrepData(r.prep_data)) {
      const par = r.prep_data.snapshot.parValue; // number | null
      const totalVal = r.prep_data.inputs.total ?? null;
      const onHand = r.prep_data.inputs.onHand ?? null;
      const isMidDay = args.type === "mid_day";
      // Shared derivation — mid_day total is a DELTA, am_prep total is FINAL.
      const have = derivePrepHave({ isMidDay, onHand, total: totalVal });
      const displayTotal = isMidDay ? have : totalVal;
      const parStatus = parStatusFromHave(par, have);
      if (parStatus === "under") underPar++;
      else if (parStatus === "over") overPar++;
      prepValues.push({
        label: labelById.get(r.template_item_id) ?? "—",
        par,
        onHand,
        total: displayTotal,
        parStatus,
      });
    }
```

This preserves the exact prior behavior: `displayTotal` is `have` for mid_day (true final) and `totalVal` for am_prep; `parStatus` semantics are identical.

- [ ] **Step 6: Verify the hub is unchanged**

Run: `npx tsc --noEmit`
Expected: no errors.

Run a behavior smoke — create `scripts/smoke-hub-unchanged.ts` (throwaway), pick one real prep report id from prod and assert signals are sane:

```ts
import { computeReportSignals, loadLocationTempItemIds } from "@/lib/reports-hub";
import { getServiceRoleClient } from "@/lib/supabase-server";

const sb = getServiceRoleClient();
// Find a recent am_prep instance (prep template, prep_subtype am_prep).
const { data: tmpl } = await sb.from("checklist_templates")
  .select("id, location_id").eq("type", "prep").eq("prep_subtype", "am_prep").eq("active", true).limit(1).maybeSingle();
if (!tmpl) { console.log("no am_prep template; skipping"); process.exit(0); }
const { data: inst } = await sb.from("checklist_instances")
  .select("id").eq("template_id", tmpl.id).order("date", { ascending: false }).limit(1).maybeSingle();
if (!inst) { console.log("no am_prep instance; skipping"); process.exit(0); }
const tempIds = await loadLocationTempItemIds(sb, tmpl.location_id);
const { signals, prepValues } = await computeReportSignals(sb, { type: "am_prep", id: inst.id, tempItemIds: tempIds });
console.log("signals:", signals);
console.log("prepValues sample:", prepValues.slice(0, 3));
if (signals.underPar < 0 || signals.overPar < 0) throw new Error("FAIL: negative par counts");
console.log("OK hub computeReportSignals still sane");
```

Run: `npx tsx --env-file=.env.local scripts/smoke-hub-unchanged.ts`
Expected: prints signals, `OK hub computeReportSignals still sane`.

- [ ] **Step 7: Delete throwaway smokes and commit**

```bash
rm scripts/smoke-report-signals.ts scripts/smoke-hub-unchanged.ts
git add lib/report-signals.ts lib/reports-hub.ts
git commit -m "refactor(reports): extract shared par/temp signal helpers into lib/report-signals.ts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Trends types + pure date/bucket/window helpers

**Files:**
- Create: `lib/reports-trends.ts` (types + pure helpers only; loader added in Task 3)
- Smoke: `scripts/smoke-trends-dates.ts` (throwaway)

- [ ] **Step 1: Write the failing smoke**

Create `scripts/smoke-trends-dates.ts`:

```ts
import {
  addDays,
  bucketStart,
  computeWindows,
  BUCKET_COUNT,
} from "@/lib/reports-trends";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }

assert(addDays("2026-06-17", -1) === "2026-06-16", "addDays -1");
assert(addDays("2026-03-01", -1) === "2026-02-28", "addDays crosses month");

assert(bucketStart("2026-06-17", "day") === "2026-06-17", "day bucketStart = self");
assert(bucketStart("2026-06-17", "month") === "2026-06-01", "month bucketStart = first");
// 2026-06-17 is a Wednesday → ISO week Monday is 2026-06-15
assert(bucketStart("2026-06-17", "week") === "2026-06-15", "week bucketStart = Monday");

const w = computeWindows("2026-06-17", "day", true);
assert(w.currentKeys.length === BUCKET_COUNT.day, "current has BUCKET_COUNT.day keys");
assert(w.previousKeys!.length === BUCKET_COUNT.day, "previous has BUCKET_COUNT.day keys");
assert(w.currentKeys[w.currentKeys.length - 1] === "2026-06-17", "last current key is today");
// disjoint
const overlap = w.currentKeys.filter((k) => w.previousKeys!.includes(k));
assert(overlap.length === 0, "current and previous windows are disjoint");
// previous immediately precedes current
assert(w.previousKeys![w.previousKeys!.length - 1] === addDays(w.currentKeys[0]!, -1), "previous ends day before current starts");

const wNoCmp = computeWindows("2026-06-17", "day", false);
assert(wNoCmp.previousKeys === null, "no compare → previousKeys null");

const wm = computeWindows("2026-06-17", "month", true);
assert(wm.currentKeys.length === BUCKET_COUNT.month, "month current count");
assert(wm.currentKeys[wm.currentKeys.length - 1] === "2026-06-01", "month last bucket = this month start");

console.log("ALL PASS");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --env-file=.env.local scripts/smoke-trends-dates.ts`
Expected: FAIL — `Cannot find module '@/lib/reports-trends'`.

- [ ] **Step 3: Create `lib/reports-trends.ts` with types + pure helpers**

```ts
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
```

- [ ] **Step 4: Run smoke to verify it passes**

Run: `npx tsx --env-file=.env.local scripts/smoke-trends-dates.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Delete throwaway smoke and commit**

```bash
rm scripts/smoke-trends-dates.ts
git add lib/reports-trends.ts
git commit -m "feat(reports-trends): trend types + pure date/bucket/window helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `loadTrendSeries` — bulk-load + in-memory aggregation

**Files:**
- Modify: `lib/reports-trends.ts` (append the loader)
- Smoke: `scripts/smoke-trends-loader.ts` (throwaway)

- [ ] **Step 1: Append `loadTrendSeries` to `lib/reports-trends.ts`**

Add these imports at the top of the file (below the existing `SupabaseClient` import):

```ts
import { isPrepData } from "@/lib/prep";
import {
  REPORTS_HUB_CASH_LEVEL,
  checklistReportType,
  loadLocationTempItemIds,
  type ReportTypeKey,
} from "@/lib/reports-hub";
import { derivePrepHave, parStatusFromHave, isOutOfRangeTemp } from "@/lib/report-signals";
```

Append the loader and its private accumulator:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// loadTrendSeries — bulk-load the window once, aggregate per bucket in memory.
//
// NOT a per-date loop over computeReportSignals (that is the N+1 / fetch-all-
// then-filter trap from the polish pass). We load all in-scope instances,
// their templates + required items + live completions, and cash reports for
// the FULL span (current ∪ previous) in a handful of location-scoped queries,
// then fold each row into its bucket.
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
  doneSum: number;   // completed required items across the bucket's instances
  reqSum: number;    // required items across the bucket's instances
  cashSum: number;   // summed over_short_cents
  cashCount: number; // # of cash reports in the bucket
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

    // par + temps from this instance's completions
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

    // completion: done required / total required for this instance
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
```

- [ ] **Step 2: Write the live-data smoke**

Create `scripts/smoke-trends-loader.ts`:

```ts
import { loadTrendSeries } from "@/lib/reports-trends";
import { getServiceRoleClient } from "@/lib/supabase-server";

const sb = getServiceRoleClient();
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }

// Pick a location that has data.
const { data: loc } = await sb.from("locations").select("id, code").eq("active", true).order("code").limit(1).maybeSingle<{ id: string; code: string }>();
if (!loc) { console.log("no location; skipping"); process.exit(0); }
const today = new Date().toISOString().slice(0, 10);

// L4+ viewer (cash visible)
const mgr = await loadTrendSeries(sb, { viewer: { userId: "smoke", level: 4 }, locationId: loc.id, granularity: "day", compare: true, today });
assert(mgr.cashVisible === true, "L4 sees cash");
assert(mgr.current.length === 30, "day window = 30 buckets");
assert(mgr.previous !== null && mgr.previous.length === 30, "compare gives 30 previous buckets");
assert(mgr.current.every((b) => b.underPar >= 0 && b.overPar >= 0 && b.tempFlags >= 0), "no negative counts");
assert(mgr.current.every((b) => b.completionPct === null || (b.completionPct >= 0 && b.completionPct <= 100)), "completion 0..100 or null");
assert(mgr.current.some((b) => !b.hasData) || mgr.current.every((b) => b.hasData), "gap buckets allowed (hasData false where no report)");
// delta math
if (mgr.totals.par.current !== null && mgr.totals.par.previous !== null) {
  assert(mgr.totals.par.delta === mgr.totals.par.current - mgr.totals.par.previous, "par delta = current - previous");
}

// L3 viewer (cash hidden)
const emp = await loadTrendSeries(sb, { viewer: { userId: "smoke", level: 3 }, locationId: loc.id, granularity: "day", compare: false, today });
assert(emp.cashVisible === false, "L3 cash hidden");
assert(emp.current.every((b) => b.cashOverShortCents === null), "L3 cash bucket values all null");
assert(emp.totals.cash.current === null, "L3 cash total null");
assert(emp.previous === null, "no compare → previous null");

// IDOR: a bogus location id returns all-empty (no leak)
const bogus = await loadTrendSeries(sb, { viewer: { userId: "smoke", level: 4 }, locationId: "00000000-0000-0000-0000-000000000000", granularity: "day", compare: false, today });
assert(bogus.current.every((b) => !b.hasData), "bogus location → all gap buckets (no cross-location leak)");

// week + month granularity shapes
const wk = await loadTrendSeries(sb, { viewer: { userId: "smoke", level: 4 }, locationId: loc.id, granularity: "week", compare: false, today });
assert(wk.current.length === 12, "week window = 12 buckets");
const mo = await loadTrendSeries(sb, { viewer: { userId: "smoke", level: 4 }, locationId: loc.id, granularity: "month", compare: false, today });
assert(mo.current.length === 6, "month window = 6 buckets");

console.log("ALL PASS");
```

- [ ] **Step 3: Run the smoke**

Run: `npx tsx --env-file=.env.local scripts/smoke-trends-loader.ts`
Expected: `ALL PASS`. If a location genuinely has zero reports, the gap assertions still hold (all `hasData: false`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Delete throwaway smoke and commit**

```bash
rm scripts/smoke-trends-loader.ts
git add lib/reports-trends.ts
git commit -m "feat(reports-trends): loadTrendSeries — bulk-load + bucket aggregation, cash gate, IDOR bind

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: SVG chart primitives (`LineChart`, `BarChart`)

**Files:**
- Create: `components/trends/LineChart.tsx`
- Create: `components/trends/BarChart.tsx`

These are pure presentational Server Components (no client JS). They take already-computed number arrays and draw inline SVG with brand-token colors. `null` points are gaps. Verified by `tsc` + `next build` (no DOM test framework; visual correctness is confirmed in Juan's smoke).

- [ ] **Step 1: Create `components/trends/LineChart.tsx`**

```tsx
/**
 * Hand-rolled SVG line chart (no chart-library dependency). Pure
 * presentational Server Component. Draws one or two series over a shared
 * x-domain; `null` points are GAPS (the line breaks, never interpolates a
 * fake zero). Optional zero baseline for signed series (cash over/short).
 */

export interface LineSeries {
  points: (number | null)[];
  /** CSS color string, e.g. "var(--co-danger)". */
  color: string;
  dashed?: boolean;
}

export function LineChart({
  series,
  zeroBaseline = false,
  height = 96,
  ariaLabel,
}: {
  series: LineSeries[];
  zeroBaseline?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const width = 320;
  const padY = 8;
  const n = Math.max(1, ...series.map((s) => s.points.length));

  const allVals = series.flatMap((s) => s.points.filter((p): p is number => p !== null));
  if (zeroBaseline) allVals.push(0);
  let min = allVals.length ? Math.min(...allVals) : 0;
  let max = allVals.length ? Math.max(...allVals) : 1;
  if (min === max) {
    // flat series — pad so it renders mid-height
    min -= 1;
    max += 1;
  }

  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v: number) => padY + (1 - (v - min) / (max - min)) * (height - 2 * padY);

  // Build a polyline path that breaks on null (gap).
  const pathFor = (points: (number | null)[]): string => {
    let d = "";
    let penDown = false;
    points.forEach((p, i) => {
      if (p === null) {
        penDown = false;
        return;
      }
      d += `${penDown ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)} `;
      penDown = true;
    });
    return d.trim();
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      {zeroBaseline && min < 0 && max > 0 ? (
        <line x1={0} y1={y(0)} x2={width} y2={y(0)} stroke="var(--co-border)" strokeWidth={1} />
      ) : null}
      {series.map((s, si) => {
        const d = pathFor(s.points);
        if (!d) return null;
        return (
          <path
            key={si}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={si === 0 ? 2.5 : 2}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={s.dashed ? 0.6 : 1}
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: Create `components/trends/BarChart.tsx`**

```tsx
/**
 * Hand-rolled SVG bar chart (no dependency). Pure presentational Server
 * Component. Single series, or grouped (current vs previous) when `previous`
 * is provided. `null` values are gaps (no bar drawn).
 */

export function BarChart({
  current,
  previous,
  colorCurrent,
  colorPrevious = "var(--co-border-2)",
  height = 96,
  ariaLabel,
}: {
  current: (number | null)[];
  previous?: (number | null)[];
  colorCurrent: string;
  colorPrevious?: string;
  height?: number;
  ariaLabel: string;
}) {
  const width = 320;
  const padY = 8;
  const n = Math.max(1, current.length);

  const vals = [
    ...current.filter((v): v is number => v !== null),
    ...(previous ?? []).filter((v): v is number => v !== null),
  ];
  const max = vals.length ? Math.max(...vals, 1) : 1;
  const slot = width / n;
  const grouped = !!previous;
  const barW = grouped ? slot * 0.32 : slot * 0.6;

  const barH = (v: number) => Math.max(0, (v / max) * (height - 2 * padY));
  const yTop = (v: number) => height - padY - barH(v);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      <line x1={0} y1={height - padY} x2={width} y2={height - padY} stroke="var(--co-border)" strokeWidth={1} />
      {current.map((v, i) => {
        const cx = i * slot + slot / 2;
        const prevV = previous?.[i] ?? null;
        return (
          <g key={i}>
            {grouped && prevV !== null ? (
              <rect x={cx - barW - 1} y={yTop(prevV)} width={barW} height={barH(prevV)} fill={colorPrevious} rx={1.5} />
            ) : null}
            {v !== null ? (
              <rect
                x={grouped ? cx + 1 : cx - barW / 2}
                y={yTop(v)}
                width={barW}
                height={barH(v)}
                fill={colorCurrent}
                rx={1.5}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (components are server-rendered SVG, no client hooks → no Suspense constraint).

- [ ] **Step 4: Commit**

```bash
git add components/trends/LineChart.tsx components/trends/BarChart.tsx
git commit -m "feat(reports-trends): hand-rolled SVG LineChart + BarChart primitives

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `TrendCard` + `TrendControls`

**Files:**
- Create: `components/trends/TrendCard.tsx`
- Create: `components/trends/TrendControls.tsx`

Both are Server Components. `TrendCard` is the shell (headline + delta + chart + explainer + how-to-read callout); the page decides which chart to put inside. `TrendControls` renders Day/Week/Month + compare as `Link`s (no `useSearchParams` → no Suspense/prerender issue, mirroring `LocationSwitcher`).

- [ ] **Step 1: Create `components/trends/TrendCard.tsx`**

```tsx
import type { ReactNode } from "react";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

/**
 * One stacked trend card (layout A). Renders title, headline value, a
 * delta-vs-previous pill colored by whether the move is good or bad for this
 * family, the chart (passed as children), a plain-language explainer, and a
 * "how to read this" callout.
 */
export function TrendCard({
  titleKey,
  headline,
  delta,
  deltaGoodWhenNegative,
  explainKey,
  howToReadKey,
  language,
  children,
}: {
  titleKey: TranslationKey;
  headline: string;
  /** Already-formatted delta string (e.g., "▼ 5", "▲ 1", "—"); null hides the pill. */
  delta: { label: string; value: number } | null;
  /** For most families lower is better (under-par, temps); pass true. Completion → false. */
  deltaGoodWhenNegative: boolean;
  explainKey: TranslationKey;
  howToReadKey: TranslationKey;
  language: Language;
  children: ReactNode;
}) {
  // Determine good/bad tone from the delta direction + the family's polarity.
  let tone: "good" | "bad" | "flat" = "flat";
  if (delta && delta.value !== 0) {
    const improving = deltaGoodWhenNegative ? delta.value < 0 : delta.value > 0;
    tone = improving ? "good" : "bad";
  }
  const toneColor =
    tone === "good" ? "var(--co-success)" : tone === "bad" ? "var(--co-danger)" : "var(--co-text-dim)";

  return (
    <section className="rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text">
          {serverT(language, titleKey)}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-extrabold leading-none text-co-text">{headline}</span>
          {delta ? (
            <span className="text-xs font-bold" style={{ color: toneColor }}>
              {delta.label}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3">{children}</div>

      <p className="mt-3 text-xs leading-relaxed text-co-text-muted">{serverT(language, explainKey)}</p>

      <div className="mt-2 rounded-md border-l-[3px] border-co-gold bg-co-warning-surface px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-co-text-dim">
          {serverT(language, "reports.trends.how_to_read")}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-co-text">{serverT(language, howToReadKey)}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `components/trends/TrendControls.tsx`**

```tsx
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { TrendGranularity } from "@/lib/reports-trends";

/**
 * Day/Week/Month + compare controls. Server-rendered Links (no useSearchParams
 * → no Suspense/prerender constraint). Each control rebuilds the URL from the
 * known current state passed in as props.
 */
export function TrendControls({
  locationId,
  granularity,
  compare,
  language,
}: {
  locationId: string;
  granularity: TrendGranularity;
  compare: boolean;
  language: Language;
}) {
  const href = (g: TrendGranularity, c: boolean) =>
    `/reports/trends?location=${locationId}&g=${g}${c ? "&cmp=1" : ""}`;

  const grans: { g: TrendGranularity; key: TranslationKey }[] = [
    { g: "day", key: "reports.trends.gran_day" },
    { g: "week", key: "reports.trends.gran_week" },
    { g: "month", key: "reports.trends.gran_month" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1.5" role="group" aria-label={serverT(language, "reports.trends.gran_aria")}>
        {grans.map(({ g, key }) => {
          const on = g === granularity;
          return (
            <Link
              key={g}
              href={href(g, compare)}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={[
                "inline-flex min-h-[40px] items-center rounded-full px-4 py-1.5",
                "text-xs font-bold uppercase tracking-[0.1em] transition",
                on
                  ? "border-2 border-co-text bg-co-gold text-co-text"
                  : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text",
              ].join(" ")}
            >
              {serverT(language, key)}
            </Link>
          );
        })}
      </div>
      <Link
        href={href(granularity, !compare)}
        scroll={false}
        className={[
          "inline-flex min-h-[40px] items-center rounded-full px-4 py-1.5",
          "text-xs font-bold uppercase tracking-[0.1em] transition",
          compare
            ? "border-2 border-co-text bg-co-gold text-co-text"
            : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text",
        ].join(" ")}
      >
        {serverT(language, "reports.trends.compare_toggle")}
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY about the missing `reports.trends.*` translation keys (added in Task 6) — `TranslationKey` is a union of existing keys. If the project's `TranslationKey` is a literal union and these keys don't exist yet, this won't compile. **Add the keys first if needed:** do Task 6 before this typecheck, or accept the type error until Task 6. Note for the implementer: run Task 6 immediately after writing these two files, then typecheck both together.

- [ ] **Step 4: Commit (after Task 6 keys exist and tsc is clean)**

```bash
git add components/trends/TrendCard.tsx components/trends/TrendControls.tsx
git commit -m "feat(reports-trends): TrendCard shell + TrendControls (server-rendered)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: i18n keys (`reports.trends.*`) in en + es

**Files:**
- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/es.json`
- Smoke: `scripts/smoke-i18n-parity.ts` (throwaway)

> **Type note:** `TranslationKey` is derived from the JSON. Adding keys to both JSON files makes them valid for `serverT`. Add to BOTH files; keep parity.

- [ ] **Step 1: Add keys to `lib/i18n/en.json`**

Insert these entries inside the existing top-level object (the file is a flat map of `"dotted.key": "value"`; place them alongside the other `reports.*` keys). Use exactly these keys/values:

```json
  "reports.trends.title": "Trends",
  "reports.trends.nav_label": "View trends",
  "reports.trends.subtitle": "How the operation is moving over time",
  "reports.trends.how_to_read": "How to read this",
  "reports.trends.gran_aria": "Choose time grouping",
  "reports.trends.gran_day": "Day",
  "reports.trends.gran_week": "Week",
  "reports.trends.gran_month": "Month",
  "reports.trends.compare_toggle": "Compare to previous",
  "reports.trends.legend_current": "This period",
  "reports.trends.legend_previous": "Previous",
  "reports.trends.no_data": "No reports in this period yet.",
  "reports.trends.par_title": "Under / Over Par",
  "reports.trends.par_explain": "How many prep items came in below par (and above) across opening, AM prep, and mid-day, per {grouping}.",
  "reports.trends.par_how_to_read": "Lower is better. The red line is under-par items; a downward slope means you're hitting par more consistently than before.",
  "reports.trends.temps_title": "Fridge Temp Flags",
  "reports.trends.temps_explain": "Fridge readings above 41°F recorded on opening and closing checks, per {grouping}.",
  "reports.trends.temps_how_to_read": "Lower is better — each bar is how many fridge readings came in too warm. Zero bars is the goal.",
  "reports.trends.cash_title": "Cash Over / Short",
  "reports.trends.cash_explain": "How far the drawer landed from projected, per {grouping}. Managers only.",
  "reports.trends.cash_how_to_read": "Closer to $0 is better. Above the line is over, below is short — a line drifting away from zero means the drawer is getting less accurate.",
  "reports.trends.completion_title": "Checklist Completion",
  "reports.trends.completion_explain": "Share of required checklist items completed, per {grouping}.",
  "reports.trends.completion_how_to_read": "Higher is better. 100% means every required item got done; a line trending up means fewer skipped tasks.",
  "reports.trends.delta_up": "▲ {n}",
  "reports.trends.delta_down": "▼ {n}",
  "reports.trends.grouping_day": "day",
  "reports.trends.grouping_week": "week",
  "reports.trends.grouping_month": "month"
```

- [ ] **Step 2: Add the same keys to `lib/i18n/es.json`** (operational tú-form Spanish)

```json
  "reports.trends.title": "Tendencias",
  "reports.trends.nav_label": "Ver tendencias",
  "reports.trends.subtitle": "Cómo va la operación con el tiempo",
  "reports.trends.how_to_read": "Cómo leer esto",
  "reports.trends.gran_aria": "Elige el agrupamiento de tiempo",
  "reports.trends.gran_day": "Día",
  "reports.trends.gran_week": "Semana",
  "reports.trends.gran_month": "Mes",
  "reports.trends.compare_toggle": "Comparar con anterior",
  "reports.trends.legend_current": "Este período",
  "reports.trends.legend_previous": "Anterior",
  "reports.trends.no_data": "Aún no hay reportes en este período.",
  "reports.trends.par_title": "Bajo / Sobre Par",
  "reports.trends.par_explain": "Cuántos artículos de prep quedaron bajo par (y sobre) en apertura, prep AM y prep de medio día, por {grouping}.",
  "reports.trends.par_how_to_read": "Menos es mejor. La línea roja son los artículos bajo par; una pendiente hacia abajo significa que estás llegando a par con más consistencia.",
  "reports.trends.temps_title": "Alertas de Temperatura",
  "reports.trends.temps_explain": "Lecturas de refrigerador arriba de 41°F en los chequeos de apertura y cierre, por {grouping}.",
  "reports.trends.temps_how_to_read": "Menos es mejor — cada barra es cuántas lecturas salieron muy calientes. Cero barras es la meta.",
  "reports.trends.cash_title": "Efectivo Sobra / Falta",
  "reports.trends.cash_explain": "Qué tan lejos quedó la caja de lo proyectado, por {grouping}. Solo gerentes.",
  "reports.trends.cash_how_to_read": "Más cerca de $0 es mejor. Arriba de la línea sobra, abajo falta — una línea que se aleja del cero significa que la caja está menos exacta.",
  "reports.trends.completion_title": "Cumplimiento de Lista",
  "reports.trends.completion_explain": "Porcentaje de artículos requeridos completados, por {grouping}.",
  "reports.trends.completion_how_to_read": "Más es mejor. 100% significa que se hizo cada artículo requerido; una línea hacia arriba significa menos tareas saltadas.",
  "reports.trends.delta_up": "▲ {n}",
  "reports.trends.delta_down": "▼ {n}",
  "reports.trends.grouping_day": "día",
  "reports.trends.grouping_week": "semana",
  "reports.trends.grouping_month": "mes"
```

- [ ] **Step 3: Write the parity smoke**

Create `scripts/smoke-i18n-parity.ts`:

```ts
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const enKeys = Object.keys(en).sort();
const esKeys = Object.keys(es).sort();
const missingInEs = enKeys.filter((k) => !(k in es));
const missingInEn = esKeys.filter((k) => !(k in en));
if (missingInEs.length || missingInEn.length) {
  console.error("missing in es:", missingInEs);
  console.error("missing in en:", missingInEn);
  throw new Error("FAIL: i18n key parity broken");
}
const trendKeys = enKeys.filter((k) => k.startsWith("reports.trends."));
if (trendKeys.length < 25) throw new Error(`FAIL: expected >=25 reports.trends.* keys, got ${trendKeys.length}`);
console.log(`ok: ${enKeys.length} keys, parity holds, ${trendKeys.length} trend keys`);
console.log("ALL PASS");
```

- [ ] **Step 4: Run the parity smoke + typecheck the Task 5 components**

Run: `npx tsx --env-file=.env.local scripts/smoke-i18n-parity.ts`
Expected: `ALL PASS`.

Run: `npx tsc --noEmit`
Expected: no errors (Task 5 components now resolve their keys).

- [ ] **Step 5: Delete throwaway smoke and commit (Task 5 + 6 together)**

```bash
rm scripts/smoke-i18n-parity.ts
git add lib/i18n/en.json lib/i18n/es.json components/trends/TrendCard.tsx components/trends/TrendControls.tsx
git commit -m "feat(reports-trends): reports.trends.* i18n (en+es) + wire TrendCard/TrendControls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `/reports/trends` page (layout A) + "Trends" link on `/reports`

**Files:**
- Create: `app/(authed)/reports/trends/page.tsx`
- Modify: `app/(authed)/reports/page.tsx` (add Trends link)

- [ ] **Step 1: Create `app/(authed)/reports/trends/page.tsx`**

```tsx
/**
 * /reports/trends — operational-signal trend charts (layout A, stacked cards).
 *
 * Auth → location guard (lockLocationContext) → loadTrendSeries → controls +
 * one stacked TrendCard per visible family. Cash family rendered only when the
 * loader reports cashVisible (KH+). Chart type per family follows the spec
 * mapping: par = line (day) / grouped bars (week-month); temps = bars; cash =
 * line w/ zero baseline; completion = line.
 */

import { redirect } from "next/navigation";
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { formatCents } from "@/lib/i18n/format";
import { loadTrendSeries, type TrendGranularity, type TrendSeries } from "@/lib/reports-trends";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { LineChart } from "@/components/trends/LineChart";
import { BarChart } from "@/components/trends/BarChart";
import { TrendCard } from "@/components/trends/TrendCard";
import { TrendControls } from "@/components/trends/TrendControls";

interface PageProps {
  searchParams: Promise<{ location?: string; g?: string; cmp?: string }>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

function groupingWord(g: TrendGranularity): TranslationKey {
  return g === "week"
    ? "reports.trends.grouping_week"
    : g === "month"
      ? "reports.trends.grouping_month"
      : "reports.trends.grouping_day";
}

/** Build the delta pill from a FamilyTotal-style pair. */
function deltaPill(
  delta: number | null,
  language: Language,
): { label: string; value: number } | null {
  if (delta === null || delta === 0) return null;
  const n = Math.abs(delta);
  const label =
    delta < 0
      ? serverT(language, "reports.trends.delta_down", { n })
      : serverT(language, "reports.trends.delta_up", { n });
  return { label, value: delta };
}

export default async function TrendsPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports/trends");
  const { location: locationParam, g, cmp } = await searchParams;

  if (!locationParam) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const granularity = parseGranularity(g);
  const compare = cmp === "1";
  const today = operationalNow(new Date()).date;

  const sb = getServiceRoleClient();
  const series: TrendSeries = await loadTrendSeries(sb, {
    viewer: { userId: auth.user.id, level: auth.level },
    locationId: locationParam,
    granularity,
    compare,
    today,
  });

  const grouping = serverT(language, groupingWord(granularity));
  const legendCurrent = serverT(language, "reports.trends.legend_current");
  const legendPrevious = serverT(language, "reports.trends.legend_previous");

  // Helper series extractors
  const cur = series.current;
  const prev = series.previous;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="text-lg font-bold text-co-text">{serverT(language, "reports.trends.title")}</h1>
      <p className="mb-4 text-xs text-co-text-muted">{serverT(language, "reports.trends.subtitle")}</p>

      <TrendControls
        locationId={locationParam}
        granularity={granularity}
        compare={compare}
        language={language}
      />

      <div className="mt-5 flex flex-col gap-4">
        {/* PAR — line (day) / grouped bars (week, month) */}
        <TrendCard
          titleKey="reports.trends.par_title"
          headline={String(series.totals.par.current ?? 0)}
          delta={deltaPill(series.totals.par.delta, language)}
          deltaGoodWhenNegative
          explainKey="reports.trends.par_explain"
          howToReadKey="reports.trends.par_how_to_read"
          language={language}
        >
          {granularity === "day" ? (
            <LineChart
              ariaLabel={serverT(language, "reports.trends.par_title")}
              series={[
                { points: cur.map((b) => (b.hasData ? b.underPar : null)), color: "var(--co-danger)" },
                { points: cur.map((b) => (b.hasData ? b.overPar : null)), color: "var(--co-gold-deep)" },
                ...(prev
                  ? [{ points: prev.map((b) => (b.hasData ? b.underPar : null)), color: "var(--co-danger)", dashed: true }]
                  : []),
              ]}
            />
          ) : (
            <BarChart
              ariaLabel={serverT(language, "reports.trends.par_title")}
              current={cur.map((b) => (b.hasData ? b.underPar : null))}
              previous={prev ? prev.map((b) => (b.hasData ? b.underPar : null)) : undefined}
              colorCurrent="var(--co-danger)"
            />
          )}
          <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
        </TrendCard>

        {/* TEMPS — bars always */}
        <TrendCard
          titleKey="reports.trends.temps_title"
          headline={String(series.totals.temps.current ?? 0)}
          delta={deltaPill(series.totals.temps.delta, language)}
          deltaGoodWhenNegative
          explainKey="reports.trends.temps_explain"
          howToReadKey="reports.trends.temps_how_to_read"
          language={language}
        >
          <BarChart
            ariaLabel={serverT(language, "reports.trends.temps_title")}
            current={cur.map((b) => (b.hasData ? b.tempFlags : null))}
            previous={prev ? prev.map((b) => (b.hasData ? b.tempFlags : null)) : undefined}
            colorCurrent="var(--co-info)"
          />
          <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
        </TrendCard>

        {/* CASH — line w/ zero baseline (KH+ only) */}
        {series.cashVisible ? (
          <TrendCard
            titleKey="reports.trends.cash_title"
            headline={formatCents(series.totals.cash.current ?? 0, language)}
            delta={
              series.totals.cash.delta !== null
                ? { label: formatCents(series.totals.cash.delta, language), value: series.totals.cash.delta }
                : null
            }
            deltaGoodWhenNegative={false}
            explainKey="reports.trends.cash_explain"
            howToReadKey="reports.trends.cash_how_to_read"
            language={language}
          >
            <LineChart
              ariaLabel={serverT(language, "reports.trends.cash_title")}
              zeroBaseline
              series={[
                { points: cur.map((b) => b.cashOverShortCents), color: "var(--co-success)" },
                ...(prev
                  ? [{ points: prev.map((b) => b.cashOverShortCents), color: "var(--co-success)", dashed: true }]
                  : []),
              ]}
            />
            <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
          </TrendCard>
        ) : null}

        {/* COMPLETION — line */}
        <TrendCard
          titleKey="reports.trends.completion_title"
          headline={series.totals.completion.current !== null ? `${series.totals.completion.current}%` : "—"}
          delta={deltaPill(series.totals.completion.delta, language)}
          deltaGoodWhenNegative={false}
          explainKey="reports.trends.completion_explain"
          howToReadKey="reports.trends.completion_how_to_read"
          language={language}
        >
          <LineChart
            ariaLabel={serverT(language, "reports.trends.completion_title")}
            series={[
              { points: cur.map((b) => b.completionPct), color: "var(--co-success)" },
              ...(prev
                ? [{ points: prev.map((b) => b.completionPct), color: "var(--co-success)", dashed: true }]
                : []),
            ]}
          />
          <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
        </TrendCard>
      </div>
    </main>
  );
}

function ChartLegend({
  hasPrev,
  current,
  previous,
}: {
  hasPrev: boolean;
  current: string;
  previous: string;
}) {
  return (
    <div className="mt-1.5 flex gap-3 text-[10px] text-co-text-dim">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-0.5 w-3.5 bg-co-text-dim" aria-hidden /> {current}
      </span>
      {hasPrev ? (
        <span className="inline-flex items-center gap-1 opacity-60">
          <span className="inline-block h-0.5 w-3.5 bg-co-text-dim" aria-hidden /> {previous}
        </span>
      ) : null}
    </div>
  );
}
```

Note on the par grouping interpolation: the `{grouping}` param in `par_explain` etc. — pass it. Update each `explainKey` consumer? The `TrendCard` calls `serverT(language, explainKey)` WITHOUT params. To interpolate `{grouping}`, `TrendCard` must accept params. **Adjust `TrendCard`** to take an optional `explainParams` and pass through:

In `components/trends/TrendCard.tsx`, change the `explainKey` render line to accept params. Add a prop `explainParams?: Record<string, string | number>` and render `serverT(language, explainKey, explainParams)`. Then in the page pass `explainParams={{ grouping }}` on each `TrendCard`. Make this edit as part of this task.

- [ ] **Step 2: Update `TrendCard` to interpolate `{grouping}`**

In `components/trends/TrendCard.tsx`:
- Add to the props: `explainParams,` and type `explainParams?: Record<string, string | number>;`
- Change the explainer line to: `{serverT(language, explainKey, explainParams)}`

And in the page, add `explainParams={{ grouping }}` to each `<TrendCard>`.

- [ ] **Step 3: Add the "Trends" link to `app/(authed)/reports/page.tsx`**

After the `<h1>` title block (around line 116-118), insert a Trends link:

```tsx
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-co-text">
          {serverT(lang, "reports.page.title")}
        </h1>
        <Link
          href={`/reports/trends?location=${locationId}`}
          className="inline-flex min-h-[40px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted transition hover:border-co-text hover:text-co-text"
        >
          {serverT(lang, "reports.trends.nav_label")}
        </Link>
      </div>
```

Replace the existing standalone `<h1 className="mb-4 ...">{serverT(lang, "reports.page.title")}</h1>` with the block above. Add `import Link from "next/link";` to the page's imports if not present.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (page is a Server Component; `TrendControls` uses `Link`, not `useSearchParams`, so no Suspense constraint).

- [ ] **Step 5: Manual smoke note + commit**

Manual smoke (Juan, against the PR preview URL): open `/reports/trends?location=<id>`, toggle Day/Week/Month and Compare, confirm cash card shows only for KH+. (Document the preview URL in the PR, not production — per AGENTS.md.)

```bash
git add "app/(authed)/reports/trends/page.tsx" "app/(authed)/reports/page.tsx" components/trends/TrendCard.tsx
git commit -m "feat(reports-trends): /reports/trends page (stacked cards) + Trends link on hub

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Dashboard widget (layout B, 2×2 grid)

**Files:**
- Create: `components/trends/TrendsWidget.tsx`
- Modify: `app/(authed)/dashboard/page.tsx`

- [ ] **Step 1: Create `components/trends/TrendsWidget.tsx`**

```tsx
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import { formatCents } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import type { TrendSeries } from "@/lib/reports-trends";

import { LineChart } from "@/components/trends/LineChart";
import { BarChart } from "@/components/trends/BarChart";

/**
 * Dashboard trends widget — layout B (2×2 small-multiples grid). Compact
 * read over the same loadTrendSeries output (day / last-30 / no compare).
 * Cash mini-card omitted when !series.cashVisible. Links to the full page.
 */
export function TrendsWidget({
  series,
  locationId,
  language,
}: {
  series: TrendSeries;
  locationId: string;
  language: Language;
}) {
  const cur = series.current;

  return (
    <section aria-label={serverT(language, "reports.trends.title")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="inline-block self-start border-b-2 border-co-gold-deep pb-0.5 text-lg font-bold uppercase tracking-[0.14em] text-co-text">
          {serverT(language, "reports.trends.title")}
        </h3>
        <Link
          href={`/reports/trends?location=${locationId}`}
          className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted underline-offset-2 hover:text-co-text hover:underline"
        >
          {serverT(language, "reports.trends.nav_label")}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Mini title={serverT(language, "reports.trends.par_title")} value={String(series.totals.par.current ?? 0)}>
          <LineChart
            height={40}
            ariaLabel={serverT(language, "reports.trends.par_title")}
            series={[{ points: cur.map((b) => (b.hasData ? b.underPar : null)), color: "var(--co-danger)" }]}
          />
        </Mini>
        <Mini title={serverT(language, "reports.trends.temps_title")} value={String(series.totals.temps.current ?? 0)}>
          <BarChart
            height={40}
            ariaLabel={serverT(language, "reports.trends.temps_title")}
            current={cur.map((b) => (b.hasData ? b.tempFlags : null))}
            colorCurrent="var(--co-info)"
          />
        </Mini>
        {series.cashVisible ? (
          <Mini
            title={serverT(language, "reports.trends.cash_title")}
            value={formatCents(series.totals.cash.current ?? 0, language)}
          >
            <LineChart
              height={40}
              zeroBaseline
              ariaLabel={serverT(language, "reports.trends.cash_title")}
              series={[{ points: cur.map((b) => b.cashOverShortCents), color: "var(--co-success)" }]}
            />
          </Mini>
        ) : null}
        <Mini
          title={serverT(language, "reports.trends.completion_title")}
          value={series.totals.completion.current !== null ? `${series.totals.completion.current}%` : "—"}
        >
          <LineChart
            height={40}
            ariaLabel={serverT(language, "reports.trends.completion_title")}
            series={[{ points: cur.map((b) => b.completionPct), color: "var(--co-success)" }]}
          />
        </Mini>
      </div>
    </section>
  );
}

function Mini({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">{title}</p>
      <p className="text-lg font-extrabold leading-none text-co-text">{value}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the widget into `app/(authed)/dashboard/page.tsx`**

1. Add imports:

```ts
import { loadTrendSeries } from "@/lib/reports-trends";
import { TrendsWidget } from "@/components/trends/TrendsWidget";
import { operationalNow } from "@/lib/midshift";
```

2. After the `pmDashboard` load block (around line 386), load a compact series for the selected location:

```ts
  const trendsSeries =
    selectedLocation && operational
      ? await loadTrendSeries(sb, {
          viewer: { userId: auth.user.id, level: auth.level },
          locationId: selectedLocation.id,
          granularity: "day",
          compare: false,
          today: operationalNow(new Date()).date,
        })
      : null;
```

3. Render the widget after the `ReportsSection` block (after the closing `) : null}` of the reports section, before the Maintenance nav entry):

```tsx
        {selectedLocation && trendsSeries ? (
          <TrendsWidget series={trendsSeries} locationId={selectedLocation.id} language={language} />
        ) : null}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/trends/TrendsWidget.tsx "app/(authed)/dashboard/page.tsx"
git commit -m "feat(reports-trends): dashboard trends widget (2x2 grid)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 2: Comprehensive live-data smoke**

Create `scripts/smoke-trends-final.ts` (throwaway) — re-assert the loader invariants end-to-end on a real location across all three granularities + compare, plus the cash gate and IDOR (reuse the Task 3 assertions). Run:

`npx tsx --env-file=.env.local scripts/smoke-trends-final.ts`
Expected: `ALL PASS`. Then `rm scripts/smoke-trends-final.ts`.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin claude/reports-trends
gh pr create --title "Reports Hub: trend charts (par/temps/cash/completion) + dashboard widget" --body "$(cat <<'EOF'
## What
Operational-signal trend charts over Day/Week/Month with period-over-period comparison.

- New `lib/reports-trends.ts` (`loadTrendSeries`) — bulk-loads the window once, aggregates per bucket in memory (no per-date N+1).
- Shared par/temp derivation factored into `lib/report-signals.ts` (hub loader rewired to use it).
- Hand-rolled SVG `LineChart`/`BarChart` (no chart dependency).
- `/reports/trends` page (stacked cards) + "Trends" link on the hub.
- Dashboard trends widget (2×2 grid).
- Tier-matched to the hub: cash family KH+ only (omitted from loader output for <L4).
- IDOR two-halves (lockLocationContext + location_id bind on every query).
- Missing buckets render as gaps, not zeros.
- i18n `reports.trends.*` EN+ES.

## Chart mapping
Par = line (day) / grouped bars (week-month); Temps = bars; Cash = line w/ zero baseline (KH+); Completion = line.

## Deferred (follow-ups)
Report-detail tabbed trend view (C), free-text search, people/employee metrics, individual punctuality (Toast-blocked), all-locations roll-up.

## Test plan
- `tsc --noEmit` + `next build` clean.
- Live-row smokes: bucketing math, comparison deltas, cash gate hides series for <L4, cross-location IDOR returns empty, missing-day gap.
- Manual (preview URL): `/reports/trends?location=<id>` — toggle Day/Week/Month + Compare; confirm cash card only for KH+; check dashboard widget.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Report the preview URL to Juan for smoke** (branch-slug: `claude-reports-trends` → `co-ops-git-claude-reports-trends-juan-co-devs-projects.vercel.app`; confirm via the Vercel PR comment).

---

## Self-review

**Spec coverage:**
- Loader bulk-load (no N+1) → Task 3. ✓
- Day/Week/Month + compare → Tasks 2 (windows) + 7 (controls). ✓
- Aggregation semantics (sum counts, net cash, avg completion, missing=gap) → Task 3. ✓
- Chart-type mapping → Task 7. ✓
- Page A + Trends link → Task 7. ✓
- Dashboard widget B → Task 8. ✓
- Cash KH+ (omitted <L4) → Task 3 (`cashVisible`), surfaced in 7/8. ✓
- IDOR two-halves → page guard (7/8) + loader location_id binds (3). ✓
- Hand-rolled SVG → Task 4. ✓
- i18n EN+ES same PR → Task 6. ✓
- Verification on live rows → Tasks 3, 9. ✓
- Deferred items (C, search, people, punctuality, all-locations) → not built; listed in PR + spec. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**Type consistency:** `TrendGranularity`/`TrendFamily`/`TrendBucket`/`FamilyTotal`/`TrendSeries`/`Viewer` defined in Task 2/3 and used consistently in Tasks 7/8. `loadTrendSeries` signature (`{ viewer, locationId, granularity, compare, today }`) matches all call sites (page + dashboard + smokes). `derivePrepHave`/`parStatusFromHave`/`isOutOfRangeTemp` signatures match between Task 1 definition and Task 3 usage. `TrendCard` props (incl. the Step-2 `explainParams` addition) match the page usage. ✓

**Note on `TranslationKey`:** keys must exist in the JSON before the components/page typecheck cleanly — Task 6 is sequenced to run with Task 5 (and before Task 7's typecheck). Flagged inline.

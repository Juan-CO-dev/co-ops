# Catering Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the catering numbers true: purge the test data by migration, rebuild insights around the real lead sources with four windows and a calendar, keep today's Toast sales panel fresh via the desktop pinger, and give the mid-shift catering panel stage, source, due time and a tomorrow line.

**Architecture:** Two migrations (0193 purge with asserted counts + one audit row; 0194 `catering_insights_v2` RPC replacing the 0121 function) carry the data truth. Pure TS modules (`lib/catering/insights-shared.ts`, additions to `lib/catering/intake-shared.ts` and `lib/midshift-shared.ts`) carry every window/grid/label decision and are vitest-covered. The insights page becomes a server loader + one client component (window pills + month calendar). A new cron route reuses the existing Toast pull with a `pinger` context and the dedicated low-blast secret. The pulse loader gains stage/source/tomorrow on the existing lane.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (Postgres 17, service-role client, SECURITY DEFINER RPC), vitest, Tailwind v4 tokens (`co-*`), i18n en+es via `lib/i18n/{en,es}.json` (`serverT` on the server, `useTranslation()` from `lib/i18n/provider.tsx` on the client).

**Spec:** `docs/superpowers/specs/2026-09-05-catering-truth-design.md`. Rulings: Juan 2026-09-05 (purge physically; four windows + calendar; pinger yes; Stripe later).

**Ground truth (live 2026-09-05, do not re-derive):**
- `catering_pipeline_events` columns: `id, pipeline_id, from_stage, to_stage, note, actor_id, created_at` (no location_id); its CHECKs include `out` (0191 applied). Migration lineage is at **0192** (applied).
- `audit_log` columns: `id, occurred_at, actor_id, actor_role, action, resource_table!, resource_id, before_state, after_state, metadata, destructive`.
- Test customers: emails `juan@complimentsonlysubs.com`, `contactmgb202@gmail.com` (the only two `catering_customers` rows). Orphan staff quote id `b90fded5-fbd1-4f69-b03e-59c08f707dbb` (no pipeline, 1 line, $375). Counts: test leads 11 · their events 26 · quotes 11 (+1 orphan) · quote items 41 (+1) · payments 4 (all) · prep_demand 3 (all) · portal tokens 25 (all) · sessions 20 (all) · customers 2 (all). Real leads: 5 (`toast_catering` ×2, `ezcater` ×3), all `confirmed`, revenue on `estimated_revenue_cents`.
- Existing RPC `public.catering_insights(uuid[])` (0121): drop it. Loader `lib/catering/insights.ts` (`loadCateringInsights`, `INSIGHTS_READ_MIN = 5`, `isAllLocationsAccess` scope → `null` = all). Page `app/(authed)/catering/insights/page.tsx` (server component; `RevenueCard`, `FunnelBar` helpers; keys `catering.insights.*` in en.json ~line 3520).
- Pulse: `lib/midshift.ts` `loadCateringDueToday(service, {locationId, date})` (stage IN confirmed/out, sorts by `timeWindowMinutes`), `loadMidShiftPulse` Promise.all of five lanes; `lib/midshift-shared.ts` `CateringDueItem {id,timeWindow,name,headcount,isDelivery}` + `MidShiftPulse.cateringToday`; `components/midshift/CateringToday.tsx` (`items`, `language`; keys `midshift.catering.*` en.json ~1538, es.json ~1538); page `app/(authed)/mid-shift/page.tsx:229` renders `<CateringToday items={pulse.cateringToday} language={language} />`.
- Toast sales: `lib/catering/toast-sales.ts` — `pullSalesSystemTrigger(locationId, businessDate, { context: "closing_confirm" | "midshift_on_visit" })`, `maybeRefreshTodaySales(locationId, businessDate)` with `ON_VISIT_DEBOUNCE_MS = 45*60*1000` reading the latest `toast_sales.pull`/`pull_failed` audit row (`occurred_at`, `metadata.business_date`); `pullSalesForAllLocations(businessDate)`; nightly cron `app/api/cron/toast-sales-pull` (CRON_SECRET). Pinger pattern: `app/api/cron/toast-catering-scan/route.ts` (CATERING_SCAN_SECRET, `secretOk`, `jsonOk/jsonError`, `audit cron.success/cron.failure`, `etCalendarDate`, `etYmdMinusDays` from `lib/operational-day.ts`).
- Lead sources: `LEAD_SOURCES` in `lib/catering/intake-shared.ts` (`portal, staff, phone, walk_in, toast_catering, ezcater, direct_invoice, other`); i18n `catering.intake.source.<source>` exists for all eight. Stage keys `catering.pipeline.stage.<stage>` exist.
- Registries: `lib/destructive-actions.ts` `DESTRUCTIVE_ACTIONS = [ … ] as const` (line 38–350, alphabetical-ish groups); `lib/audit-actions.ts` `NON_DESTRUCTIVE_ACTIONS`, `RESERVED_ACTIONS`, `AUDIT_ACTIONS`. `AuditInput.action: AuditAction` — an unregistered name fails the build.
- Format helpers (pure, client-safe): `formatCents(cents, language)`, `formatDateLabel(yyyymmdd, language)`, `formatWeekday(yyyymmdd, language)` in `lib/i18n/format.ts`. Disclosure primitive: `components/ui/CollapsibleSection.tsx` (`title`, `count?`, `defaultOpen?`).
- Branch/PR law: code goes through a PR + CI (`build` check runs `npm test` + `next build`); Juan clicks merge; migrations applied via MCP after his word (0193 = his "confirm purge", given 2026-09-05). Smoke on the PR's preview URL, never prod.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/destructive-actions.ts` (modify) | register `catering.test_data_purge` |
| `supabase/migrations/0193_catering_test_purge.sql` (new) | asserted deletes + one audit row |
| `supabase/migrations/0194_catering_insights_v2.sql` (new) | `catering_insights_window` + `catering_insights_v2`; drop 0121's function; revokes |
| `lib/catering/insights-shared.ts` (new, pure) | window keys/labels, ET month grid, event grouping, stage dot class |
| `lib/catering/insights.ts` (rewrite) | loader for v2 (`loadCateringInsightsV2`) |
| `components/catering/InsightsClient.tsx` (new, client) | window pills + numbers + source/stage breakdown + calendar |
| `components/catering/InsightsCalendar.tsx` (new, client) | month grid, dots by stage, day drawer |
| `app/(authed)/catering/insights/page.tsx` (rewrite) | server shell: auth, load, render client |
| `lib/catering/intake-shared.ts` (modify) | `leadSourceLabelKey(source)` pure |
| `lib/catering/toast-sales.ts` (modify) | `pinger` context; `refreshTodaySalesIfStale(locationId, date, debounceMs, context)`; `pullTodaySalesForAllLocations(today)` |
| `app/api/cron/toast-sales-today/route.ts` (new) | pinger route (CATERING_SCAN_SECRET) |
| `lib/midshift-shared.ts` (modify) | `CateringDueItem` + `stage`, `source`; `CateringTomorrow`; `tomorrowSummary` pure |
| `lib/midshift.ts` (modify) | loader selects stage/lead_source; tomorrow lane |
| `components/midshift/CateringToday.tsx` (rewrite) | chips, source, tomorrow line |
| `lib/i18n/en.json`, `lib/i18n/es.json` (modify) | new keys |
| `tests/catering-insights-shared.test.ts`, `tests/midshift-catering-panel.test.ts` (new) | pure tests |
| `docs/…/AGENTS.md` (modify, Task 8) | one law line: test data purge by migration |

Branch: `git checkout -b catering-truth` from an up-to-date `main` (`git fetch && git reset --hard origin/main` first — squash-merge history). Commit per task.

---

### Task 1: Register the purge action and author migration 0193

**Files:**
- Modify: `lib/destructive-actions.ts` (inside `DESTRUCTIVE_ACTIONS`, near the other `catering.*` entries)
- Create: `supabase/migrations/0193_catering_test_purge.sql`
- Test: `tests/audit-registry.test.ts` (append, if a registry test exists; else the build's type check is the gate — `npm run typecheck`)

- [ ] **Step 1: Register the action.** In `lib/destructive-actions.ts`, add to `DESTRUCTIVE_ACTIONS` in alphabetical position among the `catering.*` group:

```ts
  // catering.test_data_purge = the ONE-TIME migration-only purge of builder test artifacts
  //   (0193, Juan's ruling 2026-09-05: "the law is for the people using it, not for us making
  //   it"). Emitted from SQL only — no TypeScript call site exists or may exist; listed here so
  //   the vocabulary stays closed and the row reads destructive=true in the admin hub.
  "catering.test_data_purge",
```

Run `npm run typecheck` (or `npx tsc --noEmit`) → passes (no call site changes).

- [ ] **Step 2: Author the migration** `supabase/migrations/0193_catering_test_purge.sql`:

```sql
-- Migration 0193_catering_test_purge
-- AUTHORED 2026-09-05. APPLY ON JUAN'S "confirm purge" (given 2026-09-05).
--
-- 0193: physically delete the builder's catering TEST artifacts. Juan's ruling (2026-09-05):
-- the append-only law protects operators' history; test rows made while building are not
-- history and "make the numbers a lie". This is a MIGRATION with a literal manifest — no app
-- code path deletes catering rows, and none is added. Every count is asserted before its
-- DELETE so a drifted prod refuses instead of guessing. One audit row records the ruling.
--
-- Manifest (live counts 2026-09-05): test customers 2 (the two builder emails) · portal test
-- leads 11 (all stage lost) · their events 26 · quotes 11 + orphan staff quote 1 · quote items
-- 42 · quote item options (all under those) · payments 4 (every row) · prep_demand 3 (every row)
-- · portal tokens 25 (every row) · portal sessions 20 (every row) · rate limits (transient).
-- Untouched: the 5 real leads (toast_catering ×2, ezcater ×3) and their 8 events,
-- toast_catering_orders, ezcater_events, audit_log, customer_feedback.

do $$
declare
  v_customers uuid[];
  v_leads     uuid[];
  v_quotes    uuid[];
  v_items     uuid[];
  n int;
  v_options int; v_rate int;
begin
  select coalesce(array_agg(id), '{}') into v_customers
    from public.catering_customers
   where lower(email) in ('juan@complimentsonlysubs.com', 'contactmgb202@gmail.com');
  assert cardinality(v_customers) = 2, format('expected 2 test customers, found %s', cardinality(v_customers));
  assert (select count(*) from public.catering_customers) = 2, 'expected the test customers to be the ONLY customers';

  select coalesce(array_agg(id), '{}') into v_leads
    from public.catering_pipeline
   where lead_source = 'portal' and customer_id = any (v_customers);
  assert cardinality(v_leads) = 11, format('expected 11 test leads, found %s', cardinality(v_leads));
  assert (select count(*) from public.catering_pipeline where id <> all (v_leads)) = 5, 'expected exactly 5 real leads to remain';
  assert (select count(*) from public.catering_pipeline where id <> all (v_leads) and lead_source not in ('toast_catering','ezcater')) = 0,
         'a remaining lead is neither toast nor ezcater — stop and look';

  select coalesce(array_agg(id), '{}') into v_quotes
    from public.catering_quotes
   where pipeline_id = any (v_leads) or id = 'b90fded5-fbd1-4f69-b03e-59c08f707dbb';
  assert cardinality(v_quotes) = 12, format('expected 12 quotes (11 test + orphan), found %s', cardinality(v_quotes));
  assert (select count(*) from public.catering_quotes) = 12, 'expected no other quotes to exist';

  select coalesce(array_agg(id), '{}') into v_items from public.catering_quote_items where quote_id = any (v_quotes);
  assert cardinality(v_items) = 42, format('expected 42 quote items, found %s', cardinality(v_items));

  -- children first
  delete from public.catering_prep_demand where pipeline_id = any (v_leads) or quote_id = any (v_quotes);
  get diagnostics n = row_count; assert n = 3, format('prep_demand: expected 3, deleted %s', n);
  assert (select count(*) from public.catering_prep_demand) = 0, 'prep_demand should be empty after the purge';

  delete from public.catering_quote_item_options where quote_item_id = any (v_items);
  get diagnostics v_options = row_count;

  delete from public.catering_quote_items where id = any (v_items);
  get diagnostics n = row_count; assert n = 42, format('quote_items: expected 42, deleted %s', n);

  delete from public.catering_payments;
  get diagnostics n = row_count; assert n = 4, format('payments: expected 4, deleted %s', n);

  delete from public.catering_quotes where id = any (v_quotes);
  get diagnostics n = row_count; assert n = 12, format('quotes: expected 12, deleted %s', n);

  delete from public.catering_pipeline_events where pipeline_id = any (v_leads);
  get diagnostics n = row_count; assert n = 26, format('pipeline_events: expected 26, deleted %s', n);

  delete from public.catering_pipeline where id = any (v_leads);
  get diagnostics n = row_count; assert n = 11, format('pipeline: expected 11, deleted %s', n);

  delete from public.catering_portal_sessions where customer_id = any (v_customers);
  get diagnostics n = row_count; assert n = 20, format('portal_sessions: expected 20, deleted %s', n);

  delete from public.catering_portal_tokens where lower(email) in ('juan@complimentsonlysubs.com', 'contactmgb202@gmail.com');
  get diagnostics n = row_count; assert n = 25, format('portal_tokens: expected 25, deleted %s', n);
  assert (select count(*) from public.catering_portal_tokens) = 0, 'portal_tokens should be empty after the purge';

  delete from public.catering_portal_rate_limits;
  get diagnostics v_rate = row_count;

  delete from public.catering_customers where id = any (v_customers);
  get diagnostics n = row_count; assert n = 2, format('customers: expected 2, deleted %s', n);

  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  values (null, null, 'catering.test_data_purge', 'catering_pipeline', null,
    jsonb_build_object(
      'actor_context', 'migration_apply', 'migration', '0193', 'ruling', 'Juan 2026-09-05: physically delete builder test catering data',
      'test_emails', jsonb_build_array('juan@complimentsonlysubs.com', 'contactmgb202@gmail.com'),
      'counts', jsonb_build_object('customers', 2, 'leads', 11, 'pipeline_events', 26, 'quotes', 12, 'quote_items', 42,
                                   'quote_item_options', v_options, 'payments', 4, 'prep_demand', 3,
                                   'portal_sessions', 20, 'portal_tokens', 25, 'rate_limits', v_rate),
      'ids', jsonb_build_object('customers', to_jsonb(v_customers), 'leads', to_jsonb(v_leads), 'quotes', to_jsonb(v_quotes)),
      'remaining_real_leads', 5),
    true);
end $$;
```

- [ ] **Step 3: Sanity-check the SQL parses locally** — `npx supabase db lint` is not available offline; instead run `node -e "require('fs').readFileSync('supabase/migrations/0193_catering_test_purge.sql','utf8')"` (exists) and eyeball the block. The real gate is the MCP apply in Task 8 (the `ASSERT`s protect prod).

- [ ] **Step 4: Commit** — `git add lib/destructive-actions.ts supabase/migrations/0193_catering_test_purge.sql && git commit -m "catering: register catering.test_data_purge; author 0193 test purge (asserted manifest, one audit row)"`

---

### Task 2: `lib/catering/insights-shared.ts` — pure window/calendar math

**Files:**
- Create: `lib/catering/insights-shared.ts`
- Test: `tests/catering-insights-shared.test.ts`

- [ ] **Step 1: Failing tests**

```ts
/**
 * Insights v2 pure core — window keys, ET month grid (Mon-start), event grouping, stage dots.
 */
import { describe, it, expect } from "vitest";
import {
  INSIGHT_WINDOWS, monthGrid, groupEventsByDate, stageDot, shiftMonth, monthKey, type CalendarEvent,
} from "@/lib/catering/insights-shared";

const ev = (date: string, stage: CalendarEvent["stage"], id = date + stage): CalendarEvent =>
  ({ id, eventDate: date, timeWindow: null, name: "x", headcount: 10, source: "ezcater", stage, locationId: "L", valueCents: 100 });

describe("insights-shared", () => {
  it("has exactly the four ruled windows in order", () => {
    expect(INSIGHT_WINDOWS.map((w) => w.key)).toEqual(["this_week", "this_month", "last_30", "all_time"]);
  });
  it("monthGrid is Monday-start, 6 rows max, with leading/trailing days flagged outside", () => {
    const g = monthGrid("2026-09");           // Sep 2026 starts on a Tuesday
    expect(g.weeks.length).toBeGreaterThanOrEqual(5);
    expect(g.weeks[0]![0]!.date).toBe("2026-08-31");
    expect(g.weeks[0]![0]!.inMonth).toBe(false);
    expect(g.weeks[0]![1]!.date).toBe("2026-09-01");
    expect(g.weeks[0]![1]!.inMonth).toBe(true);
    const last = g.weeks[g.weeks.length - 1]!;
    expect(last.length).toBe(7);
    expect(g.weeks.flat().filter((d) => d.inMonth).length).toBe(30);
  });
  it("monthKey and shiftMonth walk the calendar without Date math surprises", () => {
    expect(monthKey("2026-09-05")).toBe("2026-09");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("groups events by date, chronologically within a day, unparseable windows last", () => {
    const g = groupEventsByDate([
      { ...ev("2026-09-08", "confirmed", "a"), timeWindow: "1:00–1:30 PM" },
      { ...ev("2026-09-08", "confirmed", "b"), timeWindow: "10:00–10:30 AM" },
      { ...ev("2026-09-08", "out", "c"), timeWindow: null },
      ev("2026-09-11", "completed"),
    ]);
    expect([...g.keys()]).toEqual(["2026-09-08", "2026-09-11"]);
    expect(g.get("2026-09-08")!.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });
  it("stage dots use the token roles, never raw status colours as text", () => {
    expect(stageDot("confirmed")).toBe("bg-co-gold");
    expect(stageDot("out")).toBe("bg-co-text");
    expect(stageDot("completed")).toBe("bg-co-success");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/catering-insights-shared.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `lib/catering/insights-shared.ts`:

```ts
/**
 * Catering insights v2 — the PURE half (client-safe, zero I/O).
 *
 * Windows are Juan's ruling (2026-09-05): this week · this month · last 30 days · all time.
 * Money is counted by EVENT date (when the catering happens); lead flow by CREATED date
 * (when it arrives) — the RPC (0194) does that split; this module only names the windows,
 * builds the ET month grid the calendar renders, and groups the RPC's event list per day.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import { timeWindowMinutes } from "@/lib/midshift-shared";

export type WindowKey = "this_week" | "this_month" | "last_30" | "all_time";

export const INSIGHT_WINDOWS: ReadonlyArray<{ key: WindowKey; labelKey: TranslationKey }> = [
  { key: "this_week", labelKey: "catering.insights.window.this_week" as TranslationKey },
  { key: "this_month", labelKey: "catering.insights.window.this_month" as TranslationKey },
  { key: "last_30", labelKey: "catering.insights.window.last_30" as TranslationKey },
  { key: "all_time", labelKey: "catering.insights.window.all_time" as TranslationKey },
];

export type BookedStage = "confirmed" | "out" | "completed";

export interface CalendarEvent {
  id: string;
  eventDate: string;          // YYYY-MM-DD (ET calendar date, as stored)
  timeWindow: string | null;
  name: string;
  headcount: number | null;
  source: string | null;
  stage: BookedStage;
  locationId: string;
  valueCents: number;
}

export interface WindowStats {
  leadsNew: number;
  bySource: Record<string, number>;
  byStage: Record<string, number>;
  bookedEvents: number;
  bookedValueCents: number;
  lost: number;
  winRateBps: number | null;
  avgHeadcount: number | null;
  pipelineOpenValueCents: number;
}

export interface GridDay { date: string; inMonth: boolean; }
export interface MonthGrid { month: string; weeks: GridDay[][]; }

/** "YYYY-MM" of a "YYYY-MM-DD". */
export function monthKey(ymd: string): string { return ymd.slice(0, 7); }

/** Add n months to a "YYYY-MM" key with plain integer arithmetic (no Date, no TZ). */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12); const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

function ymd(y: number, m0: number, d: number): string {
  // UTC-anchored so no local TZ can shift a calendar day; only ever used for date arithmetic here.
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}

/** Monday-start month grid of full weeks covering the month; days outside are flagged. */
export function monthGrid(month: string): MonthGrid {
  const y = Number(month.slice(0, 4)); const m0 = Number(month.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(y, m0, 1));
  const daysInMonth = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;           // Mon=0 … Sun=6
  const weeks: GridDay[][] = [];
  let day = 1 - lead;
  while (day <= daysInMonth) {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++, day++) week.push({ date: ymd(y, m0, day), inMonth: day >= 1 && day <= daysInMonth });
    weeks.push(week);
  }
  return { month, weeks };
}

/** Events keyed by date (insertion order = ascending date), chronological within a day. */
export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const sorted = [...events].sort((a, b) =>
    a.eventDate.localeCompare(b.eventDate) ||
    timeWindowMinutes(a.timeWindow) - timeWindowMinutes(b.timeWindow) ||
    (a.timeWindow ?? "").localeCompare(b.timeWindow ?? ""));
  const out = new Map<string, CalendarEvent[]>();
  for (const e of sorted) (out.get(e.eventDate) ?? out.set(e.eventDate, []).get(e.eventDate)!).push(e);
  return out;
}

/** Dot fill per stage — FILL roles only (co-success is a fill/dot role, never text). */
export function stageDot(stage: BookedStage): string {
  return stage === "confirmed" ? "bg-co-gold" : stage === "out" ? "bg-co-text" : "bg-co-success";
}
```

- [ ] **Step 4: Run** → 5 passed. **Step 5: Commit** — `git add lib/catering/insights-shared.ts tests/catering-insights-shared.test.ts && git commit -m "catering: insights-shared — windows, ET month grid, event grouping, stage dots (pure)"`

---

### Task 3: Migration 0194 — `catering_insights_window` + `catering_insights_v2`

**Files:**
- Create: `supabase/migrations/0194_catering_insights_v2.sql`

- [ ] **Step 1: Author**

```sql
-- Migration 0194_catering_insights_v2
-- AUTHORED 2026-09-05. APPLY WITH 0193 (Juan's go on the catering-truth spec).
--
-- 0194: insights v2. The 0121 function counted every lead all-time, counted `lost` test rows
-- as pipeline, and read revenue from catering_orders (never written) + accepted quotes (none) —
-- it showed $0 against ≈$2,800 of confirmed Toast/ezCater catering. v2: four windows (Juan
-- 2026-09-05: this week · this month · last 30 · all time), MONEY BY EVENT DATE, LEAD FLOW BY
-- CREATED DATE (ET), one value per lead = its live accepted quote total else its
-- estimated_revenue_cents (the Toast/ezCater actual), a calendar of booked events −30…+90 days.
-- SECURITY DEFINER + REVOKE from anon, PUBLIC AND authenticated (0189 lesson: the staff JWT is
-- a valid PostgREST bearer; the lib enforces the level-5 floor).

create or replace function public.catering_insights_window(p_location_ids uuid[], p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with leads as (
    select p.id, p.stage, p.lead_source, p.headcount, p.event_date,
           (p.created_at at time zone 'America/New_York')::date as created_et,
           coalesce(q.total_cents, p.estimated_revenue_cents, 0)::bigint as value_cents
      from public.catering_pipeline p
      left join lateral (
        select total_cents from public.catering_quotes q
         where q.pipeline_id = p.id and q.superseded_at is null and q.status = 'accepted'
         order by q.version desc limit 1) q on true
     where (p_location_ids is null or p.location_id = any (p_location_ids))
  ),
  created   as (select * from leads where p_from is null or created_et between p_from and p_to),
  happening as (select * from leads where event_date is not null and (p_from is null or event_date between p_from and p_to)),
  booked    as (select * from happening where stage in ('confirmed','out','completed')),
  settled   as (select * from created where stage in ('confirmed','out','completed','lost'))
  select jsonb_build_object(
    'leads_new',   (select count(*)::int from created),
    'by_source',   coalesce((select jsonb_object_agg(coalesce(lead_source, 'unknown'), c)
                             from (select lead_source, count(*)::int c from created group by lead_source) s), '{}'::jsonb),
    'by_stage',    coalesce((select jsonb_object_agg(stage, c)
                             from (select stage, count(*)::int c from happening group by stage) s), '{}'::jsonb),
    'booked_events',      (select count(*)::int from booked),
    'booked_value_cents', (select coalesce(sum(value_cents), 0)::bigint from booked),
    'lost',               (select count(*)::int from created where stage = 'lost'),
    'win_rate_bps',       (select case when count(*) = 0 then null
                                       else round(10000.0 * count(*) filter (where stage <> 'lost') / count(*))::int end
                             from settled),
    'avg_headcount',      (select round(avg(headcount))::int from booked where headcount is not null),
    'pipeline_open_value_cents', (select coalesce(sum(value_cents), 0)::bigint from leads where stage in ('inquiry','quote_sent'))
  );
$$;

create or replace function public.catering_insights_v2(p_location_ids uuid[], p_today date)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'this_week',  public.catering_insights_window(p_location_ids, date_trunc('week', p_today::timestamp)::date, date_trunc('week', p_today::timestamp)::date + 6),
    'this_month', public.catering_insights_window(p_location_ids, date_trunc('month', p_today::timestamp)::date, (date_trunc('month', p_today::timestamp) + interval '1 month - 1 day')::date),
    'last_30',    public.catering_insights_window(p_location_ids, p_today - 29, p_today),
    'all_time',   public.catering_insights_window(p_location_ids, null, null),
    'calendar', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'event_date', e.event_date, 'time_window', e.time_window,
               'name', coalesce(e.event_name, e.company, e.contact_name), 'headcount', e.headcount,
               'source', e.lead_source, 'stage', e.stage, 'location_id', e.location_id, 'value_cents', e.value_cents)
             order by e.event_date, e.time_window)
        from (
          select p.*, coalesce((select total_cents from public.catering_quotes q
                                 where q.pipeline_id = p.id and q.superseded_at is null and q.status = 'accepted'
                                 order by q.version desc limit 1), p.estimated_revenue_cents, 0)::bigint as value_cents
            from public.catering_pipeline p
           where p.stage in ('confirmed','out','completed')
             and p.event_date between p_today - 30 and p_today + 90
             and (p_location_ids is null or p.location_id = any (p_location_ids))) e), '[]'::jsonb),
    'feedback', jsonb_build_object(
      'average_rating', (select round(avg(rating)::numeric, 2) from public.customer_feedback
                          where catering_order_id is not null and rating is not null
                            and (p_location_ids is null or location_id = any (p_location_ids))),
      'count', (select count(*)::int from public.customer_feedback
                 where catering_order_id is not null and (p_location_ids is null or location_id = any (p_location_ids))))
  );
$$;

revoke execute on function public.catering_insights_window(uuid[], date, date) from anon, public, authenticated;
revoke execute on function public.catering_insights_v2(uuid[], date)           from anon, public, authenticated;

drop function if exists public.catering_insights(uuid[]);
```

(`date_trunc('week', …)` is ISO Monday-start in Postgres. `count(*) filter (where …)` is standard.)

- [ ] **Step 2: Commit** — `git add supabase/migrations/0194_catering_insights_v2.sql && git commit -m "catering: 0194 catering_insights_v2 — four windows, money by event date, calendar, revokes; drop 0121 fn"`

---

### Task 4: Loader v2 + page + client components + i18n

**Files:**
- Rewrite: `lib/catering/insights.ts`
- Create: `components/catering/InsightsClient.tsx`, `components/catering/InsightsCalendar.tsx`
- Rewrite: `app/(authed)/catering/insights/page.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`
- Modify: `lib/catering/intake-shared.ts` (add `leadSourceLabelKey`)
- Test: `tests/catering-intake-shared.test.ts` (append)

- [ ] **Step 1: Failing test for the source label key** — append to `tests/catering-intake-shared.test.ts`:

```ts
import { leadSourceLabelKey } from "@/lib/catering/intake-shared";
describe("leadSourceLabelKey", () => {
  it("maps registry sources to their i18n key and leaves legacy free text verbatim", () => {
    expect(leadSourceLabelKey("ezcater")).toEqual({ key: "catering.intake.source.ezcater" });
    expect(leadSourceLabelKey("Referral from Cris")).toEqual({ verbatim: "Referral from Cris" });
    expect(leadSourceLabelKey(null)).toEqual({ key: "catering.intake.source.other" });
  });
});
```

Implement in `lib/catering/intake-shared.ts`:

```ts
/** i18n key for a registry source; legacy free-text sources render verbatim (never translated). */
export function leadSourceLabelKey(source: string | null): { key: TranslationKey } | { verbatim: string } {
  if (source == null || source === "") return { key: "catering.intake.source.other" as TranslationKey };
  return (LEAD_SOURCES as readonly string[]).includes(source)
    ? { key: `catering.intake.source.${source}` as TranslationKey }
    : { verbatim: source };
}
```
(import `TranslationKey` type from `@/lib/i18n/types` if not already imported.)

- [ ] **Step 2: Rewrite `lib/catering/insights.ts`** (keep `INSIGHTS_READ_MIN`, `FeedbackItem`, the bounded feedback list):

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import type { CalendarEvent, WindowKey, WindowStats } from "@/lib/catering/insights-shared";

export const INSIGHTS_READ_MIN = 5;

export interface FeedbackItem { id: string; rating: number | null; category: string | null; comment: string | null; submittedAt: string | null; followUpNeeded: boolean; }

export interface CateringInsightsV2 {
  today: string;                                  // ET calendar date the windows were cut on
  windows: Record<WindowKey, WindowStats>;
  calendar: CalendarEvent[];
  averageRating: number | null;
  feedbackCount: number;
  recentFeedback: FeedbackItem[];
}

interface RawWindow { leads_new?: number; by_source?: Record<string, number>; by_stage?: Record<string, number>; booked_events?: number;
  booked_value_cents?: number | string; lost?: number; win_rate_bps?: number | null; avg_headcount?: number | null; pipeline_open_value_cents?: number | string; }
interface RawV2 { this_week?: RawWindow; this_month?: RawWindow; last_30?: RawWindow; all_time?: RawWindow;
  calendar?: Array<{ id: string; event_date: string; time_window: string | null; name: string; headcount: number | null; source: string | null; stage: CalendarEvent["stage"]; location_id: string; value_cents: number | string }>;
  feedback?: { average_rating?: number | null; count?: number }; }

function win(r: RawWindow | undefined): WindowStats {
  return { leadsNew: r?.leads_new ?? 0, bySource: r?.by_source ?? {}, byStage: r?.by_stage ?? {}, bookedEvents: r?.booked_events ?? 0,
    bookedValueCents: Number(r?.booked_value_cents ?? 0), lost: r?.lost ?? 0, winRateBps: r?.win_rate_bps ?? null,
    avgHeadcount: r?.avg_headcount ?? null, pipelineOpenValueCents: Number(r?.pipeline_open_value_cents ?? 0) };
}

/** `todayEt` = the ET calendar date (caller passes etCalendarDate(new Date().toISOString())). */
export async function loadCateringInsightsV2(actor: AuthContext, todayEt: string): Promise<CateringInsightsV2> {
  if (getRoleLevel(actor.user.role) < INSIGHTS_READ_MIN) throw new Error("loadCateringInsightsV2: insufficient role level");
  const sb = getServiceRoleClient();
  const scope = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations }) ? null : actor.locations;
  const { data, error } = await sb.rpc("catering_insights_v2", { p_location_ids: scope, p_today: todayEt });
  if (error) throw new Error(`loadCateringInsightsV2 rpc: ${error.message}`);
  const raw = (data ?? {}) as RawV2;

  let fq = sb.from("customer_feedback").select("id, rating, category, comment, submitted_at, follow_up_needed").not("catering_order_id", "is", null);
  if (scope) fq = fq.in("location_id", scope);
  const { data: fbRows, error: fErr } = await fq.order("submitted_at", { ascending: false, nullsFirst: false }).limit(20)
    .returns<Array<{ id: string; rating: number | null; category: string | null; comment: string | null; submitted_at: string | null; follow_up_needed: boolean | null }>>();
  if (fErr) throw new Error(`loadCateringInsightsV2 feedback: ${fErr.message}`);

  return {
    today: todayEt,
    windows: { this_week: win(raw.this_week), this_month: win(raw.this_month), last_30: win(raw.last_30), all_time: win(raw.all_time) },
    calendar: (raw.calendar ?? []).map((e) => ({ id: e.id, eventDate: e.event_date, timeWindow: e.time_window, name: e.name, headcount: e.headcount,
      source: e.source, stage: e.stage, locationId: e.location_id, valueCents: Number(e.value_cents ?? 0) })),
    averageRating: raw.feedback?.average_rating ?? null,
    feedbackCount: raw.feedback?.count ?? 0,
    recentFeedback: (fbRows ?? []).map((r) => ({ id: r.id, rating: r.rating, category: r.category, comment: r.comment, submittedAt: r.submitted_at, followUpNeeded: r.follow_up_needed ?? false })),
  };
}
```

- [ ] **Step 3: i18n keys** — add to `lib/i18n/en.json` beside the existing `catering.insights.*` block (and the Spanish twins in `es.json`, operational tú-form):

```
"catering.insights.subtitle": "Leads, booked catering and feedback — by week, month, 30 days or all time.",
"catering.insights.window.this_week": "This week",
"catering.insights.window.this_month": "This month",
"catering.insights.window.last_30": "Last 30 days",
"catering.insights.window.all_time": "All time",
"catering.insights.stat.leads_new": "New leads",
"catering.insights.stat.booked_events": "Booked events",
"catering.insights.stat.booked_value": "Booked value",
"catering.insights.stat.win_rate": "Win rate",
"catering.insights.stat.lost": "Lost",
"catering.insights.stat.avg_headcount": "Avg. headcount",
"catering.insights.stat.open_pipeline": "Open pipeline",
"catering.insights.stat.no_settled": "No settled leads yet",
"catering.insights.by_source": "Leads by source",
"catering.insights.by_stage": "Events by stage",
"catering.insights.calendar": "Booked catering calendar",
"catering.insights.calendar.hint": "Dots mark booked events. Tap a day to see them.",
"catering.insights.calendar.prev": "Previous month",
"catering.insights.calendar.next": "Next month",
"catering.insights.calendar.empty_day": "No booked catering this day.",
"catering.insights.calendar.legend.confirmed": "Confirmed",
"catering.insights.calendar.legend.out": "Out for delivery/pickup",
"catering.insights.calendar.legend.completed": "Completed",
"catering.insights.money_note": "Money counts by event date; leads count by the day they arrived.",
```
Spanish (es.json): "Leads, catering confirmado y comentarios — por semana, mes, 30 días o histórico." · "Esta semana" · "Este mes" · "Últimos 30 días" · "Histórico" · "Leads nuevos" · "Eventos confirmados" · "Valor confirmado" · "Tasa de cierre" · "Perdidos" · "Comensales promedio" · "Pipeline abierto" · "Aún no hay leads cerrados" · "Leads por origen" · "Eventos por etapa" · "Calendario de catering confirmado" · "Los puntos marcan eventos confirmados. Toca un día para verlos." · "Mes anterior" · "Mes siguiente" · "No hay catering confirmado este día." · "Confirmado" · "En camino/entrega" · "Completado" · "El dinero cuenta por fecha del evento; los leads por el día en que llegaron.". Remove the three obsolete keys `catering.insights.revenue.open/won/orders` and `catering.insights.quote_funnel` / `catering.insights.pipeline_funnel` from BOTH files (grep for other users first; the page was their only consumer).

- [ ] **Step 4: `components/catering/InsightsCalendar.tsx`** (client):

```tsx
"use client";
import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatWeekday } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { groupEventsByDate, monthGrid, monthKey, shiftMonth, stageDot, type CalendarEvent } from "@/lib/catering/insights-shared";
import { leadSourceLabelKey } from "@/lib/catering/intake-shared";

export function InsightsCalendar({ events, today }: { events: CalendarEvent[]; today: string }) {
  const { t, language } = useTranslation();
  const [month, setMonth] = useState(monthKey(today));
  const [selected, setSelected] = useState<string | null>(today);
  const grid = useMemo(() => monthGrid(month), [month]);
  const byDate = useMemo(() => groupEventsByDate(events), [events]);
  const dayEvents = selected ? byDate.get(selected) ?? [] : [];
  const weekdays = grid.weeks[0]!.map((d) => formatWeekday(d.date, language).slice(0, 3));
  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("catering.insights.calendar.prev")}
          className="min-h-[44px] min-w-[44px] rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-co-text">‹</button>
        <span className="text-sm font-bold text-co-text">{formatDateLabel(`${month}-01`, language).replace(/\s*1,?\s*/, " ")}</span>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("catering.insights.calendar.next")}
          className="min-h-[44px] min-w-[44px] rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-co-text">›</button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {weekdays.map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.weeks.flat().map((d) => {
          const evs = byDate.get(d.date) ?? [];
          const isSel = d.date === selected;
          return (
            <button key={d.date} type="button" onClick={() => setSelected(d.date)}
              aria-pressed={isSel}
              className={`flex min-h-[44px] flex-col items-center justify-start rounded-lg border-2 p-1 text-xs tabular-nums
                ${isSel ? "border-co-text bg-co-surface-2" : "border-co-border bg-co-surface"} ${d.inMonth ? "text-co-text" : "text-co-text-faint"}
                ${d.date === today ? "font-extrabold" : ""}`}>
              <span>{Number(d.date.slice(8, 10))}</span>
              {evs.length > 0 && (
                <span className="mt-0.5 flex gap-0.5">
                  {evs.slice(0, 3).map((e) => <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${stageDot(e.stage)}`} />)}
                  {evs.length > 3 && <span className="text-[9px] text-co-text-dim">+{evs.length - 3}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-col gap-2" aria-live="polite">
        {selected && dayEvents.length === 0 && <li className="text-sm text-co-text-muted">{t("catering.insights.calendar.empty_day")}</li>}
        {dayEvents.map((e) => {
          const src = leadSourceLabelKey(e.source);
          return (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2">
              <span className={`h-2 w-2 rounded-full ${stageDot(e.stage)}`} aria-hidden />
              <span className="text-sm font-extrabold text-co-text">{e.timeWindow ?? t("midshift.catering.no_time")}</span>
              <span className="text-sm font-semibold text-co-text">{e.name}</span>
              {e.headcount != null && <span className="text-xs text-co-text-muted">{t("midshift.catering.covers_other", { count: e.headcount })}</span>}
              <span className="text-xs text-co-text-dim">{"key" in src ? t(src.key) : src.verbatim}</span>
              <span className="ml-auto text-sm font-bold tabular-nums text-co-text">{formatCents(e.valueCents, language)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```
(Check `useTranslation()`'s actual return shape in `lib/i18n/provider.tsx` before writing — it exposes `t` and the current language; adapt the destructure to the real names. `formatWeekday` returns a full weekday name; slicing to 3 is the header abbreviation.)

- [ ] **Step 5: `components/catering/InsightsClient.tsx`** (client): props `{ data: CateringInsightsV2 }`. State `window: WindowKey` default `"this_month"`. Renders: four pills (`min-h-[44px]`, selected = `bg-co-text text-co-cta`… no — selected = ink fill `bg-co-text` with `text-co-bg`; unselected = `border-co-border-2 bg-co-surface text-co-text`); a stat grid (2 cols mobile / 4 desktop) of `StatCard`s: leads_new, booked_events, booked_value (formatCents), win_rate (`${(bps/100).toFixed(0)}%` or `t("catering.insights.stat.no_settled")` when null), lost, avg_headcount (`—` when null), open_pipeline (formatCents); the money note in `text-xs text-co-text-dim`; then two `CollapsibleSection`s (`by_source`: rows label→count sorted desc using `leadSourceLabelKey`; `by_stage`: `PIPELINE_STAGES` order with `catering.pipeline.stage.*` labels, using the FunnelBar look — copy the bar markup from the old page into this file as a small component); then a `CollapsibleSection` `calendar` (`defaultOpen`) containing a legend row (three dots with the legend keys) and `<InsightsCalendar events={data.calendar} today={data.today} />`; then the feedback block moved verbatim from the old page (`recentFeedback`, `averageRating`, `feedbackCount`) — client-side `t()` instead of `serverT`.

- [ ] **Step 6: Page** `app/(authed)/catering/insights/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { etCalendarDate } from "@/lib/operational-day";
import { loadCateringInsightsV2, INSIGHTS_READ_MIN } from "@/lib/catering/insights";
import { InsightsClient } from "@/components/catering/InsightsClient";
import { BackLink } from "@/components/nav/BackLink";

export default async function CateringInsightsPage() {
  const auth = await requireSessionFromHeaders("/catering/insights");
  if (getRoleLevel(auth.user.role) < INSIGHTS_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;
  const today = etCalendarDate(new Date().toISOString());
  const data = await loadCateringInsightsV2(auth, today);
  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink />
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "catering.insights.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.insights.subtitle")}</p>
      <InsightsClient data={data} />
    </main>
  );
}
```

- [ ] **Step 7: Verify** — `npm test` green; `npm run typecheck`; `npx next build` (the `useSearchParams` class of build-only errors — none expected). Grep for other consumers of the removed i18n keys/`loadCateringInsights` (`grep -rn "loadCateringInsights\b\|catering.insights.revenue" app lib components tests`) → none besides the rewritten page.

- [ ] **Step 8: Commit** — `git add -A lib/catering components/catering "app/(authed)/catering/insights" lib/i18n tests/catering-intake-shared.test.ts && git commit -m "catering: insights v2 — loader, window pills, source/stage breakdown, booked calendar; en+es"`

---

### Task 5: Same-day sales pinger

**Files:**
- Modify: `lib/catering/toast-sales.ts`
- Create: `app/api/cron/toast-sales-today/route.ts`

- [ ] **Step 1: Widen the trigger context and add the shared stale-check** in `lib/catering/toast-sales.ts`:

```ts
export type SystemPullContext = "closing_confirm" | "midshift_on_visit" | "pinger";
// pullSalesSystemTrigger(locationId, businessDate, opts: { context: SystemPullContext })  ← change the opts type

export const PINGER_DEBOUNCE_MS = 8 * 60 * 1000;

/** Pull today's events for one location unless a pull attempt for (location, date) is younger
 *  than debounceMs. Events-only (the nightly cron is the sole ledger materializer). */
export async function refreshTodaySalesIfStale(locationId: string, businessDate: string, debounceMs: number, context: SystemPullContext): Promise<"pulled" | "fresh" | "no_toast"> {
  // move the body of maybeRefreshTodaySales here, parameterised; return "fresh" when debounced,
  // "no_toast" when the location has no toast_restaurant_guid, "pulled" after pullSalesSystemTrigger
}

/** maybeRefreshTodaySales keeps its signature and becomes: */
export async function maybeRefreshTodaySales(locationId: string, businessDate: string): Promise<void> {
  await refreshTodaySalesIfStale(locationId, businessDate, ON_VISIT_DEBOUNCE_MS, "midshift_on_visit");
}

/** All Toast-configured active locations, today, events-only, pinger-debounced. */
export async function pullTodaySalesForAllLocations(todayEt: string): Promise<Array<{ locationId: string; result: "pulled" | "fresh" | "no_toast" | "error"; error?: string }>> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id").eq("active", true).not("toast_restaurant_guid", "is", null).returns<Array<{ id: string }>>();
  if (error) throw new Error(`pullTodaySalesForAllLocations locations: ${error.message}`);
  const out = [];
  for (const l of data ?? []) {
    try { out.push({ locationId: l.id, result: await refreshTodaySalesIfStale(l.id, todayEt, PINGER_DEBOUNCE_MS, "pinger") }); }
    catch (e) { out.push({ locationId: l.id, result: "error" as const, error: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}
```
(Keep the existing "the debounce read uses `occurred_at`, not `created_at`" fix intact; read the current `maybeRefreshTodaySales` body and move it, do not rewrite it. Verify `locations.active` exists — `grep -n "active" supabase/migrations/00*locations*` — if the column is named differently, use that name.)

- [ ] **Step 2: Route** `app/api/cron/toast-sales-today/route.ts` — copy the `toast-catering-scan` route's header comment style, `secretOk` (CATERING_SCAN_SECRET), `runtime = "nodejs"`, `maxDuration = 120`; body:

```ts
export async function GET(req: NextRequest) {
  if (!process.env.CATERING_SCAN_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  const today = etCalendarDate(new Date().toISOString());
  try {
    const results = await pullTodaySalesForAllLocations(today);
    const n = (k: string) => results.filter((r) => r.result === k).length;
    void audit({ actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: "toast-sales-today", date: today, pulled: n("pulled"), fresh: n("fresh"), no_toast: n("no_toast"), errors: n("error") }, ipAddress: null, userAgent: null });
    return jsonOk({ date: today, results });
  } catch (e) {
    void audit({ actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null, metadata: { job: "toast-sales-today", date: today, error: truncateErr(e) }, ipAddress: null, userAgent: null });
    return jsonError(500, "pull_failed");
  }
}
```
Header comment must state: events-only, never materializes the depletion ledger, dedicated low-blast secret, external pinger every 10 min.

- [ ] **Step 3: Verify** — `npm run typecheck`; `npm test`. **Step 4: Commit** — `git add lib/catering/toast-sales.ts app/api/cron/toast-sales-today/route.ts && git commit -m "toast: same-day sales pinger route (events-only, CATERING_SCAN_SECRET, 8-min debounce)"`

---

### Task 6: Pulse catering panel v2

**Files:**
- Modify: `lib/midshift-shared.ts`, `lib/midshift.ts`, `components/midshift/CateringToday.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/midshift-catering-panel.test.ts` (new)

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { tomorrowSummary, stageChip } from "@/lib/midshift-shared";

describe("pulse catering panel v2", () => {
  it("tomorrowSummary picks the earliest parseable window and counts everything", () => {
    expect(tomorrowSummary([])).toEqual({ count: 0, firstWindow: null });
    expect(tomorrowSummary(["1:00–1:30 PM", "11:30 AM–12:00 PM", null])).toEqual({ count: 3, firstWindow: "11:30 AM–12:00 PM" });
    expect(tomorrowSummary([null, "tbd"])).toEqual({ count: 2, firstWindow: null });
  });
  it("stageChip maps the two live stages to token roles", () => {
    expect(stageChip("confirmed")).toEqual({ className: "bg-co-gold/20 text-co-gold-text", labelKey: "catering.pipeline.stage.confirmed" });
    expect(stageChip("out")).toEqual({ className: "bg-co-text text-co-bg", labelKey: "catering.pipeline.stage.out" });
  });
});
```

- [ ] **Step 2: Implement in `lib/midshift-shared.ts`**:

```ts
export type DueStage = "confirmed" | "out";
export interface CateringDueItem {
  id: string; timeWindow: string | null; name: string; headcount: number | null; isDelivery: boolean;
  stage: DueStage; source: string | null;
}
export interface CateringTomorrow { count: number; firstWindow: string | null; }
// MidShiftPulse gains:  cateringTomorrow: CateringTomorrow;

export function tomorrowSummary(windows: Array<string | null>): CateringTomorrow {
  const parseable = windows.filter((w): w is string => w != null && timeWindowMinutes(w) !== Infinity)
    .sort((a, b) => timeWindowMinutes(a) - timeWindowMinutes(b));
  return { count: windows.length, firstWindow: parseable[0] ?? null };
}
export function stageChip(stage: DueStage): { className: string; labelKey: TranslationKey } {
  return stage === "out"
    ? { className: "bg-co-text text-co-bg", labelKey: "catering.pipeline.stage.out" as TranslationKey }
    : { className: "bg-co-gold/20 text-co-gold-text", labelKey: "catering.pipeline.stage.confirmed" as TranslationKey };
}
```
(`bg-co-gold/20` is the documented brand-badge tint; `co-gold-text` is the AA gold text role. Import `TranslationKey` type.)

- [ ] **Step 3: Loader** in `lib/midshift.ts`: `loadCateringDueToday` selects `stage, lead_source` too and maps `stage: r.stage as DueStage, source: r.lead_source`; add

```ts
async function loadCateringTomorrow(service: SupabaseClient, args: { locationId: string; date: string }): Promise<CateringTomorrow> {
  const tomorrow = etYmdMinusDays(args.date, -1);
  const { data, error } = await service.from("catering_pipeline").select("time_window")
    .eq("location_id", args.locationId).eq("event_date", tomorrow).in("stage", ["confirmed", "out"])
    .returns<Array<{ time_window: string | null }>>();
  if (error) throw new Error(`loadCateringTomorrow catering_pipeline: ${error.message}`);
  return tomorrowSummary((data ?? []).map((r) => r.time_window));
}
```
and add it as a sixth member of the `Promise.all` in `loadMidShiftPulse`, returning `cateringTomorrow` on the pulse (import `etYmdMinusDays` from `@/lib/operational-day`). Update every constructor/fixture of `MidShiftPulse` the compiler names (tests, pm-report reuse).

- [ ] **Step 4: Component** `components/midshift/CateringToday.tsx`: props become `{ items, tomorrow, language }`; render when `items.length > 0 || tomorrow.count > 0`. Each item row adds, after the time: a chip `<span className={\`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase ${chip.className}\`}>{serverT(language, chip.labelKey)}</span>` and, after the delivery/pickup word, the source: `leadSourceLabelKey(ev.source)` → `serverT(language, key)` or verbatim, in `text-xs text-co-text-dim`. Footer line under the list: `midshift.catering.tomorrow_none` / `midshift.catering.tomorrow_some` (`{count}`, `{time}`) / `midshift.catering.tomorrow_some_no_time` (`{count}`), `text-xs text-co-text-muted`. Update `app/(authed)/mid-shift/page.tsx:229` to pass `tomorrow={pulse.cateringTomorrow}`.

- [ ] **Step 5: i18n** — en: `"midshift.catering.tomorrow_none": "Tomorrow: no catering booked"`, `"midshift.catering.tomorrow_some": "Tomorrow: {count} booked, first at {time}"`, `"midshift.catering.tomorrow_some_no_time": "Tomorrow: {count} booked"`; es: `"Mañana: sin catering confirmado"`, `"Mañana: {count} confirmados, el primero a las {time}"`, `"Mañana: {count} confirmados"`.

- [ ] **Step 6: Verify + commit** — `npm test`, `npm run typecheck`; `git add -A lib/midshift-shared.ts lib/midshift.ts components/midshift/CateringToday.tsx "app/(authed)/mid-shift/page.tsx" lib/i18n tests/midshift-catering-panel.test.ts && git commit -m "mid-shift: catering panel v2 — stage chip, source, tomorrow line"`

---

### Task 7: PR, CI, preview smoke (CC + Juan)

- [ ] `git push -u origin catering-truth` → `gh pr create --title "Catering truth: test purge (0193) · insights v2 (0194) · same-day sales pinger · pulse catering panel v2" --body …` (body: spec link, the manifest table, the four rulings, the smoke list, the PR footer).
- [ ] CI `build` green. Smoke on the preview URL (preview DB = prod; the purge is NOT applied yet, so insights will still show the test rows — the check here is rendering, windows, calendar, pills; the numbers become true after 0193/0194 apply): `/catering/insights` renders four pills, calendar with dots on the ezCater dates (Sep 8, 11, 20), day list on tap; `/mid-shift` renders chips + tomorrow line; `GET /api/cron/toast-sales-today` → 401 without the header, 200 with it (CC runs the curl with the secret copied machine-to-machine, never pasted).
- [ ] Juan clicks merge.

### Task 8: Apply migrations, update the desktop pinger, verify (CC)

- [ ] After merge: `mcp apply_migration` 0193 (his "confirm purge" stands) then 0194. Verify: `select count(*) from catering_pipeline` = 5; `select count(*) from catering_customers` = 0; audit row `catering.test_data_purge` present with counts; `select public.catering_insights_v2(null, current_date)->'all_time'` shows `booked_events = 5`, `booked_value_cents ≈ 288697`.
- [ ] Prod `/catering/insights` frame-check: this month shows the three ezCater events; all time shows 5 booked, ≈$2,887; win rate null → "No settled leads yet" only if no lost remain (after purge, all 5 are confirmed → win rate 100%).
- [ ] Desktop: over ssh to the CO desktop, append to `C:\co\bin\catering-scan.cmd` a second line `curl -sS -H "x-cron-secret: %SECRET%" https://co-ops-ashy.vercel.app/api/cron/toast-sales-today >> C:\co\drive\logs\catering-scan.log 2>&1` (the secret variable already lives in that file; read it back after writing). Watch one 10-minute cycle in the log.
- [ ] AGENTS.md law line (docs-only push): under Audit & append-only conventions — "**Builder test data is purged by MIGRATION with an asserted manifest and one `catering.test_data_purge`-style audit row (Juan 2026-09-05: the law is for operators' history, not builders' artifacts). No app code path deletes; tests happen in the sim project.**" Update the "Migration lineage" line to 0194.
- [ ] Memory + CHIEF open list: insights v2 live, pinger live, Stripe spec next.

---

## Self-review
**Spec coverage:** §1 purge (manifest, asserts, audit row, registry, no app delete path) → T1, T8 · §2 RPC (four windows, event-vs-created split, one value per lead, calendar −30/+90, revokes, drop old) → T3; page (pills, stats, breakdowns, calendar with dots/legend/day list, disclosure, i18n, feedback kept) → T2, T4 · §3 pinger (route, CATERING_SCAN_SECRET, events-only, 8-min debounce, desktop cmd) → T5, T8 · §4 panel (stage chip, source, due time, headcount, delivery, tomorrow line, no revenue) → T6 · testing/rollout → T7, T8. Stripe deliberately out.
**Placeholders:** the T5 stale-check body says "move the body of maybeRefreshTodaySales here" — that is a refactor instruction pointing at existing code (confirm-before-authoring), not a TBD; the T4 InsightsClient is described by contract with the pieces' classes named; the implementer copies FunnelBar from the old page (quoted in ground truth).
**Type consistency:** `WindowKey`/`WindowStats`/`CalendarEvent` defined in T2, consumed in T4; `DueStage`, `CateringTomorrow`, `tomorrowSummary`, `stageChip` defined in T6 shared and used in the loader/component; `leadSourceLabelKey` defined in T4 Step 1 and used in T4 and T6; `SystemPullContext` widened in T5 before the route uses `"pinger"`.

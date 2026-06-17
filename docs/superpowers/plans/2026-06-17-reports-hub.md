# Reports Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `/reports` library to browse/filter historical reports across all shipped types, with full drill-in whose contents are redacted by the viewer's role level.

**Architecture:** `lib/reports-hub.ts` holds tier-aware loaders — `listReports` (unions checklist_instances + cash_reports + pm_reports, applies list-level visibility) and `loadReportDetail` (dispatches per type, redacts contents to the viewer's tier). A `/reports` list page + filter bar, and a `/reports/[type]/[id]` detail route with per-type read views. Redaction is **app-layer** (loaders pick columns), mirroring PM's `loadMyFeedback`.

**Tech Stack:** Next 16 App Router (server components), React 19, Tailwind v4 tokens, TS strict. No test framework — verify via `npm run typecheck` + `next build` + throwaway `tsx` smokes (`npx tsx --env-file=.env.local scripts/X.ts`, self-cleaning).

**Verification note:** No test framework — "test" = throwaway tsx smoke + tsc/build. Commits per task; CC reviews each diff (T0).

**Visibility (the crux — levels: employee/trainee ≤3, KH=4, SL=5, AGM+=6):**
- Checklist types (opening/closing/am_prep/mid_day): everyone sees full content; **notes only at L5+**.
- Cash: **L4+ only** (not listed below L4); over/short note at **L5+**.
- PM: L4+ see all evals (structured, no note); **≤L3 see only pm_reports where they have an eval** (own, structured, no note); notes at **L5+**.
- Constants: `REPORTS_HUB_CASH_LEVEL = 4`, `REPORTS_HUB_NOTES_LEVEL = 5`.
- **Enforcement is in the loaders' SELECT lists** — never the UI. Smokes assert the redaction.

---

## File Structure

- **Create `lib/reports-hub.ts`** — `Viewer`, `ReportTypeKey`, `ReportListItem`, `listReports`; later `ReportDetail` + `loadReportDetail` + per-type detail loaders. The brain.
- **Move + rewrite `app/reports/page.tsx` → `app/(authed)/reports/page.tsx`** — the list page (filters + results).
- **Create `app/(authed)/reports/[type]/[id]/page.tsx`** — the detail route.
- **Create `components/reports-hub/ReportFilterBar.tsx`, `ReportList.tsx`, `ChecklistReportDetail.tsx`, `CashReportDetail.tsx`, `PmReportDetail.tsx`**.
- **Modify `lib/i18n/en.json` + `es.json`** — `reports.*` keys.

---

## Task 1: `lib/reports-hub.ts` — `listReports` (union + list visibility)

**Files:** Create `lib/reports-hub.ts`.

- [ ] **Step 1: Write the types + `listReports`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const REPORTS_HUB_CASH_LEVEL = 4; // cash visible KH+
export const REPORTS_HUB_NOTES_LEVEL = 5; // notes visible SL+

export type ReportTypeKey = "opening" | "closing" | "am_prep" | "mid_day" | "cash" | "pm";

export interface Viewer {
  userId: string;
  level: number;
}

export interface ReportListItem {
  type: ReportTypeKey;
  id: string; // checklist_instances.id | cash_reports.id | pm_reports.id
  date: string; // operational date (YYYY-MM-DD)
  locationId: string;
  submitterName: string | null;
  status: string;
}

export interface ListFilters {
  viewer: Viewer;
  locationId: string;
  dateFrom: string; // YYYY-MM-DD inclusive
  dateTo: string; // YYYY-MM-DD inclusive
  types?: ReportTypeKey[]; // optional; default = all the viewer may see
}

/** Map a checklist template (type + name) to a hub ReportTypeKey. prep splits by name. */
function checklistReportType(type: string, name: string): ReportTypeKey | null {
  if (type === "opening") return "opening";
  if (type === "closing") return "closing";
  if (type === "prep") {
    if (/mid-?day/i.test(name)) return "mid_day";
    if (/am prep/i.test(name)) return "am_prep";
  }
  return null;
}

export async function listReports(service: SupabaseClient, f: ListFilters): Promise<ReportListItem[]> {
  const want = (t: ReportTypeKey) => !f.types || f.types.includes(t);
  const items: ReportListItem[] = [];
  const submitterIds = new Set<string>();

  // ── checklist-based (opening/closing/am_prep/mid_day) — visible to everyone ──
  if (want("opening") || want("closing") || want("am_prep") || want("mid_day")) {
    const { data: insts } = await service
      .from("checklist_instances")
      .select("id, location_id, date, status, confirmed_by, template_id")
      .eq("location_id", f.locationId)
      .gte("date", f.dateFrom)
      .lte("date", f.dateTo);
    const rows = (insts ?? []) as Array<{ id: string; location_id: string; date: string; status: string; confirmed_by: string | null; template_id: string }>;
    const tmplIds = [...new Set(rows.map((r) => r.template_id))];
    const typeById = new Map<string, ReportTypeKey>();
    if (tmplIds.length) {
      const { data: tmpls } = await service.from("checklist_templates").select("id, type, name").in("id", tmplIds);
      for (const t of (tmpls ?? []) as Array<{ id: string; type: string; name: string }>) {
        const rt = checklistReportType(t.type, t.name);
        if (rt) typeById.set(t.id, rt);
      }
    }
    for (const r of rows) {
      const rt = typeById.get(r.template_id);
      if (!rt || !want(rt)) continue;
      if (r.confirmed_by) submitterIds.add(r.confirmed_by);
      items.push({ type: rt, id: r.id, date: r.date, locationId: r.location_id, submitterName: null, status: r.status });
    }
  }

  // ── cash — KH+ (L4+) only ──
  if (want("cash") && f.viewer.level >= REPORTS_HUB_CASH_LEVEL) {
    const { data: cash } = await service
      .from("cash_reports")
      .select("id, location_id, report_date, signed_by")
      .eq("location_id", f.locationId)
      .gte("report_date", f.dateFrom)
      .lte("report_date", f.dateTo)
      .is("superseded_at", null);
    for (const r of (cash ?? []) as Array<{ id: string; location_id: string; report_date: string; signed_by: string | null }>) {
      if (r.signed_by) submitterIds.add(r.signed_by);
      items.push({ type: "cash", id: r.id, date: r.report_date, locationId: r.location_id, submitterName: null, status: "submitted" });
    }
  }

  // ── PM — L4+ see all submitted; ≤L3 see only reports where they have an eval ──
  if (want("pm")) {
    const { data: pm } = await service
      .from("pm_reports")
      .select("id, location_id, report_date, status, submitted_by")
      .eq("location_id", f.locationId)
      .gte("report_date", f.dateFrom)
      .lte("report_date", f.dateTo)
      .is("superseded_at", null)
      .in("status", ["submitted", "incomplete_confirmed", "auto_finalized"]);
    let pmRows = (pm ?? []) as Array<{ id: string; location_id: string; report_date: string; status: string; submitted_by: string | null }>;
    if (f.viewer.level < REPORTS_HUB_CASH_LEVEL) {
      // employee: keep only reports that contain an eval about them
      const ids = pmRows.map((r) => r.id);
      const mine = new Set<string>();
      if (ids.length) {
        const { data: evals } = await service
          .from("pm_employee_evals")
          .select("pm_report_id")
          .in("pm_report_id", ids)
          .eq("employee_id", f.viewer.userId)
          .is("superseded_at", null);
        for (const e of (evals ?? []) as Array<{ pm_report_id: string }>) mine.add(e.pm_report_id);
      }
      pmRows = pmRows.filter((r) => mine.has(r.id));
    }
    for (const r of pmRows) {
      if (r.submitted_by) submitterIds.add(r.submitted_by);
      items.push({ type: "pm", id: r.id, date: r.report_date, locationId: r.location_id, submitterName: null, status: r.status });
    }
  }

  // ── resolve submitter names ──
  if (submitterIds.size) {
    const { data: users } = await service.from("users").select("id, name").in("id", [...submitterIds]);
    const nameById = new Map<string, string>();
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
    for (const it of items) {
      // submitter id was the confirmed_by/signed_by/submitted_by captured above — re-derive via a parallel map is avoided
      // by storing it; simpler: leave name resolution to a second pass keyed per type is overkill. Instead we set names
      // here by matching nothing — so capture the submitter id ON the item. (Implementer: add `submitterId` to the loop above.)
    }
  }

  // newest first
  return items.sort((a, b) => (a.date < b.date ? 1 : -1));
}
```

> **Implementer correction (do this):** the name-resolution block above is intentionally left to fix — the clean approach is to carry a `submitterId: string | null` on each pushed item (set from `confirmed_by`/`signed_by`/`submitted_by`), then after collecting all items + the `nameById` map, set `it.submitterName = it.submitterId ? nameById.get(it.submitterId) ?? null : null`. Add `submitterId` to the loop pushes and the final resolution loop; it need not be on the exported `ReportListItem` (use an internal type or include it). Keep `ReportListItem.submitterName` as the public field.

- [ ] **Step 2: `npm run typecheck`** clean.

- [ ] **Step 3: Smoke** `scripts/smoke-reports-list.ts`: for MEP, a wide date range (`2026-06-01`..`2026-06-30`), call `listReports` as (a) an employee viewer `{ userId: <some employee>, level: 3 }` and (b) a manager `{ userId: <juan>, level: 10 }`. Assert: manager list INCLUDES `type==='cash'` items; employee list has **zero** `type==='cash'`; employee's `pm` items are only ones where they have an eval (or zero). Print counts per type for both. Run → PASS; delete.

- [ ] **Step 4: Commit** — `git add lib/reports-hub.ts && git commit -m "feat(reports-hub): listReports union + list visibility (cash KH+, PM own-for-employees)"`

---

## Task 2: `/reports` list page + filter bar + list component

**Files:** Delete `app/reports/page.tsx` (top-level stub); Create `app/(authed)/reports/page.tsx`, `components/reports-hub/ReportFilterBar.tsx`, `components/reports-hub/ReportList.tsx`.

READ: `app/(authed)/maintenance/page.tsx` (auth + location-resolve + `lockLocationContext` + chrome); `components/DashboardNav.tsx` (the `/reports` chip is `scoped:true` — it passes `?location=`); `lib/i18n/format.ts` (`formatDateLabel`).

- [ ] **Step 1: Remove the stub** — `git rm app/reports/page.tsx` (the new page lives under `(authed)` at the same URL).
- [ ] **Step 2: `app/(authed)/reports/page.tsx`** — server component. `requireSessionFromHeaders("/reports")`; resolve location from `?location=` (default `auth.locations[0]`) + `lockLocationContext` (render a no-location soft state if none/forbidden — mirror maintenance). Read filters from `searchParams` (`?type=`, `?from=`, `?to=`); default range = last 14 days ending today (`operationalNow` from `lib/midshift`); default types = all. `viewer = { userId: auth.user.id, level: auth.level }`. Call `listReports`. Render `<ReportFilterBar>` (date range + type multiselect, GET-form that updates the query string, preserving `location`) + `<ReportList items rows language>`. Each list row links to `/reports/${item.type}/${item.id}?location=${locationId}`.
- [ ] **Step 3: `ReportFilterBar.tsx`** (can be a small client component using a plain `<form method="get">` so it stays server-friendly, OR server-rendered links) — date-from / date-to inputs + a report-type selector (the types the viewer may see; cash only shown when `level>=4`). Submitting updates the URL query (keeps `location`). Mirror token styling.
- [ ] **Step 4: `ReportList.tsx`** (server) — a list; each row: `formatDateLabel(date)` · type label (`reports.type.<key>`) · submitter · status (`reports.status.<status>` or a generic). Empty → `reports.empty`. Rows are `<a href>` to the detail route.
- [ ] **Step 5:** `npm run typecheck` + `npm run build` clean; `/reports` builds dynamic.
- [ ] **Step 6: Commit** — `git add "app/(authed)/reports/page.tsx" components/reports-hub/ && git rm app/reports/page.tsx ; git commit -m "feat(reports-hub): /reports list page + filter bar (under authed)"`

---

## Task 3: `loadReportDetail` (checklist types) + shared checklist read view

**Files:** Modify `lib/reports-hub.ts`; Create `app/(authed)/reports/[type]/[id]/page.tsx`, `components/reports-hub/ChecklistReportDetail.tsx`.

- [ ] **Step 1: Append the checklist detail loader + dispatcher to `lib/reports-hub.ts`**

```ts
export interface ChecklistDetailItem {
  station: string;
  label: string;
  done: boolean;
  byName: string | null;
  countValue: number | null;
  note: string | null; // null unless viewer.level >= REPORTS_HUB_NOTES_LEVEL
}
export interface ChecklistReportDetail {
  kind: "checklist";
  type: ReportTypeKey;
  date: string;
  status: string;
  items: ChecklistDetailItem[];
}

async function loadChecklistDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; instanceId: string; type: ReportTypeKey },
): Promise<ChecklistReportDetail | null> {
  const { data: inst } = await service
    .from("checklist_instances")
    .select("id, template_id, date, status")
    .eq("id", args.instanceId)
    .maybeSingle<{ id: string; template_id: string; date: string; status: string }>();
  if (!inst) return null;

  const showNotes = args.viewer.level >= REPORTS_HUB_NOTES_LEVEL;
  const { data: titems } = await service
    .from("checklist_template_items")
    .select("id, station, label, display_order")
    .eq("template_id", inst.template_id)
    .eq("active", true)
    .order("display_order", { ascending: true });
  const { data: comps } = await service
    .from("checklist_completions")
    .select("template_item_id, completed_by, count_value, notes")
    .eq("instance_id", args.instanceId)
    .is("superseded_at", null)
    .is("revoked_at", null);
  const compByItem = new Map<string, { completed_by: string | null; count_value: number | null; notes: string | null }>();
  for (const c of (comps ?? []) as Array<{ template_item_id: string; completed_by: string | null; count_value: number | null; notes: string | null }>) {
    compByItem.set(c.template_item_id, c);
  }
  const byIds = [...new Set([...compByItem.values()].map((c) => c.completed_by).filter((v): v is string => !!v))];
  const nameById = new Map<string, string>();
  if (byIds.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", byIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
  }
  const items: ChecklistDetailItem[] = ((titems ?? []) as Array<{ id: string; station: string; label: string }>).map((ti) => {
    const c = compByItem.get(ti.id);
    return {
      station: ti.station,
      label: ti.label,
      done: !!c,
      byName: c?.completed_by ? nameById.get(c.completed_by) ?? null : null,
      countValue: c?.count_value ?? null,
      note: showNotes ? c?.notes ?? null : null, // REDACTED below L5
    };
  });
  return { kind: "checklist", type: args.type, date: inst.date, status: inst.status, items };
}

export type ReportDetail = ChecklistReportDetail; // cash + pm variants added in Task 4

export async function loadReportDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; type: ReportTypeKey; id: string },
): Promise<ReportDetail | null> {
  if (args.type === "opening" || args.type === "closing" || args.type === "am_prep" || args.type === "mid_day") {
    return loadChecklistDetail(service, { viewer: args.viewer, instanceId: args.id, type: args.type });
  }
  return null; // cash + pm in Task 4
}
```

- [ ] **Step 2: `app/(authed)/reports/[type]/[id]/page.tsx`** — server. `requireSessionFromHeaders`. `params: Promise<{ type: string; id: string }>` (await). Validate `type` ∈ ReportTypeKey; resolve location from `?location=` + `lockLocationContext`. `viewer = {userId, level}`. `loadReportDetail`. **Enforce list-visibility at the detail too**: if `type==='cash'` and `level<4` → soft "not available"; (pm own-check is handled in Task 4's loader). Render the matching detail component (Task 3: checklist). Back link to `/reports?location=...`.
- [ ] **Step 3: `ChecklistReportDetail.tsx`** (server) — group items by station; per item show label, a done ✓/�—, by-name + count when present, and the note **only if present** (it's already redacted to null below L5). Header: type label + date + status.
- [ ] **Step 4:** typecheck + build clean.
- [ ] **Step 5: Smoke** `scripts/smoke-reports-detail.ts`: pick a real submitted closing instance at EM; `loadReportDetail` as level-4 viewer → assert every `item.note === null` (redacted); as level-5 viewer → at least the items that HAD notes now expose them (find one with a note). Print. Run → PASS; delete.
- [ ] **Step 6: Commit** — `git add lib/reports-hub.ts "app/(authed)/reports/[type]/" components/reports-hub/ChecklistReportDetail.tsx && git commit -m "feat(reports-hub): checklist detail loader + read view (notes redacted < L5)"`

---

## Task 4: Cash + PM detail loaders + read views

**Files:** Modify `lib/reports-hub.ts`; Create `components/reports-hub/CashReportDetail.tsx`, `components/reports-hub/PmReportDetail.tsx`.

READ: `lib/cash.ts` `loadCashReport` + `CashReport` shape; `lib/pm-report.ts` `loadPmReportForEdit` + `EmployeeEval`/`Gradient`.

- [ ] **Step 1: Append cash + PM detail loaders + extend `ReportDetail`/`loadReportDetail`**
  - `CashReportDetail` variant (`kind: "cash"`): load the cash_report by id (mirror `loadCashReport`'s select; if it loads by date, write a small by-id query). Gate: if `viewer.level < REPORTS_HUB_CASH_LEVEL` return null. Include drawer/deposit/over-short/tips/on-shift; set `overShortNote` to the value **only if `viewer.level >= REPORTS_HUB_NOTES_LEVEL`**, else null.
  - `PmReportDetail` variant (`kind: "pm"`): load the pm_report + its live evals. Tier logic:
    - `level >= 4`: all evals (structured: arrivedReady/attitude/production/teamPlayer/areaToImprove); `note` included only if `level >= 5`, else null. Include MVP.
    - `level < 4`: ONLY the eval where `employee_id === viewer.userId` (structured, **no note**); if none, return null.
  - Extend `ReportDetail` union with the cash + pm variants; add the dispatch branches in `loadReportDetail`.
- [ ] **Step 2:** `CashReportDetail.tsx` + `PmReportDetail.tsx` (server) render their variants; never render a field the loader set to null (notes already redacted). Wire both into the detail route's render switch (Task 3 page).
- [ ] **Step 3:** typecheck + build clean.
- [ ] **Step 4: Smoke** `scripts/smoke-reports-cd.ts`: (cash) `loadReportDetail` for a cash report as level-3 → null (blocked); level-4 → loaded but `overShortNote === null`; level-5 → over/short note present (if the report has one). (pm) as an employee with an eval → only their own eval, no `note` key/value; as level-4 → all evals, notes null; level-5 → notes present. Print + PASS; delete.
- [ ] **Step 5: Commit** — `git add lib/reports-hub.ts components/reports-hub/ && git commit -m "feat(reports-hub): cash + PM detail loaders/views (cash KH+, notes SL+, PM own-for-employees)"`

---

## Task 5: i18n + final smoke + ship

**Files:** Modify `lib/i18n/en.json` + `es.json`.

- [ ] **Step 1: Add `reports.*` keys (BOTH files, identical sets):** page title (`reports.page.title` "Reports"), filter labels (`reports.filter.from`/`.to`/`.type`/`.all_types`/`.apply`), type labels (`reports.type.opening`/`closing`/`am_prep`/`mid_day`/`cash`/`pm`), list (`reports.empty`, `reports.col.date`/`.type`/`.by`/`.status`, `reports.submitted_by`), status labels (`reports.status.submitted`/`.open`/`.in_progress`), detail (`reports.detail.back`, `reports.detail.done`, `reports.detail.not_done`, `reports.detail.note`, `reports.cash.deposit`/`.over_short`/`.tips`, `reports.pm.mvp` + reuse `pm.*`/`midshift.*` where natural), `reports.not_available` (cash/forbidden soft state). Spanish parallel (operational/tú).
- [ ] **Step 2:** typecheck + build clean; en/es `reports.*` counts match.
- [ ] **Step 3: Final smoke** — `rm -rf .next/types`; typecheck + build clean. Re-run the Task 1/3/4 smoke assertions once consolidated if convenient.
- [ ] **Step 4: Push + open PR** (base `main`), title `Reports Hub (Wave 3): read-only report library with tier-redacted drill-in`. Body: the visibility matrix, the app-layer redaction, deferred search, test plan w/ preview URL across roles. Do NOT merge.
- [ ] **Step 5: Confirm CI build green.**

---

## Notes for the executor

- **CC (T0) reviews every diff.** Top checks: (1) detail loaders set `note`/`overShortNote` to null below the threshold level — grep each detail loader's column handling; (2) cash blocked < L4 in BOTH `listReports` and `loadReportDetail`; (3) PM employee-scope (own eval only) < L4 in both; (4) `lockLocationContext` on both pages; (5) field-name accuracy vs the real artifact columns.
- **Redaction is app-layer** — the security depends on the loader's SELECT/null-set, never the component. Any change to a detail loader must preserve the tier gates.
- **No writes anywhere** — read-only module.
- **Embedded selects avoided** — use the two-step (load ids, load referenced rows) pattern, per the AGENTS.md PostgREST-embedded-select caution, even under service-role.

# Reports Hub — Richer Detail + Derived Filters: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Enrich the (already-merged) Reports Hub with computed per-report signals — feeding both a detail "highlights" card (+ a prep par/on-hand/total values table) and derived list filters (under par, over par, skipped, out-of-range temp, cash over/short).

**Architecture:** One `computeReportSignals` layer in `lib/reports-hub.ts` derives the signals (done/skipped, under/over par from `prep_data`, out-of-range temps via the maintenance registry's temp-item ids, cash over/short). `loadReportDetail` attaches signals + prep values; `listReports` uses them for filters + row badges. All derived from already-authorized data — tier redaction + the cross-location IDOR guard are untouched.

**Tech Stack:** Next 16 App Router, React 19, Tailwind v4 tokens, TS strict. No test framework — `tsc` + `next build` + throwaway `tsx` smokes.

**Verification note:** "test" = throwaway tsx smoke + tsc/build. Commits per task; CC reviews each diff (T0).

**Invariants:** read-only; signals derived only from data the viewer can already see (no new exposure); `prep_data` narrowed via `isPrepData` (never trust raw JSONB); temp threshold = 41°F.

---

## File Structure
- **Modify `lib/reports-hub.ts`** — add `ReportSignals`, `PrepValueRow`, `loadLocationTempItemIds`, `computeReportSignals`; extend `ChecklistReportDetail`/`CashReportDetail`/`PmReportDetail` with `signals` (+ prep value rows + pm gradient tally); extend `ListFilters` with `signalFilters` and `ReportListItem` with a `signalSummary`.
- **Modify the detail components** (`ChecklistReportDetail.tsx`, `CashReportDetail.tsx`, `PmReportDetail.tsx`) — render the highlights card + prep values table.
- **Modify `ReportFilterBar.tsx` + `ReportList.tsx`** — derived toggles + row badges.
- **Modify `lib/i18n/en.json` + `es.json`** — `reports.signal.*` keys.

---

## Task 1: `computeReportSignals` + temp-item ids (the derivation core)

**Files:** Modify `lib/reports-hub.ts`.

READ FIRST: `lib/prep.ts` `isPrepData` (line ~196) + `PrepData`/`PrepInputs`/`PrepSnapshot` types (lib/types.ts ~270-299); the base `loadChecklistDetail` (current completion select is `template_item_id, completed_by, count_value, notes` — you'll add `prep_data`); `lib/maintenance.ts` `FRIDGE_DEFAULT_SAFE_MAX_F` (41).

- [ ] **Step 1: Add types + temp-id loader + `computeReportSignals`**

```ts
import { isPrepData } from "@/lib/prep";
import { FRIDGE_DEFAULT_SAFE_MAX_F } from "@/lib/maintenance";

export interface ReportSignals {
  done: number;
  total: number; // required template items (checklist); 1 for cash
  skipped: number; // required items with no live completion
  underPar: number; // prep: items with total < par
  overPar: number; // prep: items with total > par
  tempFlags: number; // completions on temp items with count_value > 41
  cashOverShortCents: number | null; // cash only
}

export interface PrepValueRow {
  label: string;
  par: number | null;
  onHand: number | null;
  total: number | null;
  parStatus: "under" | "over" | "at" | "na";
}

/** Temp-item template-item ids for a location, from the maintenance registry. */
export async function loadLocationTempItemIds(service: SupabaseClient, locationId: string): Promise<Set<string>> {
  const { data } = await service
    .from("maintenance_equipment")
    .select("opening_temp_item_id, closing_temp_item_id")
    .eq("location_id", locationId)
    .eq("kind", "fridge");
  const ids = new Set<string>();
  for (const r of (data ?? []) as Array<{ opening_temp_item_id: string | null; closing_temp_item_id: string | null }>) {
    if (r.opening_temp_item_id) ids.add(r.opening_temp_item_id);
    if (r.closing_temp_item_id) ids.add(r.closing_temp_item_id);
  }
  return ids;
}

/**
 * Per-report derived signals. For checklist instances it loads template items
 * + live completions (incl. prep_data). `tempItemIds` is the location's temp
 * item id set (load once via loadLocationTempItemIds and pass in). For cash it
 * reads over_short_cents. Returns signals + (prep) the per-item value rows.
 */
export async function computeReportSignals(
  service: SupabaseClient,
  args: { type: ReportTypeKey; id: string; tempItemIds: Set<string> },
): Promise<{ signals: ReportSignals; prepValues: PrepValueRow[] }> {
  const empty: ReportSignals = { done: 0, total: 0, skipped: 0, underPar: 0, overPar: 0, tempFlags: 0, cashOverShortCents: null };

  if (args.type === "cash") {
    const { data } = await service.from("cash_reports").select("over_short_cents").eq("id", args.id).is("superseded_at", null).maybeSingle<{ over_short_cents: number | null }>();
    return { signals: { ...empty, total: 1, done: 1, cashOverShortCents: data?.over_short_cents ?? null }, prepValues: [] };
  }
  if (args.type === "pm") {
    return { signals: empty, prepValues: [] }; // pm uses its own gradient tally in the detail loader
  }

  // checklist types (opening/closing/am_prep/mid_day)
  const { data: inst } = await service.from("checklist_instances").select("template_id").eq("id", args.id).maybeSingle<{ template_id: string }>();
  if (!inst) return { signals: empty, prepValues: [] };

  const { data: titems } = await service
    .from("checklist_template_items")
    .select("id, label, required")
    .eq("template_id", inst.template_id)
    .eq("active", true);
  const items = (titems ?? []) as Array<{ id: string; label: string; required: boolean }>;
  const labelById = new Map(items.map((i) => [i.id, i.label]));

  const { data: comps } = await service
    .from("checklist_completions")
    .select("template_item_id, count_value, prep_data")
    .eq("instance_id", args.id)
    .is("superseded_at", null)
    .is("revoked_at", null);
  const rows = (comps ?? []) as Array<{ template_item_id: string; count_value: number | null; prep_data: unknown }>;
  const completedIds = new Set(rows.map((r) => r.template_item_id));

  const requiredItems = items.filter((i) => i.required);
  const done = requiredItems.filter((i) => completedIds.has(i.id)).length;
  const total = requiredItems.length;
  const skipped = total - done;

  let tempFlags = 0;
  let underPar = 0;
  let overPar = 0;
  const prepValues: PrepValueRow[] = [];

  for (const r of rows) {
    if (args.tempItemIds.has(r.template_item_id) && r.count_value !== null && r.count_value > FRIDGE_DEFAULT_SAFE_MAX_F) {
      tempFlags++;
    }
    if (isPrepData(r.prep_data)) {
      const par = r.prep_data.snapshot.parValue;
      const totalVal = r.prep_data.inputs.total ?? null;
      let parStatus: PrepValueRow["parStatus"] = "na";
      if (par !== null && totalVal !== null) {
        if (totalVal < par) { underPar++; parStatus = "under"; }
        else if (totalVal > par) { overPar++; parStatus = "over"; }
        else parStatus = "at";
      }
      prepValues.push({
        label: labelById.get(r.template_item_id) ?? "—",
        par,
        onHand: r.prep_data.inputs.onHand ?? null,
        total: totalVal,
        parStatus,
      });
    }
  }

  return { signals: { done, total, skipped, underPar, overPar, tempFlags, cashOverShortCents: null }, prepValues };
}
```

- [ ] **Step 2:** `npm run typecheck` clean.
- [ ] **Step 3: Smoke** `scripts/smoke-rh-signals.ts`: load `tempItemIds` for EM; pick a real submitted AM-prep instance at EM → `computeReportSignals` → assert `prepValues.length > 0` and the under/over counts are internally consistent (`underPar + overPar <=` prepValues with non-null par); pick a closing instance known to have a temp completion >41 → assert `tempFlags >= 1`; a cash report → `cashOverShortCents` matches the row. Print; PASS; delete.
- [ ] **Step 4: Commit** — `git add lib/reports-hub.ts && git commit -m "feat(reports-hub): computeReportSignals (par/skipped/temp/cash) + temp-item ids"`

---

## Task 2: Attach signals to detail loaders + render highlights + prep values

**Files:** Modify `lib/reports-hub.ts` (the 3 detail loaders + ReportDetail variants); Modify `components/reports-hub/ChecklistReportDetail.tsx`, `CashReportDetail.tsx`, `PmReportDetail.tsx`.

- [ ] **Step 1: Extend the detail variants + loaders** — add `signals: ReportSignals` to `ChecklistReportDetail` + `CashReportDetail`, and `prepValues: PrepValueRow[]` to `ChecklistReportDetail` (empty for non-prep). In `loadChecklistDetail` + `loadCashDetail`: after loading (and AFTER the existing location-bind IDOR guard), call `loadLocationTempItemIds(service, <the record's location_id>)` + `computeReportSignals` and attach. For `PmReportDetail`: add a `gradientTally: { dimension: string; great: number; good: number; needsWork: number }[]` computed from the evals already loaded (count per dimension across arrivedReady/attitude/production/teamPlayer) — detail-only, respects the existing own-eval/notes tiering. (The checklist loader must now also `loadLocationTempItemIds` using the instance's `location_id`, which it already selects for the IDOR guard.)
- [ ] **Step 2: `ChecklistReportDetail.tsx`** — add a **highlights card** at top: `reports.signal.completion` ("{done}/{total} done · {skipped} skipped"), and when prep (`prepValues.length>0`): `reports.signal.par` ("{underPar} under par · {overPar} over par"), and `signals.tempFlags>0` → `reports.signal.temp_flag` ("{n} temp out of range"). Then, when `prepValues.length>0`, a **values table**: per row label · par · on-hand · total, with under rows tinted `text-co-cta`, over rows `text-co-gold-deep`. Keep the existing per-item body below.
- [ ] **Step 3: `CashReportDetail.tsx`** — highlights card with the over/short readout from `signals.cashOverShortCents` (over = `text-co-cta` if short... use `reports.signal.cash_over`/`cash_short`/`cash_even`). `PmReportDetail.tsx` — a small gradient tally card.
- [ ] **Step 4:** typecheck + build clean.
- [ ] **Step 5: Commit** — `git add lib/reports-hub.ts components/reports-hub/ && git commit -m "feat(reports-hub): detail highlights card + prep values table + signal attach"`

---

## Task 3: List filters + row badges

**Files:** Modify `lib/reports-hub.ts` (`listReports` + `ReportListItem`/`ListFilters`); Modify `components/reports-hub/ReportFilterBar.tsx`, `ReportList.tsx`; the `/reports` page passes the new filters.

- [ ] **Step 1: Extend `ListFilters`** with `signalFilters?: { underPar?: boolean; overPar?: boolean; skipped?: boolean; tempFlag?: boolean; cashOver?: boolean; cashShort?: boolean }` and `ReportListItem` with `signalSummary?: { underPar: number; overPar: number; skipped: number; tempFlags: number; cashOverShortCents: number | null }`.
- [ ] **Step 2:** In `listReports`, after building the base `items`: if any `signalFilters` are set OR badges are wanted, load `loadLocationTempItemIds` once for the location, then for each item call `computeReportSignals` and attach `signalSummary`; if `signalFilters` are set, KEEP only items matching (underPar→`summary.underPar>0`, skipped→`summary.skipped>0`, tempFlag→`summary.tempFlags>0`, cashOver→`cashOverShortCents>0`, cashShort→`<0`). (Compute-on-read; CO volume is small — a comment notes the future materialized-column option.) Always attach `signalSummary` so the list can badge.
- [ ] **Step 3: `ReportFilterBar.tsx`** — add the derived toggles as checkboxes in the GET form (cash toggles only when viewer ≥ L4). The `/reports` page reads them from `searchParams` into `signalFilters`.
- [ ] **Step 4: `ReportList.tsx`** — render a small badge per row from `signalSummary` (e.g. `⚠ {underPar} under par`, `{tempFlags} temp`, cash over/short) using `reports.signal.*` keys.
- [ ] **Step 5:** typecheck + build clean.
- [ ] **Step 6: Smoke** `scripts/smoke-rh-filter.ts`: `listReports` for EM wide range with `signalFilters.underPar=true` → assert every returned item has `signalSummary.underPar > 0`; with `tempFlag=true` → every item `tempFlags>0`. Print counts; PASS; delete.
- [ ] **Step 7: Commit** — `git add lib/reports-hub.ts components/reports-hub/ "app/(authed)/reports/page.tsx" && git commit -m "feat(reports-hub): derived list filters + row signal badges"`

---

## Task 4: i18n + final smoke + ship

**Files:** Modify `lib/i18n/en.json` + `es.json`.

- [ ] **Step 1: Add `reports.signal.*` keys (BOTH files, identical):** `reports.signal.completion` ("{done}/{total} done · {skipped} skipped"), `reports.signal.par` ("{under} under par · {over} over par"), `reports.signal.temp_flag` ("{n} temp out of range"), `reports.signal.cash_over` ("{amount} over"), `reports.signal.cash_short` ("{amount} short"), `reports.signal.cash_even` ("even"), `reports.values.par`/`.on_hand`/`.total`/`.heading` ("Prep values"), `reports.filter.under_par`/`.over_par`/`.skipped`/`.temp_flag`/`.cash_over`/`.cash_short`, `reports.badge.under_par`/`.temp`. Spanish parallel (operational/tú).
- [ ] **Step 2:** typecheck + build clean; en/es `reports.*` counts match.
- [ ] **Step 3: Final** — `rm -rf .next/types`; typecheck + build clean. Re-run the Task 1/3 smokes if convenient.
- [ ] **Step 4: Push + open PR** (base `main`), title `Reports Hub: richer detail + derived filters`. Body: the signals, the prep values table, the derived filters, deferred trend charts/search, test plan w/ preview URL. Do NOT merge.
- [ ] **Step 5: Confirm CI build green.**

---

## Notes for the executor
- **CC (T0) reviews every diff.** Checks: (1) `computeReportSignals` derives only from already-authorized data — it does NOT bypass the cash KH+ gate or expose notes (it returns counts/values, never note text); (2) `prep_data` narrowed via `isPrepData`, never raw; (3) the detail loaders' existing location-bind IDOR guard + tier redaction are untouched; (4) temp-flag uses the registry temp-item ids (not "any count>41", which would false-positive on prep totals); (5) field-name accuracy vs `PrepData`/`PrepInputs`/`PrepSnapshot`.
- **No writes.** Signals are computed read-only.
- **Perf:** signals are compute-on-read per report in `listReports` when filters/badges are active — fine for CO's tens-of-reports windows; a materialized signal column is the future optimization (note it, don't build it).

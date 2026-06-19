# Maintenance as a Reports Hub Report Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the maintenance log a first-class Reports Hub report type — a synthesized per-(location,date) digest row, a per-equipment day drill-in, filter chip, and free-text search coverage — composed entirely from existing data.

**Architecture:** `"maintenance"` is a virtual `ReportTypeKey`. Two new date-scoped loaders in `lib/maintenance.ts` (`listMaintenanceReportDates`, `loadMaintenanceReportDetail`) reuse the module's existing equipment/temp/notes logic. `lib/reports-hub.ts` composes them into `listReports` + `loadReportDetail`. `lib/reports-search.ts` adds a maintenance corpus branch (ad-hoc notes only — fridge temp-item notes are already searchable under opening/closing). The hub pages add a filter chip + a detail view. **No migration, no new table, no write path.**

**Tech Stack:** Next 16 App Router, TS strict + `noUncheckedIndexedAccess`, Supabase (custom JWT + RLS). No test framework → `tsc --noEmit` + `next build` + throwaway `tsx` smokes (`npx tsx --env-file=.env.local scripts/<n>.ts`, body wrapped `async function main(){…}; main().catch(e=>{console.error(e);process.exit(1)})`, self-deleted, never committed).

**Branch:** `claude/maintenance-report-type` (created off `origin/main`; design doc already committed). Commit after each task.

**Reused from `lib/maintenance.ts` (read it first — confirmed shapes):** `Equipment` (`{id,name,kind,openingTempItemId,closingTempItemId,safeMaxF}`), `TempReading` (`{date,phase:"AM"|"PM",valueF,at,note}`), `MaintenanceNote` (`{id,equipmentId,otherLabel,note,byName,at}`), `FridgeStatus` (`"ok"|"out_of_range"|"no_reading_today"`), `computeFridgeStatus(readings, safeMaxF)`, `FRIDGE_DEFAULT_SAFE_MAX_F = 41`, `loadEquipment(service, locationId)`, and the **private** `loadFridgeReadings(service, equip, sinceDate)` (returns readings with `date >= sinceDate`, NO upper bound — callers must filter `<= dateTo` themselves). `maintenance_notes` columns: `id, note, created_by, created_at, equipment_id, location_id, other_label`.

---

## Task 1: Date-scoped maintenance loaders + detail type (`lib/maintenance.ts`)

**Files:** Modify `lib/maintenance.ts` (append new exports; reuse existing internals).

- [ ] **Step 1: Ground-truth**

Re-read `lib/maintenance.ts` end-to-end. Confirm: `loadFridgeReadings` is in-file (callable without export), its `sinceDate` lower-bound-only behavior, and the `EQUIP_ROW`/`rowToEquip` helpers. Confirm `selectAllRows` is exported from `@/lib/supabase-paginate` (used for wide-window scans).

- [ ] **Step 2: Add the `MaintenanceReportDetail` type**

Append to `lib/maintenance.ts` (it owns these types; `reports-hub.ts` will import this into its `ReportDetail` union — keeping the dependency one-way, maintenance→nothing):
```ts
export interface MaintenanceReportEquip {
  equipmentId: string;
  label: string;
  kind: "fridge" | "equipment";
  safeMaxF: number | null;
  status: FridgeStatus;        // meaningful for fridges; "no_reading_today" for non-fridge
  readings: TempReading[];     // that date's readings (AM/PM), chronological
  notes: MaintenanceNote[];    // maintenance_notes for this equip on this date, newest first
}
export interface MaintenanceReportDetail {
  kind: "maintenance";
  type: "maintenance";
  date: string;
  locationId: string;
  equipment: MaintenanceReportEquip[];
  flagCount: number;           // out-of-range fridge count (== list tempFlags)
}
```

- [ ] **Step 3: Add `listMaintenanceReportDates`**

Append. One bulk paginated read over all fridge temp items, grouped by date; plus a notes scan so note-only dates also appear.
```ts
/**
 * Hub list helper: every operational date in [dateFrom, dateTo] at the location
 * that has ≥1 fridge reading OR a maintenance note, with that date's
 * out-of-range fridge count. Newest first. One paginated completions scan
 * (avoids per-fridge N+1 and the 1000-row cap on wide windows).
 */
export async function listMaintenanceReportDates(
  service: SupabaseClient,
  locationId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Array<{ date: string; tempFlags: number }>> {
  const equipment = await loadEquipment(service, locationId);
  const fridges = equipment.filter((e) => e.kind === "fridge");

  // Map each fridge's opening/closing temp item ids → the fridge (for status).
  const fridgeByItem = new Map<string, Equipment>();
  for (const f of fridges) {
    if (f.openingTempItemId) fridgeByItem.set(f.openingTempItemId, f);
    if (f.closingTempItemId) fridgeByItem.set(f.closingTempItemId, f);
  }
  const itemIds = [...fridgeByItem.keys()];

  // date -> fridgeId -> readings[] (to compute per-fridge status that date)
  const byDate = new Map<string, Map<string, TempReading[]>>();

  if (itemIds.length) {
    const comps = await selectAllRows<{
      template_item_id: string; instance_id: string; count_value: number | null;
    }>((from, to) =>
      service.from("checklist_completions")
        .select("template_item_id, instance_id, count_value")
        .in("template_item_id", itemIds)
        .is("superseded_at", null).is("revoked_at", null)
        .order("instance_id", { ascending: true }).range(from, to),
    );
    const instIds = [...new Set(comps.map((c) => c.instance_id))];
    const dateById = new Map<string, string>();
    if (instIds.length) {
      const insts = await selectAllRows<{ id: string; date: string }>((from, to) =>
        service.from("checklist_instances").select("id, date")
          .eq("location_id", locationId).in("id", instIds)
          .gte("date", dateFrom).lte("date", dateTo)
          .order("id", { ascending: true }).range(from, to),
      );
      for (const i of insts) dateById.set(i.id, i.date);
    }
    for (const c of comps) {
      if (c.count_value === null) continue;
      const date = dateById.get(c.instance_id);
      if (!date) continue; // out of window or not this location
      const f = fridgeByItem.get(c.template_item_id);
      if (!f) continue;
      const phase: "AM" | "PM" = c.template_item_id === f.openingTempItemId ? "AM" : "PM";
      const dm = byDate.get(date) ?? new Map<string, TempReading[]>();
      const arr = dm.get(f.id) ?? [];
      arr.push({ date, phase, valueF: c.count_value, at: date, note: null });
      dm.set(f.id, arr);
      byDate.set(date, dm);
    }
  }

  // note-only dates: maintenance_notes in the window → their operational date
  const notes = await selectAllRows<{ created_at: string }>((from, to) =>
    service.from("maintenance_notes").select("created_at")
      .eq("location_id", locationId)
      .order("created_at", { ascending: true }).range(from, to),
  );
  for (const n of notes) {
    const date = n.created_at.slice(0, 10);
    if (date < dateFrom || date > dateTo) continue;
    if (!byDate.has(date)) byDate.set(date, new Map());
  }

  const safeOf = (f: Equipment) => f.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F;
  const fridgeById = new Map(fridges.map((f) => [f.id, f] as const));
  const out: Array<{ date: string; tempFlags: number }> = [];
  for (const [date, perFridge] of byDate) {
    let flags = 0;
    for (const [fid, readings] of perFridge) {
      const f = fridgeById.get(fid);
      if (!f) continue;
      if (computeFridgeStatus(readings, safeOf(f)) === "out_of_range") flags++;
    }
    out.push({ date, tempFlags: flags });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  return out;
}
```

- [ ] **Step 4: Add `loadMaintenanceReportDetail`**

Append. Per-equipment snapshot for one date (reuses `loadFridgeReadings`, filters to the date; merges that date's `maintenance_notes`).
```ts
/**
 * Hub detail: one date's per-equipment snapshot at a location — each piece of
 * equipment with that date's readings, status, and that date's maintenance
 * notes. (Fridge temp-item notes already appear under opening/closing; not
 * duplicated here.)
 */
export async function loadMaintenanceReportDetail(
  service: SupabaseClient,
  locationId: string,
  date: string,
): Promise<MaintenanceReportDetail> {
  const equipment = await loadEquipment(service, locationId);

  // maintenance_notes for this location on this date, with author names.
  const noteRows = await selectAllRows<{
    id: string; note: string; created_by: string; created_at: string; equipment_id: string | null; other_label: string | null;
  }>((from, to) =>
    service.from("maintenance_notes")
      .select("id, note, created_by, created_at, equipment_id, other_label")
      .eq("location_id", locationId)
      .gte("created_at", `${date}T00:00:00`).lte("created_at", `${date}T23:59:59.999`)
      .order("created_at", { ascending: false }).range(from, to),
  );
  const authorIds = [...new Set(noteRows.map((n) => n.created_by))];
  const nameById = new Map<string, string>();
  if (authorIds.length) {
    const { data: us } = await service.from("users").select("id, name").in("id", authorIds);
    for (const u of (us ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
  }
  const notesByEquip = new Map<string, MaintenanceNote[]>();
  for (const n of noteRows) {
    const key = n.equipment_id ?? "__other__";
    const arr = notesByEquip.get(key) ?? [];
    arr.push({ id: n.id, equipmentId: n.equipment_id, otherLabel: n.other_label, note: n.note, byName: nameById.get(n.created_by) ?? null, at: n.created_at });
    notesByEquip.set(key, arr);
  }

  const out: MaintenanceReportEquip[] = [];
  let flagCount = 0;
  for (const e of equipment) {
    const all = e.kind === "fridge" ? await loadFridgeReadings(service, e, date) : [];
    const readings = all.filter((r) => r.date === date);
    const safe = e.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F;
    const status = e.kind === "fridge" ? computeFridgeStatus(readings, safe) : "no_reading_today";
    if (status === "out_of_range") flagCount++;
    out.push({
      equipmentId: e.id, label: e.name, kind: e.kind, safeMaxF: e.safeMaxF,
      status, readings, notes: notesByEquip.get(e.id) ?? [],
    });
  }
  return { kind: "maintenance", type: "maintenance", date, locationId, equipment: out, flagCount };
}
```

- [ ] **Step 5: tsc + live smoke**

`npx tsc --noEmit` → PASS. Then `scripts/smoke-maint-loaders.ts` (delete after):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listMaintenanceReportDates, loadMaintenanceReportDetail } from "@/lib/maintenance";

async function main() {
  const sb = getServiceRoleClient();
  const { data: locs } = await sb.from("locations").select("id, code");
  if (!locs?.length) throw new Error("no locations");
  for (const loc of locs as Array<{ id: string; code: string }>) {
    const dates = await listMaintenanceReportDates(sb, loc.id, "2026-01-01", "2026-12-31");
    console.log(`[${loc.code}] dates-with-data=${dates.length}`, dates.slice(0, 3));
    if (dates.length) {
      const d = dates[0]!;
      const detail = await loadMaintenanceReportDetail(sb, loc.id, d.date);
      const oor = detail.equipment.filter((e) => e.status === "out_of_range").length;
      console.log(`  detail ${d.date}: equip=${detail.equipment.length} flagCount=${detail.flagCount} list.tempFlags=${d.tempFlags}`);
      console.log("  flagCount==list.tempFlags ===", detail.flagCount === d.tempFlags ? "PASS" : "FAIL");
      console.log("  detail.oor==flagCount ===", oor === detail.flagCount ? "PASS" : "FAIL");
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local scripts/smoke-maint-loaders.ts`. Expected: dates listed; `flagCount==list.tempFlags === PASS` and `detail.oor==flagCount === PASS` for a date with data.

- [ ] **Step 6: Delete smoke + commit**
```
rm scripts/smoke-maint-loaders.ts
git add lib/maintenance.ts
git commit -m "feat(maintenance-hub): date-scoped list + detail loaders + MaintenanceReportDetail type"
```

---

## Task 2: Hub composition — `ReportTypeKey`, list section, detail dispatch (`lib/reports-hub.ts`)

**Files:** Modify `lib/reports-hub.ts`.

- [ ] **Step 1: Ground-truth**

Re-read in `lib/reports-hub.ts`: the `ReportTypeKey` def (line ~16), `ReportListItem` + `ReportListItemInternal` (~31/84), the `listReports` body (the `want(t)` helper + the per-type sections + the final sort/strip, ~86–290), the `ReportDetail` union (~942) and `loadReportDetail` (~948). Confirm the `import` block at the top so you can add the maintenance imports.

- [ ] **Step 2: Extend `ReportTypeKey`**
```ts
export type ReportTypeKey = "opening" | "closing" | "am_prep" | "mid_day" | "cash" | "pm" | "maintenance";
```

- [ ] **Step 3: Import maintenance loaders + type**

Add to the imports from `@/lib/maintenance`:
```ts
import {
  listMaintenanceReportDates,
  loadMaintenanceReportDetail,
  type MaintenanceReportDetail,
} from "@/lib/maintenance";
```

- [ ] **Step 4: Add the maintenance list section in `listReports`**

After the existing per-type sections and BEFORE the final `items.sort(...)`, insert:
```ts
  // ── Maintenance (synthesized per-(location,date) digest; L3+ for all) ──
  if (want("maintenance")) {
    const dates = await listMaintenanceReportDates(service, f.locationId, f.dateFrom, f.dateTo);
    // Maintenance only carries temp-flag signals; if a non-temp signal filter
    // is active, maintenance rows can't satisfy it → emit none.
    const sf = f.signalFilters;
    const nonTempSignalActive = !!sf && (sf.underPar || sf.overPar || sf.skipped || sf.cashOver || sf.cashShort);
    if (!nonTempSignalActive) {
      for (const d of dates) {
        if (sf?.tempFlag && d.tempFlags === 0) continue; // temp-flag filter on → only flagged days
        items.push({
          type: "maintenance",
          id: `maintenance:${f.locationId}:${d.date}`,
          date: d.date,
          locationId: f.locationId,
          submitterName: null,
          submitterId: null,
          submittedAt: null,
          status: d.tempFlags > 0 ? "flags" : "ok",
          signalSummary: { underPar: 0, overPar: 0, skipped: 0, tempFlags: d.tempFlags, cashOverShortCents: null },
        });
      }
    }
  }
```
(Confirm the `ReportListItemInternal` field names — `submitterId`, `submittedAt` — against the actual type; match exactly. `status: "flags" | "ok"` are i18n-resolved in the UI via `reports.maint_status.*` keys added in Task 4.)

- [ ] **Step 5: Extend `ReportDetail` + `loadReportDetail`**

Add `MaintenanceReportDetail` to the union:
```ts
export type ReportDetail =
  | ChecklistReportDetail
  | OpeningReportDetail
  | CashReportDetail
  | PmReportDetail
  | MaintenanceReportDetail;
```
In `loadReportDetail`, before the final `return null;`, add:
```ts
  if (args.type === "maintenance") {
    // id shape: "maintenance:{locationId}:{date}". Re-verify the embedded
    // location matches the authorized location (defense in depth), then load.
    const parts = args.id.split(":");
    if (parts.length !== 3 || parts[0] !== "maintenance") return null;
    const [, embeddedLoc, date] = parts;
    if (embeddedLoc !== args.locationId) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return loadMaintenanceReportDetail(service, args.locationId, date);
  }
```

- [ ] **Step 6: tsc + live smoke**

`npx tsc --noEmit` → PASS. Then `scripts/smoke-hub-maint.ts` (delete after):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listReports, loadReportDetail, type Viewer } from "@/lib/reports-hub";

async function main() {
  const sb = getServiceRoleClient();
  const { data: locs } = await sb.from("locations").select("id, code");
  const loc = (locs ?? [])[0] as { id: string; code: string };
  const viewer: Viewer = { userId: "smoke", level: 10, role: "cgs" } as Viewer; // adjust to real Viewer shape if needed
  const items = await listReports(sb, { viewer, locationId: loc.id, dateFrom: "2026-01-01", dateTo: "2026-12-31", types: ["maintenance"] });
  console.log("maintenance rows:", items.length, items.slice(0, 2).map((i) => ({ id: i.id, date: i.date, status: i.status, flags: i.signalSummary?.tempFlags })));
  if (items.length) {
    const it = items[0]!;
    const detail = await loadReportDetail(sb, { viewer, type: "maintenance", id: it.id, locationId: loc.id });
    console.log("detail kind ===", detail?.kind === "maintenance" ? "PASS" : `FAIL ${detail?.kind}`);
    const bad = await loadReportDetail(sb, { viewer, type: "maintenance", id: `maintenance:WRONGLOC:${it.date}`, locationId: loc.id });
    console.log("mismatched-loc rejected ===", bad === null ? "PASS" : "FAIL");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
(First confirm the real `Viewer` shape from `lib/reports-hub.ts` and construct it correctly.) Run: `npx tsx --env-file=.env.local scripts/smoke-hub-maint.ts`. Expected: rows listed, `detail kind === PASS`, `mismatched-loc rejected === PASS`.

- [ ] **Step 7: Delete smoke + commit**
```
rm scripts/smoke-hub-maint.ts
git add lib/reports-hub.ts
git commit -m "feat(maintenance-hub): compose maintenance into listReports + loadReportDetail"
```

---

## Task 3: Search corpus — maintenance notes (`lib/reports-search.ts`)

**Files:** Modify `lib/reports-search.ts`.

- [ ] **Step 1: Ground-truth**

Re-read `lib/reports-search.ts`: `SearchCorpusField.fieldKey` union (~27), the `push(key, fieldKey, text)` helper + `buildSearchCorpus` body (~90), and confirm `selectAllRows` import. Note the corpus key convention `${type}:${id}` — for maintenance the item `id` is already `maintenance:{loc}:{date}`, so the key is just `it.id`.

- [ ] **Step 2: Extend the `fieldKey` union**
```ts
  fieldKey: "item" | "station" | "completer" | "note" | "cash_note" | "area_to_improve" | "pm_note" | "mvp_note" | "equipment" | "maintenance_note";
```

- [ ] **Step 3: Add the maintenance branch to `buildSearchCorpus`**

After the PM branch, add (ad-hoc maintenance notes only — fridge temp-item notes are already searchable under opening/closing; all maintenance content is L3+ so no redaction gate; reads are location-bound):
```ts
  // ── Maintenance (ad-hoc equipment notes; L3+, location-bound) ──
  const maintItems = args.items.filter((it) => it.type === "maintenance");
  if (maintItems.length) {
    // equipment id → label, for context on noted equipment
    const equip = await selectAllRows<{ id: string; name: string }>((from, to) =>
      service.from("maintenance_equipment").select("id, name")
        .eq("location_id", args.locationId).eq("active", true)
        .order("id", { ascending: true }).range(from, to),
    );
    const labelById = new Map(equip.map((e) => [e.id, e.name] as const));
    // all maintenance notes at the location (small table); bucket by date.
    const notes = await selectAllRows<{ note: string; created_at: string; equipment_id: string | null; other_label: string | null }>((from, to) =>
      service.from("maintenance_notes").select("note, created_at, equipment_id, other_label")
        .eq("location_id", args.locationId)
        .order("created_at", { ascending: true }).range(from, to),
    );
    const wantDate = new Set(maintItems.map((it) => it.date));
    for (const n of notes) {
      const date = n.created_at.slice(0, 10);
      if (!wantDate.has(date)) continue;
      const key = `maintenance:${args.locationId}:${date}`;
      const label = n.equipment_id ? labelById.get(n.equipment_id) ?? null : n.other_label;
      push(key, "equipment", label);
      push(key, "maintenance_note", n.note);
    }
  }
```

- [ ] **Step 4: tsc + live smoke**

`npx tsc --noEmit` → PASS. Then `scripts/smoke-maint-search.ts` (delete after):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listReports, type Viewer } from "@/lib/reports-hub";
import { buildSearchCorpus } from "@/lib/reports-search";

async function main() {
  const sb = getServiceRoleClient();
  const { data: locs } = await sb.from("locations").select("id, code");
  const loc = (locs ?? [])[0] as { id: string };
  const viewer = { userId: "smoke", level: 10, role: "cgs" } as Viewer;
  const items = await listReports(sb, { viewer, locationId: loc.id, dateFrom: "2026-01-01", dateTo: "2026-12-31", types: ["maintenance"] });
  const corpus = await buildSearchCorpus(sb, { viewer: { userId: "smoke", level: 10 }, locationId: loc.id, items });
  const maintKeys = [...corpus.keys()].filter((k) => k.startsWith("maintenance:"));
  console.log("maintenance corpus entries:", maintKeys.length);
  console.log("sample fields:", maintKeys.length ? corpus.get(maintKeys[0]!)?.fields.map((f) => f.fieldKey) : "(none — no maintenance notes in window)");
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run it. Expected: prints entry count (0 is acceptable if there are no maintenance notes in prod yet — the branch is exercised, just empty; if so, note it).

- [ ] **Step 5: Delete smoke + commit**
```
rm scripts/smoke-maint-search.ts
git add lib/reports-search.ts
git commit -m "feat(maintenance-hub): maintenance notes in the search corpus"
```

---

## Task 4: UI — filter chip, detail view, i18n

**Files:** Modify `app/(authed)/reports/page.tsx`; `app/(authed)/reports/[type]/[id]/page.tsx`; Create `components/reports-hub/MaintenanceReportDetail.tsx`; Modify `lib/i18n/en.json`, `lib/i18n/es.json`.

- [ ] **Step 1: Ground-truth**

Read `app/(authed)/reports/page.tsx` — the `ALL_TYPES` array (~26), the `allowedTypes` filter (~79), and how the type chips render (find where it maps `allowedTypes` to chips + the type label lookup, likely a `reports.type.<key>` i18n key). Read `app/(authed)/reports/[type]/[id]/page.tsx` — `VALID_TYPES` (~39), `isReportTypeKey`, the cash-level gate (~74), and the `detail.kind === …` render block (~113–130) + the detail-view imports (~34–37). Read one existing detail view (e.g. `components/reports-hub/ChecklistReportDetail.tsx`) for the component/styling/i18n pattern. Read existing `reports.type.*` keys in `lib/i18n/en.json`.

- [ ] **Step 2: List page — allow + chip**

In `app/(authed)/reports/page.tsx`:
```ts
const ALL_TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm", "maintenance"];
```
`allowedTypes` already filters only `cash` by level — `maintenance` passes through unfiltered (L3+ for all), so no change needed there beyond confirming maintenance isn't accidentally excluded. The chip rendering iterates `allowedTypes` with a `reports.type.<key>` label — adding the i18n key (Step 5) makes the chip appear automatically. Confirm and adjust only if the chip list is a hardcoded subset rather than `allowedTypes`.

- [ ] **Step 3: Detail page — VALID_TYPES + render branch**

In `app/(authed)/reports/[type]/[id]/page.tsx`:
```ts
const VALID_TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm", "maintenance"];
```
Add the import:
```ts
import { MaintenanceReportDetailView } from "@/components/reports-hub/MaintenanceReportDetail";
```
And in the render block, alongside the other `detail.kind === …` branches:
```tsx
      {detail.kind === "maintenance" ? (
        <MaintenanceReportDetailView detail={detail as MaintenanceReportDetail} language={lang} />
      ) : null}
```
(Import `MaintenanceReportDetail` type from `@/lib/reports-hub` or `@/lib/maintenance` — match where the other detail types are imported from. The cash-level gate at ~74 stays cash-only; maintenance needs no gate.)

- [ ] **Step 4: Create `MaintenanceReportDetailView`**

Create `components/reports-hub/MaintenanceReportDetail.tsx` — a Server Component mirroring the other detail views' style (read `ChecklistReportDetail.tsx` first for the exact tokens/layout). It renders: a header (date + `flagCount` summary), then a per-equipment list — each row: label, a status chip (`ok`/`out_of_range`/`no_reading_today` → `reports.maint_status.*`), the day's readings (`AM 38°F / PM 40°F`), and notes (text + `byName` + time). Use `serverT(language, key, params?)`; language-aware time via `lib/i18n/format.ts` if showing reading times. All strings via `reports.maint.*` i18n keys (no literals). Plain text rendering (no `dangerouslySetInnerHTML`). Example skeleton (adapt tokens to match siblings):
```tsx
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { MaintenanceReportDetail } from "@/lib/maintenance";

export function MaintenanceReportDetailView({ detail, language }: { detail: MaintenanceReportDetail; language: Language }) {
  const t = (k: TranslationKey, p?: Record<string, string | number>) => serverT(language, k, p);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-co-border bg-co-surface p-3">
        <div className="text-sm font-bold text-co-text">{t("reports.maint.title")}</div>
        <div className="text-xs text-co-text-muted">
          {detail.flagCount > 0 ? t("reports.maint.flag_summary", { n: detail.flagCount }) : t("reports.maint.all_ok")}
        </div>
      </div>
      {detail.equipment.map((e) => (
        <div key={e.equipmentId} className="rounded-xl border border-co-border bg-co-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-co-text">{e.label}</span>
            <span className="text-[11px] font-bold uppercase text-co-text-muted">
              {t(`reports.maint_status.${e.status}` as TranslationKey)}
            </span>
          </div>
          {e.readings.length ? (
            <div className="mt-1 text-xs text-co-text-muted">
              {e.readings.map((r) => `${r.phase} ${r.valueF}°F`).join(" · ")}
            </div>
          ) : null}
          {e.notes.map((n) => (
            <div key={n.id} className="mt-1 text-xs text-co-text">
              {n.note}{n.byName ? ` — ${n.byName}` : ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: i18n keys (EN + ES at parity)**

Add to `lib/i18n/en.json`:
```json
  "reports.type.maintenance": "Maintenance",
  "reports.maint_status.ok": "OK",
  "reports.maint_status.out_of_range": "Out of range",
  "reports.maint_status.no_reading_today": "No reading",
  "reports.maint.title": "Equipment log",
  "reports.maint.flag_summary": "{n} out of range",
  "reports.maint.all_ok": "All readings in range",
  "reports.maint_status_row.flags": "{n} flags",
  "reports.maint_status_row.ok": "OK"
```
Add the same keys to `lib/i18n/es.json` (tú-form / operational):
```json
  "reports.type.maintenance": "Mantenimiento",
  "reports.maint_status.ok": "OK",
  "reports.maint_status.out_of_range": "Fuera de rango",
  "reports.maint_status.no_reading_today": "Sin lectura",
  "reports.maint.title": "Registro de equipo",
  "reports.maint.flag_summary": "{n} fuera de rango",
  "reports.maint.all_ok": "Todas las lecturas en rango",
  "reports.maint_status_row.flags": "{n} alertas",
  "reports.maint_status_row.ok": "OK"
```
(If the list row's `status` string is rendered through a shared status formatter, map `"flags"`/`"ok"` to `reports.maint_status_row.*`. If the hub list renders raw `status` for other types too, follow that existing convention — confirm in `page.tsx` how `item.status` is displayed and wire maintenance consistently.)

- [ ] **Step 6: Build + parity**

`npx tsc --noEmit && npm run build` → both PASS.
i18n parity:
```
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=Object.keys(es);const m=a.filter(k=>!b.includes(k)).concat(b.filter(k=>!a.includes(k)));console.log(m.length?'MISSING: '+m.join(', '):'PARITY OK ('+a.length+')')"
```
Expected: `PARITY OK`.

- [ ] **Step 7: Commit**
```
git add "app/(authed)/reports/page.tsx" "app/(authed)/reports/[type]/[id]/page.tsx" components/reports-hub/MaintenanceReportDetail.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(maintenance-hub): filter chip + detail view + i18n"
```

---

## Final verification

- [ ] **Full gate:** `npx tsc --noEmit && npm run build` clean; i18n `PARITY OK`.
- [ ] **No smokes committed:** `git status` shows no `scripts/smoke-*.ts`.
- [ ] **T0 review (CC):** maintenance detail is location-bound (id embeds + re-checks `locationId`); list rows are L3+ (no accidental gate); search reads location-bound; no write path / no audit / no migration; no `dangerouslySetInnerHTML`; the other six types' behavior unchanged.
- [ ] **Open PR** for Juan's preview smoke: on the branch preview, `/reports` → filter to **Maintenance** → confirm per-day rows (flag counts), open one → per-equipment day snapshot; run a search query matching a known maintenance note → the maintenance row appears.

## Spec coverage map

| Spec requirement | Task |
|---|---|
| `"maintenance"` ReportTypeKey; synthesized per-(loc,date) row; every date with data; L3+ | Task 2 (+1) |
| Per-equipment day drill-in (`kind:"maintenance"`), reuse fridge logic | Tasks 1, 4 |
| `listMaintenanceReportDates` + `loadMaintenanceReportDetail` in maintenance.ts | Task 1 |
| Hub list section + `loadReportDetail` branch + id parse/verify | Task 2 |
| Search corpus (maintenance notes; no redaction; location-bound) | Task 3 |
| Filter chip + detail view + i18n EN/ES parity | Task 4 |
| Signal-filter interaction (tempFlag includes; others exclude) | Task 2 (Step 4) |
| Security (gate param via hub + bind record + id loc cross-check) | Tasks 2, 4, Final |
| Verification smokes | Tasks 1,2,3 + Final |

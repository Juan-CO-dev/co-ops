# Maintenance Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/maintenance` read surface that strings together the fridge temps already captured at opening (AM) + closing (PM) into per-fridge intraday + day-to-day timelines with >41°F flagging, plus an on-demand maintenance-note log — unified by a seeded equipment registry, with consistent equipment naming across reports.

**Architecture:** Two new tables (`maintenance_equipment` registry + `maintenance_notes`); the temps are READ from existing `checklist_completions.count_value`. A registry seed maps each fridge to its opening + closing temp `template_item_id` per location. The page has an overview (health board) + a rich per-equipment drill-in. No new temp capture.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase Postgres 17 (custom JWT/RLS), Supabase MCP `apply_migration`.

**Spec:** `docs/superpowers/specs/2026-06-16-maintenance-log-design.md`

**Verification model (no unit-test framework):** each task ends with `npm run typecheck` + (UI) `npm run build`, plus a throwaway `tsx` smoke for logic, then a commit. Smokes run `npx tsx --env-file=.env.local scripts/<smoke>.ts` and self-clean. Branch base: current `main` (it has `ActionButton`). Prod ref `bgcvurheqzylyfehqgzh`; locations MEP `54ce1029-400e-4a92-9c2b-0ccb3b031f0a`, EM `d2cced11-b167-49fa-bab6-86ec9bf4ff09`.

**Threshold:** fridges out-of-range when `count_value > 41` (°F).

---

## The fridge mapping (load-bearing reference for Tasks 2 & 3)

Each fridge → its OPENING temp item `(station, label)` and CLOSING temp item `(station, label)`. The opening label "Station fridge holding temp (≤41°F)" is reused across 3 stations, so opening items MUST be resolved by **(station, label)**, not label alone.

| Canonical name | Opening (station · label) | Closing (station · label) |
|---|---|---|
| Walk-In | `Walk Ins Station` · `Station fridge holding temp (≤41°F)` | `Walk Ins Station` · `Walk Ins station fridge temp log` |
| 3-Door | `Prep Area` · `3-door fridge holding temp (≤41°F)` | `Prep Area` · `3-door fridge temp log` |
| Sauce | `Prep Fridge` · `Sauce fridge holding temp (≤41°F)` | `Prep Fridge` · `Sauce fridge temp log` |
| Deli Display | `Expo Station` · `Deli display fridge holding temp (≤41°F)` | `Expo Station` · `Deli display fridge temp log` |
| Crunchy Boi | `Crunchy Boi Station` · `Station fridge holding temp (≤41°F)` | `Crunchy Boi Station` · `Crunchy Boi station fridge temp log` |
| FOH Drinks | `Front of House Open` · `FOH drinks fridge holding temp (≤41°F)` | `Clean front of house` · `FOH drinks fridge temp log` |
| Back-Line Drinks | `Back Line Open` · `Back-line drinks fridge holding temp (≤41°F)` | `Shut Down Back Line` · `Back-line drinks fridge temp log` |
| 3rd-Party | `3rd Party Station` · `Station fridge holding temp (≤41°F)` | `3rd Party Station` · `3rd Party station fridge temp log` |

Non-temp equipment to also seed (kind `equipment`, no temp links): **Oven**, **Fryer** (both appear in opening checks). Anything else is covered by the note form's "Other." Confirm the full list with Juan during smoke; more can be added later (it's just seed rows).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/NNNN_maintenance_tables.sql` | `maintenance_equipment` + `maintenance_notes` + RLS |
| `scripts/seed-maintenance-equipment.ts` | resolve opening/closing temp item ids per location → insert registry |
| `supabase/migrations/NNNN_standardize_equipment_labels.sql` | label-only consistent-naming pass (en + es) |
| `lib/maintenance.ts` | types, loaders (overview + detail), `addMaintenanceNote` |
| `app/api/maintenance/note/route.ts` | POST a maintenance note |
| `app/(authed)/maintenance/page.tsx` | server loader; overview vs `?equipment=` detail |
| `app/(authed)/maintenance/maintenance-client.tsx` | overview filters + add-note form |
| `components/maintenance/EquipmentOverview.tsx` | health-board cards |
| `components/maintenance/EquipmentDetail.tsx` | rich drill-in |
| `components/maintenance/TempTrendChart.tsx` | inline-SVG trend (no lib) |
| `app/(authed)/dashboard/page.tsx` (modify) | Maintenance nav entry |
| `lib/i18n/{en,es}.json` (modify) | `maintenance.*` keys |

---

## Task 1: Schema — `maintenance_equipment` + `maintenance_notes`

**Files:** Create `supabase/migrations/0070_maintenance_tables.sql` (use next free number — highest is 0069); apply via MCP `apply_migration` (name `maintenance_tables`).

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0070_maintenance_tables
-- Applied via Supabase MCP apply_migration on <date>.
-- Canonical reference: lib/maintenance.ts; docs/.../2026-06-16-maintenance-log-design.md
-- Maintenance Log (Wave 2 #2) — equipment registry + on-demand note log.

CREATE TABLE public.maintenance_equipment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id          uuid NOT NULL REFERENCES public.locations(id),
  name                 text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('fridge','equipment')),
  opening_temp_item_id uuid REFERENCES public.checklist_template_items(id),
  closing_temp_item_id uuid REFERENCES public.checklist_template_items(id),
  safe_max_f           integer,
  sort_order           integer NOT NULL DEFAULT 0,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_equipment_location ON public.maintenance_equipment (location_id) WHERE active;

CREATE TABLE public.maintenance_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES public.locations(id),
  equipment_id uuid REFERENCES public.maintenance_equipment(id),
  other_label  text,
  note         text NOT NULL,
  created_by   uuid NOT NULL REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_notes_location_created ON public.maintenance_notes (location_id, created_at DESC);

ALTER TABLE public.maintenance_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_notes ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated at the location reads (Juan: "anyone"). Level >= 3 (shift staff).
CREATE POLICY maintenance_equipment_read ON public.maintenance_equipment FOR SELECT
  USING (public.current_user_role_level() >= 3 AND location_id = ANY (public.current_user_locations()));
CREATE POLICY maintenance_equipment_no_user_write ON public.maintenance_equipment FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY maintenance_notes_read ON public.maintenance_notes FOR SELECT
  USING (public.current_user_role_level() >= 3 AND location_id = ANY (public.current_user_locations()));
CREATE POLICY maintenance_notes_insert ON public.maintenance_notes FOR INSERT
  WITH CHECK (public.current_user_role_level() >= 3 AND location_id = ANY (public.current_user_locations()));
CREATE POLICY maintenance_notes_no_user_update ON public.maintenance_notes FOR UPDATE USING (false);
CREATE POLICY maintenance_notes_no_user_delete ON public.maintenance_notes FOR DELETE USING (false);
```

> NOTE: confirm `current_user_locations()` returns `uuid[]` (use `= ANY(...)`) vs `setof uuid` (use `IN (SELECT ...)`) via `pg_get_function_result('current_user_locations'::regproc)` BEFORE applying — migration 0067 used `= ANY`. The `_no_user_write FOR ALL USING(false)` on equipment is intentional (registry is service-role/seed-only) — note `FOR ALL ... USING(false)` here is safe because there's NO accompanying permissive write policy (the AGENTS `FOR ALL` footgun is about OR-stacking with a permissive policy; there's none here). If you prefer, split into explicit no-insert/update/delete to match the house style.

- [ ] **Step 2: Apply via MCP + capture the file.** Apply, save the SQL to `supabase/migrations/0070_maintenance_tables.sql`.
- [ ] **Step 3: Verify** — `execute_sql`: `select count(*) from information_schema.columns where table_name='maintenance_equipment';` (10) and `... = 'maintenance_notes';` (7); `select tablename, count(*) from pg_policies where tablename like 'maintenance_%' group by 1;`.
- [ ] **Step 4: Commit** — `git add supabase/migrations/0070_maintenance_tables.sql && git commit -m "feat(maintenance): equipment + notes tables + RLS (migration 0070)"`

---

## Task 2: Seed the equipment registry

**Files:** Create `scripts/seed-maintenance-equipment.ts`. Run via `npx tsx --env-file=.env.local`.

Resolves the opening + closing temp item ids per fridge per location (using the §"fridge mapping" table) and inserts registry rows. Idempotent (skip if a row with the same `location_id + name` exists).

- [ ] **Step 1: Write the seed**

```ts
import { getServiceRoleClient } from "../lib/supabase-server";
const sb = getServiceRoleClient();
const LOCATIONS = ["54ce1029-400e-4a92-9c2b-0ccb3b031f0a", "d2cced11-b167-49fa-bab6-86ec9bf4ff09"];

// canonical name → opening (station,label) + closing (station,label)
const FRIDGES: Array<{ name: string; openStation: string; openLabel: string; closeStation: string; closeLabel: string }> = [
  { name: "Walk-In Fridge", openStation: "Walk Ins Station", openLabel: "Station fridge holding temp (≤41°F)", closeStation: "Walk Ins Station", closeLabel: "Walk Ins station fridge temp log" },
  { name: "3-Door Fridge", openStation: "Prep Area", openLabel: "3-door fridge holding temp (≤41°F)", closeStation: "Prep Area", closeLabel: "3-door fridge temp log" },
  { name: "Sauce Fridge", openStation: "Prep Fridge", openLabel: "Sauce fridge holding temp (≤41°F)", closeStation: "Prep Fridge", closeLabel: "Sauce fridge temp log" },
  { name: "Deli Display Fridge", openStation: "Expo Station", openLabel: "Deli display fridge holding temp (≤41°F)", closeStation: "Expo Station", closeLabel: "Deli display fridge temp log" },
  { name: "Crunchy Boi Fridge", openStation: "Crunchy Boi Station", openLabel: "Station fridge holding temp (≤41°F)", closeStation: "Crunchy Boi Station", closeLabel: "Crunchy Boi station fridge temp log" },
  { name: "FOH Drinks Fridge", openStation: "Front of House Open", openLabel: "FOH drinks fridge holding temp (≤41°F)", closeStation: "Clean front of house", closeLabel: "FOH drinks fridge temp log" },
  { name: "Back-Line Drinks Fridge", openStation: "Back Line Open", openLabel: "Back-line drinks fridge holding temp (≤41°F)", closeStation: "Shut Down Back Line", closeLabel: "Back-line drinks fridge temp log" },
  { name: "3rd-Party Fridge", openStation: "3rd Party Station", openLabel: "Station fridge holding temp (≤41°F)", closeStation: "3rd Party Station", closeLabel: "3rd Party station fridge temp log" },
];
const EQUIPMENT = ["Oven", "Fryer"];

async function templateId(locationId: string, type: "opening" | "closing"): Promise<string | null> {
  const { data } = await sb.from("checklist_templates").select("id")
    .eq("location_id", locationId).eq("type", type).eq("active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  return data?.id ?? null;
}
async function itemId(templateId: string, station: string, label: string): Promise<string | null> {
  const { data } = await sb.from("checklist_template_items").select("id")
    .eq("template_id", templateId).eq("station", station).eq("label", label).eq("active", true)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

(async () => {
  for (const loc of LOCATIONS) {
    const openTmpl = await templateId(loc, "opening");
    const closeTmpl = await templateId(loc, "closing");
    let order = 0;
    for (const f of FRIDGES) {
      const { data: exists } = await sb.from("maintenance_equipment").select("id").eq("location_id", loc).eq("name", f.name).maybeSingle<{ id: string }>();
      if (exists) { console.log(`skip ${loc} ${f.name}`); order++; continue; }
      const openId = openTmpl ? await itemId(openTmpl, f.openStation, f.openLabel) : null;
      const closeId = closeTmpl ? await itemId(closeTmpl, f.closeStation, f.closeLabel) : null;
      if (!openId || !closeId) console.warn(`  ⚠ ${f.name} @ ${loc}: open=${!!openId} close=${!!closeId} (unmapped temp item)`);
      const { error } = await sb.from("maintenance_equipment").insert({
        location_id: loc, name: f.name, kind: "fridge",
        opening_temp_item_id: openId, closing_temp_item_id: closeId, safe_max_f: 41, sort_order: order++,
      });
      if (error) console.error(`  ✗ ${f.name}: ${error.message}`); else console.log(`  ✓ ${f.name} (open=${!!openId} close=${!!closeId})`);
    }
    for (const name of EQUIPMENT) {
      const { data: exists } = await sb.from("maintenance_equipment").select("id").eq("location_id", loc).eq("name", name).maybeSingle<{ id: string }>();
      if (exists) { order++; continue; }
      await sb.from("maintenance_equipment").insert({ location_id: loc, name, kind: "equipment", safe_max_f: null, sort_order: order++ });
      console.log(`  ✓ ${name}`);
    }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 2: Run it** — `npx tsx --env-file=.env.local scripts/seed-maintenance-equipment.ts`. Expect ✓ for all 8 fridges × 2 locations with `open=true close=true` (NO unmapped warnings — if any warn, the label/station in the mapping table is stale; fix it by querying the live item and correcting the constant). Then `git add scripts/seed-maintenance-equipment.ts`.
- [ ] **Step 3: Verify** — `execute_sql`: `select location_id, name, kind, opening_temp_item_id is not null o, closing_temp_item_id is not null c from maintenance_equipment order by location_id, sort_order;` — 8 fridges (o,c both true) + 2 equipment per location.
- [ ] **Step 4: Commit** — `git commit -m "feat(maintenance): seed equipment registry (fridge temp-item mapping + equipment)"`

---

## Task 3: Standardize equipment labels (consistent naming)

**Files:** Create `supabase/migrations/0071_standardize_equipment_labels.sql`; apply via MCP.

Label-only UPDATEs so each fridge's opening + closing item carries the canonical fridge name. Preserves `template_item_id` (history intact). Also updates `translations.es.label`.

- [ ] **Step 1: Write the migration** — for EACH fridge, update its opening item label → `"<Name> — holding temp (≤41°F)"` and closing item label → `"<Name> — temp log"`, matched by the SAME `(template_id, station, old_label)` keys from the mapping table, scoped to active opening/closing templates at both locations. Spanish: `translations = jsonb_set(coalesce(translations,'{}'), '{es,label}', '"<ES label>"')`. Example (repeat per fridge, both locations — the migration is mechanical UPDATEs):

```sql
-- Walk-In, opening
UPDATE checklist_template_items i SET
  label = 'Walk-In Fridge — holding temp (≤41°F)',
  translations = jsonb_set(coalesce(i.translations,'{}'::jsonb), '{es,label}', '"Refrigerador Walk-In — temperatura (≤41°F)"')
FROM checklist_templates t
WHERE i.template_id = t.id AND t.type='opening' AND t.active
  AND i.station = 'Walk Ins Station' AND i.label = 'Station fridge holding temp (≤41°F)';
-- Walk-In, closing
UPDATE checklist_template_items i SET
  label = 'Walk-In Fridge — temp log',
  translations = jsonb_set(coalesce(i.translations,'{}'::jsonb), '{es,label}', '"Refrigerador Walk-In — registro de temp"')
FROM checklist_templates t
WHERE i.template_id = t.id AND t.type='closing' AND t.active
  AND i.station = 'Walk Ins Station' AND i.label = 'Walk Ins station fridge temp log';
-- ... repeat for the other 7 fridges using the mapping table's old (station,label) keys ...
```

> IMPORTANT: this migration must run BEFORE or be reconciled with the seed (Task 2), because the seed resolves items by their ORIGINAL labels. Order: **run Task 2 seed first (maps by original labels), THEN Task 3 relabels.** The registry stores `template_item_id` (stable), so relabeling after seeding is safe — the ids don't change. Put a comment in the migration noting this ordering.

- [ ] **Step 2: Apply + capture the file.**
- [ ] **Step 3: Verify** — `execute_sql`: confirm the 16 opening + 16 closing items (8×2 locations) now carry canonical names; confirm the registry's `opening_temp_item_id`/`closing_temp_item_id` still resolve (ids unchanged): `select e.name, oi.label open_label, ci.label close_label from maintenance_equipment e left join checklist_template_items oi on oi.id=e.opening_temp_item_id left join checklist_template_items ci on ci.id=e.closing_temp_item_id where e.kind='fridge' order by e.location_id, e.sort_order;`
- [ ] **Step 4: Commit** — `git add supabase/migrations/0071_standardize_equipment_labels.sql && git commit -m "feat(maintenance): standardize fridge names across opening + closing (label-only)"`

---

## Task 4: `lib/maintenance.ts` — types + loaders + note writer

**Files:** Create `lib/maintenance.ts`. READ `lib/prep.ts` `loadMidDayPrepDashboardState` + `finalizeMidDayPhase2` for the loader + `audit()` shapes.

- [ ] **Step 1: Write it** (types + `MAINTENANCE_BASE_LEVEL`, `computeFridgeStatus`, `loadEquipment`, `loadMaintenanceOverview`, `loadEquipmentDetail`, `addMaintenanceNote`):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleCode } from "@/lib/roles";
import { audit } from "@/lib/audit";

export const MAINTENANCE_BASE_LEVEL = 3;
export const FRIDGE_DEFAULT_SAFE_MAX_F = 41;

export interface MaintActor { userId: string; role: RoleCode; level: number }
export interface Equipment {
  id: string; name: string; kind: "fridge" | "equipment";
  openingTempItemId: string | null; closingTempItemId: string | null; safeMaxF: number | null;
}
/** One temp reading: which session (AM/PM), the value, when. */
export interface TempReading { date: string; phase: "AM" | "PM"; valueF: number; at: string; note: string | null }
export interface MaintenanceNote { id: string; equipmentId: string | null; otherLabel: string | null; note: string; byName: string | null; at: string }

export type FridgeStatus = "ok" | "out_of_range" | "no_reading_today";
export function computeFridgeStatus(todaysReadings: TempReading[], safeMaxF: number): FridgeStatus {
  if (todaysReadings.length === 0) return "no_reading_today";
  return todaysReadings.some((r) => r.valueF > safeMaxF) ? "out_of_range" : "ok";
}

const EQUIP_ROW = "id, name, kind, opening_temp_item_id, closing_temp_item_id, safe_max_f, sort_order";
function rowToEquip(r: Record<string, unknown>): Equipment {
  return { id: r.id as string, name: r.name as string, kind: r.kind as "fridge" | "equipment",
    openingTempItemId: (r.opening_temp_item_id as string | null) ?? null,
    closingTempItemId: (r.closing_temp_item_id as string | null) ?? null,
    safeMaxF: (r.safe_max_f as number | null) ?? null };
}

export async function loadEquipment(service: SupabaseClient, locationId: string): Promise<Equipment[]> {
  const { data, error } = await service.from("maintenance_equipment").select(EQUIP_ROW)
    .eq("location_id", locationId).eq("active", true).order("sort_order", { ascending: true });
  if (error) throw new Error(`loadEquipment: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToEquip);
}

/**
 * Pull the temp readings for a fridge: the live completions of its opening
 * (AM) + closing (PM) temp items, across the date window, as TempReadings.
 */
async function loadFridgeReadings(
  service: SupabaseClient, equip: Equipment, sinceDate: string,
): Promise<TempReading[]> {
  const itemIds = [equip.openingTempItemId, equip.closingTempItemId].filter((v): v is string => !!v);
  if (itemIds.length === 0) return [];
  // completions join to instances for the operational date; AM if the item is the opening one.
  const { data, error } = await service
    .from("checklist_completions")
    .select("template_item_id, count_value, completed_at, notes, checklist_instances!inner(date)")
    .in("template_item_id", itemIds)
    .is("superseded_at", null).is("revoked_at", null)
    .gte("checklist_instances.date", sinceDate);
  if (error) throw new Error(`loadFridgeReadings: ${error.message}`);
  const out: TempReading[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const val = r.count_value as number | null;
    if (val === null) continue;
    const inst = r.checklist_instances as { date: string } | null;
    out.push({
      date: inst?.date ?? (r.completed_at as string).slice(0, 10),
      phase: (r.template_item_id as string) === equip.openingTempItemId ? "AM" : "PM",
      valueF: val, at: r.completed_at as string, note: (r.notes as string | null) ?? null,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

export interface OverviewFridge { equip: Equipment; latest: TempReading | null; status: FridgeStatus; spark: number[] }
export interface MaintenanceOverview {
  fridges: OverviewFridge[];
  equipment: Array<{ equip: Equipment; lastNote: MaintenanceNote | null }>;
}

export async function loadMaintenanceOverview(
  service: SupabaseClient, args: { locationId: string; today: string; sinceDate: string },
): Promise<MaintenanceOverview> {
  const equipment = await loadEquipment(service, args.locationId);
  const fridges: OverviewFridge[] = [];
  for (const e of equipment.filter((x) => x.kind === "fridge")) {
    const readings = await loadFridgeReadings(service, e, args.sinceDate);
    const todays = readings.filter((r) => r.date === args.today);
    const latest = readings.length ? readings[readings.length - 1]! : null;
    fridges.push({ equip: e, latest, status: computeFridgeStatus(todays, e.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F), spark: readings.slice(-12).map((r) => r.valueF) });
  }
  // last note per non-fridge equipment
  const equip: MaintenanceOverview["equipment"] = [];
  for (const e of equipment.filter((x) => x.kind === "equipment")) {
    const { data } = await service.from("maintenance_notes").select("id, note, created_by, created_at")
      .eq("equipment_id", e.id).order("created_at", { ascending: false }).limit(1).maybeSingle<Record<string, unknown>>();
    let lastNote: MaintenanceNote | null = null;
    if (data) {
      const nm = data.created_by ? (await service.from("users").select("name").eq("id", data.created_by as string).maybeSingle<{ name: string }>()).data?.name ?? null : null;
      lastNote = { id: data.id as string, equipmentId: e.id, otherLabel: null, note: data.note as string, byName: nm, at: data.created_at as string };
    }
    equip.push({ equip: e, lastNote });
  }
  // out-of-range fridges first
  fridges.sort((a, b) => (a.status === "out_of_range" ? -1 : 1) - (b.status === "out_of_range" ? -1 : 1));
  return { fridges, equipment: equip };
}

export interface EquipmentDetail {
  equip: Equipment; readings: TempReading[];
  stats: { latest: number | null; amPmSwingToday: number | null; min: number | null; max: number | null; avg: number | null; outOfRangeCount: number } | null;
  notes: MaintenanceNote[]; // maintenance_notes + checklist notes merged, newest first
}

export async function loadEquipmentDetail(
  service: SupabaseClient, args: { equipmentId: string; today: string; sinceDate: string },
): Promise<EquipmentDetail | null> {
  const { data: eRow } = await service.from("maintenance_equipment").select(EQUIP_ROW).eq("id", args.equipmentId).maybeSingle<Record<string, unknown>>();
  if (!eRow) return null;
  const equip = rowToEquip(eRow);
  const readings = equip.kind === "fridge" ? await loadFridgeReadings(service, equip, args.sinceDate) : [];
  let stats: EquipmentDetail["stats"] = null;
  if (readings.length) {
    const vals = readings.map((r) => r.valueF);
    const todays = readings.filter((r) => r.date === args.today);
    const am = todays.find((r) => r.phase === "AM")?.valueF ?? null;
    const pm = todays.find((r) => r.phase === "PM")?.valueF ?? null;
    const safe = equip.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F;
    stats = {
      latest: vals[vals.length - 1] ?? null,
      amPmSwingToday: am !== null && pm !== null ? pm - am : null,
      min: Math.min(...vals), max: Math.max(...vals),
      avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
      outOfRangeCount: vals.filter((v) => v > safe).length,
    };
  }
  // maintenance notes for this equipment
  const { data: notesRows } = await service.from("maintenance_notes").select("id, note, created_by, created_at")
    .eq("equipment_id", equip.id).order("created_at", { ascending: false });
  const ids = [...new Set(((notesRows ?? []) as Array<{ created_by: string }>).map((r) => r.created_by))];
  const nameById = new Map<string, string>();
  if (ids.length) for (const u of (((await service.from("users").select("id, name").in("id", ids)).data) ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
  const notes: MaintenanceNote[] = ((notesRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string, equipmentId: equip.id, otherLabel: null, note: r.note as string,
    byName: nameById.get(r.created_by as string) ?? null, at: r.created_at as string,
  }));
  // checklist notes on this fridge's temp items → also append (as read-only history)
  const itemIds = [equip.openingTempItemId, equip.closingTempItemId].filter((v): v is string => !!v);
  if (itemIds.length) {
    const { data: cNotes } = await service.from("checklist_completions").select("notes, completed_at")
      .in("template_item_id", itemIds).is("superseded_at", null).is("revoked_at", null).not("notes", "is", null).gte("completed_at", args.sinceDate);
    for (const r of (cNotes ?? []) as Array<{ notes: string | null; completed_at: string }>) {
      if (r.notes && r.notes.trim()) notes.push({ id: `c-${r.completed_at}`, equipmentId: equip.id, otherLabel: null, note: r.notes, byName: null, at: r.completed_at });
    }
    notes.sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  return { equip, readings, stats, notes };
}

export async function addMaintenanceNote(
  service: SupabaseClient,
  args: { locationId: string; actor: MaintActor; equipmentId: string | null; otherLabel: string | null; note: string },
): Promise<{ id: string }> {
  const { data, error } = await service.from("maintenance_notes").insert({
    location_id: args.locationId, equipment_id: args.equipmentId,
    other_label: args.equipmentId ? null : (args.otherLabel ?? null), note: args.note, created_by: args.actor.userId,
  }).select("id").single<{ id: string }>();
  if (error) throw new Error(`addMaintenanceNote: ${error.message}`);
  void audit({ actorId: args.actor.userId, actorRole: args.actor.role, action: "maintenance.note", resourceTable: "maintenance_notes", resourceId: data.id, metadata: { equipment_id: args.equipmentId, other: args.otherLabel }, ipAddress: null, userAgent: null });
  return { id: data.id };
}
```
> Verify the embedded-select `checklist_instances!inner(date)` works under service-role (per AGENTS "PostgREST embedded-select can be fragile" — if it errors, fall back to a two-step: load completions then load their instances' dates by id). Verify `audit()` arg shape against `lib/audit.ts`.

- [ ] **Step 2: typecheck** → clean.
- [ ] **Step 3: Smoke** (`scripts/smoke-maintenance.ts`, run, delete): seed-independent — uses MEP, a far-future test date, a real fridge equipment row (query one), inserts two completions (one ≤41, one >41) against its opening+closing items on the test date, asserts `loadEquipmentDetail` returns 2 readings + `outOfRangeCount===1` + status logic via `computeFridgeStatus`; inserts a maintenance note, asserts it appears. Clean up. (Mirror the cash smokes' setup/cleanup.)
- [ ] **Step 4: Commit** — `rm` the smoke; `git add lib/maintenance.ts && git commit -m "feat(maintenance): types + loaders (overview/detail) + addMaintenanceNote"`

---

## Task 5: `POST /api/maintenance/note`

**Files:** Create `app/api/maintenance/note/route.ts`. Mirror `app/api/prep/mid-day/route.ts`.

- [ ] **Step 1:** auth (`requireSession`) → parse → validate (`locationId` uuid, `note` non-empty string ≤2000, `equipmentId` uuid|null, `otherLabel` string|null) → `lockLocationContext` → `ctx.level >= MAINTENANCE_BASE_LEVEL` (else 403) → `addMaintenanceNote(service, {...})` → `jsonOk({ id })`. Map errors like the mid-day route.
- [ ] **Step 2:** `npm run typecheck` + `npm run build` clean. **Commit** `feat(maintenance): POST /api/maintenance/note`.

---

## Task 6: i18n `maintenance.*` keys

**Files:** Modify `lib/i18n/{en,es}.json`. Add (en/es, identical key sets) keys for: nav label, page titles (overview/detail), status chips (ok/out_of_range/no_reading), the AM/PM labels, stat labels (latest/swing/min/max/avg/out-of-range count), the add-note form (title, equipment label, "Other", note placeholder, submit, submitting), empty states, and the date-window label. Use the `maintenance.*` namespace. typecheck + build clean. **Commit** `feat(i18n): maintenance.* keys (en + es)`.

---

## Task 7: `TempTrendChart` (inline SVG)

**Files:** Create `components/maintenance/TempTrendChart.tsx`. A client component taking `{ readings: {valueF:number; at:string; phase:"AM"|"PM"}[]; safeMaxF:number }` → a small responsive inline-SVG line chart: a polyline of values scaled to min/max, a dashed horizontal line at `safeMaxF`, points above `safeMaxF` colored `co-cta` (red), others `co-success`. No chart library. Accessible `<title>`. typecheck + build clean. **Commit**.

---

## Task 8 + 9: `EquipmentOverview` + `EquipmentDetail` components

**Files:** Create `components/maintenance/EquipmentOverview.tsx` and `EquipmentDetail.tsx`. Server components (take pre-loaded data, render). Mirror existing tile/section styling (`rounded-xl border-2 border-co-border bg-co-surface`), use `formatTime`/`formatDateLabel`, status chip colors (ok=`co-success`, out_of_range=`co-cta`, no_reading=`co-text-muted`). `EquipmentOverview`: a card per fridge (name, status chip, today AM→PM, mini-sparkline via `TempTrendChart` small) + each links to `/maintenance?equipment=<id>`; then non-fridge equipment rows (name + last note). `EquipmentDetail`: header (name/status/safe range), the `TempTrendChart` (full), the stats row, the readings timeline (day rows, AM/PM, out-of-range colored, inline notes), and the merged notes history. Each: typecheck + build clean, **commit**.

---

## Task 10: `/maintenance` page + client

**Files:** Create `app/(authed)/maintenance/page.tsx` + `app/(authed)/maintenance/maintenance-client.tsx`. Overwrite the `/maintenance` PlaceholderCard stub (confirm path — likely `app/(authed)/maintenance/page.tsx` or `app/maintenance/page.tsx`; delete the stub if at a colliding path).

- [ ] **Step 1:** Server page: `requireSessionFromHeaders("/maintenance")`, resolve `?location` (default first accessible — mirror dashboard's location resolution) + `lockLocationContext`, gate `level >= MAINTENANCE_BASE_LEVEL`. Compute `today` (NY) + `sinceDate` (today − 14d). If `?equipment=<id>` → `loadEquipmentDetail` → render `<EquipmentDetail>`. Else → `loadMaintenanceOverview` → render `<EquipmentOverview>` + the add-note client form (`maintenance-client.tsx` — equipment dropdown from `loadEquipment` + "Other" + note → POST `/api/maintenance/note` → `router.refresh()`). Include `DashboardBackLink`.
- [ ] **Step 2:** typecheck + build clean (watch the Suspense/prerender rule only if a client child reads `useSearchParams`; the page reads `searchParams` prop server-side, so fine). **Commit** `feat(maintenance): /maintenance overview + rich equipment detail + add-note`.

---

## Task 11: Dashboard nav entry

**Files:** Modify `app/(authed)/dashboard/page.tsx`. Add a small nav entry/section (a labeled `ActionLink` to `/maintenance?location=<id>`, e.g. a "Maintenance" link under a "Tools"/nav heading, distinct from the report tiles) visible to all authenticated users (level ≥ 3). Keep it minimal — it's the seed of the future nav-hub. typecheck + build clean. **Commit** `feat(maintenance): dashboard nav entry`.

---

## Task 12: Full smoke + ship

- [ ] **Step 1:** Throwaway `scripts/smoke-maintenance-fullflow.ts` — isolated test date at MEP: write opening+closing temp completions for ≥2 fridges across 2 dates (one out-of-range), call `loadMaintenanceOverview` → assert fridges present, out-of-range one flagged + sorted first; call `loadEquipmentDetail` on it → assert readings count, stats (min/max/avg/outOfRangeCount), AM/PM. Add a note → assert it surfaces. Clean up. Run → ✅, then `rm`.
- [ ] **Step 2:** Final gates — `npm run typecheck`, `npm run build`, `npx eslint <touched files>` (0 errors).
- [ ] **Step 3:** Push + `gh pr create --base main` with a summary + preview test plan. Confirm `build` CI green.

---

## Self-review (against the spec)

- **§2 existing data** → Tasks 2 (mapping) + 4 (`loadFridgeReadings` reads count_value). ✓
- **§3 registry** → Tasks 1 (table) + 2 (seed). ✓
- **§4 naming standardization** → Task 3 (label-only, runs AFTER seed; ids stable). ✓
- **§5 maintenance notes** → Tasks 1 (table) + 4 (`addMaintenanceNote`) + 5 (route) + 10 (form). ✓
- **§6 overview + rich detail** → Tasks 4 (loaders) + 7 (chart) + 8/9 (components) + 10 (page). ✓
- **§7 dashboard nav** → Task 11. ✓
- **§8 roles (≥3, anyone)** → RLS (T1), API (T5), page gate (T10). ✓
- **§10 testing** → smokes in T4 + T12 + tsc/build/lint. ✓
- **Type consistency:** `Equipment`, `TempReading`, `FridgeStatus`/`computeFridgeStatus`, `MaintenanceNote`, `OverviewFridge`/`MaintenanceOverview`, `EquipmentDetail`, `loadEquipment`/`loadMaintenanceOverview`/`loadEquipmentDetail`/`addMaintenanceNote`, `MAINTENANCE_BASE_LEVEL`, `FRIDGE_DEFAULT_SAFE_MAX_F` — consistent across tasks. ✓
- **Placeholder scan:** Task 3's "repeat per fridge" shows the exact UPDATE pattern + the mapping table supplies every old/new label — mechanical repetition, not a vague placeholder. Tasks 6/8/9 give component specs + the exact pattern files to mirror (acceptable per house style), not "implement the UI."
- **Ordering gotcha flagged:** seed (T2) before relabel (T3) — called out in T3.

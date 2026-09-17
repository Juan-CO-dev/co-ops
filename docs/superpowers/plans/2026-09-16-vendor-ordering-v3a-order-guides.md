# Vendor Ordering V3-A — Order Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every list a manager reads while keying or reading out a purchase order follows the vendor's physical order guide (sections, then line order), seeded from the transcribed laminates and editable in vendor admin; the shelf walk itself is untouched.

**Architecture:** Three new tables (`vendor_order_guides` → `order_guide_sections` → `order_guide_lines` → SKU) replace the never-written `vendor_items.guide_position`. One pure comparator (`lib/order-guide-sort.ts`) and one pure body renderer (`lib/po-body.ts`) are the only places order is decided; PO lines snapshot `section*1000+line` and the section name at draft time and read `snapshot ?? live` afterwards. Seed 37 builds the guides; an admin tab edits them with dense renumbering and an `updated_at` precondition.

**Tech Stack:** Next.js 16 App Router (server components + client islands), Supabase Postgres via service-role client, Vitest, seed-32-shaped data scripts (`scripts/seed/26-angel-wave7.ts` helpers), LRA sim harness.

**Spec:** `docs/superpowers/specs/2026-09-16-vendor-ordering-v3a-order-guides-design.md` (r3). Read §3–§6 before Task 1.

**Branch:** `feat/vendor-ordering-v3a-guides` in `~/co-ops` (already holds the spec commits). Never commit on `~/co-ops-astra` mid-harness-run.

**House rules that apply to every task**
- Deny-all RLS on new tables; `revoke all … from anon, authenticated, public`; service-role only.
- Every API route: `requireSession` → role gate via `ROLES[ctx.user.role].level` → `assertSameOrigin(req)` from `lib/portal/csrf.ts` → `parseJsonBody`.
- Every audit action must be registered in `lib/audit-actions.ts` (NON_DESTRUCTIVE unless it deletes).
- i18n: every user-visible string in `lib/i18n/en.json` AND `lib/i18n/es.json` (the parity test fails otherwise).
- Run `npx vitest run <file>` per task and `npx tsc --noEmit` before each commit.
- Commit messages end with the session trailer (see `git log -3` on the branch for the exact lines).

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0205_order_guides.sql` | the three tables, snapshot column, drop `vendor_items.guide_position` |
| `lib/order-guide-sort.ts` | **pure** comparator + section grouping |
| `lib/order-guides.ts` | DB reads/writes: `loadOrderGuide`, `guideKeysFor`, `saveOrderGuide`, `renumberGuide` (pure), errors |
| `lib/po-body.ts` | **pure** `renderPoBodyLines` / `renderPoBodyText` — the one order-body renderer |
| `lib/purchase-orders.ts` | both draft paths snapshot via `guideKeysFor`; `loadPoDetail` hydrates `snapshot ?? live`; picker sorted by guide |
| `lib/po-email.ts` | text body from `renderPoBodyText`; HTML rows grouped by section |
| `lib/ordering.ts` | walker SKUs carry `guidePosition`/`guideSection` for the preview only |
| `components/ordering/PoPanel.tsx` | all tiers sort by guide with section header rows; `bodyText` from `renderPoBodyText` |
| `components/ordering/ParPassWalker.tsx` | review preview sorted by guide with headers |
| `scripts/seed/37-order-guides.ts` | build guides from the transcription (+ starter guides) |
| `app/api/admin/vendors/[id]/order-guide/route.ts` | GET model / POST save |
| `components/admin/vendors/OrderGuidePanel.tsx` | the Order guide tab |
| `app/admin/vendors/[id]/page.tsx` | mounts the panel |
| tests | `order-guide-sort.test.ts`, `order-guides-renumber.test.ts`, `po-body.test.ts`, `seed-37-order-guides.test.ts`, `order-guide-route.test.ts`, existing PO tests extended, `sim-fixtures.test.ts` pins |

---

### Task 1: Migration 0205 on the sim + harness pins

**Files:**
- Create: `supabase/migrations/0205_order_guides.sql`
- Modify: `scripts/sim/launch-readiness/fixtures/manifest.json` (inventory + `expectedTableCount`)
- Modify: `scripts/sim/launch-readiness/.private/snapshot/schema-meta.json` (gitignored; tables, primary_keys, foreign_keys, columns_nullable)
- Modify: `tests/sim-fixtures.test.ts` (pins)

- [ ] **Step 1: Write the migration**

```sql
-- 0205_order_guides.sql — Vendor Ordering V3-A (spec 2026-09-16 §3)
begin;

create table if not exists public.vendor_order_guides (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id),
  name        text not null,
  source_note text null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vendor_id)
);
comment on table public.vendor_order_guides is
  'One order guide per vendor (V3-A). The order every PO surface follows when keying/reading an order. '
  'updated_at is the admin editor''s optimistic-concurrency token. Service-role only; deny-all RLS.';

create table if not exists public.order_guide_sections (
  id        uuid primary key default gen_random_uuid(),
  guide_id  uuid not null references public.vendor_order_guides(id) on delete cascade,
  name      text not null,
  position  integer not null,
  unique (guide_id, position) deferrable initially deferred,
  unique (guide_id, name)
);

create table if not exists public.order_guide_lines (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.order_guide_sections(id) on delete cascade,
  position    integer not null,
  sku_id      uuid null references public.vendor_items(id),
  label       text not null,
  item_number text null,
  note        text null,
  unique (section_id, position) deferrable initially deferred,
  unique (sku_id)
);
comment on column public.order_guide_lines.sku_id is
  'null = a sheet row not yet matched to a SKU (kept in place, shown as "needs a SKU" in admin). '
  'unique: a SKU has one vendor and therefore one guide; a repeated sheet item keeps its first occurrence.';

create index if not exists order_guide_sections_guide_ix on public.order_guide_sections (guide_id, position);
create index if not exists order_guide_lines_section_ix  on public.order_guide_lines (section_id, position);

alter table public.vendor_order_guides  enable row level security;
alter table public.order_guide_sections enable row level security;
alter table public.order_guide_lines    enable row level security;
revoke all on public.vendor_order_guides, public.order_guide_sections, public.order_guide_lines from anon, authenticated;
revoke all on public.vendor_order_guides, public.order_guide_sections, public.order_guide_lines from public;

alter table public.po_lines add column if not exists guide_section_snapshot text null;
comment on column public.po_lines.guide_section_snapshot is
  'Section name at draft time (V3-A). guide_position_snapshot = section.position*1000 + line.position from the same read.';

-- Never written since 0174; every reader is migrated in the V3-A PR.
alter table public.vendor_items drop column if exists guide_position;

commit;
```

- [ ] **Step 2: Apply to the sim** via the Supabase MCP `apply_migration` (project `jepgzucrvklhqpthowsc`, name `0205_order_guides`, query = the statements between `begin;` and `commit;`). Then verify with `execute_sql`:

```sql
select 'tables', count(*)::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all select 'fks', count(*)::text from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f'
union all select 'rls', string_agg(relname||'='||relrowsecurity, ',') from pg_class where relname in ('vendor_order_guides','order_guide_sections','order_guide_lines')
union all select 'grants', count(*)::text from information_schema.role_table_grants where table_schema='public' and table_name in ('vendor_order_guides','order_guide_sections','order_guide_lines') and grantee in ('anon','authenticated','public')
union all select 'gp_gone', (select count(*)::text from information_schema.columns where table_name='vendor_items' and column_name='guide_position');
```
Expected: `tables 146` (was 143), `fks 380` (was 376: guides→vendors, sections→guides, lines→sections, lines→vendor_items), all three `rls=true`, `grants 0`, `gp_gone 0`.

- [ ] **Step 3: Update the harness pins.** In `scripts/sim/launch-readiness/fixtures/manifest.json` add the three tables to `inventory.CONFIG` (guides are configuration, restored with the fixture) and set `expectedTableCount` to 146. In the private `schema-meta.json` add the three tables, their primary keys (`["id"]`), the four foreign keys (`{child, parent, name, columns}` — names as Postgres generated them: `vendor_order_guides_vendor_id_fkey`, `order_guide_sections_guide_id_fkey`, `order_guide_lines_section_id_fkey`, `order_guide_lines_sku_id_fkey`), and `columns_nullable` entries `order_guide_lines.sku_id: true`, `po_lines.guide_section_snapshot: true`; remove any `vendor_items.guide_position` entry. In `tests/sim-fixtures.test.ts` change the pins `143 → 146` and `376 → 380`.

- [ ] **Step 4: Run** `npx vitest run tests/sim-fixtures.test.ts` → expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0205_order_guides.sql scripts/sim/launch-readiness/fixtures/manifest.json tests/sim-fixtures.test.ts
git commit -m "feat(ordering): migration 0205 — order guides (guide → sections → lines), po_lines.guide_section_snapshot, drop the never-written vendor_items.guide_position"
```

---

### Task 2: The pure comparator — `lib/order-guide-sort.ts`

**Files:**
- Create: `lib/order-guide-sort.ts`
- Test: `tests/order-guide-sort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compareByGuide, groupByGuideSection, NOT_ON_GUIDE } from "@/lib/order-guide-sort";

const L = (name: string, position: number | null, section: string | null) => ({ name, position, section });

describe("compareByGuide", () => {
  it("sorts by position ascending, nulls last, then name", () => {
    const rows = [L("Zucchini", null, null), L("Arugula", 2001, "Produce"), L("Eggs", 1001, "Dairy"), L("Basil", null, null)];
    expect([...rows].sort(compareByGuide).map((r) => r.name)).toEqual(["Eggs", "Arugula", "Basil", "Zucchini"]);
  });
  it("ties on position fall back to name", () => {
    expect([L("B", 5, "S"), L("A", 5, "S")].sort(compareByGuide).map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("groupByGuideSection", () => {
  it("emits headers in first-seen order after sorting, with not-on-guide last", () => {
    const rows = [L("Zucchini", null, null), L("Arugula", 2001, "Produce"), L("Eggs", 1001, "Dairy"), L("Milk", 1002, "Dairy")];
    const groups = groupByGuideSection(rows);
    expect(groups.map((g) => g.section)).toEqual(["Dairy", "Produce", NOT_ON_GUIDE]);
    expect(groups.map((g) => g.rows.map((r) => r.name))).toEqual([["Eggs", "Milk"], ["Arugula"], ["Zucchini"]]);
  });
  it("suppresses the header when not-on-guide is the only group", () => {
    const groups = groupByGuideSection([L("B", null, null), L("A", null, null)]);
    expect(groups).toEqual([{ section: null, rows: [L("A", null, null), L("B", null, null)] }]);
  });
  it("returns no groups for no rows", () => {
    expect(groupByGuideSection([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/order-guide-sort.test.ts` → expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * lib/order-guide-sort.ts — the ONE law for "in what order does a manager read an order".
 * PURE: no I/O. position = section.position * 1000 + line.position (spec §3), null = not on
 * the vendor's guide. Every consumer (PO panel, copied body, email, walker preview, picker)
 * sorts with compareByGuide and groups with groupByGuideSection; nobody re-implements it.
 */
export interface GuideSortKey { position: number | null; section: string | null; name: string }
/** Sentinel section for the trailing group. `null` in the returned group = "no header" (only group). */
export const NOT_ON_GUIDE = "__not_on_guide__" as const;
export interface GuideGroup<T extends GuideSortKey> { section: string | null; rows: T[] }

export function compareByGuide<T extends GuideSortKey>(a: T, b: T): number {
  const pa = a.position, pb = b.position;
  if (pa == null && pb == null) return a.name.localeCompare(b.name);
  if (pa == null) return 1;
  if (pb == null) return -1;
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name);
}

/** Sort, then split into consecutive same-section runs. Rows without a position form the
 *  last group under NOT_ON_GUIDE; when that is the ONLY group its section is null (no header). */
export function groupByGuideSection<T extends GuideSortKey>(rows: readonly T[]): GuideGroup<T>[] {
  const sorted = [...rows].sort(compareByGuide);
  const groups: GuideGroup<T>[] = [];
  for (const r of sorted) {
    const key = r.position == null ? NOT_ON_GUIDE : (r.section ?? "");
    const last = groups[groups.length - 1];
    if (last && last.section === key) last.rows.push(r);
    else groups.push({ section: key, rows: [r] });
  }
  if (groups.length === 1 && groups[0]!.section === NOT_ON_GUIDE) groups[0]!.section = null;
  return groups;
}
```

- [ ] **Step 4: Run** the test → expected: PASS (4 tests).

- [ ] **Step 5: Commit** — `git add lib/order-guide-sort.ts tests/order-guide-sort.test.ts && git commit -m "feat(ordering): pure guide comparator + section grouping (V3-A §4)"`

---

### Task 3: `lib/order-guides.ts` — model, pure renumber, DB reads

**Files:**
- Create: `lib/order-guides.ts`
- Test: `tests/order-guides-renumber.test.ts`

- [ ] **Step 1: Write the failing test (pure part only)**

```ts
import { describe, expect, it } from "vitest";
import { applyGuideEdit, renumber, type GuideModel } from "@/lib/order-guides";

const model = (): GuideModel => ({
  guideId: "g", vendorId: "v", name: "PFG", updatedAt: "2026-09-16T00:00:00Z",
  sections: [
    { id: "s1", name: "Produce", position: 1, lines: [
      { id: "l1", position: 1, skuId: "a", label: "Arugula", itemNumber: "1", note: null },
      { id: "l2", position: 2, skuId: "b", label: "Basil", itemNumber: null, note: null } ] },
    { id: "s2", name: "Dairy", position: 2, lines: [
      { id: "l3", position: 1, skuId: "c", label: "Eggs", itemNumber: null, note: null } ] },
  ],
});

describe("renumber", () => {
  it("makes sections and lines dense from 1 in array order", () => {
    const m = model(); m.sections[0]!.position = 7; m.sections[0]!.lines[1]!.position = 40;
    const r = renumber(m);
    expect(r.sections.map((s) => s.position)).toEqual([1, 2]);
    expect(r.sections[0]!.lines.map((l) => l.position)).toEqual([1, 2]);
  });
});

describe("applyGuideEdit", () => {
  it("moves a line up within its section", () => {
    const r = applyGuideEdit(model(), { kind: "move_line", lineId: "l2", direction: "up" });
    expect(r.sections[0]!.lines.map((l) => l.id)).toEqual(["l2", "l1"]);
  });
  it("moving the first line up is a no-op", () => {
    expect(applyGuideEdit(model(), { kind: "move_line", lineId: "l1", direction: "up" })).toEqual(renumber(model()));
  });
  it("moves a line to another section (appended last)", () => {
    const r = applyGuideEdit(model(), { kind: "move_line_to_section", lineId: "l1", sectionId: "s2" });
    expect(r.sections[1]!.lines.map((l) => l.id)).toEqual(["l3", "l1"]);
    expect(r.sections[1]!.lines[1]!.position).toBe(2);
  });
  it("moves a section down", () => {
    const r = applyGuideEdit(model(), { kind: "move_section", sectionId: "s1", direction: "down" });
    expect(r.sections.map((s) => s.id)).toEqual(["s2", "s1"]);
  });
  it("adds a line for a SKU not yet on the guide, refuses one that already is", () => {
    const r = applyGuideEdit(model(), { kind: "add_line", sectionId: "s2", skuId: "d", label: "Milk", itemNumber: null });
    expect(r.sections[1]!.lines.map((l) => l.skuId)).toEqual(["c", "d"]);
    expect(() => applyGuideEdit(model(), { kind: "add_line", sectionId: "s2", skuId: "a", label: "Arugula", itemNumber: null })).toThrow(/already on the guide/);
  });
  it("sets the SKU on a null-SKU line, and refuses a SKU already placed", () => {
    const m = model(); m.sections[0]!.lines[0]!.skuId = null;
    const r = applyGuideEdit(m, { kind: "set_line_sku", lineId: "l1", skuId: "z" });
    expect(r.sections[0]!.lines[0]!.skuId).toBe("z");
    expect(() => applyGuideEdit(m, { kind: "set_line_sku", lineId: "l1", skuId: "b" })).toThrow(/already on the guide/);
  });
  it("removes a line; refuses to remove a non-empty section; removes an empty one", () => {
    const r = applyGuideEdit(model(), { kind: "remove_line", lineId: "l3" });
    expect(r.sections[1]!.lines).toEqual([]);
    expect(() => applyGuideEdit(model(), { kind: "remove_section", sectionId: "s1" })).toThrow(/not empty/);
    expect(applyGuideEdit(r, { kind: "remove_section", sectionId: "s2" }).sections.map((s) => s.id)).toEqual(["s1"]);
  });
  it("adds and renames sections, refusing a duplicate name", () => {
    const r = applyGuideEdit(model(), { kind: "add_section", name: "Meat" });
    expect(r.sections.map((s) => s.name)).toEqual(["Produce", "Dairy", "Meat"]);
    expect(() => applyGuideEdit(r, { kind: "rename_section", sectionId: "s1", name: "meat" })).toThrow(/section name/);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
/**
 * lib/order-guides.ts — the vendor order guide (V3-A). Model + PURE edit reducer + DB layer.
 *
 * Read law (spec §3): PO surfaces read `snapshot ?? live`. `guideKeysFor(skuIds)` is that
 * live read — one query, keyed by SKU — used by both draft-creation paths (snapshot) and by
 * loadPoDetail / the walker preview (fallback). Position = section.position*1000 + line.position.
 *
 * Write law (spec §6/§7): the editor sends the whole model + the `updatedAt` it loaded;
 * stale → 409 guide_stale; the server rewrites positions dense (renumber) inside one RPC-less
 * sequence guarded by the deferrable unique constraints; audit stores the full before/after.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export interface GuideLine { id: string; position: number; skuId: string | null; label: string; itemNumber: string | null; note: string | null }
export interface GuideSection { id: string; name: string; position: number; lines: GuideLine[] }
export interface GuideModel { guideId: string; vendorId: string; name: string; updatedAt: string; sections: GuideSection[] }
export interface GuideKey { position: number; section: string }

export type GuideEdit =
  | { kind: "move_line"; lineId: string; direction: "up" | "down" }
  | { kind: "move_line_to_section"; lineId: string; sectionId: string }
  | { kind: "move_section"; sectionId: string; direction: "up" | "down" }
  | { kind: "add_line"; sectionId: string; skuId: string; label: string; itemNumber: string | null }
  | { kind: "set_line_sku"; lineId: string; skuId: string }
  | { kind: "remove_line"; lineId: string }
  | { kind: "add_section"; name: string }
  | { kind: "rename_section"; sectionId: string; name: string }
  | { kind: "remove_section"; sectionId: string };

export class OrderGuideError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const clone = (m: GuideModel): GuideModel => JSON.parse(JSON.stringify(m)) as GuideModel;

export function renumber(m: GuideModel): GuideModel {
  const out = clone(m);
  out.sections.forEach((s, i) => { s.position = i + 1; s.lines.forEach((l, j) => { l.position = j + 1; }); });
  return out;
}

export function positionOf(sectionPosition: number, linePosition: number): number {
  return sectionPosition * 1000 + linePosition;
}

function findLine(m: GuideModel, lineId: string): { s: GuideSection; idx: number } {
  for (const s of m.sections) { const idx = s.lines.findIndex((l) => l.id === lineId); if (idx >= 0) return { s, idx }; }
  throw new OrderGuideError(404, "line_not_found", `line ${lineId} is not on this guide`);
}
function findSection(m: GuideModel, sectionId: string): { s: GuideSection; idx: number } {
  const idx = m.sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) throw new OrderGuideError(404, "section_not_found", `section ${sectionId} is not on this guide`);
  return { s: m.sections[idx]!, idx };
}
function assertSkuFree(m: GuideModel, skuId: string, exceptLineId?: string): void {
  for (const s of m.sections) for (const l of s.lines) {
    if (l.skuId === skuId && l.id !== exceptLineId) throw new OrderGuideError(409, "sku_already_placed", "That SKU is already on the guide");
  }
}
function assertSectionNameFree(m: GuideModel, name: string, exceptId?: string): void {
  const n = name.trim().toLowerCase();
  if (!n) throw new OrderGuideError(400, "invalid_payload", "A section name is required");
  if (m.sections.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === n)) throw new OrderGuideError(409, "section_name_taken", "A section with that name already exists on this guide");
}
const swap = <T,>(arr: T[], i: number, j: number) => { const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t; };
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`);

/** PURE reducer: apply one edit and renumber. Throws OrderGuideError on an illegal edit. */
export function applyGuideEdit(model: GuideModel, edit: GuideEdit): GuideModel {
  const m = clone(model);
  switch (edit.kind) {
    case "move_line": {
      const { s, idx } = findLine(m, edit.lineId);
      const j = edit.direction === "up" ? idx - 1 : idx + 1;
      if (j >= 0 && j < s.lines.length) swap(s.lines, idx, j);
      break;
    }
    case "move_line_to_section": {
      const { s, idx } = findLine(m, edit.lineId);
      const target = findSection(m, edit.sectionId).s;
      const [line] = s.lines.splice(idx, 1);
      target.lines.push(line!);
      break;
    }
    case "move_section": {
      const { idx } = findSection(m, edit.sectionId);
      const j = edit.direction === "up" ? idx - 1 : idx + 1;
      if (j >= 0 && j < m.sections.length) swap(m.sections, idx, j);
      break;
    }
    case "add_line": {
      assertSkuFree(m, edit.skuId);
      const label = edit.label.trim();
      if (!label) throw new OrderGuideError(400, "invalid_payload", "A line label is required");
      findSection(m, edit.sectionId).s.lines.push({ id: newId(), position: 0, skuId: edit.skuId, label, itemNumber: edit.itemNumber, note: null });
      break;
    }
    case "set_line_sku": {
      assertSkuFree(m, edit.skuId, edit.lineId);
      const { s, idx } = findLine(m, edit.lineId);
      s.lines[idx]!.skuId = edit.skuId;
      break;
    }
    case "remove_line": {
      const { s, idx } = findLine(m, edit.lineId);
      s.lines.splice(idx, 1);
      break;
    }
    case "add_section": {
      assertSectionNameFree(m, edit.name);
      m.sections.push({ id: newId(), name: edit.name.trim(), position: 0, lines: [] });
      break;
    }
    case "rename_section": {
      assertSectionNameFree(m, edit.name, edit.sectionId);
      findSection(m, edit.sectionId).s.name = edit.name.trim();
      break;
    }
    case "remove_section": {
      const { s, idx } = findSection(m, edit.sectionId);
      if (s.lines.length > 0) throw new OrderGuideError(409, "section_not_empty", "Move or remove its lines first");
      m.sections.splice(idx, 1);
      break;
    }
  }
  return renumber(m);
}

// ── DB layer ────────────────────────────────────────────────────────────────────────────

type GuideRow = { id: string; vendor_id: string; name: string; updated_at: string };
type SectionRow = { id: string; guide_id: string; name: string; position: number };
type LineRow = { id: string; section_id: string; position: number; sku_id: string | null; label: string; item_number: string | null; note: string | null };

/** The vendor's guide, or null when none exists yet. */
export async function loadOrderGuide(vendorId: string): Promise<GuideModel | null> {
  const sb = getServiceRoleClient();
  const { data: g, error: gErr } = await sb.from("vendor_order_guides").select("id, vendor_id, name, updated_at").eq("vendor_id", vendorId).maybeSingle<GuideRow>();
  if (gErr) throw new Error(`loadOrderGuide: ${gErr.message}`);
  if (!g) return null;
  const { data: sections, error: sErr } = await sb.from("order_guide_sections").select("id, guide_id, name, position").eq("guide_id", g.id).order("position").returns<SectionRow[]>();
  if (sErr) throw new Error(`loadOrderGuide sections: ${sErr.message}`);
  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: lines, error: lErr } = sectionIds.length
    ? await sb.from("order_guide_lines").select("id, section_id, position, sku_id, label, item_number, note").in("section_id", sectionIds).order("position").returns<LineRow[]>()
    : { data: [] as LineRow[], error: null };
  if (lErr) throw new Error(`loadOrderGuide lines: ${lErr.message}`);
  return {
    guideId: g.id, vendorId: g.vendor_id, name: g.name, updatedAt: g.updated_at,
    sections: (sections ?? []).map((s) => ({
      id: s.id, name: s.name, position: s.position,
      lines: (lines ?? []).filter((l) => l.section_id === s.id).map((l) => ({ id: l.id, position: l.position, skuId: l.sku_id, label: l.label, itemNumber: l.item_number, note: l.note })),
    })),
  };
}

/** LIVE guide keys for a set of SKUs (one query). Missing = not on any guide. */
export async function guideKeysFor(skuIds: readonly string[]): Promise<Map<string, GuideKey>> {
  const out = new Map<string, GuideKey>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("order_guide_lines")
    .select("sku_id, position, order_guide_sections!inner(name, position)")
    .in("sku_id", [...new Set(skuIds)])
    .returns<Array<{ sku_id: string; position: number; order_guide_sections: { name: string; position: number } }>>();
  if (error) throw new Error(`guideKeysFor: ${error.message}`);
  for (const r of data ?? []) out.set(r.sku_id, { position: positionOf(r.order_guide_sections.position, r.position), section: r.order_guide_sections.name });
  return out;
}

export const ORDER_GUIDE_EDIT_MIN = 7; // GM+

/**
 * Persist a whole model (already reduced client-side or here). Precondition: `expectedUpdatedAt`
 * equals the stored updated_at, else 409 guide_stale. Writes: upsert sections/lines by id,
 * delete rows absent from the model, bump updated_at, audit full before/after.
 */
export async function saveOrderGuide(actor: AuthContext, vendorId: string, next: GuideModel, expectedUpdatedAt: string): Promise<GuideModel> {
  const sb = getServiceRoleClient();
  const before = await loadOrderGuide(vendorId);
  if (!before) throw new OrderGuideError(404, "not_found", "No guide for this vendor");
  if (before.updatedAt !== expectedUpdatedAt) throw new OrderGuideError(409, "guide_stale", "The guide changed since you loaded it");
  const model = renumber(next);
  // One SKU per line, across the whole model (the DB unique index is the floor; this is the readable error).
  const seen = new Set<string>();
  for (const s of model.sections) for (const l of s.lines) { if (l.skuId) { if (seen.has(l.skuId)) throw new OrderGuideError(409, "sku_already_placed", "That SKU is on two lines"); seen.add(l.skuId); } }
  const now = new Date().toISOString();
  const keepSections = new Set(model.sections.map((s) => s.id));
  const keepLines = new Set(model.sections.flatMap((s) => s.lines.map((l) => l.id)));
  // Delete first (frees names/positions), then upsert with positions offset to avoid transient collisions.
  const goneLines = before.sections.flatMap((s) => s.lines).filter((l) => !keepLines.has(l.id)).map((l) => l.id);
  if (goneLines.length) { const { error } = await sb.from("order_guide_lines").delete().in("id", goneLines); if (error) throw new Error(`saveOrderGuide delete lines: ${error.message}`); }
  const goneSections = before.sections.filter((s) => !keepSections.has(s.id)).map((s) => s.id);
  if (goneSections.length) { const { error } = await sb.from("order_guide_sections").delete().in("id", goneSections); if (error) throw new Error(`saveOrderGuide delete sections: ${error.message}`); }
  // Two-phase positions: park at +100000 then set final, so (guide_id, position) never collides mid-way.
  for (const phase of ["park", "final"] as const) {
    const sRows = model.sections.map((s) => ({ id: s.id, guide_id: before.guideId, name: s.name, position: phase === "park" ? s.position + 100000 : s.position }));
    const { error: sErr } = await sb.from("order_guide_sections").upsert(sRows, { onConflict: "id" });
    if (sErr) throw new Error(`saveOrderGuide sections (${phase}): ${sErr.message}`);
    const lRows = model.sections.flatMap((s) => s.lines.map((l) => ({ id: l.id, section_id: s.id, position: phase === "park" ? l.position + 100000 : l.position, sku_id: l.skuId, label: l.label, item_number: l.itemNumber, note: l.note })));
    if (lRows.length) { const { error: lErr } = await sb.from("order_guide_lines").upsert(lRows, { onConflict: "id" }); if (lErr) throw new Error(`saveOrderGuide lines (${phase}): ${lErr.message}`); }
  }
  const { error: uErr, count } = await sb.from("vendor_order_guides").update({ updated_at: now, name: model.name }, { count: "exact" }).eq("id", before.guideId).eq("updated_at", expectedUpdatedAt);
  if (uErr || count !== 1) throw new OrderGuideError(409, "guide_stale", "The guide changed while saving");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "vendor.order_guide.edited",
    resourceTable: "vendor_order_guides", resourceId: before.guideId,
    metadata: { vendor_id: vendorId, before: stripForAudit(before), after: stripForAudit(model) },
  });
  return (await loadOrderGuide(vendorId))!;
}

function stripForAudit(m: GuideModel) {
  return { name: m.name, sections: m.sections.map((s) => ({ name: s.name, position: s.position, lines: s.lines.map((l) => ({ label: l.label, sku_id: l.skuId, position: l.position }) ) })) };
}
```

Notes for the implementer: (1) the two-phase upsert exists because Supabase's client cannot open a deferred-constraint transaction; parking at +100000 keeps every intermediate state unique. (2) `AuthContext` is the session type already exported from `lib/session` (see `lib/vendor-rhythm.ts:357` for how `actor.user.id` / `.role` are read). (3) Register `"vendor.order_guide.edited"` in `NON_DESTRUCTIVE_ACTIONS` in Task 9.

- [ ] **Step 4: Run** `npx vitest run tests/order-guides-renumber.test.ts` → PASS (8 tests). `npx tsc --noEmit` → clean (add the audit action now if tsc complains about the literal; Task 9 keeps it).

- [ ] **Step 5: Commit** — `git add lib/order-guides.ts tests/order-guides-renumber.test.ts lib/audit-actions.ts && git commit -m "feat(ordering): order-guide model, pure edit reducer, live key read, guarded save (V3-A §3/§6)"`

---

### Task 4: `lib/po-body.ts` — the one order-body renderer

**Files:**
- Create: `lib/po-body.ts`
- Test: `tests/po-body.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderPoBodyLines, renderPoBodyText, type PoBodyLine } from "@/lib/po-body";

const t = (key: string, vars?: Record<string, string | number>) => {
  const map: Record<string, string> = {
    "ordering.email.body_po": "PO {code}", "ordering.email.body_header": "Order for {shop} · {date}",
    "ordering.email.body_line": "{sku} — {qty} {unit} (#{item})", "ordering.unit_generic": "unit",
    "ordering.body.section": "— {section} —", "ordering.body.not_on_guide": "— Not on the guide —",
  };
  return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), map[key] ?? key);
};
const line = (name: string, qty: number, position: number | null, section: string | null): PoBodyLine =>
  ({ skuName: name, orderQty: qty, orderUnitLabel: "cs", itemNumber: "1", guidePosition: position, guideSection: section });

describe("renderPoBodyLines", () => {
  it("groups by section in guide order, not-on-guide last, zero-qty lines skipped", () => {
    const out = renderPoBodyLines([line("Zucchini", 1, null, null), line("Arugula", 2, 2001, "Produce"), line("Eggs", 3, 1001, "Dairy"), line("Gone", 0, 1002, "Dairy")], t);
    expect(out).toEqual(["— Dairy —", "Eggs — 3 cs (#1)", "— Produce —", "Arugula — 2 cs (#1)", "— Not on the guide —", "Zucchini — 1 cs (#1)"]);
  });
  it("no header when nothing is on a guide", () => {
    expect(renderPoBodyLines([line("B", 1, null, null), line("A", 1, null, null)], t)).toEqual(["A — 1 cs (#1)", "B — 1 cs (#1)"]);
  });
});

describe("renderPoBodyText", () => {
  it("PO code line, header, blank, then the lines", () => {
    const text = renderPoBodyText({ displayCode: "EM-0916-PFG", shopLabel: "P Street", dateLabel: "Sep 16", lines: [line("Eggs", 3, 1001, "Dairy")] }, t);
    expect(text).toBe("PO EM-0916-PFG\nOrder for P Street · Sep 16\n\n— Dairy —\nEggs — 3 cs (#1)");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * lib/po-body.ts — PURE. The single renderer for a purchase order's readable body: the copied
 * text in the PO panel and the text half of the vendor email are byte-identical because both
 * call renderPoBodyText. Order = lib/order-guide-sort (section headers, not-on-guide last).
 */
import { groupByGuideSection, NOT_ON_GUIDE } from "@/lib/order-guide-sort";

export type BodyT = (key: string, vars?: Record<string, string | number>) => string;
export interface PoBodyLine {
  skuName: string; orderQty: number; orderUnitLabel: string | null; itemNumber: string | null;
  guidePosition: number | null; guideSection: string | null;
}
export interface PoBodyInput { displayCode: string; shopLabel: string; dateLabel: string; lines: readonly PoBodyLine[] }

export function renderPoBodyLines(lines: readonly PoBodyLine[], t: BodyT): string[] {
  const sent = lines.filter((l) => l.orderQty > 0).map((l) => ({ ...l, name: l.skuName, position: l.guidePosition, section: l.guideSection }));
  const out: string[] = [];
  for (const g of groupByGuideSection(sent)) {
    if (g.section === NOT_ON_GUIDE) out.push(t("ordering.body.not_on_guide"));
    else if (g.section !== null) out.push(t("ordering.body.section", { section: g.section }));
    for (const l of g.rows) out.push(t("ordering.email.body_line", { sku: l.skuName, qty: l.orderQty, unit: l.orderUnitLabel ?? t("ordering.unit_generic"), item: l.itemNumber ?? "—" }));
  }
  return out;
}

export function renderPoBodyText(input: PoBodyInput, t: BodyT): string {
  const po = t("ordering.email.body_po", { code: input.displayCode });
  const header = t("ordering.email.body_header", { shop: input.shopLabel, date: input.dateLabel });
  return `${po}\n${header}\n\n${renderPoBodyLines(input.lines, t).join("\n")}`;
}
```

Add to `lib/i18n/en.json` next to the existing `ordering.email.body_*` keys: `"ordering.body.section": "— {section} —"`, `"ordering.body.not_on_guide": "— Not on the guide —"`; `es.json`: `"— {section} —"`, `"— Fuera de la guía —"`.

- [ ] **Step 4: Run** → PASS (3 tests).

- [ ] **Step 5: Commit** — `git add lib/po-body.ts tests/po-body.test.ts lib/i18n/en.json lib/i18n/es.json && git commit -m "feat(ordering): one pure order-body renderer with guide sections (V3-A §4)"`

---

### Task 5: Purchase orders — snapshot from the guide, read `snapshot ?? live`, picker in guide order

**Files:**
- Modify: `lib/purchase-orders.ts` (`createDraftsFromLines` ~`:221-234` and `:317`; `insertNewDraftLines` ~`:437-446`; `PoLineView` ~`:1222-1230`; `VendorPoSku` ~`:1304-1310`; `loadPoDetail` ~`:1401-1404`, `:1440-1457`, `:1555-1565`; the confirmed-snapshot builder near `:714` that writes `guidePos`)
- Test: `tests/po-guide-snapshot.test.ts` (new) + whatever existing PO test constructs line rows (grep `guide_position_snapshot` under `tests/`)

- [ ] **Step 1: Write the failing test.** Find how the existing PO tests fake the Supabase client (`grep -ln "createDraftsFromLines\|loadPoDetail" tests/*.ts`) and follow that harness. Assert:

```ts
// (a) createDraftsFromLines inserts guide_position_snapshot = section*1000+line AND guide_section_snapshot
//     for a SKU on a guide, and null/null for one that is not — using vi.mock("@/lib/order-guides",
//     () => ({ guideKeysFor: vi.fn(async () => new Map([["sku-a", { position: 2001, section: "Produce" }]])) })).
// (b) insertNewDraftLines does the same (both paths read the SAME helper — no vendor_items.guide_position read remains:
//     expect(fakeSb.from).not.toHaveBeenCalledWith("vendor_items") on the guide read).
// (c) loadPoDetail: a line with snapshot 1001/"Dairy" keeps it even if guideKeysFor now says 2001/"Produce";
//     a line with null snapshot gets the live 2001/"Produce"; a line on no guide stays null/null.
// (d) loadPoDetail.vendorSkus come back sorted by compareByGuide (guide first, then name) and each carries
//     guidePosition/guideSection from the live read.
```

- [ ] **Step 2: Run** → FAIL (guide_section_snapshot not written; guidePosition read from vendor_items).

- [ ] **Step 3: Implement**

In `createDraftsFromLines` replace the `vendor_items … guide_position` branch of the `Promise.all` with the live read and use it:

```ts
import { guideKeysFor } from "@/lib/order-guides";
import { compareByGuide } from "@/lib/order-guide-sort";
// …
const [{ data: vendorRows, error: vErr }, guideKeys] = await Promise.all([
  sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
  guideKeysFor(allSkuIds),
]);
if (vErr) throw new Error(`createDraftsFromLines vendors: ${vErr.message}`);
// at the po_lines insert (≈:317):
guide_position_snapshot: guideKeys.get(l.skuId)?.position ?? null,
guide_section_snapshot:  guideKeys.get(l.skuId)?.section ?? null,
```

In `insertNewDraftLines` replace the `vendor_items` read with `const guideKeys = await guideKeysFor(newSkuIds);` and write both snapshot columns the same way.

`PoLineView`: add `guideSection: string | null;` after `guidePositionSnapshot`. `VendorPoSku`: replace `guidePosition: number | null` with `guidePosition: number | null; guideSection: string | null;`.

`loadPoDetail`: select `guide_section_snapshot` too; after the SKU rows are loaded compute `const live = await guideKeysFor([...lineRows.map(l => l.sku_id), ...vendorSkuRows.map(s => s.id)]);` then map lines with

```ts
guidePositionSnapshot: l.guide_position_snapshot ?? live.get(l.sku_id)?.position ?? null,
guideSection:          l.guide_section_snapshot  ?? live.get(l.sku_id)?.section  ?? null,
```

and the picker with `guidePosition: live.get(s.id)?.position ?? null, guideSection: live.get(s.id)?.section ?? null` then `.sort(compareByGuide)` on `{ position: guidePosition, section: guideSection, name }`. Remove `guide_position` from the `vendor_items` select (`.select("id, name, item_number, pack_format")`, drop the `.order("guide_position"…)`).

Confirmed snapshot builder (≈`:714`): keep `guidePos: l.guide_position_snapshot` and add `guideSection: l.guide_section_snapshot ?? null`.

- [ ] **Step 4: Run** `npx vitest run tests/po-guide-snapshot.test.ts tests/po-*.test.ts tests/purchase-orders*.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(ordering): PO lines snapshot section+position from the guide; loadPoDetail reads snapshot ?? live; picker in guide order (V3-A §3/§4)"`

---

### Task 6: Surfaces — PO panel (all tiers, headers, shared body), email, walker preview

**Files:**
- Modify: `components/ordering/PoPanel.tsx` (`bodyText` ≈`:325-341`, `orderedLines` ≈`:696-708`, the `<tbody>` ≈`:722-735`)
- Modify: `lib/po-email.ts` (`SnapshotLine` ≈`:60-70`, line parse ≈`:152-165`, `renderBodies` ≈`:195-240`)
- Modify: `lib/ordering.ts` (`WalkerSku` ≈`:470`, `loadWalkerData` after the SKU rows are built ≈`:938`)
- Modify: `components/ordering/ParPassWalker.tsx` (preview ≈`:328-390`)
- Test: `tests/po-email-body.test.ts` (new or extend the existing po-email test), `tests/po-panel-order.test.tsx` (if a PoPanel test exists; else covered by the sim claim in Task 10)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/po-email-body.test.ts — build a PoEmailContext with three snapshot lines carrying
// guidePos/guideSection (Dairy 1001, Produce 2001, null) and assert:
//   textBody contains "— Dairy —" before "Eggs" and "— Not on the guide —" before "Zucchini";
//   htmlBody contains a section row `<td colspan="2"` with "Dairy" before the Eggs row;
//   the text lines equal renderPoBodyLines(...) joined — identical renderer.
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`lib/po-email.ts`: add `guideSection: string | null` to `SnapshotLine`; parse `guideSection: typeof r.guideSection === "string" ? r.guideSection : null`. In `renderBodies` replace the `for (const l of ctx.lines) textParts.push(textLine(l));` block with the shared renderer, and group the HTML rows:

```ts
import { renderPoBodyLines, type PoBodyLine } from "@/lib/po-body";
import { groupByGuideSection, NOT_ON_GUIDE } from "@/lib/order-guide-sort";
import { serverT } from "@/lib/i18n/server";           // already the server-side t used elsewhere
// text
const t = serverT("en");
const bodyLines: PoBodyLine[] = ctx.lines.map((l) => ({ skuName: l.name, orderQty: l.qty, orderUnitLabel: l.unitLabel, itemNumber: l.itemNumber, guidePosition: l.guidePos, guideSection: l.guideSection }));
for (const s of renderPoBodyLines(bodyLines, t)) textParts.push(`  ${s}`);
// html
const groups = groupByGuideSection(ctx.lines.map((l) => ({ ...l, position: l.guidePos, section: l.guideSection })));
const rowsHtml = groups.map((g) => {
  const header = g.section === null ? "" : `<tr><td colspan="2" style="padding:10px 8px 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;">${escapeHtml(g.section === NOT_ON_GUIDE ? t("ordering.body.not_on_guide_plain") : g.section)}</td></tr>`;
  return header + g.rows.map(rowHtml).join("");   // rowHtml = the existing per-line template extracted to a function
}).join("");
```

Add `"ordering.body.not_on_guide_plain": "Not on the guide"` (es: `"Fuera de la guía"`). Delete the now-unused `textLine` helper.

`components/ordering/PoPanel.tsx`:
```ts
import { renderPoBodyText } from "@/lib/po-body";
import { groupByGuideSection, NOT_ON_GUIDE } from "@/lib/order-guide-sort";
// bodyText
const bodyText = useMemo(() => detail ? renderPoBodyText({ displayCode: detail.displayCode, shopLabel, dateLabel,
  lines: detail.lines.map((l) => ({ skuName: l.skuName, orderQty: l.orderQty, orderUnitLabel: l.orderUnitLabel, itemNumber: l.itemNumber, guidePosition: l.guidePositionSnapshot, guideSection: l.guideSection })) }, t) : "", [detail, shopLabel, dateLabel, t]);
// orderedLines → groups (ALL tiers; the assisted gate is deleted)
const lineGroups = useMemo(() => groupByGuideSection(detail.lines.filter((l) => l.orderQty > 0).map((l) => ({ ...l, name: l.skuName, position: l.guidePositionSnapshot, section: l.guideSection }))), [detail.lines]);
// tbody
{lineGroups.map((g) => (
  <Fragment key={g.section ?? "only"}>
    {g.section !== null && (
      <tr><td colSpan={4} className="pt-3 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{g.section === NOT_ON_GUIDE ? t("ordering.body.not_on_guide_plain") : g.section}</td></tr>
    )}
    {g.rows.map((l) => ( /* the existing <tr> unchanged */ ))}
  </Fragment>
))}
```
Rewrite the comment above `orderedLines` to say every tier follows the guide (V3-A).

`lib/ordering.ts`: add `guidePosition: number | null; guideSection: string | null;` to `WalkerSku` with the doc comment "for the REVIEW PREVIEW only — the walk order is usage then name and does not read these". In `loadWalkerData`, after the SKU list is final, `const keys = await guideKeysFor(skus.map(s => s.skuId))` and fill both fields (`null` when absent). The walk sort at `:1221-1226` is NOT touched.

`components/ordering/ParPassWalker.tsx` preview: replace `p.lines.map((s) => <tr…>)` with the grouped render, same header row pattern as PoPanel (colSpan 3), built from `groupByGuideSection(p.lines.map((s) => ({ ...s, position: s.guidePosition, section: s.guideSection })))`.

- [ ] **Step 4: Run** the email test + the walker/ordering tests (`npx vitest run tests/po-email* tests/ordering* tests/walker*`) → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(ordering): every order surface follows the guide — PO panel (all tiers) + copied body + email + walker preview share one renderer (V3-A §4)"`

---

### Task 7: Seed 37 — build the guides from the transcription

**Files:**
- Create: `scripts/seed/37-order-guides.ts`
- Test: `tests/seed-37-order-guides.test.ts`

- [ ] **Step 1: Write the failing planner tests**

```ts
import { describe, expect, it } from "vitest";
import { planOrderGuides, routeRow, SECTION_NAMES, SOURCE, type Tables } from "@/scripts/seed/37-order-guides";

const V = { PFG: "v-pfg", "Leonard Paper": "v-leo", Trimark: "v-tri", "Boar's Head": "v-bh", Baldor: "v-bal", Whisked: "v-wh" };
const sku = (name: string, vendor: keyof typeof V, item_number: string | null = null, product_id: string | null = null) =>
  ({ id: `${name}|${vendor}`, name, vendor_id: V[vendor], item_number, active: true, product_id });
const sheets = {
  pfg_leonard: [
    { section: "Produce", item: "Arugula", item_number: "242470", par: "5", vendor: "PFG" },
    { section: "Dairy", item: "Eggs", item_number: "439686", par: "", vendor: "PFG" },
    { section: "Dairy", item: "Eggs (cooked)", item_number: "439686", par: "", vendor: "PFG" },
    { section: "Leonard Paper / Trimark", item: "Butcher Paper", item_number: "N/A", par: "", vendor: "TRIMARK" },
    { section: "Leonard Paper / Trimark", item: "Plastic forks", item_number: "N/A", par: "", vendor: "Leonard Paper" },
    { section: "Produce", item: "Cannoli Shell", item_number: "N/A", par: "", vendor: "Baldor" },
    { section: "Produce", item: "Transfer from P St", item_number: "N/A", par: "", vendor: "TRANSFER" },
  ],
  boars_head: [
    { section: "Boar's Head", item: "Turkey", pack_note: "2/cs", par: "9" },
    { section: "Beverage", item: "Coke", pack_note: "", par: "" },
    { section: "Smallwares", item: "Mystery widget", pack_note: "", par: "" },
  ],
};
const tables = (): Tables => ({
  vendors: Object.entries(V).map(([name, id]) => ({ id, name, active: true })),
  vendor_items: [sku("Arugula", "PFG", "242470"), sku("Eggs", "PFG", "439686"), sku("Butcher Paper", "Trimark"), sku("Plastic forks", "Leonard Paper"),
    sku("Turkey", "Boar's Head"), sku("Coke", "PFG"), sku("Cannoli Shell", "Baldor"), sku("Croissant", "Whisked")],
  vendor_order_guides: [], order_guide_sections: [], order_guide_lines: [],
});

describe("routeRow", () => {
  it("routes laminate rows by their vendor key and renames the mixed section per vendor", () => {
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[3]!)).toEqual({ vendor: "Trimark", section: SECTION_NAMES.Trimark["Leonard Paper / Trimark"] });
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[4]!)).toEqual({ vendor: "Leonard Paper", section: "Leonard Paper" });
  });
  it("sends Boar's Head sections to Boar's Head and second-sheet sections to 'by_sku'", () => {
    expect(routeRow("boars_head", sheets.boars_head[0]!)).toEqual({ vendor: "Boar's Head", section: "Boar's Head" });
    expect(routeRow("boars_head", sheets.boars_head[1]!)).toEqual({ vendor: "by_sku", section: "Beverage" });
  });
  it("reports Baldor and TRANSFER laminate rows", () => {
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[5]!)).toEqual({ vendor: "report", section: "Produce" });
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[6]!)).toEqual({ vendor: "report", section: "Produce" });
  });
});

describe("planOrderGuides", () => {
  it("builds one guide per vendor with matched lines, keeps the first of a repeated item, routes second-sheet rows by SKU vendor, starts a guide for sheetless vendors", () => {
    const plans = planOrderGuides(tables(), sheets);
    const pfg = plans.find((p) => p.vendor === "PFG")!;
    expect(pfg.status).toBe("ready");
    expect(pfg.sections.map((s) => [s.name, s.lines.map((l) => l.label)])).toEqual([["Produce", ["Arugula"]], ["Dairy", ["Eggs"]], ["Beverage", ["Coke"]]]);
    expect(pfg.report.some((r) => /repeat/.test(r))).toBe(true);
    expect(plans.find((p) => p.vendor === "Trimark")!.sections[0]!.name).toBe("Trimark");
    expect(plans.find((p) => p.vendor === "Baldor")!.kind).toBe("starter");
    expect(plans.find((p) => p.vendor === "Whisked")!.sections[0]!.lines.map((l) => l.label)).toEqual(["Croissant"]);
    expect(plans.flatMap((p) => p.report)).toEqual(expect.arrayContaining([expect.stringMatching(/Cannoli Shell/), expect.stringMatching(/Transfer/), expect.stringMatching(/Mystery widget/)]));
  });
  it("matches by item number first, then exact name, then unambiguous contains; ambiguous → null sku", () => {
    const t = tables(); t.vendor_items.push(sku("Eggs Large", "PFG"), sku("Eggs Medium", "PFG"));
    const s = { pfg_leonard: [{ section: "Dairy", item: "Eggs", item_number: "N/A", par: "", vendor: "PFG" }, { section: "Dairy", item: "Egg", item_number: "N/A", par: "", vendor: "PFG" }], boars_head: [] };
    const pfg = planOrderGuides(t, s).find((p) => p.vendor === "PFG")!;
    expect(pfg.sections[0]!.lines.map((l) => l.skuId)).toEqual(["Eggs|PFG", null]); // "Egg" contains-matches three → ambiguous
  });
  it("is idempotent: an existing seed-37 guide with everything placed → already; a hand-made guide → refused; a null-sku line is re-matched only", () => {
    const t = tables();
    t.vendor_order_guides.push({ id: "g", vendor_id: V.PFG, name: "PFG — laminated guide", source_note: `[${SOURCE}]`, updated_at: "x" });
    t.order_guide_sections.push({ id: "s", guide_id: "g", name: "Produce", position: 1 }, { id: "s2", guide_id: "g", name: "Dairy", position: 2 }, { id: "s3", guide_id: "g", name: "Beverage", position: 3 });
    t.order_guide_lines.push({ id: "l", section_id: "s", position: 1, sku_id: null, label: "Arugula", item_number: "242470" }, { id: "l2", section_id: "s2", position: 1, sku_id: "Eggs|PFG", label: "Eggs", item_number: "439686" }, { id: "l3", section_id: "s3", position: 1, sku_id: "Coke|PFG", label: "Coke", item_number: null });
    const pfg = planOrderGuides(t, sheets).find((p) => p.vendor === "PFG")!;
    expect(pfg.status).toBe("ready"); expect(pfg.rematch).toEqual([{ lineId: "l", skuId: "Arugula|PFG" }]); expect(pfg.append).toEqual([]);
    t.order_guide_lines[0]!.sku_id = "Arugula|PFG";
    expect(planOrderGuides(t, sheets).find((p) => p.vendor === "PFG")!.status).toBe("already");
    t.vendor_order_guides[0]!.source_note = "made by hand";
    expect(planOrderGuides(t, sheets).find((p) => p.vendor === "PFG")!.status).toBe("refused");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement the seed.** Follow seed 36's skeleton exactly (imports, `validateArgs`, `readTables` via `loadAll`, dry-run digest, `--execute --plan-digest`, per-plan re-read + `verifyWriteScope` + audit readback via `record`). The new parts:

```ts
export const SOURCE = "order-guides-2026-09-13";
export type SheetName = "pfg_leonard" | "boars_head";
export interface SheetRow { section: string; item: string; item_number?: string; par?: string; vendor?: string; pack_note?: string; note?: string }
export type Sheets = Record<SheetName, SheetRow[]>;
export const SECTION_NAMES: Record<string, Record<string, string>> = {
  "Leonard Paper": { "Packaging (Leonard Paper)": "Packaging", "Leonard Paper / Trimark": "Leonard Paper" },
  Trimark: { "Leonard Paper / Trimark": "Trimark" },
};
const VENDOR_KEY: Record<string, string> = { PFG: "PFG", "Leonard Paper": "Leonard Paper", TRIMARK: "Trimark", Trimark: "Trimark" };
const BH_SECTIONS = new Set(["Boar's Head", "Peppers"]);

export function routeRow(sheet: SheetName, row: SheetRow): { vendor: string; section: string } {
  if (sheet === "pfg_leonard") {
    const v = VENDOR_KEY[row.vendor ?? ""];
    if (!v) return { vendor: "report", section: row.section };
    return { vendor: v, section: SECTION_NAMES[v]?.[row.section] ?? row.section };
  }
  return BH_SECTIONS.has(row.section) ? { vendor: "Boar's Head", section: "Boar's Head" } : { vendor: "by_sku", section: row.section };
}
```

Matching (`matchSku(row, vendorSkus)`): (1) `item_number` present and ≠ "N/A" → the single SKU with that `item_number`; (2) `norm(name) === norm(row.item)` (import `norm` from `@/lib/po-match-shared`); (3) exactly one SKU whose normalised name contains the normalised label → that one; more than one → `null` + report line `ambiguous: <label> → [names]`; none → `null` + report `no match: <label>`. For `by_sku` rows match against ALL active SKUs, and the matched SKU's vendor decides the guide; unmatched `by_sku` → report only.

Plan shape: `{ vendor, kind: "sheet" | "starter", status: "ready" | "already" | "refused", sections: [{ name, lines: [{ label, itemNumber, skuId }] }], rematch: [{ lineId, skuId }], append: [{ sectionName, line }], report: string[], before, expected }`. Repeats: a SKU already placed earlier in the same plan → not a line, report `repeat: <label> (row N, first at row M)`. Starter guides: every active vendor with ≥1 active SKU and no guide after routing → `kind: "starter"`, one section named after the vendor, lines = active SKUs by name, `source_note` `[order-guides-2026-09-13 starter]`. Existing guides: `source_note` not starting `[order-guides-2026-09-13` → `refused`; else compute `rematch` (null-sku lines the rules now match) and `append` (sheet rows with no line by `label + item_number`) — both empty → `already`; hand-placed lines are never moved/relabelled/removed.

Apply: insert guide → sections → lines (ids via `randomUUID()`), audits `vendor.order_guide.seeded` (register in Task 9) on the guide row with `metadata.source = SOURCE`; for rematch/append plans, UPDATE the null-sku line (guarded `update` from seed 36) / INSERT the appended line at `max(position)+1`. `verifyWriteScope` allows: new rows in the three guide tables whose guide belongs to this plan's vendor; `sku_id` on the rematched line ids; nothing else. The report is written to `.claude/council/2026-09-09-launch-readiness/outputs/seed37-report-<target>.txt` in addition to stdout.

The transcription is read from `docs/seed/source/order-guide-2026-09-13.json` inside `main()` and passed to the planner (the planner never reads files — the tests pass sheets in).

- [ ] **Step 4: Run** `npx vitest run tests/seed-37-order-guides.test.ts` → PASS. Dry-run on the sim: `npx tsx --env-file=.env.sim scripts/seed/37-order-guides.ts --target sim --dry-run` → a table with one row per vendor and the digest.

- [ ] **Step 5: Commit** — `git add scripts/seed/37-order-guides.ts tests/seed-37-order-guides.test.ts && git commit -m "feat(seed): seed 37 — order guides from the 2026-09-13 laminates (+ starter guides), rerun re-matches only"`

---

### Task 8: Admin — API route + Order guide tab

**Files:**
- Create: `app/api/admin/vendors/[id]/order-guide/route.ts`
- Create: `components/admin/vendors/OrderGuidePanel.tsx`
- Modify: `app/admin/vendors/[id]/page.tsx` (load + mount)
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/order-guide-route.test.ts`

- [ ] **Step 1: Write the failing route test** (mirror `tests/*route*.test.ts` harness: mocked `requireSession`, `assertSameOrigin`, and `@/lib/order-guides`):

```ts
// GET  → 200 { guide: GuideModel | null, skusNotOnGuide: [{skuId,name,itemNumber}] }; employee (level 3) → 403; KH (4) → 200 (read is KH+ so the PO panel can link here).
// POST { model, expectedUpdatedAt } → GM (7) 200 with the saved model; AGM (6) → 403; cross-origin → 403;
//      saveOrderGuide throwing OrderGuideError(409,"guide_stale") → 409 body { error: "guide_stale" };
//      malformed body (model.sections not an array) → 400 invalid_payload.
// POST { create: true } when no guide exists → creates an empty guide named "<vendor> — guide" and returns it (GM+).
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement the route**

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { createEmptyGuide, loadOrderGuide, ORDER_GUIDE_EDIT_MIN, OrderGuideError, saveOrderGuide, type GuideModel } from "@/lib/order-guides";

const READ_MIN = 4; // key holder — the PO panel deep-links here

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/order-guide`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < READ_MIN) return jsonError(403, "forbidden");
  const guide = await loadOrderGuide(id);
  const sb = getServiceRoleClient();
  const placed = new Set(guide?.sections.flatMap((s) => s.lines.map((l) => l.skuId)).filter(Boolean) ?? []);
  const { data: skus, error } = await sb.from("vendor_items").select("id, name, item_number").eq("vendor_id", id).eq("active", true).order("name")
    .returns<Array<{ id: string; name: string; item_number: string | null }>>();
  if (error) return jsonError(500, "internal_error");
  return jsonOk({ guide, skusNotOnGuide: (skus ?? []).filter((s) => !placed.has(s.id)).map((s) => ({ skuId: s.id, name: s.name, itemNumber: s.item_number })) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = assertSameOrigin(req); if (origin) return origin;
  const parsed = await parseJsonBody(req); if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/order-guide`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ORDER_GUIDE_EDIT_MIN) return jsonError(403, "forbidden");
  const b = parsed as Record<string, unknown>;
  try {
    if (b.create === true) return jsonOk({ guide: await createEmptyGuide(ctx, id) }, 201);
    const model = b.model as GuideModel | undefined;
    if (!model || typeof model !== "object" || !Array.isArray(model.sections) || typeof b.expectedUpdatedAt !== "string") return jsonError(400, "invalid_payload");
    return jsonOk({ guide: await saveOrderGuide(ctx, id, model, b.expectedUpdatedAt) });
  } catch (e) {
    if (e instanceof OrderGuideError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

Add `createEmptyGuide(actor, vendorId)` to `lib/order-guides.ts`: inserts `{ vendor_id, name: "<vendor name> — guide", source_note: "[admin] created by <actor name>" }` (409 `exists` if one exists), audits `vendor.order_guide.edited` with `before: null`, returns `loadOrderGuide`.

- [ ] **Step 4: Implement the panel.** `OrderGuidePanel.tsx` (client island, `"use client"`), props `{ vendorId, vendorName, initial: { guide, skusNotOnGuide }, canEdit: boolean }`:
  - State: `model` (GuideModel | null), `bucket` (SKUs not on the guide), `dirty`, `saving`, `error`.
  - Every button dispatches `applyGuideEdit(model, edit)` locally (import from `@/lib/order-guides` — the reducer is pure and safe on the client; the DB functions are not imported by this component, so keep them in the same module but ensure `lib/order-guides.ts` does NOT import `server-only`; if the project's lint forbids client imports of a server module, split the reducer into `lib/order-guide-edit.ts` and re-export from `lib/order-guides.ts`).
  - Layout (phone-first, 44 px targets): a header row with the guide name + "Save" (disabled unless dirty) + "Discard"; sections as `co-card` blocks with ▲ ▼ ✎ 🗑 and their lines as rows: label, item number (muted), SKU chip (name) or a red "needs a SKU" chip that opens a `<select>` of `bucket`; per line ▲ ▼, "Move to…" `<select>` of other sections, ✕. "Add section" input+button at the bottom. A side bucket "Active SKUs not on the guide" with a "Place in [section ▾]" control per SKU. When `model` is null and `canEdit`: a single "Create guide" button (POST `{create:true}`).
  - Save: `POST { model, expectedUpdatedAt: model.updatedAt }`; on 409 `guide_stale` show `admin.order_guide.stale` and reload via GET; on success replace `model` and recompute `bucket`.
  - i18n keys (en/es): `admin.order_guide.heading` "Order guide" / "Guía de pedido" · `.create` "Create guide" / "Crear guía" · `.save` "Save order" / "Guardar orden" · `.discard` "Discard changes" / "Descartar cambios" · `.add_section` "Add section" / "Agregar sección" · `.section_name` "Section name" / "Nombre de la sección" · `.needs_sku` "needs a SKU" / "falta el SKU" · `.move_to` "Move to…" / "Mover a…" · `.bucket` "Active SKUs not on the guide" / "SKUs activos fuera de la guía" · `.place_in` "Place in" / "Colocar en" · `.stale` "Someone else changed this guide. Reloaded — redo your change." / "Alguien más cambió esta guía. Se recargó: repite tu cambio." · `.saved` "Saved" / "Guardado" · `.empty` "No guide yet for this vendor." / "Este proveedor aún no tiene guía." · `.up` "Move up" / "Subir" · `.down` "Move down" / "Bajar" · `.remove` "Remove" / "Quitar" · `.rename` "Rename" / "Renombrar".
  - `app/admin/vendors/[id]/page.tsx`: add `loadOrderGuide(id)` and the bucket read to the existing `Promise.all`, and mount `<OrderGuidePanel … canEdit={ROLES[auth.user.role].level >= ORDER_GUIDE_EDIT_MIN} />` after the rhythm card.

- [ ] **Step 5: Run** `npx vitest run tests/order-guide-route.test.ts` → PASS; `npx tsc --noEmit`; `npx eslint app/api/admin/vendors components/admin/vendors lib/order-guides.ts` → clean. Boot `npm run dev` against `.env.sim`, open `/admin/vendors/<PFG id>` as Marcus (PIN 9999) and screenshot the tab after seed 37 (Task 10) — attach to the PR. **Then `rm -rf .next-sim-launch/dev` and `git checkout -- tsconfig.json`.**

- [ ] **Step 6: Commit** — `git add app/api/admin/vendors/[id]/order-guide components/admin/vendors/OrderGuidePanel.tsx app/admin/vendors/[id]/page.tsx lib/order-guides.ts lib/i18n && git commit -m "feat(admin): Order guide tab — sections/lines with up/down, place-from-bucket, guarded save (V3-A §6)"`

---

### Task 9: Registrations and dead-column sweep

**Files:**
- Modify: `lib/audit-actions.ts` — add `"vendor.order_guide.edited"`, `"vendor.order_guide.seeded"` to `NON_DESTRUCTIVE_ACTIONS`
- Modify: `scripts/seed/35-floor-answers-2026-09-13.ts:342` — remove the explicit `guide_position: null`
- Modify: `lib/receiving.ts:1097` — unchanged behaviour (orders by the snapshot); update the comment to name V3-A
- Modify: `AGENTS.md` — lineage note → 0205 (one line, where 0204 is mentioned)
- Sweep: `grep -rn "guide_position\b" app lib components scripts tests` must return only `guide_position_snapshot` uses

- [ ] **Step 1:** Make the edits. **Step 2:** `npx vitest run` (full) → all green; `npx tsc --noEmit` → clean; `npm run discipline` if the repo defines it (check `package.json` scripts) → PASS. **Step 3: Commit** — `git commit -am "chore(ordering): register order-guide audit actions; sweep the dropped guide_position column; lineage 0205"`

---

### Task 10: Sim proof — seed 37 on sim, harness suite, new claim, PR

**Files:**
- Modify: `scripts/sim/launch-readiness/claims.json` (one claim) and `scripts/sim/launch-readiness/journeys/ordering-receiving.spec.ts` (one assertion)

- [ ] **Step 1: Seed the sim.** `npx tsx --env-file=.env.sim scripts/seed/37-order-guides.ts --target sim --dry-run` → copy the digest → `… --execute --plan-digest <digest>` → every vendor `verified:`; read `outputs/seed37-report-sim.txt`.

- [ ] **Step 2: Add the claim.** In `claims.json` next to `ordering.po.snapshot`:
```json
{ "id": "ordering.po.guide-order", "guide": { "path": "docs/guides/manager-guide.md", "revision": "<current>", "section": "Ordering and purchase orders", "quote": "<the sentence the guide gains in this PR: 'The order lists items in the vendor's own guide order, section by section, so you can key it into their portal top to bottom.'>", "quoteSha256": "<sha>" },
  "actor": "key holder (Rosa at EM; Tommy at MEP)", "preconditions": "Fixture cold-empty + seed 37 guides.", "expected": "A confirmed PO's copied body lists lines under section headers in guide order; a SKU not on the guide is last under 'Not on the guide'.", "assertionId": "ordering.po.guide-order", "evidence": null, "status": "pending" }
```
Add that sentence to `docs/guides/manager-guide.md` (and the Spanish guide if it exists) in the ordering section. In `ordering-receiving.spec.ts`, after `ordering.po.snapshot`: fetch the PO detail JSON, compute the expected order with `groupByGuideSection`, `mark("ordering.po.guide-order")`, `expect(actualOrder).toEqual(expectedOrder)` and `expect(body).toContain("— Not on the guide —")` when a non-guide SKU is on the order.

- [ ] **Step 3: Run the suite.** `rm -rf .next-sim-launch/dev; git checkout -- tsconfig.json` (in `~/co-ops`), then on the clone:
```bash
cd ~/co-ops-astra && git fetch && git checkout feat/vendor-ordering-v3a-guides && git pull
LRA_PROJECTS=phone-en ~/.claude/hooks/lra-launch.sh v3a-ordering ~/co-ops-astra -- bash ~/.claude/hooks/lra-suite.sh ~/co-ops-astra ordering cold-empty
```
watch with `lra-watch.sh` → expected `DONE … pass`. (The harness restores the fixture; `CONFIG` inventory includes the guides so they survive the restore — if the run reports the guide tables missing, the manifest edit in Task 1 was wrong.)

- [ ] **Step 4: Open the PR** against `main` with: what/why (Juan's rule), the spec + Aggie adjudication link, the seed 37 sim report summary (lines per vendor, unmatched count), the admin tab screenshot, the suite run id, and "prod: 0205 then seed 37 on Juan's word". CI must be green. **Stop there** (auto-mode merge boundary: Juan merges).

---

## Self-review (done while writing)

- **Spec coverage:** §3 tables/snapshot/drop → T1, T5; §4 comparator + every surface + one body renderer → T2, T4, T6; §5 seed rules 1–6 incl. section map, dedup, by_sku routing, starter guides, rerun-rematch → T7; §6 admin tab + route + audit + 409 → T3, T8, T9; §7 errors (no guide, stale, seed ambiguity) → T3/T7/T8; §8 tests → each task; §10 rollout → T1, T10. Receiving prefill (§4 table) is untouched by design → T9 comment only.
- **Placeholders:** the two `<current>`/`<sha>` fields in T10's claim are computed values the harness's claim tooling prints (`scripts/sim/launch-readiness/claims.json` convention), not TBDs; the manager-guide sentence is given verbatim.
- **Type consistency:** `GuideKey {position, section}` (T3) is what T5/T6 consume; `PoLineView.guideSection` (T5) feeds `PoBodyLine.guideSection` (T4/T6); `WalkerSku.guidePosition/guideSection` (T6) match the preview's mapping; `OrderGuideError(status, code)` (T3) is what T8 maps to `jsonError`.

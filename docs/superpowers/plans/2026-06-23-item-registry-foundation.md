# Item Registry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the item-registry data model (`items` + empty `item_components` + an `item_id` bridge on `checklist_template_items`) and backfill it from today's prep/opening lines — **entirely behind the scenes, zero operator-flow change.**

**Architecture:** Additive DDL (migration 0079) + a committed, idempotent, dry-run-capable `tsx` backfill that dedups AM-prep↔Opening (FK) and mid-day (name+section) into distinct items, links every line via `item_id`, and emits a merge manifest. Nothing reads `item_id` this slice; operator forms keep reading `prep_meta`.

**Tech Stack:** Supabase Postgres 17 (custom-JWT + RLS; service-role for admin/system writes; append-only — deactivate via `active`, never delete), Next.js 16, TS strict + `noUncheckedIndexedAccess`. Migrations via Supabase MCP `apply_migration` (prod ref `bgcvurheqzylyfehqgzh`) + captured in `supabase/migrations/`. No test framework: `tsc --noEmit` + `next build` + the backfill's own correctness queries.

**Spec:** `docs/superpowers/specs/2026-06-22-item-registry-foundation-design.md`
**Parent arch:** `docs/superpowers/specs/2026-06-22-item-inventory-spine-architecture.md`

**Ground truth (verified live 2026-06-23):** latest migration `0078_add_user_locations_active` → this is **0079**. Actor for system writes: `JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed"`, `actor_role: "cgs"` (per existing seed scripts). `checklist_template_items` has `vendor_item_id` (left as-is) — we add a separate `item_id`. AM-prep↔Opening linked by `opening.references_template_item_id = am_prep.id`. `lib/types.ts` has `VendorItem`/`ParLevel` (camelCase), no `Item`.

**⚠️ This writes to PRODUCTION data** (creates `items`, sets `item_id` on real rows). The backfill is idempotent + has a `--dry-run`. **Task 5's real run is controller-executed (CC) after reviewing the dry-run manifest — not delegated to a subagent.**

---

## File Structure
| File | Responsibility |
|---|---|
| `lib/destructive-actions.ts` (modify) | Add `item.create`, `item.backfill`. |
| migration `0079_item_registry_foundation` (MCP) + `supabase/migrations/0079_item_registry_foundation.sql` (capture) | DDL: `items`, `item_components`, `item_id` column, RLS. |
| `lib/types.ts` (modify) | `ItemKind`, `Item`, `ItemComponent`. |
| `scripts/backfill-item-registry.ts` (create, **committed**) | Idempotent dedup→create→link→manifest, `--dry-run`. |

No throwaway smokes (the backfill IS the verification tool and is committed).

---

### Task 1: Audit actions

**Files:** Modify `lib/destructive-actions.ts`

- [ ] **Step 1:** Add an "Item / inventory registry" block (place after the Checklist template lifecycle block):

```ts
  // Item / inventory registry (Item/Inventory Spine, sub-project 1).
  // — item lifecycle on the new registry. Auto-derive destructive via isDestructive().
  "item.create",
  "item.backfill",
```

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean).
- [ ] **Step 3:** Commit:
```bash
git add lib/destructive-actions.ts
git commit -m "feat(spine): item.create + item.backfill audit actions"
```

---

### Task 2: Migration 0079 — DDL

**Files:** apply via Supabase MCP, then capture `supabase/migrations/0079_item_registry_foundation.sql`

- [ ] **Step 1: Verify the number.** Supabase MCP `list_migrations` → confirm latest is `0078_add_user_locations_active` and nothing named `0079*` exists. (If it does, bump.)

- [ ] **Step 2: Apply the migration** via Supabase MCP `apply_migration` (name `0079_item_registry_foundation`, project `bgcvurheqzylyfehqgzh`) with this SQL:

```sql
-- items: the item registry (SKU-direct / composite / manual). Two-tier:
-- location_id NULL = global default, SET = location-owned. Append-only (active).
CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES public.locations(id),
  kind text NOT NULL DEFAULT 'manual' CHECK (kind IN ('sku_direct','composite','manual')),
  name text NOT NULL,
  name_es text,
  section text,
  default_par numeric,
  default_par_unit text,
  unit text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX items_location_active_idx ON public.items (location_id, active);
CREATE INDEX items_location_name_section_idx ON public.items (location_id, lower(name), section);

-- item_components: structured costing BOM. Created EMPTY this slice.
-- Distinct from the free-text recipes/recipe_ingredients training tables.
CREATE TABLE public.item_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id),
  component_sku_id uuid REFERENCES public.vendor_items(id),
  component_item_id uuid REFERENCES public.items(id),
  quantity numeric NOT NULL,
  unit text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT item_components_exactly_one_ref CHECK (
    ((component_sku_id IS NOT NULL)::int + (component_item_id IS NOT NULL)::int) = 1
  )
);
CREATE INDEX item_components_item_idx ON public.item_components (item_id);

-- The bridge: report lines reference an item (nullable; unused until sub-project 2).
ALTER TABLE public.checklist_template_items
  ADD COLUMN item_id uuid REFERENCES public.items(id);
CREATE INDEX checklist_template_items_item_id_idx ON public.checklist_template_items (item_id);

-- RLS: service-role only (admin/system). No permissive end-user policy this slice;
-- explicit denies per the _no_user_* convention + the FOR-ALL-permits-DELETE footgun
-- (split per op; never FOR ALL).
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY items_no_user_insert ON public.items FOR INSERT WITH CHECK (false);
CREATE POLICY items_no_user_update ON public.items FOR UPDATE USING (false);
CREATE POLICY items_no_user_delete ON public.items FOR DELETE USING (false);

CREATE POLICY item_components_no_user_insert ON public.item_components FOR INSERT WITH CHECK (false);
CREATE POLICY item_components_no_user_update ON public.item_components FOR UPDATE USING (false);
CREATE POLICY item_components_no_user_delete ON public.item_components FOR DELETE USING (false);
```

- [ ] **Step 3: Verify live** via MCP `execute_sql`:
  - `information_schema.columns` shows `items` (16 cols), `item_components` (9 cols), and `checklist_template_items.item_id`.
  - `pg_policies` shows the 6 deny policies; `relrowsecurity=true` on both new tables.
  - The CHECK + FKs exist (`pg_constraint`).

- [ ] **Step 4: Capture the migration file** `supabase/migrations/0079_item_registry_foundation.sql` with the going-forward header, then the SQL above:
```sql
-- Migration 0079_item_registry_foundation
-- Applied via Supabase MCP apply_migration on 2026-06-23.
-- Canonical reference: docs/superpowers/specs/2026-06-22-item-registry-foundation-design.md
-- (Item/Inventory Spine sub-project 1 — registry foundation, behind the scenes.)

<the exact SQL from Step 2>
```

- [ ] **Step 5: Commit:**
```bash
git add supabase/migrations/0079_item_registry_foundation.sql
git commit -m "feat(spine): migration 0079 item registry foundation (items, item_components, item_id bridge)"
```

---

### Task 3: App-layer types

**Files:** Modify `lib/types.ts`

- [ ] **Step 1:** Re-read `lib/types.ts:110-140` (the `VendorItem`/`ParLevel` shapes) to match style. Add after `ParLevel`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Item / inventory registry (Item/Inventory Spine, sub-project 1)
// ─────────────────────────────────────────────────────────────────────────────

export type ItemKind = "sku_direct" | "composite" | "manual";

/**
 * Item registry row. The entity reports will reference (via
 * checklist_template_items.item_id). location_id NULL = global default; SET =
 * location-owned. Append-only (disable via active). prep par migrates here as
 * default_par; per-location par + BOM + classification land in later slices.
 * No consumers this slice (shape only).
 */
export interface Item {
  id: string;
  locationId: string | null;
  kind: ItemKind;
  name: string;
  nameEs: string | null;
  section: string | null;
  defaultPar: number | null;
  defaultParUnit: string | null;
  unit: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Costing BOM edge: a parent item's component is a SKU (vendor_item) XOR a sub-item. */
export interface ItemComponent {
  id: string;
  itemId: string;
  componentSkuId: string | null;
  componentItemId: string | null;
  quantity: number;
  unit: string | null;
  displayOrder: number;
  createdAt: string;
  createdBy: string | null;
}
```

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean — types-only, no consumers; this config doesn't error on unused exports).
- [ ] **Step 3:** Commit:
```bash
git add lib/types.ts
git commit -m "feat(spine): Item / ItemComponent / ItemKind app-layer types"
```

---

### Task 4: Backfill script (build + dry-run)

**Files:** Create `scripts/backfill-item-registry.ts` (committed)

Confirm-before-authoring: re-read `lib/supabase-server.ts` `getServiceRoleClient`, and `scripts/seed-am-prep-template.ts` (the `JUAN_USER_ID` const + the two-step query pattern + how it reads env).

- [ ] **Step 1: Write the script:**

```ts
/**
 * Backfill the item registry (Item/Inventory Spine sub-project 1) from today's
 * prep/opening lines. IDEMPOTENT + re-runnable. Behind the scenes — nothing
 * reads item_id yet.
 *
 *   Dry-run (writes NOTHING, prints manifest):
 *     npx tsx --env-file=.env.local scripts/backfill-item-registry.ts --dry-run
 *   Real run:
 *     npx tsx --env-file=.env.local scripts/backfill-item-registry.ts
 *
 * Dedup into distinct items, per location, processed AM-prep → mid-day → opening
 * so AM-prep is the canonical first-seen (conflict rule: default_par = AM-prep's):
 *   (a) Opening Phase-2 item + the AM-prep item it references (references_template_item_id) = ONE item.
 *   (b) A line whose normalized key (lower(trim(name)), section) matches an
 *       already-resolved item at that location = SAME item (conservative exact match).
 *   (c) Otherwise = a new item.
 * Idempotent: lines already item_id-set are respected (seed the maps from them);
 * existing items are found by normalized key before inserting.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";

const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";
const DRY_RUN = process.argv.includes("--dry-run");

type Tmpl = { id: string; type: string; prep_subtype: string | null; location_id: string };
type Line = {
  id: string;
  template_id: string;
  label: string;
  translations: { es?: { label?: string | null } } | null;
  station: string | null;
  prep_meta: Record<string, unknown> | null;
  references_template_item_id: string | null;
  item_id: string | null;
};
type MergeReason = "am_prep_opening_fk" | "name_section_match" | "standalone" | "preexisting";
interface ManifestEntry {
  itemId: string | null; // null in dry-run for would-be-created
  name: string;
  section: string | null;
  locationId: string;
  contributingLineIds: string[];
  mergeReason: MergeReason;
  /** The item's default par = the first contributing line's par (AM-prep first). */
  firstPar: number | null;
  /** Later lines whose par disagrees with firstPar (informational; default_par keeps firstPar). */
  parDivergence?: { firstPar: number | null; linePar: number | null; lineId: string }[];
}

function norm(name: string, section: string | null): string {
  return `${name.trim().toLowerCase()}|${(section ?? "").trim().toLowerCase()}`;
}
function metaStr(meta: Record<string, unknown> | null, k: string): string | null {
  const v = meta?.[k];
  return typeof v === "string" ? v : null;
}
function metaNum(meta: Record<string, unknown> | null, k: string): number | null {
  const v = meta?.[k];
  return typeof v === "number" ? v : null;
}

async function main() {
  const sb = getServiceRoleClient();
  const manifest: ManifestEntry[] = [];
  let created = 0;
  let linked = 0;

  const { data: locs, error: locErr } = await sb.from("locations").select("id").eq("active", true);
  if (locErr) throw new Error(`load locations: ${locErr.message}`);

  for (const loc of (locs ?? []) as { id: string }[]) {
    const locationId = loc.id;

    // Two-step (PostgREST embedded filters are fragile per AGENTS.md):
    // 1) prep + opening templates at this location.
    const { data: tmpls, error: tErr } = await sb
      .from("checklist_templates")
      .select("id, type, prep_subtype, location_id")
      .eq("location_id", locationId)
      .eq("active", true)
      .in("type", ["prep", "opening"]);
    if (tErr) throw new Error(`load templates ${locationId}: ${tErr.message}`);
    const tmplById = new Map((tmpls ?? []).map((t) => [t.id, t as Tmpl]));
    if (tmplById.size === 0) continue;

    // 2) active items for those templates.
    const { data: rawLines, error: lErr } = await sb
      .from("checklist_template_items")
      .select("id, template_id, label, translations, station, prep_meta, references_template_item_id, item_id")
      .in("template_id", [...tmplById.keys()])
      .eq("active", true);
    if (lErr) throw new Error(`load lines ${locationId}: ${lErr.message}`);

    // Keep prep lines + opening Phase-2 lines only (exclude closing/cleaning opening lines).
    const lines = ((rawLines ?? []) as Line[]).filter((ln) => {
      const t = tmplById.get(ln.template_id)!;
      if (t.type === "prep") return true;
      if (t.type === "opening") return ln.prep_meta?.["openingPhase2"] === true;
      return false;
    });

    // Stable processing order: AM-prep first, then mid-day, then opening.
    const rank = (ln: Line): number => {
      const t = tmplById.get(ln.template_id)!;
      if (t.type === "prep" && t.prep_subtype === "am_prep") return 0;
      if (t.type === "prep") return 1; // mid_day (and any other prep)
      return 2; // opening
    };
    lines.sort((a, b) => rank(a) - rank(b));

    // Resolution maps for this location.
    const itemIdByKey = new Map<string, string>();              // normKey → items.id
    const itemIdBySourceLineId = new Map<string, string>();     // am-prep line id → items.id (for opening FK)
    const manifestByItemId = new Map<string, ManifestEntry>();

    // Seed from already-linked lines (idempotency): existing item_id wins.
    for (const ln of lines) {
      if (ln.item_id) {
        const key = norm(ln.label, ln.station);
        itemIdByKey.set(key, ln.item_id);
        itemIdBySourceLineId.set(ln.id, ln.item_id);
      }
    }

    for (const ln of lines) {
      const name = ln.label.trim();
      const section = ln.station;
      const key = norm(name, section);
      const linePar = metaNum(ln.prep_meta, "parValue");

      // Resolve the target item id.
      let itemId: string | null = ln.item_id ?? null;
      let reason: MergeReason = ln.item_id ? "preexisting" : "standalone";

      if (!itemId && ln.references_template_item_id) {
        const refId = itemIdBySourceLineId.get(ln.references_template_item_id);
        if (refId) { itemId = refId; reason = "am_prep_opening_fk"; }
      }
      if (!itemId && itemIdByKey.has(key)) { itemId = itemIdByKey.get(key)!; reason = "name_section_match"; }

      // Check DB for a pre-existing item by key (prior run) before creating.
      if (!itemId && !DRY_RUN) {
        const { data: existing, error: exErr } = await sb
          .from("items")
          .select("id, default_par")
          .eq("location_id", locationId)
          .eq("section", section)
          .ilike("name", name) // case-insensitive exact (name has no % wildcards)
          .limit(1)
          .maybeSingle<{ id: string; default_par: number | null }>();
        if (exErr) throw new Error(`lookup existing item: ${exErr.message}`);
        if (existing) { itemId = existing.id; reason = "preexisting"; }
      }

      // Create a new item if still unresolved.
      if (!itemId) {
        if (DRY_RUN) {
          // Synthesize a placeholder id grouping for the manifest.
          itemId = `DRYRUN:${locationId}:${key}`;
          reason = reason === "preexisting" ? "preexisting" : "standalone";
        } else {
          const { data: ins, error: insErr } = await sb
            .from("items")
            .insert({
              location_id: locationId,
              kind: "manual",
              name,
              name_es: ln.translations?.es?.label ?? null,
              section,
              default_par: linePar,
              default_par_unit: metaStr(ln.prep_meta, "parUnit"),
              active: true,
              created_by: JUAN_USER_ID,
              updated_by: JUAN_USER_ID,
            })
            .select("id")
            .single();
          if (insErr) throw new Error(`insert item (${name}): ${insErr.message}`);
          itemId = ins.id;
          created++;
        }
        itemIdByKey.set(key, itemId);
      }
      // Track am-prep source-line → item for opening FK resolution.
      itemIdBySourceLineId.set(ln.id, itemId);

      // Link the line (skip if already correct).
      if (!DRY_RUN && ln.item_id !== itemId) {
        const { error: upErr } = await sb
          .from("checklist_template_items")
          .update({ item_id: itemId })
          .eq("id", ln.id);
        if (upErr) throw new Error(`link line ${ln.id}: ${upErr.message}`);
        linked++;
      }

      // Manifest. default_par = the first contributing line's par (AM-prep is
      // processed first, so first-seen == AM-prep's value per the conflict rule).
      let entry = manifestByItemId.get(itemId);
      if (!entry) {
        entry = {
          itemId: itemId.startsWith("DRYRUN:") ? null : itemId,
          name,
          section,
          locationId,
          contributingLineIds: [],
          mergeReason: reason,
          firstPar: linePar,
        };
        manifestByItemId.set(itemId, entry);
        manifest.push(entry);
      } else if (linePar !== null && linePar !== entry.firstPar) {
        (entry.parDivergence ??= []).push({ firstPar: entry.firstPar, linePar, lineId: ln.id });
      }
      entry.contributingLineIds.push(ln.id);
    }
  }

  console.log(JSON.stringify({ dryRun: DRY_RUN, created, linked, itemCount: manifest.length, manifest }, null, 2));

  if (!DRY_RUN) {
    await sb.from("audit_log").insert({
      actor_id: JUAN_USER_ID,
      actor_role: "cgs",
      action: "item.backfill",
      resource_table: "items",
      resource_id: null,
      metadata: { created, linked, item_count: manifest.length, ip_address: null, user_agent: null },
      destructive: true,
    });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

> **NOTE for the implementer:** the code above is complete. The `itemIdBySourceLineId` map is seeded from already-linked lines (idempotency) AND updated as each line resolves, so opening items resolve their AM-prep FK whether the AM-prep line was just processed this run or linked in a prior run. In dry-run, unresolved-new items get a synthetic `DRYRUN:<loc>:<key>` grouping id (manifest `itemId: null`) — never written. Verify the whole file with `tsc`; fix only genuine type errors, don't restructure the dedup logic.

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean). Fix any type issues (especially the divergence block).

- [ ] **Step 3: Dry-run against prod** (writes nothing):
```bash
npx tsx --env-file=.env.local scripts/backfill-item-registry.ts --dry-run
```
Expected: JSON with `dryRun:true`, `created:0`, `linked:0`, and a `manifest` array. Eyeball it: item names/sections look right; AM-prep↔Opening pairs grouped; mid-day matches look correct; no absurd merges. **Paste the manifest in your report.**

- [ ] **Step 4: Commit the script (dry-run-verified):**
```bash
git add scripts/backfill-item-registry.ts
git commit -m "feat(spine): idempotent item-registry backfill script (dry-run verified)"
```

---

### Task 5: Run the real backfill + verify (CONTROLLER-EXECUTED — CC, not a subagent)

**This step mutates production data. CC runs it after reviewing the Task-4 dry-run manifest.**

- [ ] **Step 1:** CC reviews the dry-run manifest (item count reconciles with ~the expected distinct items across MEP+EM; spot-check merges). If anything looks wrong, fix the script + re-dry-run before proceeding.
- [ ] **Step 2:** Real run:
```bash
npx tsx --env-file=.env.local scripts/backfill-item-registry.ts
```
Expected: `dryRun:false`, `created > 0`, `linked > 0`, manifest with real itemIds.
- [ ] **Step 3: Correctness queries** (Supabase MCP `execute_sql`):
```sql
-- every active prep/opening-Phase2 line is linked
select count(*) as unlinked from checklist_template_items i
 join checklist_templates t on t.id=i.template_id
 where t.active and i.active and i.item_id is null
   and (t.type='prep' or (t.type='opening' and i.prep_meta->>'openingPhase2'='true'));
-- expect 0

-- AM-prep↔Opening FK pairs share one item
select count(*) as mismatched from checklist_template_items o
 join checklist_template_items a on a.id=o.references_template_item_id
 where o.references_template_item_id is not null and o.item_id is distinct from a.item_id;
-- expect 0

-- no duplicate items by normalized key
select location_id, lower(name), section, count(*) c from items
 group by location_id, lower(name), section having count(*)>1;
-- expect 0 rows

-- BOM empty; counts
select (select count(*) from item_components) as components,
       (select count(*) from items) as items;
```
- [ ] **Step 4:** Re-run the script once more → confirm `created:0, linked:0` (idempotency holds).
- [ ] **Step 5:** No commit (data-only run; the script + migration are already committed). Record the manifest + query results in the PR description.

---

### Task 6: Operator-flow smoke (invisible-change check)

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` — clean.
- [ ] **Step 2:** Confirm `prep_meta` untouched + forms unaffected (Supabase MCP):
```sql
select count(*) as prep_lines_with_meta from checklist_template_items where prep_meta is not null and active;
```
Compare to a pre-backfill baseline (should be unchanged — backfill never writes `prep_meta`).
- [ ] **Step 3:** Juan preview-smoke note (for PR): open AM-prep + Opening on preview → render identically to prod (item_id is invisible). No behavior change expected.

---

### Task 7: Final gate

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` — clean.
- [ ] **Step 2:** `git diff --stat origin/main` — only: `lib/destructive-actions.ts`, `supabase/migrations/0079_*.sql`, `lib/types.ts`, `scripts/backfill-item-registry.ts`, + spec/plan docs.
- [ ] **Step 3:** `git ls-files scripts/ | grep -i manifest || echo "clean"` — the manifest is run-output, NOT committed (printed to console / captured in PR).
- [ ] **Step 4: Push + PR:**
```bash
git push -u origin claude/item-registry-foundation
gh pr create --title "Item/Inventory Spine #1: registry foundation (behind the scenes)" --body "<summary + manifest + correctness query results + 'operator forms unchanged'>"
```
PR body: emphasize **additive / zero operator change / nothing reads item_id yet**; include the backfill manifest + the correctness query outputs; note migration 0079.

---

## Notes for the implementer
- **Re-read before authoring:** `lib/supabase-server.ts` (`getServiceRoleClient`), `scripts/seed-am-prep-template.ts` (JUAN_USER_ID + two-step query + env check), `lib/types.ts:110-140`.
- **Append-only:** never DELETE; the registry uses `active`. The migration adds deny-delete policies.
- **Idempotency is the safety net** — the real backfill must be safely re-runnable (Task 5 Step 4 proves it).
- **The backfill is committed** (it's a real, re-runnable data tool), unlike throwaway smokes.
- **Task 5 is CC-executed** (prod data). Subagents do Tasks 1–4, 6; CC does Task 5 + the final review.
- **Out of scope:** vendor_items changes, par_levels, BOM population, classification, any registry read. Don't drift.

# Registry Goes Live (par + name) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the item registry the source of truth for prep-line **par + name** — loaders + the C.44 submit-snapshots resolve them from the linked item, the admin editor writes them to the item (edit-once-everywhere), and `propagateParToOpeningMirror` retires.

**Architecture:** A pure `resolveLineDefinition(line, item)` resolver, applied in the operator loaders + the AM-prep submit snapshot + the opening Phase-2 snapshot materialization. Admin par/name edits resolve the line's `item_id` and UPDATE `items`. Safe because the #82 backfill made item == prep_meta today, proven by a committed equality-check (expect 0 drift) before the flip. No migration.

**Tech Stack:** Next.js 16, Supabase (service-role for admin/system; C.44 snapshots freeze history; append-only), TS strict + `noUncheckedIndexedAccess`. `tsc` + `next build` + the equality check + throwaway smoke.

**Spec:** `docs/superpowers/specs/2026-06-23-registry-goes-live-design.md` · **Parent arch:** `docs/superpowers/specs/2026-06-22-item-inventory-spine-architecture.md`

**Ground truth (verified live 2026-06-23):**
- `submitAmPrep` (lib/prep.ts ~2200) loads template items **independently** → needs an **explicit** snapshot cutover.
- `submitMidDayPhase1` (~1054) + `saveMidDayPhase2Item` (~1144) use `loadMidDayPrepState` → their snapshots get the cutover **free** once the loader is cut over (Task 3). Verify in the smoke.
- `submitAmPrepUpdate` (~2521) reuses frozen chain-head snapshots — **NOT a cutover site; leave it.**
- `loadOpeningState` (lib/opening.ts ~702) builds `snapshotsJson` par from `(it.prepMeta as OpeningPhase2Meta).parValue` — cut the `par_value`/`par_unit` source to the linked item.
- `lib/admin/templates.ts`: `updatePrepItemContent` writes par→`prep_meta` + label→line, calls `propagateParToOpeningMirror`. `changePrepItemSection` uses `setOpeningMirrorSection`→`resolveActiveOpeningTemplateId` — **keep those** (section still line-level).
- `Item` type (lib/types.ts): `name`, `nameEs`, `defaultPar`, `defaultParUnit`. `ChecklistTemplateItem`: `id`, `label`, `translations.es.label`, `prepMeta.parValue/parUnit`.

---

## File Structure
| File | Responsibility |
|---|---|
| `lib/items.ts` (create) | `ItemDefn` type + pure `resolveLineDefinition`. |
| `scripts/check-item-prepmeta-parity.ts` (create, committed) | Read-only equality check (item vs prep_meta/label). |
| `lib/prep.ts` (modify) | `loadAmPrepState` + `loadMidDayPrepState` read cutover; `submitAmPrep` snapshot cutover. |
| `lib/opening.ts` (modify) | `loadOpeningState` Phase-2 `par_value`/`par_unit` cutover. |
| `lib/admin/templates.ts` (modify) | par+name edits → item; retire `propagateParToOpeningMirror`. |
| `components/admin/templates/PrepItemEditPanel.tsx` (modify) | small "edits this item everywhere" note (i18n). |
| `lib/i18n/{en,es}.json` (modify) | one key for the note. |

No throwaway smokes committed; the equality-check script IS committed (a real tool).

---

### Task 1: `resolveLineDefinition` resolver

**Files:** Create `lib/items.ts`

- [ ] **Step 1:** Re-read `lib/types.ts` `Item` + `ChecklistTemplateItem`. Create `lib/items.ts`:

```ts
/**
 * Item-registry resolution helpers (Item/Inventory Spine 2A).
 * Pure. The single place that decides a prep/opening line's displayed
 * name + par: from the linked item when present, else a defensive fallback
 * to the line's own prep_meta/label (shouldn't fire post-#82 backfill).
 */
import type { ChecklistTemplateItem } from "@/lib/types";

/** Minimal item fields needed to resolve a line's name + par. */
export interface ItemDefn {
  name: string;
  nameEs: string | null;
  defaultPar: number | null;
  defaultParUnit: string | null;
}

export interface ResolvedDefinition {
  name: string;
  nameEs: string | null;
  par: number | null;
  parUnit: string | null;
}

export function resolveLineDefinition(
  line: ChecklistTemplateItem,
  item: ItemDefn | null,
): ResolvedDefinition {
  if (item) {
    return { name: item.name, nameEs: item.nameEs, par: item.defaultPar, parUnit: item.defaultParUnit };
  }
  console.warn(`[items] resolveLineDefinition: line ${line.id} has no linked item; falling back to prep_meta/label`);
  return {
    name: line.label,
    nameEs: line.translations?.es?.label ?? null,
    par: line.prepMeta?.parValue ?? null,
    parUnit: line.prepMeta?.parUnit ?? null,
  };
}

/** Batch-load ItemDefn by id for a set of item_ids (service-role). */
export async function loadItemDefns(
  service: import("@supabase/supabase-js").SupabaseClient,
  itemIds: string[],
): Promise<Map<string, ItemDefn>> {
  const map = new Map<string, ItemDefn>();
  const ids = [...new Set(itemIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return map;
  const { data, error } = await service
    .from("items")
    .select("id, name, name_es, default_par, default_par_unit")
    .in("id", ids);
  if (error) throw new Error(`loadItemDefns: ${error.message}`);
  for (const r of (data ?? []) as Array<{ id: string; name: string; name_es: string | null; default_par: number | null; default_par_unit: string | null }>) {
    map.set(r.id, { name: r.name, nameEs: r.name_es, defaultPar: r.default_par, defaultParUnit: r.default_par_unit });
  }
  return map;
}
```

- [ ] **Step 2:** `npx tsc --noEmit` (clean — no consumers yet).
- [ ] **Step 3:** Commit:
```bash
git add lib/items.ts
git commit -m "feat(spine): resolveLineDefinition + loadItemDefns (item-registry resolver)"
```

---

### Task 2: Equality-check script + run

**Files:** Create `scripts/check-item-prepmeta-parity.ts` (committed)

- [ ] **Step 1:** Create the read-only check (mirror the env/getServiceRoleClient pattern from `scripts/backfill-item-registry.ts`):

```ts
/**
 * Read-only parity check (Item/Inventory Spine 2A): confirms item.default_par ==
 * prep_meta.parValue and item.name == label for every active prep/opening-Phase2
 * line with an item_id. Must report 0 drift before the read cutover flips.
 *   npx tsx --env-file=.env.local scripts/check-item-prepmeta-parity.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";

async function main() {
  const sb = getServiceRoleClient();
  const { data: tmpls, error: tErr } = await sb
    .from("checklist_templates").select("id, type").in("type", ["prep", "opening"]).eq("active", true);
  if (tErr) throw new Error(tErr.message);
  const tmplType = new Map((tmpls ?? []).map((t) => [(t as { id: string }).id, (t as { type: string }).type]));

  const { data: rows, error } = await sb
    .from("checklist_template_items")
    .select("id, template_id, label, prep_meta, item_id, active")
    .in("template_id", [...tmplType.keys()])
    .eq("active", true);
  if (error) throw new Error(error.message);

  const lines = ((rows ?? []) as Array<{ id: string; template_id: string; label: string; prep_meta: Record<string, unknown> | null; item_id: string | null }>)
    .filter((r) => {
      const ty = tmplType.get(r.template_id);
      return ty === "prep" || (ty === "opening" && r.prep_meta?.["openingPhase2"] === true);
    });

  const itemIds = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))];
  const { data: items, error: iErr } = await sb.from("items").select("id, name, default_par").in("id", itemIds);
  if (iErr) throw new Error(iErr.message);
  const itemById = new Map((items ?? []).map((i) => [(i as { id: string }).id, i as { id: string; name: string; default_par: number | null }]));

  const drift: Array<{ lineId: string; reason: string; line: unknown; item: unknown }> = [];
  let noItem = 0;
  for (const l of lines) {
    if (!l.item_id) { noItem++; drift.push({ lineId: l.id, reason: "no_item_id", line: l.label, item: null }); continue; }
    const it = itemById.get(l.item_id);
    if (!it) { drift.push({ lineId: l.id, reason: "item_missing", line: l.label, item: l.item_id }); continue; }
    const linePar = typeof l.prep_meta?.["parValue"] === "number" ? (l.prep_meta["parValue"] as number) : null;
    if (linePar !== it.default_par) drift.push({ lineId: l.id, reason: "par_drift", line: linePar, item: it.default_par });
    if (l.label !== it.name) drift.push({ lineId: l.id, reason: "name_drift", line: l.label, item: it.name });
  }
  console.log(JSON.stringify({ activeLines: lines.length, linesWithoutItem: noItem, driftCount: drift.length, drift }, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2:** `npx tsc --noEmit` (clean). Run it:
```bash
npx tsx --env-file=.env.local scripts/check-item-prepmeta-parity.ts
```
Expected: `driftCount: 0`, `linesWithoutItem: 0`. **If non-zero, STOP** — re-run `npx tsx --env-file=.env.local scripts/backfill-item-registry.ts` (idempotent) to re-sync, then re-check. Paste the output in your report.

- [ ] **Step 3:** Commit:
```bash
git add scripts/check-item-prepmeta-parity.ts
git commit -m "feat(spine): item↔prep_meta parity check (pre-cutover no-op proof)"
```

---

### Task 3: Loader read cutover — AM-prep + mid-day

**Files:** Modify `lib/prep.ts` (`loadAmPrepState`, `loadMidDayPrepState`)

- [ ] **Step 1:** Re-read both loaders' item-mapping blocks (`loadAmPrepState` ~717-727; `loadMidDayPrepState` ~804-813). Both do:
```ts
const templateItems = ((itemsRows ?? []) as TemplateItemRow[]).map(rowToTemplateItem).map(narrowPrepTemplateItem);
```
After that line in **each** loader, insert the resolve step (import `loadItemDefns` + `resolveLineDefinition` from `@/lib/items`):
```ts
// Item/Inventory Spine 2A: name + par come from the linked item registry.
// Override the form-facing fields in place so the client component is untouched.
const defns = await loadItemDefns(service, templateItems.map((t) => t.itemId).filter((x): x is string => !!x));
const resolvedItems = templateItems.map((t) => {
  const r = resolveLineDefinition(t, t.itemId ? defns.get(t.itemId) ?? null : null);
  return {
    ...t,
    label: r.name,
    translations: r.nameEs !== null
      ? { ...(t.translations ?? {}), es: { ...(t.translations?.es ?? {}), label: r.nameEs } }
      : t.translations,
    prepMeta: t.prepMeta ? { ...t.prepMeta, parValue: r.par, parUnit: r.parUnit } : t.prepMeta,
  };
});
```
Then use `resolvedItems` where `templateItems` was returned/consumed downstream in that loader (return it as `templateItems` in the result object). CRITICAL: confirm `ChecklistTemplateItem` has `itemId` (camelCase) — it was added to the DB as `item_id`; **`rowToTemplateItem` + `TEMPLATE_ITEM_COLUMNS` must include it.** Re-read `lib/template-items.ts`: if `item_id`/`itemId` is NOT in `TEMPLATE_ITEM_COLUMNS` + `TemplateItemRow` + `rowToTemplateItem` + the `ChecklistTemplateItem` type, **add it** (this is a prerequisite sub-step — `item_id uuid` column → `itemId: string | null`). Do that first, then the resolve step.

- [ ] **Step 2:** `npx tsc --noEmit` (clean).
- [ ] **Step 3:** Commit:
```bash
git add lib/prep.ts lib/template-items.ts lib/types.ts
git commit -m "feat(spine): AM-prep + mid-day loaders resolve name+par from item registry"
```

---

### Task 4: Loader read cutover — opening Phase-2 snapshot par

**Files:** Modify `lib/opening.ts` (`loadOpeningState` ~696-713)

- [ ] **Step 1:** Re-read the `snapshotsJson` build. Before the `.map`, batch-load item defns for the Phase-2 lines, then source par from the item:
```ts
const phase2Defns = await loadItemDefns(service, phase2Items.map((it) => it.itemId).filter((x): x is string => !!x));
snapshotsJson = phase2Items.map((it) => {
  const live = liveSnapshotMap.get(it.id) ?? null;
  const meta = it.prepMeta as OpeningPhase2Meta | null;
  const defn = it.itemId ? phase2Defns.get(it.itemId) ?? null : null;
  return {
    template_item_id: it.id,
    closing_instance_id: live?.amPrepInstanceId ?? null,
    closer_count: live?.total ?? null,                       // closer COUNT path unchanged
    par_value: defn ? defn.defaultPar : (meta?.parValue ?? null),   // par now from the item
    par_unit: defn ? defn.defaultParUnit : (meta?.parUnit ?? null),
  };
});
```
(Import `loadItemDefns` from `@/lib/items`. `it.itemId` requires the Task-3 `itemId` addition to `ChecklistTemplateItem`/columns — already done.)

- [ ] **Step 2:** `npx tsc --noEmit` (clean).
- [ ] **Step 3:** Commit:
```bash
git add lib/opening.ts
git commit -m "feat(spine): opening Phase-2 snapshot par resolves from item registry"
```

---

### Task 5: Submit-snapshot cutover — `submitAmPrep`

**Files:** Modify `lib/prep.ts` (`submitAmPrep` ~2200-2232)

- [ ] **Step 1:** Re-read `submitAmPrep` step 3+4. It loads `itemsById` independently. After building `itemsById`, batch-load item defns and resolve the snapshot's name/par:
```ts
// 2A: snapshot freezes the item-resolved name+par (what the form showed).
const submitDefns = await loadItemDefns(
  service,
  [...itemsById.values()].map((it) => it.itemId).filter((x): x is string => !!x),
);
```
Then in the `rpcEntries` map, change the snapshot build from `itemName: item.label, parValue: item.prepMeta.parValue, parUnit: item.prepMeta.parUnit` to use the resolver:
```ts
const r = resolveLineDefinition(item, item.itemId ? submitDefns.get(item.itemId) ?? null : null);
const snapshot: PrepSnapshot = {
  section: item.prepMeta.section,   // section stays line-level this slice
  itemName: r.name,
  parValue: r.par,
  parUnit: r.parUnit,
};
```
(Import `loadItemDefns`, `resolveLineDefinition` from `@/lib/items`.) **Do NOT touch `submitAmPrepUpdate`** (reuses frozen chain-head snapshots). `submitMidDayPhase1`/`saveMidDayPhase2Item` are already covered free via `loadMidDayPrepState` (Task 3) — verify, don't re-edit.

- [ ] **Step 2:** `npx tsc --noEmit` (clean).
- [ ] **Step 3:** Commit:
```bash
git add lib/prep.ts
git commit -m "feat(spine): AM-prep submit snapshot freezes item-resolved name+par"
```

---

### Task 6: Admin par+name edits → item; retire propagation

**Files:** Modify `lib/admin/templates.ts`, `components/admin/templates/PrepItemEditPanel.tsx`, `lib/i18n/{en,es}.json`

- [ ] **Step 1:** Re-read `updatePrepItemContent` + `propagateParToOpeningMirror`. In `updatePrepItemContent`:
  - Load the line's `item_id` (the read already selects the row via `TEMPLATE_ITEM_COLUMNS`; ensure `itemId` is on the mapped `item`).
  - For **par** (`parValue`/`parUnit`) and **name** (`label`→`name`, `labelEs`→`name_es`) changes: instead of writing `prep_meta`/line, UPDATE `items` for `item.itemId`:
    ```ts
    const itemUpdate: Record<string, unknown> = {};
    if (patch.parValue !== undefined) itemUpdate.default_par = patch.parValue;
    if (patch.parUnit !== undefined) itemUpdate.default_par_unit = patch.parUnit?.trim() || null;
    if (patch.label !== undefined) itemUpdate.name = patch.label.trim();
    if (patch.labelEs !== undefined) itemUpdate.name_es = patch.labelEs?.trim() || null;
    if (Object.keys(itemUpdate).length > 0) {
      if (!item.itemId) throw new AdminTemplateError(409, "item_unlinked", "Line has no registry item");
      itemUpdate.updated_by = actor.user.id;
      itemUpdate.updated_at = new Date().toISOString();
      const { error } = await sb.from("items").update(itemUpdate).eq("id", item.itemId);
      if (error) throw new Error(`updatePrepItemContent item update: ${error.message}`);
    }
    ```
  - Keep writing **special instruction / required / display order** to the line/`prep_meta` as today (don't move those).
  - **Remove** the `propagateParToOpeningMirror` call (par now item-sourced) and **delete the `propagateParToOpeningMirror` function**. Keep `resolveActiveOpeningTemplateId` + `setOpeningMirrorSection` (used by `changePrepItemSection`).
  - Audit `checklist_template_item.update`: add `item_id` + `item_fields_changed` + before/after to metadata.
- [ ] **Step 2:** `PrepItemEditPanel.tsx`: add a small note under the par/name fields, e.g. `{t("admin.templates.item_scope_note")}` ("Par & name apply to this item on every list it appears on."). Add the key to `en.json` + `es.json` (parity).
- [ ] **Step 3:** `npx tsc --noEmit && npm run build` (clean — confirm no dangling references to the removed function).
- [ ] **Step 4:** Commit:
```bash
git add lib/admin/templates.ts components/admin/templates/PrepItemEditPanel.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(spine): admin par+name edits write the item; retire propagateParToOpeningMirror"
```

---

### Task 7: Edit-once-everywhere smoke (throwaway)

**Files:** temp `scripts/_smoke_registry_live.ts` (deleted before commit)

- [ ] **Step 1:** Write a throwaway smoke that proves the cutover + edit-once-everywhere on a DISPOSABLE item, then cleans up. Pattern: pick a real location; create a disposable item + a disposable am_prep template line + a disposable opening Phase-2 line both linked to it; set item.default_par; call `loadAmPrepState`-style resolution (or directly call `resolveLineDefinition` + `loadItemDefns`) and assert both lines resolve the new par; update the item's par; assert both reflect it; hard-delete the disposable rows. (Simpler acceptable variant: unit-test `resolveLineDefinition` + `loadItemDefns` against a disposable item — assert item present → item values; item null → fallback.) Keep it correct; delete after.
- [ ] **Step 2:** Run: `npx tsx --env-file=.env.local scripts/_smoke_registry_live.ts` → all asserts true.
- [ ] **Step 3:** Delete the smoke; commit nothing (no file). Verify `git status` clean.

---

### Task 8: Final gate

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` — clean.
- [ ] **Step 2:** Re-run `npx tsx --env-file=.env.local scripts/check-item-prepmeta-parity.ts` → `driftCount: 0` (cutover is a no-op today; nothing's edited an item yet).
- [ ] **Step 3:** `git ls-files scripts/ | grep _smoke_ || echo clean` → `clean`.
- [ ] **Step 4:** `git diff --stat origin/main` — only: `lib/items.ts`, `scripts/check-item-prepmeta-parity.ts`, `lib/prep.ts`, `lib/opening.ts`, `lib/template-items.ts`, `lib/types.ts`, `lib/admin/templates.ts`, `components/admin/templates/PrepItemEditPanel.tsx`, `lib/i18n/{en,es}.json`, + spec/plan docs.
- [ ] **Step 5:** Push + PR:
```bash
git push -u origin claude/registry-goes-live
gh pr create --title "Item/Inventory Spine 2A: registry goes live (par+name)" --body "<summary + 'renders identically today (parity check 0)' + edit-once-everywhere + retired propagation>"
```
PR body: emphasize the cutover is a **proven no-op today** (parity check 0), edit-once-everywhere is now live for par+name, propagation retired; section/instruction still line-level (full definition in later slices). Juan preview smoke: AM-prep/mid-day/Opening render identically pre-edit; edit an item's par in admin → shows on all its lists.

---

## Notes for the implementer
- **Re-read before each task:** the exact functions named (they're large + nuanced). Especially confirm `itemId` is threaded onto `ChecklistTemplateItem` (Task 3 prerequisite) before Tasks 4–6 use `it.itemId`.
- **Don't touch:** `submitAmPrepUpdate` (frozen chain snapshots), `setOpeningMirrorSection`/`resolveActiveOpeningTemplateId`/`changePrepItemSection` (section stays line-level), the closer-COUNT path in opening (only par source changes).
- **The parity check (Task 2) gating 0 is the safety contract** — the cutover must be a no-op the day it ships. If it's ever non-zero, re-sync via the idempotent backfill before flipping.
- **Out of scope:** per-location par / par_mode / SKU par (2B), mid-day add-from-registry picker (2C), section + special-instruction cutover (later slice).

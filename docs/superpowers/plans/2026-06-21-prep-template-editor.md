# Prep Template Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a GM+ (level ≥ 7) viewer + in-place editor for prep template items (par/unit, special instruction, label/description in EN+ES, display order, required — Tier A; min role level — Tier B) at `/admin/checklist-templates`, with AM-prep par edits propagating to the linked Opening Phase-2 mirror.

**Architecture:** Service-role data layer (`lib/admin/templates.ts`) + app-layer gating; API routes self-gate (`requireSession → level≥7 → assertStepUp(tier) → IDOR location-bind`) because they live outside `app/admin/layout.tsx`. Reuses `lib/prep.ts setPrepItemMeta` for `prep_meta` writes so the `station`/`prep_meta.section` invariant is preserved by construction. No migration — pure read + in-place UPDATE on existing tables. History stays frozen via C.44 snapshots.

**Tech Stack:** Next.js 16 App Router (async route params `{ params }: { params: Promise<{...}> }`), React 19, Tailwind v4 tokens (`co-text`, `co-text-muted`, `co-surface`, `co-border`, `co-gold`, `co-gold-deep`, `co-cta`), TypeScript strict + `noUncheckedIndexedAccess`, Supabase custom-JWT + RLS (service-role for admin writes). No test framework: `tsc --noEmit` + `next build` + throwaway `tsx` smokes (deleted before commit).

**Spec:** `docs/superpowers/specs/2026-06-21-prep-template-editor-design.md`

**Reference implementations to mirror (re-read before authoring):**
- `lib/admin/users.ts` — data-layer shape, `AdminUserError`, service-role + audit pattern.
- `app/api/admin/users/route.ts` (GET+POST self-gate) and `app/api/admin/users/[id]/role/route.ts` (Tier-B sub-route).
- `app/admin/users/page.tsx` — Server Component re-gate + location resolution.
- `components/admin/users/UserActions.tsx` + `components/admin/users/shared.ts` — client `run(tier,url,body,method)` / `postJson` / `resolveErrorKey`.
- `lib/prep.ts` — `setPrepItemMeta`, `narrowPrepTemplateItem`, `isPrepMeta`.
- `lib/locations.ts` — `isAllLocationsAccess`, `lockLocationContext`.
- `lib/template-items.ts` — `TEMPLATE_ITEM_COLUMNS`, `rowToTemplateItem`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/destructive-actions.ts` (modify) | Add `checklist_template_item.update` action. |
| `lib/admin/templates.ts` (create) | Service-role data layer: reads, `updatePrepItemContent`, `setPrepItemMinRole`, `propagateParToOpeningMirror`, `AdminTemplateError`. |
| `app/api/admin/templates/route.ts` (create) | GET list (by `?location=`). |
| `app/api/admin/templates/[templateId]/route.ts` (create) | GET detail. |
| `app/api/admin/templates/[templateId]/items/[itemId]/route.ts` (create) | PATCH content (Tier A). |
| `app/api/admin/templates/[templateId]/items/[itemId]/min-role/route.ts` (create) | PATCH min role (Tier B). |
| `app/admin/checklist-templates/page.tsx` (replace stub) | Server: re-gate ≥7, location switcher, list prep templates. |
| `app/admin/checklist-templates/[templateId]/page.tsx` (create) | Server: re-gate ≥7, load detail, render editor. |
| `components/admin/templates/shared.ts` (create) | `postJson`, `resolveErrorKey` for `admin.templates.error.*`. |
| `components/admin/templates/PrepTemplateEditor.tsx` (create) | Client: section-grouped list of items. |
| `components/admin/templates/PrepItemEditPanel.tsx` (create) | Client: per-item inline edit (Tier A content + Tier B min-role). |
| `lib/i18n/en.json` / `lib/i18n/es.json` (modify) | `admin.templates.*` keys at parity. |

**Smoke scripts** (`scripts/_smoke_*.ts`) are created and run during the tasks below, then **deleted before each commit — never committed.**

---

### Task 1: Add the audit action

**Files:**
- Modify: `lib/destructive-actions.ts:46-49`

- [ ] **Step 1: Add `checklist_template_item.update` to the registry**

In the "Checklist template lifecycle" block, add the new action:

```ts
  // Checklist template lifecycle
  "checklist_template.create",
  "checklist_template.delete_or_deactivate",
  "checklist_template_item.delete",
  // In-place config edit of a prep template item (C.44 Module 3 slice 1).
  // — destructive because it alters operational config (par targets, who can
  // complete a step). Auto-derives destructive=true on the audit row via
  // isDestructive(). Edits are id-preserving; history stays frozen via C.44
  // snapshots. before_state/after_state carry the changed fields.
  "checklist_template_item.update",
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/destructive-actions.ts
git commit -m "feat(C.44): add checklist_template_item.update audit action"
```

---

### Task 2: Data layer — reads + authorized-template helper

**Files:**
- Create: `lib/admin/templates.ts`

- [ ] **Step 1: Create the file with types, error class, and the IDOR-binding loader**

```ts
/**
 * Admin prep-template data layer (C.44 Module 3 slice 1).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level >= 7 → assertStepUp)
 * and re-checked here for the IDOR location-bind (defense in depth). Service-role
 * bypasses RLS by design, consistent with lib/admin/users.ts.
 *
 * Prep-only this slice: type='prep' (am_prep | mid_day_prep). Opening/closing
 * editing is a later slice. prep_meta writes go through lib/prep.ts
 * setPrepItemMeta so the station/section sync invariant is preserved.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { isAllLocationsAccess, lockLocationContext } from "@/lib/locations";
import {
  TEMPLATE_ITEM_COLUMNS,
  type TemplateItemRow,
  rowToTemplateItem,
} from "@/lib/template-items";
import { setPrepItemMeta, narrowPrepTemplateItem, isPrepMeta } from "@/lib/prep";
import type { AuthContext } from "@/lib/session";
import type {
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  PrepMeta,
} from "@/lib/types";

export type PrepSubtype = "am_prep" | "mid_day_prep";

export interface AdminPrepTemplateListItem {
  id: string;
  name: string;
  prepSubtype: PrepSubtype;
  activeItemCount: number;
}

export interface AdminPrepTemplateDetail {
  id: string;
  name: string;
  prepSubtype: PrepSubtype;
  locationId: string;
  items: ChecklistTemplateItem[];
}

/** Typed error the routes map to jsonError(status, code). */
export class AdminTemplateError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminTemplateError";
  }
}

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  prep_subtype: PrepSubtype | null;
  location_id: string;
  active: boolean;
}

function actorLocationShape(actor: AuthContext) {
  return { role: actor.user.role, locations: actor.locations };
}

/**
 * Loads a prep template by id and binds it to the actor's authorized location.
 * Throws AdminTemplateError(404) when missing, not a prep template, or the
 * actor isn't authorized for its location (404 — don't confirm existence).
 */
async function loadAuthorizedPrepTemplate(
  actor: AuthContext,
  templateId: string,
): Promise<TemplateRow> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("checklist_templates")
    .select("id, name, type, prep_subtype, location_id, active")
    .eq("id", templateId)
    .maybeSingle<TemplateRow>();
  if (error) throw new Error(`loadAuthorizedPrepTemplate failed: ${error.message}`);
  if (!data || data.type !== "prep" || !data.prep_subtype) {
    throw new AdminTemplateError(404, "template_not_found", "Template not found");
  }
  if (!lockLocationContext(actorLocationShape(actor), data.location_id)) {
    throw new AdminTemplateError(404, "template_not_found", "Template not found");
  }
  return data;
}
```

- [ ] **Step 2: Add `listPrepTemplates` and `getPrepTemplateDetail`**

Append:

```ts
/** Active prep templates (am + mid-day) at a location the actor may access. */
export async function listPrepTemplates(
  actor: AuthContext,
  locationId: string,
): Promise<AdminPrepTemplateListItem[]> {
  if (!lockLocationContext(actorLocationShape(actor), locationId)) {
    throw new AdminTemplateError(404, "location_not_found", "Location not accessible");
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("checklist_templates")
    .select("id, name, prep_subtype")
    .eq("location_id", locationId)
    .eq("type", "prep")
    .eq("active", true)
    .order("prep_subtype", { ascending: true })
    .returns<Array<{ id: string; name: string; prep_subtype: PrepSubtype }>>();
  if (error) throw new Error(`listPrepTemplates failed: ${error.message}`);
  const templates = data ?? [];

  const out: AdminPrepTemplateListItem[] = [];
  for (const t of templates) {
    const { count, error: cErr } = await sb
      .from("checklist_template_items")
      .select("id", { count: "exact", head: true })
      .eq("template_id", t.id)
      .eq("active", true);
    if (cErr) throw new Error(`listPrepTemplates count failed: ${cErr.message}`);
    out.push({ id: t.id, name: t.name, prepSubtype: t.prep_subtype, activeItemCount: count ?? 0 });
  }
  return out;
}

/** A prep template's active items (typed, invariant-checked), ordered for display. */
export async function getPrepTemplateDetail(
  actor: AuthContext,
  templateId: string,
): Promise<AdminPrepTemplateDetail> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, templateId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("template_id", templateId)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<TemplateItemRow[]>();
  if (error) throw new Error(`getPrepTemplateDetail items failed: ${error.message}`);
  const items = (data ?? []).map(rowToTemplateItem).map(narrowPrepTemplateItem);
  return {
    id: tmpl.id,
    name: tmpl.name,
    prepSubtype: tmpl.prep_subtype as PrepSubtype,
    locationId: tmpl.location_id,
    items,
  };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (`updatePrepItemContent` / `setPrepItemMinRole` come in Tasks 3–4; routes that import them don't exist yet.)

- [ ] **Step 4: Commit**

```bash
git add lib/admin/templates.ts
git commit -m "feat(C.44): prep-template admin reads + IDOR location-bind"
```

---

### Task 3: Data layer — par propagation + content mutator

**Files:**
- Modify: `lib/admin/templates.ts`
- Temp test: `scripts/_smoke_prep_edit.ts` (deleted before commit)

- [ ] **Step 1: Add `propagateParToOpeningMirror`**

Append to `lib/admin/templates.ts`:

```ts
/**
 * When an AM-prep item's par changes, update the linked Opening Phase-2 item's
 * mirrored par (OpeningPhase2Meta.parValue/parUnit). The link is the Opening
 * item's references_template_item_id → the AM-prep item id. Scoped to the
 * active opening template at the same location. Returns propagated item ids.
 * No-op (returns []) when no active opening template or no linked item.
 */
async function propagateParToOpeningMirror(args: {
  amPrepItemId: string;
  locationId: string;
  parValue: number | null;
  parUnit: string | null;
}): Promise<string[]> {
  const sb = getServiceRoleClient();
  const { data: openingTmpl, error: otErr } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", "opening")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (otErr) throw new Error(`propagate: opening template lookup failed: ${otErr.message}`);
  if (!openingTmpl) return [];

  const { data: linked, error: lErr } = await sb
    .from("checklist_template_items")
    .select("id, prep_meta")
    .eq("template_id", openingTmpl.id)
    .eq("references_template_item_id", args.amPrepItemId)
    .eq("active", true)
    .returns<Array<{ id: string; prep_meta: Record<string, unknown> | null }>>();
  if (lErr) throw new Error(`propagate: linked items lookup failed: ${lErr.message}`);

  const propagated: string[] = [];
  for (const item of linked ?? []) {
    const nextMeta = {
      ...(item.prep_meta ?? {}),
      parValue: args.parValue,
      parUnit: args.parUnit,
    };
    const { error: uErr } = await sb
      .from("checklist_template_items")
      .update({ prep_meta: nextMeta })
      .eq("id", item.id);
    if (uErr) throw new Error(`propagate: update item ${item.id} failed: ${uErr.message}`);
    propagated.push(item.id);
  }
  return propagated;
}
```

- [ ] **Step 2: Add the `PrepItemContentPatch` type and `updatePrepItemContent`**

Append:

```ts
export interface PrepItemContentPatch {
  label?: string;
  labelEs?: string | null;
  description?: string | null;
  descriptionEs?: string | null;
  displayOrder?: number;
  required?: boolean;
  parValue?: number | null;
  parUnit?: string | null;
  specialInstruction?: string | null; // en (prep_meta.specialInstruction)
  specialInstructionEs?: string | null;
}

function mergeEsTranslation(
  existing: ChecklistTemplateItemTranslations | null,
  patch: { label?: string | null; description?: string | null; specialInstruction?: string | null },
): ChecklistTemplateItemTranslations {
  const next: ChecklistTemplateItemTranslations = { ...(existing ?? {}) };
  const es = { ...(next.es ?? {}) };
  if (patch.label !== undefined) es.label = patch.label ?? undefined;
  if (patch.description !== undefined) es.description = patch.description;
  if (patch.specialInstruction !== undefined) es.specialInstruction = patch.specialInstruction;
  next.es = es;
  return next;
}

/**
 * In-place content edit of a prep template item (Tier A). Writes prep_meta via
 * setPrepItemMeta (preserves section/columns, asserts station match), top-level
 * columns + translations via a direct UPDATE. AM-prep par edits propagate to
 * the Opening mirror. Audits checklist_template_item.update with before/after.
 */
export async function updatePrepItemContent(
  actor: AuthContext,
  args: { templateId: string; itemId: string; patch: PrepItemContentPatch },
): Promise<void> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  const sb = getServiceRoleClient();

  const { data: rawRow, error: rErr } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<TemplateItemRow>();
  if (rErr) throw new Error(`updatePrepItemContent read failed: ${rErr.message}`);
  if (!rawRow) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  const item = rowToTemplateItem(rawRow);

  const { patch } = args;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  // ── Top-level columns + en translations ──────────────────────────────────
  const colUpdate: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const v = patch.label.trim();
    if (!v) throw new AdminTemplateError(400, "invalid_label", "Label cannot be empty");
    if (v !== item.label) { before.label = item.label; after.label = v; colUpdate.label = v; }
  }
  if (patch.description !== undefined) {
    const v = patch.description?.trim() || null;
    if (v !== item.description) { before.description = item.description; after.description = v; colUpdate.description = v; }
  }
  if (patch.displayOrder !== undefined) {
    if (!Number.isInteger(patch.displayOrder) || patch.displayOrder < 0) {
      throw new AdminTemplateError(400, "invalid_display_order", "Display order must be a non-negative integer");
    }
    if (patch.displayOrder !== item.displayOrder) {
      before.displayOrder = item.displayOrder; after.displayOrder = patch.displayOrder;
      colUpdate.display_order = patch.displayOrder;
    }
  }
  if (patch.required !== undefined && patch.required !== item.required) {
    before.required = item.required; after.required = patch.required; colUpdate.required = patch.required;
  }

  // es translations (label/description/specialInstruction)
  const esPatch: { label?: string | null; description?: string | null; specialInstruction?: string | null } = {};
  if (patch.labelEs !== undefined) esPatch.label = patch.labelEs?.trim() || null;
  if (patch.descriptionEs !== undefined) esPatch.description = patch.descriptionEs?.trim() || null;
  if (patch.specialInstructionEs !== undefined) esPatch.specialInstruction = patch.specialInstructionEs?.trim() || null;
  if (Object.keys(esPatch).length > 0) {
    colUpdate.translations = mergeEsTranslation(item.translations, esPatch);
    before.translations_es = item.translations?.es ?? null;
    after.translations_es = (colUpdate.translations as ChecklistTemplateItemTranslations).es;
  }

  if (Object.keys(colUpdate).length > 0) {
    const { error: uErr } = await sb
      .from("checklist_template_items").update(colUpdate).eq("id", args.itemId);
    if (uErr) throw new Error(`updatePrepItemContent column update failed: ${uErr.message}`);
  }

  // ── prep_meta (par/unit/specialInstruction en) via setPrepItemMeta ────────
  let parChanged = false;
  const touchesMeta =
    patch.parValue !== undefined || patch.parUnit !== undefined || patch.specialInstruction !== undefined;
  if (touchesMeta) {
    if (!isPrepMeta(item.prepMeta)) {
      throw new AdminTemplateError(400, "not_a_prep_item", "Item has no editable prep metadata");
    }
    const base: PrepMeta = item.prepMeta;
    const nextMeta: PrepMeta = {
      ...base,
      parValue: patch.parValue !== undefined ? patch.parValue : base.parValue,
      parUnit: patch.parUnit !== undefined ? (patch.parUnit?.trim() || null) : base.parUnit,
      specialInstruction:
        patch.specialInstruction !== undefined
          ? (patch.specialInstruction?.trim() || null)
          : base.specialInstruction,
    };
    if (nextMeta.parValue !== null && (!Number.isFinite(nextMeta.parValue) || nextMeta.parValue < 0)) {
      throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
    }
    parChanged = nextMeta.parValue !== base.parValue || nextMeta.parUnit !== base.parUnit;
    if (
      nextMeta.parValue !== base.parValue ||
      nextMeta.parUnit !== base.parUnit ||
      nextMeta.specialInstruction !== base.specialInstruction
    ) {
      before.prep_meta = { parValue: base.parValue, parUnit: base.parUnit, specialInstruction: base.specialInstruction };
      after.prep_meta = { parValue: nextMeta.parValue, parUnit: nextMeta.parUnit, specialInstruction: nextMeta.specialInstruction };
      // setPrepItemMeta asserts meta.section === existing station before writing.
      await setPrepItemMeta(sb, { templateItemId: args.itemId, meta: nextMeta });
    }
  }

  if (Object.keys(after).length === 0) return; // nothing changed

  // ── Propagation (AM-prep par edits → Opening mirror) ─────────────────────
  let propagatedTo: string[] = [];
  if (parChanged && tmpl.prep_subtype === "am_prep") {
    propagatedTo = await propagateParToOpeningMirror({
      amPrepItemId: args.itemId,
      locationId: tmpl.location_id,
      parValue: (after.prep_meta as { parValue: number | null }).parValue,
      parUnit: (after.prep_meta as { parUnit: string | null }).parUnit,
    });
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: {
      template_id: args.templateId,
      prep_subtype: tmpl.prep_subtype,
      before,
      after,
      ...(propagatedTo.length > 0
        ? {
            propagated_to_item_ids: propagatedTo,
            par_before: (before.prep_meta as { parValue: number | null } | undefined)?.parValue ?? null,
            par_after: (after.prep_meta as { parValue: number | null } | undefined)?.parValue ?? null,
          }
        : {}),
    },
    ipAddress: null,
    userAgent: null,
  });
}
```

> **Audit shape note (verified against `lib/audit.ts`):** the `audit()` helper takes
> `{ actorId, actorRole, action, resourceTable, resourceId, metadata, ipAddress, userAgent }`
> — it has **no** `beforeState`/`afterState` params (those would be a tsc excess-property
> error). before/after live **inside `metadata`** (as above). The table's `before_state`/
> `after_state` columns are only written by SQL-side migration INSERTs, not this helper.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Write a throwaway smoke that exercises edit + invariant + propagation**

Create `scripts/_smoke_prep_edit.ts`:

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { updatePrepItemContent, getPrepTemplateDetail } from "@/lib/admin/templates";
import { narrowPrepTemplateItem } from "@/lib/prep";
import { rowToTemplateItem, TEMPLATE_ITEM_COLUMNS } from "@/lib/template-items";
import type { AuthContext } from "@/lib/session";

// A CGS/owner-level actor (level >= 9 → all-locations, passes IDOR bind).
const actor = {
  user: { id: "00000000-0000-0000-0000-000000000000", role: "cgs" },
  locations: [],
} as unknown as AuthContext;

async function main() {
  const sb = getServiceRoleClient();
  // pick any location id
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).single();
  const locationId = (loc as { id: string }).id;

  // disposable am_prep template + one Veg item with prep_meta
  const { data: tmpl } = await sb.from("checklist_templates").insert({
    location_id: locationId, type: "prep", prep_subtype: "am_prep",
    name: "_SMOKE AM Prep", active: true,
  }).select("id").single();
  const templateId = (tmpl as { id: string }).id;

  const { data: item } = await sb.from("checklist_template_items").insert({
    template_id: templateId, station: "Veg", display_order: 1, label: "_smoke veg",
    min_role_level: 3, required: true,
    prep_meta: { section: "Veg", parValue: 6, parUnit: "pans", specialInstruction: null, columns: ["par","on_hand","total"] },
  }).select("id").single();
  const itemId = (item as { id: string }).id;

  // disposable opening template + Phase-2 item linking back to the prep item
  const { data: oTmpl } = await sb.from("checklist_templates").insert({
    location_id: locationId, type: "opening", name: "_SMOKE Opening", active: true,
  }).select("id").single();
  const openingTemplateId = (oTmpl as { id: string }).id;
  const { data: oItem } = await sb.from("checklist_template_items").insert({
    template_id: openingTemplateId, station: "Veg", display_order: 1, label: "_smoke veg verify",
    min_role_level: 3, required: true, references_template_item_id: itemId,
    prep_meta: { openingPhase2: true, section: "Veg", parValue: 6, parUnit: "pans" },
  }).select("id").single();
  const openingItemId = (oItem as { id: string }).id;

  // EDIT par 6 -> 8
  await updatePrepItemContent(actor, { templateId, itemId, patch: { parValue: 8 } });

  // read back
  const detail = await getPrepTemplateDetail(actor, templateId);
  const edited = detail.items.find((i) => i.id === itemId)!;
  console.log("par updated:", edited.prepMeta?.parValue === 8);
  console.log("section preserved:", edited.prepMeta?.section === "Veg");
  console.log("columns preserved:", JSON.stringify(edited.prepMeta?.columns) === JSON.stringify(["par","on_hand","total"]));
  narrowPrepTemplateItem(edited); // throws on invariant drift
  console.log("invariant intact: true");

  const { data: oRaw } = await sb.from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS).eq("id", openingItemId).single();
  const oMapped = rowToTemplateItem(oRaw as any);
  console.log("mirror propagated:", (oMapped.prepMeta as any)?.parValue === 8);

  // cleanup (hard-delete test artifacts)
  await sb.from("checklist_template_items").delete().in("id", [itemId, openingItemId]);
  await sb.from("checklist_templates").delete().in("id", [templateId, openingTemplateId]);
  console.log("cleanup done");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the smoke**

Run: `npx tsx --env-file=.env.local scripts/_smoke_prep_edit.ts`
Expected: every line prints `true` / `ok` and `cleanup done`. If `mirror propagated` is false, fix `propagateParToOpeningMirror`; if the invariant line throws, fix the `setPrepItemMeta` path. (Audit rows from the smoke reference deleted rows — that's fine per the append-only audit philosophy.)

- [ ] **Step 6: Delete the smoke and commit**

```bash
rm scripts/_smoke_prep_edit.ts
git add lib/admin/templates.ts
git commit -m "feat(C.44): prep item content edit + AM-prep par propagation"
```

---

### Task 4: Data layer — min role level (Tier B)

**Files:**
- Modify: `lib/admin/templates.ts`

- [ ] **Step 1: Add `setPrepItemMinRole`**

Append:

```ts
/** Tier-B: change who can complete a prep step. Audited; no propagation. */
export async function setPrepItemMinRole(
  actor: AuthContext,
  args: { templateId: string; itemId: string; minRoleLevel: number },
): Promise<void> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  if (!Number.isFinite(args.minRoleLevel) || args.minRoleLevel < 0 || args.minRoleLevel > 10) {
    throw new AdminTemplateError(400, "invalid_min_role", "Min role level must be between 0 and 10");
  }
  const sb = getServiceRoleClient();
  const { data: row, error: rErr } = await sb
    .from("checklist_template_items")
    .select("min_role_level")
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<{ min_role_level: number }>();
  if (rErr) throw new Error(`setPrepItemMinRole read failed: ${rErr.message}`);
  if (!row) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  if (row.min_role_level === args.minRoleLevel) return;

  const { error: uErr } = await sb
    .from("checklist_template_items")
    .update({ min_role_level: args.minRoleLevel })
    .eq("id", args.itemId);
  if (uErr) throw new Error(`setPrepItemMinRole update failed: ${uErr.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: {
      template_id: args.templateId,
      prep_subtype: tmpl.prep_subtype,
      field: "min_role_level",
      tier: "B",
      before: { min_role_level: row.min_role_level },
      after: { min_role_level: args.minRoleLevel },
    },
    ipAddress: null,
    userAgent: null,
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/admin/templates.ts
git commit -m "feat(C.44): prep item min-role-level mutator (Tier B)"
```

---

### Task 5: API — GET list + GET detail

**Files:**
- Create: `app/api/admin/templates/route.ts`
- Create: `app/api/admin/templates/[templateId]/route.ts`

- [ ] **Step 1: List route**

`app/api/admin/templates/route.ts`:

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { listPrepTemplates, AdminTemplateError } from "@/lib/admin/templates";

const ADMIN_MIN_LEVEL = 7;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/templates");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");

  const location = new URL(req.url).searchParams.get("location");
  if (!location) return jsonError(400, "invalid_payload", { field: "location" });
  try {
    const templates = await listPrepTemplates(ctx, location);
    return jsonOk({ templates });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 2: Detail route**

`app/api/admin/templates/[templateId]/route.ts`:

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { getPrepTemplateDetail, AdminTemplateError } from "@/lib/admin/templates";

export async function GET(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const ctx = await requireSession(req, `/api/admin/templates/${templateId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  try {
    const detail = await getPrepTemplateDetail(ctx, templateId);
    return jsonOk({ detail });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` (expected: no errors)

```bash
git add app/api/admin/templates/route.ts "app/api/admin/templates/[templateId]/route.ts"
git commit -m "feat(C.44): prep-template GET list + detail routes"
```

---

### Task 6: API — content PATCH (Tier A)

**Files:**
- Create: `app/api/admin/templates/[templateId]/items/[itemId]/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updatePrepItemContent, AdminTemplateError, type PrepItemContentPatch } from "@/lib/admin/templates";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string; itemId: string }> },
) {
  const { templateId, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/templates/${templateId}/items/${itemId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const patch: PrepItemContentPatch = {};
  if (typeof b.label === "string") patch.label = b.label;
  if (b.labelEs === null || typeof b.labelEs === "string") patch.labelEs = b.labelEs as string | null;
  if (b.description === null || typeof b.description === "string") patch.description = b.description as string | null;
  if (b.descriptionEs === null || typeof b.descriptionEs === "string") patch.descriptionEs = b.descriptionEs as string | null;
  if (typeof b.displayOrder === "number") patch.displayOrder = b.displayOrder;
  if (typeof b.required === "boolean") patch.required = b.required;
  if (b.parValue === null || typeof b.parValue === "number") patch.parValue = b.parValue as number | null;
  if (b.parUnit === null || typeof b.parUnit === "string") patch.parUnit = b.parUnit as string | null;
  if (b.specialInstruction === null || typeof b.specialInstruction === "string") patch.specialInstruction = b.specialInstruction as string | null;
  if (b.specialInstructionEs === null || typeof b.specialInstructionEs === "string") patch.specialInstructionEs = b.specialInstructionEs as string | null;

  if (Object.keys(patch).length === 0) return jsonError(400, "invalid_payload", { message: "no editable fields" });
  try {
    await updatePrepItemContent(ctx, { templateId, itemId, patch });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (expected: no errors)

```bash
git add "app/api/admin/templates/[templateId]/items/[itemId]/route.ts"
git commit -m "feat(C.44): prep item content PATCH route (Tier A)"
```

---

### Task 7: API — min-role PATCH (Tier B)

**Files:**
- Create: `app/api/admin/templates/[templateId]/items/[itemId]/min-role/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setPrepItemMinRole, AdminTemplateError } from "@/lib/admin/templates";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string; itemId: string }> },
) {
  const { templateId, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/templates/${templateId}/items/${itemId}/min-role`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const minRoleLevel = (parsed as { minRoleLevel?: unknown }).minRoleLevel;
  if (typeof minRoleLevel !== "number") return jsonError(400, "invalid_payload", { field: "minRoleLevel" });
  try {
    await setPrepItemMinRole(ctx, { templateId, itemId, minRoleLevel });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (expected: no errors)

```bash
git add "app/api/admin/templates/[templateId]/items/[itemId]/min-role/route.ts"
git commit -m "feat(C.44): prep item min-role PATCH route (Tier B)"
```

---

### Task 8: i18n keys

**Files:**
- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/es.json`

- [ ] **Step 1: Add `admin.templates.*` to `en.json`**

Add these keys (place near the other `admin.*` keys; keep JSON valid):

```json
"admin.templates.title": "Prep Templates",
"admin.templates.subtitle": "Edit prep par targets, instructions, and item details. Changes apply to the next prep — past reports stay as submitted.",
"admin.templates.location_label": "Location",
"admin.templates.subtype.am_prep": "AM Prep",
"admin.templates.subtype.mid_day_prep": "Mid-day Prep",
"admin.templates.item_count": "{count} items",
"admin.templates.open": "Open",
"admin.templates.back_to_list": "All prep templates",
"admin.templates.section_label": "Section",
"admin.templates.edit": "Edit",
"admin.templates.save": "Save",
"admin.templates.cancel": "Cancel",
"admin.templates.saved": "Saved",
"admin.templates.field.par_value": "Par",
"admin.templates.field.par_unit": "Unit",
"admin.templates.field.special_instruction": "Special instruction (EN)",
"admin.templates.field.special_instruction_es": "Special instruction (ES)",
"admin.templates.field.label_en": "Label (EN)",
"admin.templates.field.label_es": "Label (ES)",
"admin.templates.field.description_en": "Description (EN)",
"admin.templates.field.description_es": "Description (ES)",
"admin.templates.field.display_order": "Order",
"admin.templates.field.required": "Required",
"admin.templates.field.min_role_level": "Minimum role level",
"admin.templates.min_role.change": "Change min role (re-auth)",
"admin.templates.min_role.hint": "Changing who can complete this step requires confirming your password.",
"admin.templates.error.forbidden": "You don't have permission to do that.",
"admin.templates.error.template_not_found": "Template not found.",
"admin.templates.error.item_not_found": "Item not found.",
"admin.templates.error.location_not_found": "Location not accessible.",
"admin.templates.error.invalid_label": "Label can't be empty.",
"admin.templates.error.invalid_par": "Par must be a non-negative number or empty.",
"admin.templates.error.invalid_display_order": "Order must be a non-negative whole number.",
"admin.templates.error.invalid_min_role": "Min role level must be between 0 and 10.",
"admin.templates.error.not_a_prep_item": "This item has no editable prep details.",
"admin.templates.error.step_up_required": "Please confirm your password to continue.",
"admin.templates.error.step_up_stale": "Your confirmation expired — please confirm your password again.",
"admin.templates.error.generic": "Something went wrong. Try again."
```

- [ ] **Step 2: Add the same keys to `es.json` (operational tú-form)**

```json
"admin.templates.title": "Plantillas de Prep",
"admin.templates.subtitle": "Edita los pares de prep, las instrucciones y los detalles de cada ítem. Los cambios aplican al próximo prep — los reportes pasados quedan como se enviaron.",
"admin.templates.location_label": "Local",
"admin.templates.subtype.am_prep": "Prep AM",
"admin.templates.subtype.mid_day_prep": "Prep de Mediodía",
"admin.templates.item_count": "{count} ítems",
"admin.templates.open": "Abrir",
"admin.templates.back_to_list": "Todas las plantillas de prep",
"admin.templates.section_label": "Sección",
"admin.templates.edit": "Editar",
"admin.templates.save": "Guardar",
"admin.templates.cancel": "Cancelar",
"admin.templates.saved": "Guardado",
"admin.templates.field.par_value": "Par",
"admin.templates.field.par_unit": "Unidad",
"admin.templates.field.special_instruction": "Instrucción especial (EN)",
"admin.templates.field.special_instruction_es": "Instrucción especial (ES)",
"admin.templates.field.label_en": "Etiqueta (EN)",
"admin.templates.field.label_es": "Etiqueta (ES)",
"admin.templates.field.description_en": "Descripción (EN)",
"admin.templates.field.description_es": "Descripción (ES)",
"admin.templates.field.display_order": "Orden",
"admin.templates.field.required": "Obligatorio",
"admin.templates.field.min_role_level": "Nivel mínimo de rol",
"admin.templates.min_role.change": "Cambiar rol mínimo (re-autenticar)",
"admin.templates.min_role.hint": "Cambiar quién puede completar este paso requiere confirmar tu contraseña.",
"admin.templates.error.forbidden": "No tienes permiso para hacer eso.",
"admin.templates.error.template_not_found": "Plantilla no encontrada.",
"admin.templates.error.item_not_found": "Ítem no encontrado.",
"admin.templates.error.location_not_found": "Local no accesible.",
"admin.templates.error.invalid_label": "La etiqueta no puede estar vacía.",
"admin.templates.error.invalid_par": "El par debe ser un número no negativo o vacío.",
"admin.templates.error.invalid_display_order": "El orden debe ser un número entero no negativo.",
"admin.templates.error.invalid_min_role": "El nivel mínimo de rol debe estar entre 0 y 10.",
"admin.templates.error.not_a_prep_item": "Este ítem no tiene detalles de prep editables.",
"admin.templates.error.step_up_required": "Confirma tu contraseña para continuar.",
"admin.templates.error.step_up_stale": "Tu confirmación expiró — confirma tu contraseña otra vez.",
"admin.templates.error.generic": "Algo salió mal. Inténtalo de nuevo."
```

- [ ] **Step 3: Verify parity + build types**

Run: `npx tsc --noEmit`
Expected: no errors. If the i18n `TranslationKey` type is generated/checked, confirm both files have identical key sets (a parity test or the type will flag a missing key). Manually confirm EN and ES have the same key list.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(C.44): admin.templates i18n keys (EN+ES parity)"
```

---

### Task 9: Section page (list + location switcher)

**Files:**
- Modify (replace stub): `app/admin/checklist-templates/page.tsx`

- [ ] **Step 1: Replace the stub with the Server Component**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listPrepTemplates } from "@/lib/admin/templates";

export default async function AdminPrepTemplatesPage({
  searchParams,
}: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 7) redirect("/dashboard");
  const lang = auth.user.language;
  const sp = await searchParams;

  const sb = getServiceRoleClient();
  const { data: locRows } = await sb.from("locations").select("id, name, code").eq("active", true).order("name");
  const all = (locRows ?? []).map((r) => r as { id: string; name: string; code: string });
  const actorAll = isAllLocationsAccess({ role: auth.user.role, locations: auth.locations });
  const accessible = actorAll ? all : all.filter((l) => auth.locations.includes(l.id));

  const selected = sp.location && accessible.some((l) => l.id === sp.location)
    ? sp.location
    : accessible[0]?.id ?? null;

  const templates = selected ? await listPrepTemplates(auth, selected) : [];

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.templates.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.templates.subtitle")}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {accessible.map((loc) => (
          <Link
            key={loc.id}
            href={`/admin/checklist-templates?location=${loc.id}`}
            className={`inline-flex min-h-[44px] items-center rounded-lg border-2 px-3 text-sm font-bold transition ${
              loc.id === selected ? "border-co-gold-deep bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text hover:border-co-text"
            }`}
          >
            {loc.code} · {loc.name}
          </Link>
        ))}
      </div>

      <ul className="mt-5 flex flex-col gap-3">
        {templates.map((t) => (
          <li key={t.id}>
            <Link
              href={`/admin/checklist-templates/${t.id}`}
              className="flex items-center justify-between rounded-xl border-2 border-co-border bg-co-surface p-4 transition hover:border-co-text"
            >
              <span>
                <span className="block text-base font-extrabold text-co-text">
                  {serverT(lang, `admin.templates.subtype.${t.prepSubtype}` as Parameters<typeof serverT>[1])}
                </span>
                <span className="block text-sm text-co-text-muted">{t.name}</span>
              </span>
              <span className="text-sm text-co-text-muted">
                {serverT(lang, "admin.templates.item_count").replace("{count}", String(t.activeItemCount))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles + builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. If `serverT` rejects the dynamic key cast, mirror the cast style used in `app/(authed)/dashboard/page.tsx` for `role.${code}` (re-read it).

- [ ] **Step 3: Commit**

```bash
git add app/admin/checklist-templates/page.tsx
git commit -m "feat(C.44): prep-templates section page (list + location switcher)"
```

---

### Task 10: Detail page + client editor

**Files:**
- Create: `app/admin/checklist-templates/[templateId]/page.tsx`
- Create: `components/admin/templates/shared.ts`
- Create: `components/admin/templates/PrepTemplateEditor.tsx`
- Create: `components/admin/templates/PrepItemEditPanel.tsx`

- [ ] **Step 1: `shared.ts` (mirror `components/admin/users/shared.ts`)**

```ts
import type { TranslationKey } from "@/lib/i18n/types";

export async function postJson(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    return { ok: false, code: data.code ?? "generic" };
  } catch {
    return { ok: false, code: "generic" };
  }
}

const KNOWN = new Set([
  "forbidden", "template_not_found", "item_not_found", "location_not_found",
  "invalid_label", "invalid_par", "invalid_display_order", "invalid_min_role",
  "not_a_prep_item", "step_up_required", "step_up_stale",
]);

export function resolveErrorKey(code: string): TranslationKey {
  const key = KNOWN.has(code) ? code : "generic";
  return `admin.templates.error.${key}` as TranslationKey;
}
```

> Re-read `components/admin/users/shared.ts` first; if `postJson` already lives there in a shared/exportable form, import and reuse it instead of duplicating — only `resolveErrorKey` (templates-namespaced) is genuinely new.

- [ ] **Step 2: `PrepItemEditPanel.tsx` — per-item inline edit**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { ChecklistTemplateItem } from "@/lib/types";
import { postJson, resolveErrorKey } from "./shared";

export function PrepItemEditPanel({ templateId, item }: { templateId: string; item: ChecklistTemplateItem }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const es = item.translations?.es ?? {};
  const [labelEn, setLabelEn] = useState(item.label);
  const [labelEs, setLabelEs] = useState(es.label ?? "");
  const [parValue, setParValue] = useState(item.prepMeta?.parValue?.toString() ?? "");
  const [parUnit, setParUnit] = useState(item.prepMeta?.parUnit ?? "");
  const [siEn, setSiEn] = useState(item.prepMeta?.specialInstruction ?? "");
  const [siEs, setSiEs] = useState(es.specialInstruction ?? "");
  const [required, setRequired] = useState(item.required);
  const [minRole, setMinRole] = useState(item.minRoleLevel.toString());

  const base = `/api/admin/templates/${templateId}/items/${item.id}`;

  const saveContent = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(base, {
      label: labelEn.trim(),
      labelEs: labelEs.trim() || null,
      parValue: parValue.trim() === "" ? null : Number(parValue),
      parUnit: parUnit.trim() || null,
      specialInstruction: siEn.trim() || null,
      specialInstructionEs: siEs.trim() || null,
      required,
    }, "PATCH");
    setSubmitting(false);
    if (result.ok) { setOpen(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveMinRole = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`${base}/min-role`, { minRoleLevel: Number(minRole) }, "PATCH");
    setSubmitting(false);
    if (result.ok) { router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-co-text">
          {item.label}
          {item.prepMeta?.parValue != null ? (
            <span className="ml-2 text-co-text-muted">
              {t("admin.templates.field.par_value")}: {item.prepMeta.parValue}{item.prepMeta.parUnit ? ` ${item.prepMeta.parUnit}` : ""}
            </span>
          ) : null}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">
          {t("admin.templates.edit")}
        </button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <Labeled label={t("admin.templates.field.par_value")}><input className={field} inputMode="decimal" value={parValue} onChange={(e) => setParValue(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.par_unit")}><input className={field} value={parUnit} onChange={(e) => setParUnit(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.special_instruction")}><textarea className={field} value={siEn} onChange={(e) => setSiEn(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.special_instruction_es")}><textarea className={field} value={siEs} onChange={(e) => setSiEs(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.label_en")}><input className={field} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.label_es")}><input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} /></Labeled>
          <label className="flex items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            {t("admin.templates.field.required")}
          </label>

          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" disabled={submitting} onClick={() => setOpen(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">
              {t("admin.templates.cancel")}
            </button>
            <button type="button" disabled={submitting} onClick={() => void saveContent()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
              {t("admin.templates.save")}
            </button>
          </div>

          <div className="mt-2 border-t-2 border-co-border pt-3">
            <p className="text-xs text-co-text-muted">{t("admin.templates.min_role.hint")}</p>
            <div className="mt-2 flex items-end gap-2">
              <Labeled label={t("admin.templates.field.min_role_level")}>
                <input className={field} inputMode="numeric" value={minRole} onChange={(e) => setMinRole(e.target.value)} />
              </Labeled>
              <button type="button" disabled={submitting} onClick={() => void saveMinRole()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50">
                {t("admin.templates.min_role.change")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 3: `PrepTemplateEditor.tsx` — section-grouped list**

```tsx
"use client";

import { useTranslation } from "@/lib/i18n/provider";
import type { ChecklistTemplateItem } from "@/lib/types";
import { PrepItemEditPanel } from "./PrepItemEditPanel";

export function PrepTemplateEditor({ templateId, items }: { templateId: string; items: ChecklistTemplateItem[] }) {
  const { t } = useTranslation();
  // Group by station (the system key; section header). Order preserved from server (display_order).
  const groups = new Map<string, ChecklistTemplateItem[]>();
  for (const it of items) {
    const key = it.station ?? "—";
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  return (
    <div className="mt-5 flex flex-col gap-6">
      {[...groups.entries()].map(([section, sectionItems]) => (
        <section key={section}>
          <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
            {t("admin.templates.section_label")}: {section}
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            {sectionItems.map((it) => (
              <PrepItemEditPanel key={it.id} templateId={templateId} item={it} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Detail page**

`app/admin/checklist-templates/[templateId]/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getPrepTemplateDetail, AdminTemplateError } from "@/lib/admin/templates";
import { PrepTemplateEditor } from "@/components/admin/templates/PrepTemplateEditor";

export default async function AdminPrepTemplateDetailPage({
  params,
}: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 7) redirect("/dashboard");
  const lang = auth.user.language;

  let detail;
  try {
    detail = await getPrepTemplateDetail(auth, templateId);
  } catch (e) {
    if (e instanceof AdminTemplateError) redirect("/admin/checklist-templates");
    throw e;
  }

  return (
    <div>
      <Link href="/admin/checklist-templates" className="text-sm font-bold text-co-text-muted hover:text-co-text">
        ← {serverT(lang, "admin.templates.back_to_list")}
      </Link>
      <h1 className="mt-2 text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, `admin.templates.subtype.${detail.prepSubtype}` as Parameters<typeof serverT>[1])}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{detail.name}</p>
      <PrepTemplateEditor templateId={detail.id} items={detail.items} />
    </div>
  );
}
```

- [ ] **Step 5: Verify it compiles + builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/admin/templates/ "app/admin/checklist-templates/[templateId]/page.tsx"
git commit -m "feat(C.44): prep-template detail page + section-grouped editor UI"
```

---

### Task 11: Final gate

- [ ] **Step 1: Typecheck + build clean**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 2: Confirm no smoke scripts committed**

Run: `git ls-files scripts/ | grep _smoke_ || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Confirm the diff is scoped**

Run: `git diff --stat origin/main`
Expected: only the files in the File Structure table (plus the spec/plan docs). No migration files (this slice has none).

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin claude/prep-template-editor
gh pr create --title "C.44 Module 3 (slice 1): Prep Template Editor" --body "<test plan w/ PREVIEW url, not prod>"
```

PR body must include the **preview URL** (`co-ops-git-claude-prep-template-editor-juan-co-devs-projects.vercel.app`) and the Juan smoke checklist:
- Bump a real AM-prep par on preview → shows on the next AM-prep load AND on the Opening verification fallback.
- Edit a special instruction (EN+ES) → renders in each language.
- Change an item's min role level → forces a password re-prompt (Tier B); content edits don't re-prompt within the session (Tier A).
- A non-GM (level < 7) can't reach `/admin/checklist-templates` (redirects to dashboard).
- Confirm an item in a location you're NOT assigned to (as a location-scoped GM) returns not-found, not the editor.

---

## Notes for the implementer

- **Re-read before authoring each task** (confirm-before-authoring): the target file's current state, and for Task 3 specifically `lib/prep.ts setPrepItemMeta` (it asserts `meta.section === existing.station` and reads existing `prep_meta` to merge). The `audit()` shape is already resolved (before/after go inside `metadata`; no `beforeState`/`afterState` params — see the note in Task 3).
- **No migration.** If you find yourself reaching for `apply_migration`, stop — this slice is pure read + in-place UPDATE.
- **Smokes never get committed.** Create under `scripts/_smoke_*.ts`, run with `npx tsx --env-file=.env.local`, delete before the commit in the same task.
- **Don't touch `section` / `columns` / add / remove / versioning** — explicitly out of scope; those are the next slice.

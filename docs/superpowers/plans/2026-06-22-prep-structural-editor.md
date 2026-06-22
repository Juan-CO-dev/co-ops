# Prep Structural Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GM+ (level ≥ 7) can add / remove / change-section prep template items in place at `/admin/checklist-templates/[id]`, all Tier B, with the AM-prep ↔ Opening verification mirror kept in sync (create on add, deactivate on remove, section-sync on change).

**Architecture:** Extends slice 1's `lib/admin/templates.ts` (service-role data layer, app-layer gating, self-gating routes) + the slice-1 UI. Structural ops are all id-preserving / append-only (`active=false` for removal) so no Path-A versioning is needed (history frozen by C.44 snapshots; re-versioning would orphan the 68 Opening references). Section→columns conventions live in a new **client-safe** `lib/prep-sections.ts` shared by the server data layer and the client Add form.

**Tech Stack:** Next.js 16 App Router (async params `{ params }: { params: Promise<{ id: string; itemId: string }> }`), React 19, Tailwind v4 tokens (`co-text`, `co-text-muted`, `co-surface`, `co-border`, `co-gold`, `co-gold-deep`, `co-cta`), TS strict + `noUncheckedIndexedAccess`, Supabase custom-JWT + RLS (service-role for admin writes). No test framework: `tsc --noEmit` + `next build` + throwaway `tsx` smokes (deleted before commit). **No migration.**

**Spec:** `docs/superpowers/specs/2026-06-22-prep-structural-editor-design.md`

**Reference (re-read before authoring):** `lib/admin/templates.ts` (slice-1 — `loadAuthorizedPrepTemplate`, `getPrepTemplateDetail`, `updatePrepItemContent`, `setPrepItemMinRole`, private `propagateParToOpeningMirror`, `AdminTemplateError`, `mergeEsTranslation`), `lib/prep.ts` (`seedPrepItem`, `setPrepItemSection`, `setPrepItemMeta`, `isPrepMeta`), `lib/template-items.ts` (`TEMPLATE_ITEM_COLUMNS`, `rowToTemplateItem`), `lib/types.ts` (`PrepSection`, `PrepColumn`, `PrepMeta`, `ChecklistTemplateItem`, `ChecklistTemplateItemTranslations`), `app/api/admin/checklist-templates/[id]/items/[itemId]/route.ts` (slice-1 PATCH — you ADD a DELETE here), `components/admin/templates/{PrepTemplateEditor,PrepItemEditPanel,shared}.tsx`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/destructive-actions.ts` (modify) | Add `checklist_template_item.create`. |
| `lib/prep-sections.ts` (create) | **Client-safe** `PREP_SECTIONS`, `SECTION_COLUMNS`, `columnsForSection`. Pure data + type-only imports. |
| `lib/admin/templates.ts` (modify) | Refactor mirror helper → `resolveActiveOpeningTemplateId` + `createOpeningMirror`/`deactivateOpeningMirror`/`setOpeningMirrorSection`; add `addPrepItem`, `removePrepItem`, `changePrepItemSection`. |
| `app/api/admin/checklist-templates/[id]/items/route.ts` (create) | POST add item (Tier B). |
| `app/api/admin/checklist-templates/[id]/items/[itemId]/route.ts` (modify) | Add DELETE remove item (Tier B). |
| `app/api/admin/checklist-templates/[id]/items/[itemId]/section/route.ts` (create) | PATCH change section (Tier B). |
| `components/admin/templates/shared.ts` (modify) | Extend `KNOWN` error set. |
| `components/admin/templates/AddPrepItemForm.tsx` (create) | Client: add-item form. |
| `components/admin/templates/PrepTemplateEditor.tsx` (modify) | "+ Add item" affordance per section; thread `prepSubtype`. |
| `components/admin/templates/PrepItemEditPanel.tsx` (modify) | Remove control + section picker (Tier B). |
| `app/admin/checklist-templates/[id]/page.tsx` (modify) | Pass `prepSubtype` to the editor. |
| `lib/i18n/en.json` / `lib/i18n/es.json` (modify) | New `admin.templates.*` keys at parity. |

Smoke scripts (`scripts/_smoke_*.ts`) are created/run/**deleted before commit — never committed.**

---

### Task 1: Add the create audit action

**Files:** Modify `lib/destructive-actions.ts`

- [ ] **Step 1:** In the "Checklist template lifecycle" block, add `checklist_template_item.create` after the existing `checklist_template_item.update` line:

```ts
  // In-place create of a prep template item (C.44 Module 3 slice 2).
  // — destructive because it alters operational config. Auto-derives
  // destructive=true via isDestructive(). Append-only INSERT (new active row).
  "checklist_template_item.create",
```

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean).
- [ ] **Step 3:** Commit:
```bash
git add lib/destructive-actions.ts
git commit -m "feat(C.44): add checklist_template_item.create audit action"
```

---

### Task 2: Section conventions module + generalize the mirror helper

**Files:** Create `lib/prep-sections.ts`; Modify `lib/admin/templates.ts`

- [ ] **Step 1: Create `lib/prep-sections.ts` (client-safe, pure data)**

```ts
/**
 * Prep section → column conventions (C.44 Module 3 slice 2).
 *
 * CLIENT-SAFE: pure data + type-only imports (no DB, no server deps), so both
 * the server data layer (lib/admin/templates.ts) and the client Add form can
 * import it. The column convention per section is the canonical map documented
 * in lib/types.ts PrepColumn — single source so add + change-section agree.
 */

import type { PrepColumn, PrepSection } from "@/lib/types";

export const PREP_SECTIONS: readonly PrepSection[] = [
  "Veg",
  "Cooks",
  "Sides",
  "Sauces",
  "Slicing",
  "Misc",
];

const SECTION_COLUMNS: Record<PrepSection, PrepColumn[]> = {
  Veg: ["par", "on_hand", "back_up", "total"],
  Cooks: ["par", "on_hand", "total"],
  Sides: ["par", "portioned", "back_up", "total"],
  Sauces: ["par", "line", "back_up", "total"],
  Slicing: ["par", "line", "back_up", "total"],
  Misc: ["yes_no"],
};

/**
 * Columns for a section. Misc gains a free_text note column when includeNote.
 * Returns a fresh array each call (callers may store it on prep_meta).
 */
export function columnsForSection(section: PrepSection, includeNote = false): PrepColumn[] {
  const base = [...SECTION_COLUMNS[section]];
  if (section === "Misc" && includeNote) base.push("free_text");
  return base;
}

export function isPrepSectionName(v: unknown): v is PrepSection {
  return typeof v === "string" && (PREP_SECTIONS as readonly string[]).includes(v);
}
```

- [ ] **Step 2: In `lib/admin/templates.ts`, refactor `propagateParToOpeningMirror` to extract a resolver + add three sibling mirror helpers.** Re-read the current `propagateParToOpeningMirror` (around lines 158-201) first. Replace it with:

```ts
/** Resolve the active opening template id at a location (most-recent-active). */
async function resolveActiveOpeningTemplateId(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", locationId)
    .eq("type", "opening")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`resolveActiveOpeningTemplateId failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Update the linked Opening Phase-2 mirror's par (OpeningPhase2Meta.parValue/
 * parUnit). Link = mirror's references_template_item_id → the AM-prep item id,
 * scoped to the active opening template at the location. Returns affected ids.
 * No-op ([]) when no active opening template or no linked item.
 */
async function propagateParToOpeningMirror(args: {
  amPrepItemId: string;
  locationId: string;
  parValue: number | null;
  parUnit: string | null;
}): Promise<string[]> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return [];
  const { data: linked, error: lErr } = await sb
    .from("checklist_template_items")
    .select("id, prep_meta")
    .eq("template_id", openingId)
    .eq("references_template_item_id", args.amPrepItemId)
    .eq("active", true)
    .returns<Array<{ id: string; prep_meta: Record<string, unknown> | null }>>();
  if (lErr) throw new Error(`propagate: linked items lookup failed: ${lErr.message}`);
  const ids: string[] = [];
  for (const item of linked ?? []) {
    const nextMeta = { ...(item.prep_meta ?? {}), parValue: args.parValue, parUnit: args.parUnit };
    const { error: uErr } = await sb.from("checklist_template_items").update({ prep_meta: nextMeta }).eq("id", item.id);
    if (uErr) throw new Error(`propagate: update item ${item.id} failed: ${uErr.message}`);
    ids.push(item.id);
  }
  return ids;
}

/**
 * Create an Opening Phase-2 verification mirror for a newly-added AM-prep item.
 * Inserts into the active opening template at the location with OpeningPhase2Meta
 * prep_meta and references_template_item_id = the AM-prep item. Mirrors label/
 * translations/min-role/required; par/section mirrored. Appends to display_order.
 * Returns the new mirror id, or null when no active opening template (graceful).
 */
async function createOpeningMirror(args: {
  amPrepItemId: string;
  locationId: string;
  section: PrepSection;
  parValue: number | null;
  parUnit: string | null;
  label: string;
  translations: ChecklistTemplateItemTranslations | null;
  minRoleLevel: number;
  required: boolean;
}): Promise<string | null> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return null;

  const { data: maxRow, error: mErr } = await sb
    .from("checklist_template_items")
    .select("display_order")
    .eq("template_id", openingId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`createOpeningMirror max order failed: ${mErr.message}`);
  const nextOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("checklist_template_items")
    .insert({
      template_id: openingId,
      station: args.section,
      display_order: nextOrder,
      label: args.label,
      description: null,
      min_role_level: args.minRoleLevel,
      required: args.required,
      expects_count: false,
      expects_photo: false,
      vendor_item_id: null,
      active: true,
      translations: args.translations,
      prep_meta: { openingPhase2: true, section: args.section, parValue: args.parValue, parUnit: args.parUnit },
      report_reference_type: null,
      references_template_item_id: args.amPrepItemId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`createOpeningMirror insert failed: ${iErr.message}`);
  return inserted?.id ?? null;
}

/** Deactivate (active=false) the Opening mirror(s) linked to an AM-prep item. Returns affected ids. */
async function deactivateOpeningMirror(args: { amPrepItemId: string; locationId: string }): Promise<string[]> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return [];
  const { data, error } = await sb
    .from("checklist_template_items")
    .update({ active: false })
    .eq("template_id", openingId)
    .eq("references_template_item_id", args.amPrepItemId)
    .eq("active", true)
    .select("id")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`deactivateOpeningMirror failed: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

/** Update the Opening mirror's section (station + prep_meta.section) for a re-sectioned AM-prep item. */
async function setOpeningMirrorSection(args: { amPrepItemId: string; locationId: string; section: PrepSection }): Promise<string[]> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return [];
  const { data: linked, error: lErr } = await sb
    .from("checklist_template_items")
    .select("id, prep_meta")
    .eq("template_id", openingId)
    .eq("references_template_item_id", args.amPrepItemId)
    .eq("active", true)
    .returns<Array<{ id: string; prep_meta: Record<string, unknown> | null }>>();
  if (lErr) throw new Error(`setOpeningMirrorSection lookup failed: ${lErr.message}`);
  const ids: string[] = [];
  for (const item of linked ?? []) {
    const nextMeta = { ...(item.prep_meta ?? {}), section: args.section };
    const { error: uErr } = await sb
      .from("checklist_template_items")
      .update({ station: args.section, prep_meta: nextMeta })
      .eq("id", item.id);
    if (uErr) throw new Error(`setOpeningMirrorSection update ${item.id} failed: ${uErr.message}`);
    ids.push(item.id);
  }
  return ids;
}
```

- [ ] **Step 3: Add the imports** at the top of `lib/admin/templates.ts` (alongside existing imports): `PrepSection` from `@/lib/types` (add to the existing type import) and `columnsForSection`, `isPrepSectionName` from `@/lib/prep-sections`. (These are consumed in Tasks 3–5; if tsc flags them unused now, that's fine under this config — it doesn't error on unused imports — but the cleanest is to add them in the task that first uses them. To avoid churn, add the `PrepSection` type import now and add the `prep-sections` import in Task 3.)

- [ ] **Step 4:** `npx tsc --noEmit` (expected: clean — the refactor is behavior-preserving for `propagateParToOpeningMirror`; the three new helpers are unused until Tasks 3-5 but won't error).

- [ ] **Step 5:** Commit:
```bash
git add lib/prep-sections.ts lib/admin/templates.ts
git commit -m "feat(C.44): section-column conventions + generalize Opening mirror helpers"
```

---

### Task 3: `addPrepItem` (+ mirror create)

**Files:** Modify `lib/admin/templates.ts`

- [ ] **Step 1:** Ensure the import `import { columnsForSection, isPrepSectionName } from "@/lib/prep-sections";` is present (add if Task 2 didn't). Append `AddPrepItemInput` + `addPrepItem`:

```ts
export interface AddPrepItemInput {
  section: PrepSection;
  parValue: number | null;
  parUnit: string | null;
  label: string;
  labelEs: string | null;
  description: string | null;
  descriptionEs: string | null;
  specialInstruction: string | null;
  specialInstructionEs: string | null;
  minRoleLevel: number;
  required: boolean;
  includeNote: boolean;        // Misc only: add the free_text column
  createOpeningMirror: boolean; // am_prep only; ignored for mid-day
}

/** Add a prep template item in place (Tier B). AM-prep optionally gets an Opening mirror. */
export async function addPrepItem(
  actor: AuthContext,
  args: { templateId: string; input: AddPrepItemInput },
): Promise<{ itemId: string; openingMirrorId: string | null }> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  const sb = getServiceRoleClient();
  const { input } = args;

  if (!isPrepSectionName(input.section)) throw new AdminTemplateError(400, "invalid_section", "Unknown section");
  const label = input.label.trim();
  if (!label) throw new AdminTemplateError(400, "invalid_label", "Label is required");
  if (input.parValue !== null && (!Number.isFinite(input.parValue) || input.parValue < 0)) {
    throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
  }
  if (!Number.isFinite(input.minRoleLevel) || input.minRoleLevel < 0 || input.minRoleLevel > 10) {
    throw new AdminTemplateError(400, "invalid_min_role", "Min role level must be between 0 and 10");
  }

  // Append to display order (no unique constraint; max+1 across the template).
  const { data: maxRow, error: mErr } = await sb
    .from("checklist_template_items")
    .select("display_order")
    .eq("template_id", args.templateId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addPrepItem max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  // Build es translations from the *Es fields (only when present).
  const esLabel = input.labelEs?.trim() || undefined;
  const esDesc = input.descriptionEs?.trim() || null;
  const esSi = input.specialInstructionEs?.trim() || null;
  const hasEs = esLabel !== undefined || input.descriptionEs !== null || input.specialInstructionEs !== null;
  const translations: ChecklistTemplateItemTranslations | undefined = hasEs
    ? { es: { ...(esLabel !== undefined ? { label: esLabel } : {}), description: esDesc, specialInstruction: esSi } }
    : undefined;

  const { templateItemId } = await seedPrepItem(sb, {
    templateId: args.templateId,
    displayOrder,
    section: input.section,
    label,
    description: input.description?.trim() || null,
    minRoleLevel: input.minRoleLevel,
    required: input.required,
    meta: {
      parValue: input.parValue,
      parUnit: input.parUnit?.trim() || null,
      specialInstruction: input.specialInstruction?.trim() || null,
      columns: columnsForSection(input.section, input.includeNote),
    },
    translations,
  });

  let openingMirrorId: string | null = null;
  if (tmpl.prep_subtype === "am_prep" && input.createOpeningMirror) {
    openingMirrorId = await createOpeningMirror({
      amPrepItemId: templateItemId,
      locationId: tmpl.location_id,
      section: input.section,
      parValue: input.parValue,
      parUnit: input.parUnit?.trim() || null,
      label,
      translations: translations ?? null,
      minRoleLevel: input.minRoleLevel,
      required: input.required,
    });
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.create",
    resourceTable: "checklist_template_items",
    resourceId: templateItemId,
    metadata: {
      template_id: args.templateId,
      prep_subtype: tmpl.prep_subtype,
      section: input.section,
      created_opening_mirror_id: openingMirrorId,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { itemId: templateItemId, openingMirrorId };
}
```

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean). Verify `seedPrepItem`'s `meta` param is `Omit<PrepMeta,"section">` (so `{ parValue, parUnit, specialInstruction, columns }` is correct and `section` is added by `seedPrepItem`). If the signature differs, adjust to match the real one.
- [ ] **Step 3:** Commit:
```bash
git add lib/admin/templates.ts
git commit -m "feat(C.44): addPrepItem + Opening mirror create"
```

---

### Task 4: `removePrepItem` (+ mirror deactivate)

**Files:** Modify `lib/admin/templates.ts`

- [ ] **Step 1:** Append:

```ts
/** Remove (soft-delete) a prep item in place (Tier B). AM-prep cascade-deactivates the Opening mirror. */
export async function removePrepItem(
  actor: AuthContext,
  args: { templateId: string; itemId: string },
): Promise<{ deactivatedMirrorIds: string[] }> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  const sb = getServiceRoleClient();

  const { data: row, error: rErr } = await sb
    .from("checklist_template_items")
    .select("id, active")
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .maybeSingle<{ id: string; active: boolean }>();
  if (rErr) throw new Error(`removePrepItem read failed: ${rErr.message}`);
  if (!row) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  if (!row.active) return { deactivatedMirrorIds: [] }; // already removed — idempotent

  const { error: uErr } = await sb
    .from("checklist_template_items")
    .update({ active: false })
    .eq("id", args.itemId);
  if (uErr) throw new Error(`removePrepItem deactivate failed: ${uErr.message}`);

  let deactivatedMirrorIds: string[] = [];
  if (tmpl.prep_subtype === "am_prep") {
    deactivatedMirrorIds = await deactivateOpeningMirror({ amPrepItemId: args.itemId, locationId: tmpl.location_id });
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.delete",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: { template_id: args.templateId, prep_subtype: tmpl.prep_subtype, deactivated_mirror_ids: deactivatedMirrorIds },
    ipAddress: null,
    userAgent: null,
  });

  return { deactivatedMirrorIds };
}
```

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean).
- [ ] **Step 3:** Commit:
```bash
git add lib/admin/templates.ts
git commit -m "feat(C.44): removePrepItem + Opening mirror cascade-deactivate"
```

---

### Task 5: `changePrepItemSection` (+ columns re-derive + mirror section) + SMOKE

**Files:** Modify `lib/admin/templates.ts`; temp `scripts/_smoke_prep_structural.ts` (deleted before commit)

- [ ] **Step 1:** Append:

```ts
/**
 * Change a prep item's section in place (Tier B). Syncs station+prep_meta.section
 * via setPrepItemSection, then re-derives columns from the new section's
 * convention (preserving par/unit/specialInstruction scalars). AM-prep also
 * updates the Opening mirror's section. Audits with before/after section.
 */
export async function changePrepItemSection(
  actor: AuthContext,
  args: { templateId: string; itemId: string; section: PrepSection },
): Promise<{ mirrorSyncedIds: string[] }> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  if (!isPrepSectionName(args.section)) throw new AdminTemplateError(400, "invalid_section", "Unknown section");
  const sb = getServiceRoleClient();

  const { data: rawRow, error: rErr } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<TemplateItemRow>();
  if (rErr) throw new Error(`changePrepItemSection read failed: ${rErr.message}`);
  if (!rawRow) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  const item = rowToTemplateItem(rawRow);
  if (!isPrepMeta(item.prepMeta)) throw new AdminTemplateError(400, "not_a_prep_item", "Item has no prep metadata");

  const fromSection = item.prepMeta.section;
  if (fromSection === args.section) return { mirrorSyncedIds: [] }; // no-op

  // 1) Sync station + prep_meta.section to the new section (preserves scalars + columns).
  await setPrepItemSection(sb, { templateItemId: args.itemId, section: args.section });

  // 2) Re-derive columns for the new section (preserve par/unit/specialInstruction).
  const keepNote = args.section === "Misc" && item.prepMeta.columns.includes("free_text");
  const nextMeta: PrepMeta = {
    section: args.section,
    parValue: item.prepMeta.parValue,
    parUnit: item.prepMeta.parUnit,
    specialInstruction: item.prepMeta.specialInstruction,
    columns: columnsForSection(args.section, keepNote),
  };
  // setPrepItemMeta asserts meta.section === existing station (now args.section). OK.
  await setPrepItemMeta(sb, { templateItemId: args.itemId, meta: nextMeta });

  let mirrorSyncedIds: string[] = [];
  if (tmpl.prep_subtype === "am_prep") {
    mirrorSyncedIds = await setOpeningMirrorSection({ amPrepItemId: args.itemId, locationId: tmpl.location_id, section: args.section });
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
      field: "section",
      before: { section: fromSection },
      after: { section: args.section },
      mirror_synced_ids: mirrorSyncedIds,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { mirrorSyncedIds };
}
```

Add `setPrepItemMeta` to the existing `lib/prep.ts` import if not already imported (slice 1 imported it).

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean).

- [ ] **Step 3: Write the smoke** `scripts/_smoke_prep_structural.ts` (deleted before commit):

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { addPrepItem, removePrepItem, changePrepItemSection, getPrepTemplateDetail } from "@/lib/admin/templates";
import { narrowPrepTemplateItem } from "@/lib/prep";
import { rowToTemplateItem, TEMPLATE_ITEM_COLUMNS } from "@/lib/template-items";
import type { AuthContext } from "@/lib/session";

const actor = { user: { id: "00000000-0000-0000-0000-000000000000", role: "cgs" }, locations: [] } as unknown as AuthContext;

async function readItem(id: string) {
  const sb = getServiceRoleClient();
  const { data } = await sb.from("checklist_template_items").select(TEMPLATE_ITEM_COLUMNS).eq("id", id).single();
  return rowToTemplateItem(data as any);
}
async function readActive(id: string): Promise<boolean> {
  const sb = getServiceRoleClient();
  const { data } = await sb.from("checklist_template_items").select("active").eq("id", id).single();
  return (data as { active: boolean }).active;
}

async function main() {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).single();
  const locationId = (loc as { id: string }).id;

  const { data: amTmpl } = await sb.from("checklist_templates").insert({ location_id: locationId, type: "prep", prep_subtype: "am_prep", name: "_SMOKE AM", active: true }).select("id").single();
  const amId = (amTmpl as { id: string }).id;
  const { data: midTmpl } = await sb.from("checklist_templates").insert({ location_id: locationId, type: "prep", prep_subtype: "mid_day_prep", name: "_SMOKE MID", active: true }).select("id").single();
  const midId = (midTmpl as { id: string }).id;
  const { data: opTmpl } = await sb.from("checklist_templates").insert({ location_id: locationId, type: "opening", name: "_SMOKE OPEN", active: true }).select("id").single();
  const opId = (opTmpl as { id: string }).id;

  // ADD am-prep item with mirror
  const add = await addPrepItem(actor, { templateId: amId, input: {
    section: "Veg", parValue: 5, parUnit: "pans", label: "_smoke item", labelEs: "_smoke es",
    description: null, descriptionEs: null, specialInstruction: null, specialInstructionEs: null,
    minRoleLevel: 3, required: true, includeNote: false, createOpeningMirror: true,
  }});
  const created = await readItem(add.itemId);
  console.log("add: columns from section:", JSON.stringify(created.prepMeta?.columns) === JSON.stringify(["par","on_hand","back_up","total"]));
  console.log("add: mirror created:", add.openingMirrorId !== null);
  const mirror = await readItem(add.openingMirrorId!);
  console.log("add: mirror references item:", mirror.referencesTemplateItemId === add.itemId);
  console.log("add: mirror openingPhase2:", (mirror.prepMeta as any)?.openingPhase2 === true);

  // CHANGE SECTION Veg -> Cooks
  await changePrepItemSection(actor, { templateId: amId, itemId: add.itemId, section: "Cooks" });
  const resec = await readItem(add.itemId);
  console.log("section: station updated:", resec.station === "Cooks");
  console.log("section: meta.section updated:", resec.prepMeta?.section === "Cooks");
  console.log("section: columns re-derived:", JSON.stringify(resec.prepMeta?.columns) === JSON.stringify(["par","on_hand","total"]));
  console.log("section: par preserved:", resec.prepMeta?.parValue === 5);
  narrowPrepTemplateItem(resec); console.log("section: invariant intact: true");
  const mirror2 = await readItem(add.openingMirrorId!);
  console.log("section: mirror section synced:", (mirror2.prepMeta as any)?.section === "Cooks" && mirror2.station === "Cooks");

  // MID-DAY add: NO mirror
  const midAdd = await addPrepItem(actor, { templateId: midId, input: {
    section: "Sauces", parValue: 2, parUnit: null, label: "_smoke mid", labelEs: null,
    description: null, descriptionEs: null, specialInstruction: null, specialInstructionEs: null,
    minRoleLevel: 3, required: true, includeNote: false, createOpeningMirror: true,
  }});
  console.log("midday: no mirror:", midAdd.openingMirrorId === null);

  // REMOVE: item + mirror deactivated
  const rm = await removePrepItem(actor, { templateId: amId, itemId: add.itemId });
  console.log("remove: item inactive:", (await readActive(add.itemId)) === false);
  console.log("remove: mirror inactive:", (await readActive(add.openingMirrorId!)) === false);
  console.log("remove: reported mirror id:", rm.deactivatedMirrorIds.includes(add.openingMirrorId!));

  // cleanup: hard-delete all test rows (children first)
  await sb.from("checklist_template_items").delete().in("template_id", [amId, midId, opId]);
  await sb.from("checklist_templates").delete().in("id", [amId, midId, opId]);
  console.log("cleanup done");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run the smoke:** `npx tsx --env-file=.env.local scripts/_smoke_prep_structural.ts`
Expected: every `console.log` boolean prints `true` and `cleanup done`. (An `[audit] insert failed ... actor_id_fkey` line is EXPECTED — the fake all-zeros actor id has no users row; `audit()` is console-error-and-continue. Logic still succeeds.) If any assertion is false, fix the implementation (not the smoke).

- [ ] **Step 5: Delete smoke + commit (smoke must NOT be committed):**
```bash
rm scripts/_smoke_prep_structural.ts
git add lib/admin/templates.ts
git commit -m "feat(C.44): changePrepItemSection + columns re-derive + mirror section sync"
```
Verify: `git show --stat HEAD` lists only `lib/admin/templates.ts`.

---

### Task 6: API — POST /items (add, Tier B)

**Files:** Create `app/api/admin/checklist-templates/[id]/items/route.ts`

- [ ] **Step 1:**

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addPrepItem, AdminTemplateError, type AddPrepItemInput } from "@/lib/admin/templates";
import { isPrepSectionName } from "@/lib/prep-sections";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (!isPrepSectionName(b.section)) return jsonError(400, "invalid_section", { field: "section" });
  if (typeof b.label !== "string") return jsonError(400, "invalid_payload", { field: "label" });
  if (typeof b.minRoleLevel !== "number") return jsonError(400, "invalid_payload", { field: "minRoleLevel" });

  const input: AddPrepItemInput = {
    section: b.section,
    parValue: b.parValue === null || typeof b.parValue === "number" ? (b.parValue as number | null) : null,
    parUnit: typeof b.parUnit === "string" ? b.parUnit : null,
    label: b.label,
    labelEs: typeof b.labelEs === "string" ? b.labelEs : null,
    description: typeof b.description === "string" ? b.description : null,
    descriptionEs: typeof b.descriptionEs === "string" ? b.descriptionEs : null,
    specialInstruction: typeof b.specialInstruction === "string" ? b.specialInstruction : null,
    specialInstructionEs: typeof b.specialInstructionEs === "string" ? b.specialInstructionEs : null,
    minRoleLevel: b.minRoleLevel,
    required: b.required !== false, // default true
    includeNote: b.includeNote === true,
    createOpeningMirror: b.createOpeningMirror !== false, // default true
  };
  try {
    const result = await addPrepItem(ctx, { templateId: id, input });
    return jsonOk(result, 201);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean).
- [ ] **Step 3:** Commit:
```bash
git add "app/api/admin/checklist-templates/[id]/items/route.ts"
git commit -m "feat(C.44): POST add prep item route (Tier B)"
```

---

### Task 7: API — DELETE /items/[itemId] (remove, Tier B)

**Files:** Modify `app/api/admin/checklist-templates/[id]/items/[itemId]/route.ts` (add a DELETE handler next to the existing PATCH)

- [ ] **Step 1:** Re-read the file. Add imports for `removePrepItem` (extend the existing `@/lib/admin/templates` import). Append a `DELETE` export:

```ts
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  try {
    const result = await removePrepItem(ctx, { templateId: id, itemId });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

(`removePrepItem` is added to the existing `import { updatePrepItemContent, AdminTemplateError, type PrepItemContentPatch } from "@/lib/admin/templates";` line. `requireSession`/`ROLES`/`assertStepUp`/`jsonError`/`jsonOk` are already imported by the file's PATCH handler.)

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean).
- [ ] **Step 3:** Commit:
```bash
git add "app/api/admin/checklist-templates/[id]/items/[itemId]/route.ts"
git commit -m "feat(C.44): DELETE remove prep item route (Tier B)"
```

---

### Task 8: API — PATCH /items/[itemId]/section (Tier B)

**Files:** Create `app/api/admin/checklist-templates/[id]/items/[itemId]/section/route.ts`

- [ ] **Step 1:**

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { changePrepItemSection, AdminTemplateError } from "@/lib/admin/templates";
import { isPrepSectionName } from "@/lib/prep-sections";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/section`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const section = (parsed as { section?: unknown }).section;
  if (!isPrepSectionName(section)) return jsonError(400, "invalid_section", { field: "section" });
  try {
    const result = await changePrepItemSection(ctx, { templateId: id, itemId, section });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 2:** `npx tsc --noEmit` (expected: clean).
- [ ] **Step 3:** Commit:
```bash
git add "app/api/admin/checklist-templates/[id]/items/[itemId]/section/route.ts"
git commit -m "feat(C.44): PATCH change prep item section route (Tier B)"
```

---

### Task 9: i18n keys (EN + ES parity)

**Files:** Modify `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1:** Add to `en.json` (near the other `admin.templates.*` keys):

```json
"admin.templates.add_item": "+ Add item",
"admin.templates.add_item_title": "Add prep item",
"admin.templates.field.section": "Section",
"admin.templates.field.include_note": "Include a note field",
"admin.templates.field.create_opening_mirror": "Also create an Opening verification item",
"admin.templates.remove": "Remove",
"admin.templates.remove_confirm": "Remove this item? It stops appearing on the next prep (history is kept).",
"admin.templates.change_section": "Change section",
"admin.templates.error.invalid_section": "Pick a valid section.",
"admin.templates.section.Veg": "Veg",
"admin.templates.section.Cooks": "Cooks",
"admin.templates.section.Sides": "Sides",
"admin.templates.section.Sauces": "Sauces",
"admin.templates.section.Slicing": "Slicing",
"admin.templates.section.Misc": "Misc"
```

- [ ] **Step 2:** Add to `es.json` (operational tú-form):

```json
"admin.templates.add_item": "+ Agregar ítem",
"admin.templates.add_item_title": "Agregar ítem de prep",
"admin.templates.field.section": "Sección",
"admin.templates.field.include_note": "Incluir un campo de nota",
"admin.templates.field.create_opening_mirror": "Crear también un ítem de verificación de Apertura",
"admin.templates.remove": "Quitar",
"admin.templates.remove_confirm": "¿Quitar este ítem? Deja de aparecer en el próximo prep (el historial se conserva).",
"admin.templates.change_section": "Cambiar sección",
"admin.templates.error.invalid_section": "Elige una sección válida.",
"admin.templates.section.Veg": "Verduras",
"admin.templates.section.Cooks": "Cocidos",
"admin.templates.section.Sides": "Guarniciones",
"admin.templates.section.Sauces": "Salsas",
"admin.templates.section.Slicing": "Rebanado",
"admin.templates.section.Misc": "Varios"
```

- [ ] **Step 3:** Extend the `KNOWN` error set in `components/admin/templates/shared.ts` to include `"invalid_section"`:

```ts
const KNOWN = new Set([
  "forbidden",
  "template_not_found",
  "item_not_found",
  "location_not_found",
  "invalid_label",
  "invalid_par",
  "invalid_display_order",
  "invalid_min_role",
  "invalid_section",
  "not_a_prep_item",
  "step_up_required",
  "step_up_stale",
]);
```

- [ ] **Step 4:** `npx tsc --noEmit && npm run build` (expected: clean). Confirm EN and ES gained the SAME keys (13 each).
- [ ] **Step 5:** Commit:
```bash
git add lib/i18n/en.json lib/i18n/es.json components/admin/templates/shared.ts
git commit -m "feat(C.44): structural-editor i18n keys (EN+ES) + invalid_section"
```

---

### Task 10: UI — Add-item form + "+ Add item" affordance

**Files:** Create `components/admin/templates/AddPrepItemForm.tsx`; Modify `components/admin/templates/PrepTemplateEditor.tsx`; Modify `app/admin/checklist-templates/[id]/page.tsx`

- [ ] **Step 1: Create `AddPrepItemForm.tsx`** (mirror `PrepItemEditPanel` styling/patterns: `useStepUp`, `postJson`, `resolveErrorKey`, `router.refresh()`):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { PREP_SECTIONS } from "@/lib/prep-sections";
import type { PrepSection } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

export function AddPrepItemForm({
  templateId,
  prepSubtype,
  defaultSection,
  onClose,
}: {
  templateId: string;
  prepSubtype: "am_prep" | "mid_day_prep";
  defaultSection: PrepSection;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [section, setSection] = useState<PrepSection>(defaultSection);
  const [label, setLabel] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [parValue, setParValue] = useState("");
  const [parUnit, setParUnit] = useState("");
  const [includeNote, setIncludeNote] = useState(false);
  const [createMirror, setCreateMirror] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const submit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!label.trim()) { setErrorMsg(t("admin.templates.error.invalid_label")); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`/api/admin/checklist-templates/${templateId}/items`, {
      section,
      label: label.trim(),
      labelEs: labelEs.trim() || null,
      parValue: parValue.trim() === "" ? null : Number(parValue),
      parUnit: parUnit.trim() || null,
      minRoleLevel: 3,
      required: true,
      includeNote,
      createOpeningMirror: createMirror,
    }, "POST");
    setSubmitting(false);
    if (result.ok) { onClose(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{t("admin.templates.add_item_title")}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.section")}</span>
          <select className={field} value={section} onChange={(e) => setSection(e.target.value as PrepSection)}>
            {PREP_SECTIONS.map((s) => (
              <option key={s} value={s}>{t(`admin.templates.section.${s}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_en")}</span><input className={field} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_es")}</span><input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.par_value")}</span><input className={field} inputMode="decimal" value={parValue} onChange={(e) => setParValue(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.par_unit")}</span><input className={field} value={parUnit} onChange={(e) => setParUnit(e.target.value)} /></label>
        {section === "Misc" ? (
          <label className="flex items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={includeNote} onChange={(e) => setIncludeNote(e.target.checked)} />
            {t("admin.templates.field.include_note")}
          </label>
        ) : null}
        {prepSubtype === "am_prep" ? (
          <label className="flex items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={createMirror} onChange={(e) => setCreateMirror(e.target.checked)} />
            {t("admin.templates.field.create_opening_mirror")}
          </label>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={submitting} onClick={onClose} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">{t("admin.templates.cancel")}</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("admin.templates.save")}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modify `PrepTemplateEditor.tsx`** to accept `prepSubtype` and render a per-section "+ Add item" affordance that opens `AddPrepItemForm` pre-set to that section:

```tsx
"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { ChecklistTemplateItem, PrepSection } from "@/lib/types";
import { PREP_SECTIONS } from "@/lib/prep-sections";
import { PrepItemEditPanel } from "./PrepItemEditPanel";
import { AddPrepItemForm } from "./AddPrepItemForm";

export function PrepTemplateEditor({
  templateId,
  prepSubtype,
  items,
}: {
  templateId: string;
  prepSubtype: "am_prep" | "mid_day_prep";
  items: ChecklistTemplateItem[];
}) {
  const { t } = useTranslation();
  const [addingIn, setAddingIn] = useState<PrepSection | null>(null);

  const groups = new Map<string, ChecklistTemplateItem[]>();
  for (const it of items) {
    const key = it.station ?? "—";
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  // Render the 6 canonical sections in order, plus any non-standard station groups present.
  const sectionKeys: string[] = [...PREP_SECTIONS];
  for (const k of groups.keys()) if (!sectionKeys.includes(k)) sectionKeys.push(k);

  return (
    <div className="mt-5 flex flex-col gap-6">
      {sectionKeys.map((section) => {
        const sectionItems = groups.get(section) ?? [];
        const isStandard = (PREP_SECTIONS as readonly string[]).includes(section);
        return (
          <section key={section}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
                {t("admin.templates.section_label")}: {section}
              </h2>
              {isStandard ? (
                <button type="button" onClick={() => setAddingIn(section as PrepSection)}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">
                  {t("admin.templates.add_item")}
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {addingIn === section ? (
                <AddPrepItemForm templateId={templateId} prepSubtype={prepSubtype} defaultSection={section as PrepSection} onClose={() => setAddingIn(null)} />
              ) : null}
              {sectionItems.map((it) => (
                <PrepItemEditPanel key={it.id} templateId={templateId} item={it} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Modify the detail page** `app/admin/checklist-templates/[id]/page.tsx` to pass `prepSubtype`:

Change the `<PrepTemplateEditor ... />` call to:
```tsx
      <PrepTemplateEditor templateId={detail.id} prepSubtype={detail.prepSubtype} items={detail.items} />
```
(`detail.prepSubtype` is already on `AdminPrepTemplateDetail` from slice 1.)

- [ ] **Step 4:** `npx tsc --noEmit && npm run build` (expected: both clean).
- [ ] **Step 5:** Commit:
```bash
git add components/admin/templates/AddPrepItemForm.tsx components/admin/templates/PrepTemplateEditor.tsx "app/admin/checklist-templates/[id]/page.tsx"
git commit -m "feat(C.44): add-item form + per-section add affordance"
```

---

### Task 11: UI — Remove control + section picker on the edit panel

**Files:** Modify `components/admin/templates/PrepItemEditPanel.tsx`

- [ ] **Step 1:** Re-read the current `PrepItemEditPanel.tsx`. Add a section `<select>` and a Remove button inside the expanded edit area. Add the imports + handlers. Inside the component, after the existing state, add:

```tsx
  const [section, setSection] = useState(item.station ?? "");
```

Add `PREP_SECTIONS` import: `import { PREP_SECTIONS } from "@/lib/prep-sections";` and `import type { PrepSection } from "@/lib/types";` and `import type { TranslationKey } from "@/lib/i18n/types";` (if not present).

Add two handlers next to `saveContent`/`saveMinRole`:

```tsx
  const saveSection = async () => {
    if (submitting || !section || section === item.station) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`${base}/section`, { section }, "PATCH");
    setSubmitting(false);
    if (result.ok) { router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const removeItem = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!window.confirm(t("admin.templates.remove_confirm"))) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(base, {}, "DELETE");
    setSubmitting(false);
    if (result.ok) { router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };
```

REQUIRED first (so `postJson(base, {}, "DELETE")` type-checks — NO cast): widen `postJson`'s `method` param in `components/admin/users/shared.ts` from `method: "POST" | "PATCH" = "POST"` to `method: "POST" | "PATCH" | "DELETE" = "POST"` (one-line change; `fetch` already accepts any method string). Re-read that file to confirm the exact current signature before editing. This is why Task 11's commit also stages `components/admin/users/shared.ts`.

- [ ] **Step 2:** In the expanded edit JSX (the `{open ? (...) : null}` block), add a section picker + a remove control. Put the section picker near the min-role block, and the Remove button in its own row:

```tsx
          <div className="mt-2 border-t-2 border-co-border pt-3">
            <Labeled label={t("admin.templates.field.section")}>
              <div className="flex items-end gap-2">
                <select className={field} value={section} onChange={(e) => setSection(e.target.value)}>
                  {PREP_SECTIONS.map((s) => (
                    <option key={s} value={s}>{t(`admin.templates.section.${s}` as TranslationKey)}</option>
                  ))}
                </select>
                <button type="button" disabled={submitting} onClick={() => void saveSection()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50">
                  {t("admin.templates.change_section")}
                </button>
              </div>
            </Labeled>
          </div>

          <div className="mt-2 border-t-2 border-co-border pt-3">
            <button type="button" disabled={submitting} onClick={() => void removeItem()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-surface px-3 text-xs font-bold text-co-cta hover:bg-co-cta hover:text-co-surface disabled:opacity-50">
              {t("admin.templates.remove")}
            </button>
          </div>
```

(Place these inside the existing `{open ? (<div className="mt-3 flex flex-col gap-3"> ... </div>) : null}` container, after the min-role block. The `field` const + `Labeled` helper already exist in this file.)

- [ ] **Step 3:** `npx tsc --noEmit && npm run build` (expected: both clean).
- [ ] **Step 4:** Commit:
```bash
git add components/admin/templates/PrepItemEditPanel.tsx components/admin/users/shared.ts
git commit -m "feat(C.44): remove control + section picker on prep item edit panel"
```

---

### Task 12: Final gate

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` — both clean.
- [ ] **Step 2:** `git ls-files scripts/ | grep _smoke_ || echo "clean"` — expect `clean`.
- [ ] **Step 3:** `git diff --stat origin/main` — only the files in the File Structure table (+ spec/plan docs); no migration files.
- [ ] **Step 4:** Push + PR:
```bash
git push -u origin claude/prep-structural-editor
gh pr create --title "C.44 Module 3 (slice 2): Prep Structural Editor" --body "<test plan w/ PREVIEW url + smoke checklist>"
```
PR body: preview URL `co-ops-git-claude-prep-structural-editor-juan-co-devs-projects.vercel.app`, plus smoke checklist:
- Add a prep item (AM-prep, mirror toggle on) → appears on next AM-prep load AND a verification row appears on the Opening sheet.
- Add a mid-day prep item → no Opening row.
- Change an item's section → re-buckets on the prep sheet (and the mirror follows for AM-prep).
- Remove an item → gone from the prep sheet (and its Opening mirror gone too for AM-prep).
- Non-GM (< 7) can't reach the editor.
- Each structural action re-prompts for password (Tier B).

---

## Notes for the implementer

- **Re-read before each task** (confirm-before-authoring): the current `lib/admin/templates.ts` (slice-1 shipped — it has `propagateParToOpeningMirror`, `loadAuthorizedPrepTemplate`, `updatePrepItemContent`, etc.) and `lib/prep.ts` `seedPrepItem`/`setPrepItemSection`/`setPrepItemMeta` signatures. The `audit()` shape is resolved: before/after go inside `metadata` (no `beforeState`/`afterState` params).
- **No migration.** If you reach for `apply_migration`, stop.
- **`lib/prep-sections.ts` is client-safe** — pure data + type-only imports. Never import `lib/admin/templates.ts` (service-role) into a client component.
- **The Opening mirror uses `OpeningPhase2Meta` shape** (`{ openingPhase2:true, section, parValue, parUnit }`), NOT `PrepMeta` — `getPrepTemplateDetail`'s `narrowPrepTemplateItem` only runs on prep templates, never on the mirror, so there's no `isPrepMeta` conflict.
- **Smokes never committed.** Create under `scripts/_smoke_*.ts`, run with `npx tsx --env-file=.env.local`, delete before the commit.
- **Out of scope:** Path-A versioning, opening/closing task-item editing, manual column choice, reorder UI (already shipped via the display-order field).

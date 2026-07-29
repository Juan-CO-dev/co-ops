/**
 * Template Builder write/publish layer — THE FLOOR (spec §2).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level >= 7 → assertStepUp)
 * and re-checked here for the IDOR location-bind (defense in depth). Service-role
 * bypasses RLS by design, consistent with lib/admin/templates.ts and
 * lib/admin/needs-link.ts.
 *
 * This is the FUTURE single write path for ALL non-prep template mutations. PR-0
 * ships only the FOUNDATION, not the full editor API:
 *   - a batch read (loadTemplateBuilderView) across locations for a given type;
 *   - the two SPEC-SANCTIONED SAME-DAY FILLS (spec §1): fillItemTranslations
 *     (es fields where missing/empty) and fillItemSpineLink (item_id/vendor_item_id
 *     where null). Both change DATA only — no behavior, no capture — so they do
 *     NOT version. Full content editing (relabels etc.) arrives with the
 *     draft/publish engine (PR-3). Structural writes (add/disable/reorder/gate)
 *     are LATER PRs — nothing for them is exported yet.
 *
 * COEXISTENCE: prep-template writes stay on their proven path (lib/admin/
 * templates.ts + lib/prep.ts setPrepItemMeta). This lib does NOT touch prep.
 *
 * Canonical spec: docs/superpowers/specs/2026-07-28-template-builder-design.md
 */

import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { isAllLocationsAccess, lockLocationContext } from "@/lib/locations";
import {
  TEMPLATE_ITEM_COLUMNS,
  type TemplateItemRow,
  rowToTemplateItem,
} from "@/lib/template-items";
import type { AuthContext } from "@/lib/session";
import type { ChecklistTemplateItem } from "@/lib/types";
import {
  TemplateBuilderError,
  assertNotMirrorItem,
  mergeEsFill,
  isMirrorItem,
  esFillCount,
  itemNeedsLink,
  diffLocationItems,
  classifyRoleFloor,
  CLOSING_CONFIRM_FLOOR_LEVEL,
  type ItemTranslationFill,
  type SpineLinkTarget,
  type DriftFinding,
  type RoleFloorFinding,
  type TemplateBuilderType,
  type TemplateBuilderTemplate,
  type TemplateBuilderView,
  type TemplateDoctorTemplate,
  type TemplateDoctorReport,
} from "@/lib/admin/template-builder-shared";

// Re-export the client-safe surface so server consumers keep one import path.
export {
  TemplateBuilderError,
  isMirrorItem,
  assertNotMirrorItem,
  mergeEsFill,
  esFillCount,
  itemNeedsLink,
  diffLocationItems,
  classifyRoleFloor,
  CLOSING_CONFIRM_FLOOR_LEVEL,
} from "@/lib/admin/template-builder-shared";
export type {
  ItemTranslationFill,
  SpineLinkTarget,
  DriftFinding,
  RoleFloorFinding,
  TemplateBuilderType,
  TemplateBuilderTemplate,
  TemplateBuilderView,
  TemplateDoctorTemplate,
  TemplateDoctorReport,
} from "@/lib/admin/template-builder-shared";

function actorLocationShape(actor: AuthContext) {
  return { role: actor.user.role, locations: actor.locations };
}

/**
 * Load every ACTIVE template of `type` at locations the actor may access, each
 * with its items ordered for display. Batch: two queries total (templates, then
 * all items in one `.in()`), reusing TEMPLATE_ITEM_COLUMNS/rowToTemplateItem.
 *
 * NOTE — this is a BUILDER (forward-authoring) read, so it filters active items:
 * the manager edits the CURRENT list. It is NOT a historical render path, so the
 * active filter is correct here (contrast §2.2 historical reads, which drop it).
 */
export async function loadTemplateBuilderView(
  actor: AuthContext,
  type: TemplateBuilderType,
): Promise<TemplateBuilderView> {
  const sb = getServiceRoleClient();

  const { data: tplRows, error: tErr } = await sb
    .from("checklist_templates")
    .select("id, name, type, location_id, active")
    .eq("type", type)
    .eq("active", true)
    .order("location_id", { ascending: true })
    .returns<Array<{ id: string; name: string; type: string; location_id: string; active: boolean }>>();
  if (tErr) throw new Error(`loadTemplateBuilderView templates: ${tErr.message}`);

  const actorAll = isAllLocationsAccess(actorLocationShape(actor));
  const visible = (tplRows ?? []).filter((t) => actorAll || actor.locations.includes(t.location_id));
  const templateIds = visible.map((t) => t.id);

  const itemsByTemplate = new Map<string, ChecklistTemplateItem[]>();
  if (templateIds.length > 0) {
    const { data: itemRows, error: iErr } = await sb
      .from("checklist_template_items")
      .select(TEMPLATE_ITEM_COLUMNS)
      .in("template_id", templateIds)
      .eq("active", true)
      .order("template_id", { ascending: true })
      .order("display_order", { ascending: true })
      .returns<TemplateItemRow[]>();
    if (iErr) throw new Error(`loadTemplateBuilderView items: ${iErr.message}`);
    for (const raw of itemRows ?? []) {
      const item = rowToTemplateItem(raw);
      const arr = itemsByTemplate.get(item.templateId) ?? [];
      arr.push(item);
      itemsByTemplate.set(item.templateId, arr);
    }
  }

  return {
    type,
    templates: visible.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      locationId: t.location_id,
      items: itemsByTemplate.get(t.id) ?? [],
    })),
  };
}

/**
 * Load an item + its template, bind the template to the actor's authorized
 * location (IDOR → 404, don't confirm existence). Shared preamble for both fills.
 */
async function loadAuthorizedItem(
  actor: AuthContext,
  args: { templateId: string; itemId: string },
): Promise<{ item: ChecklistTemplateItem; templateType: string; locationId: string }> {
  const sb = getServiceRoleClient();

  const { data: raw, error: rErr } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<TemplateItemRow>();
  if (rErr) throw new Error(`loadAuthorizedItem read: ${rErr.message}`);
  if (!raw) throw new TemplateBuilderError(404, "item_not_found", "Template item not found");

  const { data: tpl, error: tErr } = await sb
    .from("checklist_templates")
    .select("id, type, location_id, active")
    .eq("id", args.templateId)
    .maybeSingle<{ id: string; type: string; location_id: string; active: boolean }>();
  if (tErr) throw new Error(`loadAuthorizedItem template read: ${tErr.message}`);
  if (!tpl || !tpl.active) throw new TemplateBuilderError(404, "item_not_found", "Template item not found");
  if (!lockLocationContext(actorLocationShape(actor), tpl.location_id)) {
    throw new TemplateBuilderError(404, "item_not_found", "Template item not found");
  }

  return { item: rowToTemplateItem(raw), templateType: tpl.type, locationId: tpl.location_id };
}

/**
 * SAME-DAY FILL #1 (spec §1): fill Spanish translation fields (label/description/
 * specialInstruction) IN PLACE — STRICT FILL: a field writes ONLY where it is
 * currently missing/empty (mergeEsFill enforces); an existing es value is never
 * overwritten or deleted here. Changing existing Spanish is a content edit and
 * belongs to PR-3's versioning engine. Data-completeness only — changes no
 * behavior and no capture, so it does NOT version.
 *
 * Rejects mirror rows (spec §2.3). Count-checked UPDATE (UPDATE-denials-are-
 * silent) + audited.
 */
export async function fillItemTranslations(
  actor: AuthContext,
  args: { templateId: string; itemId: string; fill: ItemTranslationFill },
): Promise<void> {
  const { item, templateType } = await loadAuthorizedItem(actor, { templateId: args.templateId, itemId: args.itemId });

  // Spec §2.3 — Opening Phase-2 mirrors are read-only (managed by AM Prep).
  assertNotMirrorItem(item.prepMeta);

  const { fill } = args;
  if (fill.labelEs === undefined && fill.descriptionEs === undefined && fill.specialInstructionEs === undefined) {
    throw new TemplateBuilderError(400, "invalid_payload", "No translation fields provided");
  }

  const nextTranslations = mergeEsFill(item.translations, fill);

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("checklist_template_items")
    .update({ translations: nextTranslations }, { count: "exact" })
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true);
  if (error) throw new Error(`fillItemTranslations update: ${error.message}`);
  if (count === 0) throw new TemplateBuilderError(404, "item_not_found", "Template item not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: {
      template_id: args.templateId,
      template_type: templateType,
      field: "translation_fill",
      before: { translations_es: item.translations?.es ?? null },
      after: { translations_es: nextTranslations.es ?? null },
    },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * SAME-DAY FILL #2 (spec §1, §4): set item_id OR vendor_item_id on a line whose
 * spine link is currently null — the needs-link fill, moved INSIDE the builder.
 * In-place ADDITIVE (id + label preserved); only ONE ref is set, and only when
 * BOTH are currently null (we never rewrite an existing link). Data-completeness
 * only → no version.
 *
 * Rejects mirror rows (spec §2.3). The target must exist + be active. The UPDATE
 * re-asserts both-null in its WHERE (concurrency; UPDATE-denials-are-silent →
 * count check) + is audited.
 */
export async function fillItemSpineLink(
  actor: AuthContext,
  args: { templateId: string; itemId: string; target: SpineLinkTarget },
): Promise<void> {
  const { item, templateType } = await loadAuthorizedItem(actor, { templateId: args.templateId, itemId: args.itemId });

  // Spec §2.3 — Opening Phase-2 mirrors are read-only (managed by AM Prep).
  assertNotMirrorItem(item.prepMeta);

  // Spec §4 — the spine-link fill targets COUNT-BEARING lines (parity with
  // needs-link's linkTemplateItem): a plain tick never carries a link.
  if (!item.expectsCount) {
    throw new TemplateBuilderError(409, "not_countable", "Only count-bearing lines take a spine link");
  }

  if (item.itemId !== null || item.vendorItemId !== null) {
    throw new TemplateBuilderError(409, "already_linked", "This line is already linked");
  }

  const sb = getServiceRoleClient();

  // Verify the target exists + is active.
  const update: Record<string, unknown> = {};
  if (args.target.kind === "item") {
    const { data: it, error: iErr } = await sb
      .from("items").select("id").eq("id", args.target.id).eq("active", true).maybeSingle<{ id: string }>();
    if (iErr) throw new Error(`fillItemSpineLink item check: ${iErr.message}`);
    if (!it) throw new TemplateBuilderError(400, "invalid_target", "Item not found or inactive");
    update.item_id = args.target.id;
  } else {
    const { data: sk, error: sErr } = await sb
      .from("vendor_items").select("id").eq("id", args.target.id).eq("active", true).maybeSingle<{ id: string }>();
    if (sErr) throw new Error(`fillItemSpineLink sku check: ${sErr.message}`);
    if (!sk) throw new TemplateBuilderError(400, "invalid_target", "SKU not found or inactive");
    update.vendor_item_id = args.target.id;
  }

  const { error, count } = await sb
    .from("checklist_template_items")
    .update(update, { count: "exact" })
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    // Re-assert BOTH-null so a concurrent link can't be silently overwritten.
    .is("item_id", null)
    .is("vendor_item_id", null);
  if (error) throw new Error(`fillItemSpineLink update: ${error.message}`);
  if (count === 0) throw new TemplateBuilderError(409, "already_linked", "This line is already linked");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: {
      template_id: args.templateId,
      template_type: templateType,
      field: "spine_link_fill",
      after: args.target.kind === "item" ? { item_id: args.target.id } : { vendor_item_id: args.target.id },
    },
    ipAddress: null,
    userAgent: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The Template Doctor (spec §6) — derive-on-read integrity report. NO writes.
// Composes the PURE classifiers (template-builder-shared) over the batch-loaded
// view; the ONLY extra I/O is location names (one `.in()`). Reported, never
// gating (only a future open-instances check blocks a publish — PR-3). The
// report SHAPES (TemplateDoctorReport / TemplateDoctorTemplate) live in
// template-builder-shared so the client renders them without server proximity.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the Template Doctor for a type across the actor's visible locations.
 * Derive-on-read: reuses loadTemplateBuilderView (2 queries) + one batch
 * location-name lookup. Invariants v1 (spec §6): needs-link, es fill-counts,
 * role-floor sanity, and location drift NAMED per item. Reference/gate-target
 * existence + orphaned-mirror checks arrive with the PRs that build those
 * mechanisms (§5 refs = PR-4); hard-gated listing = SKIP (no column yet, §3).
 *
 * For `closing` the confirm floor is KH+ (CLOSING_CONFIRM_FLOOR_LEVEL). Opening
 * (PR-2) is also confirmable and reuses the same floor; deep_cleaning has no
 * confirm gate → role-floor findings degrade to advisory only.
 */
export async function runTemplateDoctor(
  actor: AuthContext,
  type: TemplateBuilderType,
): Promise<TemplateDoctorReport> {
  const view = await loadTemplateBuilderView(actor, type);

  // Batch location names (one query) for NAMED drift + per-template display.
  const locationIds = [...new Set(view.templates.map((t) => t.locationId))];
  const locationNameById = new Map<string, string>();
  if (locationIds.length > 0) {
    const sb = getServiceRoleClient();
    const { data: locRows, error: lErr } = await sb
      .from("locations").select("id, name").in("id", locationIds)
      .returns<Array<{ id: string; name: string }>>();
    if (lErr) throw new Error(`runTemplateDoctor locations: ${lErr.message}`);
    for (const l of locRows ?? []) locationNameById.set(l.id, l.name);
  }

  const confirmFloorLevel = CLOSING_CONFIRM_FLOOR_LEVEL;

  const templates: TemplateDoctorTemplate[] = view.templates.map((tpl) => {
    const needsLink = tpl.items
      .filter((it) => itemNeedsLink(it))
      .map((it) => ({ itemId: it.id, label: it.label }));
    return {
      templateId: tpl.id,
      templateName: tpl.name,
      locationId: tpl.locationId,
      locationName: locationNameById.get(tpl.locationId) ?? null,
      needsLink,
      esFill: esFillCount(tpl.items),
      roleFloor: classifyRoleFloor(tpl.items, confirmFloorLevel),
    };
  });

  // Location drift: diff the two locations' active item label sets. Only defined
  // when exactly two locations are visible (the CO shape); with 0/1 there is no
  // cross-location diff to make.
  let drift: DriftFinding[] = [];
  if (view.templates.length === 2) {
    const [a, b] = view.templates;
    if (a && b) {
      drift = diffLocationItems(
        { locationId: a.locationId, labels: a.items.map((it) => it.label) },
        { locationId: b.locationId, labels: b.items.map((it) => it.label) },
      );
    }
  }

  const totals = {
    needsLink: templates.reduce((n, t) => n + t.needsLink.length, 0),
    esMissing: templates.reduce((n, t) => n + (t.esFill.total - t.esFill.filled), 0),
    roleFloorImpossible: templates.reduce(
      (n, t) => n + t.roleFloor.filter((f) => f.severity === "impossible").length,
      0,
    ),
    drift: drift.length,
  };

  return { type, templates, drift, confirmFloorLevel, totals };
}

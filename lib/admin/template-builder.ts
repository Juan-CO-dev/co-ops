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
import { operationalNow } from "@/lib/midshift";
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
  esFillCount,
  itemNeedsLink,
  diffLocationItems,
  classifyRoleFloor,
  confirmFloorForType,
  classifyEdits,
  nextOperationalDay,
  applyEffectiveResolution,
  type ItemTranslationFill,
  type SpineLinkTarget,
  type DriftFinding,
  type TemplateBuilderType,
  type TemplateBuilderView,
  type TemplateDoctorTemplate,
  type TemplateDoctorReport,
  type TemplateItemEdit,
  type TemplateDiffSummary,
  type PublishEffectiveMode,
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
  classifyEdits,
  nextOperationalDay,
  shiftOperationalDay,
  applyEffectiveResolution,
  CLOSING_CONFIRM_FLOOR_LEVEL,
  OPENING_CONFIRM_FLOOR_LEVEL,
  confirmFloorForType,
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
  TemplateItemEdit,
  TemplateDiffSummary,
  PublishEffectiveMode,
} from "@/lib/admin/template-builder-shared";

function actorLocationShape(actor: AuthContext) {
  return { role: actor.user.role, locations: actor.locations };
}

/** One active template row (lineage-latest candidate) for the builder loader. */
interface LineageTplRow {
  id: string;
  name: string;
  type: string;
  location_id: string;
  active: boolean;
  effective_from: string | null;
  created_at: string;
  prep_subtype: string | null;
}

/** Lineage key for the builder view: one edit target per (location, name, subtype). */
function lineageKey(t: { location_id: string; name: string; prep_subtype: string | null }): string {
  return `${t.location_id}::${t.name}::${t.prep_subtype ?? ""}`;
}

/**
 * Collapse all active rows of a type to the LINEAGE-LATEST per (location, name,
 * subtype): the newest by (effective_from DESC NULLS LAST, created_at DESC). PR-3:
 * when a PENDING version exists (effective_from > today) it wins — the pending
 * version is the EDIT TARGET (a manager editing the current list is really editing
 * the pending one it already published, not spawning a third). effective_from NULL
 * (legacy) sorts last but wins when it's the only active row. Pure over the rows.
 */
function pickLineageLatest(rows: LineageTplRow[]): LineageTplRow[] {
  const byLineage = new Map<string, LineageTplRow>();
  for (const r of rows) {
    if (!r.active) continue;
    const k = lineageKey(r);
    const cur = byLineage.get(k);
    if (!cur || newerVersion(r, cur)) byLineage.set(k, r);
  }
  return [...byLineage.values()];
}

/** TRUE when `a` outranks `b` under (effective_from DESC NULLS LAST, created_at DESC). */
function newerVersion(a: LineageTplRow, b: LineageTplRow): boolean {
  if (a.effective_from !== b.effective_from) {
    if (a.effective_from === null) return false; // NULL sorts LAST
    if (b.effective_from === null) return true;
    return a.effective_from > b.effective_from;
  }
  return a.created_at > b.created_at;
}

/**
 * Load the LINEAGE-LATEST template of `type` at each location the actor may access,
 * each with its ACTIVE items ordered for display. Batch: two queries (templates,
 * then all items in one `.in()`), reusing TEMPLATE_ITEM_COLUMNS/rowToTemplateItem.
 *
 * PR-3 change: the edit target is the lineage-latest (pending version when one
 * exists) — NOT merely "every active row" (which would double the location tabs
 * during a both-active window). The client banners when the loaded version's
 * effective_from > today ("changes go live tomorrow morning").
 *
 * NOTE — this is a BUILDER (forward-authoring) read, so it filters active items.
 * It is NOT a historical render path (contrast §2.2 historical reads).
 */
export async function loadTemplateBuilderView(
  actor: AuthContext,
  type: TemplateBuilderType,
): Promise<TemplateBuilderView> {
  const sb = getServiceRoleClient();

  const { data: tplRows, error: tErr } = await sb
    .from("checklist_templates")
    .select("id, name, type, location_id, active, effective_from, created_at, prep_subtype")
    .eq("type", type)
    .eq("active", true)
    .order("location_id", { ascending: true })
    .returns<LineageTplRow[]>();
  if (tErr) throw new Error(`loadTemplateBuilderView templates: ${tErr.message}`);

  const actorAll = isAllLocationsAccess(actorLocationShape(actor));
  const accessible = (tplRows ?? []).filter((t) => actorAll || actor.locations.includes(t.location_id));
  const visible = pickLineageLatest(accessible);
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

  const today = operationalNow(new Date()).date;
  return {
    type,
    templates: visible.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      locationId: t.location_id,
      items: itemsByTemplate.get(t.id) ?? [],
      // PR-3: the loaded version is PENDING when its effective date is future — the
      // client shows the "live tomorrow morning" banner.
      effectiveFrom: t.effective_from,
      isPending: t.effective_from !== null && t.effective_from > today,
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
 * The confirm floor is resolved PER TYPE (confirmFloorForType): closing and
 * opening both confirm at KH+ (level 4 — CLOSING_CONFIRM_FLOOR_LEVEL /
 * OPENING_CONFIRM_FLOOR_LEVEL, verified equal but named per type so a future
 * divergence is a one-line change and closing's constant is never silently
 * applied to opening). deep_cleaning has no confirm gate → role-floor findings
 * degrade to advisory only (and it has no templates to classify anyway).
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

  const confirmFloorLevel = confirmFloorForType(type);

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

  // PR-3 publish signals: TODAY's open instances across the visible lineages (powers
  // the apply-now gate message) + whether any loaded version is pending. Instances
  // are counted across the WHOLE lineage (all versions at each location), because the
  // apply-now gate blocks on any instance today regardless of which version bound it.
  let openInstancesToday = 0;
  const hasPendingVersion = view.templates.some((t) => t.isPending === true);
  const today = operationalNow(new Date()).date;
  if (view.templates.length > 0) {
    const sb = getServiceRoleClient();
    // Resolve the whole lineage id-set for the visible templates (one query, batched
    // by the visible location+name+subtype set).
    const locationIds = [...new Set(view.templates.map((t) => t.locationId))];
    const names = [...new Set(view.templates.map((t) => t.name))];
    const { data: lineageRows, error: lgErr } = await sb
      .from("checklist_templates")
      .select("id, location_id, name")
      .eq("type", type)
      .in("location_id", locationIds)
      .in("name", names)
      .returns<Array<{ id: string; location_id: string; name: string }>>();
    if (lgErr) throw new Error(`runTemplateDoctor lineage ids: ${lgErr.message}`);
    // Keep only ids whose (location,name) matches a visible template (defensive —
    // .in() is a cross-product; a name shared across locations stays scoped).
    const visibleKeys = new Set(view.templates.map((t) => `${t.locationId}::${t.name}`));
    const lineageIds = (lineageRows ?? [])
      .filter((r) => visibleKeys.has(`${r.location_id}::${r.name}`))
      .map((r) => r.id);
    if (lineageIds.length > 0) {
      const { count, error: instErr } = await sb
        .from("checklist_instances")
        .select("id", { count: "exact", head: true })
        .in("template_id", lineageIds)
        .eq("date", today);
      if (instErr) throw new Error(`runTemplateDoctor open instances: ${instErr.message}`);
      openInstancesToday = count ?? 0;
    }
  }

  return {
    type,
    templates,
    drift,
    confirmFloorLevel,
    totals,
    publish: { openInstancesToday, hasPendingVersion },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PR-3 — THE PUBLISH ENGINE (spec §1 THE RECONCILIATION CONTRACT + §10 PR-3).
//
// Every publish MINTS A NEW checklist_templates row (a new version) with a fresh
// copy of the item rows, effective NEXT OPERATIONAL DAY (apply-now = today, gated).
// No in-place mutation of a version that has ever served an instance — history is
// immutable by construction (instances bind template_id at creation).
//
// ── ATOMICITY (codebase pattern) ─────────────────────────────────────────────────
// supabase-js has no client-side multi-statement transaction; this module follows
// lib/admin/templates.ts's established Path-A pattern (sequenced service-role writes
// + rowcount checks), but ORDERED so a mid-sequence failure can NEVER strand the
// operational read:
//   1. MINT the new version FIRST (a fully-formed version always exists);
//   2. copy items onto it;
//   3. retire OTHER active lineage rows LAST.
// The date-aware resolver picks the newest effective version (effective_from DESC
// NULLS LAST, created_at DESC) — so even if step 3 partially fails, the new version
// still wins the resolution (its effective_from is >= the ones it replaces, and its
// created_at is newest). This is exactly why the invariant is "correctness NEVER
// depends on retirement sweeps" (0162 header). Retirement is hygiene, not the rule.
// ─────────────────────────────────────────────────────────────────────────────

/** The template-copyable metadata columns (0162 mint — spec §1). NOT the item
 *  columns; those copy via SELECT * (see copyItemsToVersion). */
const TEMPLATE_COPY_COLUMNS =
  "id, name, type, location_id, prep_subtype, description, single_submission_only, reminder_time, submission_gate_predicate, edit_gate_predicate, active, effective_from";

interface SourceTemplateRow {
  id: string;
  name: string;
  type: string;
  location_id: string;
  prep_subtype: string | null;
  description: string | null;
  single_submission_only: boolean;
  reminder_time: string | null;
  submission_gate_predicate: unknown | null;
  edit_gate_predicate: unknown | null;
  active: boolean;
  effective_from: string | null;
}

/** A raw item row for the SELECT-* copy — the shape is intentionally open (the copy
 *  MUST carry columns TEMPLATE_ITEM_COLUMNS omits, e.g. section_question_id /
 *  item_question_id — verified present in prod, absent from the column constant). */
type RawItemRow = Record<string, unknown> & {
  id: string;
  template_id: string;
  label: string;
  active: boolean;
  min_role_level: number;
  required: boolean;
  display_order: number;
  expects_count: boolean;
  item_id: string | null;
  vendor_item_id: string | null;
  prep_meta: unknown | null;
  translations: Record<string, unknown> | null;
};

export interface PublishResult {
  newTemplateId: string;
  effectiveFrom: string;
  diff: TemplateDiffSummary;
}

/**
 * publishTemplateVersion — spec §1/§10 PR-3. GM+ (enforced at the route: level>=7 +
 * Tier-A step-up) + re-checked here for the IDOR location-bind. Mints a new version
 * of the source template's lineage with `edits` applied, effective today (apply_now,
 * gated) or the next operational day (default).
 *
 * Retirement rules (adjudication a2):
 *   a. Pending-replacement — any OTHER active lineage row with effective_from > today
 *      (a never-served pending version) is retired (it never bound an instance, so
 *      retiring it cannot rewrite history).
 *   b. Cleanup — retire every OTHER active lineage row EXCEPT the currently-effective
 *      one (date-aware resolution identifies it). For apply_now, retire ALL other
 *      active rows including the currently-effective one (the gate proved no instance
 *      today, so no operator is mid-list on it).
 *
 * Returns { newTemplateId, effectiveFrom, diff }.
 */
export async function publishTemplateVersion(
  actor: AuthContext,
  args: {
    templateId: string;
    edits: readonly TemplateItemEdit[];
    effectiveMode: PublishEffectiveMode;
  },
): Promise<PublishResult> {
  const sb = getServiceRoleClient();
  const today = operationalNow(new Date()).date;

  // 1. Load + IDOR-bind the source template; assert an editable non-prep type.
  const { data: src, error: srcErr } = await sb
    .from("checklist_templates")
    .select(TEMPLATE_COPY_COLUMNS)
    .eq("id", args.templateId)
    .maybeSingle<SourceTemplateRow>();
  if (srcErr) throw new Error(`publishTemplateVersion source read: ${srcErr.message}`);
  if (!src) throw new TemplateBuilderError(404, "template_not_found", "Template not found");
  if (!lockLocationContext(actorLocationShape(actor), src.location_id)) {
    throw new TemplateBuilderError(404, "template_not_found", "Template not found");
  }
  if (src.type !== "opening" && src.type !== "closing") {
    // deep_cleaning has no rows/type in prod (spec §9); prep versions on its own path.
    throw new TemplateBuilderError(409, "type_not_publishable", "Only opening/closing lists publish here");
  }

  // 2. effectiveFrom.
  const applyNow = args.effectiveMode === "apply_now";
  const effectiveFrom = applyNow ? today : nextOperationalDay(today);

  // Enumerate the whole lineage's template ids (all versions — active or not) at
  // this location for the apply-now gate + the retirement pass. Lineage key =
  // (location_id, type, name, prep_subtype); prep_subtype is NULL for opening/closing
  // so the .is() form matches.
  let lineageQuery = sb
    .from("checklist_templates")
    .select("id, active, effective_from, created_at")
    .eq("location_id", src.location_id)
    .eq("type", src.type)
    .eq("name", src.name);
  lineageQuery =
    src.prep_subtype === null
      ? lineageQuery.is("prep_subtype", null)
      : lineageQuery.eq("prep_subtype", src.prep_subtype);
  const { data: lineageRows, error: lErr } = await lineageQuery.returns<
    Array<{ id: string; active: boolean; effective_from: string | null; created_at: string }>
  >();
  if (lErr) throw new Error(`publishTemplateVersion lineage read: ${lErr.message}`);
  const lineage = lineageRows ?? [];
  const lineageIds = lineage.map((r) => r.id);

  // 3. APPLY-NOW GATE — a live-today publish is blocked if TODAY's list is already
  // in use on ANY version of the lineage (a mid-shift swap would strand closers).
  if (applyNow && lineageIds.length > 0) {
    const { count: todayCount, error: instErr } = await sb
      .from("checklist_instances")
      .select("id", { count: "exact", head: true })
      .in("template_id", lineageIds)
      .eq("location_id", src.location_id)
      .eq("date", today);
    if (instErr) throw new Error(`publishTemplateVersion apply-now gate: ${instErr.message}`);
    if ((todayCount ?? 0) > 0) {
      throw new TemplateBuilderError(
        409,
        "apply_now_blocked_open_instance",
        "Today's list is already in use — publish for tomorrow morning",
      );
    }
  }

  // Load the source items (SELECT * — MUST carry columns TEMPLATE_ITEM_COLUMNS omits).
  const { data: srcItemsRaw, error: iErr } = await sb
    .from("checklist_template_items")
    .select("*")
    .eq("template_id", src.id)
    .order("display_order", { ascending: true })
    .returns<RawItemRow[]>();
  if (iErr) throw new Error(`publishTemplateVersion source items: ${iErr.message}`);
  const srcItems = srcItemsRaw ?? [];

  // The diff summary (confirm-modal + audit metadata ONLY — never gates the write).
  const diff = classifyEdits(
    srcItems.map((r) => ({
      id: r.id,
      label: r.label,
      minRoleLevel: Number(r.min_role_level),
      required: r.required,
      active: r.active,
    })),
    args.edits,
  );

  // 4c. MINT the new version FIRST (ordering rationale above). effective_from set,
  // supersedes = source id; active=true. Never copies id (fresh) — INSERT.
  const { data: minted, error: mintErr } = await sb
    .from("checklist_templates")
    .insert({
      name: src.name,
      type: src.type,
      location_id: src.location_id,
      prep_subtype: src.prep_subtype,
      description: src.description,
      single_submission_only: src.single_submission_only,
      reminder_time: src.reminder_time,
      submission_gate_predicate: src.submission_gate_predicate,
      edit_gate_predicate: src.edit_gate_predicate,
      active: true,
      effective_from: effectiveFrom,
      supersedes_template_id: src.id,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (mintErr) throw new Error(`publishTemplateVersion mint: ${mintErr.message}`);
  if (!minted) throw new Error("publishTemplateVersion mint: no row returned");
  const newTemplateId = minted.id;

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template.create",
    resourceTable: "checklist_templates",
    resourceId: newTemplateId,
    metadata: {
      publish_op: "version_mint",
      template_type: src.type,
      location_id: src.location_id,
      supersedes_template_id: src.id,
      effective_from: effectiveFrom,
      apply_now: applyNow,
      diff_summary: {
        added: diff.added.length,
        removed: diff.removed.length,
        relabeled: diff.relabeled.length,
        reordered: diff.reordered,
        roleChanged: diff.roleChanged.length,
        requiredChanged: diff.requiredChanged.length,
      },
    },
    ipAddress: null,
    userAgent: null,
  });

  // 4d. Copy items (SELECT * verbatim) onto the new version, applying edits.
  await copyItemsToVersion(sb, {
    actor,
    newTemplateId,
    srcItems,
    edits: args.edits,
    templateType: src.type,
  });

  // 4a + 4b. RETIREMENT (ordering: after mint+copy so the new version is complete).
  // - Pending replacement: retire OTHER active rows with effective_from > today.
  // - Cleanup: retire every OTHER active row EXCEPT the currently-effective one;
  //   for apply_now, retire the currently-effective one too (gate proved none today).
  const currentlyEffectiveId = resolveCurrentlyEffective(lineage, today);
  for (const row of lineage) {
    if (row.id === newTemplateId) continue; // never retire the row we just minted
    if (!row.active) continue;

    const isPending = row.effective_from !== null && row.effective_from > today;
    const isCurrentlyEffective = row.id === currentlyEffectiveId;

    // Keep the currently-effective row UNLESS apply_now (then it's replaced today).
    if (isCurrentlyEffective && !applyNow) continue;

    const { count: retCount, error: retErr } = await sb
      .from("checklist_templates")
      .update({ active: false }, { count: "exact" })
      .eq("id", row.id)
      .eq("active", true); // re-assert active for concurrency (UPDATE-denials-are-silent)
    if (retErr) throw new Error(`publishTemplateVersion retire ${row.id}: ${retErr.message}`);
    if ((retCount ?? 0) === 0) continue; // already retired by a concurrent publish — fine

    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "checklist_template.delete_or_deactivate",
      resourceTable: "checklist_templates",
      resourceId: row.id,
      metadata: {
        publish_op: isPending ? "pending_replaced" : "superseded",
        template_type: src.type,
        location_id: src.location_id,
        superseded_by_template_id: newTemplateId,
        effective_from: row.effective_from,
      },
      ipAddress: null,
      userAgent: null,
    });
  }

  return { newTemplateId, effectiveFrom, diff };
}

/**
 * Resolve which lineage row is CURRENTLY effective on `opDate` — the date-aware
 * rule applied in-memory over the loaded lineage (newest active version whose
 * effective_from is NULL or <= opDate; ties broken by created_at DESC). Mirrors
 * applyEffectiveResolution's SQL ordering exactly. Returns null when none is
 * effective yet (only pending versions exist — a fresh lineage state).
 */
function resolveCurrentlyEffective(
  lineage: Array<{ id: string; active: boolean; effective_from: string | null; created_at: string }>,
  opDate: string,
): string | null {
  const eligible = lineage.filter(
    (r) => r.active && (r.effective_from === null || r.effective_from <= opDate),
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    // effective_from DESC NULLS LAST
    if (a.effective_from !== b.effective_from) {
      if (a.effective_from === null) return 1;
      if (b.effective_from === null) return -1;
      return a.effective_from < b.effective_from ? 1 : -1;
    }
    // created_at DESC
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
  return eligible[0]?.id ?? null;
}

/**
 * Copy the source item rows onto the new version, applying the draft edits.
 * SELECT-* verbatim (spec §1: every column copies except id (new) + template_id
 * (new version)); edits mutate label/description/translations/station/display_order/
 * min_role_level/required; a "disable" edit lands the copied row active=false (the
 * version's row set is TOTAL — a disabled row renders nowhere but keeps the lineage
 * story complete, orchestrator ruling). Mirror rows (openingPhase2) copy VERBATIM,
 * ignoring any edit addressed to them (they're managed by AM Prep — belt-and-braces
 * over the client seal). Added items INSERT fresh; expects_count REQUIRES a spine
 * link at write (spine-link law §4, re-enforced server-side).
 */
async function copyItemsToVersion(
  sb: ReturnType<typeof getServiceRoleClient>,
  args: {
    actor: AuthContext;
    newTemplateId: string;
    srcItems: RawItemRow[];
    edits: readonly TemplateItemEdit[];
    templateType: string;
  },
): Promise<void> {
  const { newTemplateId, srcItems, edits } = args;

  // Index edits by source item id (mirror rows ignore edits; see below).
  const editsById = new Map<string, TemplateItemEdit[]>();
  const addEdits: Extract<TemplateItemEdit, { op: "add" }>[] = [];
  for (const e of edits) {
    if (e.op === "add") {
      addEdits.push(e);
      continue;
    }
    const arr = editsById.get(e.itemId) ?? [];
    arr.push(e);
    editsById.set(e.itemId, arr);
  }

  // Build the copied rows.
  const copiedRows: Record<string, unknown>[] = [];
  for (const raw of srcItems) {
    // Strip identity columns — the new row gets a fresh id + the new template_id.
    const { id: _oldId, template_id: _oldTpl, ...rest } = raw;
    const row: Record<string, unknown> = { ...rest, template_id: newTemplateId };

    const isMirror = isMirrorItemRaw(raw.prep_meta);
    if (!isMirror) {
      // Apply the coalesced edits addressed to this source item.
      for (const e of editsById.get(raw.id) ?? []) {
        applyEditToRow(row, e);
      }
    }
    // Mirror rows: copy VERBATIM (incl. references_template_item_id + prep_meta) —
    // no edits ever apply (spec §5 derivation + PR-0 seal).
    copiedRows.push(row);
  }

  // Added items → fresh rows with the spine-link guard.
  let maxOrder = srcItems.reduce((m, r) => Math.max(m, Number(r.display_order) || 0), 0);
  for (const a of addEdits) {
    if (a.expectsCount) {
      const link = a.spineLink ?? null;
      if (!link) {
        throw new TemplateBuilderError(
          400,
          "spine_link_required",
          `Count-bearing item "${a.label}" needs an item or SKU link`,
        );
      }
    }
    maxOrder += 1;
    const es = a.es ?? {};
    const translations =
      es.label || es.description ? { es: { label: es.label ?? null, description: es.description ?? null } } : null;
    copiedRows.push({
      template_id: newTemplateId,
      station: a.station ?? null,
      display_order: a.displayOrder || maxOrder,
      label: a.label,
      description: a.description ?? null,
      min_role_level: a.minRoleLevel,
      required: a.required,
      expects_count: a.expectsCount,
      expects_photo: a.expectsPhoto ?? false,
      item_id: a.expectsCount && a.spineLink?.kind === "item" ? a.spineLink.id : null,
      vendor_item_id: a.expectsCount && a.spineLink?.kind === "sku" ? a.spineLink.id : null,
      active: true,
      translations,
      prep_meta: null,
      report_reference_type: null,
      references_template_item_id: null,
    });
  }

  if (copiedRows.length === 0) return;

  const { data: inserted, error: insErr } = await sb
    .from("checklist_template_items")
    .insert(copiedRows)
    .select("id")
    .returns<Array<{ id: string }>>();
  if (insErr) throw new Error(`copyItemsToVersion insert: ${insErr.message}`);
  if (!inserted || inserted.length !== copiedRows.length) {
    throw new Error(
      `copyItemsToVersion: expected ${copiedRows.length} rows, inserted ${inserted?.length ?? 0}`,
    );
  }

  // One audit row for the item-set copy (batch — per-row would flood the log).
  await audit({
    actorId: args.actor.user.id,
    actorRole: args.actor.user.role,
    action: "checklist_template_item.create",
    resourceTable: "checklist_template_items",
    resourceId: newTemplateId,
    metadata: {
      publish_op: "version_items_copy",
      template_type: args.templateType,
      new_template_id: newTemplateId,
      copied_count: copiedRows.length,
      added_count: addEdits.length,
    },
    ipAddress: null,
    userAgent: null,
  });
}

/** Mutate a copied item row in place per one edit. Pure column writes; never touches
 *  id/template_id (already set by the copy). */
function applyEditToRow(row: Record<string, unknown>, e: TemplateItemEdit): void {
  switch (e.op) {
    case "relabel":
      row.label = e.label;
      break;
    case "describe":
      row.description = e.description;
      break;
    case "station":
      row.station = e.station;
      break;
    case "reorder":
      row.display_order = e.displayOrder;
      break;
    case "role":
      row.min_role_level = e.minRoleLevel;
      break;
    case "required":
      row.required = e.required;
      break;
    case "disable":
      row.active = false;
      break;
    case "enable":
      row.active = true;
      break;
    case "translate": {
      const cur = (row.translations as Record<string, unknown> | null) ?? {};
      const es = { ...((cur.es as Record<string, unknown>) ?? {}) };
      if (e.es.label !== undefined) es.label = e.es.label;
      if (e.es.description !== undefined) es.description = e.es.description;
      if (e.es.specialInstruction !== undefined) es.specialInstruction = e.es.specialInstruction;
      row.translations = { ...cur, es };
      break;
    }
    case "add":
      // handled separately (fresh insert) — never reaches here.
      break;
  }
}

/** Raw-JSONB mirror check (the copy works on snake_case rows, not the mapped item). */
function isMirrorItemRaw(prepMeta: unknown): boolean {
  if (typeof prepMeta !== "object" || prepMeta === null) return false;
  return (prepMeta as { openingPhase2?: unknown }).openingPhase2 === true;
}

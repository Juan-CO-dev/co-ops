/**
 * READ-ONLY prep overview loader (PR-3/4 of the checklist full-edit arc).
 *
 * SERVER-ONLY. The closing/opening Template Builder mounts a READ-ONLY prep
 * overview + prep Doctor: for each actor-visible location × prep subtype
 * (am_prep + mid_day_prep), the ACTIVE prep template's active lines projected via
 * THE READ LAW (resolveLineDefinition + loadItemDefns — never the raw label for a
 * linked live inventory line), plus the pure prep-Doctor classifiers
 * (input-type drift across locations, needs-link, untranslated).
 *
 * Prep evolves in its OWN editor (unanimous council ruling — no publish-versioning):
 * this surface has ZERO edit affordances; every fix deep-links to the prep editor.
 * Prep findings are ADVISORY and NEVER folded into the closing/opening
 * TemplateDoctorReport totals.
 *
 * Service-role client throughout — admin authorization is enforced APP-LAYER by the
 * calling builder page (requireSessionFromHeaders → level >= 6), consistent with
 * lib/admin/template-builder.ts. Actor location scoping is re-applied here.
 *
 * Canonical spec: docs/superpowers/specs/2026-07-30-prep-builder-view-design.md
 */

import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { isAllLocationsAccess } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import {
  TEMPLATE_ITEM_COLUMNS,
  type TemplateItemRow,
  rowToTemplateItem,
} from "@/lib/template-items";
import {
  loadItemDefns,
  resolveLineDefinition,
  isQuestionShapedLine,
} from "@/lib/items";
import { shapeFromColumns } from "@/lib/prep-sections";
import { applyEffectiveResolution, type EffectiveResolvableBuilder } from "@/lib/admin/template-builder-shared";
import type { AuthContext } from "@/lib/session";
import type { ChecklistTemplateItem, PrepColumn } from "@/lib/types";
import {
  PREP_SUBTYPES,
  classifyPrepInputTypeDrift,
  prepOverviewTotals,
  type PrepSubtypeKey,
  type PrepOverviewLine,
  type PrepOverviewTemplate,
  type PrepOverviewReport,
} from "@/lib/admin/prep-overview-shared";

// Re-export the client-safe surface so server consumers keep one import path.
export {
  PREP_SUBTYPES,
  prepLineIdentity,
  classifyPrepInputTypeDrift,
  classifyPrepNeedsLink,
  prepEsFill,
  prepOverviewTotals,
} from "@/lib/admin/prep-overview-shared";
export type {
  PrepSubtypeKey,
  PrepOverviewLine,
  PrepOverviewTemplate,
  PrepInputTypeDriftFinding,
  PrepOverviewReport,
} from "@/lib/admin/prep-overview-shared";

/** One (location, subtype) active prep template row (id + name), or null. */
interface ActivePrepRow {
  id: string;
  name: string;
}

/**
 * Resolve the ACTIVE prep template (id + name) at a location for a subtype, date-aware
 * (applyEffectiveResolution — the same single-row pick as resolveActivePrepTemplateId in
 * lib/admin/templates.ts; prep is unversioned so this collapses to the one active row).
 */
async function resolveActivePrepTemplate(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  subtype: PrepSubtypeKey,
  opDate: string,
): Promise<ActivePrepRow | null> {
  const base = sb
    .from("checklist_templates")
    .select("id, name")
    .eq("location_id", locationId)
    .eq("type", "prep")
    .eq("prep_subtype", subtype) as unknown as EffectiveResolvableBuilder;
  const { data, error } = await applyEffectiveResolution(base, opDate).maybeSingle<ActivePrepRow>();
  if (error) throw new Error(`resolveActivePrepTemplate(${subtype}) failed: ${error.message}`);
  return data ?? null;
}

/**
 * Project one active prep template's active lines via THE READ LAW. `itemDefns` is the
 * batch-loaded registry map (loadItemDefns) — resolveLineDefinition consults it so a
 * linked LIVE inventory line shows the registry name, while a question / unlinked /
 * deactivated-item line falls to its own label. esMissing is READ-LAW-aware: a linked
 * inventory line is filled when the REGISTRY name_es exists (name_es is es on those lines).
 */
function projectLines(
  items: ChecklistTemplateItem[],
  itemDefns: Awaited<ReturnType<typeof loadItemDefns>>,
): PrepOverviewLine[] {
  const out: PrepOverviewLine[] = [];
  for (const line of items) {
    const columns: PrepColumn[] = line.prepMeta?.columns ?? [];
    const questionShaped = isQuestionShapedLine(line);
    const linkedItem = line.itemId ? itemDefns.get(line.itemId) ?? null : null;
    const resolved = resolveLineDefinition(line, linkedItem);
    // The line reads as a linked INVENTORY line only when it links to a LIVE item AND
    // isn't question-shaped — exactly the case where the registry name (+ name_es) speaks.
    const usesRegistry = !questionShaped && linkedItem !== null && linkedItem.active !== false;
    const esLabel = usesRegistry
      ? resolved.nameEs // = items.name_es via resolveLineDefinition
      : line.translations?.es?.label ?? null;
    const esMissing = !(typeof esLabel === "string" && esLabel.trim() !== "");
    out.push({
      lineId: line.id,
      displayLabel: resolved.name,
      rawLabel: line.label,
      section: line.prepMeta?.section ?? line.station ?? "",
      inputType: shapeFromColumns(columns),
      // The third spine-link ref (0181). Prep lines link to registry ITEMS in
      // practice — the equipment lines live on opening/closing temp logs — so this
      // arm is null today on every prep row. It is here so the classifier cannot
      // drift from needs-link-shared's `needsLink` if that ever changes.
      linked: line.itemId !== null || line.equipmentId !== null,
      itemId: line.itemId,
      questionShaped,
      esMissing,
      displayOrder: line.displayOrder,
    });
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Load the READ-ONLY prep overview + prep Doctor for the actor's visible locations.
 * For each visible location × subtype (am_prep + mid_day_prep) resolves the active prep
 * template, projects its active lines via THE READ LAW, and composes the pure classifiers.
 * Batched: one locations query, one active-template resolve per (location,subtype), one
 * items query across ALL resolved templates, one registry batch-load. Advisory only.
 */
export async function loadPrepOverview(actor: AuthContext): Promise<PrepOverviewReport> {
  const sb = getServiceRoleClient();
  const opDate = operationalNow(new Date()).date;

  // Actor-visible ACTIVE locations (the CO shape = two; the drift classifier
  // needs both). Active filter matches every sibling location query in lib/ —
  // a deactivated location must not surface here while absent from the prep
  // editor this panel deep-links to (adversarial C1).
  const { data: locRows, error: lErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`loadPrepOverview locations: ${lErr.message}`);
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  const locations = (locRows ?? []).filter((l) => actorAll || actor.locations.includes(l.id));

  // Resolve the active prep template per (location, subtype).
  type Resolved = { locationId: string; locationName: string; subtype: PrepSubtypeKey; tpl: ActivePrepRow };
  const resolved: Resolved[] = [];
  for (const loc of locations) {
    for (const subtype of PREP_SUBTYPES) {
      const tpl = await resolveActivePrepTemplate(sb, loc.id, subtype, opDate);
      if (tpl) resolved.push({ locationId: loc.id, locationName: loc.name, subtype, tpl });
    }
  }

  // One items query across ALL resolved templates (active lines only).
  const templateIds = resolved.map((r) => r.tpl.id);
  const itemsByTemplate = new Map<string, ChecklistTemplateItem[]>();
  const allItemIds = new Set<string>();
  if (templateIds.length > 0) {
    const { data: itemRows, error: iErr } = await sb
      .from("checklist_template_items")
      .select(TEMPLATE_ITEM_COLUMNS)
      .in("template_id", templateIds)
      .eq("active", true)
      .order("template_id", { ascending: true })
      .order("display_order", { ascending: true })
      .returns<TemplateItemRow[]>();
    if (iErr) throw new Error(`loadPrepOverview items: ${iErr.message}`);
    for (const raw of itemRows ?? []) {
      const item = rowToTemplateItem(raw);
      const arr = itemsByTemplate.get(item.templateId) ?? [];
      arr.push(item);
      itemsByTemplate.set(item.templateId, arr);
      if (item.itemId) allItemIds.add(item.itemId);
    }
  }

  // One registry batch-load for THE READ LAW (name / name_es / active).
  const itemDefns = await loadItemDefns(sb, [...allItemIds]);

  const templates: PrepOverviewTemplate[] = resolved.map((r) => ({
    templateId: r.tpl.id,
    templateName: r.tpl.name,
    locationId: r.locationId,
    locationName: r.locationName,
    subtype: r.subtype,
    lines: projectLines(itemsByTemplate.get(r.tpl.id) ?? [], itemDefns),
  }));

  const inputTypeDrift = classifyPrepInputTypeDrift(templates);
  const totals = prepOverviewTotals(templates, inputTypeDrift);

  return { templates, inputTypeDrift, totals };
}

/**
 * The Master List — needs-link queue data layer (piece 3). SERVER-ONLY,
 * service-role. Admin authz is app-layer at the calling route/page (level floor
 * + step-up) AND re-checked here per-write. Re-exports the client-safe surface.
 *
 * Surfaces active count-lines (expects_count) that reference neither a registry
 * item nor a SKU, so Juan links each to its master-list target in place — the
 * item-line law's remediation path for pre-existing lines (spec §2). Linking is
 * in-place ADDITIVE per the template-evolution law: id + label preserved, only
 * item_id OR vendor_item_id set.
 *
 * Canonical reference: docs/superpowers/specs/2026-07-26-master-list-taxonomy-design.md
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { isAllLocationsAccess } from "@/lib/locations";
import { deriveCatalogType, type CatalogType, type ItemType, type SkuClass } from "@/lib/admin/catalog-shared";
import type { AuthContext } from "@/lib/session";

export { needsLink } from "@/lib/admin/needs-link-shared";
export type { NeedsLinkInput, NeedsLinkRow, LinkTarget } from "@/lib/admin/needs-link-shared";
import type { NeedsLinkRow, LinkTarget } from "@/lib/admin/needs-link-shared";

export const NEEDS_LINK_READ_MIN = 6; // AGM+ view (mirrors CATALOG_READ_MIN)
export const NEEDS_LINK_WRITE_MIN = 7; // GM+ links a line (Tier A at the route)

export class AdminNeedsLinkError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminNeedsLinkError";
  }
}

interface LineRow {
  id: string;
  template_id: string;
  label: string;
  station: string | null;
  expects_count: boolean;
  item_id: string | null;
  vendor_item_id: string | null;
  active: boolean;
}

/**
 * Does `checklist_template_items.equipment_id` exist yet? (migration 0181, GATE M3)
 *
 * The gate means a Vercel PREVIEW runs this branch against a database that does not
 * yet have the column, and BOTH shapes of reference fail there — measured against
 * live prod on 2026-08-21, before 0181:
 *
 *   .select("... equipment_id")  -> 42703 "column ... does not exist"  (loud)
 *   .is("equipment_id", null)    -> count NULL with an empty error      (SILENT)
 *
 * The second is the dangerous one. A null count coalesced with `?? 0` would make the
 * hub badge read ZERO and the queue render empty — a wrong number that looks like
 * good news. So the probe is not politeness, it is what stops a silent-zero.
 *
 * One head-only query, memoized per process. DDL does not land mid-request, and the
 * gate applies 0181 BEFORE the merge that redeploys, so a process can never outlive
 * the answer it cached. A non-missing-column failure (network, RLS) is deliberately
 * NOT cached — that would freeze a transient outage into a permanent "unavailable".
 *
 * When it answers false the whole feature degrades to EXACTLY today's behaviour:
 * the queue shows all 34 rows, the picker offers no equipment, and a link attempt is
 * refused with a named code. Nothing lies about why.
 */
let equipmentColumnCache: boolean | null = null;
export async function equipmentLinkAvailable(
  sb: ReturnType<typeof getServiceRoleClient>,
): Promise<boolean> {
  if (equipmentColumnCache !== null) return equipmentColumnCache;
  const { error } = await sb
    .from("checklist_template_items")
    .select("equipment_id", { head: true, count: "exact" })
    .limit(1);
  // Only a MISSING-COLUMN error means "not yet". Any other failure (network, RLS)
  // must not be memoized as a permanent absence.
  if (error) {
    const code = error.code ?? "";
    const missing =
      code === "PGRST204" ||
      code === "PGRST205" ||
      code === "42703" ||
      (error.message ?? "").toLowerCase().includes("equipment_id");
    if (!missing) return false;
    equipmentColumnCache = false;
    return false;
  }
  equipmentColumnCache = true;
  return true;
}
interface TemplateRow {
  id: string;
  name: string;
  type: string;
  location_id: string;
  active: boolean;
}

/**
 * Load the needs-link queue: active count-lines with null item_id AND null
 * vendor_item_id, on ACTIVE templates at locations the actor may access. Fixed
 * query count. Location-scoped (below level 9, only assigned locations).
 */
export async function loadNeedsLinkQueue(actor: AuthContext): Promise<NeedsLinkRow[]> {
  if (getRoleLevel(actor.user.role) < NEEDS_LINK_READ_MIN) throw new AdminNeedsLinkError(403, "forbidden");
  const sb = getServiceRoleClient();

  // Active templates + their location (needed for the location scope + names).
  const { data: tplRows, error: tErr } = await sb
    .from("checklist_templates")
    .select("id, name, type, location_id, active")
    .eq("active", true)
    .returns<TemplateRow[]>();
  if (tErr) throw new Error(`loadNeedsLinkQueue templates: ${tErr.message}`);
  const templates = tplRows ?? [];

  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  const visibleTemplates = templates.filter((t) => actorAll || actor.locations.includes(t.location_id));
  const templateById = new Map(visibleTemplates.map((t) => [t.id, t]));
  const templateIds = [...templateById.keys()];
  if (templateIds.length === 0) return [];

  // Location names for display.
  const locationIds = [...new Set(visibleTemplates.map((t) => t.location_id))];
  const locationNameById = new Map<string, string>();
  if (locationIds.length > 0) {
    const { data: locRows, error: lErr } = await sb
      .from("locations").select("id, name").in("id", locationIds)
      .returns<Array<{ id: string; name: string }>>();
    if (lErr) throw new Error(`loadNeedsLinkQueue locations: ${lErr.message}`);
    for (const l of locRows ?? []) locationNameById.set(l.id, l.name);
  }

  // Active count-lines with ALL THREE refs null, on the visible templates. The
  // equipment arm only exists once 0181 lands; before that the filter is exactly
  // what it has always been, and the queue shows what it shows today.
  const equipAware = await equipmentLinkAvailable(sb);
  let lineQuery = sb
    .from("checklist_template_items")
    .select("id, template_id, label, station, expects_count, item_id, vendor_item_id, active")
    .in("template_id", templateIds)
    .eq("active", true)
    .eq("expects_count", true)
    .is("item_id", null)
    .is("vendor_item_id", null);
  if (equipAware) lineQuery = lineQuery.is("equipment_id", null);
  const { data: lineRows, error: liErr } = await lineQuery
    .order("template_id", { ascending: true })
    .order("display_order", { ascending: true })
    .returns<LineRow[]>();
  if (liErr) throw new Error(`loadNeedsLinkQueue lines: ${liErr.message}`);

  const out: NeedsLinkRow[] = [];
  for (const r of lineRows ?? []) {
    const tpl = templateById.get(r.template_id);
    if (!tpl) continue; // template not visible / inactive
    out.push({
      lineId: r.id,
      templateId: tpl.id,
      templateName: tpl.name,
      templateType: tpl.type,
      label: r.label,
      section: r.station,
      locationId: tpl.location_id,
      locationName: locationNameById.get(tpl.location_id) ?? null,
    });
  }
  return out;
}

/**
 * The count of needs-link rows (for the hub badge). Batching win (council P3,
 * 2026-07-31): was `loadNeedsLinkQueue().length` — the FULL queue build (all
 * line rows + location names + object construction) on every admin-hub load.
 * Now a single head COUNT over the SAME filter (active count-lines with both
 * refs null on the visible templates), scoped by the visible-template ids.
 */
export async function countNeedsLink(actor: AuthContext): Promise<number> {
  if (getRoleLevel(actor.user.role) < NEEDS_LINK_READ_MIN) throw new AdminNeedsLinkError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data: tplRows, error: tErr } = await sb
    .from("checklist_templates").select("id, location_id").eq("active", true)
    .returns<Array<{ id: string; location_id: string }>>();
  if (tErr) throw new Error(`countNeedsLink templates: ${tErr.message}`);
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  const templateIds = (tplRows ?? []).filter((t) => actorAll || actor.locations.includes(t.location_id)).map((t) => t.id);
  if (templateIds.length === 0) return 0;
  // The filter here MUST stay byte-identical in semantics to loadNeedsLinkQueue's,
  // or the hub badge desyncs from the list it links to.
  const equipAware = await equipmentLinkAvailable(sb);
  let q = sb
    .from("checklist_template_items").select("id", { count: "exact", head: true })
    .in("template_id", templateIds).eq("active", true).eq("expects_count", true)
    .is("item_id", null).is("vendor_item_id", null);
  if (equipAware) q = q.is("equipment_id", null);
  const { count, error } = await q;
  if (error) throw new Error(`countNeedsLink: ${error.message}`);
  return count ?? 0;
}

/**
 * Load the pickable link targets: active global items + active SKUs + active
 * EQUIPMENT (0181), each with a taxonomy label for the picker's type badge. The
 * label field carries a taxonomy KEY the client renders via i18n
 * (admin.catalog.type.<key>).
 *
 * LOCATION SCOPE — the one asymmetry, and it is load-bearing. Items are read
 * `.is("location_id", null)` (the global registry) and SKUs are not
 * location-scoped, so both carry `locationId: null` and the flat list is honest.
 * `maintenance_equipment.location_id` is NOT NULL, so equipment targets carry
 * theirs and the PICKER filters them against the row's own location. Without that,
 * a Cap Hill temp line could be linked to a P Street fridge — invisible, permanent,
 * and especially dangerous here because the two shops' location codes are already
 * known to be crossed in prod.
 *
 * Equipment is omitted entirely until 0181 lands: offering a target the write
 * cannot store would be an affordance that lies.
 */
export async function loadLinkTargets(actor: AuthContext): Promise<LinkTarget[]> {
  if (getRoleLevel(actor.user.role) < NEEDS_LINK_READ_MIN) throw new AdminNeedsLinkError(403, "forbidden");
  const sb = getServiceRoleClient();
  const equipAware = await equipmentLinkAvailable(sb);
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });

  const [{ data: itemRows, error: iErr }, { data: skuRows, error: sErr }, equipRes] = await Promise.all([
    sb.from("items").select("id, name, item_type")
      .is("location_id", null).eq("active", true)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; item_type: ItemType }>>(),
    sb.from("vendor_items").select("id, name, sku_class")
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; sku_class: SkuClass | null }>>(),
    equipAware
      ? sb.from("maintenance_equipment").select("id, name, kind, location_id")
          .eq("active", true)
          .order("name", { ascending: true })
          .returns<Array<{ id: string; name: string; kind: string | null; location_id: string }>>()
      : Promise.resolve({
          data: [] as Array<{ id: string; name: string; kind: string | null; location_id: string }>,
          error: null,
        }),
  ]);
  if (iErr) throw new Error(`loadLinkTargets items: ${iErr.message}`);
  if (sErr) throw new Error(`loadLinkTargets skus: ${sErr.message}`);
  if (equipRes.error) throw new Error(`loadLinkTargets equipment: ${equipRes.error.message}`);

  const targets: LinkTarget[] = [];
  for (const it of itemRows ?? []) {
    const taxon: CatalogType = deriveCatalogType({ kind: "item", itemType: it.item_type });
    targets.push({ kind: "item", id: it.id, name: it.name, typeLabel: taxon, locationId: null });
  }
  for (const sk of skuRows ?? []) {
    targets.push({ kind: "sku", id: sk.id, name: sk.name, typeLabel: sk.sku_class ?? "raw", locationId: null });
  }
  for (const eq of equipRes.data ?? []) {
    // Defense in depth: never hand a caller equipment at a location they cannot
    // reach, even though the picker filters again by the row's own location.
    if (!actorAll && !actor.locations.includes(eq.location_id)) continue;
    targets.push({
      kind: "equipment",
      id: eq.id,
      name: eq.name,
      // maintenance_equipment.kind is CHECK ('fridge','equipment') — both have a
      // badge word; anything else falls to the generic one rather than rendering
      // a raw key.
      typeLabel: eq.kind === "fridge" ? "fridge" : "equipment",
      locationId: eq.location_id,
    });
  }
  return targets;
}

/**
 * Link an existing count-line to a master-list target — sets item_id OR
 * vendor_item_id on the EXISTING checklist_template_items row (in-place
 * additive; id + label preserved). Exactly one target ref. GM+ (route enforces
 * Tier A). The UPDATE is count-checked and audited.
 *
 * Guards: the line must be active, expects_count, and currently unlinked (both
 * refs null) — we only ADD a ref, never rewrite an existing link. The line's
 * template must be at a location the actor may access (IDOR).
 */
export async function linkTemplateItem(
  actor: AuthContext,
  args: {
    lineId: string;
    target: { kind: "item"; id: string } | { kind: "sku"; id: string } | { kind: "equipment"; id: string };
  },
): Promise<void> {
  if (getRoleLevel(actor.user.role) < NEEDS_LINK_WRITE_MIN) throw new AdminNeedsLinkError(403, "forbidden");
  const sb = getServiceRoleClient();
  const equipAware = await equipmentLinkAvailable(sb);
  if (args.target.kind === "equipment" && !equipAware) {
    // An honest refusal rather than a 500 on an unknown column: the capability
    // genuinely does not exist until the lead applies 0181 (GATE M3).
    throw new AdminNeedsLinkError(
      503,
      "equipment_link_unavailable",
      "Equipment links arrive with migration 0181",
    );
  }

  // Load the line + its template (for the active/expects_count/unlinked guards + IDOR).
  const { data: line, error: lErr } = await sb
    .from("checklist_template_items")
    .select(
      equipAware
        ? "id, template_id, expects_count, item_id, vendor_item_id, equipment_id, active"
        : "id, template_id, expects_count, item_id, vendor_item_id, active",
    )
    .eq("id", args.lineId)
    .maybeSingle<{ id: string; template_id: string; expects_count: boolean; item_id: string | null; vendor_item_id: string | null; equipment_id?: string | null; active: boolean }>();
  if (lErr) throw new Error(`linkTemplateItem line read: ${lErr.message}`);
  if (!line || !line.active) throw new AdminNeedsLinkError(404, "line_not_found", "Template item not found");
  if (!line.expects_count) throw new AdminNeedsLinkError(409, "not_countable", "Line is not a count line");
  if (line.item_id !== null || line.vendor_item_id !== null || (line.equipment_id ?? null) !== null) {
    throw new AdminNeedsLinkError(409, "already_linked", "Line is already linked");
  }

  const { data: tpl, error: tErr } = await sb
    .from("checklist_templates")
    .select("id, location_id, active")
    .eq("id", line.template_id)
    .maybeSingle<{ id: string; location_id: string; active: boolean }>();
  if (tErr) throw new Error(`linkTemplateItem template read: ${tErr.message}`);
  if (!tpl || !tpl.active) throw new AdminNeedsLinkError(404, "line_not_found", "Template item not found");
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  if (!actorAll && !actor.locations.includes(tpl.location_id)) {
    throw new AdminNeedsLinkError(404, "line_not_found", "Template item not found");
  }

  // Verify the target exists + is active.
  const update: Record<string, unknown> = {};
  if (args.target.kind === "item") {
    const { data: it, error: iErr } = await sb.from("items").select("id").eq("id", args.target.id).eq("active", true).maybeSingle<{ id: string }>();
    if (iErr) throw new Error(`linkTemplateItem item check: ${iErr.message}`);
    if (!it) throw new AdminNeedsLinkError(400, "invalid_target", "Item not found or inactive");
    update.item_id = args.target.id;
  } else if (args.target.kind === "sku") {
    const { data: sk, error: sErr } = await sb.from("vendor_items").select("id").eq("id", args.target.id).eq("active", true).maybeSingle<{ id: string }>();
    if (sErr) throw new Error(`linkTemplateItem sku check: ${sErr.message}`);
    if (!sk) throw new AdminNeedsLinkError(400, "invalid_target", "SKU not found or inactive");
    update.vendor_item_id = args.target.id;
  } else {
    // The asset must exist, be active, AND live at the LINE'S OWN location. The
    // last clause is the whole reason this check is here rather than trusted from
    // the picker: a payload can name any uuid, and a cross-shop fridge link would
    // be silent and permanent.
    const { data: eq, error: eErr } = await sb
      .from("maintenance_equipment").select("id, location_id")
      .eq("id", args.target.id).eq("active", true)
      .maybeSingle<{ id: string; location_id: string }>();
    if (eErr) throw new Error(`linkTemplateItem equipment check: ${eErr.message}`);
    if (!eq) throw new AdminNeedsLinkError(400, "invalid_target", "Equipment not found or inactive");
    if (eq.location_id !== tpl.location_id) {
      throw new AdminNeedsLinkError(
        400,
        "equipment_location_mismatch",
        "That equipment belongs to a different location",
      );
    }
    update.equipment_id = args.target.id;
  }

  let updateQuery = sb
    .from("checklist_template_items")
    .update(update, { count: "exact" })
    .eq("id", args.lineId)
    // Re-assert the unlinked precondition in the WHERE so a concurrent link can't
    // be silently overwritten (UPDATE-denials-are-silent lesson → count check).
    .is("item_id", null)
    .is("vendor_item_id", null);
  // The third arm joins the precondition only once the column exists, so the
  // pre-0181 write is byte-identical to today's.
  if (equipAware) updateQuery = updateQuery.is("equipment_id", null);
  const { error, count } = await updateQuery;
  if (error) throw new Error(`linkTemplateItem update: ${error.message}`);
  if (count === 0) throw new AdminNeedsLinkError(409, "already_linked", "Line is already linked");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.lineId,
    metadata: {
      template_id: line.template_id,
      field: "needs_link",
      after:
        args.target.kind === "item"
          ? { item_id: args.target.id }
          : args.target.kind === "sku"
            ? { vendor_item_id: args.target.id }
            : { equipment_id: args.target.id },
    },
    ipAddress: null,
    userAgent: null,
  });
}

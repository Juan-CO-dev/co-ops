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
 * Dedup into distinct items, per location, processed AM-prep -> mid-day -> opening
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
  itemId: string | null;
  name: string;
  section: string | null;
  locationId: string;
  contributingLines: { lineId: string; reason: MergeReason }[];
  mergeReason: MergeReason;
  firstPar: number | null;
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

    const { data: tmpls, error: tErr } = await sb
      .from("checklist_templates")
      .select("id, type, prep_subtype, location_id")
      .eq("location_id", locationId)
      .eq("active", true)
      .in("type", ["prep", "opening"]);
    if (tErr) throw new Error(`load templates ${locationId}: ${tErr.message}`);
    const tmplById = new Map(((tmpls ?? []) as Tmpl[]).map((t) => [t.id, t]));
    if (tmplById.size === 0) continue;

    const { data: rawLines, error: lErr } = await sb
      .from("checklist_template_items")
      .select("id, template_id, label, translations, station, prep_meta, references_template_item_id, item_id")
      .in("template_id", [...tmplById.keys()])
      .eq("active", true);
    if (lErr) throw new Error(`load lines ${locationId}: ${lErr.message}`);

    const lines = ((rawLines ?? []) as Line[]).filter((ln) => {
      const t = tmplById.get(ln.template_id)!;
      if (t.type === "prep") return true;
      if (t.type === "opening") return ln.prep_meta?.["openingPhase2"] === true;
      return false;
    });

    const rank = (ln: Line): number => {
      const t = tmplById.get(ln.template_id)!;
      if (t.type === "prep" && t.prep_subtype === "am_prep") return 0;
      if (t.type === "prep") return 1;
      return 2;
    };
    lines.sort((a, b) => rank(a) - rank(b));

    const itemIdByKey = new Map<string, string>();
    const itemIdBySourceLineId = new Map<string, string>();
    const manifestByItemId = new Map<string, ManifestEntry>();

    for (const ln of lines) {
      if (ln.item_id) {
        itemIdByKey.set(norm(ln.label, ln.station), ln.item_id);
        itemIdBySourceLineId.set(ln.id, ln.item_id);
      }
    }

    for (const ln of lines) {
      const name = ln.label.trim();
      const section = ln.station;
      const key = norm(name, section);
      const linePar = metaNum(ln.prep_meta, "parValue");

      let itemId: string | null = ln.item_id ?? null;
      let reason: MergeReason = ln.item_id ? "preexisting" : "standalone";

      if (!itemId && ln.references_template_item_id) {
        const refId = itemIdBySourceLineId.get(ln.references_template_item_id);
        if (refId) { itemId = refId; reason = "am_prep_opening_fk"; }
      }
      if (!itemId && itemIdByKey.has(key)) { itemId = itemIdByKey.get(key)!; reason = "name_section_match"; }

      if (!itemId && !DRY_RUN) {
        const { data: existing, error: exErr } = await sb
          .from("items")
          .select("id")
          .eq("location_id", locationId)
          .eq("section", section)
          .ilike("name", name)
          .limit(1)
          .maybeSingle<{ id: string }>();
        if (exErr) throw new Error(`lookup existing item: ${exErr.message}`);
        if (existing) { itemId = existing.id; reason = "preexisting"; }
      }

      if (!itemId) {
        if (DRY_RUN) {
          itemId = `DRYRUN:${locationId}:${key}`;
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
            .single<{ id: string }>();
          if (insErr) throw new Error(`insert item (${name}): ${insErr.message}`);
          if (!ins) throw new Error(`insert item (${name}): no row returned`);
          itemId = ins.id;
          created++;
        }
        itemIdByKey.set(key, itemId);
      }
      // Both branches above (preexisting / fk / name-match / DRYRUN / insert)
      // guarantee a non-null itemId here; narrow for the type-checker.
      const resolvedItemId: string = itemId!;
      itemIdBySourceLineId.set(ln.id, resolvedItemId);

      if (!DRY_RUN && ln.item_id !== resolvedItemId) {
        const { error: upErr } = await sb
          .from("checklist_template_items")
          .update({ item_id: resolvedItemId })
          .eq("id", ln.id);
        if (upErr) throw new Error(`link line ${ln.id}: ${upErr.message}`);
        linked++;
      }

      let entry = manifestByItemId.get(resolvedItemId);
      if (!entry) {
        entry = {
          itemId: resolvedItemId.startsWith("DRYRUN:") ? null : resolvedItemId,
          name,
          section,
          locationId,
          contributingLines: [],
          mergeReason: reason,
          firstPar: linePar,
        };
        manifestByItemId.set(resolvedItemId, entry);
        manifest.push(entry);
      } else if (linePar !== null && linePar !== entry.firstPar) {
        (entry.parDivergence ??= []).push({ firstPar: entry.firstPar, linePar, lineId: ln.id });
      }
      entry.contributingLines.push({ lineId: ln.id, reason });
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

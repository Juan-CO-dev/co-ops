/**
 * Par Layer backfill (Item/Inventory Spine 2B). IDEMPOTENT + re-runnable.
 *
 *   Dry-run (writes NOTHING, computes + writes the manifest only):
 *     npx tsx --env-file=.env.local scripts/backfill-par-layer.ts --dry-run
 *   Real run:
 *     npx tsx --env-file=.env.local scripts/backfill-par-layer.ts
 *
 * Dedups the location-owned `items` into GLOBAL items (location_id = NULL) +
 * per-location `item_par_levels` OVERRIDE rows, so the 2B resolver returns
 * today's EXACT numbers (a no-op render the controller proves with the parity
 * check). Two cases per normalized cross-location key (lower(trim(name)),
 * coalesce(section,'')):
 *
 *   - Key present at BOTH locations (two distinct location items, one each):
 *     create/reuse ONE global item (representative = the AM-prep contributor's
 *     value when the two diverge); for EACH location ensure ONE all-days
 *     `item_par_levels` row (par_mode='manual', par_value = THAT location's
 *     item.default_par); re-point every contributing line to the global item;
 *     DEACTIVATE the two now-orphaned old location items (append-only).
 *   - Key present at ONE location only: KEEP the location item; ensure ONE
 *     all-days override row (manual, par_value = its default_par); lines stay.
 *
 * Idempotent: existing global items found by (lower(name), section, location_id
 * IS NULL); existing override rows found by their (item_id, location_id,
 * day_of_week IS NULL, active) slot; lines already pointing at the resolved item
 * are not re-pointed; already-deactivated items are not re-deactivated. A second
 * run produces ZERO new writes.
 *
 * Manifest is written to a timestamped file under the OS temp dir (or
 * BACKFILL_MANIFEST_DIR if set); its path is recorded in the summary audit row.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";

const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";
const DRY_RUN = process.argv.includes("--dry-run");

type Tmpl = { id: string; type: string; prep_subtype: string | null; location_id: string };
type LineRow = {
  id: string;
  template_id: string;
  item_id: string | null;
};
type ItemRow = {
  id: string;
  location_id: string | null;
  name: string;
  name_es: string | null;
  section: string | null;
  default_par: number | null;
  default_par_unit: string | null;
};

/** A distinct current item + the lines that contribute to it + its prep-rank. */
type ItemAgg = {
  item: ItemRow;
  lineIds: string[];
  /** lowest contributing-line rank: 0 = am_prep, 1 = other prep, 2 = opening P2 */
  bestRank: number;
};

type MergeReason = "cross_location_global" | "single_location_local";

interface ManifestLocationEntry {
  locationId: string;
  parValue: number | null;
  contributingLineIds: string[];
}
interface ManifestEntry {
  itemId: string | null;
  scope: "global" | "local";
  name: string;
  section: string | null;
  locations: ManifestLocationEntry[];
  mergeReason: MergeReason;
  parDivergence?: { locationId: string; parValue: number | null; representative: boolean }[];
  deactivatedOldItemIds?: string[];
}

function normKey(name: string, section: string | null): string {
  return `${name.trim().toLowerCase()}|${(section ?? "").trim().toLowerCase()}`;
}

async function main() {
  const sb = getServiceRoleClient();

  // --- 1. Load every active prep/openingP2 line with item_id, joined to its template. ---
  const { data: tmpls, error: tErr } = await sb
    .from("checklist_templates")
    .select("id, type, prep_subtype, location_id")
    .eq("active", true)
    .in("type", ["prep", "opening"]);
  if (tErr) throw new Error(`load templates: ${tErr.message}`);
  const tmplById = new Map(((tmpls ?? []) as Tmpl[]).map((t) => [t.id, t]));

  const { data: rawLines, error: lErr } = await sb
    .from("checklist_template_items")
    .select("id, template_id, item_id, prep_meta")
    .in("template_id", [...tmplById.keys()])
    .eq("active", true);
  if (lErr) throw new Error(`load lines: ${lErr.message}`);

  type RawLine = LineRow & { prep_meta: Record<string, unknown> | null };
  const lines = ((rawLines ?? []) as RawLine[]).filter((ln) => {
    if (!ln.item_id) return false;
    const t = tmplById.get(ln.template_id);
    if (!t) return false;
    if (t.type === "prep") return true;
    if (t.type === "opening") return ln.prep_meta?.["openingPhase2"] === true;
    return false;
  });

  // line prep-rank for representative selection (prefer AM-prep value on divergence)
  const lineRank = (ln: RawLine): number => {
    const t = tmplById.get(ln.template_id)!;
    if (t.type === "prep" && t.prep_subtype === "am_prep") return 0;
    if (t.type === "prep") return 1;
    return 2;
  };

  // --- 2. Collect DISTINCT current items these lines reference. ---
  const itemIds = [...new Set(lines.map((l) => l.item_id!).filter(Boolean))];
  const { data: itemRows, error: iErr } = await sb
    .from("items")
    .select("id, location_id, name, name_es, section, default_par, default_par_unit")
    .in("id", itemIds)
    .eq("active", true);
  if (iErr) throw new Error(`load items: ${iErr.message}`);
  const itemById = new Map(((itemRows ?? []) as ItemRow[]).map((r) => [r.id, r]));

  const aggById = new Map<string, ItemAgg>();
  for (const ln of lines) {
    const item = itemById.get(ln.item_id!);
    if (!item) continue; // line points at an inactive/absent item; skip defensively
    let agg = aggById.get(item.id);
    if (!agg) {
      agg = { item, lineIds: [], bestRank: 99 };
      aggById.set(item.id, agg);
    }
    agg.lineIds.push(ln.id);
    agg.bestRank = Math.min(agg.bestRank, lineRank(ln));
  }

  // --- 3. Group distinct items by normalized cross-location key. ---
  const groups = new Map<string, ItemAgg[]>();
  for (const agg of aggById.values()) {
    const key = normKey(agg.item.name, agg.item.section);
    const arr = groups.get(key) ?? [];
    arr.push(agg);
    groups.set(key, arr);
  }

  const manifest: ManifestEntry[] = [];
  let globalItemsCreated = 0;
  let overrideRowsCreated = 0;
  let linesRepointed = 0;
  let oldItemsDeactivated = 0;

  // Helper: ensure ONE all-days manual override row for (itemId, locationId).
  async function ensureOverride(
    itemId: string,
    locationId: string,
    parValue: number | null,
    parUnit: string | null,
  ): Promise<void> {
    if (DRY_RUN || itemId.startsWith("DRYRUN:")) return;
    const { data: existing, error: exErr } = await sb
      .from("item_par_levels")
      .select("id")
      .eq("item_id", itemId)
      .eq("location_id", locationId)
      .is("day_of_week", null)
      .eq("active", true)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (exErr) throw new Error(`lookup override (${itemId}/${locationId}): ${exErr.message}`);
    if (existing) return; // slot already filled — idempotent skip
    const { error: insErr } = await sb.from("item_par_levels").insert({
      item_id: itemId,
      location_id: locationId,
      day_of_week: null,
      par_value: parValue,
      par_unit: parUnit,
      par_mode: "manual",
      active: true,
      created_by: JUAN_USER_ID,
      updated_by: JUAN_USER_ID,
    });
    if (insErr) throw new Error(`insert override (${itemId}/${locationId}): ${insErr.message}`);
    overrideRowsCreated++;
  }

  // Helper: re-point a set of lines to targetItemId (skip lines already there).
  async function repointLines(lineIds: string[], targetItemId: string): Promise<void> {
    if (DRY_RUN || targetItemId.startsWith("DRYRUN:")) return;
    for (const lineId of lineIds) {
      const ln = lines.find((l) => l.id === lineId);
      if (ln && ln.item_id === targetItemId) continue; // already pointed — no-op
      const { error: upErr } = await sb
        .from("checklist_template_items")
        .update({ item_id: targetItemId })
        .eq("id", lineId);
      if (upErr) throw new Error(`repoint line ${lineId}: ${upErr.message}`);
      linesRepointed++;
    }
  }

  for (const [, aggs] of groups) {
    const distinctLocs = new Set(aggs.map((a) => a.item.location_id));

    if (aggs.length >= 2 && distinctLocs.size >= 2) {
      // === BOTH-LOCATION key → ONE global item + per-location overrides ===
      // Split location-owned aggs from any already-global agg. On a clean first
      // run there are no global aggs; on a PARTIAL-FAILURE re-run the group may
      // contain the already-created global item alongside a not-yet-migrated
      // location item — reuse the global, only the location aggs get overrides.
      const localAggs = aggs.filter((a) => a.item.location_id !== null);
      const globalAggs = aggs.filter((a) => a.item.location_id === null);
      // Representative (for naming) = lowest prep-rank among location aggs, else
      // the already-global agg. AM-prep wins on divergence.
      const repPool = localAggs.length > 0 ? localAggs : aggs;
      const rep = [...repPool].sort((a, b) => a.bestRank - b.bestRank)[0]!;
      const repName = rep.item.name.trim();
      const repSection = rep.item.section;

      // Idempotent: reuse an already-global agg, else find an existing global item
      // by (lower(name), section, NULL loc).
      let globalId: string | null = globalAggs[0]?.item.id ?? null;
      if (!globalId && !DRY_RUN) {
        let q = sb
          .from("items")
          .select("id")
          .is("location_id", null)
          .ilike("name", repName);
        q = repSection === null ? q.is("section", null) : q.eq("section", repSection);
        const { data: existingGlobal, error: gErr } = await q
          .limit(1)
          .maybeSingle<{ id: string }>();
        if (gErr) throw new Error(`lookup global item (${repName}): ${gErr.message}`);
        if (existingGlobal) globalId = existingGlobal.id;
      }

      if (!globalId) {
        if (DRY_RUN) {
          globalId = `DRYRUN:global:${normKey(repName, repSection)}`;
        } else {
          const { data: ins, error: insErr } = await sb
            .from("items")
            .insert({
              location_id: null,
              kind: "manual",
              name: repName,
              name_es: rep.item.name_es,
              section: repSection,
              default_par: rep.item.default_par,
              default_par_unit: rep.item.default_par_unit,
              active: true,
              created_by: JUAN_USER_ID,
              updated_by: JUAN_USER_ID,
            })
            .select("id")
            .single<{ id: string }>();
          if (insErr) throw new Error(`insert global item (${repName}): ${insErr.message}`);
          if (!ins) throw new Error(`insert global item (${repName}): no row returned`);
          globalId = ins.id;
          globalItemsCreated++;
        }
      }

      const manifestLocs: ManifestLocationEntry[] = [];
      const divergence: { locationId: string; parValue: number | null; representative: boolean }[] = [];
      const deactivatedOldItemIds: string[] = [];
      let anyDivergence = false;

      for (const agg of localAggs) {
        const locId = agg.item.location_id!; // location aggs are location-owned
        await ensureOverride(globalId, locId, agg.item.default_par, agg.item.default_par_unit);
        await repointLines(agg.lineIds, globalId);

        // Deactivate the now-orphaned old location item (append-only).
        if (!DRY_RUN && agg.item.id !== globalId) {
          const { error: deErr } = await sb
            .from("items")
            .update({ active: false, updated_by: JUAN_USER_ID })
            .eq("id", agg.item.id)
            .eq("active", true); // idempotent: only flips a still-active row
          if (deErr) throw new Error(`deactivate old item ${agg.item.id}: ${deErr.message}`);
          oldItemsDeactivated++;
        }
        deactivatedOldItemIds.push(agg.item.id);

        manifestLocs.push({ locationId: locId, parValue: agg.item.default_par, contributingLineIds: agg.lineIds });
        const isRep = agg.item.id === rep.item.id;
        divergence.push({ locationId: locId, parValue: agg.item.default_par, representative: isRep });
        if (agg.item.default_par !== rep.item.default_par) anyDivergence = true;
      }

      const entry: ManifestEntry = {
        itemId: globalId.startsWith("DRYRUN:") ? null : globalId,
        scope: "global",
        name: repName,
        section: repSection,
        locations: manifestLocs,
        mergeReason: "cross_location_global",
        deactivatedOldItemIds,
      };
      if (anyDivergence) entry.parDivergence = divergence;
      manifest.push(entry);
    } else {
      // === SINGLE-LOCATION key(s) → KEEP each location item as-is + override ===
      for (const agg of aggs) {
        const locId = agg.item.location_id;
        if (locId === null) {
          // Already a global item (e.g. a re-run after a prior backfill). Ensure
          // overrides exist for every contributing location via the lines' templates.
          // Handled by the both-location branch on first run; here we just record it.
          await repointLines(agg.lineIds, agg.item.id);
          manifest.push({
            itemId: agg.item.id,
            scope: "global",
            name: agg.item.name.trim(),
            section: agg.item.section,
            locations: [],
            mergeReason: "cross_location_global",
          });
          continue;
        }
        await ensureOverride(agg.item.id, locId, agg.item.default_par, agg.item.default_par_unit);
        await repointLines(agg.lineIds, agg.item.id); // no-op (lines already point here)
        manifest.push({
          itemId: agg.item.id,
          scope: "local",
          name: agg.item.name.trim(),
          section: agg.item.section,
          locations: [{ locationId: locId, parValue: agg.item.default_par, contributingLineIds: agg.lineIds }],
          mergeReason: "single_location_local",
        });
      }
    }
  }

  // --- Write the manifest to a timestamped file; record its path. ---
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = process.env["BACKFILL_MANIFEST_DIR"] ?? tmpdir();
  const manifestPath = join(dir, `par-layer-backfill-${DRY_RUN ? "dryrun-" : ""}${stamp}.json`);
  const summary = {
    dryRun: DRY_RUN,
    globalItemsCreated,
    overrideRowsCreated,
    linesRepointed,
    oldItemsDeactivated,
    itemCount: manifest.length,
    manifest,
  };
  writeFileSync(manifestPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, manifestPath }, null, 2));

  // --- One summary audit row (NOT per item). ---
  if (!DRY_RUN) {
    const { error: auditErr } = await sb.from("audit_log").insert({
      actor_id: JUAN_USER_ID,
      actor_role: "cgs",
      action: "item.backfill",
      resource_table: "items",
      resource_id: null,
      metadata: {
        kind: "par_layer_backfill",
        global_items_created: globalItemsCreated,
        override_rows_created: overrideRowsCreated,
        lines_repointed: linesRepointed,
        old_items_deactivated: oldItemsDeactivated,
        item_count: manifest.length,
        manifest_path: manifestPath,
        ip_address: null,
        user_agent: null,
      },
      destructive: true,
    });
    if (auditErr) throw new Error(`audit insert: ${auditErr.message}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

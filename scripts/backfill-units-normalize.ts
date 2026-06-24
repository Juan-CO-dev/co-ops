/**
 * Units normalize backfill (Item/Inventory Spine units slice). IDEMPOTENT.
 *
 *   Dry-run:  npx tsx --env-file=.env.local scripts/backfill-units-normalize.ts --dry-run
 *   Real run: npx tsx --env-file=.env.local scripts/backfill-units-normalize.ts
 *
 * Maps the existing free-text par-unit values (across items.default_par_unit,
 * item_par_levels.par_unit, checklist_template_items.prep_meta.parUnit) to the
 * canonical labels seeded in migration 0084's `units` table. Re-runnable: a value
 * already canonical maps to itself (no write). Unmapped values are logged + left
 * untouched (none expected). Going forward the unit dropdown prevents new drift.
 */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";

/** Canonical map keyed by lower(trim(value)). */
const CANON: Record<string, string> = {
  "1/3 pan": "1/3 Pan",
  "1/3rd pan": "1/3 Pan",
  "3rd pan": "1/3 Pan",
  qt: "Quart",
  btl: "Bottle",
  piece: "Piece",
  bag: "Bag",
  logs: "Logs",
  min: "Min",
};

function canon(raw: string): string | null {
  return CANON[raw.trim().toLowerCase()] ?? null;
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const sb = getServiceRoleClient();
  const summary: Record<string, { changed: number; unmapped: Set<string> }> = {
    "items.default_par_unit": { changed: 0, unmapped: new Set() },
    "item_par_levels.par_unit": { changed: 0, unmapped: new Set() },
    "checklist_template_items.prep_meta.parUnit": { changed: 0, unmapped: new Set() },
  };

  // 1. items.default_par_unit
  {
    const { data, error } = await sb
      .from("items")
      .select("id, default_par_unit")
      .not("default_par_unit", "is", null)
      .returns<Array<{ id: string; default_par_unit: string }>>();
    if (error) throw new Error(`items read: ${error.message}`);
    for (const r of data ?? []) {
      const c = canon(r.default_par_unit);
      if (c === null) { summary["items.default_par_unit"]!.unmapped.add(r.default_par_unit); continue; }
      if (c === r.default_par_unit) continue;
      if (!DRY_RUN) {
        const { error: uErr } = await sb.from("items").update({ default_par_unit: c }).eq("id", r.id);
        if (uErr) throw new Error(`items update ${r.id}: ${uErr.message}`);
      }
      summary["items.default_par_unit"]!.changed++;
    }
  }

  // 2. item_par_levels.par_unit
  {
    const { data, error } = await sb
      .from("item_par_levels")
      .select("id, par_unit")
      .not("par_unit", "is", null)
      .returns<Array<{ id: string; par_unit: string }>>();
    if (error) throw new Error(`item_par_levels read: ${error.message}`);
    for (const r of data ?? []) {
      const c = canon(r.par_unit);
      if (c === null) { summary["item_par_levels.par_unit"]!.unmapped.add(r.par_unit); continue; }
      if (c === r.par_unit) continue;
      if (!DRY_RUN) {
        const { error: uErr } = await sb.from("item_par_levels").update({ par_unit: c }).eq("id", r.id);
        if (uErr) throw new Error(`item_par_levels update ${r.id}: ${uErr.message}`);
      }
      summary["item_par_levels.par_unit"]!.changed++;
    }
  }

  // 3. checklist_template_items.prep_meta.parUnit (jsonb)
  {
    const { data, error } = await sb
      .from("checklist_template_items")
      .select("id, prep_meta")
      .returns<Array<{ id: string; prep_meta: Record<string, unknown> | null }>>();
    if (error) throw new Error(`cti read: ${error.message}`);
    for (const r of data ?? []) {
      const pu = r.prep_meta?.["parUnit"];
      if (typeof pu !== "string" || !pu) continue;
      const c = canon(pu);
      if (c === null) { summary["checklist_template_items.prep_meta.parUnit"]!.unmapped.add(pu); continue; }
      if (c === pu) continue;
      if (!DRY_RUN) {
        const nextMeta = { ...(r.prep_meta ?? {}), parUnit: c };
        const { error: uErr } = await sb.from("checklist_template_items").update({ prep_meta: nextMeta }).eq("id", r.id);
        if (uErr) throw new Error(`cti update ${r.id}: ${uErr.message}`);
      }
      summary["checklist_template_items.prep_meta.parUnit"]!.changed++;
    }
  }

  const out = Object.fromEntries(
    Object.entries(summary).map(([k, v]) => [k, { changed: v.changed, unmapped: [...v.unmapped] }]),
  );
  console.log(JSON.stringify({ dryRun: DRY_RUN, summary: out }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

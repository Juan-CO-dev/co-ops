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
  const tmplType = new Map(((tmpls ?? []) as Array<{ id: string; type: string }>).map((t) => [t.id, t.type]));

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
  const itemById = new Map(((items ?? []) as Array<{ id: string; name: string; default_par: number | null }>).map((i) => [i.id, i]));

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

/**
 * Seed "The Classics" platter pool (0155 — platter depletion spec 2026-07-25).
 * Juan's verbatim Classics list: Crunchy Boi (+ "It's a BOI" protein-swap
 * variant), The Teamster, Hot Pants, Never Been Cheddar, Farmers Market
 * (± Fresh Mozz = ONE menu_item, the mozz rides the modifier lane), and
 * Marisa Tomei Eats Free.
 *
 * For every ACTIVE "N pc platter" package's choice slot:
 *   - a Classics sub missing from the pool is ADDED as an active option
 *     (classic=true) — Juan then curates enable/disable in the packages editor;
 *   - an existing option matching a Classics sub gets classic=true.
 * Idempotent: never duplicates an option, never unflags anything.
 * Run AFTER migration 0155 (Juan's go):
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/seed/12-platter-classics.ts
 */
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i)] ??= line.slice(i + 1).trim();
}

const CLASSICS = [
  "Crunchy Boi",
  "It's a BOI",
  "The Teamster",
  "Hot Pants",
  "Never Been Cheddar",
  "Farmers Market After Dark",
  "Marisa Tomei Eats Free",
];

async function main(): Promise<void> {
  const { getServiceRoleClient } = await import("../../lib/supabase-server");
  const sb = getServiceRoleClient();

  const { data: menuItems, error: mErr } = await sb.from("menu_items")
    .select("id, name").eq("active", true).in("name", CLASSICS)
    .returns<Array<{ id: string; name: string }>>();
  if (mErr) throw new Error(mErr.message);
  const idByName = new Map((menuItems ?? []).map((m) => [m.name, m.id]));
  for (const name of CLASSICS) {
    if (!idByName.has(name)) console.warn(`  MISSING menu_item "${name}" — skipped (check the name)`);
  }

  const { data: pkgs, error: pErr } = await sb.from("catering_packages")
    .select("id, label_en, location_id").eq("active", true).ilike("label_en", "%pc platter%")
    .returns<Array<{ id: string; label_en: string; location_id: string | null }>>();
  if (pErr) throw new Error(pErr.message);

  const { data: lines, error: lErr } = await sb.from("catering_package_items")
    .select("id, package_id, slot_type").in("package_id", (pkgs ?? []).map((p) => p.id))
    .eq("active", true).eq("slot_type", "choice")
    .returns<Array<{ id: string; package_id: string; slot_type: string }>>();
  if (lErr) throw new Error(lErr.message);

  let added = 0, flagged = 0, already = 0;
  for (const line of lines ?? []) {
    const pkg = (pkgs ?? []).find((p) => p.id === line.package_id)!;
    const { data: opts, error: oErr } = await sb.from("catering_package_slot_options")
      .select("id, menu_item_id, classic, display_order").eq("package_item_id", line.id).eq("active", true)
      .returns<Array<{ id: string; menu_item_id: string | null; classic: boolean; display_order: number }>>();
    if (oErr) throw new Error(oErr.message);
    const byMenuItem = new Map((opts ?? []).filter((o) => o.menu_item_id != null).map((o) => [o.menu_item_id!, o]));
    let nextOrder = Math.max(-1, ...(opts ?? []).map((o) => o.display_order)) + 1;

    for (const name of CLASSICS) {
      const menuItemId = idByName.get(name);
      if (!menuItemId) continue;
      const existing = byMenuItem.get(menuItemId);
      if (!existing) {
        const { error } = await sb.from("catering_package_slot_options").insert({
          package_item_id: line.id, menu_item_id: menuItemId, item_id: null,
          display_order: nextOrder, active: true, classic: true, created_by: null,
        });
        if (error) throw new Error(`add "${name}" to ${pkg.label_en}: ${error.message}`);
        nextOrder += 1;
        added += 1;
        console.log(`  + "${name}" → ${pkg.label_en} (classic)`);
      } else if (!existing.classic) {
        const { error } = await sb.from("catering_package_slot_options")
          .update({ classic: true }).eq("id", existing.id).eq("active", true);
        if (error) throw new Error(`flag "${name}" on ${pkg.label_en}: ${error.message}`);
        flagged += 1;
        console.log(`  ★ "${name}" → ${pkg.label_en}`);
      } else {
        already += 1;
      }
    }
  }
  console.log(`platter slots: ${(lines ?? []).length} · options added ${added} · flagged classic ${flagged} · already classic ${already}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}

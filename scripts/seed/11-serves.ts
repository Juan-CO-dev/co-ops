/**
 * Seed `serves` (0154 — people covered per unit) for catering coverage math.
 * Idempotent: only fills rows where serves IS NULL (admin edits are never
 * overwritten). Run AFTER migration 0154 (Juan's go).
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/seed/11-serves.ts
 *
 * Rules (Juan-tunable afterward in /admin/catering/menu):
 *   - menu_items: "(24 bags)"/"(24)"-style counts parse from the name → serves=N;
 *     otherwise subs/BYO serve 1 per whole; other resale defaults 1 (explicit).
 *   - catering_packages: "N pc" platters serve N (halves doctrine — one piece ≈
 *     one serving); per_head-priced packages serve 1 per unit.
 *   - items: left NULL (sized items already carry item_sizes.serves; unsized
 *     item cards default to 1 in the coverage math).
 */
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i)] ??= line.slice(i + 1).trim();
}

async function main(): Promise<void> {
  const { getServiceRoleClient } = await import("../../lib/supabase-server");
  const sb = getServiceRoleClient();

  const { data: menuItems, error: mErr } = await sb.from("menu_items")
    .select("id, name, section, serves").eq("active", true).is("serves", null)
    .returns<Array<{ id: string; name: string; section: string | null; serves: number | null }>>();
  if (mErr) throw new Error(mErr.message);

  let updated = 0;
  for (const mi of menuItems ?? []) {
    const m = mi.name.match(/\((\d{1,3})\b/);
    const parsed = m ? Number(m[1]) : null;
    const serves = parsed != null && parsed > 0 ? parsed : 1;
    const { error } = await sb.from("menu_items").update({ serves }).eq("id", mi.id).is("serves", null);
    if (error) throw new Error(`menu_item ${mi.name}: ${error.message}`);
    updated += 1;
    if (serves > 1) console.log(`  menu_item "${mi.name}" → serves ${serves}`);
  }
  console.log(`menu_items: ${updated} filled`);

  const { data: pkgs, error: pErr } = await sb.from("catering_packages")
    .select("id, label_en, pricing_mode, serves").eq("active", true).is("serves", null)
    .returns<Array<{ id: string; label_en: string; pricing_mode: string; serves: number | null }>>();
  if (pErr) throw new Error(pErr.message);

  let pUpdated = 0;
  for (const pkg of pkgs ?? []) {
    const pc = pkg.label_en.match(/(\d{1,3})\s*(?:pc|piece)/i);
    const serves = pkg.pricing_mode === "per_head" ? 1 : pc ? Number(pc[1]) : 1;
    const { error } = await sb.from("catering_packages").update({ serves }).eq("id", pkg.id).is("serves", null);
    if (error) throw new Error(`package ${pkg.label_en}: ${error.message}`);
    pUpdated += 1;
    console.log(`  package "${pkg.label_en}" (${pkg.pricing_mode}) → serves ${serves}`);
  }
  console.log(`packages: ${pUpdated} filled`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}

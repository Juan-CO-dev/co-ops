/**
 * check-storefront-images — storefront photo coverage report.
 *
 * The /order storefront resolves a per-sub photo through subImage(name), which
 * degrades to the generic spread photo on a miss. That degradation is DELIBERATE
 * (public marketing page — a missing photo must never hard-fail it), but it is
 * also silent: a sub renamed in the admin console quietly loses its photo and
 * nobody notices, because a plausible-looking generic image takes its place.
 *
 * This script is the loud counterpart: it lists the live catering subs whose
 * names miss the map, so a real gap gets fixed on purpose rather than found by
 * a customer. Lookup is normalized (trim + lowercase) exactly as at runtime, so
 * a report here means a genuine authoring gap, not a casing artifact.
 *
 * MANUAL run only — deliberately NOT in CI. Photo coverage is content, not code:
 * the seed changes without the repo changing, so a red build would be noise.
 *
 * Exit 0 always (it's a check — prints findings). Run:
 *   npx tsx --env-file=.env.local scripts/check-storefront-images.ts
 */

import { pathToFileURL } from "node:url";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { hasSubImage } from "@/components/portal/storefront-images";

async function main() {
  const sb = getServiceRoleClient();

  // Subs live in menu_items (items are the extras). Same two filters the public
  // storefront query uses (lib/portal/menu.ts loadPublicCateringMenu).
  const { data, error } = await sb
    .from("menu_items")
    .select("id, name")
    .eq("active", true)
    .eq("catering_available", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`menu_items query failed: ${error.message}`);
  const subs = data ?? [];

  const missing = subs.filter((s) => !hasSubImage(s.name));

  for (const s of missing) {
    console.error(`  [NO PHOTO] ${JSON.stringify(s.name)}  (menu_items.id=${s.id})`);
  }

  console.log(
    `storefront photo coverage: ${subs.length - missing.length}/${subs.length} live catering sub(s) have a mapped photo.`,
  );
  if (missing.length === 0) {
    console.log("✓ Every live catering sub resolves to a real photo.");
  } else {
    console.log(
      `${missing.length} sub(s) fall back to the generic spread photo. Add them to SUB_IMAGE_MAP in components/portal/storefront-images.ts.`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

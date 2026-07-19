/**
 * Seed the "Napkins & Utensils" catering add-on — an `items` row in the ADDON_SECTION ("Add-ons"),
 * catering-available so W1a derivation prices it, catering_only so it never shows on the regular menu.
 * The review stage toggles it into the order (lib/portal/draft.ts submitDraft) and the build page
 * excludes the ADDON_SECTION from the shopping list.
 *
 * Idempotent: find-or-create by (name, section). Prints the id.
 *
 *   npx tsx --env-file=.env.local scripts/seed-napkins-item.ts
 *
 * ⚠ DEV / smoke only. Do NOT run against prod as part of 3a — prod stays DORMANT until Juan's
 * integrated wiring pass authors the catering menu/pricing. (The 3a smoke seeds its OWN napkins.)
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { ADDON_SECTION } from "@/lib/portal/draft";

const NAPKINS_NAME = "Napkins & Utensils";
const NAPKINS_PRICE_DOLLARS = 25.0; // a flat party-pack upcharge; derivation defaults to 100% (no rate rule)

async function main() {
  const sb = getServiceRoleClient();

  const { data: existing, error: findErr } = await sb
    .from("items")
    .select("id, active")
    .eq("name", NAPKINS_NAME)
    .eq("section", ADDON_SECTION)
    .maybeSingle<{ id: string; active: boolean }>();
  if (findErr) throw new Error(`find napkins: ${findErr.message}`);

  if (existing) {
    console.log(`napkins add-on already present: ${existing.id} (active=${existing.active})`);
    process.exit(0);
  }

  const { data: inserted, error: insErr } = await sb
    .from("items")
    .insert({
      name: NAPKINS_NAME,
      section: ADDON_SECTION,
      menu_price: NAPKINS_PRICE_DOLLARS,
      catering_available: true,
      catering_only: true,
      active: true,
      tracking_type: "portioned",
      batch_yield: 1,
    })
    .select("id")
    .single<{ id: string }>();
  if (insErr) throw new Error(`insert napkins: ${insErr.message}`);

  console.log(`seeded napkins add-on: ${inserted.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Seed 33 — the six mappable NEEDS-CROSSWALK rows from seed 31's recon. 2026-08-28.
 *
 * Seed 31's coverage sweep found 8 Toast buttons selling with no active `toast_menu_map`
 * row (the crosswalk snapshot dates to 2026-07-27; these are newer buttons). Six are
 * mappable now — menu_item AND SKU both exist, so the (build) recipes from seeds 31/32
 * cover them the instant the mapping lands, with no further work. The headline is
 * **`Coca-Cola` at 284 sold/21d — the single largest drink gap**. The two `Just Iced
 * Tea` buttons stay UNMAPPED until their SKUs exist (Juan's call, pack fact recorded).
 *
 * ── HOW IT MAPS ──────────────────────────────────────────────────────────────
 * For each (Toast button name → target menu_item name), the seed finds every DISTINCT
 * (location_id, item_guid) in `toast_sales_events` selling under that name that has NO
 * active map row, and authors a base-entity row mirroring the confirmed idiom exactly
 * (probed live 2026-08-28): is_modifier false · disposition 'deplete' ·
 * match_status 'confirmed' · confirmed_by NULL (seed provenance rides the audit row,
 * action `toast_map.manual_map` — the registered human-mapping verb).
 *
 * REFUSALS: a target menu_item that doesn't resolve to exactly one row → the whole
 * name is skipped loudly; a (location, guid) that already has ANY active row → skipped
 * (retired/rejected rows are respected as history, never resurrected).
 *
 * DRY RUN IS THE DEFAULT; --execute is lead-gated (Juan's "Go on the things you got
 * left to do", 2026-08-28 — this was named item #11 on the list he greenlit).
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/33-drink-crosswalk-rows.ts               -> DRY RUN
 *      ... --execute                                           -> WRITES (lead-gated)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

const EXECUTE = process.argv.includes("--execute");
const PHASE = "seed-33-drink-crosswalk-2026-08-28";

/** Toast button name (exact, as rung) → menu_items.name (exact). From seed 31 §4. */
const MAPPINGS: Array<{ toastName: string; menuItemName: string; note: string }> = [
  { toastName: "Coca-Cola", menuItemName: "Coke", note: "284/21d — the single largest drink gap; almost certainly the other shop's Coke button." },
  { toastName: "Diet Coke", menuItemName: "Diet Coke", note: "5/21d — a 2nd GUID beside the confirmed one." },
  { toastName: "Dr. Browns Cream Soda", menuItemName: "Dr. Brown's Cream Soda", note: "3/21d — apostrophe-less Toast spelling." },
  { toastName: "Coke", menuItemName: "Coke", note: "2/21d — a 2nd GUID beside the confirmed one." },
  { toastName: "Dr. Browns Diet Cream Soda", menuItemName: "Dr. Browns Diet Cream Soda", note: "1/21d." },
  { toastName: "Dr. Browns Root Beer", menuItemName: "Dr. Browns Root Beer", note: "1/21d." },
];

async function main() {
  const sb = getServiceRoleClient();
  console.log(`\nSeed 33 — drink crosswalk rows — ${EXECUTE ? "EXECUTE" : "DRY RUN"}\n`);

  const { data: locs, error: lErr } = await sb.from("locations").select("id, name")
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`locations: ${lErr.message}`);
  const locName = new Map((locs ?? []).map((l) => [l.id, l.name]));

  for (const m of MAPPINGS) {
    const { data: mis, error: miErr } = await sb.from("menu_items").select("id")
      .eq("name", m.menuItemName).returns<Array<{ id: string }>>();
    if (miErr) throw new Error(`menu_items ${m.menuItemName}: ${miErr.message}`);
    if (!mis || mis.length !== 1) {
      console.log(`✗ '${m.toastName}' — SKIPPED: menu_item '${m.menuItemName}' resolves to ${mis?.length ?? 0} rows.`);
      continue;
    }
    const menuItemId = mis[0]!.id;

    // Every distinct (location, guid, price) this button has rung under.
    const { data: sold, error: sErr } = await sb.from("toast_sales_events")
      .select("location_id, toast_item_guid, price_cents")
      .eq("item_name", m.toastName)
      .returns<Array<{ location_id: string; toast_item_guid: string; price_cents: number | null }>>();
    if (sErr) throw new Error(`sales events ${m.toastName}: ${sErr.message}`);
    const byKey = new Map<string, { locationId: string; guid: string; price: number | null; n: number }>();
    for (const r of sold ?? []) {
      const key = `${r.location_id}:${r.toast_item_guid}`;
      const e = byKey.get(key) ?? { locationId: r.location_id, guid: r.toast_item_guid, price: r.price_cents, n: 0 };
      e.n += 1;
      byKey.set(key, e);
    }
    if (byKey.size === 0) { console.log(`✗ '${m.toastName}' — no sales events found under this exact name.`); continue; }

    for (const e of byKey.values()) {
      const { count, error: exErr } = await sb.from("toast_menu_map")
        .select("id", { count: "exact", head: true })
        .eq("location_id", e.locationId).eq("toast_item_guid", e.guid).eq("active", true);
      if (exErr) throw new Error(`existing map ${m.toastName}: ${exErr.message}`);
      if ((count ?? 0) > 0) {
        console.log(`· '${m.toastName}' @ ${locName.get(e.locationId)} — already mapped (active row exists), skipped.`);
        continue;
      }
      console.log(`✓ '${m.toastName}' @ ${locName.get(e.locationId)} → menu_item '${m.menuItemName}'   (${e.n} lifetime selections)`);
      console.log(`    ${m.note}`);
      if (!EXECUTE) continue;
      const { data: row, error: iErr } = await sb.from("toast_menu_map").insert({
        location_id: e.locationId, menu_item_id: menuItemId, item_id: null, package_id: null, sku_id: null,
        toast_item_guid: e.guid, toast_item_name: m.toastName, toast_price_cents: e.price,
        match_status: "confirmed", match_score: null,
        matched_at: new Date().toISOString(), confirmed_by: null, confirmed_at: new Date().toISOString(),
        active: true, created_by: null, is_modifier: false, disposition: "deplete",
        portion_qty: null, portion_unit: null,
      }).select("id").single<{ id: string }>();
      if (iErr) throw new Error(`insert map ${m.toastName}: ${iErr.message}`);
      await audit({
        actorId: null, actorRole: null,
        action: "toast_map.manual_map", resourceTable: "toast_menu_map", resourceId: row.id,
        metadata: {
          source: PHASE, toast_name: m.toastName, menu_item: m.menuItemName,
          location_id: e.locationId, toast_item_guid: e.guid, note: m.note,
        },
        ipAddress: null, userAgent: null,
      });
    }
  }
  console.log(`\n⏸ Just Iced Tea Lemon/Raspberry — UNMAPPED until their SKUs exist (Juan's call; 12×12 fl oz recorded in seed 30).`);
  console.log(`${EXECUTE ? "\nWRITTEN." : "\nNothing written (dry run)."}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

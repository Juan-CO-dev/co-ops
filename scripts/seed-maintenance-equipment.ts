/**
 * Seed the maintenance_equipment registry (Maintenance Log, Wave 2 #2).
 * Per location: the 8 fridges (each linked to its OPENING + CLOSING temp
 * template_item_id, safe_max_f=41) + non-temp equipment (Oven, Fryer).
 * Idempotent. The opening label "Station fridge holding temp (≤41°F)" is reused
 * across 3 stations, so opening items resolve by (station, label).
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-maintenance-equipment.ts
 */
import { getServiceRoleClient } from "../lib/supabase-server";

const sb = getServiceRoleClient();
const LOCATIONS = ["54ce1029-400e-4a92-9c2b-0ccb3b031f0a", "d2cced11-b167-49fa-bab6-86ec9bf4ff09"];

const FRIDGES: Array<{ name: string; openStation: string; openLabel: string; closeStation: string; closeLabel: string }> = [
  { name: "Walk-In Fridge", openStation: "Walk Ins Station", openLabel: "Station fridge holding temp (≤41°F)", closeStation: "Walk Ins Station", closeLabel: "Walk Ins station fridge temp log" },
  { name: "3-Door Fridge", openStation: "Prep Area", openLabel: "3-door fridge holding temp (≤41°F)", closeStation: "Prep Area", closeLabel: "3-door fridge temp log" },
  { name: "Sauce Fridge", openStation: "Prep Fridge", openLabel: "Sauce fridge holding temp (≤41°F)", closeStation: "Prep Fridge", closeLabel: "Sauce fridge temp log" },
  { name: "Deli Display Fridge", openStation: "Expo Station", openLabel: "Deli display fridge holding temp (≤41°F)", closeStation: "Expo Station", closeLabel: "Deli display fridge temp log" },
  { name: "Crunchy Boi Fridge", openStation: "Crunchy Boi Station", openLabel: "Station fridge holding temp (≤41°F)", closeStation: "Crunchy Boi Station", closeLabel: "Crunchy Boi station fridge temp log" },
  { name: "FOH Drinks Fridge", openStation: "Front of House Open", openLabel: "FOH drinks fridge holding temp (≤41°F)", closeStation: "Clean front of house", closeLabel: "FOH drinks fridge temp log" },
  { name: "Back-Line Drinks Fridge", openStation: "Back Line Open", openLabel: "Back-line drinks fridge holding temp (≤41°F)", closeStation: "Shut Down Back Line", closeLabel: "Back-line drinks fridge temp log" },
  { name: "3rd-Party Fridge", openStation: "3rd Party Station", openLabel: "Station fridge holding temp (≤41°F)", closeStation: "3rd Party Station", closeLabel: "3rd Party station fridge temp log" },
];
const EQUIPMENT = ["Oven", "Fryer"];

async function templateId(locationId: string, type: "opening" | "closing"): Promise<string | null> {
  const { data } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", locationId)
    .eq("type", type)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function itemId(tmpl: string, station: string, label: string): Promise<string | null> {
  const { data } = await sb
    .from("checklist_template_items")
    .select("id")
    .eq("template_id", tmpl)
    .eq("station", station)
    .eq("label", label)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function main() {
  let warns = 0;
  for (const loc of LOCATIONS) {
    const openTmpl = await templateId(loc, "opening");
    const closeTmpl = await templateId(loc, "closing");
    let order = 0;
    for (const f of FRIDGES) {
      const { data: exists } = await sb.from("maintenance_equipment").select("id").eq("location_id", loc).eq("name", f.name).maybeSingle<{ id: string }>();
      if (exists) { console.log(`skip ${loc.slice(0, 8)} ${f.name}`); order++; continue; }
      const openId = openTmpl ? await itemId(openTmpl, f.openStation, f.openLabel) : null;
      const closeId = closeTmpl ? await itemId(closeTmpl, f.closeStation, f.closeLabel) : null;
      if (!openId || !closeId) { warns++; console.warn(`  ! ${f.name} @ ${loc.slice(0, 8)}: open=${!!openId} close=${!!closeId}`); }
      const { error } = await sb.from("maintenance_equipment").insert({
        location_id: loc, name: f.name, kind: "fridge",
        opening_temp_item_id: openId, closing_temp_item_id: closeId, safe_max_f: 41, sort_order: order++,
      });
      if (error) console.error(`  x ${f.name}: ${error.message}`); else console.log(`  ok ${f.name} (open=${!!openId} close=${!!closeId})`);
    }
    for (const name of EQUIPMENT) {
      const { data: exists } = await sb.from("maintenance_equipment").select("id").eq("location_id", loc).eq("name", name).maybeSingle<{ id: string }>();
      if (exists) { order++; continue; }
      const { error } = await sb.from("maintenance_equipment").insert({ location_id: loc, name, kind: "equipment", safe_max_f: null, sort_order: order++ });
      if (error) console.error(`  x ${name}: ${error.message}`); else console.log(`  ok ${name}`);
    }
  }
  console.log(warns === 0 ? "\nALL temp items mapped" : `\n${warns} UNMAPPED - fix station/label constants`);
  process.exitCode = warns === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

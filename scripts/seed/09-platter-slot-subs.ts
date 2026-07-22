/**
 * Sub-project B — reconcile platter choice slots from PIECES to WHOLE SUBS (halves default).
 * The seeded piece-platters modeled their choice slot's quantity as PIECES (8/16/32/48); the
 * package configurator composes platters in WHOLE SUBS (8pc = 4 subs, each halved). So set each
 * piece-platter's choice-line quantity to pieces/2: 8→4, 16→8, 32→16, 48→24, and relabel the slot.
 * 3-/6-footers + lunch boxes are untouched (already whole-sub picks).
 *
 * Idempotent. SEED_DRY=1 → report only. pathToFileURL guard.
 * Run: SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/09-platter-slot-subs.ts  (dry)
 *      npx tsx --env-file=.env.local scripts/seed/09-platter-slot-subs.ts              (prod)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";
const PLATTERS = ["8 pc platter", "16 pc platter", "32 pc platter", "48 pc platter"];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");
  let updated = 0, unchanged = 0;
  const missing: string[] = [];
  for (const label of PLATTERS) {
    const pieces = Number(label.split(" ")[0]!); // "8 pc platter" → 8
    const subs = pieces / 2;                      // halves default
    const desc = `Choose your subs (×${subs})`;
    const { data: pkgs } = await sb.from("catering_packages").select("id, label_en")
      .eq("label_en", label).eq("active", true)
      .returns<Array<{ id: string; label_en: string }>>();
    if (!pkgs || pkgs.length === 0) { missing.push(label); continue; }
    for (const p of pkgs) {
      const { data: line } = await sb.from("catering_package_items")
        .select("id, quantity, description")
        .eq("package_id", p.id).eq("slot_type", "choice").eq("active", true)
        .maybeSingle<{ id: string; quantity: number | string; description: string | null }>();
      if (!line) { missing.push(`${label} (choice line)`); continue; }
      if (Number(line.quantity) === subs && line.description === desc) { unchanged++; continue; }
      updated++;
      if (!DRY) {
        const { error } = await sb.from("catering_package_items").update({ quantity: subs, description: desc }).eq("id", line.id);
        if (error) throw new Error(`update ${label}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "catering.kb.packages.line_item_update", resourceTable: "catering_package_items", resourceId: line.id, metadata: { package: label, pieces, subs, phase: "package_configurator_b" }, ipAddress: null, userAgent: null });
      }
    }
  }
  console.log(`\nPlatter slots: ${updated} updated, ${unchanged} unchanged.`);
  if (missing.length) { console.log("NOT found (skipped):"); for (const m of missing) console.log(`  - ${m}`); }
  console.log("Reconcile done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

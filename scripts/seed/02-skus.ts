/**
 * Operational Seed — Stage 2: SKUs (vendor_items).
 *
 * Seeds CO's real purchasing catalog from the Cap Hill 2025 order guide as GLOBAL
 * (location_id NULL) vendor_items, one SKU per guide row, under each row's own vendor.
 * Enriches the pack model (units_per_pack / each_size / each_measure / pack_format)
 * best-effort from the 2024 inventory-costing sheet by a NORMALIZED name match with an
 * explicit alias table for the known naming variants (e.g. "Hot Peppers" ↔ "Peppers (Hot)",
 * "Onions" ↔ "Onion (red)/(White)"). PRICE is deferred to Stage 4 (vendor_price_history).
 *
 * Par: numeric → weekday_par (the existing layered-par mechanism the backend/admin dictate);
 * the verbatim par cell (".25 jug", "3 cs") is preserved in notes. weekend_par stays NULL.
 *
 * Placeholder reconciliation (Q3 = A storage + B search; Juan-locked option 1):
 *   - DEACTIVATE the 10 in-house-prep placeholders (Garlic Aioli, Caesar Dressing, … — these
 *     are sub-builds, rebuilt as items + recipes in Stage 5).
 *   - LEAVE the 15 raw-ingredient placeholders + "Hot Peppers" untouched. Hot Peppers is the
 *     ONLY placeholder with an item_components link; it's not in the PFG guide (it's a Boar's
 *     Head good), so leaving it untouched preserves the link. Multi-vendor duplicates by name
 *     are welcome under the Q3 search-time grouping model.
 *
 * Idempotent. Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/02-skus.ts
 * Decisions: docs/superpowers/specs/2026-07-21-operational-seed-decisions.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "../../docs/seed/source");

// ── CSV parsing ────────────────────────────────────────────────────────────────
/** Split one CSV line into fields, honoring "quoted, fields" and escaped "" quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else { cur += c; }
    } else if (c === '"') { inQ = true; }
    else if (c === ",") { out.push(cur); cur = ""; }
    else { cur += c; }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function readCsv(name: string): string[][] {
  const raw = readFileSync(resolve(SOURCE, name), "utf8");
  return raw.split(/\r?\n/).filter((l) => l.length > 0).map(splitCsvLine);
}

// ── Vendor + unit maps ──────────────────────────────────────────────────────────
/** Map a raw guide/inventory vendor token → the canonical seeded vendor name. null = skip. */
function mapVendor(tok: string): string | null {
  const v = tok.trim().toLowerCase();
  if (!v || v === "n/a" || v === "na") return null;
  if (v === "pfg") return "PFG";
  if (v === "baldor") return "Baldor";
  if (v === "us foods" || v === "us food" || v === "us foods " || v === "usfoods") return "US Foods";
  if (v === "bh" || v === "boar's head" || v === "boars head") return "Boar's Head";
  if (v === "sarah") return "Sarah";
  if (v === "cristian") return "Cristian";
  if (v === "webstaurant") return "Webstaurant";
  if (v === "trimark") return "Trimark";
  if (v === "saval") return "Saval";
  if (v === "sysco" || v === "sisco") return "Sysco";
  if (v === "cardinal" || v === "cardinal bakery") return "Cardinal Bakery";
  return null; // unmapped (retail names like Grocery/Safeway/Amazon in inventory) — skip enrich/seed
}

/** Map an inventory unit token → a registered measure_unit label, or null if not mappable. */
function mapMeasure(tok: string): string | null {
  const u = tok.trim().toLowerCase();
  if (u === "oz") return "oz";
  if (u === "fl oz") return "fl oz";
  if (u === "lb" || u === "lbs") return "lb";
  if (u === "gallon" || u === "gal") return "gallon";
  if (u === "gram" || u === "g") return "gram";
  if (u === "kg") return "kg";
  if (u === "ml") return "mL";
  if (u === "liter" || u === "lt" || u === "l") return "liter";
  if (u === "ea" || u === "each" || u === "pc" || u === "pcs" || u === "piece" || u === "pieces" || u === "count") return "count";
  return null;
}

// ── Name normalization + alias table (the naming-nuance matcher Juan flagged) ─────
function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\.+$/, "").replace(/'/g, "").replace(/\s+/g, " ");
}
/** Canonical key so "Hot Peppers" ↔ "Peppers (Hot)" etc. resolve to the same good. */
const ALIAS: Record<string, string> = {
  "hot peppers": "peppers hot", "peppers (hot)": "peppers hot",
  "sweet peppers": "peppers sweet", "peppers (sweet)": "peppers sweet",
  "banana peppers": "peppers banana", "peppers (banana)": "peppers banana",
  "fresh mozzarella": "mozzarella fresh", "mozzarella": "mozzarella fresh",
  "roasted red peppers": "roasted red pepper", "roasted red pepper": "roasted red pepper",
  "red wine vinegar": "red wine vin", "red wine vin": "red wine vin",
  "shredded mozz": "shredded mozz",
};
function canonKey(name: string): string {
  const n = norm(name);
  return ALIAS[n] ?? n;
}

// ── Par parsing ──────────────────────────────────────────────────────────────────
/** Extract the leading numeric from a par cell (".25 jug"→0.25, "1/2 tub"→0.5, "3 cs"→3). */
function parNumeric(cell: string): number | null {
  const s = cell.trim();
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) { const a = Number(frac[1]); const b = Number(frac[2]); if (b) return a / b; }
  const dec = s.match(/^\.?\d+(?:\.\d+)?/);
  if (dec) return Number(dec[0]);
  return null;
}
/** Best-effort pack_format label from the par-unit keyword, falling back on case-qty. */
function packFormatFor(parCell: string, caseQty: number | null): string | null {
  const p = parCell.toLowerCase();
  if (/\bbox(es)?\b/.test(p)) return "Box";
  if (/\bbags?\b/.test(p)) return "Bag";
  if (/\bflats?\b/.test(p)) return "Flat";
  if (/\bcs\b|\bcase(s)?\b/.test(p)) return "Case";
  if (/\bea\b|\beach\b/.test(p)) return "Each (no case)";
  if (caseQty != null) return caseQty > 1 ? "Case" : "Each (no case)";
  return null;
}

// ── Inventory index (pack model source) ──────────────────────────────────────────
interface Pack { unitsPerPack: number; eachSize: number; eachMeasure: string; }
function loadInventoryPacks(): Map<string, Pack> {
  const rows = readCsv("inventory-costing.csv");
  const idx = new Map<string, Pack>();
  for (const r of rows) {
    const name = (r[0] ?? "").trim();
    const qtyRaw = (r[4] ?? "").trim();
    const unitRaw = (r[5] ?? "").trim();
    if (!name || !qtyRaw || !unitRaw) continue;        // section header / blank / no pack
    const qty = Number(qtyRaw.replace(/[^0-9.]/g, ""));
    const measure = mapMeasure(unitRaw);
    if (!Number.isFinite(qty) || qty <= 0 || !measure) continue;
    const key = canonKey(name);
    if (!idx.has(key)) idx.set(key, { unitsPerPack: 1, eachSize: qty, eachMeasure: measure });
  }
  return idx;
}

// ── Order-guide parse (2-column layout) ──────────────────────────────────────────
// Guide sections whose SKUs are inventory-only (excluded from ingredient/recipe/BOM pickers).
const INVENTORY_ONLY_SECTIONS = new Set(["packaging supplies", "trimark"]);
interface SkuDef { name: string; itemNumber: string | null; vendor: string; parNum: number | null; parVerbatim: string | null; inventoryOnly: boolean; }
function cleanItemNumber(raw: string, vendorTok: string): string | null {
  const s = raw.trim();
  if (!s || /^n\/?a$/i.test(s)) return null;
  if (s.toLowerCase() === vendorTok.trim().toLowerCase()) return null; // junk (item# == vendor name)
  if (/^fresh\s+chives$/i.test(s)) return null;                        // note-in-item#-cell junk
  return s;
}
type HalfResult =
  | { kind: "header"; section: string }
  | { kind: "sku"; def: Omit<SkuDef, "inventoryOnly"> }
  | { kind: "none" };

/** Classify one half (5 cols: Item, Item#, Par, Order, Vendor) as a section header, a SKU, or nothing. */
function parseHalf(cols: string[]): HalfResult {
  const name = (cols[0] ?? "").trim();
  const itemRaw = (cols[1] ?? "").trim();
  const parCell = (cols[2] ?? "").trim();
  const vendorTok = (cols[4] ?? "").trim();
  if (!name) return { kind: "none" };
  // Section header (e.g. "Produce", "Meat", "Packaging Supplies", "Trimark"): name only.
  if (!itemRaw && !parCell && !vendorTok) return { kind: "header", section: name };
  const vendor = mapVendor(vendorTok);
  if (!vendor) return { kind: "none" }; // n/a rows (e.g. "Dried Chives") — skip
  return {
    kind: "sku",
    def: {
      name,
      itemNumber: cleanItemNumber(itemRaw, vendorTok),
      vendor,
      parNum: parCell ? parNumeric(parCell) : null,
      parVerbatim: parCell || null,
    },
  };
}
function loadGuideSkus(): SkuDef[] {
  const rows = readCsv("order-guide-caphill-2025-pfg.csv");
  const out: SkuDef[] = [];
  let leftSection = "";
  let rightSection = "";
  const tag = (def: Omit<SkuDef, "inventoryOnly">, section: string): SkuDef => ({
    ...def,
    inventoryOnly: INVENTORY_ONLY_SECTIONS.has(section.toLowerCase()),
  });
  for (const r of rows) {
    // Header row: col0 === "Item". Title/blank rows classify as "none" in both halves.
    if ((r[0] ?? "").trim().toLowerCase() === "item") continue;
    const left = parseHalf(r.slice(0, 5));
    const right = parseHalf(r.slice(6, 11));
    if (left.kind === "header") leftSection = left.section;
    else if (left.kind === "sku") out.push(tag(left.def, leftSection));
    if (right.kind === "header") rightSection = right.section;
    else if (right.kind === "sku") out.push(tag(right.def, rightSection));
  }
  return out;
}

// ── Placeholder reconciliation lists ─────────────────────────────────────────────
// The 10 in-house-prep placeholders → deactivate (rebuilt as items + recipes in Stage 5).
const PREP_PLACEHOLDERS_TO_DEACTIVATE = [
  "Caesar Dressing", "Caramelized Onions", "Cholula Mayo", "Garlic Aioli", "Honey Chili Aioli",
  "Lemon/Oil Mix", "Mustard Aioli", "Oil/Balsamic Mix", "Regular Mayo", "Salsa Verde",
];

const DRY = process.env.SEED_DRY === "1";

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): parsing + reporting only, NO writes ──\n");

  // Vendor name → id.
  const { data: vends, error: vErr } = await sb.from("vendors").select("id, name").eq("active", true).returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`load vendors: ${vErr.message}`);
  const vendorId = new Map((vends ?? []).map((v) => [v.name, v.id]));

  const packs = loadInventoryPacks();
  const skus = loadGuideSkus();
  console.log(`Parsed ${skus.length} SKU rows from the Cap Hill guide; ${packs.size} inventory pack entries indexed.`);

  let created = 0, updated = 0, unchanged = 0, enriched = 0, invOnly = 0;
  const skippedVendor: string[] = [];
  const unmatchedPack: string[] = [];

  for (const s of skus) {
    const vid = vendorId.get(s.vendor);
    if (!vid) { skippedVendor.push(`${s.name} (vendor "${s.vendor}" not seeded)`); continue; }
    if (s.inventoryOnly) invOnly++;

    // Pack enrichment (best-effort; price deferred to Stage 4).
    const pack = packs.get(canonKey(s.name));
    if (!pack) unmatchedPack.push(s.name);
    const packFormat = packFormatFor(s.parVerbatim ?? "", pack ? pack.eachSize : null);

    const notes = s.parVerbatim ? `Par (2025 Cap Hill guide): ${s.parVerbatim}. [seed stage2]` : "[seed stage2]";
    const desired = {
      vendor_id: vid,
      location_id: null as string | null,
      name: s.name,
      item_number: s.itemNumber,
      weekday_par: s.parNum,
      weekend_par: null as number | null,
      pack_format: packFormat,
      units_per_pack: pack ? pack.unitsPerPack : null,
      each_size: pack ? pack.eachSize : null,
      each_measure: pack ? pack.eachMeasure : null,
      notes,
      active: true,
      inventory_only: s.inventoryOnly,
    };

    // Idempotent identity: (name, vendor_id, global). Global = location_id IS NULL.
    const { data: existing } = await sb
      .from("vendor_items")
      .select("id, item_number, weekday_par, pack_format, units_per_pack, each_size, each_measure, notes, active, inventory_only")
      .eq("name", s.name).eq("vendor_id", vid).is("location_id", null)
      .maybeSingle<{ id: string; item_number: string | null; weekday_par: number | null; pack_format: string | null; units_per_pack: number | null; each_size: number | null; each_measure: string | null; notes: string | null; active: boolean; inventory_only: boolean }>();

    if (!existing) {
      created++;
      if (pack) enriched++;
      if (!DRY) {
        const { data: ins, error } = await sb.from("vendor_items").insert({ ...desired, created_by: null, updated_by: null }).select("id").single<{ id: string }>();
        if (error) throw new Error(`insert SKU ${s.name}/${s.vendor}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "vendor_item.create", resourceTable: "vendor_items", resourceId: ins.id, metadata: { name: s.name, vendor: s.vendor, location_id: null, creation_method: "seed_script", phase: "operational_seed_stage2" }, ipAddress: null, userAgent: null });
      }
    } else {
      // Update only if a tracked field drifted (keeps re-runs quiet + idempotent).
      const changed =
        existing.item_number !== desired.item_number ||
        Number(existing.weekday_par) !== Number(desired.weekday_par) ||
        existing.pack_format !== desired.pack_format ||
        existing.units_per_pack !== desired.units_per_pack ||
        Number(existing.each_size) !== Number(desired.each_size) ||
        existing.each_measure !== desired.each_measure ||
        existing.notes !== desired.notes ||
        existing.inventory_only !== desired.inventory_only ||
        existing.active !== true;
      if (changed) {
        updated++;
        if (pack) enriched++;
        if (!DRY) {
          const { error } = await sb.from("vendor_items").update({ ...desired, updated_at: new Date().toISOString(), updated_by: null }).eq("id", existing.id);
          if (error) throw new Error(`update SKU ${s.name}/${s.vendor}: ${error.message}`);
          void audit({ actorId: null, actorRole: null, action: "vendor_item.update", resourceTable: "vendor_items", resourceId: existing.id, metadata: { name: s.name, vendor: s.vendor, sync_method: "seed_script", phase: "operational_seed_stage2" }, ipAddress: null, userAgent: null });
        }
      } else {
        unchanged++;
      }
    }
  }

  // Deactivate the in-house-prep placeholders (global; leave raw + Hot Peppers alone).
  let deactivated = 0;
  for (const name of PREP_PLACEHOLDERS_TO_DEACTIVATE) {
    const { data: rows } = await sb.from("vendor_items").select("id, active").eq("name", name).is("location_id", null).eq("active", true).returns<Array<{ id: string; active: boolean }>>();
    for (const row of rows ?? []) {
      deactivated++;
      if (!DRY) {
        const { error } = await sb.from("vendor_items").update({ active: false, updated_at: new Date().toISOString(), updated_by: null }).eq("id", row.id);
        if (error) throw new Error(`deactivate prep placeholder ${name}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "vendor_item.deactivate", resourceTable: "vendor_items", resourceId: row.id, metadata: { name, reason: "in_house_prep_rebuilt_as_item_stage5", phase: "operational_seed_stage2" }, ipAddress: null, userAgent: null });
      }
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log(`\nStage 2 SKUs: ${created} created, ${updated} updated, ${unchanged} unchanged | pack-enriched ${enriched} | inventory-only (packaging/cleaning) ${invOnly}.`);
  console.log(`Prep placeholders deactivated: ${deactivated}/${PREP_PLACEHOLDERS_TO_DEACTIVATE.length}.`);
  if (skippedVendor.length) { console.log(`\nSkipped ${skippedVendor.length} rows (vendor not seeded / n/a):`); for (const s of skippedVendor) console.log(`  - ${s}`); }
  if (unmatchedPack.length) { console.log(`\nNo inventory pack match for ${unmatchedPack.length} SKUs (pack left NULL — Stage 4 / manual will fill):`); for (const n of unmatchedPack) console.log(`  - ${n}`); }

  // ── Self-verify ───────────────────────────────────────────────────────────────
  const { count: activeGlobal } = await sb.from("vendor_items").select("id", { count: "exact", head: true }).is("location_id", null).eq("active", true);
  const { data: hot } = await sb.from("vendor_items").select("id, active").eq("name", "Hot Peppers").is("location_id", null).maybeSingle<{ id: string; active: boolean }>();
  const hotLink = hot ? (await sb.from("item_components").select("id", { count: "exact", head: true }).eq("component_sku_id", hot.id)).count ?? 0 : 0;
  const { count: prepsStillActive } = await sb.from("vendor_items").select("id", { count: "exact", head: true }).in("name", PREP_PLACEHOLDERS_TO_DEACTIVATE).is("location_id", null).eq("active", true);

  console.log(`\nVerify:`);
  console.log(`  active global vendor_items now: ${activeGlobal}`);
  console.log(`  Hot Peppers: ${hot ? (hot.active ? "active" : "INACTIVE!") : "MISSING!"} | item_components link${hotLink === 1 ? " intact (1)" : `s = ${hotLink} (EXPECTED 1)`}`);
  console.log(`  prep placeholders still active: ${prepsStillActive} (expected 0)`);
  if (DRY) {
    console.log("  (DRY: live-state checks reflect PRE-run state; prep-still-active=10 is expected until a real run.)");
  } else {
    const ok = hot?.active === true && hotLink === 1 && (prepsStillActive ?? 0) === 0;
    console.log(ok ? "  ✓ Stage 2 invariants hold." : "  ! Stage 2 invariants VIOLATED — review above.");
  }
  console.log("Stage 2 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

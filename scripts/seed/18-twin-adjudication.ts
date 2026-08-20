/**
 * Seed 18 — Ham + Fresh Mozzarella twin adjudication (multi-vendor audit P1).
 *
 * ── WHAT JUAN DECIDED (2026-08-20) ────────────────────────────────────────────
 * For each duplicated product, BOTH twins go ACTIVE: one primary, one backup.
 *   · PRIMARY holds the par, the recipe pins and the price — it is what the
 *     par-pass walker suggests and what costing reads.
 *   · BACKUP is active so it is ORDERABLE ON DEMAND (vendor-down, short ship),
 *     but carries NO par — so the walker cannot suggest one product to two
 *     vendors until the P2 product-identity node exists above SKUs.
 *
 * That "no par on the backup" is the whole safety property. `loadWalkerData`
 * (lib/ordering.ts:417-486) includes a SKU iff resolveActive() AND resolvePar()
 * both pass on the SAME ROW; dedupe there is SKU-identity only, so two par'd
 * active twins would produce two Suggest chips, two POs and no warning. Par is
 * the only thing keeping the twins from double-ordering, so this script asserts
 * the backup's pars are null rather than assuming it, and never invents one.
 *
 * ── WHICH TWIN IS PRIMARY, AND WHERE THAT IS AN INFERENCE ─────────────────────
 * HAM — explicit. The Angel row behind the spend is `HAM 35% WATER FC 4X6 TFF`
 * [ROMA], a PFG product ($2,164.94/yr), and PFG is the live primary distributor
 * lane. PFG is primary.
 *
 * FRESH MOZZARELLA — INFERRED, NOT STATED. Juan said "both — one primary, one
 * backup" without naming which. PFG was inferred from the same evidence shape
 * (`CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] is a PFG row, $1,365.90/yr) and from
 * ham's explicit answer. If Juan wants Baldor primary for mozzarella, the flip is
 * ONLY par + pin placement — swap `primary` and `backup` in MOZZARELLA below and
 * re-run. Nothing else in this script encodes the choice. Say so out loud rather
 * than letting an inference harden into a fact.
 *
 * ── THE PIN-MOVE GUARD (this is the part that matters) ────────────────────────
 * The brief assumed the pinned recipe lines are denominated in OUNCES. They are
 * NOT. Live, both pins read `quantity = 1, unit = "unit", portioned = true`, and
 * `unit` is a COUNT measure (measure_units, to_base_factor 1). So
 * ozForRecipeInput() falls to step 3 (the measure registry) and the line's oz
 * value is the SKU's OWN `avg_oz_per_each` — 1.2 oz for Baldor/Ham, 1 oz for
 * Baldor/Fresh Mozzarella. Both PFG twins carry `avg_oz_per_each = NULL`, so the
 * same line resolves to NULL on the PFG side: a re-point would not shift the
 * number, it would DELETE it, silently un-costing and un-depleting every recipe
 * that consumes the product.
 *
 * The script therefore does not re-point on faith. It computes the pinned line's
 * oz through the REAL production function (`ozForRecipeInput`, the same one
 * lib/prep-consumption-graph.ts calls) against BOTH twins' live shapes and moves
 * the pin only when the two agree. Today they do not, so the move REFUSES itself
 * and reports — per the brief's own stop clause. The refusal is the finding, and
 * it is a P2 (product-identity) problem wearing a P1 costume: the pin cannot
 * follow the par until the twins agree on what one "unit" of the product weighs.
 *
 * Activation, par assertion and the price fill are independent of the pin move
 * and are NOT blocked by it — activating the par-holding twin is what makes the
 * pair orderable at all, which is the P1 headline.
 *
 * ── PRICE ─────────────────────────────────────────────────────────────────────
 * Seed 17 wrote Ham $2.77 to the BALDOR twin because that was the only ACTIVE
 * SKU named "Ham" at the time, while the Angel row it came from is a PFG product.
 * The vendor attribution was knowingly crossed and recorded in the row's
 * source_note. `vendor_price_history` is APPEND-ONLY: that row is not touched,
 * corrected or superseded in place. Instead this script appends the same Angel
 * evidence to the PFG twin — the SKU that will actually carry the PO — with a
 * source_note naming the arithmetic and the row it corrects the attribution of.
 * The divisor is re-derived from the PFG twin's OWN live pack content rather than
 * copied, so if PFG's pack is not the 16 oz Baldor's was, the price recomputes.
 *
 * Fresh Mozzarella gets NO price. Angel's `CHEESE MOZZ 1OZ SLCD LOG 32 CT` is
 * `6/2 LB` = 192 oz at $47.10, but our PFG twin's pack is `72 count` with
 * avg_oz_per_each NULL — its content in ounces is UNRESOLVABLE, so there is no
 * denominator. Even granting the Baldor twin's 1 oz/each reading (72 oz), 192/72
 * = 2.67 is not a whole pack relation. That is exactly why the row is absent from
 * the reconciliation report's §D.2 tables and why seed 17 classed it "not a
 * candidate". Inventing a divisor here is the `PICKLES CHIPS $35.95/lb` failure
 * (report §C.3). It stays unpriced, loudly.
 *
 * ── LETTUCE ───────────────────────────────────────────────────────────────────
 * Reported, never written. Juan adjudicated Ham and Fresh Mozzarella only.
 *
 * Idempotent: every step asserts the live end-state first and writes only the
 * delta. A second run reports "already" on everything and writes nothing.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/18-twin-adjudication.ts
 *        → DRY RUN (default). Prints the full plan and end-state, writes nothing.
 *      npx tsx --conditions=react-server --env-file=.env.local scripts/seed/18-twin-adjudication.ts --execute
 *        → WRITES.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import {
  ozForRecipeInput,
  skuContentOz,
  type MeasureUnitFactor,
  type RecipeInputSku,
} from "@/lib/recipe-math";
import { computePackUnitPrice, exactQuotient } from "@/lib/angel-price-fill";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { pathToFileURL } from "node:url";

const EXECUTE = process.argv.includes("--execute");

/** Juan's decision, verbatim enough to survive in an audit row. */
const DECISION =
  "Juan 2026-08-20: both twins ACTIVE — PFG primary (par + pins + price), Baldor backup (active, NO par) so the par-pass walker cannot double-suggest one product to two vendors before the P2 product-identity node exists.";

const SOURCE_REPORTS =
  "docs/audits/2026-08-20-multivendor-semantics-audit.md P1 · docs/seed/source/angel-reconciliation-report.md J1";

/** Provenance key + date shared with seed 17 — the same Angel export. */
const ANGEL_SOURCE_KEY = "angel-catalog-2026-08";
const ANGEL_EXPORT_DATE = "2026-08-14";

// ── The pairs ──────────────────────────────────────────────────────────────────

interface AngelPriceEvidence {
  /** Angel row identity — product name alone is not unique in that catalog. */
  product: string;
  brand: string;
  packSizeRaw: string;
  casePriceUsd: number;
  /** Ounces in ONE Angel case, from the report's §D.2 resolution. */
  caseOz: number;
  /**
   * The pack oz the previously-written price was computed against. Used only to
   * SAY whether this run recomputed or merely re-attributed — never to skip the
   * live derivation.
   */
  priorBasisPackOz: number;
  /** The append-only row whose vendor attribution this one corrects (not modified). */
  supersedesNote: string;
}

interface TwinSide {
  id: string;
  /** Asserted live before any write — a name/vendor drift means STOP, not guess. */
  expectName: string;
  expectVendor: string;
}

interface TwinPair {
  product: string;
  /** Holds par + pins + price. */
  primary: TwinSide;
  /** Active-as-backup; pars must be null. */
  backup: TwinSide;
  /** Null = deliberately unpriced; `whyUnpriced` explains. */
  price: AngelPriceEvidence | null;
  whyUnpriced?: string;
  /** True where "primary" is an inference rather than Juan's explicit word. */
  primaryIsInferred: boolean;
}

const PAIRS: readonly TwinPair[] = [
  {
    product: "Ham",
    primary: { id: "804cb32d-ea68-4467-8479-b82f34a143a0", expectName: "Ham", expectVendor: "PFG" },
    backup: { id: "15944b2d-881b-419e-bcdb-8d8c5412de5a", expectName: "Ham", expectVendor: "Baldor" },
    primaryIsInferred: false,
    price: {
      product: "HAM 35% WATER FC 4X6 TFF",
      brand: "ROMA",
      packSizeRaw: "1/13 LB",
      casePriceUsd: 36.06,
      caseOz: 208,
      priorBasisPackOz: 16,
      supersedesNote:
        "corrects the vendor attribution of the $2.77 row seed 17 wrote to the Baldor twin (same Angel row; Baldor was the only ACTIVE 'Ham' at the time). That row is append-only history and is NOT modified.",
    },
  },
  {
    product: "Fresh Mozzarella",
    primary: { id: "27066f2a-8e5c-4c60-8a0f-a62980241998", expectName: "Fresh Mozzarella", expectVendor: "PFG" },
    backup: { id: "c35dfb4f-492a-43e9-8551-3a0558b695f7", expectName: "Fresh Mozzarella", expectVendor: "Baldor" },
    primaryIsInferred: true,
    price: null,
    whyUnpriced:
      "Angel `CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] 6/2 LB = 192 oz @ $47.10, but the PFG twin's pack is `72 count` with avg_oz_per_each NULL — its content in oz is UNRESOLVABLE, so there is no denominator to divide by. Even granting the Baldor twin's 1 oz/each reading (72 oz), 192/72 = 2.67 is not a whole pack relation. Absent from the reconciliation report's §D.2 tables for exactly this reason. Inventing a divisor is the PICKLES CHIPS $35.95/lb failure (report §C.3).",
  },
];

/** Adjudicated by nobody — reported only, never written. */
const PENDING_PRODUCTS = ["Lettuce"];

// ── Live shapes ────────────────────────────────────────────────────────────────

interface TwinRow {
  id: string;
  name: string;
  vendor: string;
  active: boolean;
  location_id: string | null;
  weekday_par: number | null;
  weekend_par: number | null;
  pack_format: string | null;
  each_container_label: string | null;
  units_per_pack: number | null;
  each_size: number | null;
  each_measure: string | null;
  avg_oz_per_each: number | null;
}

interface PinRow {
  id: string;
  recipe_id: string;
  recipe_name: string;
  quantity: number;
  unit: string | null;
  each_container_label: string | null;
  portioned: boolean;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function ozStr(v: number | null): string {
  return v == null ? "UNRESOLVABLE (null)" : `${v} oz`;
}

async function loadTwin(
  sb: ReturnType<typeof getServiceRoleClient>,
  side: TwinSide,
): Promise<TwinRow> {
  const { data, error } = await sb
    .from("vendor_items")
    .select(
      "id, name, active, location_id, weekday_par, weekend_par, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each, vendors(name)",
    )
    .eq("id", side.id)
    .maybeSingle<{
      id: string;
      name: string;
      active: boolean;
      location_id: string | null;
      weekday_par: number | string | null;
      weekend_par: number | string | null;
      pack_format: string | null;
      each_container_label: string | null;
      units_per_pack: number | null;
      each_size: number | string | null;
      each_measure: string | null;
      avg_oz_per_each: number | string | null;
      vendors: { name: string } | null;
    }>();
  if (error) throw new Error(`load twin ${side.expectVendor}/${side.expectName}: ${error.message}`);
  if (!data) throw new Error(`FATAL: twin ${side.id} (${side.expectVendor}/${side.expectName}) NOT FOUND — refusing to proceed.`);

  const vendor = data.vendors?.name ?? "(no vendor)";
  // Identity pre-flight. Both twins share a NAME, so identity is by id — and the id
  // is only trusted once its name AND vendor still read as expected. A drift here
  // means the registry moved under us; guessing is how a dedupe hits the wrong row.
  if (data.name !== side.expectName) {
    throw new Error(`FATAL: SKU ${side.id} is named "${data.name}", expected "${side.expectName}" — refusing to adjudicate the wrong SKU.`);
  }
  if (vendor !== side.expectVendor) {
    throw new Error(`FATAL: SKU ${side.id} sits under vendor "${vendor}", expected "${side.expectVendor}" — refusing (vendor re-pointing would invalidate the whole adjudication).`);
  }
  if (data.location_id !== null) {
    throw new Error(`FATAL: SKU ${side.id} is location-scoped (${data.location_id}); this adjudication is written for GLOBAL rows only.`);
  }

  return {
    id: data.id,
    name: data.name,
    vendor,
    active: data.active,
    location_id: data.location_id,
    weekday_par: num(data.weekday_par),
    weekend_par: num(data.weekend_par),
    pack_format: data.pack_format,
    each_container_label: data.each_container_label,
    units_per_pack: data.units_per_pack,
    each_size: num(data.each_size),
    each_measure: data.each_measure,
    avg_oz_per_each: num(data.avg_oz_per_each),
  };
}

function shapeOf(row: TwinRow, chain: PackChainLevel[] | null): RecipeInputSku {
  return {
    packFormat: row.pack_format,
    eachContainerLabel: row.each_container_label,
    unitsPerPack: row.units_per_pack,
    eachSize: row.each_size,
    eachMeasure: row.each_measure,
    avgOzPerEach: row.avg_oz_per_each,
    packChain: chain ?? null,
  };
}

async function loadPins(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuId: string,
): Promise<PinRow[]> {
  const { data, error } = await sb
    .from("recipe_inputs")
    .select("id, recipe_id, quantity, unit, each_container_label, portioned, recipes(name)")
    .eq("component_sku_id", skuId)
    .returns<Array<{
      id: string;
      recipe_id: string;
      quantity: number | string;
      unit: string | null;
      each_container_label: string | null;
      portioned: boolean;
      recipes: { name: string } | null;
    }>>();
  if (error) throw new Error(`load pins for ${skuId}: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    recipe_id: r.recipe_id,
    recipe_name: r.recipes?.name ?? "(recipe)",
    quantity: num(r.quantity) ?? Number.NaN,
    unit: r.unit,
    each_container_label: r.each_container_label,
    portioned: r.portioned,
  }));
}

function describe(row: TwinRow, contentOz: number | null, pins: number, prices: number): string {
  const par = `weekday_par=${row.weekday_par ?? "NULL"} weekend_par=${row.weekend_par ?? "NULL"}`;
  const pack = `pack=${row.pack_format ?? "-"} ${row.units_per_pack ?? "-"}×${row.each_size ?? "-"}${row.each_measure ?? ""} avg_oz_per_each=${row.avg_oz_per_each ?? "NULL"}`;
  return `${row.vendor}/${row.name} [${row.id}] active=${row.active} ${par} ${pack} content=${ozStr(contentOz)} pins=${pins} prices=${prices}`;
}

// ── The adjudication ───────────────────────────────────────────────────────────

interface PairOutcome {
  product: string;
  activated: boolean;
  activationSkipped: boolean;
  pinsMoved: number;
  pinsRefused: number;
  priceWritten: boolean;
  priceSkipped: boolean;
  priceRefused: boolean;
  parWarnings: string[];
}

async function adjudicate(
  sb: ReturnType<typeof getServiceRoleClient>,
  measures: Map<string, MeasureUnitFactor>,
  pair: TwinPair,
): Promise<PairOutcome> {
  const out: PairOutcome = {
    product: pair.product,
    activated: false,
    activationSkipped: false,
    pinsMoved: 0,
    pinsRefused: 0,
    priceWritten: false,
    priceSkipped: false,
    priceRefused: false,
    parWarnings: [],
  };

  console.log(`\n${"═".repeat(78)}`);
  console.log(`PAIR: ${pair.product}${pair.primaryIsInferred ? "   ⚠ PRIMARY IS AN INFERENCE (see header)" : ""}`);
  console.log("═".repeat(78));

  // ── Step 0 — live pre-flight on BOTH twins ──────────────────────────────────
  const primary = await loadTwin(sb, pair.primary);
  const backup = await loadTwin(sb, pair.backup);
  const chains = await loadSkuPackChains([primary.id, backup.id]);
  const primaryShape = shapeOf(primary, chains.get(primary.id) ?? null);
  const backupShape = shapeOf(backup, chains.get(backup.id) ?? null);
  const primaryContentOz = skuContentOz(primaryShape, measures);
  const backupContentOz = skuContentOz(backupShape, measures);

  const primaryPinsBefore = await loadPins(sb, primary.id);
  const backupPinsBefore = await loadPins(sb, backup.id);
  const [{ count: primaryPricesBefore }, { count: backupPricesBefore }] = await Promise.all([
    sb.from("vendor_price_history").select("id", { count: "exact", head: true }).eq("vendor_item_id", primary.id),
    sb.from("vendor_price_history").select("id", { count: "exact", head: true }).eq("vendor_item_id", backup.id),
  ]);

  console.log("BEFORE");
  console.log(`  PRIMARY  ${describe(primary, primaryContentOz, primaryPinsBefore.length, primaryPricesBefore ?? 0)}`);
  console.log(`  BACKUP   ${describe(backup, backupContentOz, backupPinsBefore.length, backupPricesBefore ?? 0)}`);

  // ── Step 1 — activate the primary ───────────────────────────────────────────
  console.log("\n[1] ACTIVATE PRIMARY");
  if (primary.active) {
    out.activationSkipped = true;
    console.log(`  = ${primary.vendor}/${primary.name} already active — no write.`);
  } else {
    console.log(`  ${EXECUTE ? "-" : "would"} set active=true on ${primary.vendor}/${primary.name} [${primary.id}]`);
    if (EXECUTE) {
      const { error } = await sb
        .from("vendor_items")
        .update({ active: true, updated_at: new Date().toISOString(), updated_by: null })
        .eq("id", primary.id)
        .eq("active", false); // guard: only flip a row still reading inactive.
      if (error) throw new Error(`activate ${pair.product} primary: ${error.message}`);
      out.activated = true;
      await audit({
        actorId: null,
        actorRole: null,
        action: "vendor_item.activate",
        resourceTable: "vendor_items",
        resourceId: primary.id,
        metadata: {
          name: primary.name,
          vendor: primary.vendor,
          role: "primary",
          before: { active: false },
          after: { active: true },
          twin_backup_id: backup.id,
          twin_backup_vendor: backup.vendor,
          decision: DECISION,
          primary_is_inferred: pair.primaryIsInferred,
          phase: "multivendor_p1_twin_adjudication",
          reason: "twin_adjudication_both_active_primary_holds_par",
          script: "scripts/seed/18-twin-adjudication.ts",
          source_report: SOURCE_REPORTS,
        },
        ipAddress: null,
        userAgent: null,
      });
    }
  }
  if (backup.active) {
    console.log(`  = ${backup.vendor}/${backup.name} stays ACTIVE as the backup — no write.`);
  } else {
    out.parWarnings.push(`BACKUP ${backup.vendor}/${backup.name} is INACTIVE — Juan's decision says both twins active. NOT activated here (the decision named the par-less twin as already-live); surface to Juan.`);
    console.warn(`  ! ${backup.vendor}/${backup.name} is INACTIVE but the decision says both active — NOT written (out of adjudicated scope). Flagged.`);
  }

  // ── Step 2 — par placement (assert, never invent) ───────────────────────────
  console.log("\n[2] PAR PLACEMENT (assert-only — no par is created, moved or cleared)");
  const primaryHasPar = primary.weekday_par != null || primary.weekend_par != null;
  if (primaryHasPar) {
    console.log(`  ✓ PRIMARY holds the par: weekday=${primary.weekday_par ?? "NULL"} weekend=${primary.weekend_par ?? "NULL"} (kept as-is)`);
  } else {
    out.parWarnings.push(`PRIMARY ${primary.vendor}/${primary.name} has NO par — the pair stays UNORDERABLE. A par is Juan's number, not this script's.`);
    console.warn("  ! PRIMARY carries NO par — the pair stays UNORDERABLE. Refusing to invent one.");
  }
  if (backup.weekday_par == null && backup.weekend_par == null) {
    console.log(`  ✓ BACKUP pars are NULL (weekday + weekend) — left NULL. The walker cannot double-suggest.`);
  } else {
    out.parWarnings.push(`BACKUP ${backup.vendor}/${backup.name} carries a par (weekday=${backup.weekday_par ?? "NULL"} weekend=${backup.weekend_par ?? "NULL"}) — with both twins active this is the DOUBLE-ORDER path. Clearing a par is a pars.update decision, not this script's.`);
    console.warn(`  ! BACKUP carries a par (weekday=${backup.weekday_par ?? "NULL"} weekend=${backup.weekend_par ?? "NULL"}) — DOUBLE-SUGGEST RISK. NOT cleared here (a par change is Juan's call). Flagged.`);
  }

  // The per-location overlay can reintroduce a par (or an activation) the global row
  // does not show — loadWalkerData resolves overlay-first. Assert there is none rather
  // than reasoning about the global columns alone.
  const { data: overlays, error: oErr } = await sb
    .from("location_sku_settings")
    .select("location_id, sku_id, active_override, weekday_par, weekend_par")
    .in("sku_id", [primary.id, backup.id])
    .returns<Array<{ location_id: string; sku_id: string; active_override: boolean | null; weekday_par: number | string | null; weekend_par: number | string | null }>>();
  if (oErr) throw new Error(`load overlays for ${pair.product}: ${oErr.message}`);
  if ((overlays ?? []).length === 0) {
    console.log("  ✓ no location_sku_settings overlay on either twin — global values are the resolved values.");
  } else {
    for (const o of overlays ?? []) {
      const which = o.sku_id === backup.id ? "BACKUP" : "PRIMARY";
      const msg = `${which} carries a location overlay (location ${o.location_id}): active_override=${o.active_override ?? "NULL"} weekday_par=${o.weekday_par ?? "NULL"} weekend_par=${o.weekend_par ?? "NULL"} — overlay resolves BEFORE the global value.`;
      out.parWarnings.push(msg);
      console.warn(`  ! ${msg}`);
    }
  }

  // ── Step 3 — recipe pins, oz-semantics gated ────────────────────────────────
  console.log("\n[3] RECIPE PINS — move BACKUP → PRIMARY, gated on oz-meaning preservation");
  if (backupPinsBefore.length === 0) {
    console.log("  = no pins on the backup twin — nothing to move.");
  }
  for (const pin of backupPinsBefore) {
    const ozBefore = ozForRecipeInput(pin.quantity, pin.unit, backupShape, measures);
    const ozAfter = ozForRecipeInput(pin.quantity, pin.unit, primaryShape, measures);
    const line = `${pin.recipe_name} · ${pin.quantity} ${pin.unit ?? "(no unit)"}${pin.portioned ? " (portioned)" : ""}`;
    console.log(`  · ${line}`);
    console.log(`      on BACKUP  ${backup.vendor}: ${ozStr(ozBefore)}`);
    console.log(`      on PRIMARY ${primary.vendor}: ${ozStr(ozAfter)}`);

    // The gate. Equality is required, not "close enough to a rounding" — the whole
    // point is that a pin swap must not change what the recipe consumes. A null on
    // either side is a failure, not a tie: an unresolvable line silently drops out
    // of costing AND depletion.
    const preserved =
      ozBefore != null && ozAfter != null && Math.abs(ozAfter - ozBefore) <= 1e-9;
    if (!preserved) {
      out.pinsRefused++;
      const why =
        ozBefore == null
          ? "the line does not resolve on the BACKUP either — nothing to preserve, so preservation cannot be proven"
          : ozAfter == null
            ? `the line resolves to NULL on the PRIMARY. unit "${pin.unit}" is a COUNT measure, so ozForRecipeInput falls to the measure registry and reads the SKU's own avg_oz_per_each — ${backup.vendor} has ${backup.avg_oz_per_each ?? "NULL"}, ${primary.vendor} has ${primary.avg_oz_per_each ?? "NULL"}`
            : `the line's oz MEANING changes (${ozBefore} → ${ozAfter})`;
      console.warn(`      ✗ REFUSING to re-point: ${why}.`);
      console.warn("        Moving it would not shift a number, it would DELETE one — every recipe consuming this product would fall out of costing and depletion silently.");
      console.warn(`        UNBLOCK: give ${primary.vendor}/${primary.name} the same avg_oz_per_each as ${backup.vendor}/${backup.name}, or resolve it properly at the P2 product-identity layer. Then re-run — this gate passes and the pin moves.`);
      continue;
    }

    console.log(`      ✓ oz meaning preserved (${ozBefore} oz on both) — ${EXECUTE ? "re-pointing" : "would re-point"}.`);
    if (EXECUTE) {
      const { error } = await sb
        .from("recipe_inputs")
        .update({ component_sku_id: primary.id })
        .eq("id", pin.id)
        .eq("component_sku_id", backup.id); // guard: only move a pin still on the backup.
      if (error) throw new Error(`re-point pin ${pin.id}: ${error.message}`);
      out.pinsMoved++;
      await audit({
        actorId: null,
        actorRole: null,
        action: "recipe.update",
        resourceTable: "recipe_inputs",
        resourceId: pin.id,
        metadata: {
          op: "component_sku_repoint",
          recipe_id: pin.recipe_id,
          recipe_name: pin.recipe_name,
          before: { component_sku_id: backup.id, vendor: backup.vendor },
          after: { component_sku_id: primary.id, vendor: primary.vendor },
          line: { quantity: pin.quantity, unit: pin.unit, portioned: pin.portioned },
          oz_preserved: ozBefore,
          decision: DECISION,
          phase: "multivendor_p1_twin_adjudication",
          reason: "twin_adjudication_pin_follows_primary",
          script: "scripts/seed/18-twin-adjudication.ts",
          source_report: SOURCE_REPORTS,
        },
        ipAddress: null,
        userAgent: null,
      });
    }
  }
  if (primaryPinsBefore.length > 0) {
    console.log(`  (PRIMARY already carries ${primaryPinsBefore.length} pin(s) — untouched.)`);
  }

  // ── Step 4 — price on the primary ───────────────────────────────────────────
  console.log("\n[4] PRICE ON PRIMARY");
  if (pair.price == null) {
    out.priceRefused = true;
    console.warn("  ✗ REFUSING to price. " + (pair.whyUnpriced ?? ""));
  } else {
    const ev = pair.price;
    // Derive the divisor from the PRIMARY's OWN live pack content — never inherit
    // the basis the previous row was computed against.
    if (primaryContentOz == null || primaryContentOz <= 0) {
      out.priceRefused = true;
      console.warn(`  ✗ REFUSING to price: the PRIMARY's pack content is ${ozStr(primaryContentOz)}, so there is no denominator to divide Angel's ${ev.caseOz} oz case by. A price without a verified pack is the PICKLES CHIPS $35.95/lb failure.`);
    } else {
      const divisor = ev.caseOz / primaryContentOz;
      const unitPrice = computePackUnitPrice(ev.casePriceUsd, divisor);
      const exact = exactQuotient(ev.casePriceUsd, divisor);
      const recomputed = primaryContentOz !== ev.priorBasisPackOz;
      console.log(`  Angel row: ${ev.product} [${ev.brand}] ${ev.packSizeRaw} — case ${money(ev.casePriceUsd)} = ${ev.caseOz} oz`);
      console.log(`  PRIMARY pack content (live): ${primaryContentOz} oz  →  divisor ${ev.caseOz}/${primaryContentOz} = ${divisor}`);
      console.log(`  unit_price = ${money(unitPrice)}${unitPrice !== exact ? ` (exact ${exact}, rounded to cents)` : ""}`);
      console.log(
        recomputed
          ? `  ⚠ RECOMPUTED — the primary's pack (${primaryContentOz} oz) differs from the ${ev.priorBasisPackOz} oz basis the earlier row was computed against.`
          : `  = pack matches the ${ev.priorBasisPackOz} oz basis the earlier row used, so the figure is unchanged; this row corrects the VENDOR ATTRIBUTION, not the arithmetic.`,
      );

      const { data: existing, error: exErr } = await sb
        .from("vendor_price_history")
        .select("id, unit_price")
        .eq("vendor_item_id", primary.id)
        .eq("source", ANGEL_SOURCE_KEY)
        .eq("effective_date", ANGEL_EXPORT_DATE)
        .maybeSingle<{ id: string; unit_price: number | string }>();
      if (exErr) throw new Error(`price dup check ${pair.product}: ${exErr.message}`);

      if (existing) {
        out.priceSkipped = true;
        console.log(`  = already priced from ${ANGEL_SOURCE_KEY} @ ${ANGEL_EXPORT_DATE} (row ${existing.id}, ${money(Number(existing.unit_price))}) — skipping (append-only, no double-append).`);
      } else {
        const sourceNote =
          `${ev.product} [${ev.brand}] ${ev.packSizeRaw} | case ${money(ev.casePriceUsd)} = ${ev.caseOz} oz ÷ ${divisor} = our ${primaryContentOz} oz pack → ${money(unitPrice)} per pack` +
          (unitPrice !== exact ? ` (exact ${exact}, rounded to cents)` : "") +
          ` | written to the PFG twin under the P1 twin adjudication (${recomputed ? "RECOMPUTED against this twin's own pack" : "same pack basis, re-attributed"}); ${ev.supersedesNote}`;
        console.log(`  ${EXECUTE ? "-" : "would"} append vendor_price_history row on ${primary.vendor}/${primary.name}`);
        if (EXECUTE) {
          const { data: ins, error } = await sb
            .from("vendor_price_history")
            .insert({
              vendor_item_id: primary.id,
              unit_price: unitPrice,
              effective_date: ANGEL_EXPORT_DATE,
              recorded_by: null,
              source: ANGEL_SOURCE_KEY,
              source_note: sourceNote,
            })
            .select("id")
            .single<{ id: string }>();
          if (error) throw new Error(`insert price ${pair.product}: ${error.message}`);
          out.priceWritten = true;
          console.log(`  + ${money(unitPrice)} (row ${ins.id})`);
          await audit({
            actorId: null,
            actorRole: null,
            action: "vendor_item.price_recorded",
            resourceTable: "vendor_price_history",
            resourceId: ins.id,
            metadata: {
              vendor_item_id: primary.id,
              sku_name: primary.name,
              vendor: primary.vendor,
              role: "primary",
              unit_price: unitPrice,
              effective_date: ANGEL_EXPORT_DATE,
              source: ANGEL_SOURCE_KEY,
              source_note: sourceNote,
              angel_product: ev.product,
              angel_brand: ev.brand,
              angel_pack_size_raw: ev.packSizeRaw,
              case_price_usd: ev.casePriceUsd,
              angel_case_oz: ev.caseOz,
              our_pack_oz: primaryContentOz,
              divisor,
              recomputed,
              corrects_attribution_of_twin: backup.id,
              decision: DECISION,
              phase: "multivendor_p1_twin_adjudication",
              reason: "twin_adjudication_price_follows_primary",
              script: "scripts/seed/18-twin-adjudication.ts",
              source_report: SOURCE_REPORTS,
            },
            ipAddress: null,
            userAgent: null,
          });
        }
      }
    }
  }

  // ── Step 5 — read back from the destination ─────────────────────────────────
  console.log("\nAFTER (read back from the destination)");
  const primaryAfter = await loadTwin(sb, pair.primary);
  const backupAfter = await loadTwin(sb, pair.backup);
  const chainsAfter = await loadSkuPackChains([primaryAfter.id, backupAfter.id]);
  const primaryPinsAfter = await loadPins(sb, primaryAfter.id);
  const backupPinsAfter = await loadPins(sb, backupAfter.id);
  const [{ count: pPricesAfter }, { count: bPricesAfter }] = await Promise.all([
    sb.from("vendor_price_history").select("id", { count: "exact", head: true }).eq("vendor_item_id", primaryAfter.id),
    sb.from("vendor_price_history").select("id", { count: "exact", head: true }).eq("vendor_item_id", backupAfter.id),
  ]);
  console.log(`  PRIMARY  ${describe(primaryAfter, skuContentOz(shapeOf(primaryAfter, chainsAfter.get(primaryAfter.id) ?? null), measures), primaryPinsAfter.length, pPricesAfter ?? 0)}`);
  console.log(`  BACKUP   ${describe(backupAfter, skuContentOz(shapeOf(backupAfter, chainsAfter.get(backupAfter.id) ?? null), measures), backupPinsAfter.length, bPricesAfter ?? 0)}`);

  // The P1 invariant, stated as a claim about the live row rather than an intention.
  const orderable =
    primaryAfter.active && (primaryAfter.weekday_par != null || primaryAfter.weekend_par != null);
  console.log(
    `  ORDERABLE: ${orderable ? "YES" : "NO"} — the walker needs active AND a resolved par on the SAME row (lib/ordering.ts:417-486). ` +
      `${primaryAfter.vendor} active=${primaryAfter.active} par=${primaryAfter.weekday_par ?? "NULL"}/${primaryAfter.weekend_par ?? "NULL"}; ` +
      `${backupAfter.vendor} active=${backupAfter.active} par=${backupAfter.weekday_par ?? "NULL"}/${backupAfter.weekend_par ?? "NULL"} (backup, no par → no second chip).`,
  );

  return out;
}

// ── Not adjudicated ────────────────────────────────────────────────────────────

async function reportPending(sb: ReturnType<typeof getServiceRoleClient>): Promise<void> {
  console.log(`\n${"═".repeat(78)}`);
  console.log("STILL PENDING — reported, NOT written");
  console.log("═".repeat(78));
  const { data, error } = await sb
    .from("vendor_items")
    .select("id, name, active, weekday_par, weekend_par, vendors(name)")
    .in("name", PENDING_PRODUCTS)
    .is("location_id", null)
    .returns<Array<{ id: string; name: string; active: boolean; weekday_par: number | string | null; weekend_par: number | string | null; vendors: { name: string } | null }>>();
  if (error) throw new Error(`load pending products: ${error.message}`);
  for (const r of data ?? []) {
    const pins = await sb.from("recipe_inputs").select("id", { count: "exact", head: true }).eq("component_sku_id", r.id);
    console.log(
      `  ${r.vendors?.name ?? "(no vendor)"}/${r.name} [${r.id}] active=${r.active} weekday_par=${r.weekday_par ?? "NULL"} weekend_par=${r.weekend_par ?? "NULL"} pins=${pins.count ?? 0}`,
    );
  }
  console.log("  → Juan adjudicated Ham and Fresh Mozzarella ONLY. Lettuce (Sysco active/no-par + Baldor");
  console.log("    inactive, zero recipe pins either side) is a DIFFERENT shape — nothing is unorderable");
  console.log("    and nothing is mis-costed today — and it has not been decided. NO WRITES.");
  console.log("    The other 8 multi-vendor products from the audit are likewise untouched.");
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const sb = getServiceRoleClient();
  console.log(
    EXECUTE
      ? "══ EXECUTE MODE — this run WRITES to vendor_items / recipe_inputs / vendor_price_history ══"
      : "══ DRY RUN (default) — no writes. Pass --execute to write. ══",
  );
  console.log(`\nDECISION: ${DECISION}`);
  console.log(`SOURCES:  ${SOURCE_REPORTS}`);

  const measures = await loadMeasures();
  if (measures.size === 0) throw new Error("FATAL: measure_units loaded empty — every oz derivation below would be a guess.");

  const outcomes: PairOutcome[] = [];
  for (const pair of PAIRS) outcomes.push(await adjudicate(sb, measures, pair));

  await reportPending(sb);

  console.log(`\n${"═".repeat(78)}`);
  console.log("SUMMARY");
  console.log("═".repeat(78));
  for (const o of outcomes) {
    console.log(
      `  ${o.product.padEnd(18)} activate=${o.activated ? "written" : o.activationSkipped ? "already-active" : EXECUTE ? "none" : "PLANNED"}  ` +
        `pins moved=${o.pinsMoved} refused=${o.pinsRefused}  ` +
        `price=${o.priceWritten ? "written" : o.priceSkipped ? "already-present" : o.priceRefused ? "REFUSED" : EXECUTE ? "none" : "PLANNED"}`,
    );
    for (const w of o.parWarnings) console.log(`      ! ${w}`);
  }
  const refusedPins = outcomes.reduce((a, o) => a + o.pinsRefused, 0);
  if (refusedPins > 0) {
    console.log(`\n  ${refusedPins} pin re-point(s) REFUSED — the pins stay on the backup twin.`);
    console.log("  This is the P2 product-identity gap surfacing inside the P1 fix: the two twins do not");
    console.log("  agree on what one 'unit' of the product weighs (avg_oz_per_each), so the pin cannot follow");
    console.log("  the par without changing what every consuming recipe costs and depletes. Activation, par");
    console.log("  placement and the price fill are unaffected — the pairs are ORDERABLE regardless.");
  }
  console.log(`\nSeed 18 done (${EXECUTE ? "execute" : "dry run"}).`);
  if (!EXECUTE) console.log("NOTHING WAS WRITTEN.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

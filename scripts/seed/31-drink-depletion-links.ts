/**
 * Seed 31 — DRINK DEPLETION LINKS: the beverage cohort's consumption lane.
 * 2026-08-28. Every soda CO sells rings on Toast, crosswalks cleanly to its
 * menu_item, and then falls off a cliff: no recipe produces that menu_item, so
 * `perUnitDirectSkuOzForMenuItem` returns an empty map, no `toast_daily_depletion`
 * row is ever written, and Dynamic Pars can never speak for a drink.
 * Live-verified 2026-08-28: 0 depletion rows across all 11 beverage SKUs.
 *
 * Juan's order (2026-08-28): "we do the drink links and anything else that needs
 * linking for depletion."
 *
 * ── WHY THIS SEED HAS TWO PHASES (the finding that shaped it) ────────────────
 * A recipe alone would have depleted NOTHING, and would have looked finished.
 *
 * `recipe-math.ts` DELIBERATELY ignores `to_base_factor` for VOLUME measures
 * (documented design decision, test-locked): a volume base cannot reach our
 * weight-oz universe without a density we do not store, so a volume-measured SKU
 * converts through the human-entered `avg_oz_per_each` exactly like a count unit.
 * Every beverage SKU carries `each_measure = 'fl oz'` (volume) with
 * `avg_oz_per_each = NULL`. So EVERY denomination — `12 fl oz`, `1 each`,
 * `1 Case` — resolves to null, poisons the flatten, and yields zero oz.
 *
 * That is also why seed 30's stated outcome did not land for the drinks. Its
 * header claims "35 × 12 fl oz resolves to a 420 oz order unit with no new unit
 * law" — but with a NULL avg it resolves to NULL, and all nine chain-less
 * beverages still reported `no_weight_basis` on the latest `par_auto_moves` run
 * (probed 2026-08-28). Seed 30 wrote the pack SHAPE; the volume path still needs
 * its per-unit weight. This seed supplies it, and only then authors the links.
 *
 * PHASE A — the weight basis. `avg_oz_per_each = 1` on the fl-oz beverage SKUs:
 * one fluid ounce of soda weighs one ounce. This is NOT invented — it MIRRORS THE
 * LIVE PRECEDENT: `Hot Peppers` is already `each_measure 'fl oz'` with
 * `avg_oz_per_each = 1` in prod. It makes the pack arithmetic finally true
 * (Coke: 35 × 12 × 1 = 420 oz = one case of 35 cans) and it is conservative by
 * ~4% (water is 1.043 oz/fl oz), which understates depletion rather than
 * inflating it. Audited `vendor_item.update`, an existing registered action.
 *
 * PHASE B — the 1:1 links. One consumer recipe per drink: output = the menu_item
 * (yield 1), input = its SKU at 12 fl oz — the honest per-serving denomination,
 * since a 12 fl oz can sold whole IS twelve fluid ounces of that SKU. batch_yield
 * 1, single output, so share = 1 and direct_oz = exactly 12 oz per can sold.
 *
 * ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────────
 * No pack chains, no prices, no pars, no crosswalk rows, no menu_items. The
 * DOUBLE-COUNT LAW is not in play: these recipes have SKU inputs only and no item
 * refs, so they contribute to `direct_oz` alone and never to `flattened_oz`.
 * The MASS-BALANCE guard is not tripped and is not evaded — `massBalanceIndex`
 * iterates `graph.byOutputItem` only, and these recipes produce menu_items
 * exclusively, so they are structurally outside it (verified in
 * lib/menu-costing-shared.ts, not assumed).
 *
 * `name_es` / `directions_es` are left NULL, mirroring all 60 existing seeded
 * recipes; the i18n law governs UI surfaces, and inventing Spanish for 11 of 60
 * recipes would make the corpus less consistent, not more.
 *
 * REFUSALS (all three are hard, and all three are why this is safe to re-run):
 *   1. a menu_item that ALREADY has an active recipe → refused, never a second
 *      producer (first-wins would silently pick one and hide the other);
 *   2. a SKU that would still have NO weight basis after Phase A → refused,
 *      because authoring a recipe that depletes zero is the exact failure this
 *      seed exists to end;
 *   3. Phase A refuses any SKU that already has an avg, is not `fl oz`, or
 *      carries an ACTIVE PACK CHAIN — a chain WINS over the flat fields, so a
 *      flat avg written beside one is a second opinion about the same pack.
 *
 * DRY RUN IS THE DEFAULT; --execute is lead-gated. The lead runs the dry run and
 * executes on Juan's word.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/31-drink-depletion-links.ts               -> DRY RUN
 *      ... --execute                                            -> WRITES (lead-gated)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

const EXECUTE = process.argv.includes("--execute");
const PHASE = "seed-31-drink-links-2026-08-28";

/** Phase A: the per-fl-oz weight basis for a chain-less, fl-oz beverage SKU. */
interface WeightBasis {
  skuName: string;
  avgOzPerEach: number;
  provenance: string;
}

/** Phase B: one 1:1 menu_item -> SKU consumer recipe. */
interface DrinkLink {
  menuItemName: string;
  skuName: string;
  quantity: number;
  unit: string;
  containerLabel: string;
  /** Why this pairing is the honest one (rendered in the dry run + audit). */
  note: string;
}

const BEVERAGE_DENSITY_PROVENANCE =
  "1 fl oz of soda = 1 oz, mirroring the live precedent on Hot Peppers " +
  "(each_measure 'fl oz', avg_oz_per_each 1); ~4% conservative vs water at 1.043";

const WEIGHT_BASIS: WeightBasis[] = [
  { skuName: "Coke", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "Diet Coke", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "Saratoga", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "DB Cel Ray", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "DB Cherry Soda", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "DB Cream Soda", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "DB Diet Cherry Soda", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "DB Diet Cream Soda", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  { skuName: "DB Root Beer", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
  // Branded (C/O) Water gets its basis here even though its LINK is held below:
  // the pack fact (24 × 12 fl oz) is Juan's own label and is not in question —
  // only WHICH menu item it serves is. Filling the basis closes its
  // `no_weight_basis` par reason regardless of how the Water Bottle question lands.
  { skuName: "Branded (C/O) Water", avgOzPerEach: 1, provenance: BEVERAGE_DENSITY_PROVENANCE },
];

/**
 * The links. 21-day Toast quantities (2026-08-07..2026-08-27) are recorded so the
 * lead can see what each row is worth; most-sold first.
 */
const LINKS: DrinkLink[] = [
  { menuItemName: "Diet Coke", skuName: "Diet Coke", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "676 sold/21d. Exact name match." },
  { menuItemName: "Dr. Browns Root Beer", skuName: "DB Root Beer", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "310 sold/21d. 'DB' is the SKU catalog's Dr. Brown's prefix." },
  { menuItemName: "Dr. Browns Diet Cream Soda", skuName: "DB Diet Cream Soda", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "170 sold/21d." },
  { menuItemName: "Dr. Brown's Cream Soda", skuName: "DB Cream Soda", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "148 sold/21d. (Menu item carries the apostrophe; the diet twin does not.)" },
  { menuItemName: "Dr. Browns Black Cherry", skuName: "DB Cherry Soda", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "147 sold/21d. Dr. Brown's ships one cherry flavor ('Black Cherry'); the SKU is spelled 'Cherry Soda'. One-to-one, and its diet twin pairs the same way." },
  { menuItemName: "Dr. Browns Diet Black Cherry", skuName: "DB Diet Cherry Soda", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "129 sold/21d. Diet twin of the pairing above." },
  { menuItemName: "Coke", skuName: "Coke", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "108 sold/21d at the crosswalked GUID. NOTE: a second Toast button, 'Coca-Cola' (284/21d), is UNMAPPED — see NEEDS CROSSWALK. This recipe covers it the moment that row is added." },
  { menuItemName: "Saratoga", skuName: "Saratoga", quantity: 12, unit: "fl oz", containerLabel: "bottle",
    note: "99 sold/21d. Both Toast spellings ('Saratoga', 'Saratoga Sparkling') already crosswalk to this one menu item." },
  { menuItemName: "Happy Hour Diet Coke", skuName: "Diet Coke", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "87 sold/21d. STATED ASSUMPTION: the promo pours the same 12 fl oz can at $1 instead of $2.79 — a price difference, not a size or format one (CO has no fountain). Same SKU as Diet Coke; two menu items pinning one SKU is not a dual-producer conflict." },
  { menuItemName: "Dr. Browns Cel-Ray Soda", skuName: "DB Cel Ray", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "55 sold/21d." },
  { menuItemName: "Happy Hour Coke", skuName: "Coke", quantity: 12, unit: "fl oz", containerLabel: "can",
    note: "29 sold/21d. Same stated assumption as Happy Hour Diet Coke." },
];

/** Ambiguous — a question, never a guess. */
const HELD: Array<{ what: string; qty21: string; question: string }> = [
  {
    what: "Natalie's Lemonade  (menu item + SKU + confirmed crosswalk all exist)",
    qty21: "161 sold/21d",
    question:
      "Its SKU carries an ACTIVE one-level pack chain ('case' contains 6 'count') that CONTRADICTS its flat fields (6 × 12 fl oz). A chain wins over flat fields, so the chain wants avg_oz_per_each = 12 (oz per bottle -> 72 oz/case) while the flat path wants 1 (-> 72 oz/case only if read as 6 × 12 × 1). One column cannot honestly answer both, and it currently reports `unresolvable_pack` — a DIFFERENT and worse fault than the other ten. " +
      "QUESTION: repair the chain to two levels (case -> 6 bottle -> 12 fl oz) and leave avg NULL, or retire the chain and let the flat fields stand? Once that lands, the link itself is trivial and unambiguous.",
  },
  {
    what: "Water Bottle  (menu item + confirmed crosswalk at both shops)",
    qty21: "133 sold/21d",
    question:
      "TWO candidate SKUs: 'Branded (C/O) Water' (24 × 12 fl oz, Juan's label) and 'Employee Water' (no pack facts; seed 30 records Juan distinguishing the two — 'Juan's 24×12 was the BRANDED water'). The $1.99 menu price suggests the branded bottle, but staff water and sold water are deliberately separate SKUs and picking the wrong one would deplete the wrong inventory silently. " +
      "QUESTION: does the 'Water Bottle' button sell the branded C/O bottle?",
  },
  {
    what: "24 Mixed Sodas  (catering; Capitol Hill crosswalk only)",
    qty21: "2 sold/21d",
    question:
      "An ASSORTMENT: 24 cans across an unspecified mix of Coke, Diet Coke and the six Dr. Brown's flavors. Apportioning it needs Juan's actual mix; any split we invent would put fabricated oz on eight SKUs at once. QUESTION: is there a standard mix, or is it packed to order?",
  },
  {
    what: "Dozen Waters  (catering; crosswalk at both shops)",
    qty21: "7 sold/21d",
    question:
      "12 × the same bottle the 'Water Bottle' question above is about. Blocked behind that same answer; trivial once it lands (12 × 12 fl oz of the chosen SKU).",
  },
];

/** Menu item + SKU both exist; the TOAST BUTTON is not crosswalked. A different errand. */
const NEEDS_CROSSWALK: Array<{ toastName: string; qty21: number; target: string }> = [
  { toastName: "Coca-Cola", qty21: 284, target: "menu_item 'Coke' — the single largest drink gap; almost certainly the other shop's Coke button" },
  { toastName: "Diet Coke (2nd GUID)", qty21: 5, target: "menu_item 'Diet Coke'" },
  { toastName: "Dr. Browns Cream Soda", qty21: 3, target: "menu_item \"Dr. Brown's Cream Soda\"" },
  { toastName: "Coke (2nd GUID)", qty21: 2, target: "menu_item 'Coke'" },
  { toastName: "Just Iced Tea Lemon Tea", qty21: 1, target: "menu_item 'JustIced Tea- Lemon Tea' (also needs a SKU — see below)" },
  { toastName: "Just Iced Tea Raspberry", qty21: 1, target: "menu_item 'JustIced Tea- Raspberry Tea' (also needs a SKU)" },
  { toastName: "Dr. Browns Diet Cream Soda", qty21: 1, target: "menu_item 'Dr. Browns Diet Cream Soda'" },
  { toastName: "Dr. Browns Root Beer", qty21: 1, target: "menu_item 'Dr. Browns Root Beer'" },
];

/** Menu item + crosswalk exist; NO SKU exists to link to. A different errand. */
const NEEDS_SKU: Array<{ menuItem: string; qty21: number; note: string }> = [
  { menuItem: "JustIced Tea- Lemon Tea", qty21: 139, note: "Seed 30 recorded the fact for creation: 12 × 12 fl oz per Juan." },
  { menuItem: "JustIced Tea - Dragon Green tea", qty21: 83, note: "Same case pack." },
  { menuItem: "JustIced Tea- Raspberry Tea", qty21: 73, note: "Same case pack." },
  { menuItem: "Red Bull", qty21: 8, note: "No SKU, no pack fact yet." },
  { menuItem: "Red Bull - Sugar Free", qty21: 7, note: "No SKU, no pack fact yet." },
  { menuItem: "Topo Chico Lime", qty21: 2, note: "No SKU. Also carries a stale `rejected` crosswalk row under the name 'Topo Chico'." },
];

interface SkuRow {
  id: string;
  name: string;
  each_measure: string | null;
  avg_oz_per_each: number | string | null;
  units_per_pack: number | null;
  each_size: number | string | null;
}

async function main() {
  const sb = getServiceRoleClient();

  const { data: skuRows, error: sErr } = await sb
    .from("vendor_items")
    .select("id, name, each_measure, avg_oz_per_each, units_per_pack, each_size")
    .eq("active", true)
    .returns<SkuRow[]>();
  if (sErr) throw new Error(`vendor_items: ${sErr.message}`);
  const skuByName = new Map((skuRows ?? []).map((s) => [s.name, s]));

  const { data: menuRows, error: mErr } = await sb
    .from("menu_items").select("id, name").eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (mErr) throw new Error(`menu_items: ${mErr.message}`);
  const menuByName = new Map((menuRows ?? []).map((m) => [m.name, m.id]));

  // Active pack chains — a chain WINS over the flat fields, so its presence is a
  // Phase-A refusal (never write a second opinion about the same pack).
  const { data: chainRows, error: cErr } = await sb
    .from("sku_pack_levels").select("sku_id").eq("active", true)
    .returns<Array<{ sku_id: string }>>();
  if (cErr) throw new Error(`sku_pack_levels: ${cErr.message}`);
  const chained = new Set((chainRows ?? []).map((c) => c.sku_id));

  // Every menu_item that ALREADY has an active producing recipe.
  const { data: outRows, error: oErr } = await sb
    .from("recipe_outputs")
    .select("output_menu_item_id, recipes!inner(id, name, active)")
    .not("output_menu_item_id", "is", null)
    .eq("recipes.active", true)
    .returns<Array<{ output_menu_item_id: string; recipes: { id: string; name: string; active: boolean } }>>();
  if (oErr) throw new Error(`recipe_outputs: ${oErr.message}`);
  const producedBy = new Map((outRows ?? []).map((o) => [o.output_menu_item_id, o.recipes.name]));

  console.log(`\nSeed 31 — drink depletion links — ${EXECUTE ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Sales window quoted: 2026-08-07..2026-08-27 (21 days).\n`);

  // ── PHASE A — the weight basis ────────────────────────────────────────────
  console.log(`── PHASE A — weight basis (avg_oz_per_each) ${"─".repeat(38)}`);
  const basisNowSet = new Set<string>();
  let basisWritten = 0;
  for (const w of WEIGHT_BASIS) {
    const sku = skuByName.get(w.skuName);
    if (!sku) { console.log(`  ✗ ${w.skuName} — SKU NOT FOUND, skipped.`); continue; }
    if (sku.avg_oz_per_each != null) {
      console.log(`  ✗ ${w.skuName} — avg_oz_per_each already ${sku.avg_oz_per_each}, REFUSED (repairs go through the SKU admin).`);
      basisNowSet.add(w.skuName);
      continue;
    }
    if (sku.each_measure !== "fl oz") {
      console.log(`  ✗ ${w.skuName} — each_measure is '${sku.each_measure ?? "∅"}', not 'fl oz', REFUSED (the 1 oz/fl oz convention does not apply).`);
      continue;
    }
    if (chained.has(sku.id)) {
      console.log(`  ✗ ${w.skuName} — has an ACTIVE pack chain, REFUSED (the chain wins; a flat avg beside it is a second opinion).`);
      continue;
    }
    const packOz = sku.units_per_pack != null && sku.each_size != null
      ? Number(sku.units_per_pack) * Number(sku.each_size) * w.avgOzPerEach
      : null;
    console.log(`  ✓ ${w.skuName} — avg_oz_per_each ∅ → ${w.avgOzPerEach}   (pack now resolves to ${packOz ?? "?"} oz)`);
    basisNowSet.add(w.skuName);
    if (!EXECUTE) continue;

    const { error: uErr, count } = await sb.from("vendor_items")
      .update({ avg_oz_per_each: w.avgOzPerEach }, { count: "exact" })
      .eq("id", sku.id)
      // Re-assert the precondition in the WHERE so a concurrent fill is never
      // silently overwritten (UPDATE denials are silent -> count check).
      .is("avg_oz_per_each", null);
    if (uErr) throw new Error(`${w.skuName} update: ${uErr.message}`);
    if (count === 0) throw new Error(`${w.skuName}: UPDATE matched 0 rows (avg_oz_per_each filled concurrently?)`);
    basisWritten++;
    await audit({
      actorId: null, actorRole: null,
      action: "vendor_item.update", resourceTable: "vendor_items", resourceId: sku.id,
      metadata: {
        source: PHASE, provenance: w.provenance, field: "avg_oz_per_each",
        before: null, after: w.avgOzPerEach, pack_resolves_to_oz: packOz,
        reason: "beverage depletion requires a volume->oz basis; recipe-math ignores to_base_factor for volume by design",
      },
      ipAddress: null, userAgent: null,
    });
  }

  // ── PHASE B — the 1:1 links ───────────────────────────────────────────────
  console.log(`\n── PHASE B — 1:1 menu_item → SKU recipes ${"─".repeat(35)}`);
  let created = 0, refused = 0;
  for (const l of LINKS) {
    const menuItemId = menuByName.get(l.menuItemName);
    const sku = skuByName.get(l.skuName);
    if (!menuItemId) { console.log(`  ✗ ${l.menuItemName} — MENU ITEM NOT FOUND, skipped.`); refused++; continue; }
    if (!sku) { console.log(`  ✗ ${l.menuItemName} — SKU '${l.skuName}' NOT FOUND, skipped.`); refused++; continue; }

    const existing = producedBy.get(menuItemId);
    if (existing != null) {
      console.log(`  ✗ ${l.menuItemName} — already produced by active recipe '${existing}', REFUSED (never a second producer).`);
      refused++;
      continue;
    }
    // The guard this seed exists for: no weight basis => the flatten poisons to
    // empty and the recipe would deplete ZERO while looking finished.
    const hasBasis = sku.avg_oz_per_each != null || basisNowSet.has(l.skuName);
    if (!hasBasis) {
      console.log(`  ✗ ${l.menuItemName} — SKU '${l.skuName}' has NO weight basis, REFUSED (would deplete 0 oz).`);
      refused++;
      continue;
    }

    const recipeName = `${l.menuItemName} (build)`;
    console.log(`  ✓ ${l.menuItemName}  ←  ${l.quantity} ${l.unit} of '${l.skuName}'   [${l.containerLabel}]`);
    console.log(`      recipe: "${recipeName}"  ·  direct_oz per unit sold = ${l.quantity}`);
    console.log(`      ${l.note}`);
    created++;
    if (!EXECUTE) continue;

    const { data: rec, error: rErr } = await sb.from("recipes").insert({
      name: recipeName,
      recipe_type: "consumer",
      batch_yield: 1,
      directions: `Hand over one ${l.containerLabel}. Resale item — no prep. (Depletion link for ${l.menuItemName}: one ${l.containerLabel} = ${l.quantity} ${l.unit} of ${l.skuName}.)`,
      active: true,
      created_by: null,
      notes: `[seed ${PHASE}] ${l.note}`,
    }).select("id").single<{ id: string }>();
    if (rErr) throw new Error(`insert recipe ${recipeName}: ${rErr.message}`);

    const { error: oIErr } = await sb.from("recipe_outputs").insert({
      recipe_id: rec.id, output_item_id: null, output_menu_item_id: menuItemId,
      yield: 1, output_container_label: l.containerLabel, display_order: 0, created_by: null,
    });
    if (oIErr) throw new Error(`insert recipe_output ${recipeName}: ${oIErr.message}`);

    const { error: iErr } = await sb.from("recipe_inputs").insert({
      recipe_id: rec.id, component_sku_id: sku.id, component_item_id: null, component_product_id: null,
      quantity: l.quantity, unit: l.unit, portioned: false, display_order: 0, created_by: null,
    });
    if (iErr) throw new Error(`insert recipe_input ${recipeName}: ${iErr.message}`);

    producedBy.set(menuItemId, recipeName); // keep the refusal guard true within this run
    await audit({
      actorId: null, actorRole: null,
      action: "recipe.create", resourceTable: "recipes", resourceId: rec.id,
      metadata: {
        source: PHASE, name: recipeName, recipe_type: "consumer",
        output_menu_item: l.menuItemName, output_menu_item_id: menuItemId,
        input_sku: l.skuName, input_sku_id: sku.id,
        quantity: l.quantity, unit: l.unit, container_label: l.containerLabel,
        direct_oz_per_unit_sold: l.quantity,
        creation_method: "seed_script", provenance: l.note,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // ── The rest of the recon, reported every run ─────────────────────────────
  console.log(`\n── HELD — ambiguous, a question not a guess (${HELD.length}) ${"─".repeat(20)}`);
  for (const h of HELD) console.log(`  ⏸ ${h.what}  [${h.qty21}]\n      ${h.question}\n`);

  console.log(`── NEEDS CROSSWALK, not a recipe (${NEEDS_CROSSWALK.length}) ${"─".repeat(28)}`);
  for (const n of NEEDS_CROSSWALK) console.log(`  → ${n.toastName}  (${n.qty21}/21d)  ⇒ ${n.target}`);

  console.log(`\n── NEEDS A SKU FIRST, not a recipe (${NEEDS_SKU.length}) ${"─".repeat(26)}`);
  for (const n of NEEDS_SKU) console.log(`  → ${n.menuItem}  (${n.qty21}/21d)  ${n.note}`);

  console.log(
    `\nSUMMARY: ${created} link(s) ${EXECUTE ? "created" : "would be created"}, ${refused} refused, ` +
    `${basisNowSet.size} SKU(s) with a weight basis (${EXECUTE ? `${basisWritten} written` : "dry run"}), ` +
    `${HELD.length} held, ${NEEDS_CROSSWALK.length} need a crosswalk, ${NEEDS_SKU.length} need a SKU.`,
  );
  console.log(EXECUTE ? "\nWRITTEN.\n" : "\nNothing written (dry run).\n");
}

main().catch((e) => { console.error(e); process.exit(1); });

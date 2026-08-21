/**
 * Seed 25 — Phase 4 of the product-identity arc: move recipe pins from a VENDOR'S
 * SKU to the PRODUCT, behind a live-computed oz-parity refusal gate.
 *
 * Plan: docs/superpowers/plans/2026-08-20-product-identity.md Phase 4 (Tasks 4.1-4.4).
 * Spec: docs/superpowers/specs/2026-08-20-product-identity-design.md §3.
 * Gate:  🔒 S2 — `--execute` belongs to the LEAD, after Juan's eyeball. A build agent
 *        runs the dry run and nothing else.
 *
 * ── WHY THIS PHASE EXISTS, AND WHY IT COMES LAST ──────────────────────────────
 * Phase 3 shipped the reader (`loadRecipeGraph` → `loadProductIndex` → the ONE ladder
 * `resolveProductMember` → `productInputBasis`) DORMANT: zero `recipe_inputs` rows name
 * a product, so every board is byte-identical to before. This phase is the data gate
 * that LIGHTS it. Deviation D1 is exactly this ordering — re-pointing before the reader
 * exists does not shift a number, it DELETES one.
 *
 * ── JUAN'S WEIGH RULING (2026-08-21) — §2 OF THIS SEED ────────────────────────
 * The first dry run refused SIX lines as PRODUCT_UNWEIGHED, on the reading that the
 * members' `avg_oz_per_each` values were seed-10 ESTIMATES. Juan's ruling corrects the
 * premise, verbatim: *"i think there is an issue here, because i literally weighted all
 * of that... like extensively, it wasnt just the ham and stuff... and you got it all."*
 * Those numbers are his own extensive surprise-weigh MEASUREMENTS. Turkey 1.0 · Roast
 * Beef 1.5 · Sweet Peppers 4.0 · Hot Peppers 1.0 · Fresh Mozzarella 1.0 · Iceberg 20 oz
 * per head. So the seed now runs a `products.unit_oz` FILL step BEFORE the gate: each
 * ruled product takes its ACTIVE member's measured value, class OPERATIONAL, with a
 * source note quoting the ruling and naming the member the number came off.
 *
 * The fill is DERIVED LIVE and CROSS-CHECKED against the ruling, never copied from it:
 * a product whose active members carry no weight, or carry DIFFERENT weights, or whose
 * live value does not match the ruled one, REFUSES its fill and says why. A weight is a
 * ruling, not an average. The ruling is also the ceiling — a product the ruling does not
 * name is never filled, even if the live data would support one (Banana Peppers).
 *
 * Once a product owns `unit_oz`, `productInputBasis` reads THAT number and never the
 * resolved member's, so the line is member-INDEPENDENT and the parity gate below
 * evaluates it on the merits. Iceberg is the sharpest case and is deliberately INCLUDED:
 * its other two members carry NULL, and that no longer matters — the PRODUCT owns the
 * weight now, which is the entire point of the column.
 *
 * ── THE GATE (Task 4.2 — the task that matters) ───────────────────────────────
 * Nothing is re-pointed on faith. For every candidate line the script computes the
 * line's ounces TWICE, through the REAL production function `ozForRecipeInput`
 * (lib/recipe-math.ts — the same call `lib/prep-consumption-graph.ts productLineOz`
 * makes), against:
 *   (a) BEFORE — the currently pinned SKU's live shape, pack chain and all;
 *   (b) AFTER  — `productInputBasis(product, resolvedMember)`, the measure-only basis
 *                a product pin resolves through (deviation D3).
 * The pin moves only when the two agree within 1e-9. This is seed 18's gate
 * generalized: *"The gate is a live computation through the real production function,
 * not a hardcoded refusal."*
 *
 * ── THE REFUSAL CODES, AND WHY EACH ONE IS A FEATURE ──────────────────────────
 *   PRODUCT_UNWEIGHED  the line's oz DEPENDS on `avg_oz_per_each` (a count- or
 *                      volume-denominated unit) and the product has no `unit_oz`. The
 *                      basis then FALLS BACK to the resolved member's own weight — so
 *                      the line means one thing today and another the day the ladder
 *                      answers the other member. The numbers can agree perfectly right
 *                      now and the refusal still stands: what is being refused is the
 *                      member-DEPENDENCE, not the arithmetic. Unblock: weigh it
 *                      (Phase 6) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ.
 *   MEMBERS_DISAGREE   the sharper diagnosis of the same condition — the active members
 *                      do not even agree on what one unit weighs
 *                      (`membersDisagreeOnUnitOz`), so a flip would visibly move the
 *                      number. Unblock: rule on the weight.
 *   PACK_LABEL_LINE    the unit is a pack/chain label. "1 case" of Baldor ham and "1
 *                      case" of PFG ham are different masses and a product pin has no
 *                      honest way to choose (D3). ZERO such units exist live (the unit
 *                      census is oz/each/unit + the measure-registry tail), so this is a
 *                      BACKSTOP, not a blocker — kept because the census can change and
 *                      the failure would otherwise be silent.
 *   OZ_WOULD_MOVE      the two computations disagree, or either side refuses to resolve
 *                      at all. NEVER widen the tolerance; reconcile the numbers.
 *   NO_PRODUCT         the pinned SKU is an implicit singleton. Correct and expected for
 *                      ~95% of the catalog; counted, never treated as a fault.
 *   RETIRED_RECIPE     the row hangs off an INACTIVE recipe. `loadRecipeGraph` filters
 *                      `recipes.active = true` (multi-vendor audit P5), so nothing reads
 *                      the row and no post-move verification through the real loader can
 *                      prove anything about it. Reported with its numbers, never written.
 *
 * ── WHAT A PASSING LINE IS GUARANTEED TO BE ───────────────────────────────────
 * Every line that passes is MEMBER-INDEPENDENT by construction, which is the arc's whole
 * thesis: either it is weight-denominated (the measure registry decides the oz and
 * `avg_oz_per_each` never enters), or the product carries its own `unit_oz`. The
 * failover section proves it rather than asserting it — each member is forced inactive
 * in turn and the line is re-resolved through the same functions.
 *
 * ── INVARIANTS (the seed-18 / seed-24 set) ────────────────────────────────────
 *   · every fact re-read LIVE at run time; nothing is copied from a plan table.
 *   · identity pre-flight: a recipe/SKU/product name drift is FATAL, not a guess.
 *   · re-read before every UPDATE; `quantity`/`unit` moved under us → FATAL.
 *   · `{ count: "exact" }` + `if (!count) throw` on every UPDATE (silent-UPDATE law).
 *   · orderability assertion: `active` / `weekday_par` / `weekend_par` snapshotted on
 *     every member SKU and re-read afterwards — this seed must never move them.
 *   · idempotent: a row already product-pinned is not a candidate; the notes stanza is
 *     prefix-filtered so a re-run replaces its own line instead of stacking a second.
 *   · dry-run by DEFAULT; `--execute` is gate S2.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/25-repoint-recipe-pins.ts
 *        → DRY RUN (default). Writes nothing.
 *      … --markdown   → the same run rendered as the committed dry-run page.
 *      … --execute    → WRITES. GATE S2, LEAD ONLY.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadMeasures, loadSkuPackChains, loadRecipeGraph } from "@/lib/prep-consumption";
import {
  ozForRecipeInput,
  type MeasureUnitFactor,
  type RecipeInputSku,
} from "@/lib/recipe-math";
import {
  membersDisagreeOnUnitOz,
  productInputBasis,
  resolveProductMember,
  type ProductMember,
} from "@/lib/products-shared";
import { loadProductIndex, type ProductIndexEntry } from "@/lib/products";
import {
  perUnitSkuOzForItemFromGraph,
  perUnitSkuOzForMenuItemFromGraph,
  type GraphInput,
  type GraphRecipe,
  type ProductIndex,
  type RecipeGraph,
} from "@/lib/prep-consumption-graph";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { pathToFileURL } from "node:url";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

const SCRIPT = "scripts/seed/25-repoint-recipe-pins.ts";
const SOURCE_REPORT = "docs/seed/source/pin-repoint-dryrun.md";
const PHASE = "product_identity";
const SOURCE_KEY = "product-identity-2026-08-20";
const NOTE_PREFIX = `[product-pin ${SOURCE_KEY}]`;
const DECISION_SOURCES =
  "docs/superpowers/specs/2026-08-20-product-identity-design.md §3 · " +
  "docs/superpowers/plans/2026-08-20-product-identity.md Phase 4 (D1, D3) · " +
  "docs/seed/source/product-identity-dryrun.md (seed 24, gate S1) · " +
  "scripts/seed/18-twin-adjudication.ts (the gate this one generalizes)";

/** Equality, not "close enough to a rounding". Seed 18's number, deliberately kept. */
const TOLERANCE = 1e-9;

/** Juan's ruling, verbatim enough to survive in an audit row a year from now. */
const WEIGH_RULING =
  'Juan 2026-08-21, verbatim: "i think there is an issue here, because i literally weighted all of that... ' +
  'like extensively, it wasnt just the ham and stuff... and you got it all." The avg_oz_per_each values on these ' +
  "products' ACTIVE members are his own extensive surprise-weigh MEASUREMENTS — not seed estimates, not spec sheets. " +
  "Ruled at the PRODUCT grain: what one unit weighs is a fact about the product, not about which vendor sells it.";

/**
 * The products the ruling covers, with the member value each is expected to carry.
 *
 * This list is the CEILING, not the source. Every value is re-derived live from the
 * ACTIVE members below; this table only decides WHICH products may be filled and gives
 * the derivation something to disagree with. A live value that does not match the ruled
 * one REFUSES the fill — the seed-24 "has the ground moved under the source document"
 * discipline, applied to a ruling instead of a report.
 */
const RULED_UNIT_OZ: ReadonlyArray<{ product: string; ruledOz: number; note: string }> = [
  { product: "Turkey", ruledOz: 1, note: "sliced turkey, one slice" },
  { product: "Roast Beef", ruledOz: 1.5, note: "sliced roast beef, one slice" },
  { product: "Sweet Peppers", ruledOz: 4, note: "sweet peppers, one portion" },
  { product: "Hot Peppers", ruledOz: 1, note: "hot peppers, one portion" },
  { product: "Fresh Mozzarella", ruledOz: 1, note: "fresh mozzarella, one slice (both members agree)" },
  { product: "Iceberg", ruledOz: 20, note: "iceberg, ONE HEAD — Juan's number; the other members' NULLs no longer matter once the PRODUCT owns the weight" },
];

// ── Output helpers (seed 21/24's idiom — ONE writer for both renderings) ───────

function h(level: number, text: string): void {
  console.log(
    MD
      ? `\n${"#".repeat(level)} ${text}\n`
      : `\n${"─".repeat(3)} ${text.toUpperCase()} ${"─".repeat(Math.max(3, 70 - text.length))}\n`,
  );
}
function p(text = ""): void {
  console.log(text);
}
function pre(): void {
  if (MD) console.log("```");
}
function table(head: string[], rows: string[][], align: string[] = []): void {
  if (rows.length === 0) {
    p(MD ? "_(none)_" : "  (none)");
    return;
  }
  if (MD) {
    // A bare `|` inside a cell silently shears the row into the wrong columns, and
    // pack descriptors legitimately contain one (seed 24's fix, carried).
    const cell = (s: string) => (s ?? "").replace(/\|/g, "\\|");
    p(`| ${head.map(cell).join(" | ")} |`);
    p(`|${head.map((_, i) => (align[i] === "r" ? "---:" : "---")).join("|")}|`);
    for (const r of rows) p(`| ${r.map(cell).join(" | ")} |`);
    return;
  }
  const w = head.map((hd, i) => Math.max(hd.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (c: string[]) => c.map((x, i) => (x ?? "").padEnd(w[i]!)).join("  ");
  p(line(head));
  p(w.map((x) => "-".repeat(x)).join("  "));
  for (const r of rows) p(line(r));
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
/** Round for DISPLAY only — every comparison runs on the raw float. */
const ozStr = (v: number | null) => (v == null ? "**UNRESOLVED**" : `${Number(v.toFixed(6))}`);
const plain = (s: string) => (MD ? s : s.replace(/\*\*/g, ""));

// ── Live shapes ───────────────────────────────────────────────────────────────

type Sb = ReturnType<typeof getServiceRoleClient>;

interface LiveSku {
  id: string;
  name: string;
  vendorName: string;
  active: boolean;
  productId: string | null;
  weekdayPar: number | null;
  weekendPar: number | null;
  avgOzPerEach: number | null;
  /** The SKU's OWN shape, chain and all — the BEFORE side of the gate. */
  shape: RecipeInputSku;
  chainLabels: string[];
}

interface LiveProduct {
  id: string;
  name: string;
  unitOz: number | null;
  unitOzClass: string | null;
  active: boolean;
}

interface LiveRow {
  id: string;
  recipeId: string;
  recipeName: string;
  recipeActive: boolean;
  recipeType: string | null;
  quantity: number;
  unit: string | null;
  portioned: boolean;
  componentSkuId: string | null;
  componentProductId: string | null;
  /** Output item / menu-item names for this recipe — the "<item>" of the notes stanza. */
  outputLabel: string;
}

interface Universe {
  rows: LiveRow[];
  skuById: Map<string, LiveSku>;
  productById: Map<string, LiveProduct>;
  memberSkuIds: Set<string>;
  locations: Array<{ id: string; name: string }>;
}

async function loadUniverse(sb: Sb, measures: Map<string, MeasureUnitFactor>): Promise<Universe> {
  const { data: skuRows, error: sErr } = await sb
    .from("vendor_items")
    .select(
      "id, name, active, product_id, weekday_par, weekend_par, avg_oz_per_each, pack_format, each_container_label, units_per_pack, each_size, each_measure, vendors(name)",
    )
    .returns<
      Array<{
        id: string;
        name: string;
        active: boolean | null;
        product_id: string | null;
        weekday_par: number | string | null;
        weekend_par: number | string | null;
        avg_oz_per_each: number | string | null;
        pack_format: string | null;
        each_container_label: string | null;
        units_per_pack: number | null;
        each_size: number | string | null;
        each_measure: string | null;
        vendors: { name: string } | null;
      }>
    >();
  if (sErr) throw new Error(`load vendor_items: ${sErr.message}`);
  if ((skuRows ?? []).length === 0) {
    throw new Error("FATAL: vendor_items loaded empty — refusing to reason about an empty catalog.");
  }

  const chains = await loadSkuPackChains((skuRows ?? []).map((r) => r.id));
  const skuById = new Map<string, LiveSku>();
  for (const r of skuRows ?? []) {
    const chain: PackChainLevel[] = chains.get(r.id) ?? [];
    skuById.set(r.id, {
      id: r.id,
      name: r.name,
      vendorName: r.vendors?.name ?? "(no vendor)",
      active: r.active ?? true,
      productId: r.product_id,
      weekdayPar: num(r.weekday_par),
      weekendPar: num(r.weekend_par),
      avgOzPerEach: num(r.avg_oz_per_each),
      shape: {
        packFormat: r.pack_format,
        eachContainerLabel: r.each_container_label,
        unitsPerPack: r.units_per_pack,
        eachSize: num(r.each_size),
        eachMeasure: r.each_measure,
        avgOzPerEach: num(r.avg_oz_per_each),
        packChain: chain.length > 0 ? chain : null,
      },
      chainLabels: chain.map((l) => l.label),
    });
  }

  const { data: productRows, error: pErr } = await sb
    .from("products")
    .select("id, name, unit_oz, unit_oz_class, active")
    .returns<Array<{ id: string; name: string; unit_oz: number | string | null; unit_oz_class: string | null; active: boolean | null }>>();
  if (pErr) throw new Error(`load products: ${pErr.message}`);
  const productById = new Map<string, LiveProduct>(
    (productRows ?? []).map((r) => [
      r.id,
      { id: r.id, name: r.name, unitOz: num(r.unit_oz), unitOzClass: r.unit_oz_class, active: r.active ?? true },
    ]),
  );

  const { data: inputRows, error: iErr } = await sb
    .from("recipe_inputs")
    .select(
      "id, recipe_id, quantity, unit, portioned, component_sku_id, component_product_id, recipes(name, active, recipe_type)",
    )
    .returns<
      Array<{
        id: string;
        recipe_id: string;
        quantity: number | string;
        unit: string | null;
        portioned: boolean | null;
        component_sku_id: string | null;
        component_product_id: string | null;
        recipes: { name: string; active: boolean | null; recipe_type: string | null } | null;
      }>
    >();
  if (iErr) throw new Error(`load recipe_inputs: ${iErr.message}`);

  // Output labels: the "<item>" the notes stanza names. Two batch lookups, never
  // per-recipe (the loadRecipeGraph law applied to a seed).
  const { data: outRows, error: oErr } = await sb
    .from("recipe_outputs")
    .select("recipe_id, output_item_id, output_menu_item_id")
    .returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null }>>();
  if (oErr) throw new Error(`load recipe_outputs: ${oErr.message}`);
  const itemIds = [...new Set((outRows ?? []).map((o) => o.output_item_id).filter((v): v is string => v != null))];
  const menuIds = [...new Set((outRows ?? []).map((o) => o.output_menu_item_id).filter((v): v is string => v != null))];
  const nameById = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data, error } = await sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`load items: ${error.message}`);
    for (const r of data ?? []) nameById.set(r.id, r.name);
  }
  if (menuIds.length > 0) {
    const { data, error } = await sb.from("menu_items").select("id, name").in("id", menuIds).returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`load menu_items: ${error.message}`);
    for (const r of data ?? []) nameById.set(r.id, r.name);
  }
  const outputsByRecipe = new Map<string, string[]>();
  for (const o of outRows ?? []) {
    const id = o.output_item_id ?? o.output_menu_item_id;
    if (id == null) continue;
    const list = outputsByRecipe.get(o.recipe_id) ?? [];
    const label = nameById.get(id);
    if (label != null && !list.includes(label)) list.push(label);
    outputsByRecipe.set(o.recipe_id, list);
  }

  const rows: LiveRow[] = (inputRows ?? []).map((r) => ({
    id: r.id,
    recipeId: r.recipe_id,
    recipeName: r.recipes?.name ?? "(recipe)",
    recipeActive: r.recipes?.active ?? false,
    recipeType: r.recipes?.recipe_type ?? null,
    quantity: num(r.quantity) ?? Number.NaN,
    unit: r.unit,
    portioned: r.portioned ?? false,
    componentSkuId: r.component_sku_id,
    componentProductId: r.component_product_id,
    outputLabel: (outputsByRecipe.get(r.recipe_id) ?? []).join(" + ") || (r.recipes?.name ?? "(recipe)"),
  }));

  const { data: locRows, error: lErr } = await sb.from("locations").select("id, name").returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`load locations: ${lErr.message}`);

  const memberSkuIds = new Set<string>();
  for (const s of skuById.values()) if (s.productId != null) memberSkuIds.add(s.id);

  // Membership must be PROVABLE, not assumed: a member naming a product row that does
  // not exist is a broken FK the gate would otherwise read as "no product".
  for (const s of skuById.values()) {
    if (s.productId != null && !productById.has(s.productId)) {
      throw new Error(
        `FATAL: SKU ${s.vendorName}/${s.name} [${s.id}] names product ${s.productId}, which does not exist. Refusing to reason about a broken membership.`,
      );
    }
  }

  return { rows, skuById, productById, memberSkuIds, locations: locRows ?? [] };
}

/** The pure resolver's view of a member, at one scope. `lastReceivedAt` comes from the
 *  REAL loader (loadProductIndex) — never re-derived here, so there is one opinion. */
function memberView(entry: ProductIndexEntry, skuId: string): ProductMember | null {
  return entry.members.find((m) => m.skuId === skuId) ?? null;
}

// ── The unit_oz fill (Juan's weigh ruling, 2026-08-21) ────────────────────────

interface UnitOzFill {
  product: LiveProduct;
  value: number;
  klass: "OPERATIONAL";
  /** vendor/SKU labels the measured value was read off, live. */
  measuredOn: string;
  activeSpread: string;
  sourceNote: string;
}

interface UnitOzSkip {
  productName: string;
  state: "already" | "refused";
  why: string;
}

/**
 * Plan one `products.unit_oz` fill per RULED product that still reads NULL, deriving the
 * value LIVE off its ACTIVE members and refusing anything the evidence does not carry.
 *
 * Four refusals, each named rather than silently skipped:
 *   · the ruling does not name this product   → never filled, even if derivable.
 *   · no ACTIVE member carries a weight        → nothing to carry (Banana Peppers).
 *   · active members carry DIFFERENT weights   → a weight is a ruling, not an average.
 *   · the live value ≠ the ruled value         → the ground moved under the ruling.
 *
 * A member with a NULL weight is an UNKNOWN, not a dissent (the `membersDisagreeOnUnitOz`
 * semantics, applied consistently): Iceberg's Sysco and Baldor NULLs do not block PFG's
 * measured 20, which is exactly what Juan ruled.
 */
function planUnitOzFills(
  products: ReadonlyArray<{ product: LiveProduct; entry: ProductIndexEntry }>,
): { fills: UnitOzFill[]; skips: UnitOzSkip[] } {
  const fills: UnitOzFill[] = [];
  const skips: UnitOzSkip[] = [];
  for (const { product, entry } of products) {
    const active = entry.members.filter((m) => m.active);
    const spread =
      active.map((m) => `${m.vendorName ?? "(no vendor)"} ${m.avgOzPerEach ?? "NULL"}`).join(" · ") || "(no active member)";

    if (product.unitOz != null) {
      skips.push({
        productName: product.name,
        state: "already",
        why: `already owns unit_oz = ${product.unitOz} (${product.unitOzClass ?? "unclassed"}) — seed 24 wrote it; not re-touched.`,
      });
      continue;
    }

    const ruled = RULED_UNIT_OZ.find((r) => r.product === product.name);
    if (ruled == null) {
      skips.push({
        productName: product.name,
        state: "refused",
        why: `Juan's 2026-08-21 ruling does not name this product, so no weight is written for it. Active members: ${spread}.`,
      });
      continue;
    }

    const known = active
      .map((m) => ({ label: `${m.vendorName ?? "(no vendor)"}/${m.name}`, oz: m.avgOzPerEach }))
      .filter((m): m is { label: string; oz: number } => m.oz != null && Number.isFinite(m.oz) && m.oz > 0);
    if (known.length === 0) {
      skips.push({
        productName: product.name,
        state: "refused",
        why: `no ACTIVE member carries an avg_oz_per_each, so there is no measured number to carry up to the product. Active members: ${spread}.`,
      });
      continue;
    }
    const distinct = [...new Set(known.map((m) => m.oz))];
    if (distinct.length > 1) {
      skips.push({
        productName: product.name,
        state: "refused",
        why: `the ACTIVE members carry DIFFERENT weights (${spread}) — a weight is a ruling, not an average, and this seed will not pick one. Rule on it, then re-run.`,
      });
      continue;
    }
    const value = distinct[0]!;
    if (Math.abs(value - ruled.ruledOz) > TOLERANCE) {
      skips.push({
        productName: product.name,
        state: "refused",
        why: `MOVED — the ruling records ${ruled.ruledOz} oz but the live active member reads ${value}. Refusing to write a number the ruling did not name; re-confirm with Juan, then re-run.`,
      });
      continue;
    }

    const measuredOn = known.map((m) => m.label).join(" · ");
    fills.push({
      product,
      value,
      klass: "OPERATIONAL",
      measuredOn,
      activeSpread: spread,
      sourceNote:
        `OPERATIONAL — ${value} oz (${ruled.note}). Read LIVE off ${measuredOn}'s avg_oz_per_each and ruled up to the ` +
        `PRODUCT grain. ${WEIGH_RULING} Written by ${SCRIPT} (Phase 4) so that a product-pinned recipe line is ` +
        "member-INDEPENDENT: lib/products-shared.ts productInputBasis reads THIS number, never the resolved member's, " +
        "so a vendor flip can no longer re-denominate the line.",
    });
  }
  return { fills, skips };
}

// ── The gate (Task 4.2) ───────────────────────────────────────────────────────

type Verdict = "PASS" | "PRODUCT_UNWEIGHED" | "MEMBERS_DISAGREE" | "PACK_LABEL_LINE" | "OZ_WOULD_MOVE" | "RETIRED_RECIPE";

interface Judged {
  row: LiveRow;
  sku: LiveSku;
  product: LiveProduct;
  entry: ProductIndexEntry;
  /** products.unit_oz as it will read AFTER this run's fill step — the number the gate,
   *  the failover proof and the projected graph all evaluate against. */
  effectiveUnitOz: number | null;
  /** True when `effectiveUnitOz` comes from THIS run's fill rather than the live column. */
  fillPending: boolean;
  /** The member the ladder answers for this product at the GLOBAL scope. */
  resolvedSkuId: string | null;
  resolvedLabel: string;
  rung: string;
  /** oz through the CURRENT pin's own live shape. */
  ozBefore: number | null;
  /** oz through productInputBasis(product, resolvedMember). */
  ozAfter: number | null;
  /** true when the line's oz depends on avg_oz_per_each (count/volume denominated). */
  countDenominated: boolean;
  dimension: string;
  verdict: Verdict;
  why: string;
  unblock: string;
}

const UNBLOCK: Record<Exclude<Verdict, "PASS">, string> = {
  PRODUCT_UNWEIGHED:
    "weigh it (Phase 6 weight board) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ, then re-run — this gate passes and the pin moves with no code change.",
  MEMBERS_DISAGREE: "rule on the weight: set `products.unit_oz` to the measured value, then re-run.",
  PACK_LABEL_LINE:
    "re-denominate the line in a MEASURE-REGISTRY unit first, as its own decision (deviation D3) — a pack label is a per-vendor spelling.",
  OZ_WOULD_MOVE: "reconcile the numbers. NEVER widen the tolerance.",
  RETIRED_RECIPE:
    "none needed — the row hangs off an inactive recipe that `loadRecipeGraph` does not read. Reactivate the recipe if it is meant to be live, then re-run.",
};

function judge(
  row: LiveRow,
  sku: LiveSku,
  product: LiveProduct,
  entry: ProductIndexEntry,
  measures: Map<string, MeasureUnitFactor>,
  /** The fill this run plans for this product, if any (Juan's weigh ruling). */
  fill: UnitOzFill | null,
): Judged {
  // The gate evaluates against the weight the product will OWN after this run's fill
  // step, because the fill and the re-point ship in the same execute and the fill runs
  // first. In dry run the verdict is therefore explicitly CONDITIONAL on that fill, and
  // the report says so rather than implying the column already reads it.
  const effectiveUnitOz = product.unitOz ?? fill?.value ?? null;
  const fillPending = product.unitOz == null && fill != null;
  const measure = row.unit == null ? undefined : measures.get(row.unit);
  const dimension = measure?.dimension ?? "(unregistered)";
  // The line's oz DEPENDS on avg_oz_per_each exactly when it converts through a
  // REGISTERED non-weight measure (lib/recipe-math ozPerMeasureUnit: weight →
  // toBaseFactor; count/volume → the avg). An UNREGISTERED unit is not
  // count-denominated — it does not convert at all, and saying otherwise would give the
  // reviewer a wrong reason. It falls to the parity gate, which refuses it honestly.
  const countDenominated = measure != null && measure.dimension !== "weight";

  const resolvedSkuId = entry.resolution.skuId;
  const resolvedMember = resolvedSkuId != null ? memberView(entry, resolvedSkuId) : null;
  const resolvedLabel =
    resolvedSkuId == null
      ? "(unresolved)"
      : `${resolvedMember?.vendorName ?? "(no vendor)"}/${product.name}`;

  // BOTH sides through the REAL production function. The AFTER basis is the one
  // lib/prep-consumption-graph productLineOz will use, built by the same call.
  const ozBefore = ozForRecipeInput(row.quantity, row.unit, sku.shape, measures);
  const basis = productInputBasis({ productId: product.id, unitOz: effectiveUnitOz }, resolvedMember);
  const ozAfter = ozForRecipeInput(row.quantity, row.unit, basis, measures);

  const base = {
    row, sku, product, entry, effectiveUnitOz, fillPending, resolvedSkuId, resolvedLabel,
    rung: entry.resolution.rung, ozBefore, ozAfter, countDenominated, dimension,
  };
  const refuse = (verdict: Exclude<Verdict, "PASS">, why: string): Judged => ({
    ...base, verdict, why, unblock: UNBLOCK[verdict],
  });

  // (0) A retired recipe is invisible to every reader. Reported, never written.
  if (!row.recipeActive) {
    return refuse(
      "RETIRED_RECIPE",
      `recipe "${row.recipeName}" is INACTIVE — \`loadRecipeGraph\` filters \`recipes.active = true\` (multi-vendor audit P5), so nothing reads this row and no post-move verification through the real loader could prove anything about it`,
    );
  }

  // (1) PACK_LABEL_LINE — a per-vendor spelling a product cannot own (D3). Checked
  //     BEFORE the arithmetic so the reviewer sees the CAUSE, not the symptom.
  if (row.unit != null && measure == null) {
    const isPackLabel =
      row.unit === sku.shape.packFormat ||
      row.unit === sku.shape.eachContainerLabel ||
      sku.chainLabels.includes(row.unit);
    if (isPackLabel) {
      return refuse(
        "PACK_LABEL_LINE",
        `unit "${row.unit}" is a PACK/CHAIN label on ${sku.vendorName}/${sku.name}, not a measure-registry unit — "1 ${row.unit}" of one vendor is not "1 ${row.unit}" of another, and a product pin has no honest way to choose (D3)`,
      );
    }
  }

  // (2) The member-dependence refusals. The numbers can agree PERFECTLY today and
  //     these still stand: what is refused is the DEPENDENCE, not the arithmetic.
  if (countDenominated && effectiveUnitOz == null) {
    const activeMembers = entry.members.filter((m) => m.active);
    const spread = activeMembers
      .map((m) => `${m.vendorName ?? "(no vendor)"} ${m.avgOzPerEach ?? "NULL"}`)
      .join(" · ");
    if (membersDisagreeOnUnitOz(entry.members)) {
      return refuse(
        "MEMBERS_DISAGREE",
        `the line is ${dimension}-denominated ("${row.unit}"), \`products.unit_oz\` is NULL, and the ACTIVE members do not agree on what one unit weighs (${spread}) — a member flip would visibly move this line`,
      );
    }
    return refuse(
      "PRODUCT_UNWEIGHED",
      `the line is ${dimension}-denominated ("${row.unit}"), so its oz reads through \`avg_oz_per_each\`, and \`products.unit_oz\` is NULL — the basis falls back to the RESOLVED MEMBER's own weight (${spread}), so the line would mean whatever the ladder answers that day`,
    );
  }

  // (3) The parity gate itself.
  if (ozBefore == null || ozAfter == null) {
    return refuse(
      "OZ_WOULD_MOVE",
      ozBefore == null && ozAfter == null
        ? `the line resolves to NULL on BOTH sides — unit "${row.unit ?? "(none)"}" converts through neither the pinned SKU's shape nor the product's measure-only basis, so there is no number to preserve`
        : ozBefore == null
          ? `the line does not resolve on the CURRENT pin either (${sku.vendorName}/${sku.name}) — nothing to preserve, so preservation cannot be proven`
          : `the line resolves to NULL through the product's measure-only basis (D3) while the current pin reads ${ozBefore} oz — moving it would not shift a number, it would DELETE one`,
    );
  }
  if (Math.abs(ozAfter - ozBefore) > TOLERANCE) {
    return refuse(
      "OZ_WOULD_MOVE",
      `the line's oz MEANING changes: ${ozBefore} → ${ozAfter} (delta ${ozAfter - ozBefore}, tolerance ${TOLERANCE})`,
    );
  }

  return {
    ...base,
    verdict: "PASS",
    why: countDenominated
      ? `${dimension}-denominated and the PRODUCT owns its own unit_oz (${effectiveUnitOz} oz, ` +
        `${fillPending ? `${"OPERATIONAL"} — filled by THIS run's §2 step` : product.unitOzClass ?? "unclassed"}) — ` +
        "the basis is member-INDEPENDENT by construction"
      : `weight-denominated ("${row.unit}") — the measure registry decides the oz and \`avg_oz_per_each\` never enters, so no member can move it`,
    unblock: "",
  };
}

// ── The projected graph (Task 4.4) ────────────────────────────────────────────

/**
 * Project the LIVE graph forward as if the passing lines had already moved — the same
 * pure engines, a rewritten pin. Deliberately built by REMAPPING the live loader's own
 * `byOutputItem` / `byOutputMenuItem` entries rather than re-indexing: `buildRecipeGraph`
 * is first-wins per output and re-indexing a re-collected recipe list could hand a
 * shadowed duplicate producer a different slot, which would show up as a phantom delta.
 */
function projectGraph(
  g: RecipeGraph,
  moves: ReadonlyArray<{ recipeId: string; skuId: string; quantity: number; unit: string | null; productId: string }>,
  products: ProductIndex,
): { graph: RecipeGraph; applied: number } {
  const byRecipe = new Map<string, typeof moves>();
  for (const m of moves) {
    const list = [...(byRecipe.get(m.recipeId) ?? [])];
    list.push(m);
    byRecipe.set(m.recipeId, list);
  }
  let applied = 0;
  const cloneById = new Map<string, GraphRecipe>();
  const cloneOf = (r: GraphRecipe): GraphRecipe => {
    const existing = cloneById.get(r.recipeId);
    if (existing) return existing;
    const wanted = byRecipe.get(r.recipeId) ?? [];
    const inputs: GraphInput[] = r.inputs.map((c) => {
      const hit = wanted.find(
        (m) => c.componentSkuId === m.skuId && c.quantity === m.quantity && c.unit === m.unit,
      );
      if (hit == null) return { ...c };
      applied += 1;
      return { ...c, componentSkuId: null, componentProductId: hit.productId };
    });
    const clone: GraphRecipe = { ...r, inputs, outputs: r.outputs.map((o) => ({ ...o })) };
    cloneById.set(r.recipeId, clone);
    return clone;
  };
  const byOutputItem = new Map<string, GraphRecipe>();
  for (const [k, r] of g.byOutputItem) byOutputItem.set(k, cloneOf(r));
  const byOutputMenuItem = new Map<string, GraphRecipe>();
  for (const [k, r] of g.byOutputMenuItem) byOutputMenuItem.set(k, cloneOf(r));
  return {
    graph: { byOutputItem, byOutputMenuItem, skuPack: g.skuPack, measures: g.measures, products },
    applied,
  };
}

/** Flatten EVERY node in a graph to its per-unit SKU-oz map — the universe-wide diff. */
function deriveAll(g: RecipeGraph): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const itemId of g.byOutputItem.keys()) out.set(`item:${itemId}`, perUnitSkuOzForItemFromGraph(g, itemId));
  for (const miId of g.byOutputMenuItem.keys()) out.set(`menu:${miId}`, perUnitSkuOzForMenuItemFromGraph(g, miId));
  return out;
}

interface NodeDelta {
  key: string;
  label: string;
  totalBefore: number;
  totalAfter: number;
  /** SKU keys whose oz changed, ADDED, or DISAPPEARED. */
  movedSkuIds: string[];
}

function diffDerived(
  before: Map<string, Map<string, number>>,
  after: Map<string, Map<string, number>>,
  labelOf: (key: string) => string,
): { deltas: NodeDelta[]; nodes: number } {
  const deltas: NodeDelta[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const k of keys) {
    const b = before.get(k) ?? new Map<string, number>();
    const a = after.get(k) ?? new Map<string, number>();
    const skus = new Set([...b.keys(), ...a.keys()]);
    const movedSkuIds: string[] = [];
    for (const s of skus) {
      const bv = b.get(s) ?? 0;
      const av = a.get(s) ?? 0;
      if (Math.abs(av - bv) > TOLERANCE) movedSkuIds.push(s);
    }
    const totalBefore = [...b.values()].reduce((x, y) => x + y, 0);
    const totalAfter = [...a.values()].reduce((x, y) => x + y, 0);
    if (movedSkuIds.length > 0 || Math.abs(totalAfter - totalBefore) > TOLERANCE) {
      deltas.push({ key: k, label: labelOf(k), totalBefore, totalAfter, movedSkuIds: movedSkuIds.sort() });
    }
  }
  return { deltas: deltas.sort((x, y) => x.label.localeCompare(y.label)), nodes: keys.size };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const seedMeta = (reason: string, extra: Record<string, unknown> = {}) => ({
  phase: PHASE,
  reason,
  script: SCRIPT,
  source_report: SOURCE_REPORT,
  actor_context: "seed",
  decision_sources: DECISION_SOURCES,
  ...extra,
});

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  if (MD) {
    p("# Pin re-point — seed 25 DRY RUN (Phase 4, gate S2)");
    p();
    p(
      EXECUTE
        ? "> **STATUS: EXECUTE MODE.** This run WRITES to `products.unit_oz`, `recipe_inputs` and `recipes.notes`."
        : "> **STATUS: NOTHING HAS BEEN WRITTEN.** This is the output of `scripts/seed/25-repoint-recipe-pins.ts` in " +
            "its default (dry-run) mode. The script writes only under an explicit `--execute` flag, which is " +
            "**gate S2** and belongs to the lead, after Juan's eyeball.",
    );
    p();
    p(
      `**Generated:** ${new Date().toISOString().slice(0, 10)}, against live prod (\`bgcvurheqzylyfehqgzh\`) with ` +
        "migrations through `0179_product_identity` applied and the Phase-2 product layer seeded (11 products / 23 " +
        "members / 11 primaries). Every recipe, pin, pack shape, product weight and ounce figure below was resolved " +
        "**live at run time** through the real production functions — nothing is copied from a plan table.",
    );
    p();
    p(
      "> **Revised after Juan's weigh ruling of 2026-08-21.** The first revision refused six lines as " +
        "`PRODUCT_UNWEIGHED`; his ruling establishes that those member weights are his own extensive measurements, " +
        "so this revision carries them up to the product grain first (§2) and the gate then evaluates every line on " +
        "the merits.",
    );
    p();
    p(`**Sources:** ${DECISION_SOURCES}`);
  } else {
    p(
      EXECUTE
        ? "══ EXECUTE MODE — this run WRITES to products.unit_oz / recipe_inputs / recipes.notes ══"
        : "══ DRY RUN (default) — no writes. Pass --execute to write (GATE S2: lead only). ══",
    );
    p(`\nSOURCES: ${DECISION_SOURCES}`);
  }

  const measures = await loadMeasures();
  if (measures.size === 0) {
    throw new Error("FATAL: measure_units loaded empty — every ounce figure below would be a guess.");
  }

  const uni = await loadUniverse(sb, measures);

  // ── §1 Discovery ───────────────────────────────────────────────────────────
  h(2, "1 — Discovery (computed live, this run)");

  const skuPinned = uni.rows.filter((r) => r.componentSkuId != null);
  const alreadyProduct = uni.rows.filter((r) => r.componentProductId != null);
  const candidates = skuPinned.filter((r) => uni.memberSkuIds.has(r.componentSkuId!));
  const singletons = skuPinned.filter((r) => !uni.memberSkuIds.has(r.componentSkuId!));

  p(
    plain(
      `${uni.rows.length} \`recipe_inputs\` rows live. **${candidates.length}** carry a pin on a SKU that belongs to a ` +
        `PRODUCT — that is the re-point universe, re-discovered here rather than assumed. ` +
        `${singletons.length} more are pinned to an implicit SINGLETON (\`NO_PRODUCT\` — correct and expected, not a fault), ` +
        `and ${alreadyProduct.length} already name a product.`,
    ),
  );
  p();
  table(
    ["population", "rows"],
    [
      ["`recipe_inputs` total", String(uni.rows.length)],
      ["SKU-pinned", String(skuPinned.length)],
      ["→ pinned to a PRODUCT MEMBER (the candidate set)", `**${candidates.length}**`],
      ["→ pinned to a singleton SKU (`NO_PRODUCT`)", String(singletons.length)],
      ["already product-pinned (idempotence: not re-touched)", String(alreadyProduct.length)],
      ["item-pinned / other", String(uni.rows.length - skuPinned.length - alreadyProduct.length)],
    ],
    ["", "r"],
  );
  p();
  p(
    plain(
      "> The unit census across every live `recipe_inputs` row is the reason `PACK_LABEL_LINE` is a **backstop, not a " +
        "blocker**: " +
        (() => {
          const census = new Map<string, number>();
          for (const r of uni.rows) census.set(String(r.unit), (census.get(String(r.unit)) ?? 0) + 1);
          const unregistered = [...census.entries()].filter(([u]) => u !== "null" && !measures.has(u));
          const inScope = unregistered.filter(([u]) => candidates.some((r) => r.unit === u));
          if (unregistered.length === 0) {
            return "**every** unit in use is a registered measure, so zero pack-label units exist.";
          }
          return (
            `${unregistered.length} unregistered unit spelling(s) exist repo-wide — ` +
            `${unregistered.map(([u, n]) => `\`${u}\` ×${n}`).join(", ")} — and ` +
            (inScope.length === 0
              ? "**none of them appears on a candidate line**, so the gate has nothing to refuse on. It stays as a backstop because the census can change and the failure would otherwise be silent."
              : `${inScope.length} of them appear(s) on a candidate line and are checked against the pinned SKU's own pack/chain labels in the table below.`)
          );
        })(),
    ),
  );

  // ── The product index, through the REAL loader ─────────────────────────────
  const productIds = [
    ...new Set(candidates.map((r) => uni.skuById.get(r.componentSkuId!)!.productId).filter((v): v is string => v != null)),
  ];
  const globalIndex = await loadProductIndex(productIds, null);

  // ── §2 The unit_oz fill (Juan's weigh ruling) ──────────────────────────────
  h(2, "2 — `products.unit_oz` fill (Juan's weigh ruling, 2026-08-21)");
  p(plain(`> ${WEIGH_RULING}`));
  p();
  p(
    plain(
      "The first dry run refused six lines as `PRODUCT_UNWEIGHED` on the reading that these members' " +
        "`avg_oz_per_each` values were seed estimates. Juan's ruling corrects the premise: they are his own " +
        "measurements. So each ruled product takes its ACTIVE member's measured value up to the PRODUCT grain — " +
        "**derived live and cross-checked against the ruling, never copied from it.** Once a product owns `unit_oz`, " +
        "`productInputBasis` reads THAT number and never the resolved member's, so the line becomes " +
        "member-INDEPENDENT and the gate below can evaluate it on the merits.",
    ),
  );
  p();

  const scopedProducts: Array<{ product: LiveProduct; entry: ProductIndexEntry }> = [];
  for (const pid of productIds) {
    const product = uni.productById.get(pid);
    const entry = globalIndex.byProduct.get(pid);
    if (product == null || entry == null) {
      throw new Error(
        `FATAL: product ${pid} is a member's product but the catalog or loadProductIndex has no entry — the resolution seam disagrees with the membership. Refusing.`,
      );
    }
    scopedProducts.push({ product, entry });
  }
  scopedProducts.sort((a, b) => a.product.name.localeCompare(b.product.name));
  const { fills, skips } = planUnitOzFills(scopedProducts);
  const fillByProduct = new Map(fills.map((f) => [f.product.id, f]));

  table(
    ["product", "unit_oz", "class", "read live off", "active members (avg_oz_per_each)", "ruled"],
    fills.map((f) => [
      f.product.name,
      `**${f.value}**`,
      f.klass,
      f.measuredOn,
      f.activeSpread,
      `✅ ${RULED_UNIT_OZ.find((r) => r.product === f.product.name)!.ruledOz} oz — matches`,
    ]),
    ["", "r", "", "", "", ""],
  );
  p();
  h(3, "2a — Products NOT filled, and why");
  table(
    ["product", "state", "why"],
    skips.map((s) => [s.productName, s.state === "already" ? "✅ already weighed" : "➖ not filled", s.why]),
  );
  p();
  p(
    plain(
      "> **A member with a NULL weight is an UNKNOWN, not a dissent** — the same semantics " +
        "`membersDisagreeOnUnitOz` uses. That is why **ICEBERG is filled at 20 oz per head** even though its Sysco " +
        "and Baldor members carry NULL: Juan measured the PFG head, and once the PRODUCT owns the weight the other " +
        "members' silence stops mattering. That is the entire reason the column exists. The refusals above are the " +
        "converse: a product the ruling does not name is never filled, and active members carrying DIFFERENT weights " +
        "would refuse outright — a weight is a ruling, not an average.",
    ),
  );

  // ── §3 The gate, line by line ──────────────────────────────────────────────
  h(2, "3 — The gate, line by line (oz computed through the real production functions)");
  p(
    plain(
      "For every candidate the line's ounces are computed **twice** — through `ozForRecipeInput` " +
        "(`lib/recipe-math.ts`), the same call `lib/prep-consumption-graph.ts productLineOz` makes — against (a) the " +
        "currently pinned SKU's live shape, pack chain and all, and (b) `productInputBasis(product, resolvedMember)`. " +
        `The pin moves only when the two agree within \`${TOLERANCE}\`. A reviewer can see that the number does not ` +
        "move without running anything. The `unit_oz` used is the one the product will own **after §2's fill**, " +
        "because the fill and the re-point ship in the same `--execute` and the fill runs first.",
    ),
  );
  p();

  const judged: Judged[] = [];
  for (const row of candidates) {
    const sku = uni.skuById.get(row.componentSkuId!)!;
    const product = uni.productById.get(sku.productId!)!;
    const entry = globalIndex.byProduct.get(product.id);
    if (entry == null) {
      throw new Error(
        `FATAL: product ${product.name} [${product.id}] is a member's product but loadProductIndex returned no entry — the resolution seam disagrees with the membership. Refusing.`,
      );
    }
    judged.push(judge(row, sku, product, entry, measures, fillByProduct.get(product.id) ?? null));
  }
  judged.sort((a, b) => a.row.recipeName.localeCompare(b.row.recipeName));

  table(
    ["recipe", "old pin (SKU@vendor)", "new pin (product)", "line", "oz before", "oz after", "verdict"],
    judged.map((j) => [
      `${j.row.recipeName}${j.row.recipeActive ? "" : " *(retired)*"}`,
      `${j.sku.vendorName}/${j.sku.name}`,
      `${j.product.name}${j.verdict === "PASS" ? ` → ${j.resolvedLabel}` : ""}`,
      `${j.row.quantity} ${j.row.unit ?? "(no unit)"}`,
      ozStr(j.ozBefore),
      ozStr(j.ozAfter),
      j.verdict === "PASS" ? "✅ **PASS**" : `⛔ **${j.verdict}**`,
    ]),
    ["", "", "", "", "r", "r", ""],
  );

  const passing = judged.filter((j) => j.verdict === "PASS");
  const refused = judged.filter((j) => j.verdict !== "PASS");

  p();
  p(
    plain(
      `**Parity proof: ${passing.length} of ${judged.length} lines pass, and on every one of them \`oz before\` and ` +
        `\`oz after\` are the SAME NUMBER** (max observed delta ` +
        `${passing.length === 0 ? "n/a" : Math.max(...passing.map((j) => Math.abs((j.ozAfter ?? 0) - (j.ozBefore ?? 0))))}` +
        `, tolerance \`${TOLERANCE}\`). ${refused.length} refuse.`,
    ),
  );

  h(3, "3a — Why each PASSING line is safe");
  table(
    ["recipe", "product", "unit", "dimension", "product unit_oz", "why it is member-independent"],
    passing.map((j) => [
      j.row.recipeName,
      j.product.name,
      j.row.unit ?? "(none)",
      j.dimension,
      j.effectiveUnitOz == null
        ? "— *(not needed)*"
        : `${j.effectiveUnitOz} (${j.fillPending ? "OPERATIONAL — filled this run" : j.product.unitOzClass ?? "unclassed"})`,
      j.why,
    ]),
  );

  h(3, "3b — Every REFUSAL, with its unblock");
  if (refused.length === 0) {
    p(MD ? "_(none — every candidate passes.)_" : "  (none)");
  } else {
    table(
      ["recipe", "old pin", "product", "line", "oz before", "oz after", "code", "why", "unblock"],
      refused.map((j) => [
        j.row.recipeName,
        `${j.sku.vendorName}/${j.sku.name}`,
        j.product.name,
        `${j.row.quantity} ${j.row.unit ?? "(no unit)"}`,
        ozStr(j.ozBefore),
        ozStr(j.ozAfter),
        `**${j.verdict}**`,
        j.why,
        j.unblock,
      ]),
      ["", "", "", "", "r", "r", "", "", ""],
    );
    p();
    p(
      plain(
        "> **A refusal is the script working.** Seed 18 refused its own pin move on exactly this gate and said so: " +
          "*\"re-running this script afterwards passes the gate and moves the pins with no code change.\"* Note what " +
          "the `PRODUCT_UNWEIGHED` rows have in common: their `oz before` and `oz after` are **identical today**. The " +
          "refusal is not about the arithmetic — it is about the DEPENDENCE. With `products.unit_oz` NULL the basis " +
          "falls back to whichever member the ladder answers, so the number is only correct until the day the ladder " +
          "answers differently. That is precisely the silent re-denomination the whole `unit_oz` column exists to " +
          "prevent, and it is why the honest move is to fix the input, not the gate.",
      ),
    );
  }

  const byCode = new Map<string, number>();
  for (const j of refused) byCode.set(j.verdict, (byCode.get(j.verdict) ?? 0) + 1);
  p();
  table(
    ["verdict", "lines"],
    [
      ["✅ PASS — will re-point", String(passing.length)],
      ...[...byCode.entries()].sort().map(([c, n]) => [`⛔ ${c}`, String(n)] as string[]),
      ["ℹ️ NO_PRODUCT (singleton pins, out of universe)", String(singletons.length)],
    ],
    ["", "r"],
  );

  // ── §3 Failover proof (Task 4.4, second half) ──────────────────────────────
  h(2, "4 — Failover proof: the arc's thesis, on real data");
  p(
    plain(
      "For every product a line would move to, each member is forced INACTIVE in turn and the line is re-resolved " +
        "through the same `resolveProductMember` → `productInputBasis` → `ozForRecipeInput` chain. This is what the " +
        "whole arc is for: a vendor going down must route demand to the backup **without moving the number**.",
    ),
  );
  p();
  const failoverRows: string[][] = [];
  let failoverFailures = 0;
  let reroutes = 0;
  let allDown = 0;
  for (const j of passing) {
    const members = j.entry.members;
    for (const forced of members) {
      const flipped = members.map((m) => (m.skuId === forced.skuId ? { ...m, active: false } : m));
      const res = resolveProductMember({
        productId: j.product.id,
        // The probe forces one MEMBER down; the product itself is whatever the
        // live index says it is. Hardcoding true here would let the probe pass on
        // a retired product that refuses in production (rung 0, 2026-08-21).
        active: j.entry.active,
        primarySkuId: j.entry.primarySkuId,
        members: flipped,
      });
      const rm = res.skuId != null ? flipped.find((m) => m.skuId === res.skuId) ?? null : null;
      // MIRROR lib/prep-consumption-graph.ts productLineOz EXACTLY: an unresolved
      // product REFUSES the line — it does not fall through to the basis. Computing an
      // ounce figure here would claim a number the real engine never produces.
      const oz =
        res.skuId == null
          ? null
          : ozForRecipeInput(
              j.row.quantity,
              j.row.unit,
              productInputBasis({ productId: j.product.id, unitOz: j.effectiveUnitOz }, rm),
              measures,
            );
      let verdict: string;
      if (res.skuId == null) {
        // Every member down. `unresolved` is the honest posture, not a regression:
        // there is nothing to order and the flatten poisons rather than guessing.
        allDown += 1;
        verdict = "➖ all members down → honest `unresolved`";
      } else if (oz != null && j.ozAfter != null && Math.abs(oz - j.ozAfter) <= TOLERANCE) {
        reroutes += 1;
        verdict = "✅ rerouted, same oz";
      } else {
        failoverFailures += 1;
        verdict = "❌ **MOVED**";
      }
      failoverRows.push([
        j.row.recipeName,
        j.product.name,
        `${forced.vendorName ?? "(no vendor)"} forced INACTIVE`,
        res.skuId == null ? "**unresolved** *(no active member left)*" : `${rm?.vendorName ?? "(no vendor)"} (rung ${res.rung})`,
        res.skuId == null ? "— *(refused)*" : ozStr(oz),
        verdict,
      ]);
    }
  }
  table(
    ["recipe", "product", "scenario", "resolves to", "oz", "verdict"],
    failoverRows,
    ["", "", "", "", "r", ""],
  );
  p();
  p(
    plain(
      failoverFailures === 0
        ? `**PASS — 0 of ${failoverRows.length} failover scenarios move a line's ounces.** ${reroutes} scenario(s) ` +
            "genuinely REROUTE to a backup member and land on the identical number — that is the arc's thesis, " +
            `demonstrated on real data. The other ${allDown} take the product's LAST active member away, and those ` +
            "resolve to `unresolved` **by design**: `productLineOz` refuses rather than guessing, so the flatten " +
            "poisons to the honest `unresolved` status exactly as it does for an unknown SKU pack. Every passing line " +
            "is member-independent by construction — it is either weight-denominated (the measure registry decides " +
            "and `avg_oz_per_each` never enters) or the PRODUCT owns its own `unit_oz`."
        : `**FAIL — ${failoverFailures} of ${failoverRows.length} failover scenarios MOVE the line's ounces.** This ` +
            "contradicts the gate and must be reconciled before anything is executed.",
    ),
  );
  if (failoverFailures > 0) {
    throw new Error(
      `FATAL: ${failoverFailures} failover scenario(s) move a passing line's ounces. The gate and the failover proof disagree — refusing to go further.`,
    );
  }

  // Per-location sanity: with unit_oz owned by the product (or a weight unit), the
  // basis cannot vary by shop. Prove it rather than assert it — D7 lets each location
  // resolve its own primary, and a per-location primary row would be invisible here
  // otherwise.
  h(3, "4a — Per-location resolution (deviation D7)");
  const locRows: string[][] = [];
  for (const loc of uni.locations) {
    const idx = await loadProductIndex(productIds, loc.id);
    for (const j of passing) {
      const e = idx.byProduct.get(j.product.id);
      if (e == null) continue;
      const rm = e.resolution.skuId != null ? memberView(e, e.resolution.skuId) : null;
      // Same mirror of productLineOz: unresolved REFUSES; it never falls through.
      const oz =
        e.resolution.skuId == null
          ? null
          : ozForRecipeInput(
              j.row.quantity,
              j.row.unit,
              // e.unitOz is the LIVE column; §2's fill has not landed in dry run, so the
              // effective value is what a post-fill read would return. Assert the two agree
              // wherever the column IS already populated, so a divergence cannot hide here.
              productInputBasis({ productId: j.product.id, unitOz: e.unitOz ?? j.effectiveUnitOz }, rm),
              measures,
            );
      if (e.unitOz != null && j.effectiveUnitOz != null && Math.abs(e.unitOz - j.effectiveUnitOz) > TOLERANCE) {
        throw new Error(
          `FATAL: ${j.product.name} reads unit_oz ${e.unitOz} at ${loc.name} but the gate evaluated ${j.effectiveUnitOz}. Refusing.`,
        );
      }
      const same = oz != null && j.ozAfter != null && Math.abs(oz - j.ozAfter) <= TOLERANCE;
      if (!same) {
        throw new Error(
          `FATAL: ${j.row.recipeName} resolves to ${oz == null ? "UNRESOLVED" : `${oz} oz`} at ${loc.name} but ${j.ozAfter} oz globally — a passing line must be location-independent. The per-location activation overlay or a location-specific primary row has changed the answer; refusing.`,
        );
      }
      locRows.push([
        loc.name,
        j.row.recipeName,
        j.product.name,
        `${rm?.vendorName ?? "(no vendor)"} (rung ${e.resolution.rung}${e.primaryIsLocationSpecific ? ", LOCATION row" : ", global row"})`,
        ozStr(oz),
        "✅ same oz",
      ]);
    }
  }
  table(["location", "recipe", "product", "resolves to", "oz", "verdict"], locRows, ["", "", "", "", "r", ""]);

  // ── §4 Post-move verification through loadRecipeGraph (Task 4.4) ───────────
  h(2, "5 — Post-move verification: the whole flatten, re-derived");
  p(
    plain(
      "The per-unit SKU-oz map is re-derived for **every node in the graph** — not only the touched ones — through " +
        "`perUnitSkuOzForItemFromGraph` / `perUnitSkuOzForMenuItemFromGraph`, before and after. The AFTER graph is the " +
        "live graph with the passing pins rewritten and the real `loadProductIndex` merged in, so the product path " +
        "(`productLineOz`) is genuinely exercised. **Zero deltas is the pass condition.**",
    ),
  );
  p();

  const graphBefore = await loadRecipeGraph();
  const moves = passing.map((j) => ({
    recipeId: j.row.recipeId,
    skuId: j.sku.id,
    quantity: j.row.quantity,
    unit: j.row.unit,
    productId: j.product.id,
  }));
  // The live index built each basis from the LIVE unit_oz, which is still NULL for every
  // product §2 will fill. Rebuild the basis map against the EFFECTIVE weight, through the
  // same pure productInputBasis, so the projection models the post-fill world rather than
  // the pre-fill one. The resolution map is untouched — the ladder's answer does not move.
  const effectiveIndex: ProductIndex = {
    resolution: globalIndex.index.resolution,
    basis: new Map(
      [...globalIndex.byProduct].map(([pid, e]) => {
        const eff = e.unitOz ?? fillByProduct.get(pid)?.value ?? null;
        const rm = e.resolution.skuId != null ? e.members.find((m) => m.skuId === e.resolution.skuId) ?? null : null;
        return [pid, productInputBasis({ productId: pid, unitOz: eff }, rm)] as const;
      }),
    ),
  };
  const { graph: graphAfter, applied } = projectGraph(graphBefore, moves, effectiveIndex);
  if (applied !== moves.length) {
    throw new Error(
      `FATAL: projected ${applied} pin move(s) into the graph but ${moves.length} line(s) passed the gate. A candidate row is invisible to loadRecipeGraph (retired recipe? duplicate producer shadowing?) — refusing to claim a verification it did not perform.`,
    );
  }

  const labelById = new Map<string, string>();
  for (const r of uni.rows) labelById.set(r.recipeId, r.outputLabel);
  const labelOf = (k: string) => {
    const [, id] = k.split(":");
    const node = k.startsWith("item:") ? graphBefore.byOutputItem.get(id!) : graphBefore.byOutputMenuItem.get(id!);
    return node != null ? labelById.get(node.recipeId) ?? `${k}` : `${k}`;
  };

  const derivedBefore = deriveAll(graphBefore);
  const derivedAfter = deriveAll(graphAfter);
  const { deltas, nodes } = diffDerived(derivedBefore, derivedAfter, labelOf);

  const touchedRecipeIds = new Set(moves.map((m) => m.recipeId));
  const touchedRows: string[][] = [];
  for (const [k, b] of derivedBefore) {
    const [, id] = k.split(":");
    const node = k.startsWith("item:") ? graphBefore.byOutputItem.get(id!) : graphBefore.byOutputMenuItem.get(id!);
    if (node == null || !touchedRecipeIds.has(node.recipeId)) continue;
    const a = derivedAfter.get(k) ?? new Map<string, number>();
    const sum = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
    touchedRows.push([
      labelOf(k),
      k.startsWith("item:") ? "item" : "menu_item",
      String(b.size),
      ozStr(sum(b)),
      ozStr(sum(a)),
      Math.abs(sum(a) - sum(b)) <= TOLERANCE ? "✅ 0.000000" : `❌ ${sum(a) - sum(b)}`,
    ]);
  }
  h(3, "5a — The touched nodes, before and after");
  table(
    ["node", "grain", "leaf SKUs", "Σ oz before", "Σ oz after", "delta"],
    touchedRows.sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ["", "", "r", "r", "r", "r"],
  );

  p();
  const verificationPass = deltas.length === 0;
  p(
    plain(
      verificationPass
        ? `## ✅ VERIFICATION PASS — ${nodes} graph nodes re-derived, **0 deltas**.\n\nEvery item and menu_item in the ` +
            "whole recipe universe flattens to the same per-SKU ounces after the re-point as before it. The costing " +
            "board, the depletion lane and the readiness map cannot move."
        : `## ❌ VERIFICATION FAIL — ${deltas.length} of ${nodes} nodes MOVED.\n\n` +
            deltas
              .map((d) => `- **${d.label}**: Σ ${d.totalBefore} → ${d.totalAfter} (SKU keys moved: ${d.movedSkuIds.join(", ") || "none"})`)
              .join("\n"),
    ),
  );
  if (!verificationPass) {
    throw new Error(`FATAL: post-move verification found ${deltas.length} moved node(s) — refusing to write.`);
  }

  // ── §5 The write half (Task 4.3) ───────────────────────────────────────────
  h(2, "6 — Writes");

  // Snapshot orderability BEFORE anything, so the assertion is a claim about the live
  // rows rather than an intention (seed 24's invariant, carried).
  const orderabilitySnapshot = new Map<string, { active: boolean; weekdayPar: number | null; weekendPar: number | null; label: string }>();
  for (const id of uni.memberSkuIds) {
    const s = uni.skuById.get(id)!;
    orderabilitySnapshot.set(id, {
      active: s.active,
      weekdayPar: s.weekdayPar,
      weekendPar: s.weekendPar,
      label: `${s.vendorName}/${s.name}`,
    });
  }

  let moved = 0;
  let filled = 0;
  let notesWritten = 0;
  const notesByRecipe = new Map<string, Judged[]>();
  for (const j of passing) {
    const list = notesByRecipe.get(j.row.recipeId) ?? [];
    list.push(j);
    notesByRecipe.set(j.row.recipeId, list);
  }

  if (passing.length === 0 && fills.length === 0) {
    p(MD ? "_(nothing to write — every candidate refused.)_" : "  (nothing to write — every candidate refused)");
  }

  pre();
  for (const f of fills) {
    p(
      `${f.product.name}\n` +
        `  ${EXECUTE ? "-" : "would"} set products.unit_oz [${f.product.id}]\n` +
        `      unit_oz NULL -> ${f.value}   unit_oz_class -> ${f.klass}\n` +
        `      read live off ${f.measuredOn}`,
    );
  }
  for (const j of passing) {
    p(
      `${j.row.recipeName}\n` +
        `  ${EXECUTE ? "-" : "would"} re-point recipe_inputs[${j.row.id}]\n` +
        `      component_sku_id ${j.sku.vendorName}/${j.sku.name} [${j.sku.id}] -> NULL\n` +
        `      component_product_id NULL -> ${j.product.name} [${j.product.id}]\n` +
        `      line ${j.row.quantity} ${j.row.unit ?? "(no unit)"} = ${j.ozBefore} oz, unchanged`,
    );
  }
  pre();

  if (EXECUTE) {
    // ── unit_oz FIRST. The re-point gate was computed against the post-fill weight,
    //    so a re-point that landed before its fill would be a pin nothing can resolve.
    for (const f of fills) {
      const { data: before, error: bErr } = await sb
        .from("products")
        .select("id, name, unit_oz, unit_oz_class")
        .eq("id", f.product.id)
        .maybeSingle<{ id: string; name: string; unit_oz: number | string | null; unit_oz_class: string | null }>();
      if (bErr) throw new Error(`unit_oz lookup ${f.product.name}: ${bErr.message}`);
      if (!before) throw new Error(`FATAL: product ${f.product.name} [${f.product.id}] vanished mid-run.`);
      if (before.name !== f.product.name) {
        throw new Error(`FATAL: product [${f.product.id}] is now named "${before.name}", expected "${f.product.name}" — refusing.`);
      }
      const liveOz = num(before.unit_oz);
      if (liveOz != null && Math.abs(liveOz - f.value) <= TOLERANCE) {
        p(`  = unit_oz ${f.product.name} already ${f.value} — no write (idempotent).`);
        continue;
      }
      if (liveOz != null) {
        throw new Error(
          `FATAL: "${f.product.name}" already carries unit_oz = ${liveOz} (class ${before.unit_oz_class ?? "—"}); this run planned ${f.value}. Somebody weighed it between the dry run and now. Refusing to overwrite — re-run the dry run.`,
        );
      }
      const nowIso = new Date().toISOString();
      const { error, count } = await sb
        .from("products")
        .update(
          {
            unit_oz: f.value,
            unit_oz_class: f.klass,
            unit_oz_source_note: f.sourceNote,
            unit_oz_established_at: nowIso,
            // NULL is honest: the seeds audit with actorId null, so there is genuinely
            // nobody to name. Never backfill a placeholder actor (0179's own comment) —
            // the ruling itself is named in unit_oz_source_note and in the audit row.
            unit_oz_established_by: null,
            updated_at: nowIso,
            updated_by: null,
          },
          { count: "exact" },
        )
        .eq("id", f.product.id)
        .is("unit_oz", null); // guard: only fill a row still reading NULL.
      if (error) throw new Error(`set unit_oz ${f.product.name}: ${error.message}`);
      if (!count) {
        throw new Error(`FATAL: unit_oz write for ${f.product.name} matched 0 rows — the row moved under the guard. Refusing.`);
      }
      filled += 1;
      p(`  + unit_oz ${f.product.name} = ${f.value} (${f.klass})`);
      await audit({
        actorId: null,
        actorRole: null,
        action: "product.unit_oz_set",
        resourceTable: "products",
        resourceId: f.product.id,
        metadata: seedMeta("juan_weigh_ruling_carried_to_product_grain", {
          product_name: f.product.name,
          before_unit_oz: null,
          before_unit_oz_class: before.unit_oz_class,
          after_unit_oz: f.value,
          after_unit_oz_class: f.klass,
          weight_class: f.klass,
          measured_on: f.measuredOn,
          active_member_spread: f.activeSpread,
          ruled_oz: RULED_UNIT_OZ.find((r) => r.product === f.product.name)?.ruledOz ?? null,
          ruling: WEIGH_RULING,
          source_note: f.sourceNote,
        }),
        ipAddress: null,
        userAgent: null,
      });
    }

    // Re-read from the destination before a single pin moves: the whole gate above was
    // computed against these numbers, so a fill that did not land the way it was planned
    // invalidates every verdict that follows.
    if (fills.length > 0) {
      const { data: back, error: fErr } = await sb
        .from("products")
        .select("id, name, unit_oz, unit_oz_class")
        .in("id", fills.map((f) => f.product.id))
        .returns<Array<{ id: string; name: string; unit_oz: number | string | null; unit_oz_class: string | null }>>();
      if (fErr) throw new Error(`unit_oz read-back: ${fErr.message}`);
      for (const f of fills) {
        const row = (back ?? []).find((r) => r.id === f.product.id);
        const live = num(row?.unit_oz ?? null);
        if (live == null || Math.abs(live - f.value) > TOLERANCE) {
          throw new Error(
            `FATAL: ${f.product.name} reads unit_oz ${live ?? "NULL"} after the fill, expected ${f.value}. The gate below was computed against ${f.value} — refusing to re-point a single pin.`,
          );
        }
      }
      p(`  ✓ unit_oz read back from the destination on all ${fills.length} filled product(s).`);
    }

    for (const j of passing) {
      // Re-read at write time. A quantity/unit that moved under us invalidates the gate
      // the whole run was built on — that is plan drift, and it is FATAL, not a warning.
      const { data: live, error: rErr } = await sb
        .from("recipe_inputs")
        .select("id, recipe_id, quantity, unit, component_sku_id, component_product_id")
        .eq("id", j.row.id)
        .maybeSingle<{
          id: string;
          recipe_id: string;
          quantity: number | string;
          unit: string | null;
          component_sku_id: string | null;
          component_product_id: string | null;
        }>();
      if (rErr) throw new Error(`re-read recipe_input ${j.row.id}: ${rErr.message}`);
      if (!live) throw new Error(`FATAL: recipe_input ${j.row.id} (${j.row.recipeName}) vanished mid-run.`);
      if (live.component_product_id != null) {
        p(`  = ${j.row.recipeName}: already product-pinned — skipping (idempotent).`);
        continue;
      }
      if (live.component_sku_id !== j.sku.id) {
        throw new Error(
          `FATAL: recipe_input ${j.row.id} now pins ${live.component_sku_id}, expected ${j.sku.id} — the pin moved under us.`,
        );
      }
      if (num(live.quantity) !== j.row.quantity || live.unit !== j.row.unit) {
        throw new Error(
          `FATAL: recipe_input ${j.row.id} (${j.row.recipeName}) now reads ${live.quantity} ${live.unit}, was ${j.row.quantity} ${j.row.unit} — the gate was computed against a shape that no longer exists. Re-run.`,
        );
      }

      // ONE statement. The 3-way XOR CHECK makes any other ordering impossible, which
      // is the constraint doing its job rather than a convention being remembered.
      const { error: uErr, count } = await sb
        .from("recipe_inputs")
        .update({ component_sku_id: null, component_product_id: j.product.id }, { count: "exact" })
        .eq("id", j.row.id)
        .eq("component_sku_id", j.sku.id);
      if (uErr) throw new Error(`re-point ${j.row.recipeName}: ${uErr.message}`);
      if (!count) throw new Error(`re-point ${j.row.recipeName}: UPDATE affected 0 rows (silent RLS denial?)`);
      moved += 1;
      p(`  + ${j.row.recipeName}: pin moved to product ${j.product.name}`);

      await audit({
        actorId: null,
        actorRole: null,
        action: "recipe_input.update",
        resourceTable: "recipe_inputs",
        resourceId: j.row.id,
        metadata: seedMeta("pin_moved_to_product", {
          recipe_id: j.row.recipeId,
          recipe_name: j.row.recipeName,
          item: j.row.outputLabel,
          from_component_sku_id: j.sku.id,
          from_vendor: j.sku.vendorName,
          from_sku_name: j.sku.name,
          to_component_product_id: j.product.id,
          to_product_name: j.product.name,
          unit: j.row.unit,
          quantity: j.row.quantity,
          oz_before: j.ozBefore,
          oz_after: j.ozAfter,
          oz_parity: j.ozBefore === j.ozAfter,
          product_unit_oz: j.product.unitOz,
          product_unit_oz_class: j.product.unitOzClass,
          resolution_rung: j.rung,
          resolved_sku_id: j.resolvedSkuId,
          count_denominated: j.countDenominated,
          measure_dimension: j.dimension,
        }),
        ipAddress: null,
        userAgent: null,
      });
    }

    // ── recipes.notes stanza — the move readable ON the row, not only in audit_log.
    for (const [recipeId, lines] of notesByRecipe) {
      const { data: rec, error: rErr } = await sb
        .from("recipes")
        .select("id, name, notes")
        .eq("id", recipeId)
        .maybeSingle<{ id: string; name: string; notes: string | null }>();
      if (rErr) throw new Error(`re-read recipe ${recipeId}: ${rErr.message}`);
      if (!rec) throw new Error(`FATAL: recipe ${recipeId} disappeared mid-run.`);
      if (rec.name !== lines[0]!.row.recipeName) {
        throw new Error(`FATAL: recipe ${recipeId} is now named "${rec.name}", was "${lines[0]!.row.recipeName}" — refusing.`);
      }
      const stanza = lines.map((j) => pinStanza(j)).join(" ");
      // Prefix-filtered: a re-run replaces its OWN line and never stacks a second.
      const kept = (rec.notes ?? "")
        .split("\n")
        .filter((l) => !l.startsWith(NOTE_PREFIX))
        .join("\n")
        .trim();
      const next = kept.length > 0 ? `${kept}\n${stanza}` : stanza;
      if (rec.notes === next) {
        p(`  = notes ${rec.name}: already current — skipping.`);
        continue;
      }
      const { error: nErr, count: nCount } = await sb
        .from("recipes")
        .update({ notes: next, updated_at: new Date().toISOString(), updated_by: null }, { count: "exact" })
        .eq("id", recipeId);
      if (nErr) throw new Error(`notes ${rec.name}: ${nErr.message}`);
      if (!nCount) throw new Error(`notes ${rec.name}: UPDATE affected 0 rows (silent RLS denial?)`);
      notesWritten += 1;
      p(`  + notes ${rec.name}: product-pin stanza recorded`);

      await audit({
        actorId: null,
        actorRole: null,
        action: "recipe.update",
        resourceTable: "recipes",
        resourceId: recipeId,
        metadata: seedMeta("product_pin_recorded_on_recipe", {
          name: rec.name,
          patch: { notes: next },
          lines: lines.length,
        }),
        ipAddress: null,
        userAgent: null,
      });
    }

    // ── Re-read from the destination (never trust the write's own report). ────
    h(3, "6a — Read back from the destination");
    const { data: after, error: aErr } = await sb
      .from("recipe_inputs")
      .select("id, component_sku_id, component_item_id, component_product_id, quantity, unit")
      .in("id", passing.map((j) => j.row.id))
      .returns<Array<{ id: string; component_sku_id: string | null; component_item_id: string | null; component_product_id: string | null; quantity: number | string; unit: string | null }>>();
    if (aErr) throw new Error(`read back: ${aErr.message}`);
    const backRows: string[][] = [];
    for (const j of passing) {
      const r = (after ?? []).find((x) => x.id === j.row.id);
      if (!r) throw new Error(`FATAL: re-pointed row ${j.row.id} not found on read-back.`);
      const targets =
        Number(r.component_sku_id != null) + Number(r.component_item_id != null) + Number(r.component_product_id != null);
      if (targets !== 1) {
        throw new Error(`FATAL: row ${j.row.id} carries ${targets} component targets — the 3-way XOR is violated.`);
      }
      if (r.component_product_id !== j.product.id) {
        throw new Error(`FATAL: row ${j.row.id} reads product ${r.component_product_id}, expected ${j.product.id}.`);
      }
      if (num(r.quantity) !== j.row.quantity || r.unit !== j.row.unit) {
        throw new Error(`FATAL: row ${j.row.id} quantity/unit moved during the write.`);
      }
      backRows.push([j.row.recipeName, j.product.name, `${r.quantity} ${r.unit ?? "(none)"}`, "✅ exactly one target"]);
    }
    table(["recipe", "product pin", "line", "XOR"], backRows);

    // The REAL loader, after the writes — the projection is not taken on trust.
    const graphReal = await loadRecipeGraph();
    const derivedReal = deriveAll(graphReal);
    const realDiff = diffDerived(derivedBefore, derivedReal, labelOf);
    if (realDiff.deltas.length > 0) {
      throw new Error(
        `FATAL: after the write, the LIVE graph disagrees with the pre-write derivation on ${realDiff.deltas.length} node(s):\n  ` +
          realDiff.deltas.map((d) => `${d.label}: ${d.totalBefore} → ${d.totalAfter}`).join("\n  "),
      );
    }
    p();
    p(plain(`**✅ LIVE re-derivation after the write: ${realDiff.nodes} nodes, 0 deltas.** The projection was correct.`));

    await assertNoOrderabilityDrift(sb, orderabilitySnapshot);
  } else {
    p();
    p(
      plain(
        "Sample notes stanza" + (passing.length > 0 ? ` (${passing[0]!.row.recipeName})` : "") + ":",
      ),
    );
    pre();
    if (passing.length > 0) p(pinStanza(passing[0]!));
    else p("(no passing line)");
    pre();
  }

  // ── §6 What this seed will NOT touch ───────────────────────────────────────
  h(2, "7 — What this seed will NOT touch");
  p(
    plain(
      "- **`active`, `weekday_par`, `weekend_par`** on any SKU. Seed 18 adjudicated orderability; the execute run " +
        "snapshots all three on every member SKU and re-reads them afterwards — any movement is a FATAL.\n" +
        "- **`recipe_inputs.quantity` / `unit`.** Not one number is re-denominated. Seed 22 owns the portioned " +
        "quantities; this seed only moves WHICH THING the line points at, and refuses whenever that would change WHAT " +
        "IT MEANS.\n" +
        "- **`avg_oz_per_each` on any SKU.** The SKU layer's weights are the SKU layer's business; §2 READS them and " +
        "carries the number up to the product grain, and writes nothing back down.\n" +
        "- **`products.unit_oz` outside Juan's ruling.** A weight is a measurement, and the ruling is the ceiling: a " +
        "product it does not name is never filled, active members carrying DIFFERENT weights refuse outright, and a " +
        "live value that has drifted from the ruled one refuses rather than being overwritten. Where no weight can be " +
        "established the seed REFUSES the line instead of inventing the number that would let it pass.\n" +
        "- **Anything on a RETIRED recipe.** Reported with its numbers, never written.\n" +
        "- **The depletion ledgers.** `toast_daily_depletion` is untouched and the double-count law is not in play " +
        "(deviation D5).",
    ),
  );

  // ── §7 Summary ─────────────────────────────────────────────────────────────
  h(2, "8 — Summary");
  table(
    [EXECUTE ? "wrote" : "would write", "count"],
    [
      ["`products.unit_oz` fills (Juan's weigh ruling)", EXECUTE ? String(filled) : String(fills.length)],
      ["`recipe_inputs` pins moved SKU → product", EXECUTE ? String(moved) : String(passing.length)],
      ["`recipes.notes` stanzas", EXECUTE ? String(notesWritten) : String(notesByRecipe.size)],
      ["lines REFUSED (no write)", String(refused.length)],
      ["rows touching quantity / unit / par / active / price", "**0**"],
    ],
    ["", "r"],
  );

  p();
  if (refused.length > 0) {
    // A RETIRED_RECIPE refusal is CORRECT FOREVER — there is no input to fix, because
    // nothing reads the row. Lumping it in with a fixable refusal would misreport the
    // run's state to the one person who has to decide whether to execute.
    const permanent = refused.filter((j) => j.verdict === "RETIRED_RECIPE");
    const fixable = refused.filter((j) => j.verdict !== "RETIRED_RECIPE");
    if (fixable.length > 0) {
      p(
        plain(
          `> ⚠ **${fixable.length} line(s) refuse with a FIXABLE cause.** Gate S2's protocol is explicit: *"If ANY ` +
            'line refuses, do not execute."* The refusals and their unblocks go to Juan; a refusal is the script ' +
            "working, and the honest move is to fix the input, not the gate. Everything that passes is independently " +
            "safe, so a partial execute is defensible — but that is the LEAD's call with Juan, not this script's.",
        ),
      );
    } else {
      p(
        plain(
          `> ✅ **Zero fixable refusals.** The residue is ${permanent.length} \`RETIRED_RECIPE\` row(s), and that ` +
            "refusal is **correct forever**, not a blocker: the row hangs off an inactive recipe, `loadRecipeGraph` " +
            "does not read it, and there is no input to fix. Gate S2's *\"if ANY line refuses, do not execute\"* " +
            "clause exists to stop a re-point the gate could not prove safe — it cannot be satisfied by writing to a " +
            "row nothing reads, so the honest reading is that every line the gate CAN speak about has passed.",
        ),
      );
    }
    p();
  }
  p(`Seed 25 done (${EXECUTE ? "execute" : "dry run"}).`);
  if (!EXECUTE) p(plain("**NOTHING WAS WRITTEN.**"));
}

/** The stanza that makes the move readable on the recipe itself. */
function pinStanza(j: Judged): string {
  return (
    `${NOTE_PREFIX} ${j.row.outputLabel} now pins the PRODUCT ${j.product.name}, not ${j.sku.vendorName} ${j.sku.name}. ` +
    `Line oz unchanged (${j.ozBefore} oz). Resolution is per-location primary-first.`
  );
}

async function assertNoOrderabilityDrift(
  sb: Sb,
  snapshot: Map<string, { active: boolean; weekdayPar: number | null; weekendPar: number | null; label: string }>,
): Promise<void> {
  const ids = [...snapshot.keys()];
  if (ids.length === 0) return;
  const { data, error } = await sb
    .from("vendor_items")
    .select("id, active, weekday_par, weekend_par")
    .in("id", ids)
    .returns<Array<{ id: string; active: boolean | null; weekday_par: number | string | null; weekend_par: number | string | null }>>();
  if (error) throw new Error(`orderability re-read: ${error.message}`);
  const drift: string[] = [];
  for (const row of data ?? []) {
    const was = snapshot.get(row.id);
    if (!was) continue;
    const now = { active: row.active ?? true, weekdayPar: num(row.weekday_par), weekendPar: num(row.weekend_par) };
    if (now.active !== was.active || now.weekdayPar !== was.weekdayPar || now.weekendPar !== was.weekendPar) {
      drift.push(
        `${was.label}: active ${was.active}→${now.active}, weekday_par ${was.weekdayPar}→${now.weekdayPar}, weekend_par ${was.weekendPar}→${now.weekendPar}`,
      );
    }
  }
  if (drift.length > 0) {
    throw new Error(
      `FATAL: this seed moved orderability, which it must never do:\n  ${drift.join("\n  ")}\nSeed 18's P1 adjudication owns those columns.`,
    );
  }
  p();
  p(plain(`**✅ orderability unchanged on all ${ids.length} member SKUs** (active / weekday_par / weekend_par re-read from the destination).`));
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

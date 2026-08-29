/**
 * Par-pass ordering data layer (delivery-intake P3, migration 0172). SERVER-ONLY,
 * service-role client; authorization is APP-LAYER (KH+ gate + location-bind IDOR).
 * NO Tier-A step-up — the shelf-walk is an operational KH+ capture, not an admin
 * mutation (spec D5). Mirrors the credits.ts posture (typed error, requireLevel,
 * actorLoc, num).
 *
 * ── THE PAR-PASS (spec D5/D6) ──────────────────────────────────────────────────
 * Staff walk the shelf and record, per par'd SKU, the ORDER QTY needed to reach
 * par — in the SKU's ORDER UNIT (its top pack level: the chain root label when the
 * SKU is chained, else pack_format). The system derives (a) draft orders per vendor
 * and (b) a soft on-hand anchor: implied_on_hand = par − order_qty (the "par_estimate"
 * truth tier consumed by lib/counts.ts). A ZERO order_qty line is an EXPLICIT "we're
 * full" observation (implied on-hand = full par), NOT a no-op — it is stored.
 *
 * ── UNIT SEMANTICS (locked; migration 0172 comment block is law) ───────────────
 *   order unit  = the SKU's chain ROOT label (chained) else pack_format. par_qty and
 *                 order_qty are BOTH in this unit — the same implicit unit the seeded
 *                 weekday_par/weekend_par guide values use.
 *   par for day = weekend_par when the walk date's getDay() ∈ {5,6,0} (Fri/Sat/Sun)
 *                 AND weekend_par is set, else weekday_par. A SKU with NEITHER par
 *                 set is EXCLUDED from the walk (nothing to order to).
 *   per-order-unit oz = oz of ONE order unit. Chained: ozForRecipeInput(1, rootLabel,
 *                 skuShape, measures) (walks the chain to the root container's oz).
 *                 Unchained: skuContentOz (oz of one pack = one pack_format unit).
 *                 advisory-null when unconvertible — NEVER fabricated (A3 / BC-026).
 *   implied_on_hand_oz = perUnitOz != null ? max(par − order_qty, 0) × perUnitOz : null.
 *
 * ── SHRINKAGE SIGNAL (spec D6, L8-flavored, ADVISORY not variance) ─────────────
 * When a line's implied_on_hand_oz AND the CURRENTLY-computed advisory on-hand oz
 * (loadOnHand's par_estimate/census/inferred weight rows) are BOTH non-null and
 * diverge beyond max(0.25 × par_oz, one order-unit oz), we surface a shrinkage
 * notice — "the par-pass sees less than the computed feed/verify model predicts →
 * possible unrecorded waste". Persist NOTHING new; surfaced read-time (submit +
 * loadShrinkageSignals). Advisory voice — never "variance" (that stays census-only).
 *
 * BATCH LAW (loadRecipeGraph): loadWalkerData makes exactly ONE loadOnHand call, ONE
 * pack-chains load, ONE measures load, ONE usage-rank computation, ONE last-order-qty
 * query. Never per-SKU.
 *
 * APPEND-ONLY: par_pass_events / par_pass_lines rows are never DELETEd or mutated.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { vendorOrderMinimumReady } from "@/lib/vendor-schema-probes";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import {
  ozForRecipeInput,
  skuContentOz,
  type MeasureUnitFactor,
  type RecipeInputSku,
} from "@/lib/recipe-math";
import {
  buildPackChain,
  chainRootLabel,
  type PackChainLevel,
} from "@/lib/pack-chain-shared";
import { loadOnHandDerived, type OnHandRow } from "@/lib/counts";
import { etBusinessDate } from "@/lib/counts-shared";
import {
  resolvePar, resolveParSlot, resolveActive, walkDisposition, parReviewAdvisory,
  type LocationSkuOverlay, type ParAdvisory,
} from "@/lib/location-sku-shared";
import { parAutoLaneReady } from "@/lib/dynamic-pars-probes";
import {
  loadParSuggestions, loadParSilence, type ParSkuIndexEntry,
} from "@/lib/dynamic-pars-walker";
import {
  EMPTY_PAR_SILENCE, PAR_WRITE_MIN,
  type ParSilenceSummary, type WalkerParSuggestion,
} from "@/lib/dynamic-pars-shared";
import { addDaysEt, minutesOfDayEt } from "@/lib/vendor-rhythm-shared";
import { deriveCateringSkuDemand } from "@/lib/catering/sku-demand";
import { loadProductIndex } from "@/lib/products";
import { rollupUsageByProduct } from "@/lib/products-shared";
import {
  createDraftsFromLines,
  PurchaseOrderError,
  type CreatedDraft,
  type DraftLineInput,
} from "@/lib/purchase-orders";
import { etCalendarDate, etYmdMinusDays, operationalDayUtcRange } from "@/lib/operational-day";
import { etDayFromDate } from "@/lib/et-day-shared";
import { formatTime } from "@/lib/i18n/format";

/**
 * How far ahead the walk looks for BOOKED CATERING when naming the event advisory.
 *
 * The advisory is per-row bounded by that row's own coverage horizon, but the catering
 * read has to happen in the walk's ONE batch — before any horizon is known — so it needs
 * a single outer bound. 14 days covers the longest coverage window a weekly rhythm can
 * produce (an order day, its truck, and the truck after it), and an event further out
 * than that is not something tonight's par can act on. Rows whose horizon is shorter
 * filter the window down themselves; nothing outside a row's horizon is ever shown on it.
 */
const EVENT_ADVISORY_HORIZON_DAYS = 14;

/** KH+ read/write floor for the par-pass. NO step-up (operational capture, spec D5). */
export const PAR_PASS_MIN = 4; // key_holder+

export class OrderingError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "OrderingError";
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new OrderingError(403, "forbidden", "Insufficient role level for the par-pass");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

/**
 * ET-anchored walk-day derivation — the SINGLE authority for both loadWalkerData and
 * submitParPass. Vercel runs UTC, and evening walks (exactly when shops order) must not
 * roll into tomorrow's weekday. etBusinessDate gives the ET calendar date; the dow +
 * weekend-par flag derive from it via the shared lib/et-day-shared.etDayFromDate (the
 * ONE home for that derivation — purchase-orders.ts's etToday delegates to the same
 * helper, no import cycle). Both functions MUST use this helper — never inline a
 * new Date().getDay() in day-rule context.
 */
function etWalkDay(): { walkDateEt: string; weekend: boolean; todayDow: number } {
  const walkDateEt = etBusinessDate(new Date().toISOString());
  const { dow: todayDow, weekend } = etDayFromDate(walkDateEt);
  return { walkDateEt, weekend, todayDow };
}

// ── Cutoff matching (MIRRORS lib/purchase-orders.ts resolveGoverningCutoffIso, which is
// private there — the plan authorizes mirroring the exact approach) ──────────────────────
/**
 * The UTC instant of an ET wall-clock TIME (bare "HH:MM[:SS]") on an ET calendar date, as
 * an ISO timestamptz — byte-identical derivation to purchase-orders.ts etWallClockToUtcIso:
 * operationalDayUtcRange(dateEt).startIso (ET-midnight-as-UTC, DST-correct) + the cutoff's
 * seconds-of-day. The offset is fixed for the whole ET day (DST never flips mid-day). Returns
 * null on a malformed time (advisory — never fabricate a deadline).
 */
function cutoffWallClockToUtcIso(dateEt: string, time: string): string | null {
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  const s = Number(parts[2] ?? "0");
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  if (!Number.isFinite(s) || s < 0 || s > 59) return null;
  const { startIso } = operationalDayUtcRange(dateEt);
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs + (h * 3600 + Math.floor(m) * 60 + Math.floor(s)) * 1000).toISOString();
}

/**
 * Pick the GOVERNING cutoff row from a vendor's matched rows (location null-or-match, active,
 * today's ET dow) — mirrors purchase-orders.ts resolveGoverningCutoffIso's tiebreak EXACTLY:
 * a location-scoped row beats a both-shops row (most specific), then the EARLIEST cutoff_time
 * governs (the binding deadline; bare "HH:MM[:SS]" sorts lexically). Returns the bare time
 * string, or null when no row matches. Pure over the passed rows.
 */
function governingCutoffTime(
  rows: Array<{ location_id: string | null; cutoff_time: string }>,
  locationId: string,
): string | null {
  if (rows.length === 0) return null;
  const scoped = rows.filter((r) => r.location_id === locationId);
  const pool = scoped.length > 0 ? scoped : rows;
  pool.sort((a, b) => a.cutoff_time.localeCompare(b.cutoff_time));
  return pool[0]?.cutoff_time ?? null;
}

/**
 * All active cutoffs for a vendor set on today's ET dow, keyed by vendorId → the matched rows
 * (location null-or-match). ONE batched query (never per-vendor). Empty map = day-one (no
 * cutoffs configured → walker chips + attention are silent, per spec §7 additive rollout).
 */
async function loadCutoffsByVendor(
  sb: ReturnType<typeof getServiceRoleClient>,
  vendorIds: string[],
  locationId: string,
  dow: number,
): Promise<Map<string, Array<{ location_id: string | null; cutoff_time: string }>>> {
  const out = new Map<string, Array<{ location_id: string | null; cutoff_time: string }>>();
  if (vendorIds.length === 0) return out;
  const { data, error } = await sb.from("vendor_cutoffs")
    .select("vendor_id, location_id, cutoff_time")
    .in("vendor_id", vendorIds).eq("active", true).eq("order_day", dow)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .returns<Array<{ vendor_id: string; location_id: string | null; cutoff_time: string }>>();
  if (error) throw new Error(`loadCutoffsByVendor: ${error.message}`);
  for (const r of data ?? []) {
    const arr = out.get(r.vendor_id) ?? [];
    arr.push({ location_id: r.location_id, cutoff_time: r.cutoff_time });
    out.set(r.vendor_id, arr);
  }
  return out;
}


// ── Per-order-unit oz conversion (chain root, else pack content) ─────────────────
/**
 * oz of ONE order unit for a SKU. The order unit is the chain ROOT container (chained)
 * or one pack_format pack (unchained). Advisory-null when the conversion can't resolve
 * (A3 — never fabricate):
 *   chained  → ozForRecipeInput(1, rootLabel, skuShape, measures) (walks the chain).
 *              A malformed / count-terminated-unresolvable chain → null.
 *   unchained→ skuContentOz(skuShape, measures) = oz of one pack (the pack_format unit).
 * Pure over the passed shapes; the caller batch-loads chains + measures once.
 *
 * EXPORTED for the nightly pars engine (lib/dynamic-pars.ts). The order-unit denominator
 * is the whole coverage layer's arithmetic — a second spelling of it would let the engine
 * suggest a par in units the walker does not mean.
 */
export function perOrderUnitOz(
  sku: RecipeInputSku,
  chain: PackChainLevel[] | null,
  measures: Map<string, MeasureUnitFactor>,
): number | null {
  const hasChain = chain != null && chain.length > 0;
  if (hasChain) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root == null) return null; // no unique root → can't name the order unit → advisory-null.
    return ozForRecipeInput(1, root, sku, measures);
  }
  // Unchained: the order unit is one pack_format pack; its oz is the pack content.
  return skuContentOz(sku, measures);
}

/** The order-unit label = chain root label (chained) else pack_format else null. */
function orderUnitLabelFor(packFormat: string | null, chain: PackChainLevel[] | null): string | null {
  if (chain != null && chain.length > 0) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root != null) return root;
  }
  return packFormat;
}

/**
 * Which recipes create demand for a SKU today, and which STOPPED — the input to the
 * par-review advisories (Juan, 2026-08-21: "the system recognizes what's going on
 * before the human does").
 *
 * TWO paged reads over the WHOLE (small) recipe universe — `recipe_inputs` and
 * `recipes` — never an `.in()` list of the 141 par'd SKU ids. That is deliberate: a
 * SKU-id `.in()` filter is spent on the GET request line, which is the 414/400 cliff
 * sim P1 #6/#24 named, and the recipe graph is ~60 recipes. Reading it whole and
 * filtering in memory is both cheaper and immune to that failure.
 *
 * THE "REMOVED" SIGNAL IS DERIVED FROM THE GRAPH, NOT FROM HISTORY: a reference that
 * survives only on an INACTIVE recipe is proof that a recipe which used this SKU was
 * retired. No audit query, no time window, no chance of a stale window hiding it —
 * and it names the recipe. (The other half of the story, a `recipe_input` row DELETED
 * outright, leaves no graph trace and would need the `recipe_input.remove` audit
 * trail; live count of those rows today is ZERO, so it is documented as deferred
 * rather than built on a hot read path — see docs/ROADMAP.md.)
 */
interface DemandSources {
  /** skuId → count of ACTIVE recipes referencing it (directly or via its product). */
  activeRefsBySku: Map<string, number>;
  /** skuId → names of RETIRED recipes that used to reference it, sorted. */
  removedSourcesBySku: Map<string, string[]>;
}

async function loadDemandSources(
  sb: ReturnType<typeof getServiceRoleClient>,
  skus: ReadonlyArray<{ id: string; product_id: string | null }>,
): Promise<DemandSources> {
  const activeRefsBySku = new Map<string, number>();
  const removedSourcesBySku = new Map<string, string[]>();
  if (skus.length === 0) return { activeRefsBySku, removedSourcesBySku };

  const [inputs, recipes] = await Promise.all([
    selectAllRows<{ recipe_id: string; component_sku_id: string | null; component_product_id: string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("recipe_inputs")
          .select("recipe_id, component_sku_id, component_product_id")
          .order("id", { ascending: true }).range(from, to)
          .returns<Array<{ recipe_id: string; component_sku_id: string | null; component_product_id: string | null }>>();
        if (error) throw new Error(`loadDemandSources inputs: ${error.message}`);
        return { data };
      },
    ),
    selectAllRows<{ id: string; name: string; active: boolean }>(async (from, to) => {
      const { data, error } = await sb.from("recipes").select("id, name, active")
        .order("id", { ascending: true }).range(from, to)
        .returns<Array<{ id: string; name: string; active: boolean }>>();
      if (error) throw new Error(`loadDemandSources recipes: ${error.message}`);
      return { data };
    }),
  ]);

  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  // A SKU is referenced by a line that names it DIRECTLY or names its PRODUCT — the
  // product pin is the same demand, one layer up (0179), and missing it would report
  // every re-pointed line as a lost source.
  const skusOfProduct = new Map<string, string[]>();
  for (const s of skus) {
    if (s.product_id == null) continue;
    const list = skusOfProduct.get(s.product_id) ?? [];
    list.push(s.id);
    skusOfProduct.set(s.product_id, list);
  }
  const pardIds = new Set(skus.map((s) => s.id));
  // De-dup per (sku, recipe): two lines of one recipe naming the same SKU is ONE
  // demand source, and "2 recipes stopped using this" would be a lie.
  const seen = new Set<string>();

  for (const i of inputs) {
    const recipe = recipeById.get(i.recipe_id);
    if (recipe == null) continue;
    const targets: string[] = [];
    if (i.component_sku_id != null && pardIds.has(i.component_sku_id)) targets.push(i.component_sku_id);
    if (i.component_product_id != null) targets.push(...(skusOfProduct.get(i.component_product_id) ?? []));
    for (const skuId of targets) {
      const key = `${skuId}:${i.recipe_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (recipe.active) {
        activeRefsBySku.set(skuId, (activeRefsBySku.get(skuId) ?? 0) + 1);
      } else {
        const list = removedSourcesBySku.get(skuId) ?? [];
        list.push(recipe.name);
        removedSourcesBySku.set(skuId, list);
      }
    }
  }
  for (const list of removedSourcesBySku.values()) list.sort((a, b) => a.localeCompare(b));
  return { activeRefsBySku, removedSourcesBySku };
}

/**
 * How many production ids may ride ONE `.in()` filter. MIRRORS lib/dynamic-pars.ts
 * PRODUCTION_ID_CHUNK, which solved this exact problem on this exact table — 150 uuids is
 * ~5.6 KB of request line (`requestLineBytesForInList`, lib/supabase-paginate.ts) against a
 * conservative 8 KB budget that also has to hold the select list, the order clause and the
 * range, comfortably inside the ~220-uuid 414 cliff. Kept as its own constant per module
 * rather than shared, so neither module's ceiling can be retuned by an edit to the other.
 */
const PRODUCTION_ID_CHUNK = 150;

// ── Usage rank (trailing-30d consumed oz; mirrors receiving.ts loadSkuUsageRank) ──
/**
 * Trailing-30-day consumed oz per SKU at a location — the "most used" ordering rank
 * (higher = walked first). Mirrors lib/receiving.ts loadSkuUsageRank + the counts drift
 * consumed term EXACTLY (the double-count law's two lanes):
 *   production lane = SUM(production_inputs.input_oz) over LIVE productions
 *                     (superseded_at/revoked_at NULL) at this location in the last 30d.
 *   sales lane      = SUM(toast_daily_depletion.direct_oz) at this location over the
 *                     last 30d (ONLY the direct lane depletes raw stock; flattened_oz
 *                     is production-covered — never summed).
 * Two grouped batch queries, summed in memory (loadRecipeGraph law — never per-SKU). A
 * SKU absent from both lanes is absent from the map (usageRank null → sorts last).
 */
async function loadSkuUsageRank(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<Map<string, number>> {
  const usage = new Map<string, number>();
  const add = (skuId: string, oz: number) => {
    if (!Number.isFinite(oz) || oz <= 0) return;
    usage.set(skuId, (usage.get(skuId) ?? 0) + oz);
  };

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const cutoffDate = cutoffIso.slice(0, 10); // YYYY-MM-DD for the business_date filter.

  // BOTH production reads are PAGED (the PR #63 lesson): 30 days of productions and
  // their inputs each overrun the 1000-row cap, and a truncated page would silently
  // drop usage from the rank. `id` (the PK) gives the stable total order paging needs;
  // both reads are order-insensitive sums.
  const prodHdrs = await selectAllRows<{ id: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("productions")
        .select("id")
        .eq("location_id", locationId)
        .is("superseded_at", null).is("revoked_at", null)
        .gt("produced_at", cutoffIso)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ id: string }>>();
      if (error) throw new Error(`loadSkuUsageRank productions: ${error.message}`);
      return { data };
    },
  );
  const prodIds = prodHdrs.map((h) => h.id);
  //
  // ⚠ THE ID LIST IS WINDOWED, NOT SPENT WHOLE. `prodIds` is every live production at this
  // location over 30 days and is unbounded by design, so a single `.in()` would put the 414
  // request-line cliff (~220 uuids against the conservative 8 KB budget —
  // lib/supabase-paginate.ts `requestLineBytesForInList`) on the par-pass walk, where it
  // fails on page 0 with ZERO rows and no amount of paging or retrying helps:
  // `selectAllRows` pages the RESPONSE and cannot touch the REQUEST. The house doctrine
  // names two remedies — a server-side embed or a windowed id set — and this is the second,
  // mirroring lib/dynamic-pars.ts `loadDemandInputs`, which fixed the identical shape
  // against the identical table. The filter is IDENTICAL, just split into disjoint chunks
  // whose union is exactly the one-shot result, so there is no parity question to verify
  // and no behaviour change: `add()` sums into the same map in the same way, and both reads
  // are order-insensitive sums.
  for (let i = 0; i < prodIds.length; i += PRODUCTION_ID_CHUNK) {
    const chunk = prodIds.slice(i, i + PRODUCTION_ID_CHUNK);
    const inputs = await selectAllRows<{ input_sku_id: string; input_oz: number | string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("production_inputs")
          .select("input_sku_id, input_oz")
          .in("production_id", chunk)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
        if (error) throw new Error(`loadSkuUsageRank production_inputs: ${error.message}`);
        return { data };
      },
    );
    for (const r of inputs) add(r.input_sku_id, num(r.input_oz) ?? 0);
  }

  // 30 days at (location, business_date, sku) grain overruns PostgREST's 1000-row
  // default cap, and an unordered truncated page would silently drop usage from the
  // rank (the PR #63 lesson) — page it under a stable total order (`id`, the PK).
  const sales = await selectAllRows<{ sku_id: string; direct_oz: number | string }>(
    async (from, to) => {
      const { data, error } = await sb.from("toast_daily_depletion")
        .select("sku_id, direct_oz")
        .eq("location_id", locationId)
        .gte("business_date", cutoffDate)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ sku_id: string; direct_oz: number | string }>>();
      if (error) throw new Error(`loadSkuUsageRank toast_daily_depletion: ${error.message}`);
      return { data };
    },
  );
  for (const r of sales) add(r.sku_id, num(r.direct_oz) ?? 0);

  return usage;
}

/**
 * Advisory on-hand oz per SKU from a loadOnHand result. ONLY weight-dimension rows
 * (census / par_estimate / inferred) carry an honest ounce (onHandOz) — count-dimension
 * rows have no oz (packaging; count-dimension SKUs are deferred for suggested-qty per
 * the plan). A weight row with onHandOz null → advisory-null (never fabricated). The
 * anchorSource is carried through so the walker can render provenance ("~N unit · source").
 */
function advisoryOnHandBySku(view: { rows: OnHandRow[] }): Map<string, { oz: number; source: string }> {
  const out = new Map<string, { oz: number; source: string }>();
  for (const row of view.rows) {
    if (row.dimension !== "weight") continue; // count-dimension → no oz (deferred).
    if (row.onHandOz == null) continue; // advisory-null; not an anchor for suggestion.
    // anchorSource is "census" | "inferred" | null; par_estimate lands here once Task 3
    // adds that tier. null (defensive) reads as "inferred" provenance is wrong — keep the
    // literal source string, defaulting to "inferred" only when the row truly has none.
    out.set(row.skuId, { oz: row.onHandOz, source: row.anchorSource ?? "inferred" });
  }
  return out;
}

// ── loadWalkerData: the shelf-walk payload ───────────────────────────────────────
export interface WalkerSku {
  skuId: string;
  name: string;
  itemNumber: string | null;
  /** Chain root label (chained) else pack_format else null. */
  orderUnitLabel: string | null;
  /** The par that applies on the walk day (order units). Never null here — a SKU with
   *  neither par set is EXCLUDED (not surfaced). */
  parToday: number;
  /** True when parToday came from weekend_par (Fri/Sat/Sun + weekend_par set). */
  parIsWeekend: boolean;
  /** The order_qty of the latest par_pass_lines row for this SKU (any event). null =
   *  never walked. Advisory hint ("last time you ordered N"). */
  lastOrderQty: number | null;
  /** Advisory computed on-hand for the SKU. null when unconvertible / no anchor /
   *  count-dimension. oz + its order-unit equivalent (oz ÷ per-order-unit-oz) + source. */
  advisoryOnHand: { oz: number; orderUnits: number | null; source: string } | null;
  /** max(par − advisoryOrderUnits, 0), rounded UP to whole units — only when the
   *  advisory is convertible to order units; else null (no fabricated suggestion). */
  suggestedQty: number | null;
  /**
   * Is the order-unit→oz conversion DERIVABLE for this SKU (perOrderUnitOz non-null
   * AND > 0)? DISPLAY-ONLY — nothing in the walk math, filtering, or submit reads it.
   *
   * False is a CHRONIC state, not an alert: without a per-order-unit oz this SKU can
   * never anchor an on-hand estimate and never earns a Suggest chip, so both hints go
   * silently missing (the council's mute-face finding). The row renders a muted
   * "no weight set" microcopy so the absence is EXPLAINED rather than unexplained.
   *
   * Gate note: this mirrors the `orderUnits`/`suggestedQty` gate below (`> 0`), NOT the
   * marginally looser submit-side gate (`!= null`, line ~762) that decides whether a
   * walk line stores implied_on_hand_oz. They differ only for a pathological perUnitOz
   * === 0, where an implied "0 oz" would be stored but is not a usable estimate and
   * still yields no chip — so `> 0` is the condition that makes the hint's claim true
   * in every case.
   */
  canImplyOz: boolean;
  /**
   * PAR-REVIEW ADVISORY (Juan, 2026-08-21) — null when there is nothing to say.
   *
   * A cause-attributed nudge that this par may now be too high because demand LOST A
   * SOURCE: a recipe that used this SKU was retired, or its product was discontinued.
   * It names the recipe; it deliberately does NOT suggest a number (that is the
   * Dynamic Pars arc). Advisory tone, never an alarm — nothing is broken, the system
   * is just noticing before the human does.
   */
  parAdvisory: ParAdvisory | null;
  /**
   * THE NUMBER PAIR (r1 walker legibility + r3 suggestion governance). null = nothing to say.
   *
   * MUTUALLY EXCLUSIVE WITH `parAdvisory` BY CONSTRUCTION: the #283 cause advisory and the
   * numeric suggestion never render on one row (r1). When both exist the NUMBER wins — a
   * suggestion that names a coverage horizon is strictly more actionable than "a recipe
   * changed", and two claimants on one row at 6 AM is the over-correction r2-9 rejected.
   */
  parSuggestion: WalkerParSuggestion | null;
  /**
   * THE EVENT ADVISORY — NAMED, NEVER SUMMED (r1-1, 6/6 unanimous).
   *
   * Booked catering demand for this SKU inside the horizon this par has to survive:
   * "Catering Thursday needs 38 oz". A DISPLAY field and nothing else — a fulfilled
   * event's consumption already enters the base through toast/production, and
   * `productions` carries no catering attribution, so the base cannot be cleaned and
   * adding this to any target would double-count it. Enforced structurally: nothing in
   * lib/dynamic-pars-shared.ts knows this field exists (tests/dynamic-pars-reason.test.ts
   * asserts the pure module never names it).
   *
   * STATED v1 LIMITATION (r2-12): recurring-event consumption pollutes the base once per
   * cycle (single-count) until the `productions` quote-link enabler ships.
   */
  parEvent: { needDate: string; oz: number } | null;
  /** The product this SKU is a member of (0179). null = implicit singleton. */
  productId: string | null;
  /** Display label for the product headline ("HAM"). null for a singleton. */
  productName: string | null;
  /**
   * `solo` = not a member of any product · `primary` = the DESIGNATED primary for
   * this scope (product_primaries, location row over global) · `backup` = an active
   * member that is not the designated primary. Deliberately the DESIGNATION, not the
   * ladder's runtime answer: "Baldor — backup" is what a manager needs to read on a
   * vendor-down day, and it stays true whichever rung answered.
   */
  memberRole: "primary" | "backup" | "solo";
  /**
   * True when this row exists because ANOTHER member's par could not be routed
   * today (its vendor is down or the SKU is deactivated) and the demand moved here.
   * The par shown is the unroutable member's par — the demand did not evaporate.
   */
  reroutedFromSkuId: string | null;
}
export interface WalkerVendor {
  vendorId: string;
  name: string;
  /** True when TODAY (server local getDay) is one of the vendor's order_days. */
  isOrderDay: boolean;
  /** The governing cutoff time for TODAY (ET dow), formatted "h:mm AM/PM" via the
   *  house formatter — null when no active cutoff governs today. Rendered as a chip
   *  on the vendor section header ("cutoff {time}"). */
  cutoffTimeToday: string | null;
  /** True when today's cutoff is within 2h of now (ET) — warn tone on the chip.
   *  Computed server-side so the client renders tone without any time math. */
  cutoffSoon: boolean;
  skus: WalkerSku[];
}
export interface WalkerData {
  /** The walk date (server local). Its getDay drives the weekend-par rule + isOrderDay. */
  walkDate: string; // ISO
  isWeekendPar: boolean;
  /**
   * Has the sales-depletion ledger materialized before but NOT yet caught up through
   * YESTERDAY? (onHandView.salesThrough < yesterday-ET.) During that window the
   * consumed term of every advisory on-hand is missing its most recent day, so
   * estimates and Suggest chips are stale-or-absent BY DESIGN — the nightly
   * toast-sales-pull cron (09:00 UTC ≈ 5 AM ET) materializes T-1 and they return.
   *
   * DORMANT ≠ BROKEN: salesThrough == null (Toast never materialized at all) is FALSE
   * here — a shop that has never had a sales feed is not "paused", and claiming
   * otherwise would invent a fault. Display-only; changes no math (the advisory stays
   * honestly null/stale — this flag only lets the UI SAY why).
   */
  advisoryPaused: boolean;
  /** Par-carrying SKUs the walk dropped because nothing can order them (audit P4). */
  unroutable: WalkerUnroutable;
  /**
   * WHY THE QUIET PARS ARE QUIET — the Dynamic Pars reason lane (plan D15).
   *
   * One aggregate line plus a per-cause errand list, NEVER a per-row badge: with 94–100%
   * of rows silent in v1 a badge would mark everything and destroy the lane it sits next
   * to. `parSilence.badgePerRow` is the pure switch that turns row badges on by itself the
   * day silence stops being the majority — no flag, no follow-up PR.
   */
  parSilence: ParSilenceSummary;
  /**
   * The machine is WATCHING, NOT TOUCHING. Drives ONE global banner above the vendor list
   * — never a per-row reason (r3: in v1 100% of rows are in shadow, so a per-row badge
   * would badge everything). Read off the ledger's own `mode`, so it says what actually
   * happened at this shop rather than what the build believes.
   */
  shadowMode: boolean;
  vendors: WalkerVendor[];
}

/**
 * MULTI-VENDOR AUDIT P4 (docs/audits/2026-08-20-multivendor-semantics-audit.md).
 *
 * A par IS a demand statement: "keep 3 of these on the shelf". The walk gates on
 * par AND active on the SAME row, and every exclusion below was a bare `continue` —
 * so deactivating a SKU (or its vendor) silently DELETED that demand. No suggestion,
 * no warning, no rerouting to the twin. The manager sees a shorter list and cannot
 * tell the difference between "nothing needed" and "the system forgot".
 *
 * This is not hypothetical. Live at filing time: Ham and Fresh Mozzarella each have
 * their par on the INACTIVE twin while the active twin carries no par — so both are
 * UNORDERABLE, and Ham alone is ~$2,164.94/yr of spend the walker cannot suggest.
 * They were invisible precisely because the drop was silent.
 *
 * Counting only — the walk itself is deliberately unchanged (rerouting demand to a
 * backup SKU needs the product-identity layer, audit P2). This just makes the
 * silence audible.
 */
export interface WalkerUnroutable {
  /** Total par-carrying SKUs with no ordering path today (sum of the causes below). */
  count: number;
  /** The SKU itself is inactive (globally, or by per-location overlay) — the twin case. */
  skuInactive: number;
  /** The SKU's vendor is inactive or missing — the vendor-down case. */
  vendorInactive: number;
  /** The SKU names no vendor at all, so no one can be asked for it. */
  noVendor: number;
  /**
   * A par'd member of a PRODUCT dropped out today (deactivated / vendor down) and
   * the product had no other member that could carry it either. The one cause that
   * only exists because products exist: a member with no par of its own used to be
   * invisible here, and its product's demand vanished with it.
   */
  productUnroutable: number;
  /**
   * A par'd SKU whose PRODUCT is retired — the par is suppressed, not mutated
   * (Juan's ruling, 2026-08-21).
   *
   * WHY THIS REACHES ORDERING AT ALL. Juan: *"discontinuation is about stopping the
   * SKU from being ordered etc… pars should be affected if less demand for that SKU
   * is happening."* Pars are DOWNSTREAM of demand — they exist because recipes create
   * demand — so a retired product's pars are stale by definition and continuing to
   * suggest them orders stock nothing consumes. Swapping a product out of ONE recipe
   * is just recipe editing and touches none of this; RETIREMENT means "we stop buying
   * this entirely", which is precisely an ordering-layer decision.
   *
   * SUPPRESSED, NEVER MUTATED. The `weekday_par`/`weekend_par` columns are untouched,
   * so bringing the product back restores the exact prior walk with no par re-entry —
   * reversibility is the whole reason this is a read-time gate and not a write.
   *
   * SUMMED into `count` and rendered in the warn lane, unlike `reroutedToBackup`
   * below: the demand is being deliberately deleted and a now-stale par row is left
   * behind, so there IS an errand (clear the par once the last order is burned down,
   * or bring the product back). Loud, never silent — the P4 law.
   */
  productRetired: number;
  /**
   * How many WALKED rows carry a par-review advisory (Juan, 2026-08-21). NOT a fault
   * and deliberately NOT summed into `count`: these rows order perfectly well today.
   * The par behind them has simply lost a demand source, and saying so early is the
   * whole point — "the system recognizes what's going on before the human does".
   */
  parReview: number;
  /**
   * NOT a fault — the POSITIVE signal (0179). A par whose own SKU could not be
   * routed today was carried by another member of the same product, so the demand
   * MOVED instead of evaporating. Rendered informationally, never as an alarm, and
   * deliberately NOT summed into `count`: nothing here needs fixing.
   */
  reroutedToBackup: number;
}

/** The columns every walker row needs — one spelling, shared by the par'd-SKU read
 *  and the rerouted-backup read (a member with no par of its own is not in the first).
 *  EXPORTED for the nightly pars engine (lib/dynamic-pars.ts), which walks the same
 *  par'd-SKU universe: one column list, so the engine can never read a narrower SKU
 *  than the walker renders. */
export const WALKER_SKU_COLUMNS =
  "id, name, vendor_id, item_number, active, pack_format, weekday_par, weekend_par, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each, product_id, inventory_only";

interface WalkerSkuRow {
  id: string; name: string; vendor_id: string | null; item_number: string | null; active: boolean;
  pack_format: string | null; weekday_par: number | string | null; weekend_par: number | string | null;
  each_container_label: string | null; units_per_pack: number | null;
  each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null;
  product_id: string | null;
  /** Packaging / cleaning supplies — their pars were never recipe-derived. */
  inventory_only: boolean | null;
}

/**
 * Load the par-pass walker payload for a location (KH+ + location-bind). Vendors with
 * ≥1 active par'd SKU, ordered isOrderDay-first then name; each vendor's SKUs ordered
 * by usage rank desc then name. A SKU is INCLUDED iff it is active, carries a vendor,
 * and has weekday_par OR weekend_par set (resolvePar in location-sku-shared resolves which applies today, overlay-first).
 *
 * BATCH: one loadOnHand, one chains load, one measures load, one usage-rank pass, one
 * last-order-qty query (via the sku_ix), and one vendor lookup. No per-SKU I/O.
 */
export async function loadWalkerData(actor: AuthContext, locationId: string): Promise<WalkerData> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  // ET-anchored walk day (single authority — etWalkDay()). Never inline this derivation
  // again; all day-rule consumers must call etWalkDay() to stay in sync with the display.
  const { walkDateEt, weekend, todayDow } = etWalkDay();

  // Par'd SKUs (global rows; item spine is location-scoped via the ledgers, not the
  // vendor_items row — same as counts/receiving). A SKU with neither par is excluded.
  // NOTE: we do NOT filter `.eq("active", true)` here — inclusion is governed by
  // resolveActive(overlay.activeOverride, s.active) below, so a promotional overlay
  // (active_override = true on a globally-INACTIVE SKU, spec §2.1) surfaces. Filtering
  // on the global flag first would make that override dead. `active` is selected.
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select(WALKER_SKU_COLUMNS)
    .or("weekday_par.not.is.null,weekend_par.not.is.null")
    .returns<WalkerSkuRow[]>();
  if (sErr) throw new Error(`loadWalkerData skus: ${sErr.message}`);
  // P4: every exclusion from here on is COUNTED, not just skipped — a dropped par is
  // deleted demand, and the manager has to be able to see it. Classification is
  // first-cause-wins in walk order (vendorless → vendor-down → deactivated).
  const unroutable: WalkerUnroutable = {
    count: 0, skuInactive: 0, vendorInactive: 0, noVendor: 0,
    productUnroutable: 0, productRetired: 0, parReview: 0, reroutedToBackup: 0,
  };
  const skus = (skuRows ?? []).filter((s) => s.vendor_id != null); // a par'd SKU with no
  // vendor can't be ordered from anyone → excluded (schema allows null vendor_id, live
  // data has none today; defensive — and now counted rather than silently dropped).
  unroutable.noVendor = (skuRows ?? []).length - skus.length;
  unroutable.count = unroutable.noVendor;
  if (skus.length === 0) {
    // No par'd SKUs anywhere → we return BEFORE the loadOnHand batch below, so
    // salesThrough is unknown here. Can't-know → don't claim: false (there is also no
    // walker row for a blackout banner to explain). The unroutable tally still ships:
    // "every par'd SKU is unorderable" is exactly when the notice matters most.
    return {
      walkDate: walkDateEt, isWeekendPar: weekend, advisoryPaused: false, unroutable,
      // No par'd SKU anywhere means there is no par to be quiet ABOUT, and no walk for a
      // banner to sit on. Claim nothing rather than reporting a zeroed summary.
      parSilence: EMPTY_PAR_SILENCE, shadowMode: false, vendors: [],
    };
  }
  const skuIds = skus.map((s) => s.id);
  const vendorIds = [...new Set(skus.map((s) => s.vendor_id as string))];
  // The two facts the par ledger does not carry, from rows this function already holds —
  // so the suggestion payload and the reason lane add no `vendor_items` read of their own.
  const parSkuIndex: ReadonlyMap<string, ParSkuIndexEntry> = new Map(
    skus.map((s) => [s.id, { vendorId: s.vendor_id, name: s.name }]),
  );
  // THE WALK INSTANT (R3-A). The day-class comes from the ALREADY-DERIVED `weekend` flag,
  // never from a second derivation — etWalkDay() is the one home for the day rule, and a
  // walk whose horizon disagreed with its own weekend badge would be incoherent.
  const walkInstant = {
    walkDateEt,
    walkMinutesEt: minutesOfDayEt(new Date()),
    dayClass: (weekend ? "weekend" : "weekday") as "weekday" | "weekend",
    // THE LEVEL-7 CHECK, RESOLVED SERVER-SIDE (plan D1). The walker RENDERS at
    // PAR_PASS_MIN (4) for transparency; ACTING on a suggestion is the same authority
    // that may edit the par in the admin console today, no more and no less.
    canAct: getRoleLevel(actor.user.role) >= PAR_WRITE_MIN,
  };

  // BATCH loads (one each — loadRecipeGraph law).
  // overlayBySku: per-location active/par overrides; empty map = day-one (pure inheritance).
  const productIds = [...new Set(skus.map((s) => s.product_id).filter((v): v is string => v != null))];
  const eventWindowEnd = addDaysEt(walkDateEt, EVENT_ADVISORY_HORIZON_DAYS);
  const [chainsBySku, measures, rawUsageBySku, onHandView, { data: vendorRows, error: vErr }, lastOrderBySku, overlayBySku, cutoffsByVendor, productIndex, demandSources, suggestionBySku, parSilence, cateringDemand] =
    await Promise.all([
      loadSkuPackChains(skuIds),
      loadMeasures(),
      loadSkuUsageRank(sb, locationId),
      loadOnHandDerived(actor, locationId), // ONE advisory on-hand pass for the whole location.
      sb.from("vendors").select("id, name, order_days").in("id", vendorIds).eq("active", true)
        .returns<Array<{ id: string; name: string; order_days: number[] | null }>>(),
      loadLatestOrderQtyBySku(sb, skuIds),
      loadOverlayBySku(sb, locationId),
      loadCutoffsByVendor(sb, vendorIds, locationId, todayDow),
      // THE SAME loader the recipe graph uses — one resolution ladder, not two
      // (0179). Zero products → zero queries.
      loadProductIndex(productIds, locationId),
      // Which recipes still create demand for these pars, and which stopped (2026-08-21).
      loadDemandSources(sb, skus),
      // ── DYNAMIC PARS (Task 4.2) — THREE MORE PARALLEL PROMISES, NO SERIAL STEP ──
      // The batch law is preserved: the walk gains no round trip it did not already wait
      // on, and none of the three reads is per-SKU. Each degrades to an honest empty
      // before its migration is applied, so the walk is byte-identical pre-0182.
      loadParSuggestions(sb, locationId, walkInstant, parSkuIndex),
      loadParSilence(sb, locationId, walkDateEt, parSkuIndex),
      // The catering event advisory (plan D11): its actor-less core, because this walk's
      // floor is KH (4) and the catering-demand read's is 6. A NAME AND A DATE, never a
      // number that enters any target.
      //
      // FAIL-SOFT, AND ONLY THIS ONE. The shelf walk never depended on the catering
      // subsystem before this phase, and a 6 AM walk must not 500 because a dormant
      // module hiccupped over a display line. The two par reads above are deliberately
      // NOT wrapped: they are this arc's own, and swallowing their errors would hide the
      // defect the reason lane exists to surface.
      deriveCateringSkuDemand({ locationId, from: walkDateEt, to: eventWindowEnd })
        .catch((e: unknown) => {
          console.warn(`[ordering] catering event advisory unavailable: ${String(e)}`);
          return { rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 };
        }),
    ]);
  if (vErr) throw new Error(`loadWalkerData vendors: ${vErr.message}`);
  const vendorById = new Map((vendorRows ?? []).map((v) => [v.id, v]));
  const advisoryBySku = advisoryOnHandBySku(onHandView);
  // D9 — members of one product SHARE the product's trailing usage, so the backup
  // twin stops sorting dead last (`?? -Infinity`) just because every pin points at
  // its sibling. Applied at the call site so the two loads stay parallel; the
  // rollup itself is pure and test-pinned (tests/products-rollup.test.ts).
  const usageBySku = rollupUsageByProduct(rawUsageBySku, productIndex.productBySku);

  // Advisory blackout (council UX finding 2026-08-08): the depletion ledger lags the
  // register by a day — the nightly cron materializes T-1. If it has materialized
  // BEFORE but its latest business_date is older than yesterday, last night's run
  // hasn't landed yet, so the advisory feed is mid-refresh and the walker's estimates
  // + Suggest chips are thin for reasons that have nothing to do with the shelf.
  // `< yesterday` is the exact complement of what the cron writes
  // (app/api/cron/toast-sales-pull: materializes etYmdMinusDays(etCalendarDate(now), 1)).
  // null salesThrough = Toast never materialized here = DORMANT, not paused → false.
  const yesterdayEt = etYmdMinusDays(etCalendarDate(new Date().toISOString()), 1);
  const advisoryPaused =
    onHandView.salesThrough != null && onHandView.salesThrough < yesterdayEt;

  // Booked catering per SKU, as dated cells. Kept in date order so a row can take the
  // EARLIEST event inside its own horizon without re-sorting per row.
  const cateringBySku = new Map<string, Array<{ needDate: string; oz: number }>>(
    cateringDemand.rows.map((r) => [
      r.skuId,
      [...r.byDate].sort((a, b) => a.needDate.localeCompare(b.needDate)),
    ]),
  );

  // ── Row construction, shared by the par'd walk AND the rerouted-backup path ──
  // A backup member carries no par of its own, so it is not in `skus`; when a
  // product's par'd member cannot be routed today its row is built from the SAME
  // function, with the unroutable member's par. One builder, no second opinion.
  const buildRow = (
    s: WalkerSkuRow,
    par: number,
    parIsWeekend: boolean,
    reroutedFromSkuId: string | null,
  ): WalkerSku => {
    const chain = chainsBySku.get(s.id) ?? null;
    const skuShape: RecipeInputSku = {
      packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
      unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
      avgOzPerEach: num(s.avg_oz_per_each), packChain: chain,
    };
    const perUnitOz = perOrderUnitOz(skuShape, chain, measures);

    // Advisory on-hand → order-unit equivalent (oz ÷ per-order-unit-oz). Null unless
    // BOTH the advisory oz and the per-unit oz are present (never fabricate a unit count).
    const adv = advisoryBySku.get(s.id) ?? null;
    let advisoryOnHand: WalkerSku["advisoryOnHand"] = null;
    let suggestedQty: number | null = null;
    if (adv != null) {
      const orderUnits = perUnitOz != null && perUnitOz > 0 ? adv.oz / perUnitOz : null;
      advisoryOnHand = { oz: adv.oz, orderUnits, source: adv.source };
      if (orderUnits != null) {
        // Suggest ordering up to par: max(par − on-hand-units, 0), ceil to whole units.
        suggestedQty = Math.max(Math.ceil(par - orderUnits), 0);
      }
    }
    const entry = s.product_id != null ? productIndex.byProduct.get(s.product_id) ?? null : null;
    // The par-review advisory (Juan, 2026-08-21). Computed HERE, in the one row
    // builder both the par'd walk and the rerouted-backup path share, so a rescued
    // backup row carries the same nudge its twin would have — the advisory is about
    // the PAR, and the par is what moved.
    //
    // `product_retired` cannot actually reach a row: those SKUs are suppressed by the
    // walk's cause ladder before a row is built, and they surface in the notice lane
    // instead. It stays in the pure rule as the documented top rung.
    const parAdvisory = parReviewAdvisory({
      inventoryOnly: s.inventory_only ?? false,
      productRetired: entry?.resolution.reason === "retired_product",
      activeRecipeRefs: demandSources.activeRefsBySku.get(s.id) ?? 0,
      removedSources: demandSources.removedSourcesBySku.get(s.id) ?? [],
    });
    // ── DYNAMIC PARS, IN THE ONE ROW BUILDER BOTH WALK PATHS SHARE (Task 4.2) ────
    // KEYED ON THIS ROW'S OWN SKU, and that matters on the rerouted-backup path: unlike
    // the #283 advisory (which is about the PAR, so it travels with a rescued par), a
    // suggestion is a number in ONE vendor's order units, computed from that vendor's
    // pack and weight. Handing the dropped twin's number to the backup would state it in
    // the wrong unit. A rescued backup with no ledger row of its own therefore renders no
    // number — the honest answer, not a gap.
    //
    // A RETIRED product never reaches here at all: those SKUs `continue` in the cause
    // ladder above, so retirement suppression cannot be overridden by construction
    // (spec, "What it never does").
    const parSuggestion = suggestionBySku.get(s.id) ?? null;
    // THE HORIZON THIS ROW IS BEING ASKED TO SURVIVE. With a suggestion it is the live
    // re-selected coverThrough; without one the walk's outer event window, because a row
    // with no coverage claim still has booked catering worth naming.
    const eventThrough = parSuggestion?.coverThroughDate ?? eventWindowEnd;
    const parEvent =
      (cateringBySku.get(s.id) ?? []).find(
        (c) => c.needDate > walkDateEt && c.needDate <= eventThrough,
      ) ?? null;
    return {
      skuId: s.id,
      name: s.name,
      // THE EXCLUSIVITY, ENFORCED IN THE ONE BUILDER (r1). When both exist the NUMBER
      // wins: a suggestion naming a coverage horizon is strictly more actionable than
      // "a recipe changed", and two claimants on one row at 6 AM is over-correction.
      // The `parReview` counter reads the FINAL rows, so it reflects this automatically.
      parAdvisory: parSuggestion != null ? null : parAdvisory,
      parSuggestion,
      parEvent: parEvent != null ? { needDate: parEvent.needDate, oz: parEvent.oz } : null,
      itemNumber: s.item_number,
      orderUnitLabel: orderUnitLabelFor(s.pack_format, chain),
      parToday: par,
      parIsWeekend,
      lastOrderQty: lastOrderBySku.get(s.id) ?? null,
      advisoryOnHand,
      suggestedQty,
      // Display-only (see WalkerSku.canImplyOz): same gate as orderUnits above, so the
      // row can explain a permanently absent estimate/chip instead of just showing none.
      canImplyOz: perUnitOz != null && perUnitOz > 0,
      productId: s.product_id,
      productName: entry?.name ?? null,
      memberRole: entry == null ? "solo" : entry.primarySkuId === s.id ? "primary" : "backup",
      reroutedFromSkuId,
    };
  };

  /** A par'd row that could not be routed today, kept so its product can rescue it. */
  interface DroppedPar {
    row: WalkerSkuRow;
    productId: string;
    par: number;
    parIsWeekend: boolean;
    cause: "skuInactive" | "vendorInactive";
  }

  // Build a per-SKU WalkerSku, grouped under its (active) vendor.
  const skusByVendor = new Map<string, WalkerSku[]>();
  /** Walkable candidates per product — the dedupe input (two members, ONE suggestion). */
  const candidatesByProduct = new Map<string, WalkerSku[]>();
  const droppedByProduct = new Map<string, DroppedPar[]>();
  /** Member rows that dropped for par-null; a finding only if the product ends unwalked. */
  const parNullMemberProducts = new Set<string>();
  const walkedSkuIds = new Set<string>();
  for (const s of skus) {
    const vendorId = s.vendor_id as string;
    // Resolve active + par through the per-location overlay (D1) BEFORE the cause
    // ladder, so the ladder judges the same values the walk would use. Day-one: no
    // overlay rows → resolveActive/resolvePar reduce to the global values,
    // byte-identical to prior behavior. These are pure map lookups with no I/O, so
    // hoisting them above the vendor check costs nothing and buys the thing that
    // matters: ONE place where the exclusion order is decided.
    //
    // Inclusion governed by the overlay-over-global active resolution (D1): an overlay
    // active_override wins over the global `active` flag — so a promotional SKU
    // (override true, globally inactive) is INCLUDED and a locally-deactivated SKU
    // (override false, globally active) is EXCLUDED. Global inactive + no override → excluded.
    // parIsWeekend: true when the resolved par came from the weekend_par slot. Mirrors
    // the day rule (weekend pair member w/ weekday fallback) applied to resolved values.
    const overlayRow = overlayBySku.get(s.id) ?? null;
    // The WHOLE overlay goes to the resolver, machine lane included. The old two-field
    // copy predates that lane; keeping it would silently strip the auto columns and make
    // resolvePar's third lane unreachable from the one surface that renders pars.
    const overlayForPar: LocationSkuOverlay | null = overlayRow;
    const globalPar = { weekdayPar: num(s.weekday_par), weekendPar: num(s.weekend_par) };
    // Did the WEEKEND SLOT resolve to anything? That is a lane question, not a day-rule
    // question, so it goes through the same ladder rather than a second `?? global` here.
    const resolvedWeekendPar = resolveParSlot(overlayForPar, globalPar, "weekend").value;
    const parIsWeekend = weekend && resolvedWeekendPar != null;
    const par = resolvePar(overlayForPar, globalPar, weekend);

    // ── THE CAUSE LADDER — decided ONCE, by the pure rule ────────────────────────
    // `walkDisposition` (lib/location-sku-shared.ts) owns first-cause-wins so the
    // order is stated in exactly one place and is unit-testable; re-expressing it as
    // a chain of conditions here would be a second opinion about which cause wins.
    //
    // Retirement ranks FIRST (Juan's ruling, 2026-08-21). A retired product means "we
    // stop buying this entirely", so it does not matter that the vendor is down or the
    // twin is deactivated — reporting "turn the vendor back on" for something Juan
    // discontinued sends him on an errand he already decided against.
    //
    // Read through `resolution.reason`, not the raw column: the ladder in
    // lib/products-shared.ts is the one authority on what retirement means, and the
    // costing drawer and the readiness lane ask it the same way.
    const productEntry = s.product_id != null ? productIndex.byProduct.get(s.product_id) ?? null : null;
    const disposition = walkDisposition({
      productRetired: productEntry?.resolution.reason === "retired_product",
      vendorKnown: vendorById.has(vendorId),
      skuActive: resolveActive(overlayRow?.activeOverride, s.active),
      par,
    });

    if (disposition === "productRetired") {
      // SUPPRESSED, NOT MUTATED: the par columns are untouched, so bringing the
      // product back restores this exact walk with no par re-entry.
      //
      // The `continue` is load-bearing in three places at once — the row never
      // reaches `candidatesByProduct` (no suggestion), never reaches
      // `droppedByProduct` (no vendor-down rescue to a sibling member, which would
      // re-order the very product we stopped buying), and never reaches
      // `parNullMemberProducts` (so it cannot ALSO be counted as productUnroutable
      // below). One row, one cause.
      unroutable.productRetired += 1; unroutable.count += 1;
      continue;
    }
    if (disposition === "vendorInactive") {
      // Vendor inactive/missing → SKU dropped with it (P4: counted, not silent).
      unroutable.vendorInactive += 1; unroutable.count += 1;
      // Hold the par for the product: a vendor going down is exactly when another
      // member should carry the demand (0179), rather than it evaporating silently.
      if (s.product_id != null && par != null) {
        const list = droppedByProduct.get(s.product_id) ?? [];
        list.push({ row: s, productId: s.product_id, par, parIsWeekend, cause: "vendorInactive" });
        droppedByProduct.set(s.product_id, list);
      }
      continue;
    }
    if (disposition === "skuInactive") {
      // P4 — the deactivated-twin case. With products (0179) this is no longer the end
      // of the story: the par is held for the product below, and if another member can
      // carry it the demand MOVES instead of evaporating.
      unroutable.skuInactive += 1; unroutable.count += 1;
      if (s.product_id != null && par != null) {
        const list = droppedByProduct.get(s.product_id) ?? [];
        list.push({ row: s, productId: s.product_id, par, parIsWeekend, cause: "skuInactive" });
        droppedByProduct.set(s.product_id, list);
      }
      continue;
    }
    // `par == null` is IMPLIED by the disposition (that is what "parNull" means once
    // the three causes above have not fired); it is repeated only so the type checker
    // can narrow `par` for buildRow below. The DECISION still has one author.
    if (disposition === "parNull" || par == null) {
      // Neither resolved par applies today (excluded from the walk — normal for a
      // weekday-only par on a weekend). For a MEMBER it is worth remembering: if the
      // product ends the walk with no row at all, that silence is a finding.
      if (s.product_id != null) parNullMemberProducts.add(s.product_id);
      continue;
    }

    const row = buildRow(s, par, parIsWeekend, null);
    walkedSkuIds.add(s.id);
    if (s.product_id != null) {
      const list = candidatesByProduct.get(s.product_id) ?? [];
      list.push(row);
      candidatesByProduct.set(s.product_id, list);
      continue; // grouped after the product dedupe below.
    }
    const arr = skusByVendor.get(vendorId) ?? [];
    arr.push(row);
    skusByVendor.set(vendorId, arr);
  }

  // ── Product dedupe: two active members of one product = ONE suggestion ────────
  // (audit P2 — "the walk double-suggests when both twins carry a par"). The kept
  // row is the RESOLVED member; if the resolution is not among today's walkable
  // candidates, the designated primary, else a stable name order. The dropped rows
  // are NOT unroutable: their demand is carried by the row we kept.
  //
  // A RETIRED product never gets here: the retirement gate at the top of the walk
  // loop `continue`s before a candidate is recorded, so `candidatesByProduct` holds
  // no entry for one. `entry.resolution.skuId` is therefore non-null for every
  // product this loop actually sees, and the two fallbacks below remain what they
  // always were — the vendor-down and not-walkable-today cases, not retirement.
  const vendorOf = (skuId: string): string | null => skus.find((s) => s.id === skuId)?.vendor_id ?? null;
  for (const [productId, candidates] of candidatesByProduct) {
    const entry = productIndex.byProduct.get(productId) ?? null;
    const preferred =
      candidates.find((c) => c.skuId === entry?.resolution.skuId) ??
      candidates.find((c) => c.skuId === entry?.primarySkuId) ??
      // TOTAL order: twins share a NAME by construction (that is what makes them twins —
      // see counts-shared twinVendorLabels), so name alone leaves the winner to the
      // unordered vendor_items select that filled `skus`, and which vendor gets today's
      // suggestion would differ between two renders of the same data. `skuId` decides it.
      [...candidates].sort((a, b) => (a.name !== b.name ? a.name.localeCompare(b.name) : a.skuId.localeCompare(b.skuId)))[0]!;
    for (const c of candidates) {
      if (c.skuId !== preferred.skuId) walkedSkuIds.delete(c.skuId);
    }
    const vendorId = vendorOf(preferred.skuId);
    if (vendorId == null) continue; // unreachable: a candidate always had a live vendor.
    const arr = skusByVendor.get(vendorId) ?? [];
    arr.push(preferred);
    skusByVendor.set(vendorId, arr);
  }

  // ── Vendor-down failover: a dropped par is carried by another member ──────────
  // THE behavior this arc exists for. A par'd member that cannot be routed today
  // (deactivated, or its vendor is down) hands its par to the product's resolved
  // active member. If that member is already walked, the demand is simply covered;
  // if it carries no par of its own it is not in `skus` at all, so its row is loaded
  // here and built with the DROPPED member's par.
  /**
   * A par whose demand ENDED UP ORDERED is not a lost par, so it must leave the fault
   * tally it was provisionally counted into at drop time (SIM-PI-1, sim day
   * 2026-08-21). Without this the vendor-down day renders both halves of a
   * contradiction at once: the amber box says "1 par'd product has no ordering path
   * today — nothing will be suggested for them" directly above the blue notice saying
   * "1 par moved to a backup item". The amber sentence is simply false, and it is
   * false on exactly the day this whole layer exists for. Same class as the August
   * sim's SIM-25 false all-clear, with the sign flipped: a false ALARM standing beside
   * its own resolution.
   *
   * The whole product's dropped pars are released, not just the carried one: the walk
   * shows ONE row per product, so once that row exists the product is being ordered
   * and no par under it went unrouted.
   */
  const releaseDropped = (dropped: ReadonlyArray<DroppedPar>): void => {
    for (const d of dropped) {
      unroutable[d.cause] = Math.max(0, unroutable[d.cause] - 1);
      unroutable.count = Math.max(0, unroutable.count - 1);
    }
  };

  /** member sku id → the par it carries + every dropped par its product releases. */
  const rescueTargets = new Map<string, { carried: DroppedPar; dropped: DroppedPar[] }>();
  for (const [productId, dropped] of droppedByProduct) {
    const entry = productIndex.byProduct.get(productId) ?? null;
    if (entry == null) { unroutable.productUnroutable += dropped.length; continue; }
    // Highest par first: if two members dropped, the survivor carries the larger demand.
    // `par` ties are the common case (two twins on the same number), so `row.id` makes
    // the order TOTAL rather than dependent on the unordered select that filled `skus`.
    const worst = [...dropped].sort((a, b) => (b.par !== a.par ? b.par - a.par : a.row.id.localeCompare(b.row.id)))[0]!;
    const covered = (candidatesByProduct.get(productId) ?? []).some((c) => walkedSkuIds.has(c.skuId));
    if (covered) { unroutable.reroutedToBackup += 1; releaseDropped(dropped); continue; }
    // Nobody walked for this product — try the resolved member, else any active member
    // with a live vendor. Both must be a DIFFERENT sku than the one that dropped.
    //
    // A RETIRED product cannot reach this loop either: the gate at the top of the
    // walk `continue`s before its members are held in `droppedByProduct`, so there
    // is nothing here to rescue. That is the point — rescuing a dropped par to a
    // sibling member would re-order the very product we stopped buying, which is
    // exactly what Juan's ruling forbids.
    const droppedIds = new Set(dropped.map((d) => d.row.id));
    const byPreference = [
      ...entry.members.filter((m) => m.skuId === entry.resolution.skuId),
      ...entry.members,
    ];
    const target = byPreference.find(
      (m) => m.active && !droppedIds.has(m.skuId) && m.vendorId != null && vendorById.has(m.vendorId),
    );
    if (!target) { unroutable.productUnroutable += 1; continue; }
    rescueTargets.set(target.skuId, { carried: worst, dropped });
  }

  if (rescueTargets.size > 0) {
    const rescueIds = [...rescueTargets.keys()];
    const [{ data: rescueRows, error: rErr }, rescueChains] = await Promise.all([
      sb.from("vendor_items").select(WALKER_SKU_COLUMNS).in("id", rescueIds).returns<WalkerSkuRow[]>(),
      loadSkuPackChains(rescueIds),
    ]);
    if (rErr) throw new Error(`loadWalkerData rerouted backups: ${rErr.message}`);
    for (const [id, chain] of rescueChains) chainsBySku.set(id, chain);
    for (const r of rescueRows ?? []) {
      const rescue = rescueTargets.get(r.id);
      if (!rescue || r.vendor_id == null || !vendorById.has(r.vendor_id)) continue;
      const { carried } = rescue;
      const row = buildRow(r, carried.par, carried.parIsWeekend, carried.row.id);
      walkedSkuIds.add(r.id);
      unroutable.reroutedToBackup += 1;
      // Released only once the row REALLY exists — a rescue that fell through the two
      // guards above leaves the fault standing, which is the honest reading.
      releaseDropped(rescue.dropped);
      const arr = skusByVendor.get(r.vendor_id) ?? [];
      arr.push(row);
      skusByVendor.set(r.vendor_id, arr);
    }
  }

  // A member that dropped for par-null AND whose product ends the walk with no row
  // at all: the one genuinely silent drop left in the loop, now named.
  for (const productId of parNullMemberProducts) {
    const walked = (candidatesByProduct.get(productId) ?? []).some((c) => walkedSkuIds.has(c.skuId));
    const rescued = [...rescueTargets.keys()].some((id) => productIndex.productBySku.get(id) === productId && walkedSkuIds.has(id));
    if (!walked && !rescued) unroutable.productUnroutable += 1;
  }

  // Par-review advisories, counted off the FINAL rendered rows rather than inside
  // buildRow: the product dedupe builds a row for every walkable twin and then keeps
  // only one, so counting at construction would report advisories the manager never
  // sees. The notice must match the badges exactly or it is just noise.
  for (const rows of skusByVendor.values()) {
    for (const r of rows) if (r.parAdvisory != null) unroutable.parReview += 1;
  }

  // Assemble vendor groups: usage desc then name within a vendor; vendors isOrderDay-first
  // then name; vendors with zero par'd SKUs omitted (skusByVendor never holds an empty arr).
  // The cutoff chip: today's governing cutoff time (formatted via the house formatter) + a
  // server-computed cutoffSoon (within 2h of now) so the client renders tone without time math.
  const nowMs = Date.now();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const vendors: WalkerVendor[] = [];
  for (const [vendorId, vendorSkus] of skusByVendor) {
    const v = vendorById.get(vendorId)!;
    vendorSkus.sort((a, b) => {
      const ua = usageBySku.get(a.skuId) ?? -Infinity; // null usage sorts last.
      const ub = usageBySku.get(b.skuId) ?? -Infinity;
      if (ua !== ub) return ub - ua; // usage desc.
      return a.name.localeCompare(b.name);
    });
    // Cutoff for today (most-specific-wins, earliest-time — mirrors purchase-orders.ts).
    const cutoffBare = governingCutoffTime(cutoffsByVendor.get(vendorId) ?? [], locationId);
    let cutoffTimeToday: string | null = null;
    let cutoffSoon = false;
    if (cutoffBare != null) {
      const cutoffIso = cutoffWallClockToUtcIso(walkDateEt, cutoffBare);
      if (cutoffIso != null) {
        // Format the bare TIME through the house formatter (operational TZ + language-aware)
        // by composing it onto today's ET instant. formatTime → "h:mm AM/PM".
        cutoffTimeToday = formatTime(cutoffIso, actor.user.language);
        const cutoffMs = Date.parse(cutoffIso);
        // "Soon" = the deadline is in the future AND within 2h (a passed cutoff is not "soon").
        cutoffSoon = Number.isFinite(cutoffMs) && cutoffMs >= nowMs && cutoffMs - nowMs <= TWO_HOURS_MS;
      }
    }
    vendors.push({
      vendorId,
      name: v.name,
      isOrderDay: (v.order_days ?? []).includes(todayDow),
      cutoffTimeToday,
      cutoffSoon,
      skus: vendorSkus,
    });
  }
  vendors.sort((a, b) => {
    if (a.isOrderDay !== b.isOrderDay) return a.isOrderDay ? -1 : 1; // order-day vendors first.
    return a.name.localeCompare(b.name);
  });

  return {
    walkDate: walkDateEt, isWeekendPar: weekend, advisoryPaused, unroutable,
    parSilence, shadowMode: parSilence.shadowMode, vendors,
  };
}

/**
 * The latest (by created_at) par_pass_lines.order_qty per SKU — one batched, PAGED
 * scan over the sku_ix (sku_id, created_at desc; never per-SKU I/O). We pull the
 * rows for the SKU set and keep the FIRST seen per SKU in created_at-desc order
 * (the latest).
 */
async function loadLatestOrderQtyBySku(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  // PAGED (the PR #63 lesson): par_pass_lines grows one row per SKU per walk, so the
  // desc scan loses its tail past 1000 rows — and the tail is where a rarely-walked
  // SKU's only line lives. `id` is a tiebreaker ONLY (created_at stays the primary
  // sort key), making the order total so page boundaries can't reshuffle rows.
  const rows = await selectAllRows<{ sku_id: string; order_qty: number | string; created_at: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("par_pass_lines")
        .select("sku_id, order_qty, created_at")
        .in("sku_id", skuIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .returns<Array<{ sku_id: string; order_qty: number | string; created_at: string }>>();
      if (error) throw new Error(`loadLatestOrderQtyBySku: ${error.message}`);
      return { data };
    },
  );
  for (const r of rows) {
    if (out.has(r.sku_id)) continue; // desc order → first seen is the latest.
    const q = num(r.order_qty);
    if (q != null) out.set(r.sku_id, q);
  }
  return out;
}

// ── Location SKU overlay batch-load ─────────────────────────────────────────────
/** What loadOverlayBySku hands back per SKU: the human lane always, the MACHINE lane
 *  only once migration 0183 is applied (the auto fields are ABSENT before that, which is
 *  what keeps resolvePar's third lane inert and the walk byte-identical). */
export interface OverlayRow extends LocationSkuOverlay {
  activeOverride: boolean | null;
}

/** The human lane's columns — the exact select this function shipped with. */
const OVERLAY_HUMAN_COLUMNS = "sku_id, active_override, weekday_par, weekend_par";
/** …plus the machine lane (0183). Selected ONLY when the probe says the columns exist. */
const OVERLAY_AUTO_COLUMNS =
  "auto_weekday_par, auto_weekend_par, auto_weekday_baseline_par, auto_weekend_baseline_par";

/**
 * One query: all location_sku_settings rows for a location, keyed by sku_id.
 * Returns an empty map when no overlay rows exist (day-one behavior — pure inheritance).
 * BATCH LAW: one query per loadWalkerData / submitParPass call; never per-SKU.
 *
 * ── PRE-0183 DEGRADATION (Task 3.3; the 0180 probe precedent) ──────────────────
 * The select list is chosen by the probe, so before GATE M2 this issues EXACTLY the
 * query it issues on main today and returns objects with no `auto*` keys at all.
 * `resolveLane` then reads `undefined` for the machine lane and falls through to the
 * global par — the two-layer answer. After M2 the columns exist and are all NULL
 * (nothing writes them: PAR_AUTO_APPLY_ENABLED is false), so the resolved par is
 * unchanged again. Both halves of "byte-identical" hold, and independently.
 */
async function loadOverlayBySku(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<Map<string, OverlayRow>> {
  const autoLane = await parAutoLaneReady(sb);
  const { data, error } = await sb.from("location_sku_settings")
    .select(autoLane ? `${OVERLAY_HUMAN_COLUMNS}, ${OVERLAY_AUTO_COLUMNS}` : OVERLAY_HUMAN_COLUMNS)
    .eq("location_id", locationId)
    .returns<Array<{
      sku_id: string;
      active_override: boolean | null;
      weekday_par: number | string | null;
      weekend_par: number | string | null;
      auto_weekday_par?: number | string | null;
      auto_weekend_par?: number | string | null;
      auto_weekday_baseline_par?: number | string | null;
      auto_weekend_baseline_par?: number | string | null;
    }>>();
  if (error) throw new Error(`loadOverlayBySku: ${error.message}`);
  const out = new Map<string, OverlayRow>();
  for (const r of data ?? []) {
    const row: OverlayRow = {
      activeOverride: r.active_override,
      weekdayPar: num(r.weekday_par),
      weekendPar: num(r.weekend_par),
    };
    if (autoLane) {
      row.autoWeekdayPar = num(r.auto_weekday_par ?? null);
      row.autoWeekendPar = num(r.auto_weekend_par ?? null);
      row.autoWeekdayBaselinePar = num(r.auto_weekday_baseline_par ?? null);
      row.autoWeekendBaselinePar = num(r.auto_weekend_baseline_par ?? null);
    }
    out.set(r.sku_id, row);
  }
  return out;
}

// ── submitParPass: record the walk + derive draft orders + shrinkage ─────────────
export interface ParPassLineInput {
  skuId: string;
  orderQty: number;
  note?: string | null;
}
export interface DraftOrderLine {
  skuName: string;
  itemNumber: string | null;
  orderQty: number;
  orderUnitLabel: string | null;
}
export interface DraftOrderDelivery {
  method: string; // email | url | phone | portal | other
  value: string;
  label: string | null;
}
export interface DraftOrder {
  vendorId: string;
  vendorName: string;
  orderingDetails: DraftOrderDelivery[];
  lines: DraftOrderLine[];
  /** The birthed draft PO's display code for this vendor (spec §5b.3) — rendered as
   *  the first line of the copy/mailto body ("PO {displayCode}"). null when draft-PO
   *  creation failed (walk still succeeded — poError on the submit response). */
  displayCode: string | null;
  /** The vendor's order minimum in their own words (migration 0184) — "$350", "10 case
   *  minimum". ADVISORY ONLY, in every sense: nothing here compares the order against it,
   *  nothing warns, nothing blocks. It is the fact the person about to send this order
   *  needs in front of them, and it is deliberately NOT in the copy/mailto body — that
   *  body is what the VENDOR reads, and the vendor already knows their own minimum.
   *  null = none on file, and null while migration 0184 is unapplied. */
  orderMinimum: string | null;
}
export interface ShrinkageNotice {
  skuId: string;
  skuName: string;
  impliedOz: number;
  computedOz: number;
}

/**
 * The shrinkage divergence threshold (semantics block): the par-pass implied on-hand
 * and the computed advisory on-hand must differ by more than max(0.25 × par_oz, one
 * order-unit oz) to raise a notice. par_oz = parToday × perUnitOz (the full-par oz).
 * One order-unit oz is the noise floor (a single-unit rounding never trips it). Pure.
 */
function shrinkageDiverges(
  impliedOz: number,
  computedOz: number,
  parToday: number,
  perUnitOz: number,
): boolean {
  const threshold = Math.max(0.25 * parToday * perUnitOz, perUnitOz);
  return Math.abs(impliedOz - computedOz) > threshold;
}

/**
 * Record a par-pass EVENT + its lines (KH+, location-bind, NO step-up). Validates the
 * batch (non-empty; each SKU active + par'd today + orderQty finite ≥ 0), snapshots the
 * day's par, computes implied_on_hand_oz per line (advisory-null when the order-unit→oz
 * conversion is unconvertible — never fabricated), inserts the event then its lines
 * (house sequential pattern, each error-checked), audits, then derives:
 *   - draftOrders: per vendor, the orderQty > 0 lines + the vendor's ordering-detail
 *     delivery affordances (email/url/phone/portal/other; active, display_order).
 *   - shrinkage: lines whose implied on-hand diverges from the CURRENT computed advisory
 *     on-hand (from a loadOnHand pass inside this call) beyond the threshold.
 * Append-only — never DELETE/mutate a prior row.
 */
export async function submitParPass(
  actor: AuthContext,
  locationId: string,
  lines: ParPassLineInput[],
): Promise<{
  eventId: string;
  draftOrders: DraftOrder[];
  shrinkage: ShrinkageNotice[];
  /** The birthed draft POs (one per vendor with orderQty > 0 lines). Empty when
   *  nothing was ordered OR draft-PO creation failed (poError true). */
  pos: Array<{ vendorId: string; poId: string; displayCode: string }>;
  /** True when draft-PO creation threw — the par-pass (observation data) is still
   *  saved; the manager can re-generate drafts from the cutoff path. */
  poError: boolean;
}> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new OrderingError(400, "no_lines", "At least one line is required");
  }
  for (const l of lines) {
    if (typeof l.skuId !== "string" || !l.skuId) throw new OrderingError(400, "invalid_sku", "Each line needs a SKU");
    // Fractional order_qty is TOLERATED by design: seeded pars are fractional (e.g.
    // 0.25 jug) and submit must accept the matching fractional input without rounding.
    if (!Number.isFinite(l.orderQty) || l.orderQty < 0) throw new OrderingError(400, "invalid_qty", "Order qty must be zero or greater");
  }
  // Reject duplicate SKUs in one submission (a line grain is per-SKU; two rows for one
  // SKU would double-order and store contradictory implied on-hand).
  const skuIds = [...new Set(lines.map((l) => l.skuId))];
  if (skuIds.length !== lines.length) {
    throw new OrderingError(400, "duplicate_sku", "A SKU appears more than once");
  }

  const sb = getServiceRoleClient();
  // ET-anchored weekend rule — must match what loadWalkerData showed the manager.
  const { weekend } = etWalkDay();

  // Load the referenced SKUs (par shape + pack fields for oz + the global `active` flag).
  // We do NOT filter `.eq("active", true)` here — resolveActive(overlay.activeOverride,
  // sku.active) below governs each SKU's usability, so a promotional overlay (active_override
  // = true on a globally-inactive SKU, spec §2.1) is submittable while a locally-deactivated
  // SKU is rejected. A SKU row simply MISSING (bad id) is still rejected loudly. overlayBySku
  // batch-loads per-location active/par overrides (D1); empty map = day-one (pure inheritance).
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select(WALKER_SKU_COLUMNS)
    .in("id", skuIds)
    .returns<WalkerSkuRow[]>();
  if (sErr) throw new Error(`submitParPass skus: ${sErr.message}`);
  const skuById = new Map((skuRows ?? []).map((s) => [s.id, s]));
  for (const id of skuIds) if (!skuById.has(id)) throw new OrderingError(400, "invalid_sku", "A SKU is not found or inactive");
  // Reject two lines naming two MEMBERS of one product (0179), for the same reason
  // duplicate_sku exists: the walk shows ONE row per product, so two lines would
  // double-order the same thing under two vendor names. The walk cannot produce
  // this (loadWalkerData dedupes by product) — it is the backstop, exactly like
  // duplicate_sku. lib/purchase-orders.ts keeps its per-SKU identity check: a PO is
  // per-vendor and per-SKU by nature.
  const seenProducts = new Set<string>();
  for (const s of skuRows ?? []) {
    if (s.product_id == null) continue;
    if (seenProducts.has(s.product_id)) {
      throw new OrderingError(400, "duplicate_product", "Two items of the same product appear in one walk");
    }
    seenProducts.add(s.product_id);
  }

  const [chainsBySku, measures, overlayBySku] = await Promise.all([
    loadSkuPackChains(skuIds),
    loadMeasures(),
    loadOverlayBySku(sb, locationId),
  ]);

  // Resolve each line: snapshot par, per-order-unit oz, implied on-hand oz.
  interface ResolvedLine {
    input: ParPassLineInput;
    sku: NonNullable<ReturnType<typeof skuById.get>>;
    parToday: number;
    orderUnitLabel: string | null;
    perUnitOz: number | null;
    impliedOnHandOz: number | null;
  }
  const resolved: ResolvedLine[] = [];
  for (const l of lines) {
    const sku = skuById.get(l.skuId)!;
    // Resolve active + par through the per-location overlay (D1). A SKU deactivated at this
    // location is rejected just like a globally inactive one (can't order a deactivated SKU).
    const overlayRow = overlayBySku.get(sku.id) ?? null;
    // Overlay-over-global active resolution (D1): a promotional override (true on a
    // globally-inactive SKU) is submittable; a locally-deactivated one (override false)
    // is rejected just like a globally inactive SKU with no override.
    if (!resolveActive(overlayRow?.activeOverride, sku.active)) {
      throw new OrderingError(400, "invalid_sku", "A SKU is not found or inactive");
    }
    // The whole overlay, machine lane included — same reasoning as loadWalkerData above.
    const overlayForPar: LocationSkuOverlay | null = overlayRow;
    const par = resolvePar(overlayForPar, { weekdayPar: num(sku.weekday_par), weekendPar: num(sku.weekend_par) }, weekend);
    if (par == null) throw new OrderingError(400, "no_par", "A SKU has no par set for today");
    const chain = chainsBySku.get(sku.id) ?? null;
    const skuShape: RecipeInputSku = {
      packFormat: sku.pack_format, eachContainerLabel: sku.each_container_label,
      unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure,
      avgOzPerEach: num(sku.avg_oz_per_each), packChain: chain,
    };
    const perUnitOz = perOrderUnitOz(skuShape, chain, measures);
    // implied on-hand = max(par − orderQty, 0) order units × per-unit oz. NEVER fabricate:
    // perUnitOz null → implied null (the conversion is unknowable).
    const impliedUnits = Math.max(par - l.orderQty, 0);
    const impliedOnHandOz = perUnitOz != null ? impliedUnits * perUnitOz : null;
    resolved.push({
      input: l, sku, parToday: par,
      orderUnitLabel: orderUnitLabelFor(sku.pack_format, chain),
      perUnitOz, impliedOnHandOz,
    });
  }

  // 1) Insert the event header (status submitted; append-only). House sequential pattern.
  const { data: ev, error: evErr } = await sb.from("par_pass_events").insert({
    location_id: locationId, walked_by: actor.user.id, status: "submitted", note: null,
  }).select("id").maybeSingle<{ id: string }>();
  if (evErr) throw new Error(`submitParPass event: ${evErr.message}`);
  if (!ev) throw new Error("submitParPass event returned no row");

  // 2) Insert the lines (zero-qty lines ARE stored — the explicit "we're full" observation).
  const { error: lErr } = await sb.from("par_pass_lines").insert(
    resolved.map((r) => ({
      event_id: ev.id,
      sku_id: r.sku.id,
      vendor_id: r.sku.vendor_id,
      par_qty: r.parToday, // snapshot of the day's par (order units).
      order_qty: r.input.orderQty,
      order_unit_label: r.orderUnitLabel,
      implied_on_hand_oz: r.impliedOnHandOz,
      note: r.input.note?.trim() || null,
    })),
  );
  if (lErr) throw new Error(`submitParPass lines: ${lErr.message}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "par_pass.submitted", resourceTable: "par_pass_events", resourceId: ev.id,
    metadata: { location_id: locationId, line_count: resolved.length },
    ipAddress: null, userAgent: null,
  });

  // ── Draft-PO birth (spec D2): group the orderQty > 0 lines by vendor and create one
  // `draft` PO per vendor. THE WALK IS SACRED: a PurchaseOrderError (or any throw) must
  // NOT lose the par-pass — the observation rows are already committed above. We wrap the
  // birth, log the failure, and return pos: [] with poError true; the manager re-generates
  // drafts from the cutoff path. On success, each vendor's display code threads into the
  // draft card + copy/mailto body ("PO {displayCode}"). ──
  const orderLines = resolved.filter((r) => r.input.orderQty > 0);
  const byVendor = new Map<string, DraftLineInput[]>();
  for (const r of orderLines) {
    const vid = r.sku.vendor_id;
    if (vid == null) continue; // a line with no vendor can't be ordered (never a PO).
    const arr = byVendor.get(vid) ?? [];
    arr.push({
      skuId: r.sku.id,
      orderQty: r.input.orderQty,
      orderUnitLabel: r.orderUnitLabel,
      note: r.input.note ?? null,
    });
    byVendor.set(vid, arr);
  }
  let pos: CreatedDraft[] = [];
  let poError = false;
  if (byVendor.size > 0) {
    try {
      pos = await createDraftsFromLines(actor, locationId, byVendor, ev.id);
    } catch (err) {
      // The par-pass is already persisted (event + lines above). A draft-PO failure is
      // isolated: log, flag poError, keep going — the walk's data is never poisoned. Both
      // PurchaseOrderError (typed lifecycle rejects, e.g. display_code_exhausted) and any
      // unexpected throw are swallowed here; the manager re-generates via the cutoff path.
      poError = true;
      const kind = err instanceof PurchaseOrderError ? `PurchaseOrderError(${err.code})` : "error";
      console.error(`submitParPass draft-PO creation failed [${kind}]`, err);
    }
  }
  const displayCodeByVendor = new Map(pos.map((p) => [p.vendorId, p.displayCode]));

  // ── Draft orders: per vendor, the orderQty > 0 lines + delivery affordances + PO code ──
  const draftOrders = await buildDraftOrders(sb, orderLines.map((r) => ({
    vendorId: r.sku.vendor_id, vendorName: null,
    line: {
      skuName: r.sku.name, itemNumber: r.sku.item_number,
      orderQty: r.input.orderQty, orderUnitLabel: r.orderUnitLabel,
    },
  })), displayCodeByVendor);

  // ── Shrinkage: implied on-hand vs the CURRENT computed advisory (a loadOnHand pass) ──
  const onHandView = await loadOnHandDerived(actor, locationId);
  const advisoryBySku = advisoryOnHandBySku(onHandView);
  const shrinkage: ShrinkageNotice[] = [];
  for (const r of resolved) {
    if (r.impliedOnHandOz == null || r.perUnitOz == null) continue; // implied side null → no compare.
    const adv = advisoryBySku.get(r.sku.id);
    if (adv == null) continue; // computed side null → no compare (advisory-null never trips).
    if (shrinkageDiverges(r.impliedOnHandOz, adv.oz, r.parToday, r.perUnitOz)) {
      shrinkage.push({ skuId: r.sku.id, skuName: r.sku.name, impliedOz: r.impliedOnHandOz, computedOz: adv.oz });
    }
  }

  return {
    eventId: ev.id,
    draftOrders,
    shrinkage,
    pos: pos.map((p) => ({ vendorId: p.vendorId, poId: p.poId, displayCode: p.displayCode })),
    poError,
  };
}

/**
 * Group orderQty > 0 lines into per-vendor draft orders, attaching each vendor's active
 * ordering-detail delivery affordances (method/value/label, display_order) and its
 * advisory order minimum (0184). ONE batched vendor lookup + ONE batched ordering-details
 * query (never per-vendor). A line with no vendor is dropped (can't be delivered
 * anywhere). Vendors ordered by name.
 */
async function buildDraftOrders(
  sb: ReturnType<typeof getServiceRoleClient>,
  entries: Array<{ vendorId: string | null; vendorName: string | null; line: DraftOrderLine }>,
  displayCodeByVendor?: Map<string, string>,
): Promise<DraftOrder[]> {
  const withVendor = entries.filter((e): e is { vendorId: string; vendorName: string | null; line: DraftOrderLine } => e.vendorId != null);
  if (withVendor.length === 0) return [];
  const vendorIds = [...new Set(withVendor.map((e) => e.vendorId))];

  // The 0184 order minimum rides the vendor-name read (no extra round trip), but the
  // column must not be NAMED until it exists: PostgREST rejects the whole select when one
  // named column is missing, which would 500 the par-pass submit for every deploy between
  // this PR and the gate. Probe first, then build the column list — the 0180/0182 pattern.
  const minimumReady = await vendorOrderMinimumReady(sb);
  const vendorSelect = minimumReady ? "id, name, order_minimum" : "id, name";

  const [{ data: vendorRows, error: vErr }, { data: detailRows, error: dErr }] = await Promise.all([
    sb.from("vendors").select(vendorSelect).in("id", vendorIds)
      .returns<Array<{ id: string; name: string; order_minimum?: string | null }>>(),
    sb.from("vendor_ordering_details")
      .select("vendor_id, method, value, label, display_order")
      .in("vendor_id", vendorIds).eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ vendor_id: string; method: string; value: string; label: string | null; display_order: number }>>(),
  ]);
  if (vErr) throw new Error(`buildDraftOrders vendors: ${vErr.message}`);
  if (dErr) throw new Error(`buildDraftOrders ordering details: ${dErr.message}`);
  const vName = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));
  const vMinimum = new Map((vendorRows ?? []).map((v) => [v.id, v.order_minimum ?? null]));
  const detailsByVendor = new Map<string, DraftOrderDelivery[]>();
  for (const d of detailRows ?? []) {
    const arr = detailsByVendor.get(d.vendor_id) ?? [];
    arr.push({ method: d.method, value: d.value, label: d.label });
    detailsByVendor.set(d.vendor_id, arr);
  }

  const linesByVendor = new Map<string, DraftOrderLine[]>();
  for (const e of withVendor) {
    const arr = linesByVendor.get(e.vendorId) ?? [];
    arr.push(e.line);
    linesByVendor.set(e.vendorId, arr);
  }

  const orders: DraftOrder[] = [];
  for (const [vendorId, orderLines] of linesByVendor) {
    orders.push({
      vendorId,
      vendorName: vName.get(vendorId) ?? "(vendor)",
      orderingDetails: detailsByVendor.get(vendorId) ?? [],
      lines: orderLines,
      displayCode: displayCodeByVendor?.get(vendorId) ?? null,
      orderMinimum: vMinimum.get(vendorId) ?? null,
    });
  }
  orders.sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  return orders;
}

// ── loadShrinkageSignals: cheap read-time divergence for the mid-shift pulse ──────
/**
 * Shrinkage signal for the mid-shift pulse (Task 3 caller). The LATEST submitted
 * par-pass event within 72h at this location; recompute the divergence set for its
 * lines against the CURRENT computed on-hand (same threshold as submit). Older than
 * 72h (or no event) → count 0. KH+ read + location-bind. CHEAP: one event lookup +
 * its lines + ONE loadOnHand pass (the pulse loader budget). Persists nothing.
 *
 * 72h (not 48h): a Friday-evening walk must still surface on Monday morning. The
 * Friday→Monday gap is ~60h at worst; 72h clears it with a comfortable buffer.
 */
export async function loadShrinkageSignals(
  actor: AuthContext,
  locationId: string,
): Promise<{ count: number; skus: Array<{ skuId: string; skuName: string; impliedOz: number; computedOz: number }> }> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  // 72h window: Friday-evening walks must still surface on Monday morning (the
  // Friday→Monday gap is ~60h; 72h clears it with a comfortable buffer).
  const cutoffIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const { data: ev, error: evErr } = await sb.from("par_pass_events")
    .select("id")
    .eq("location_id", locationId).eq("status", "submitted")
    .gte("walked_at", cutoffIso)
    .order("walked_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (evErr) throw new Error(`loadShrinkageSignals event: ${evErr.message}`);
  if (!ev) return { count: 0, skus: [] };

  const { data: lineRows, error: lErr } = await sb.from("par_pass_lines")
    .select("sku_id, par_qty, order_qty, implied_on_hand_oz")
    .eq("event_id", ev.id)
    .returns<Array<{ sku_id: string; par_qty: number | string | null; order_qty: number | string; implied_on_hand_oz: number | string | null }>>();
  if (lErr) throw new Error(`loadShrinkageSignals lines: ${lErr.message}`);
  const lines = (lineRows ?? []).filter((l) => num(l.implied_on_hand_oz) != null);
  if (lines.length === 0) return { count: 0, skus: [] };

  // Current computed on-hand + SKU names (batched).
  const skuIds = [...new Set(lines.map((l) => l.sku_id))];
  const [onHandView, { data: skuRows, error: nErr }] = await Promise.all([
    loadOnHandDerived(actor, locationId),
    sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>(),
  ]);
  if (nErr) throw new Error(`loadShrinkageSignals sku names: ${nErr.message}`);
  const advisoryBySku = advisoryOnHandBySku(onHandView);
  const skuName = new Map((skuRows ?? []).map((s) => [s.id, s.name]));

  // perUnitOz for the threshold = implied_on_hand_oz derives from it, but the row does
  // NOT store perUnitOz. Reconstruct the noise floor from the stored par + implied:
  // implied = max(par − order_qty, 0) × perUnitOz  ⇒  perUnitOz = implied / impliedUnits
  // when impliedUnits > 0 (par > order_qty). When impliedUnits == 0 (ordered ≥ par →
  // implied 0), the threshold's per-unit floor is unknowable from the row alone; use
  // 0.25 × par_oz only via the SAME implied=0 path — but par_oz is also perUnitOz-scaled.
  // Simpler + honest: recompute perUnitOz from the live SKU shape (one batched load), so
  // the threshold matches submit's exactly.
  const [chainsBySku, measures, { data: shapeRows, error: shErr }] = await Promise.all([
    loadSkuPackChains(skuIds),
    loadMeasures(),
    sb.from("vendor_items")
      .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .in("id", skuIds)
      .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>(),
  ]);
  if (shErr) throw new Error(`loadShrinkageSignals shapes: ${shErr.message}`);
  const shapeById = new Map((shapeRows ?? []).map((s) => [s.id, s]));

  const out: Array<{ skuId: string; skuName: string; impliedOz: number; computedOz: number }> = [];
  for (const l of lines) {
    const impliedOz = num(l.implied_on_hand_oz);
    const parToday = num(l.par_qty);
    if (impliedOz == null || parToday == null) continue; // need both for the threshold.
    const adv = advisoryBySku.get(l.sku_id);
    if (adv == null) continue; // computed side null → no compare.
    const shape = shapeById.get(l.sku_id);
    const chain = chainsBySku.get(l.sku_id) ?? null;
    const perUnitOz = shape
      ? perOrderUnitOz({
          packFormat: shape.pack_format, eachContainerLabel: shape.each_container_label,
          unitsPerPack: shape.units_per_pack, eachSize: num(shape.each_size), eachMeasure: shape.each_measure,
          avgOzPerEach: num(shape.avg_oz_per_each), packChain: chain,
        }, chain, measures)
      : null;
    if (perUnitOz == null) continue; // no per-unit oz → can't compute the threshold.
    if (shrinkageDiverges(impliedOz, adv.oz, parToday, perUnitOz)) {
      out.push({ skuId: l.sku_id, skuName: skuName.get(l.sku_id) ?? "(sku)", impliedOz, computedOz: adv.oz });
    }
  }
  return { count: out.length, skus: out };
}

// ── History: recent par-passes + one detail (re-display draft orders) ────────────
export interface ParPassSummary {
  eventId: string;
  walkedAt: string;
  walkedByName: string | null;
  lineCount: number;
}

/**
 * Recent submitted par-pass events at a location (KH+ read + location-bind), newest
 * first. Batches the walker-name + line-count lookups (never per-event).
 */
export async function loadRecentParPasses(
  actor: AuthContext,
  locationId: string,
  limit = 10,
): Promise<ParPassSummary[]> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { data: events, error } = await sb.from("par_pass_events")
    .select("id, walked_at, walked_by")
    .eq("location_id", locationId)
    .order("walked_at", { ascending: false })
    .limit(limit)
    .returns<Array<{ id: string; walked_at: string; walked_by: string }>>();
  if (error) throw new Error(`loadRecentParPasses: ${error.message}`);
  const list = events ?? [];
  if (list.length === 0) return [];

  const eventIds = list.map((e) => e.id);
  const userIds = [...new Set(list.map((e) => e.walked_by))];
  const [{ data: us }, { data: lineRows }] = await Promise.all([
    sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>(),
    sb.from("par_pass_lines").select("event_id").in("event_id", eventIds).returns<Array<{ event_id: string }>>(),
  ]);
  const uName = new Map((us ?? []).map((u) => [u.id, u.name]));
  const lineCount = new Map<string, number>();
  for (const l of lineRows ?? []) lineCount.set(l.event_id, (lineCount.get(l.event_id) ?? 0) + 1);

  return list.map((e) => ({
    eventId: e.id,
    walkedAt: e.walked_at,
    walkedByName: uName.get(e.walked_by) ?? null,
    lineCount: lineCount.get(e.id) ?? 0,
  }));
}

export interface ParPassDetail {
  eventId: string;
  locationId: string;
  walkedAt: string;
  walkedByName: string | null;
  note: string | null;
  lines: Array<{
    skuId: string;
    skuName: string;
    itemNumber: string | null;
    parQty: number | null;
    orderQty: number;
    orderUnitLabel: string | null;
    impliedOnHandOz: number | null;
    note: string | null;
  }>;
  /** Reconstructed draft orders for re-display (orderQty > 0 lines, per vendor). */
  draftOrders: DraftOrder[];
}

/**
 * One par-pass event's full detail (KH+ read; location-bind via the event's OWN
 * location_id — IDOR). Returns the stored lines + the reconstructed draft orders (the
 * same per-vendor shape submit returned, so the UI re-displays the delivery affordances).
 */
export async function loadParPassDetail(actor: AuthContext, eventId: string): Promise<ParPassDetail> {
  requireLevel(actor, PAR_PASS_MIN);
  const sb = getServiceRoleClient();
  const { data: ev, error: evErr } = await sb.from("par_pass_events")
    .select("id, location_id, walked_at, walked_by, note")
    .eq("id", eventId)
    .maybeSingle<{ id: string; location_id: string; walked_at: string; walked_by: string; note: string | null }>();
  if (evErr) throw new Error(`loadParPassDetail event: ${evErr.message}`);
  if (!ev) throw new OrderingError(404, "not_found", "Par-pass not found");
  if (!lockLocationContext(actorLoc(actor), ev.location_id)) {
    throw new OrderingError(404, "not_found", "Par-pass not found");
  }

  const { data: lineRows, error: lErr } = await sb.from("par_pass_lines")
    .select("sku_id, vendor_id, par_qty, order_qty, order_unit_label, implied_on_hand_oz, note")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .returns<Array<{ sku_id: string; vendor_id: string | null; par_qty: number | string | null; order_qty: number | string; order_unit_label: string | null; implied_on_hand_oz: number | string | null; note: string | null }>>();
  if (lErr) throw new Error(`loadParPassDetail lines: ${lErr.message}`);
  const rows = lineRows ?? [];

  const skuIds = [...new Set(rows.map((r) => r.sku_id))];
  const [{ data: skus }, { data: walker }] = await Promise.all([
    skuIds.length
      ? sb.from("vendor_items").select("id, name, item_number").in("id", skuIds).returns<Array<{ id: string; name: string; item_number: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; item_number: string | null }> }),
    sb.from("users").select("name").eq("id", ev.walked_by).maybeSingle<{ name: string }>(),
  ]);
  const skuById = new Map((skus ?? []).map((s) => [s.id, s]));

  const lines = rows.map((r) => {
    const sku = skuById.get(r.sku_id);
    return {
      skuId: r.sku_id,
      skuName: sku?.name ?? "(sku)",
      itemNumber: sku?.item_number ?? null,
      parQty: num(r.par_qty),
      orderQty: num(r.order_qty) ?? 0,
      orderUnitLabel: r.order_unit_label,
      impliedOnHandOz: num(r.implied_on_hand_oz),
      note: r.note,
    };
  });

  // Reconstruct the draft orders (orderQty > 0), reusing the stored per-line shape so
  // the delivery affordances re-render exactly as at submit time.
  const draftOrders = await buildDraftOrders(
    sb,
    rows
      .filter((r) => (num(r.order_qty) ?? 0) > 0)
      .map((r) => {
        const sku = skuById.get(r.sku_id);
        return {
          vendorId: r.vendor_id, vendorName: null,
          line: {
            skuName: sku?.name ?? "(sku)", itemNumber: sku?.item_number ?? null,
            orderQty: num(r.order_qty) ?? 0, orderUnitLabel: r.order_unit_label,
          },
        };
      }),
  );

  return {
    eventId: ev.id,
    locationId: ev.location_id,
    walkedAt: ev.walked_at,
    walkedByName: walker?.name ?? null,
    note: ev.note,
    lines,
    draftOrders,
  };
}

// ── generateDraftForVendor: a walk-less draft PO from suggested qtys (cutoff path) ────────
/**
 * Build one `draft` PO for a single vendor from the walker's suggestedQty — the cutoff
 * surfacing "generate draft now" affordance (spec §3). Reuses loadWalkerData's internals
 * (all the per-location overlay + flatten + advisory machinery) scoped to ONE vendor: each
 * suggestable SKU (suggestedQty != null AND > 0) becomes an order line at its suggested qty.
 * SKUs with a null suggestion are skipped (no fabricated qty — A3).
 *
 *   409 `no_suggestions` — the vendor has zero suggestable SKUs today (nothing to draft).
 *   409 `po_exists`      — a draft/confirmed PO already exists TODAY (ET) for this vendor
 *                          (regenerating would duplicate the day's order).
 *
 * KH+ + location-bind (both enforced by loadWalkerData's own gate and createDraftsFromLines).
 * Returns the created PO's id + display code. Append-only (createDraftsFromLines audits the
 * batch as source cutoff_draft — parPassEventId null).
 */
export async function generateDraftForVendor(
  actor: AuthContext,
  locationId: string,
  vendorId: string,
): Promise<{ poId: string; displayCode: string }> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  if (typeof vendorId !== "string" || !vendorId) {
    throw new OrderingError(400, "invalid_vendor", "A vendor is required");
  }
  const sb = getServiceRoleClient();

  // A draft/confirmed PO already today for this vendor at this location → don't duplicate.
  const { walkDateEt: dateEt } = etWalkDay();
  const { startIso, endExclusiveIso } = operationalDayUtcRange(dateEt);
  const { data: existing, error: exErr } = await sb.from("purchase_orders")
    .select("id")
    .eq("location_id", locationId).eq("vendor_id", vendorId)
    .in("status", ["draft", "confirmed"])
    .gte("created_at", startIso).lt("created_at", endExclusiveIso)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`generateDraftForVendor existing PO: ${exErr.message}`);
  if (existing) throw new OrderingError(409, "po_exists", "A draft or confirmed order already exists today for this vendor");

  // Reuse the walker payload (per-location overlay + suggested qtys are computed there).
  const walker = await loadWalkerData(actor, locationId);
  const vendor = walker.vendors.find((v) => v.vendorId === vendorId);
  const suggestableAll = (vendor?.skus ?? []).filter(
    (s): s is WalkerSku & { suggestedQty: number } => s.suggestedQty != null && s.suggestedQty > 0,
  );
  // ONE line per product (0179). loadWalkerData already deduped, so this only fires
  // if a future caller hands us a walk that did not — a suggestion per twin would
  // order the same product twice from the same vendor.
  const seenProduct = new Set<string>();
  const suggestable = suggestableAll.filter((s) => {
    if (s.productId == null) return true;
    if (seenProduct.has(s.productId)) return false;
    seenProduct.add(s.productId);
    return true;
  });
  if (suggestable.length === 0) {
    throw new OrderingError(409, "no_suggestions", "No suggested quantities to draft for this vendor today");
  }

  const byVendor = new Map<string, DraftLineInput[]>([
    [
      vendorId,
      suggestable.map((s) => ({
        skuId: s.skuId,
        orderQty: s.suggestedQty,
        orderUnitLabel: s.orderUnitLabel,
        note: null,
      })),
    ],
  ]);

  let created: CreatedDraft[];
  try {
    // noCodeSuffixRetry: the pre-check above is the fast path (a placed/draft PO today
    // → early 409). It CANNOT close the double-call race (two concurrent generates both
    // pass the pre-check). Passing the flag turns the display-code unique index into the
    // day-idempotency arbiter: the loser of the base-code INSERT gets 409 `po_exists`
    // instead of minting a duplicate -2 second order. See createDraftsFromLines' opts doc
    // for the placed-earlier-today tradeoff (acceptable: an order already went out).
    created = await createDraftsFromLines(actor, locationId, byVendor, null, { noCodeSuffixRetry: true });
  } catch (err) {
    // Surface the PO lib's typed errors as OrderingErrors so the route maps them uniformly.
    if (err instanceof PurchaseOrderError) throw new OrderingError(err.status, err.code, err.message);
    throw err;
  }
  const po = created[0];
  if (!po) throw new OrderingError(500, "draft_failed", "Draft order could not be created");
  return { poId: po.poId, displayCode: po.displayCode };
}

// ── loadOrderingAttention: today's cutoffs with no placed order (mid-shift pulse) ─────────
export interface OrderingCutoffAttention {
  vendorId: string;
  vendorName: string;
  /** The governing cutoff time formatted "h:mm AM/PM" (house formatter, operational TZ). */
  cutoffTime: string;
  /** True when a draft PO already exists today for this vendor ("draft ready" vs "no draft"). */
  hasDraft: boolean;
}

/**
 * Vendors whose cutoff governs TODAY (ET dow) but have NO order yet placed (no PO ≥ confirmed
 * today) — the mid-shift pulse's ordering-cutoff attention (spec §4). KH+ read + location-bind.
 * CHEAP + fail-open-friendly (the pulse composer wraps this in try/catch like shrinkage): at
 * most THREE batched queries — today's active cutoffs on this dow, today's POs for those
 * vendors (status + created window), then the vendor names. A vendor with a confirmed/placed/
 * received/reconciled PO today is CLEARED (the order is in flight); a draft-only vendor stays
 * on the list with hasDraft true ("draft ready"). Earliest cutoff first (the binding deadline).
 */
export async function loadOrderingAttention(
  actor: AuthContext,
  locationId: string,
): Promise<{ count: number; vendors: OrderingCutoffAttention[] }> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { walkDateEt: dateEt, todayDow: dow } = etWalkDay();

  // (1) Active cutoffs governing today (location null-or-match, this dow).
  const { data: cutoffRows, error: cErr } = await sb.from("vendor_cutoffs")
    .select("vendor_id, location_id, cutoff_time")
    .eq("active", true).eq("order_day", dow)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .returns<Array<{ vendor_id: string; location_id: string | null; cutoff_time: string }>>();
  if (cErr) throw new Error(`loadOrderingAttention cutoffs: ${cErr.message}`);
  const cutoffs = cutoffRows ?? [];
  if (cutoffs.length === 0) return { count: 0, vendors: [] };

  // Group cutoff rows per vendor → the governing bare time (most-specific-wins, earliest).
  const rowsByVendor = new Map<string, Array<{ location_id: string | null; cutoff_time: string }>>();
  for (const r of cutoffs) {
    const arr = rowsByVendor.get(r.vendor_id) ?? [];
    arr.push({ location_id: r.location_id, cutoff_time: r.cutoff_time });
    rowsByVendor.set(r.vendor_id, arr);
  }
  const vendorIds = [...rowsByVendor.keys()];

  // (2) Today's POs for those vendors at this location (status + created window).
  const { startIso, endExclusiveIso } = operationalDayUtcRange(dateEt);
  const { data: poRows, error: pErr } = await sb.from("purchase_orders")
    .select("vendor_id, status")
    .eq("location_id", locationId)
    .in("vendor_id", vendorIds)
    .gte("created_at", startIso).lt("created_at", endExclusiveIso)
    .returns<Array<{ vendor_id: string; status: string }>>();
  if (pErr) throw new Error(`loadOrderingAttention pos: ${pErr.message}`);
  // A PO ≥ confirmed CLEARS the vendor (the order is in flight); track draft presence for hasDraft.
  const PLACED_OR_BEYOND = new Set(["confirmed", "placed", "received", "reconciled"]);
  const clearedVendors = new Set<string>();
  const hasDraftVendors = new Set<string>();
  for (const p of poRows ?? []) {
    if (PLACED_OR_BEYOND.has(p.status)) clearedVendors.add(p.vendor_id);
    if (p.status === "draft") hasDraftVendors.add(p.vendor_id);
  }

  const openVendorIds = vendorIds.filter((vid) => !clearedVendors.has(vid));
  if (openVendorIds.length === 0) return { count: 0, vendors: [] };

  // (3) Vendor names for the open set.
  const { data: vendorRows, error: vErr } = await sb.from("vendors")
    .select("id, name").in("id", openVendorIds)
    .returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`loadOrderingAttention vendors: ${vErr.message}`);
  const vName = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

  const vendors: Array<OrderingCutoffAttention & { sortKey: string }> = [];
  for (const vid of openVendorIds) {
    const bare = governingCutoffTime(rowsByVendor.get(vid) ?? [], locationId);
    if (bare == null) continue;
    const iso = cutoffWallClockToUtcIso(dateEt, bare);
    if (iso == null) continue; // malformed time → no honest deadline to surface.
    vendors.push({
      vendorId: vid,
      vendorName: vName.get(vid) ?? "(vendor)",
      cutoffTime: formatTime(iso, actor.user.language),
      hasDraft: hasDraftVendors.has(vid),
      // sortKey (bare governing time, "HH:MM:SS") sorts lexically = chronologically for
      // one ET day; kept out of the returned shape (stripped below).
      sortKey: bare,
    });
  }
  // Earliest cutoff first (the binding deadline) — bare "HH:MM[:SS]" sorts chronologically.
  vendors.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.vendorName.localeCompare(b.vendorName));

  return { count: vendors.length, vendors: vendors.map(({ sortKey: _sortKey, ...v }) => v) };
}

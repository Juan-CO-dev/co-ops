/**
 * Weight & trim audit — SERVER layer (spec 2026-08-20, "Weight & trim audit").
 *
 * SERVER-ONLY. Service-role client throughout; authorization is enforced app-layer
 * by the calling routes AND re-checked here per action (defense in depth — the lib
 * is the authority). `lib/admin/menu-costing.ts` is the read shape this file
 * follows; `lib/products.ts` is the write shape.
 *
 * ── JUAN'S RULING IS THE WHOLE DESIGN, VERBATIM ───────────────────────────────
 * "Triggered on demand. Behaves just like the regular audit to establish ground
 * truth as needed." NO clocks, NO due dates, NO gates — doctrine-identical to the
 * inventory audit at /operations/counts. Nothing in this module computes a
 * deadline, an overdue flag, or a count anybody could hang a red badge off. The
 * board is a READ over facts the system already stores, plus one owner-invoked
 * session that writes a weight with a class and an audit row.
 *
 * ── THE BOARD IS BATCH-LOADED. NO PER-SUBJECT QUERY. ──────────────────────────
 * The loadRecipeGraph law applies: a fixed number of reads for the whole universe,
 * independent of how many weights exist. Eleven reads, all paginated where the
 * table can exceed PostgREST's 1000-row cap:
 *
 *   1 vendor_items (weights + the 0179 provenance quartet + pack fields)
 *   2 vendors (labels)                      3 products
 *   4 items (oz_per_par_unit)               5 loadRecipeGraph() — the cost seam
 *   6 loadCurrentSkuPrices                  7 toast_daily_depletion (the sales lane)
 *   8 productions + 9 production_inputs (the production lane + observed trim)
 *  10 vendor_delivery_items (invoice drift) 11 audit_log (seed attribution)
 *   + users (naming the humans) + sku_count_lines (the count-variance advisory)
 *
 * ── THE DOUBLE-COUNT LAW IS NOT TOUCHED ───────────────────────────────────────
 * Usage is the SAME two lanes the counts drift model sums and no others: live
 * production_inputs.input_oz, plus toast_daily_depletion.DIRECT_oz. `flattened_oz`
 * is never read here, let alone summed — it is production-covered, and adding it
 * would double-count exactly the way the law exists to prevent. This board only
 * RANKS with the number; it never writes a ledger.
 */

import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { COST_READ_MIN, loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph } from "@/lib/prep-consumption-graph";
import { SPEC_SLICE_OZ, rulingStatus, OPERATIONAL_SLICE_OZ, type RulingStatus } from "@/lib/angel-wave3";
import { membersDisagreeOnUnitOz, type ProductMember } from "@/lib/products-shared";
import { PORTIONED_ITEMS, TRIM_STANDARDS, type TrimStandard } from "@/lib/trim-standards-shared";
import {
  classifyWeightDrift,
  observedTrimFromProduction,
  rankWeightSuggestions,
  type WeightBelief,
  type WeightDriftClass,
  type WeightSuggestion,
} from "@/lib/weights-shared";

// ── Authority floors ─────────────────────────────────────────────────────────

/** AGM+ — the board is a cost read and rides the cost-read floor. */
export const WEIGHT_READ_MIN = COST_READ_MIN;
/**
 * GM+ — recording a weight moves every cost and every depletion that resolves
 * through it, so it sits with the structural edits (lead ruling 2026-08-20, the
 * same reasoning that put PRODUCT_WRITE_MIN at 7). Deliberately NOT
 * PRICE_WRITE_MIN's 6: logging an invoice price is an operational append; changing
 * what a slice weighs re-denominates the menu.
 */
export const WEIGHT_WRITE_MIN = 7;

/**
 * Trailing window for the usage term, in days. Mirrors the counts drift consumed
 * term and lib/receiving.ts's usage rank — a cost-impact ranking wants recent
 * flow, not lifetime flow, or a retired SKU outranks a live one forever.
 */
export const USAGE_WINDOW_DAYS = 30;

/**
 * Agreement band for standard-vs-observed trim, as an absolute trim fraction.
 * Matched to MASS_BALANCE_TOLERANCE (lib/menu-costing-shared.ts) on purpose: the
 * two answer the same physical question from opposite ends, and two different
 * tolerances for one question is how a board starts disagreeing with itself.
 */
export const TRIM_TOLERANCE = 0.02;

export class WeightError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "WeightError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new WeightError(403, "forbidden", "Insufficient role level for this action");
  }
}

/** numeric off PostgREST arrives as `number | string | null`. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function normalizeOptional(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

// ── View types ───────────────────────────────────────────────────────────────

/** How a believed weight's provenance reads to a human. */
export interface WeightProvenance {
  /** users.name of whoever established it, when a person did. */
  establishedByName: string | null;
  /**
   * The seed script that wrote it, when NOBODY did. Every seed-written weight
   * audits with `actorId: null`, so there is genuinely no person to name — the
   * board says "seed · <script>" and shows the absence honestly rather than
   * inventing an actor (0161 LOCK-1: a sentinel is a silent-wrong-number trap).
   */
  seedScript: string | null;
  /** audit_log.metadata.note — the reasoning recorded when the value was set. */
  auditNote: string | null;
}

/** The invoice-drift advisory: what the vendor has actually been delivering. */
export interface InvoiceDrift {
  /** Mean vendor_delivery_items.observed_oz_per_each across the sampled lines. */
  observedAvgOz: number;
  sampleCount: number;
  /** (observed − believed) ÷ believed. Signed: positive = deliveries run heavy. */
  deltaFraction: number;
}

export interface WeightBoardRow {
  belief: WeightBelief;
  provenance: WeightProvenance;
  /** Vendor label for a SKU row; member vendor labels for a product row. */
  vendorLabels: string[];
  /**
   * The SPEC (aspirational) reference, rendered BESIDE the operational value —
   * the spec's exact wording. Source: lib/angel-wave3.ts SPEC_SLICE_OZ, the
   * seed-10 table transcribed verbatim before Juan's ruling superseded it.
   * A spec that AGREES with live is not evidence of anything; a spec that
   * disagrees is the gap the ruling documented (−20% to −60% on every deli item
   * he actually weighed).
   */
  specOz: number | null;
  /**
   * The OPERATIONAL_DRIFT tripwire on the five ruled values.
   *
   * ⚠ LEGACY, AND DELIBERATELY NOT EXTENDED: `rulingStatus` is keyed by SKU NAME
   * against a HARDCODED five-row table (lib/angel-wave3.ts OPERATIONAL_SLICE_OZ).
   * It is a check for those five rows and it is not a general mechanism. New
   * rulings live in the weight_class / weight_established_* COLUMNS, which is what
   * migration 0179 added them for. Do not add rows to that table.
   */
  ruling: { status: RulingStatus; ruledOz: number | null } | null;
  invoiceDrift: InvoiceDrift | null;
  /**
   * A physical count exists for this subject while its weight is still SPEC-class.
   *
   * The count is ground truth and the SPEC weight is a label-derived placeholder,
   * so every ounce that count resolved to leaned on an unverified number — which
   * is what "a count variance implicating a weight" means operationally. The
   * variance NUMBER itself lives on /operations/counts and is not recomputed here:
   * one engine owns variance, and a second private opinion about it is exactly the
   * failure this whole arc exists to end.
   */
  countImplicated: boolean;
}

/** One portioned prep's expectation-vs-observation row. */
export interface TrimBoardRow {
  itemId: string;
  name: string;
  nameEs: string | null;
  trimClass: string;
  standard: TrimStandard;
  /** null until production capture runs — the honest day-one value. */
  observedTrim: number | null;
  observationCount: number;
  drift: WeightDriftClass;
}

export interface WeightBoard {
  rows: WeightBoardRow[];
  trim: TrimBoardRow[];
  /** The ranked suggestion list. ADVISORY — an order, never a schedule. */
  suggestions: WeightSuggestion[];
  /**
   * Has ANY production been captured? False live (productions is empty), and the
   * board says "starts with production capture" in those words rather than
   * rendering a 0% observed trim that nobody measured.
   */
  observedTrimAvailable: boolean;
  /** The instant the board was composed — the ONLY clock, and it is a label. */
  generatedAt: string;
  usageWindowDays: number;
}

// ── Row shapes off PostgREST ─────────────────────────────────────────────────

interface DbSkuRow {
  id: string;
  name: string;
  vendor_id: string | null;
  product_id: string | null;
  active: boolean | null;
  avg_oz_per_each: number | string | null;
  each_container_label: string | null;
  weight_class: string | null;
  weight_source_note: string | null;
  weight_established_at: string | null;
  weight_established_by: string | null;
}

interface DbProductRow {
  id: string;
  name: string;
  active: boolean | null;
  unit_oz: number | string | null;
  unit_oz_class: string | null;
  unit_oz_source_note: string | null;
  unit_oz_established_at: string | null;
  unit_oz_established_by: string | null;
}

interface DbItemRow {
  id: string;
  name: string;
  name_es: string | null;
  default_par_unit: string | null;
  oz_per_par_unit: number | string | null;
  active: boolean | null;
}

interface DbAuditRow {
  action: string;
  resource_id: string | null;
  occurred_at: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** The three audit actions that establish a weight, at the three grains. */
const WEIGHT_AUDIT_ACTIONS = ["sku.weight_fill", "product.unit_oz_set", "item.weight_fill"] as const;

function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * 86_400_000).toISOString();
}

// ── The board ────────────────────────────────────────────────────────────────

/**
 * Every weight the system believes, its class, its provenance, its drift, and a
 * ranked suggestion list that suggests and never nags.
 */
export async function loadWeightBoard(actor: AuthContext): Promise<WeightBoard> {
  requireLevel(actor, WEIGHT_READ_MIN);
  const sb = getServiceRoleClient();
  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const windowStart = isoDaysAgo(USAGE_WINDOW_DAYS, nowMs);
  const windowStartDate = windowStart.slice(0, 10);

  // ── Reads 1-6: the subjects, their labels, and the cost seam ───────────────
  const [skuRows, vendorRes, productRes, itemRes, graph] = await Promise.all([
    selectAllRows<DbSkuRow>((from, to) =>
      sb
        .from("vendor_items")
        .select(
          "id, name, vendor_id, product_id, active, avg_oz_per_each, each_container_label, weight_class, weight_source_note, weight_established_at, weight_established_by",
        )
        .order("id", { ascending: true })
        .range(from, to)
        .returns<DbSkuRow[]>(),
    ),
    sb.from("vendors").select("id, name").returns<Array<{ id: string; name: string }>>(),
    sb
      .from("products")
      .select(
        "id, name, active, unit_oz, unit_oz_class, unit_oz_source_note, unit_oz_established_at, unit_oz_established_by",
      )
      .returns<DbProductRow[]>(),
    sb
      .from("items")
      .select("id, name, name_es, default_par_unit, oz_per_par_unit, active")
      .eq("active", true)
      .order("name")
      .returns<DbItemRow[]>(),
    loadRecipeGraph(),
  ]);

  const vendorNames = new Map((vendorRes.data ?? []).map((v) => [v.id, v.name]));
  const productRows = productRes.data ?? [];
  const itemRows = itemRes.data ?? [];
  const skuIds = skuRows.map((s) => s.id);

  const prices = await loadCurrentSkuPrices(skuIds);
  const costPerOz = costPerOzFromGraph(graph, prices);

  // ── Reads 7-11: usage, observation, drift evidence, provenance ─────────────
  const [salesRows, liveProductions, productionInputs, deliveryRows, auditRows, countLineRows] =
    await Promise.all([
      // THE SALES LANE — direct_oz ONLY. flattened_oz is production-covered and is
      // never summed; the double-count law is not in play here and must not become
      // so (lib/counts.ts:697-707).
      selectAllRows<{ sku_id: string; direct_oz: number | string }>((from, to) =>
        sb
          .from("toast_daily_depletion")
          .select("sku_id, direct_oz")
          .gte("business_date", windowStartDate)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ sku_id: string; direct_oz: number | string }>>(),
      ),
      // THE PRODUCTION LANE — live headers only (superseded/revoked excluded).
      selectAllRows<{ id: string; output_item_id: string | null; output_qty: number | string | null }>(
        (from, to) =>
          sb
            .from("productions")
            .select("id, output_item_id, output_qty")
            .is("superseded_at", null)
            .is("revoked_at", null)
            .gte("produced_at", windowStart)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<Array<{ id: string; output_item_id: string | null; output_qty: number | string | null }>>(),
      ),
      selectAllRows<{ production_id: string; input_sku_id: string; input_oz: number | string | null }>(
        (from, to) =>
          sb
            .from("production_inputs")
            .select("production_id, input_sku_id, input_oz")
            .order("id", { ascending: true })
            .range(from, to)
            .returns<
              Array<{ production_id: string; input_sku_id: string; input_oz: number | string | null }>
            >(),
      ),
      selectAllRows<{ vendor_item_id: string | null; observed_oz_per_each: number | string | null }>(
        (from, to) =>
          sb
            .from("vendor_delivery_items")
            .select("vendor_item_id, observed_oz_per_each")
            .not("observed_oz_per_each", "is", null)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<
              Array<{ vendor_item_id: string | null; observed_oz_per_each: number | string | null }>
            >(),
      ),
      selectAllRows<DbAuditRow>((from, to) =>
        sb
          .from("audit_log")
          .select("action, resource_id, occurred_at, actor_id, metadata")
          .in("action", [...WEIGHT_AUDIT_ACTIONS])
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
          .returns<DbAuditRow[]>(),
      ),
      selectAllRows<{ sku_id: string }>((from, to) =>
        sb
          .from("sku_count_lines")
          .select("sku_id")
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ sku_id: string }>>(),
      ),
    ]);

  // ── Fold the evidence into per-subject indexes (all O(n), no queries) ──────

  /** Usage oz per SKU = the two lanes, summed. NULL (absent) means NO EVIDENCE —
   *  never a fabricated 0, which would tie every unused SKU at score 0 and make
   *  the whole ranking alphabetical. */
  const usageOz = new Map<string, number>();
  const addUsage = (skuId: string, oz: number) => {
    if (!(oz > 0)) return;
    usageOz.set(skuId, (usageOz.get(skuId) ?? 0) + oz);
  };
  for (const r of salesRows) addUsage(r.sku_id, num(r.direct_oz) ?? 0);
  const liveProductionIds = new Set(liveProductions.map((p) => p.id));
  for (const l of productionInputs) {
    if (!liveProductionIds.has(l.production_id)) continue;
    addUsage(l.input_sku_id, num(l.input_oz) ?? 0);
  }

  /** Observed delivery weights, for the invoice-drift advisory. */
  const observedDeliveries = new Map<string, { sum: number; n: number }>();
  for (const d of deliveryRows) {
    if (!d.vendor_item_id) continue;
    const oz = num(d.observed_oz_per_each);
    if (oz == null || !(oz > 0)) continue;
    const acc = observedDeliveries.get(d.vendor_item_id) ?? { sum: 0, n: 0 };
    acc.sum += oz;
    acc.n += 1;
    observedDeliveries.set(d.vendor_item_id, acc);
  }

  /** Newest weight-audit row per subject. The read is already newest-first, so the
   *  FIRST row wins — and the order is TOTAL (occurred_at, then id) so a same-
   *  instant pair can never resolve differently between two loads. */
  const newestAudit = new Map<string, DbAuditRow>();
  for (const a of auditRows) {
    if (!a.resource_id) continue;
    if (!newestAudit.has(a.resource_id)) newestAudit.set(a.resource_id, a);
  }

  const countedSkuIds = new Set(countLineRows.map((r) => r.sku_id));

  // Name the humans — ONE read over only the ids actually referenced.
  const actorIds = new Set<string>();
  for (const s of skuRows) if (s.weight_established_by) actorIds.add(s.weight_established_by);
  for (const p of productRows) if (p.unit_oz_established_by) actorIds.add(p.unit_oz_established_by);
  for (const a of newestAudit.values()) if (a.actor_id) actorIds.add(a.actor_id);
  const userNames = new Map<string, string>();
  if (actorIds.size > 0) {
    const { data } = await sb
      .from("users")
      .select("id, name")
      .in("id", [...actorIds])
      .returns<Array<{ id: string; name: string | null }>>();
    for (const u of data ?? []) if (u.name) userNames.set(u.id, u.name);
  }

  const provenanceFor = (
    subjectId: string,
    establishedBy: string | null,
  ): WeightProvenance => {
    const a = newestAudit.get(subjectId);
    const meta = (a?.metadata ?? {}) as Record<string, unknown>;
    const personId = establishedBy ?? a?.actor_id ?? null;
    return {
      establishedByName: personId ? (userNames.get(personId) ?? null) : null,
      // A script name only counts as provenance when NOBODY is named — otherwise
      // the human is the answer and the script field is noise. Seed 10 recorded
      // only `phase`, never `script`, so it is the fallback: a row that DOES say
      // where it came from must not render as "nobody recorded this".
      seedScript:
        personId == null
          ? typeof meta.script === "string"
            ? meta.script
            : typeof meta.phase === "string"
              ? meta.phase
              : null
          : null,
      auditNote: typeof meta.note === "string" ? meta.note : null,
    };
  };

  // ── Compose the SKU rows ───────────────────────────────────────────────────
  const rows: WeightBoardRow[] = [];

  for (const s of skuRows) {
    if (s.active === false) continue; // a retired SKU's weight is history, not a suggestion
    const valueOz = num(s.avg_oz_per_each);
    const cpo = costPerOz.get(s.id) ?? null;
    const usage = usageOz.get(s.id) ?? null;
    const believedAt = s.weight_established_at ?? newestAudit.get(s.id)?.occurred_at ?? null;

    const obs = observedDeliveries.get(s.id);
    const invoiceDrift: InvoiceDrift | null =
      obs && obs.n > 0 && valueOz != null && valueOz > 0
        ? {
            observedAvgOz: obs.sum / obs.n,
            sampleCount: obs.n,
            deltaFraction: (obs.sum / obs.n - valueOz) / valueOz,
          }
        : null;

    const ruled = OPERATIONAL_SLICE_OZ[s.name];
    rows.push({
      belief: {
        subjectKind: "sku",
        subjectId: s.id,
        name: s.name,
        valueOz,
        unit: s.each_container_label ?? "each",
        weightClass: s.weight_class,
        establishedAt: believedAt,
        establishedBy: s.weight_established_by,
        sourceNote: s.weight_source_note,
        costPerOz: cpo,
        usageOz: usage,
        // A SKU weight never blocks the re-point on its own — that is a PRODUCT
        // configuration (unit_oz absent while members disagree), decided below.
        blocksRepoint: false,
      },
      provenance: provenanceFor(s.id, s.weight_established_by),
      vendorLabels: s.vendor_id ? [vendorNames.get(s.vendor_id) ?? ""].filter(Boolean) : [],
      specOz: SPEC_SLICE_OZ[s.name] ?? null,
      ruling: ruled == null ? null : { status: rulingStatus(s.name, valueOz), ruledOz: ruled },
      invoiceDrift,
      countImplicated: s.weight_class === "SPEC" && countedSkuIds.has(s.id),
    });
  }

  // ── Compose the PRODUCT rows ───────────────────────────────────────────────
  // A product's own unit_oz is what makes a product-pinned recipe line survive a
  // member flip (D2). Its absence, WHILE its members disagree about what one unit
  // weighs, is the exact configuration seed 18 refused its own pin-move over — so
  // that row is a re-point BLOCKER and ranks above everything.
  const membersByProduct = new Map<string, ProductMember[]>();
  const memberVendorsByProduct = new Map<string, string[]>();
  for (const s of skuRows) {
    if (!s.product_id) continue;
    const list = membersByProduct.get(s.product_id) ?? [];
    list.push({
      skuId: s.id,
      vendorId: s.vendor_id,
      vendorName: s.vendor_id ? (vendorNames.get(s.vendor_id) ?? null) : null,
      active: s.active !== false,
      avgOzPerEach: num(s.avg_oz_per_each),
      lastReceivedAt: null, // resolution rung 2 is not a question this board asks
    });
    membersByProduct.set(s.product_id, list);
    if (s.active !== false && s.vendor_id) {
      const labels = memberVendorsByProduct.get(s.product_id) ?? [];
      const label = vendorNames.get(s.vendor_id);
      if (label && !labels.includes(label)) labels.push(label);
      memberVendorsByProduct.set(s.product_id, labels);
    }
  }

  for (const p of productRows) {
    if (p.active === false) continue;
    const members = membersByProduct.get(p.id) ?? [];
    const activeMembers = members.filter((m) => m.active);
    const unitOz = num(p.unit_oz);
    const disagree = membersDisagreeOnUnitOz(members);

    // Cost basis: the members' own $/oz, averaged over those that HAVE one. A
    // product is priced when any member is, and the average is the honest
    // org-level replacement figure the costing board already prices at (D7).
    const memberCosts = activeMembers
      .map((m) => costPerOz.get(m.skuId) ?? null)
      .filter((c): c is number => c != null);
    const memberUsage = activeMembers
      .map((m) => usageOz.get(m.skuId) ?? null)
      .filter((u): u is number => u != null);

    rows.push({
      belief: {
        subjectKind: "product",
        subjectId: p.id,
        name: p.name,
        valueOz: unitOz,
        unit: "unit",
        weightClass: p.unit_oz_class,
        establishedAt: p.unit_oz_established_at ?? newestAudit.get(p.id)?.occurred_at ?? null,
        establishedBy: p.unit_oz_established_by,
        sourceNote: p.unit_oz_source_note,
        costPerOz:
          memberCosts.length > 0 ? memberCosts.reduce((a, b) => a + b, 0) / memberCosts.length : null,
        usageOz: memberUsage.length > 0 ? memberUsage.reduce((a, b) => a + b, 0) : null,
        blocksRepoint: unitOz == null && activeMembers.length > 1 && disagree,
      },
      provenance: provenanceFor(p.id, p.unit_oz_established_by),
      vendorLabels: memberVendorsByProduct.get(p.id) ?? [],
      specOz: null,
      ruling: null,
      invoiceDrift: null,
      countImplicated: false,
    });
  }

  // ── Compose the ITEM (prep par-unit) rows ──────────────────────────────────
  // An item's weight has no provenance COLUMNS — 0179 added them to vendor_items
  // and products only — so its who/when comes from the audit trail alone, and is
  // NULL for every one of them today. That is the honest state, not a gap to fill.
  for (const it of itemRows) {
    const valueOz = num(it.oz_per_par_unit);
    // $/par-unit from the flatten: Σ over the item's leaf SKUs of (oz per par unit
    // × that SKU's $/oz). Pure — the graph is already loaded, no query per item.
    const legs = perUnitSkuOzForItemFromGraph(graph, it.id);
    let dollarsPerParUnit: number | null = null;
    if (legs.size > 0) {
      let acc = 0;
      let complete = true;
      for (const [skuId, oz] of legs) {
        const c = costPerOz.get(skuId) ?? null;
        if (c == null) {
          complete = false;
          break;
        }
        acc += oz * c;
      }
      // A PARTIAL sum is not a cost. One unpriced leg nulls the whole figure
      // rather than understating it (the MenuCostRollup completeness rule).
      dollarsPerParUnit = complete ? acc : null;
    }

    rows.push({
      belief: {
        subjectKind: "item",
        subjectId: it.id,
        name: it.name,
        valueOz,
        unit: it.default_par_unit ?? "par unit",
        weightClass: null,
        establishedAt: newestAudit.get(it.id)?.occurred_at ?? null,
        establishedBy: newestAudit.get(it.id)?.actor_id ?? null,
        sourceNote: null,
        // $ per OUNCE of the prep, so the belief's cost basis means the same thing
        // at all three grains. Null when the par-unit weight is unknown — which is
        // precisely the weight this row is asking to have established.
        costPerOz:
          dollarsPerParUnit != null && valueOz != null && valueOz > 0
            ? dollarsPerParUnit / valueOz
            : null,
        // Par-unit throughput is a PRODUCTION number and production capture has not
        // started. NULL, not 0 — we do not know, and pretending we know zero would
        // rank every prep dead last for a reason we made up.
        usageOz: null,
        blocksRepoint: false,
      },
      provenance: provenanceFor(it.id, null),
      vendorLabels: [],
      specOz: null,
      ruling: null,
      invoiceDrift: null,
      countImplicated: false,
    });
  }

  // ── Trim: expectation (the lifted #271 registry) vs observation ────────────
  const itemsByName = new Map(itemRows.map((i) => [i.name, i]));
  const inputsByProduction = new Map<string, number>();
  for (const l of productionInputs) {
    if (!liveProductionIds.has(l.production_id)) continue;
    inputsByProduction.set(l.production_id, (inputsByProduction.get(l.production_id) ?? 0) + (num(l.input_oz) ?? 0));
  }

  const trim: TrimBoardRow[] = [];
  for (const { item, trimClass } of PORTIONED_ITEMS) {
    const row = itemsByName.get(item);
    const standard = TRIM_STANDARDS[trimClass];
    if (!row || !standard) continue;
    const ozPerParUnit = num(row.oz_per_par_unit);

    // Average the observed trim across every live production of this item. Each
    // run is its own observation; a run whose question cannot be asked returns
    // null and is EXCLUDED rather than counted as zero trim.
    const observations: number[] = [];
    for (const p of liveProductions) {
      if (p.output_item_id !== row.id) continue;
      const t = observedTrimFromProduction({
        outputQty: num(p.output_qty),
        ozPerParUnit,
        inputOz: inputsByProduction.get(p.id) ?? null,
      });
      if (t != null) observations.push(t);
    }
    const observedTrim =
      observations.length > 0 ? observations.reduce((a, b) => a + b, 0) / observations.length : null;

    trim.push({
      itemId: row.id,
      name: row.name,
      nameEs: row.name_es,
      trimClass,
      standard,
      observedTrim,
      observationCount: observations.length,
      drift: classifyWeightDrift({ standardTrim: standard.trim, observedTrim, tolerance: TRIM_TOLERANCE }),
    });
  }

  return {
    rows,
    trim,
    suggestions: rankWeightSuggestions(
      rows.map((r) => r.belief),
      { now: generatedAt },
    ),
    observedTrimAvailable: liveProductions.length > 0,
    generatedAt,
    usageWindowDays: USAGE_WINDOW_DAYS,
  };
}

// ── The weigh session (owner-invoked; mirrors the /counts session flow) ───────

export interface WeightMeasurementInput {
  subjectKind: "sku" | "product" | "item";
  subjectId: string;
  /** The measured weight in ounces. Positive; null is not a measurement. */
  valueOz: number;
  /** Free text — what was weighed, how many samples, anything the next person needs. */
  sourceNote?: string | null;
}

export interface WeightMeasurementResult {
  subjectKind: WeightMeasurementInput["subjectKind"];
  subjectId: string;
  beforeOz: number | null;
  afterOz: number;
  /** The legacy five-row tripwire's verdict at write time, when it applies. */
  ruling: RulingStatus | null;
}

/**
 * Record ONE surprise-weigh measurement.
 *
 * A SESSION IS A SET OF INDEPENDENT MEASUREMENTS, each its own append. There is no
 * session header table and no supersede — the audit trail IS the session record,
 * exactly as `sku_count_events` is immutable and per-SKU anchors resolve at read.
 * That is why this function takes one measurement and the route loops: a partial
 * session is still a set of true facts, and rolling one back because a later one
 * failed would destroy a measurement somebody actually took.
 *
 * Every write sets class OPERATIONAL — it was observed here, on a scale, by the
 * named person. That is the whole point of the session, and it is the one class
 * `lib/angel-wave4.ts` reserves for exactly this.
 */
export async function recordWeightMeasurement(
  actor: AuthContext,
  input: WeightMeasurementInput,
): Promise<WeightMeasurementResult> {
  requireLevel(actor, WEIGHT_WRITE_MIN);
  if (!Number.isFinite(input.valueOz) || input.valueOz <= 0) {
    throw new WeightError(400, "invalid_weight", "A measured weight must be a positive number");
  }
  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();
  const note = normalizeOptional(input.sourceNote);

  if (input.subjectKind === "sku") {
    const { data: before, error: bErr } = await sb
      .from("vendor_items")
      .select("id, name, avg_oz_per_each, weight_class")
      .eq("id", input.subjectId)
      .maybeSingle<{ id: string; name: string; avg_oz_per_each: number | string | null; weight_class: string | null }>();
    if (bErr) throw new Error(`recordWeightMeasurement lookup: ${bErr.message}`);
    if (!before) throw new WeightError(404, "not_found", "SKU not found");
    const beforeOz = num(before.avg_oz_per_each);

    const { error, count } = await sb
      .from("vendor_items")
      .update(
        {
          avg_oz_per_each: input.valueOz,
          weight_class: "OPERATIONAL",
          weight_source_note: note,
          weight_established_at: nowIso,
          weight_established_by: actor.user.id,
          updated_at: nowIso,
          updated_by: actor.user.id,
        },
        { count: "exact" },
      )
      .eq("id", input.subjectId);
    if (error) throw new Error(`recordWeightMeasurement sku update: ${error.message}`);
    // UPDATE denials are SILENT on Postgres (UPDATE 0, no error) — the rowcount is
    // the only signal, and an unchecked one is a write that never happened.
    if (count === 0) throw new WeightError(404, "not_found", "SKU not found");

    // The OPERATIONAL_DRIFT tripwire, honored at the moment of the write: if this
    // SKU is one of the five Juan ruled on, say whether the new measurement agrees
    // with the ruling. Recorded in the audit row so a later "why did ham move"
    // always has an answer. It never BLOCKS — a fresh measurement outranks a ruling
    // by construction; the ruling just gets told.
    const ruled = OPERATIONAL_SLICE_OZ[before.name];
    const ruling = ruled == null ? null : rulingStatus(before.name, input.valueOz);

    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "sku.weight_fill",
      resourceTable: "vendor_items",
      resourceId: input.subjectId,
      metadata: {
        name: before.name,
        before_avg_oz_per_each: beforeOz,
        avg_oz_per_each: input.valueOz,
        before_weight_class: before.weight_class,
        weight_class: "OPERATIONAL",
        note,
        // The plan's named context for this lane. Widens `actor_context` to a
        // human-actor row (it has only ridden machine/seed rows until now) so the
        // weigh session's writes are filterable as one campaign in the forensic
        // trail — which is what makes a session legible after the fact.
        actor_context: "weight_audit",
        ruling_status: ruling,
        ruled_oz: ruled ?? null,
        estimate: false,
      },
      ipAddress: null,
      userAgent: null,
    });
    return { subjectKind: "sku", subjectId: input.subjectId, beforeOz, afterOz: input.valueOz, ruling };
  }

  if (input.subjectKind === "product") {
    const { data: before, error: bErr } = await sb
      .from("products")
      .select("id, name, unit_oz, unit_oz_class")
      .eq("id", input.subjectId)
      .maybeSingle<{ id: string; name: string; unit_oz: number | string | null; unit_oz_class: string | null }>();
    if (bErr) throw new Error(`recordWeightMeasurement product lookup: ${bErr.message}`);
    if (!before) throw new WeightError(404, "not_found", "Product not found");
    const beforeOz = num(before.unit_oz);

    const { error, count } = await sb
      .from("products")
      .update(
        {
          unit_oz: input.valueOz,
          unit_oz_class: "OPERATIONAL",
          unit_oz_source_note: note,
          unit_oz_established_at: nowIso,
          unit_oz_established_by: actor.user.id,
          updated_at: nowIso,
          updated_by: actor.user.id,
        },
        { count: "exact" },
      )
      .eq("id", input.subjectId);
    if (error) throw new Error(`recordWeightMeasurement product update: ${error.message}`);
    if (count === 0) throw new WeightError(404, "not_found", "Product not found");

    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "product.unit_oz_set",
      resourceTable: "products",
      resourceId: input.subjectId,
      metadata: {
        name: before.name,
        before_unit_oz: beforeOz,
        after_unit_oz: input.valueOz,
        before_unit_oz_class: before.unit_oz_class,
        after_unit_oz_class: "OPERATIONAL",
        note,
        actor_context: "weight_audit",
      },
      ipAddress: null,
      userAgent: null,
    });
    return { subjectKind: "product", subjectId: input.subjectId, beforeOz, afterOz: input.valueOz, ruling: null };
  }

  const { data: before, error: bErr } = await sb
    .from("items")
    .select("id, name, oz_per_par_unit")
    .eq("id", input.subjectId)
    .maybeSingle<{ id: string; name: string; oz_per_par_unit: number | string | null }>();
  if (bErr) throw new Error(`recordWeightMeasurement item lookup: ${bErr.message}`);
  if (!before) throw new WeightError(404, "not_found", "Item not found");
  const beforeOz = num(before.oz_per_par_unit);

  const { error, count } = await sb
    .from("items")
    .update({ oz_per_par_unit: input.valueOz, updated_at: nowIso, updated_by: actor.user.id }, { count: "exact" })
    .eq("id", input.subjectId);
  if (error) throw new Error(`recordWeightMeasurement item update: ${error.message}`);
  if (count === 0) throw new WeightError(404, "not_found", "Item not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item.weight_fill",
    resourceTable: "items",
    resourceId: input.subjectId,
    metadata: {
      name: before.name,
      before_oz_per_par_unit: beforeOz,
      oz_per_par_unit: input.valueOz,
      // items has no provenance QUARTET (0179 added it to vendor_items + products
      // only), so for a prep weight the audit row IS the provenance — which is why
      // the class is recorded here and read back off the trail by the board.
      weight_class: "OPERATIONAL",
      note,
      actor_context: "weight_audit",
    },
    ipAddress: null,
    userAgent: null,
  });
  return { subjectKind: "item", subjectId: input.subjectId, beforeOz, afterOz: input.valueOz, ruling: null };
}

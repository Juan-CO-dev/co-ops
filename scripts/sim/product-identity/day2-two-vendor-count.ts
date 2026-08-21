/**
 * SIM DAY 2 — TWO-VENDOR COUNT DAY (plan Phase 7, Task 7.2).
 *
 * The scenario the plan names: both ham twins carry real stock at one location, with
 * interleaved deliveries so FIFO has something to say. An AGM counts HAM as a PRODUCT
 * (C-mode); a second session taps to SPLIT and counts each vendor; the on-hand panel
 * is read after each.
 *
 * WHAT IT MUST PROVE (plan Task 7.2), each a named ledger line:
 *   B1  a product count writes N member lines whose oz sum EXACTLY to what was entered
 *   B2  allocated_from_product_id is SET on those lines and NULL on the split ones
 *   B3  the split count anchors per-SKU identically to a pre-arc count
 *   B4  the product row's variance is the members' variances summed, and the audit's
 *       mirrored SHORT/OVER pair does NOT appear
 *   B5  a count larger than the lot ledger explains is carried (LEAD RULING: never a
 *       hard refusal) with the right reason code, and the counted total is preserved
 *
 * THE DATA PROBLEM, STATED UP FRONT. Live, the whole vendor_delivery_items ledger
 * holds ONE line for any product member and its resolved_oz is NULL — nothing has
 * ever been received against a ham twin at either shop. "Interleaved deliveries so
 * FIFO has something to say" therefore cannot be read off production; it is INJECTED,
 * at the same PostgREST response boundary day 1 uses, and every assertion below says
 * which world it ran in:
 *   · scene 1-2  the LIVE world (zero lots) — which is also the world Juan's first
 *                real count will happen in, so its behaviour is not academic
 *   · scene 3-5  the INJECTED world (three interleaved lots, two vendors)
 * No row is written to production in either. See harness.ts for the write guard.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/sim/product-identity/day2-two-vendor-count.ts
 */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  createCountEvent,
  loadCountFormData,
  loadOnHandDerived,
  type CountProductOption,
} from "@/lib/counts";
import { loadProductIndex, loadProductLots } from "@/lib/products";
import { buildProductOnHandRow, rollupProductGrain } from "@/lib/products-shared";
import {
  addRewriter,
  assertEq,
  assertThat,
  capturedWrites,
  captureWritesTo,
  clearRewriters,
  h,
  incident,
  injectRowsRewriter,
  installShim,
  loadPersonaUser,
  p,
  persona,
  resetCaptured,
  round,
  summary,
} from "./harness";

const HAM = "Ham";
const SIM_EVENT_ID = "00000000-0000-4000-8000-0000000515d0"; // synthetic; never persisted.

interface CountLineRow {
  sku_id: string;
  resolved_oz: number | null;
  qty: number;
  level_label: string;
  anchor_dimension: string;
  allocated_from_product_id?: string | null;
}

/** Every sku_count_lines row the write path TRIED to insert, in order. */
function capturedCountLines(): CountLineRow[] {
  return capturedWrites()
    .filter((w) => w.table === "sku_count_lines")
    .flatMap((w) => (Array.isArray(w.body) ? w.body : [w.body]) as CountLineRow[]);
}

function capturedAuditMeta(action: string): Record<string, unknown> | null {
  const row = capturedWrites()
    .filter((w) => w.table === "audit_log")
    .flatMap((w) => (Array.isArray(w.body) ? w.body : [w.body]) as Array<Record<string, unknown>>)
    .find((r) => r["action"] === action);
  return row ? ((row["metadata"] ?? {}) as Record<string, unknown>) : null;
}

const sum = (ns: ReadonlyArray<number>): number => ns.reduce((a, b) => a + b, 0);

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  h("scene 0 — the floor (live, read-only)");
  const { data: prod } = await sb
    .from("products")
    .select("id, name, unit_oz")
    .eq("name", HAM)
    .maybeSingle<{ id: string; name: string; unit_oz: number | string | null }>();
  if (!prod) throw new Error(`no product named ${HAM}`);
  const { data: locs } = await sb.from("locations").select("id, name").eq("active", true).order("name");
  const loc = (locs ?? [])[0]!;
  const who = await loadPersonaUser();
  const actor = persona(who.id, who.role, (locs ?? []).map((l) => l.id));
  const idx = await loadProductIndex([prod.id], loc.id);
  const entry = idx.byProduct.get(prod.id)!;
  const activeMembers = entry.members.filter((m) => m.active);
  p(`  product     ${HAM} (${prod.id})  unit_oz=${prod.unit_oz ?? "NULL"}`);
  p(`  location    ${loc.name} (${loc.id})`);
  p(`  members     ${activeMembers.map((m) => `${m.vendorName ?? "?"}=${m.skuId.slice(0, 8)}`).join(" · ")}`);
  p(`  primary     ${entry.resolution.rung} → ${entry.resolution.skuId?.slice(0, 8)}`);
  p(`  persona     ${who.name} (${who.role}) — the AGM on the count`);

  installShim();
  captureWritesTo("sku_inferred_baselines");
  captureWritesTo("audit_log");
  captureWritesTo("sku_count_events", { id: SIM_EVENT_ID });
  captureWritesTo("sku_count_lines");

  // ── SCENE 1 — the count sheet as it stands TODAY ─────────────────────────────
  h("scene 1 — the AGM opens /operations/counts (live world: zero receipt lots)");
  const form = await loadCountFormData(actor, loc.id);
  const hamOption = form.products.find((o) => o.productId === prod.id) ?? null;
  p(`  ${form.products.length} product row(s) on the sheet; ${form.skus.length} sku row(s)`);
  if (hamOption) {
    p(`  HAM row: members=${hamOption.memberSkuIds.length} split=${hamOption.splitAvailable} lotBearing=${hamOption.lotBearingMemberCount} chainsDiffer=${hamOption.chainsDiffer}`);
    p(`  level labels (borrowed from the primary): ${hamOption.chainLabels.join(" / ") || "(none)"}`);
  }
  assertThat(
    "D2-B0",
    "the count sheet offers HAM as ONE product row (C-mode is live — migration 0180 applied)",
    "1 HAM product option",
    hamOption == null ? "no HAM product row" : `present, ${hamOption.memberSkuIds.length} members`,
    hamOption != null && hamOption.memberSkuIds.length === activeMembers.length,
  );
  if (!hamOption) throw new Error("C-mode not available — cannot run this day");
  assertThat(
    "D2-B0b",
    "tap-to-split is OFFERED even with zero lot history (a counter who finds real stock the ledger has not seen is never trapped in product-only mode)",
    "splitAvailable=true, lotBearingMemberCount=0",
    `splitAvailable=${hamOption.splitAvailable}, lotBearingMemberCount=${hamOption.lotBearingMemberCount}`,
    hamOption.splitAvailable === true && hamOption.lotBearingMemberCount === 0,
  );

  // The product row's level picker borrows the RESOLVED PRIMARY's chain labels. PFG
  // Ham has no pack chain, so HAM's picker is empty and the operator falls through to
  // CountForm's free-text unit box (EntryFields, the `levels.length === 0` arm — the
  // August sim's SIM-19 path). Counted here the way the sheet actually offers it.
  const allProducts = form.products;
  const emptyPickers = allProducts.filter((o) => o.chainLabels.length === 0);
  p(`  product rows with an EMPTY level picker: ${emptyPickers.length}/${allProducts.length} — ${emptyPickers.map((o) => o.name).join(", ")}`);
  incident(
    "SIM-PI-6",
    "P2",
    `${emptyPickers.length} of ${allProducts.length} product rows (${emptyPickers.map((o) => o.name).join(", ")}) offer NO level to count at, ` +
      "because their resolved primary has no pack chain — HAM, the arc's flagship product, among them. The row still works " +
      "via CountForm's free-text unit box, so this is a data gap (the weigh/pack-chain errand) surfacing as a UX cliff, not a code defect. " +
      "Worth saying to Juan before his first count: on those four the sheet asks him to type the unit.",
  );

  // ── SCENE 2 — she counts HAM as a product, in the world as it really is ──────
  h("scene 2 — HAM counted as a PRODUCT (live world)");
  const freeText = hamOption.chainLabels.length === 0;
  const level = hamOption.chainLabels[0] ?? "oz";
  const QTY = freeText ? 300 : 4;
  p(`  level source: ${freeText ? "FREE TEXT (no chain on the primary)" : "chain label"}`);
  resetCaptured();
  const live = await createCountEvent(actor, {
    locationId: loc.id,
    note: "sim day 2 — product count, live world",
    lines: [{ productId: prod.id, levelLabel: level, qty: QTY }],
  });
  const liveLines = capturedCountLines();
  const liveMeta = capturedAuditMeta("sku_count.recorded");
  const liveProductLine = ((liveMeta?.["product_lines"] as Array<Record<string, unknown>>) ?? [])[0] ?? {};
  const liveCountedOz = Number(liveProductLine["counted_oz"] ?? NaN);
  p(`  entered      ${QTY} × "${level}"  →  ${liveCountedOz} oz`);
  p(`  lines written:`);
  for (const l of liveLines) {
    const m = activeMembers.find((x) => x.skuId === l.sku_id);
    p(`    ${m?.vendorName ?? l.sku_id.slice(0, 8)}  resolved_oz=${l.resolved_oz}  qty=${round(l.qty, 4)}  allocated_from=${l.allocated_from_product_id ?? "NULL"}`);
  }
  p(`  advisories   ${JSON.stringify(live.advisories)}`);

  assertThat(
    "D2-B1",
    "the product count writes ONE ordinary line per ACTIVE member",
    `${activeMembers.length} lines`,
    `${liveLines.length} lines`,
    liveLines.length === activeMembers.length,
  );
  assertThat(
    "D2-B1b",
    "the member lines' oz sum EXACTLY to the oz that was entered (nothing is lost to the allocation)",
    `${liveCountedOz}`,
    `${sum(liveLines.map((l) => l.resolved_oz ?? 0))}`,
    Math.abs(sum(liveLines.map((l) => l.resolved_oz ?? 0)) - liveCountedOz) < 1e-9,
  );
  assertThat(
    "D2-B2",
    "every derived line carries allocated_from_product_id (an auditor can tell an allocation from a measurement)",
    `all ${liveLines.length} = ${prod.id}`,
    liveLines.map((l) => l.allocated_from_product_id ?? "NULL").join(","),
    liveLines.length > 0 && liveLines.every((l) => l.allocated_from_product_id === prod.id),
  );
  const zeroLines = liveLines.filter((l) => (l.resolved_oz ?? 0) === 0);
  assertThat(
    "D2-B2b",
    "the member the shelf gave nothing to gets a MEASURED ZERO line, not a stale anchor beside a fresh one",
    ">=1 zero-oz line (the whole product re-anchors)",
    `${zeroLines.length} zero-oz line(s) of ${liveLines.length}`,
    zeroLines.length === activeMembers.length - 1,
  );
  assertThat(
    "D2-B5a",
    "with NO receipt history the advisory is `no_lot_history`, NOT `count_exceeds_lots` (same arithmetic, different sentence — it must not cry wolf on every count this month)",
    "no_lot_history",
    live.advisories.map((a) => a.code).join(",") || "(none)",
    live.advisories.length === 1 && live.advisories[0]!.code === "no_lot_history",
  );
  assertThat(
    "D2-B5b",
    "the unexplained oz is ABSORBED by the resolved primary and named, never refused and never dropped",
    `absorbedBySkuId=${entry.resolution.skuId}`,
    `${live.advisories[0]?.absorbedBySkuId ?? "null"} (${live.advisories[0]?.absorbedByVendorName ?? "—"})`,
    live.advisories[0]?.absorbedBySkuId === entry.resolution.skuId,
  );
  assertThat(
    "D2-B2c",
    "the audit row reconstructs the derivation: which primary answered, on which rung, what the lots could place",
    "primary_sku_id + resolution_rung + allocated + reason present",
    JSON.stringify({
      primary: liveProductLine["primary_sku_id"] != null,
      rung: liveProductLine["resolution_rung"],
      allocated: Array.isArray(liveProductLine["allocated"]),
      reason: liveProductLine["reason"],
      lot_count: liveProductLine["lot_count"],
    }),
    liveProductLine["primary_sku_id"] === entry.resolution.skuId &&
      typeof liveProductLine["resolution_rung"] === "string" &&
      Array.isArray(liveProductLine["allocated"]) &&
      liveProductLine["reason"] === "no_lot_history",
  );

  // ── SCENE 3 — the injected world: two vendors, interleaved deliveries ────────
  h("scene 3 — two vendors carry stock (INJECTED lots: PFG 120 · Baldor 80 · PFG 100)");
  const primaryId = entry.resolution.skuId!;
  const backupId = activeMembers.find((m) => m.skuId !== primaryId)!.skuId;
  const DELIVERY_A = "00000000-0000-4000-8000-00000000d001";
  const DELIVERY_B = "00000000-0000-4000-8000-00000000d002";
  const synDeliveries = [
    { id: DELIVERY_A, location_id: loc.id, delivery_date: "2026-08-14" },
    { id: DELIVERY_B, location_id: loc.id, delivery_date: "2026-08-18" },
  ];
  const synLines = [
    { id: "00000000-0000-4000-8000-00000000e001", delivery_id: DELIVERY_A, vendor_item_id: primaryId, created_at: "2026-08-14T10:00:00Z", resolved_oz: 120 },
    { id: "00000000-0000-4000-8000-00000000e002", delivery_id: DELIVERY_A, vendor_item_id: backupId, created_at: "2026-08-16T10:00:00Z", resolved_oz: 80 },
    { id: "00000000-0000-4000-8000-00000000e003", delivery_id: DELIVERY_B, vendor_item_id: primaryId, created_at: "2026-08-18T10:00:00Z", resolved_oz: 100 },
  ];
  clearRewriters();
  addRewriter(injectRowsRewriter("vendor_deliveries", `location_id=eq.${loc.id}`, synDeliveries));
  addRewriter(injectRowsRewriter("vendor_delivery_items", "vendor_item_id=in.", synLines));

  const memberMap = new Map([[prod.id, activeMembers.map((m) => m.skuId)]]);
  const { lotsByProduct } = await loadProductLots(loc.id, memberMap);
  const lots = lotsByProduct.get(prod.id) ?? [];
  p(`  lots seen by loadProductLots: ${lots.map((l) => `${l.lotId.slice(-4)}:${l.oz}oz@${l.receivedAt.slice(0, 10)}`).join(" ")}`);
  assertThat(
    "D2-B3a",
    "the lot loader pools BOTH vendors' receipt lines under the one product",
    "3 lots totalling 300 oz across 2 skus",
    `${lots.length} lots totalling ${sum(lots.map((l) => l.oz))} oz across ${new Set(lots.map((l) => l.skuId)).size} skus`,
    lots.length === 3 && sum(lots.map((l) => l.oz)) === 300 && new Set(lots.map((l) => l.skuId)).size === 2,
  );
  const form2 = await loadCountFormData(actor, loc.id);
  const hamOption2 = form2.products.find((o) => o.productId === prod.id)!;
  assertThat(
    "D2-B3b",
    "with 2+ members carrying stock, tap-to-split is offered on the spec's own trigger",
    "splitAvailable=true, lotBearingMemberCount=2",
    `splitAvailable=${hamOption2.splitAvailable}, lotBearingMemberCount=${hamOption2.lotBearingMemberCount}`,
    hamOption2.splitAvailable === true && hamOption2.lotBearingMemberCount === 2,
  );

  // ── SCENE 4 — a product count against a real shelf ───────────────────────────
  h("scene 4 — HAM counted as a PRODUCT against the interleaved shelf");
  resetCaptured();
  const shelf = await createCountEvent(actor, {
    locationId: loc.id,
    note: "sim day 2 — product count, injected shelf",
    lines: [{ productId: prod.id, levelLabel: level, qty: QTY }],
  });
  const shelfLines = capturedCountLines();
  const shelfMeta = capturedAuditMeta("sku_count.recorded");
  const shelfProductLine = ((shelfMeta?.["product_lines"] as Array<Record<string, unknown>>) ?? [])[0] ?? {};
  const shelfCountedOz = Number(shelfProductLine["counted_oz"] ?? NaN);
  p(`  entered ${QTY} × "${level}" = ${shelfCountedOz} oz against a 300 oz shelf`);
  for (const l of shelfLines) {
    const m = activeMembers.find((x) => x.skuId === l.sku_id);
    p(`    ${m?.vendorName ?? l.sku_id.slice(0, 8)}  resolved_oz=${l.resolved_oz}  allocated_from=${l.allocated_from_product_id ?? "NULL"}`);
  }
  p(`  advisories ${JSON.stringify(shelf.advisories)}  ·  lot_count=${shelfProductLine["lot_count"]}  consumed_term_known=${shelfProductLine["consumed_term_known"]}`);
  assertThat(
    "D2-B1c",
    "against a real shelf the member lines STILL sum exactly to the entered oz",
    `${shelfCountedOz}`,
    `${sum(shelfLines.map((l) => l.resolved_oz ?? 0))}`,
    Math.abs(sum(shelfLines.map((l) => l.resolved_oz ?? 0)) - shelfCountedOz) < 1e-9,
  );
  const advisoryCode = shelf.advisories[0]?.code ?? null;
  assertThat(
    "D2-B5c",
    "a count the lots CAN place raises no advisory; one they cannot raises `count_exceeds_lots` (never `no_lot_history` once lots exist)",
    shelfCountedOz > 300 ? "count_exceeds_lots" : "(none)",
    advisoryCode ?? "(none)",
    shelfCountedOz > 300 ? advisoryCode === "count_exceeds_lots" : advisoryCode === null,
  );

  // ── SCENE 5 — the second session taps to SPLIT and counts each vendor ────────
  h("scene 5 — a second session taps to SPLIT and counts each vendor");
  resetCaptured();
  const splitLevelPrimary = form2.skus.find((s) => s.id === primaryId)?.chainLabels[0] ?? level;
  const splitLevelBackup = form2.skus.find((s) => s.id === backupId)?.chainLabels[0] ?? level;
  await createCountEvent(actor, {
    locationId: loc.id,
    note: "sim day 2 — tap-to-split, per vendor",
    lines: [
      { skuId: primaryId, levelLabel: splitLevelPrimary, qty: 2, isLoose: false, partialFraction: null },
      { skuId: backupId, levelLabel: splitLevelBackup, qty: 1, isLoose: false, partialFraction: null },
    ],
  });
  const splitLines = capturedCountLines();
  for (const l of splitLines) {
    const m = activeMembers.find((x) => x.skuId === l.sku_id);
    p(`    ${m?.vendorName ?? l.sku_id.slice(0, 8)}  level="${l.level_label}" qty=${l.qty}  resolved_oz=${l.resolved_oz}  allocated_from=${l.allocated_from_product_id ?? "NULL (counted directly)"}`);
  }
  assertThat(
    "D2-B2d",
    "a tap-to-split line is an ORDINARY per-SKU count: allocated_from_product_id is NULL",
    "all NULL",
    splitLines.map((l) => String(l.allocated_from_product_id ?? "NULL")).join(","),
    splitLines.length === 2 && splitLines.every((l) => (l.allocated_from_product_id ?? null) === null),
  );
  assertThat(
    "D2-B3c",
    "the split count anchors per-SKU exactly as a pre-arc count did — same level, same qty, weight dimension, one row per SKU",
    "2 rows, dimension=weight, qty as entered",
    splitLines.map((l) => `${l.anchor_dimension}:${l.qty}`).join(","),
    splitLines.length === 2 &&
      splitLines.every((l) => l.anchor_dimension === "weight") &&
      splitLines.map((l) => l.qty).join(",") === "2,1",
  );

  // ── SCENE 6 — the on-hand panel, and the death of the mirrored SHORT/OVER ────
  h("scene 6 — the on-hand panel: two grains, and the audit's mirrored alarm");
  clearRewriters();
  const view = await loadOnHandDerived(actor, loc.id, Date.now(), { withProducts: true });
  const hamRow = view.products.find((r) => r.productId === prod.id) ?? null;
  p(`  product rows on the panel: ${view.products.length}`);
  if (hamRow) {
    p(`  HAM  totalOz=${hamRow.totalOz ?? "UNKNOWN"}  knownOz=${hamRow.knownOz}  unknown=[${hamRow.unknownSkuIds.map((s) => s.slice(0, 8)).join(",")}]  variance=${hamRow.varianceOz ?? "null"}`);
    for (const m of hamRow.members) p(`     ${m.vendorName ?? "?"}  onHand=${m.onHandOz ?? "null"}`);
  }
  // A product row exists only where a MEMBER has an on-hand row, and a member has one
  // only where it carries an anchor (a count, a par estimate, or an inferred baseline).
  // Ham has never been counted and never been received here, so it has no anchor and
  // no product row — the honest output, not a gap. Assert the rollup on the rows that
  // DO exist rather than demanding one the ledger cannot justify.
  // Only WEIGHT-dimension rows carry an ounce; a count-dimension (packaging) row has
  // no honest ounce and no product grain to sum into (plan Task 5.5).
  const rowsBySku = new Map(
    view.rows.filter((r) => r.dimension === "weight").map((r) => [r.skuId, r] as const),
  );
  assertThat(
    "D2-B4a",
    "every product row on the panel sums EXACTLY the per-SKU rows underneath it (the ledgers stay the truth; the grain is their sum)",
    "each totalOz === sum of its members' onHandOz, or null when one is unknown",
    view.products
      .map((r) => {
        const parts = r.members.map((m) => rowsBySku.get(m.skuId)?.onHandOz ?? null);
        const known = parts.filter((v): v is number => v != null);
        const expected = known.length === parts.length ? round(known.reduce((a, b) => a + b, 0), 6) : null;
        return `${r.productName}: total=${r.totalOz == null ? "null" : round(r.totalOz, 6)} expected=${expected ?? "null"}`;
      })
      .join(" · ") || "(no product rows)",
    view.products.every((r) => {
      const parts = r.members.map((m) => rowsBySku.get(m.skuId)?.onHandOz ?? null);
      const known = parts.filter((v): v is number => v != null);
      const expected = known.length === parts.length ? known.reduce((a, b) => a + b, 0) : null;
      if (expected == null) return r.totalOz == null;
      return r.totalOz != null && Math.abs(r.totalOz - expected) < 1e-9;
    }),
  );
  assertThat(
    "D2-B4b",
    "a member we could not resolve makes totalOz NULL — knownOz is a LOWER BOUND and is never presented as the total",
    "totalOz null exactly when unknownSkuIds is non-empty",
    view.products.map((r) => `${r.productName}: total=${r.totalOz == null ? "null" : "num"} unknown=${r.unknownSkuIds.length}`).join(" · ") || "(no product rows)",
    view.products.every((r) => (r.unknownSkuIds.length === 0 ? r.totalOz != null : r.totalOz == null)),
  );
  if (hamRow == null) {
    incident(
      "SIM-PI-7",
      "NOTE",
      "HAM has NO row on the two-grain on-hand panel: a product row exists only where a member carries an on-hand " +
        "anchor, and neither ham twin has ever been counted or received at this shop. Correct and honest, but it means " +
        "the arc's headline read surface is DARK for its headline product until Juan's first count — worth saying out " +
        "loud so an empty panel is not read as a broken one.",
    );
  }

  // THE audit finding, run as arithmetic on the real rollup: pin A dead + receive B
  // makes A read OVER by X and B read SHORT by X. Per-SKU they are two alarms; at the
  // product grain they are the same 100 oz seen twice, and they cancel.
  const mirrored = buildProductOnHandRow({
    productId: prod.id,
    productName: HAM,
    members: [
      { skuId: primaryId, skuName: "Ham", vendorName: "PFG", onHandOz: 40, varianceOz: -140, censusAnchored: true },
      { skuId: backupId, skuName: "Ham", vendorName: "Baldor", onHandOz: 60, varianceOz: 140, censusAnchored: true },
    ],
    lots: [],
  });
  p(`  mirrored pair: member variances -140 / +140  →  product variance ${mirrored.varianceOz}, total ${mirrored.totalOz}`);
  assertEq(
    "D2-B4c",
    "the audit's MIRRORED false SHORT/OVER pair nets to zero at the product grain (the twins were always one shelf)",
    { varianceOz: 0, totalOz: 100 },
    { varianceOz: mirrored.varianceOz, totalOz: mirrored.totalOz },
  );
  const oneNonCensus = buildProductOnHandRow({
    productId: prod.id,
    productName: HAM,
    members: [
      { skuId: primaryId, skuName: "Ham", vendorName: "PFG", onHandOz: 40, varianceOz: -140, censusAnchored: true },
      { skuId: backupId, skuName: "Ham", vendorName: "Baldor", onHandOz: 60, varianceOz: 140, censusAnchored: false },
    ],
    lots: [],
  });
  assertThat(
    "D2-B4d",
    "variance is CENSUS-ONLY: one inferred/par-estimate member makes the product's variance null rather than a half-true number",
    "varianceOz=null",
    `varianceOz=${oneNonCensus.varianceOz ?? "null"}`,
    oneNonCensus.varianceOz === null,
  );
  const partial = rollupProductGrain({
    productId: prod.id,
    members: [{ skuId: primaryId, oz: 40 }, { skuId: backupId, oz: null }],
  });
  assertEq(
    "D2-B4e",
    "one unresolvable member: totalOz null, knownOz 40, and the unresolved member is NAMED",
    { totalOz: null, knownOz: 40, unknownSkuIds: [backupId] },
    { totalOz: partial.totalOz, knownOz: partial.knownOz, unknownSkuIds: partial.unknownSkuIds },
  );

  // ── SCENE 7 — two product lines for ONE product in one event ────────────────
  h("scene 7 — the operator enters HAM twice in one sheet (2 cases + 3 lb loose)");
  clearRewriters();
  addRewriter(injectRowsRewriter("vendor_deliveries", `location_id=eq.${loc.id}`, synDeliveries));
  addRewriter(injectRowsRewriter("vendor_delivery_items", "vendor_item_id=in.", synLines));
  resetCaptured();
  let twoLineError: string | null = null;
  let twoLineSum = 0;
  let twoLineExpected = 0;
  try {
    await createCountEvent(actor, {
      locationId: loc.id,
      note: "sim day 2 — same product on two lines",
      lines: [
        { productId: prod.id, levelLabel: level, qty: 3 },
        { productId: prod.id, levelLabel: level, qty: 1 },
      ],
    });
    const rows = capturedCountLines();
    twoLineSum = sum(rows.map((l) => l.resolved_oz ?? 0));
    const meta = capturedAuditMeta("sku_count.recorded");
    const pls = (meta?.["product_lines"] as Array<Record<string, unknown>>) ?? [];
    twoLineExpected = sum(pls.map((l) => Number(l["counted_oz"] ?? 0)));
    const bySku = new Map<string, number>();
    for (const r of rows) bySku.set(r.sku_id, (bySku.get(r.sku_id) ?? 0) + 1);
    p(`  ${rows.length} lines written for ${bySku.size} skus (${[...bySku.values()].join(",")} per sku); oz ${twoLineSum} vs entered ${twoLineExpected}`);
    const duplicateSkuLines = [...bySku.values()].some((n) => n > 1);
    if (duplicateSkuLines) {
      incident(
        "SIM-PI-5",
        "P1",
        "two PRODUCT lines for the same product in one event write TWO sku_count_lines per member SKU — " +
          "the council-L5 disjointness the anchor sum rests on, violated in the one form nothing guarded.",
      );
    }
  } catch (e) {
    twoLineError = e instanceof Error ? e.message : String(e);
    p(`  refused: ${twoLineError}`);
  }
  assertThat(
    "D2-B6",
    "two lines naming the SAME product in one event are either refused OR written disjointly (one line per member sku)",
    "refused, or exactly one line per member",
    twoLineError != null
      ? `refused: ${twoLineError}`
      : `${capturedCountLines().length} lines for ${activeMembers.length} members`,
    twoLineError != null || capturedCountLines().length === activeMembers.length,
  );

  h("write guard");
  const byTable = new Map<string, number>();
  for (const w of capturedWrites()) byTable.set(`${w.method} ${w.table}`, (byTable.get(`${w.method} ${w.table}`) ?? 0) + 1);
  for (const [k, n] of byTable) p(`  intercepted ${n} × ${k}`);
  p("  every one was answered synthetically. ZERO rows were written to production.");

  const { fail } = summary();
  process.exitCode = fail > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

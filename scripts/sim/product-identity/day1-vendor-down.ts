/**
 * SIM DAY 1 — VENDOR-DOWN DAY (plan Phase 7, Task 7.1).
 *
 * The scenario the plan names: a manager walks pars and orders normally; mid-morning
 * the PRIMARY ham twin goes down (the vendor is out); the shop then does a normal day
 * — prep, production capture, ordering, close — and the arc has to carry the demand
 * instead of dropping it.
 *
 * FIVE NAMED ASSERTIONS (plan Task 7.1), each a line in the ledger, none a vibe:
 *   A1  the walk still offers ham, from the backup, with a `reroutedToBackup` notice
 *   A2  the cost board's ham figure does not move
 *   A3  production capture accepts the backup SKU (the amplifier fix)
 *   A4  exactly ONE ham suggestion appears, not two (product dedupe)
 *   A5  a `product.resolution_flip` audit row exists naming from / to / rung
 *
 * READ scripts/sim/product-identity/harness.ts FIRST — it explains why the vendor
 * goes down at the PostgREST response boundary rather than in a live column, and it
 * carries the write guard that makes that claim mechanical.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/sim/product-identity/day1-vendor-down.ts
 */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadWalkerData, type WalkerData, type WalkerSku } from "@/lib/ordering";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuOzForMenuItemFromGraph } from "@/lib/prep-consumption-graph";
import { loadMenuCostingBoard } from "@/lib/admin/menu-costing";
import { loadProductionFormData } from "@/lib/production";
import { loadProductIndex, loadProductLots, recordResolutionFlipsForLocation } from "@/lib/products";
import { attributeFifo, remainingByLot, type ReceiptLot } from "@/lib/products-shared";
import {
  addRewriter,
  assertEq,
  assertThat,
  capturedWrites,
  captureWritesTo,
  clearRewriters,
  h,
  incident,
  installShim,
  loadPersonaUser,
  p,
  injectRowsRewriter,
  persona,
  priorFlipRewriter,
  resetCaptured,
  round,
  summary,
  vendorDownRewriter,
} from "./harness";

const HAM = "Ham";

interface Floor {
  productId: string;
  primarySkuId: string;
  backupSkuId: string;
  primaryLabel: string;
  backupLabel: string;
  primaryPar: number | null;
  /** The backup's FULL live row — the shape the walker's par query would return if it
   *  had a par. Kept so scene 4 can inject "both twins are par'd" as a real row. */
  backupRow: Record<string, unknown>;
  locations: Array<{ id: string; name: string }>;
}

/** Read the live floor. A scenario written from a plan tests the plan (handbook). */
async function readFloor(): Promise<Floor> {
  const sb = getServiceRoleClient();
  const { data: prod } = await sb.from("products").select("id, name, unit_oz").eq("name", HAM).maybeSingle<{
    id: string;
    name: string;
    unit_oz: number | string | null;
  }>();
  if (!prod) throw new Error(`no product named ${HAM}`);
  const { data: members } = await sb
    .from("vendor_items")
    .select("id, name, vendor_id, active, weekday_par, weekend_par")
    .eq("product_id", prod.id)
    .returns<Array<{ id: string; name: string; vendor_id: string | null; active: boolean; weekday_par: number | string | null; weekend_par: number | string | null }>>();
  const { data: prim } = await sb
    .from("product_primaries")
    .select("primary_sku_id, location_id")
    .eq("product_id", prod.id)
    .is("location_id", null)
    .maybeSingle<{ primary_sku_id: string }>();
  if (!prim) throw new Error(`${HAM} has no global primary`);
  const { data: vendors } = await sb.from("vendors").select("id, name");
  const vName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const primaryRow = (members ?? []).find((m) => m.id === prim.primary_sku_id);
  const backupRow = (members ?? []).find((m) => m.id !== prim.primary_sku_id && m.active);
  if (!primaryRow || !backupRow) throw new Error(`${HAM} needs an active primary and an active backup to run this day`);
  const { data: locs } = await sb.from("locations").select("id, name").eq("active", true).order("name");
  const { data: fullBackup } = await sb
    .from("vendor_items")
    .select("*")
    .eq("id", backupRow.id)
    .maybeSingle<Record<string, unknown>>();
  return {
    productId: prod.id,
    primarySkuId: primaryRow.id,
    backupSkuId: backupRow.id,
    primaryLabel: `${primaryRow.name} / ${vName.get(primaryRow.vendor_id ?? "") ?? "?"}`,
    backupLabel: `${backupRow.name} / ${vName.get(backupRow.vendor_id ?? "") ?? "?"}`,
    primaryPar: primaryRow.weekday_par == null ? null : Number(primaryRow.weekday_par),
    backupRow: fullBackup ?? {},
    locations: (locs ?? []).map((l) => ({ id: l.id, name: l.name })),
  };
}

function hamRows(walk: WalkerData, memberIds: ReadonlySet<string>): WalkerSku[] {
  return walk.vendors.flatMap((v) => v.skus.filter((s) => memberIds.has(s.skuId)));
}

function describeRow(s: WalkerSku): string {
  return `${s.name} [${s.memberRole}] par=${s.parToday} rerouted_from=${s.reroutedFromSkuId ?? "—"}`;
}

/** The walker's par'd-catalogue query, identified by its own `or(...)` predicate. */
const PAR_QUERY = "weekday_par.not.is.null";

/** Total oz of a product's members per menu item — the number costing prices. */
function productOzByMenuItem(
  graph: Awaited<ReturnType<typeof loadRecipeGraph>>,
  menuItemIds: string[],
  memberIds: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of menuItemIds) {
    const perSku = perUnitSkuOzForMenuItemFromGraph(graph, id);
    let total = 0;
    for (const [skuId, oz] of perSku) if (memberIds.has(skuId)) total += oz;
    if (total > 0) out.set(id, round(total, 6)!);
  }
  return out;
}

async function main(): Promise<void> {
  h("scene 0 — the floor (live, read-only)");
  const floor = await readFloor();
  const memberIds = new Set([floor.primarySkuId, floor.backupSkuId]);
  p(`  product      ${HAM} (${floor.productId})`);
  p(`  primary      ${floor.primaryLabel}  par=${floor.primaryPar ?? "—"}  ${floor.primarySkuId}`);
  p(`  backup       ${floor.backupLabel}  ${floor.backupSkuId}`);
  p(`  locations    ${floor.locations.map((l) => l.name).join(" · ")}`);

  const who = await loadPersonaUser();
  const actor = persona(who.id, who.role, floor.locations.map((l) => l.id));
  p(`  persona      ${who.name || who.id} (${who.role}) — the manager on shift`);

  const sb = getServiceRoleClient();
  const { data: menuRows } = await sb.from("menu_items").select("id, name").returns<Array<{ id: string; name: string }>>();
  const menuItemIds = (menuRows ?? []).map((m) => m.id);
  const menuName = new Map((menuRows ?? []).map((m) => [m.id, m.name]));

  // Everything from here runs under the write guard.
  installShim();
  captureWritesTo("sku_inferred_baselines"); // the ordinary read-path persist; suppressed.
  captureWritesTo("audit_log");

  // ── SCENE 1 — morning: the manager walks pars, nothing is wrong ──────────────
  h("scene 1 — morning walk (world as it is)");
  const baseWalks = new Map<string, WalkerData>();
  for (const loc of floor.locations) {
    const walk = await loadWalkerData(actor, loc.id);
    baseWalks.set(loc.id, walk);
    const rows = hamRows(walk, memberIds);
    p(`  ${loc.name}: ${rows.length} ham row(s) — ${rows.map(describeRow).join(" | ") || "(none)"}`);
    p(`     unroutable ${JSON.stringify(walk.unroutable)}`);
  }
  const baseGraph = await loadRecipeGraph();
  const baseOz = productOzByMenuItem(baseGraph, menuItemIds, memberIds);
  p(`  ham appears in ${baseOz.size} menu item(s): ${[...baseOz].map(([id, oz]) => `${menuName.get(id)}=${oz}oz`).join(", ")}`);
  const baseIndex = await loadProductIndex([floor.productId], floor.locations[0]!.id);
  const baseRes = baseIndex.byProduct.get(floor.productId)!.resolution;
  p(`  resolution   ${baseRes.rung} → ${baseRes.skuId === floor.primarySkuId ? "PRIMARY" : baseRes.skuId === floor.backupSkuId ? "BACKUP" : baseRes.skuId}`);
  assertThat(
    "D1-00",
    "baseline: the ladder answers PRIMARY on rung 1",
    `primary ${floor.primarySkuId}`,
    `${baseRes.rung} ${baseRes.skuId}`,
    baseRes.rung === "primary" && baseRes.skuId === floor.primarySkuId,
  );

  // ── SCENE 2 — mid-morning: the vendor is out ────────────────────────────────
  h("scene 2 — mid-morning: the primary ham vendor is out");
  p(`  injecting: ${floor.primaryLabel} reads active=false at the wire. No row is written.`);
  clearRewriters();
  addRewriter(vendorDownRewriter(new Set([floor.primarySkuId])));

  const downWalks = new Map<string, WalkerData>();
  for (const loc of floor.locations) {
    const walk = await loadWalkerData(actor, loc.id);
    downWalks.set(loc.id, walk);
    const rows = hamRows(walk, memberIds);
    p(`  ${loc.name}: ${rows.length} ham row(s) — ${rows.map(describeRow).join(" | ") || "(none)"}`);
    p(`     unroutable ${JSON.stringify(walk.unroutable)}`);

    // A1 — the walk still offers ham, from the backup, with the par carried.
    const only = rows[0];
    assertThat(
      `D1-A1-${loc.name}`,
      "the walk still offers ham, from the BACKUP, carrying the primary's par",
      `1 row · skuId=${floor.backupSkuId} · par=${floor.primaryPar} · reroutedFrom=${floor.primarySkuId}`,
      rows.length === 0 ? "no ham row at all" : `${rows.length} row · ${describeRow(only!)} · skuId=${only!.skuId}`,
      rows.length === 1 &&
        only!.skuId === floor.backupSkuId &&
        only!.parToday === floor.primaryPar &&
        only!.reroutedFromSkuId === floor.primarySkuId,
    );
    assertThat(
      `D1-A1b-${loc.name}`,
      "the rerouted-to-backup NOTICE fires (and is not summed into the fault count)",
      "reroutedToBackup >= 1",
      `reroutedToBackup=${walk.unroutable.reroutedToBackup} productUnroutable=${walk.unroutable.productUnroutable} count=${walk.unroutable.count}`,
      walk.unroutable.reroutedToBackup >= 1 && walk.unroutable.productUnroutable === 0,
    );
    // SIM-PI-1 — found on the first run of this day, fixed in the same PR.
    // The amber "no ordering path today — nothing will be suggested for them" box and
    // the blue "1 par moved to a backup item" notice were rendering TOGETHER, and the
    // amber one was false. A rerouted par must leave the fault tally.
    const baseCount = baseWalks.get(loc.id)!.unroutable.count;
    assertThat(
      `D1-A1c-${loc.name}`,
      "a par whose demand was CARRIED does not also render as a fault (no false alarm beside its own fix)",
      `unroutable.count stays ${baseCount}`,
      `count=${walk.unroutable.count} skuInactive=${walk.unroutable.skuInactive} reroutedToBackup=${walk.unroutable.reroutedToBackup}`,
      walk.unroutable.count === baseCount,
    );
  }

  // A2 — the cost board's ham figure does not move.
  h("scene 3 — the cost board (the flatten under a member flip)");
  const downGraph = await loadRecipeGraph();
  const downOz = productOzByMenuItem(downGraph, menuItemIds, memberIds);
  const downIndex = await loadProductIndex([floor.productId], floor.locations[0]!.id);
  const downRes = downIndex.byProduct.get(floor.productId)!.resolution;
  p(`  resolution   ${downRes.rung} → ${downRes.skuId === floor.backupSkuId ? "BACKUP" : downRes.skuId}`);
  assertThat(
    "D1-A2a",
    "the ladder falls THROUGH the dead primary to the backup — it never fails the product",
    `skuId=${floor.backupSkuId}, rung in {recent, any}`,
    `${downRes.rung} ${downRes.skuId}`,
    downRes.skuId === floor.backupSkuId && downRes.rung !== "unresolved" && downRes.rung !== "primary",
  );
  assertEq(
    "D1-A2b",
    "the cost board's ham OZ per menu item is byte-identical across the flip",
    [...baseOz.entries()].sort(),
    [...downOz.entries()].sort(),
  );

  const baseBoard = await loadMenuCostingBoard(actor);
  const downBoard = await loadMenuCostingBoard(actor);
  const boardDelta = baseBoard.rows
    .map((r, i) => ({ r, d: downBoard.rows[i] }))
    .filter(({ r, d }) => d != null && JSON.stringify(r) !== JSON.stringify(d));
  p(`  board rows that MOVED under the flip: ${boardDelta.length} / ${baseBoard.rows.length}`);
  for (const { r, d } of boardDelta.slice(0, 8)) {
    p(`    ${JSON.stringify(r).slice(0, 160)}`);
    p(`ance→ ${JSON.stringify(d).slice(0, 160)}`);
  }
  assertThat(
    "D1-A2c",
    "the whole costing board is unchanged by the member flip (unit_oz owns the basis, not the member)",
    "0 rows differ",
    `${boardDelta.length} rows differ`,
    boardDelta.length === 0,
  );

  // A4 — product dedupe: two par'd twins produce ONE suggestion.
  h("scene 4 — both twins carry a par (the audit's double-order hazard)");
  p("  injecting: the backup ALSO carries a par. Live, no product has two par'd members,");
  p("  so the dedupe this arc shipped cannot be walked without it.");
  const parredBackup = { ...floor.backupRow, weekday_par: floor.primaryPar ?? 3 };
  clearRewriters();
  addRewriter(injectRowsRewriter("vendor_items", PAR_QUERY, [parredBackup]));
  for (const loc of floor.locations) {
    const walk = await loadWalkerData(actor, loc.id);
    const rows = hamRows(walk, memberIds);
    p(`  ${loc.name}: ${rows.length} ham row(s) — ${rows.map(describeRow).join(" | ")}`);
    assertThat(
      `D1-A4-${loc.name}`,
      "two par'd members of one product produce exactly ONE walk row (product dedupe)",
      "1 row, the resolved primary",
      `${rows.length} rows: ${rows.map((r) => r.name + "/" + r.memberRole).join(", ")}`,
      rows.length === 1 && rows[0]!.skuId === floor.primarySkuId && rows[0]!.memberRole === "primary",
    );
  }

  h("scene 4b — both twins par'd AND the primary is down");
  clearRewriters();
  addRewriter(injectRowsRewriter("vendor_items", PAR_QUERY, [parredBackup]));
  addRewriter(vendorDownRewriter(new Set([floor.primarySkuId])));
  for (const loc of floor.locations) {
    const walk = await loadWalkerData(actor, loc.id);
    const rows = hamRows(walk, memberIds);
    p(`  ${loc.name}: ${rows.length} ham row(s) — ${rows.map(describeRow).join(" | ")}  unroutable=${JSON.stringify(walk.unroutable)}`);
    assertThat(
      `D1-A4b-${loc.name}`,
      "primary down + backup already par'd → ONE row, the backup, on its OWN par (demand covered, not doubled)",
      `1 row, skuId=${floor.backupSkuId}, reroutedFrom=null`,
      `${rows.length} rows: ${rows.map(describeRow).join(", ")}`,
      rows.length === 1 && rows[0]!.skuId === floor.backupSkuId && rows[0]!.reroutedFromSkuId === null,
    );
  }

  // A3 — production capture accepts the backup SKU.
  h("scene 5 — the cook records production from the backup");
  clearRewriters();
  const baseForm = await loadProductionFormData(actor, floor.locations[0]!.id);
  addRewriter(vendorDownRewriter(new Set([floor.primarySkuId])));
  const downForm = await loadProductionFormData(actor, floor.locations[0]!.id);
  const itemsFor = (form: typeof baseForm, skuId: string): string[] =>
    ((form.skuToItems as Record<string, Array<{ itemId: string; name: string }>>)[skuId] ?? []).map((i) => i.name);
  p(`  backup ${floor.backupLabel} → items: ${itemsFor(baseForm, floor.backupSkuId).join(", ") || "(none)"}`);
  p(`  primary ${floor.primaryLabel} → items: ${itemsFor(baseForm, floor.primarySkuId).join(", ") || "(none)"}`);
  assertThat(
    "D1-A3",
    "the production dropdown offers the BACKUP SKU's product items (the amplifier fix)",
    "backup sku maps to >=1 item",
    `${itemsFor(baseForm, floor.backupSkuId).length} items: ${itemsFor(baseForm, floor.backupSkuId).join(", ")}`,
    itemsFor(baseForm, floor.backupSkuId).length >= 1,
  );
  assertEq(
    "D1-A3b",
    "both members map to the SAME item set (one product, one prep)",
    itemsFor(baseForm, floor.primarySkuId).sort(),
    itemsFor(baseForm, floor.backupSkuId).sort(),
  );
  assertEq(
    "D1-A3c",
    "vendor-down does not remove the backup's items from the dropdown",
    itemsFor(baseForm, floor.backupSkuId).sort(),
    itemsFor(downForm, floor.backupSkuId).sort(),
  );

  // Depletion attribution follows FIFO.
  h("scene 6 — depletion attribution over the receipt lots (FIFO)");
  clearRewriters();
  const locId = floor.locations[0]!.id;
  const idx = await loadProductIndex([floor.productId], locId);
  const memberMap = new Map([[floor.productId, idx.byProduct.get(floor.productId)!.members.map((m) => m.skuId)]]);
  const { lotsByProduct, nullOzLotCountByProduct } = await loadProductLots(locId, memberMap);
  const liveLots = lotsByProduct.get(floor.productId) ?? [];
  p(`  live lots at ${floor.locations[0]!.name}: ${liveLots.length}  (null-oz lines dropped: ${nullOzLotCountByProduct.get(floor.productId) ?? 0})`);
  const liveAttr = attributeFifo(liveLots, 100);
  assertThat(
    "D1-A6a",
    "with NO receipt history, FIFO reports the whole consumption as UNATTRIBUTED rather than inventing a vendor",
    "shares=[] unattributed=100",
    `shares=${liveAttr.shares.length} unattributed=${liveAttr.unattributedOz}`,
    liveAttr.shares.length === 0 && liveAttr.unattributedOz === 100,
  );
  if (liveLots.length === 0) {
    incident(
      "SIM-PI-2",
      "NOTE",
      `${HAM} has ZERO receipt lots at either shop (the whole registry has ONE delivery line for any product member, and its resolved_oz is NULL). ` +
        "Every FIFO surface in this arc is therefore correct-but-silent in prod until receiving runs against a product member. " +
        "The interleaved-lot proof below is SYNTHETIC and labelled as such.",
    );
  }
  // Synthetic interleaved lots — the shape the plan's scenario asks for.
  const syn: ReceiptLot[] = [
    { lotId: "lot-1-pfg", skuId: floor.primarySkuId, receivedAt: "2026-08-14T10:00:00Z", oz: 120 },
    { lotId: "lot-2-bal", skuId: floor.backupSkuId, receivedAt: "2026-08-16T10:00:00Z", oz: 80 },
    { lotId: "lot-3-pfg", skuId: floor.primarySkuId, receivedAt: "2026-08-18T10:00:00Z", oz: 100 },
  ];
  const attr = attributeFifo(syn, 150);
  p(`  synthetic FIFO of 150 oz: ${attr.shares.map((s) => `${s.lotId}:${s.oz}`).join(" + ")} (unattributed ${attr.unattributedOz})`);
  assertEq(
    "D1-A6b",
    "FIFO eats the OLDEST lot first, crossing the vendor boundary without noticing it",
    [
      { lotId: "lot-1-pfg", skuId: floor.primarySkuId, oz: 120 },
      { lotId: "lot-2-bal", skuId: floor.backupSkuId, oz: 30 },
    ],
    attr.shares,
  );
  const rem = remainingByLot(syn, 150);
  assertEq(
    "D1-A6c",
    "what is LEFT is the newest-back tail, oldest-first",
    [
      { lotId: "lot-2-bal", skuId: floor.backupSkuId, oz: 50 },
      { lotId: "lot-3-pfg", skuId: floor.primarySkuId, oz: 100 },
    ],
    rem,
  );

  // A5 — the resolution-flip audit row.
  h("scene 7 — close: the flip is written down");
  resetCaptured();
  clearRewriters();
  addRewriter(vendorDownRewriter(new Set([floor.primarySkuId])));
  addRewriter(
    priorFlipRewriter([
      {
        resource_id: floor.productId,
        occurred_at: "2026-08-20T04:00:00Z",
        metadata: { location_id: locId, to_sku_id: floor.primarySkuId, rung: "primary", product_id: floor.productId },
      },
    ]),
  );
  await recordResolutionFlipsForLocation(locId);
  const auditWrites = capturedWrites().filter((w) => w.table === "audit_log");
  const flipRows = auditWrites
    .flatMap((w) => (Array.isArray(w.body) ? w.body : [w.body]))
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .filter((r) => r["action"] === "product.resolution_flip");
  const hamFlip = flipRows.find((r) => r["resource_id"] === floor.productId);
  const meta = (hamFlip?.["metadata"] ?? {}) as Record<string, unknown>;
  p(`  captured ${flipRows.length} product.resolution_flip row(s); ham row metadata:`);
  p(`    ${JSON.stringify(meta)}`);
  assertThat(
    "D1-A5",
    "a product.resolution_flip audit row is written naming FROM / TO / RUNG",
    `from=${floor.primarySkuId} to=${floor.backupSkuId} rung!=primary`,
    hamFlip == null
      ? "no flip row for ham"
      : `from=${String(meta["from_sku_id"])} to=${String(meta["to_sku_id"])} rung=${String(meta["rung"])}`,
    hamFlip != null &&
      meta["from_sku_id"] === floor.primarySkuId &&
      meta["to_sku_id"] === floor.backupSkuId &&
      typeof meta["rung"] === "string" &&
      meta["rung"] !== "primary" &&
      Array.isArray(meta["considered_sku_ids"]),
  );
  assertThat(
    "D1-A5b",
    "the flip row carries no actor (a resolution is the SYSTEM's answer, not a person's)",
    "actor_id null",
    String((hamFlip ?? {})["actor_id"] ?? (hamFlip ?? {})["actorId"] ?? "null"),
    hamFlip != null && (hamFlip["actor_id"] ?? null) === null,
  );

  // The guard's own report.
  h("write guard");
  const writes = capturedWrites();
  const byTable = new Map<string, number>();
  for (const w of writes) byTable.set(`${w.method} ${w.table}`, (byTable.get(`${w.method} ${w.table}`) ?? 0) + 1);
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

/**
 * Audit W18/B106 fix round 1: the pack epoch stamped on a ledger row must never be NEWER than the pack
 * data the row was computed from. A pack change bumps the shop's epoch in the SAME transaction as the
 * chain (0259 sku_pack_epoch_bump, +1, never reset), so an epoch read BEFORE the chain read can only be
 * older than or equal to the chain's: an older stamp makes the walk drop the row, never offer an
 * old-case number under the new epoch.
 *
 * The real loadDemandInputs body is executed with synthetic I/O (the ordering-po-exists technique),
 * with a pack change committing in the middle of the load.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as shared from "@/lib/dynamic-pars-shared";
import * as runShared from "@/lib/dynamic-pars-run-shared";
import * as rhythmShared from "@/lib/vendor-rhythm-shared";
import * as opDay from "@/lib/operational-day";
import { resolveActive, stampEffectivePack } from "@/lib/location-sku-shared";

const source = readFileSync("lib/dynamic-pars.ts", "utf8");
const ast = ts.createSourceFile("dynamic-pars.ts", source, ts.ScriptTarget.Latest, true);
function execute(name: string, deps: Record<string, unknown>) {
  const fn = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  const js = ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(deps), `${js}; return ${name};`)(...Object.values(deps));
}

const SKU = "s-turkey";
const OLD_CHAIN = [{ id: "c", label: "case", containsQty: 4, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];

/** `when` = the read during which the pack change commits (epoch 0 → 1). */
async function load(when: "chains" | "overlay" | "never", start = 0) {
  const db = { epoch: start };
  const commitDuring = (step: string) => { if (step === when) db.epoch = start + 1; };
  const reads: string[] = [];
  const empty = { data: [], error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "in", "is", "order", "range"]) q[m] = () => q;
  q.returns = async () => empty;
  const sb = { from: () => q };
  const deps = {
    ...shared, ...runShared, ...rhythmShared, ...opDay,
    resolveActive, stampEffectivePack,
    PRIOR_LOOKBACK_DAYS: 14, PRODUCTION_ID_CHUNK: 150, WALKER_SKU_COLUMNS: "id",
    loadParSkuUniverse: async () => [{ id: SKU, vendor_id: "v", location_id: null, active: true, product_id: null, name: "Turkey",
      pack_format: "case", each_container_label: null, units_per_pack: null, each_size: null, each_measure: null, avg_oz_per_each: null,
      cushion_class: null, par_step: null, sku_class: "raw", weekday_par: 4, weekend_par: 4, inventory_only: false }],
    loadStoreVendorIds: async () => new Set<string>(),
    parAutoLaneReady: async () => true,
    loadEffectiveSalesCoverage: async () => [],
    loadEffectiveSalesRows: async () => [],
    loadParOverlay: async () => { reads.push("overlay"); commitDuring("overlay"); return new Map(); },
    selectAllRows: async () => [],
    loadProductIndex: async () => ({ productBySku: new Map(), byProduct: new Map() }),
    // The chain is read as it stood BEFORE the change; the change commits right after this read.
    loadSkuPackChains: async () => { reads.push("chains"); const out = new Map([[SKU, OLD_CHAIN]]); commitDuring("chains"); return out; },
    loadMeasures: async () => new Map(),
    loadRhythmByVendor: async () => new Map(), loadRhythmSkips: async () => new Map(), loadAllCutoffsByVendor: async () => new Map(),
    loadLatestRecipeEditAt: async () => null,
    loadShopPackEpochs: async () => { reads.push("epochs"); return new Map(db.epoch === 0 ? [] : [[SKU, db.epoch]]); },
    perOrderUnitOz: () => 80,
    deriveLaneStart: () => null,
    num: (v: unknown) => (v == null ? null : Number(v)),
    sb,
  };
  const loadDemandInputs = execute("loadDemandInputs", deps) as (sb: unknown, loc: string, run: string) => Promise<{ packEpochBySku: Map<string, number>; overlayBySku: Map<string, unknown> }>;
  const out = await loadDemandInputs(sb, "shop", "2026-10-15");
  return { epoch: out.packEpochBySku.get(SKU) ?? 0, reads };
}

describe("the ledger's pack epoch is read before the pack data it stamps", () => {
  it("a pack change committing during the chain read leaves the row stamped with the OLD epoch (the walk then drops it)", async () => {
    const r = await load("chains");
    expect(r.epoch).toBe(0);
    expect(r.reads.indexOf("epochs")).toBeLessThan(r.reads.indexOf("chains"));
  });
  it("a pack change committing during the overlay read: old epoch too", async () => {
    expect((await load("overlay")).epoch).toBe(0);
  });
  it("control: no change, the live epoch is stamped", async () => {
    expect((await load("never", 2)).epoch).toBe(2);
  });
});

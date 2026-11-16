/**
 * Audit W18/B106: the pack epoch stamped on a ledger row must never be NEWER than the pack data the
 * row was computed from. A pack change bumps the shop's epoch in the SAME transaction as the chain and
 * the par conversion (0259 sku_pack_epoch_bump, +1, never reset), so an epoch read BEFORE every
 * pack-dependent read can only be older than or equal to the data's: an older stamp makes the walk
 * drop the row, never offer an old-case number under the new epoch.
 *
 * THE RULE IS "EPOCH FIRST, EVERYTHING ELSE AFTER". Fix round 1 moved the epoch ahead of the overlay
 * and the chains, but still after the par'd-SKU universe, which carries the GLOBAL pars (fix round 2):
 * a global conversion committing between the universe read and the epoch read returned the new epoch
 * and the new case size beside the OLD global par.
 *
 * The real loadDemandInputs body is executed with synthetic I/O (the ordering-po-exists technique).
 * One pack conversion (case 4 lb → 8 lb, every par halved 4 → 2, epoch 0 → 1) commits right after
 * each read in turn; whatever the interleaving, a row stamped with the new epoch must carry only new
 * terms.
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
/** Every pack-dependent read of the loader, by the name its synthetic loader records. */
const PACK_READS = ["epochs", "universe", "overlay", "chains"] as const;
type Step = (typeof PACK_READS)[number] | "never";

/** Before / after the conversion: the chain's case, the global par and the shop's human par move together. */
const OLD = { epoch: 0, caseLb: 4, globalPar: 4, shopPar: 4 };
const NEW = { epoch: 1, caseLb: 8, globalPar: 2, shopPar: 2 };

/** `commitAfter` = the read right after which the conversion commits (`never`: no conversion). */
async function load(commitAfter: Step, start: typeof OLD = OLD, next: typeof NEW = NEW) {
  let db = { ...start };
  const reads: string[] = [];
  const read = <T>(step: Step, value: (s: typeof db) => T): T => {
    reads.push(step);
    const out = value(db);
    if (step === commitAfter) db = { ...next };
    return out;
  };
  const epochMap = (s: typeof db) => new Map<string, number>(s.epoch === 0 ? [] : [[SKU, s.epoch]]);
  const empty = { data: [], error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "in", "is", "order", "range"]) q[m] = () => q;
  q.returns = async () => empty;
  const sb = { from: () => q };
  const deps = {
    ...shared, ...runShared, ...rhythmShared, ...opDay,
    resolveActive, stampEffectivePack,
    PRIOR_LOOKBACK_DAYS: 14, PRODUCTION_ID_CHUNK: 150, WALKER_SKU_COLUMNS: "id",
    loadParSkuUniverse: async () => read("universe", (s) => [{ id: SKU, vendor_id: "v", location_id: null, active: true, product_id: null, name: "Turkey",
      pack_format: "case", each_container_label: null, units_per_pack: null, each_size: null, each_measure: null, avg_oz_per_each: null,
      cushion_class: null, par_step: null, sku_class: "raw", weekday_par: s.globalPar, weekend_par: s.globalPar, inventory_only: false }]),
    loadStoreVendorIds: async () => new Set<string>(),
    parAutoLaneReady: async () => true,
    loadEffectiveSalesCoverage: async () => [],
    loadEffectiveSalesRows: async () => [],
    loadParOverlay: async () => read("overlay", (s) => new Map([[SKU, {
      activeOverride: null, weekdayPar: s.shopPar, weekendPar: s.shopPar, pinnedWeekdayAt: null, pinnedWeekendAt: null,
    }]])),
    selectAllRows: async () => [],
    loadProductIndex: async () => ({ productBySku: new Map(), byProduct: new Map() }),
    loadSkuPackChains: async () => read("chains", (s) => new Map([[SKU, [
      { id: "c", label: "case", containsQty: s.caseLb, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 },
    ]]])),
    loadMeasures: async () => new Map(),
    loadRhythmByVendor: async () => new Map(), loadRhythmSkips: async () => new Map(), loadAllCutoffsByVendor: async () => new Map(),
    loadLatestRecipeEditAt: async () => null,
    // Both spellings of the epoch read: by id list (the old one) and the shop's whole map.
    loadShopPackEpochs: async () => read("epochs", epochMap),
    loadShopPackEpochsAt: async () => read("epochs", epochMap),
    perOrderUnitOz: (_sku: unknown, chain: Array<{ containsQty: number }> | null) => (chain?.[0] ? chain[0].containsQty * 16 : null),
    deriveLaneStart: () => null,
    num: (v: unknown) => (v == null ? null : Number(v)),
    sb,
  };
  type Out = {
    packEpochBySku: Map<string, number>;
    overlayBySku: Map<string, { weekdayPar: number | null }>;
    skus: Array<{ skuId: string; globalWeekdayPar: number | null; perOrderUnitOz: number | null }>;
  };
  const loadDemandInputs = execute("loadDemandInputs", deps) as (sb: unknown, loc: string, run: string) => Promise<Out>;
  const out = await loadDemandInputs(sb, "shop", "2026-10-15");
  const sku = out.skus.find((s) => s.skuId === SKU)!;
  return {
    epoch: out.packEpochBySku.get(SKU) ?? 0,
    globalPar: sku.globalWeekdayPar,
    caseOz: sku.perOrderUnitOz,
    shopPar: out.overlayBySku.get(SKU)?.weekdayPar ?? null,
    reads,
  };
}

describe("the ledger's pack epoch is read before EVERY pack-dependent input (epoch first)", () => {
  it("the epoch is the first pack-dependent read; the universe, the overlay and the chains all follow it", async () => {
    const { reads } = await load("never");
    const at = (r: string) => reads.indexOf(r);
    for (const r of PACK_READS.filter((p) => p !== "epochs")) expect(at("epochs"), r).toBeLessThan(at(r));
  });

  for (const step of PACK_READS) {
    it(`a conversion committing right after the ${step} read never stamps the new epoch on an old term`, async () => {
      const r = await load(step);
      if (r.epoch === NEW.epoch) {
        // A row stamped in the new pack must be computed wholly in it.
        expect({ globalPar: r.globalPar, caseOz: r.caseOz, shopPar: r.shopPar })
          .toEqual({ globalPar: NEW.globalPar, caseOz: NEW.caseLb * 16, shopPar: NEW.shopPar });
      } else {
        // An older stamp: the walk drops the row (ledgerEpochStands). Safe whatever the terms.
        expect(r.epoch).toBe(OLD.epoch);
      }
    });
  }

  it("the reviewer's repro: a global conversion between the universe and the epoch read stamps the OLD epoch", async () => {
    const r = await load("universe");
    expect(r.globalPar).toBe(OLD.globalPar);
    expect(r.epoch).toBe(OLD.epoch);
  });

  it("control: no change, the live epoch and the live terms", async () => {
    const r = await load("never", { epoch: 2, caseLb: 8, globalPar: 2, shopPar: 2 });
    expect(r).toMatchObject({ epoch: 2, globalPar: 2, caseOz: 128, shopPar: 2 });
  });
});

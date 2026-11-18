// Item 4 PR 1, review r3: A PAR TARGET IS THE FORECAST NIGHT'S COMPUTATION OVER THE REALIZED USAGE.
// Usage is joined by SKU id; which SKUs are a product is the forecast night's map, from its manifest. Nothing of
// the catalog as it stands at D+4 (membership, primary, active flag, par'd universe) is an input.
// The freeze nights below are built the way the loader builds them: the raw (date, sku) sums, and the lanes
// rolled from them by THAT night's membership through the real rollup (lib/dynamic-pars-run-shared.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DemandInputs } from "@/lib/dynamic-pars-engine-shared";
import { rollupLanesByProduct, rollupPerDate, sumPerDate } from "@/lib/dynamic-pars-run-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import {
  NO_SIGNAL, PAR_LEADS, forecastPars, parActualOz, parIdentityOf, parScoreRows, parTargetFromInputs, parTargetTotalOz, restoreParInputs,
  snapshotParInputs, type ParTarget,
} from "@/lib/demand-signals/replay";
import { buildParInputs, prng, sku } from "./helpers/par-engine-fixture";

const P = "00000000-0000-4000-8000-0000000009c1"; // the fixture's two-member product: { sku 15 (primary, speaks), sku 16 }
const Q = "00000000-0000-4000-8000-0000000009c2";
const R = "00000000-0000-4000-8000-0000000009c3";
const A = sku(15), B = sku(16);
const EXTRAS = [sku(40), sku(41), sku(42)]; // SKUs with no par: never in a night's `skus`, but they are used and can be members

// The forecast night.
const forecastNight = buildParInputs({ scale: 1.6, seed: 99 });
const DECISION = addDaysEt(forecastNight.runDateEt, 1);
const f = forecastPars(forecastNight, DECISION);
const identity = parIdentityOf(forecastNight);
const base = buildParInputs({ runDate: addDaysEt(forecastNight.runDateEt, 7), seed: 5 }); // a later night whose window holds every lead
const DATES = PAR_LEADS.map((l) => addDaysEt(DECISION, l));
// Covered = the SALES capture is complete for the day (review r4 #1); a recorded production does not cover it.
const COVERED = DATES.filter((d) => base.window.find((x) => x.dateEt === d)!.salesObserved);

interface Use { date: string; sku: string; direct: number; production: number }
interface Cat { product: Map<string, string | null>; active: Map<string, boolean>; primary: Map<string, string> }

const WORLD = [...forecastNight.skus.map((s) => s.skuId), ...EXTRAS];
function catalogAtForecast(): Cat {
  const product = new Map<string, string | null>(WORLD.map((id) => [id, forecastNight.productBySku.get(id) ?? null]));
  product.set(EXTRAS[0]!, Q); product.set(EXTRAS[2]!, R); // products the forecast night never loaded (no par'd member)
  return { product, active: new Map(WORLD.map((id) => [id, true])), primary: new Map([[P, A]]) };
}

/** A night as the loader assembles it under a catalog state: the raw sums, and the lanes rolled by THAT state's membership. */
function nightUnder(cat: Cat, uses: ReadonlyArray<Use>): DemandInputs {
  const productBySku = new Map<string, string>();
  for (const [id, p] of cat.product) if (p !== null) productBySku.set(id, p); // inactive members included, as the loader does
  const rawDirectOzByDate = sumPerDate(uses, (u) => u.date, (u) => u.sku, (u) => u.direct);
  const rawProductionOzByDate = sumPerDate(uses, (u) => u.date, (u) => u.sku, (u) => u.production);
  return {
    ...base,
    skus: base.skus.filter((s) => cat.active.get(s.skuId)).map((s) => {
      const productId = cat.product.get(s.skuId) ?? null;
      return { ...s, productId, grainKey: productId ?? s.skuId, writeHomeSkuId: (productId && cat.primary.get(productId)) || s.skuId };
    }),
    productBySku, rawDirectOzByDate, rawProductionOzByDate,
    directOzByDate: rollupLanesByProduct(rawDirectOzByDate, productBySku),
    productionOzByDate: rollupLanesByProduct(rawProductionOzByDate, productBySku),
  };
}
const targetsOf = (night: DemandInputs) => (validDate: string) => {
  const t = parTargetFromInputs(night, validDate);
  return t === null ? undefined : t.coverage === "covered" ? t.payload! : "not_covered" as const;
};
const frozen = (night: DemandInputs, date: string): ParTarget => parTargetFromInputs(night, date)!.payload!;

/** THE FORECAST NIGHT'S COMPUTATION, spelled out with no library code: the product's members THAT night, summed by SKU id. */
function forecastNightOz(uses: ReadonlyArray<Use>, date: string, skuId: string): number {
  const product = forecastNight.productBySku.get(skuId);
  const mine = (id: string) => (product === undefined ? id === skuId : forecastNight.productBySku.get(id) === product);
  let n = 0;
  for (const u of uses) if (u.date === date && mine(u.sku)) n += u.direct + u.production;
  return Math.round(n * 1e6) / 1e6;
}
const uses = (date: string, row: Record<string, number>): Use[] => Object.entries(row).map(([s, oz]) => ({ date, sku: s, direct: oz, production: 0 }));

describe("the fixture and the loader's two halves", () => {
  it("rollupPerDate is sumPerDate then the per-date product rollup", () => {
    const rows = [{ d: "2026-10-01", s: A, oz: 30 }, { d: "2026-10-01", s: B, oz: 20 }, { d: "2026-10-01", s: A, oz: 5 }, { d: "2026-10-02", s: sku(1), oz: 9 }];
    const map = new Map([[A, P], [B, P]]);
    const raw = sumPerDate(rows, (r) => r.d, (r) => r.s, (r) => r.oz);
    expect([...raw.get("2026-10-01")!]).toEqual([[A, 35], [B, 20]]);
    expect(rollupLanesByProduct(raw, map)).toEqual(rollupPerDate(rows, (r) => r.d, (r) => r.s, (r) => r.oz, map));
    expect(rollupLanesByProduct(raw, map).get("2026-10-01")!.get(B)).toBe(55);
  });
  it("the forecast speaks for P through its primary, and the night's identity names both members", () => {
    expect(f.terms[P]!.skuId).toBe(A);
    expect(identity.productBySku.get(A)).toBe(P);
    expect(identity.productBySku.get(B)).toBe(P);
    expect(COVERED.length).toBeGreaterThan(3);
  });
});

describe("a par target is the forecast night's computation, whatever the catalog did since", () => {
  const day = COVERED[0]!;
  const unit = { skuId: A };

  it("REASSIGNED THEN DEACTIVATED (review r3): P used 80 oz, Q used 200 oz, P scores 80", () => {
    // Forecast night: P = { A, B }. Before D+4: A is attached to Q (whose other member used 200 oz), then deactivated.
    // The freeze night's rollup includes inactive members, so its lane for A carries Q's 200; A is in nobody's par'd universe.
    const cat = catalogAtForecast();
    cat.product.set(A, Q); cat.active.set(A, false);
    const used = uses(day, { [B]: 80, [EXTRAS[0]!]: 200 });
    const night = nightUnder(cat, used);
    expect(night.skus.some((s) => s.skuId === A)).toBe(false);
    expect(night.directOzByDate.get(day)!.get(A)).toBe(200); // what the freeze night's own lane would say
    expect(parActualOz(frozen(night, day), unit, identity)).toBe(80);
    const scored = parScoreRows("shop", f, identity, targetsOf(night), NO_SIGNAL).filter((r) => r.unitKey === P && r.validDate === day);
    expect(scored.map((r) => r.actual)).toEqual([80]);
    // The coverage simulation reads through the same one reader, with the forecast's own unit.
    expect(parActualOz(frozen(night, day), f.coverage.find((u) => u.grainKey === P)!, identity)).toBe(80);
  });
  it("usage is joined by SKU id: what A itself used after it was moved is still the forecast's P", () => {
    const cat = catalogAtForecast();
    cat.product.set(A, Q); cat.active.set(A, false);
    const used = uses(day, { [A]: 30, [B]: 80, [EXTRAS[0]!]: 200 });
    expect(parActualOz(frozen(nightUnder(cat, used), day), unit, identity)).toBe(110);
    expect(forecastNightOz(used, day, A)).toBe(110);
  });
  it("each change alone, and every member gone: always the forecast night's number, never null, never another product's", () => {
    const used = uses(day, { [A]: 30, [B]: 50, [EXTRAS[0]!]: 200, [EXTRAS[2]!]: 7 });
    const variants: Array<(c: Cat) => void> = [
      () => undefined,
      (c) => c.product.set(A, Q),                                        // reassigned (review r2)
      (c) => c.active.set(A, false),                                     // deactivated (review r1)
      (c) => c.product.set(A, null),                                     // detached
      (c) => { c.active.set(A, false); c.product.set(A, Q); },           // deactivated, then reassigned
      (c) => { c.product.set(A, Q); c.product.set(B, R); },              // every member moved
      (c) => { c.product.set(A, Q); c.product.set(B, R); c.active.set(A, false); c.active.set(B, false); },
      (c) => { c.primary.set(P, B); c.product.set(EXTRAS[1]!, P); },     // primary flipped, a new member attached
    ];
    for (const change of variants) {
      const cat = catalogAtForecast(); change(cat);
      expect(parActualOz(frozen(nightUnder(cat, used), day), unit, identity)).toBe(80);
    }
    // A singleton whose SKU was since attached to a product keeps its own use.
    const single = Object.keys(f.terms).find((g) => f.terms[g]!.skuId === g)!;
    const cat = catalogAtForecast(); cat.product.set(single, Q);
    expect(parActualOz(frozen(nightUnder(cat, uses(day, { [single]: 12, [EXTRAS[0]!]: 200 })), day), { skuId: single }, identity)).toBe(12);
  });
  it("the identity of a RECORDED forecast is the stored manifest's", () => {
    const snap = snapshotParInputs(forecastNight);
    const store = new Map([snap.manifest, ...snap.parts].map((b) => [b.hash, b.text]));
    const restored = restoreParInputs(snap.manifest.hash, (h) => store.get(h));
    expect([...restored.productBySku].sort()).toEqual([...forecastNight.productBySku].sort());
    expect(restored.rawDirectOzByDate).toEqual(forecastNight.rawDirectOzByDate);
    expect(restored.rawProductionOzByDate).toEqual(forecastNight.rawProductionOzByDate);
    const cat = catalogAtForecast(); cat.product.set(A, Q); cat.active.set(A, false);
    const t = frozen(nightUnder(cat, uses(day, { [B]: 80, [EXTRAS[0]!]: 200 })), day);
    expect(parActualOz(t, unit, parIdentityOf(restored))).toBe(80);
    // A later night's membership is another manifest: the forecast's is not rewritten by it.
    const later = snapshotParInputs(nightUnder(cat, []));
    expect(later.manifest.hash).not.toBe(snap.manifest.hash);
  });
  it("PROPERTY: any sequence of reassign / detach / deactivate / reactivate / primary flip between the forecast and D+4 leaves every target as the forecast night computed it", () => {
    const PRODUCTS = [P, Q, R, "retired"];
    const named = [...new Set([...Object.values(f.terms).map((t) => t.skuId), ...f.coverage.map((u) => u.skuId), ...forecastNight.skus.map((s) => s.skuId)])].sort();
    let checks = 0, laneWouldLie = 0, ops = { reassign: 0, detach: 0, deactivate: 0, reactivate: 0, primary: 0 };
    for (let trial = 0; trial < 60; trial += 1) {
      const rand = prng(7_000 + trial);
      const pick = <T,>(xs: ReadonlyArray<T>): T => xs[Math.floor(rand() * xs.length)]!;
      // The realized usage of the week, by SKU id. It is what happened; no catalog change rewrites it.
      const used: Use[] = [];
      for (const date of COVERED) for (const id of WORLD) {
        if (rand() < 0.3) continue;
        used.push({ date, sku: id, direct: Math.round(rand() * 9000) / 100, production: rand() < 0.25 ? Math.round(rand() * 4000) / 100 : 0 });
      }
      const cat = catalogAtForecast();
      const atForecast = nightUnder(cat, used);
      const want = new Map(COVERED.map((d) => [d, JSON.stringify(frozen(atForecast, d))]));
      const wantRows = JSON.stringify(parScoreRows("shop", f, identity, targetsOf(atForecast), NO_SIGNAL));
      // With no change the freeze night's own rolled lane IS the answer: the reader agrees with the loader.
      for (const d of COVERED) for (const id of named) {
        const lane = (atForecast.directOzByDate.get(d)?.get(id) ?? 0) + (atForecast.productionOzByDate.get(d)?.get(id) ?? 0);
        expect(parActualOz(frozen(atForecast, d), { skuId: id }, identity)).toBeCloseTo(lane, 6);
      }
      for (let step = 0; step < 12; step += 1) {
        const id = pick(WORLD), roll = rand();
        if (roll < 0.35) { cat.product.set(id, pick(PRODUCTS)); ops.reassign += 1; }
        else if (roll < 0.5) { cat.product.set(id, null); ops.detach += 1; }
        else if (roll < 0.75) { cat.active.set(id, false); ops.deactivate += 1; }
        else if (roll < 0.9) { cat.active.set(id, true); ops.reactivate += 1; }
        else { const p = pick(PRODUCTS); cat.primary.set(p, pick(WORLD)); ops.primary += 1; }
        const night = nightUnder(cat, used); // the night a D+4 freeze would read, after this change
        for (const d of COVERED) {
          const t = frozen(night, d);
          expect(JSON.stringify(t)).toBe(want.get(d)); // the frozen payload itself carries no catalog state
          for (const skuId of named) {
            const got = parActualOz(t, { skuId }, identity);
            expect(got).toBe(forecastNightOz(used, d, skuId));
            checks += 1;
            const lane = (night.directOzByDate.get(d)?.get(skuId) ?? 0) + (night.productionOzByDate.get(d)?.get(skuId) ?? 0);
            if (Math.abs(lane - got) > 1e-6) laneWouldLie += 1;
          }
        }
        expect(JSON.stringify(parScoreRows("shop", f, identity, targetsOf(night), NO_SIGNAL))).toBe(wantRows);
      }
    }
    expect(checks).toBeGreaterThan(50_000);
    expect(laneWouldLie).toBeGreaterThan(1_000); // the test bites: the freeze night's lanes really do disagree
    for (const n of Object.values(ops)) expect(n).toBeGreaterThan(30);
  });
  it("the target total is the record's, over every SKU id", () => {
    const t = frozen(nightUnder(catalogAtForecast(), [{ date: day, sku: A, direct: 30, production: 4 }, { date: day, sku: EXTRAS[1]!, direct: 6, production: 0 }]), day);
    expect(t).toEqual({ v: 1, target: "par_product_day_oz", locationId: base.locationId, validDate: day, direct: { [A]: 30, [EXTRAS[1]!]: 6 }, production: { [A]: 4 } });
    expect(parTargetTotalOz(t)).toBe(40);
  });
  it("SOURCE PIN: the target and its reader name no catalog field of the freeze night", () => {
    const src = readFileSync("lib/demand-signals/replay.ts", "utf8");
    const body = (from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));
    const code = (text: string) => text.split("\n").filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l)).join("\n");
    const target = code(body("export function parTargetFromInputs", "/** Everything the record says"));
    const reader = code(body("const rolledByIdentity", "/** Both arms of the product-day ounce score"));
    for (const word of [".skus", "grainKey", "writeHomeSkuId", "productRetired", "productId", "overlayBySku", "directOzByDate", "productionOzByDate"]) {
      expect(target.includes(word), `parTargetFromInputs reads ${word}`).toBe(false);
      expect(reader.includes(word), `parActualOz reads ${word}`).toBe(false);
    }
    expect(target.includes("productBySku")).toBe(false);
    expect(reader.includes("identity.productBySku")).toBe(true);
    expect(src.includes("skuGrain")).toBe(false);
  });
});

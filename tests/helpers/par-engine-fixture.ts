// A deterministic DemandInputs fixture that walks every branch of the nightly par engine (item 4 PR 1).
// Synthetic ids and numbers only. Used by the engine equivalence pin and by the replay harness tests.
import type { DemandInputs, DemandSku, ParOverlayRow } from "@/lib/dynamic-pars-engine-shared";
import { dayClassForDate, type WindowDay } from "@/lib/dynamic-pars-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";

export const FIX_LOC = "00000000-0000-4000-8000-0000000000a1";
export const FIX_RUN_DATE = "2026-10-15";
const V1 = "00000000-0000-4000-8000-00000000b001";
const V2 = "00000000-0000-4000-8000-00000000b002";
const V3 = "00000000-0000-4000-8000-00000000b003";
export const sku = (n: number) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`;
const P1 = "00000000-0000-4000-8000-0000000009c1";

/** mulberry32: a fixed, portable stream so the fixture is the same on every machine. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SkuSpec {
  n: number; vendor?: string; product?: string | null; grain?: string; inventoryOnly?: boolean; retired?: boolean;
  cushion?: string | null; step?: number; wd: number | null; we: number | null; unitOz?: number | null; chain?: boolean;
  /** oz per weekday / weekend day, before noise; null = no direct lane. */
  direct?: [number, number] | null; production?: [number, number] | null; flattened?: [number, number] | null;
  startOffset?: number; rise?: number; spikeEvery?: number;
}

const SPECS: SkuSpec[] = [
  { n: 1, wd: 6, we: 8, cushion: "protein", direct: [40, 70], rise: 0.25 },
  { n: 2, wd: 2, we: 2, cushion: "produce", direct: [22, 30] },
  { n: 3, wd: 5, we: 5, inventoryOnly: true, direct: null },
  { n: 4, wd: 4, we: 4, product: "retired", retired: true, direct: [30, 30] },
  { n: 5, wd: 4, we: 4, unitOz: null, chain: false, direct: [30, 30] },
  { n: 6, wd: 4, we: 4, unitOz: null, chain: true, direct: [30, 30] },
  { n: 7, wd: 4, we: 4, direct: [30, 45], startOffset: 16 },
  { n: 8, wd: 4, we: 4, vendor: V3, direct: [30, 45] },
  { n: 9, wd: 10, we: null, cushion: "dairy", direct: [60, 110] },
  { n: 10, wd: 8, we: 8, cushion: "bakery", direct: [62, 62] },
  { n: 11, wd: 8, we: 8, cushion: "dry", direct: [62, 62] },
  { n: 12, wd: 40, we: 40, direct: [8, 8] },
  { n: 13, wd: 4, we: 4, direct: [0, 0], flattened: null },
  { n: 14, wd: 4, we: 4, direct: [0, 0], flattened: [25, 25] },
  { n: 15, wd: 6, we: 6, product: P1, grain: P1, direct: [50, 50] },
  { n: 16, wd: 6, we: 6, product: P1, grain: P1, vendor: V2, direct: [50, 50] },
  { n: 17, wd: 1.25, we: 1.5, step: 0.25, cushion: "frozen", direct: [9, 13] },
  { n: 18, wd: 5, we: 9, vendor: V2, cushion: "protein", direct: [30, 60], spikeEvery: 5 },
  { n: 19, wd: 8, we: 8, cushion: "dry", direct: [70, 70] },
  { n: 20, wd: 6, we: 6, vendor: V2, direct: [20, 20], production: [25, 30], flattened: [10, 10] },
];

export interface FixtureOptions { runDate?: string; seed?: number; scale?: number }

/** One night's engine inputs. `scale` multiplies every lane (a "revised history" in the replay tests). */
export function buildParInputs(o: FixtureOptions = {}): DemandInputs {
  const runDateEt = o.runDate ?? FIX_RUN_DATE;
  const scale = o.scale ?? 1;
  const rand = prng(o.seed ?? 20261015);
  const window: WindowDay[] = [];
  for (let i = 20; i >= 0; i -= 1) {
    const dateEt = addDaysEt(runDateEt, -i);
    // Two full-gap days (the shop's data missing), one production-only day.
    window.push({ dateEt, dayClass: dayClassForDate(dateEt), salesObserved: i !== 12 && i !== 6, productionObserved: i === 6 ? false : i % 4 === 0 });
  }
  const direct = new Map<string, Map<string, number>>(), production = new Map<string, Map<string, number>>(), flattened = new Map<string, Map<string, number>>();
  const put = (m: Map<string, Map<string, number>>, d: string, k: string, v: number) => {
    if (!(v > 0)) return;
    const row = m.get(d) ?? new Map<string, number>();
    row.set(k, Math.round(((row.get(k) ?? 0) + v) * 1e4) / 1e4);
    m.set(d, row);
  };
  const skus: DemandSku[] = [];
  for (const s of SPECS) {
    const id = sku(s.n);
    skus.push({
      skuId: id, name: `SKU ${s.n}`, vendorId: s.vendor ?? V1, productId: s.product === undefined ? null : s.product,
      grainKey: s.grain ?? s.product ?? id, inventoryOnly: s.inventoryOnly === true, productRetired: s.retired === true,
      cushionClass: s.cushion ?? null, parStep: s.step ?? 1, globalWeekdayPar: s.wd, globalWeekendPar: s.we,
      perOrderUnitOz: s.unitOz === undefined ? 80 : s.unitOz, hasPackChain: s.chain ?? true, writeHomeSkuId: s.grain ? sku(15) : id,
    });
  }
  // Lanes are keyed by SKU and already rolled to product grain: twins carry the same totals.
  window.forEach((day, idx) => {
    if (!day.salesObserved && !day.productionObserved) return;
    for (const s of SPECS) {
      if ((s.startOffset ?? 0) > idx) continue;
      const pick = (pair: [number, number] | null | undefined) => (pair == null ? 0 : pair[day.dayClass === "weekend" ? 1 : 0]);
      const noise = 0.9 + rand() * 0.2;
      const rise = s.rise != null && idx >= 17 ? 1 + s.rise : 1;
      const spike = s.spikeEvery != null && idx % s.spikeEvery === 0 ? 2.2 : 1;
      const id = sku(s.n);
      if (day.salesObserved) {
        put(direct, day.dateEt, id, pick(s.direct) * noise * rise * spike * scale);
        put(flattened, day.dateEt, id, pick(s.flattened) * noise * scale);
      }
      if (day.productionObserved) put(production, day.dateEt, id, pick(s.production) * noise * scale);
    }
  });
  const laneStartByGrain = new Map<string, string | null>();
  for (const s of skus) {
    let start: string | null = null;
    for (const d of window) {
      if ((direct.get(d.dateEt)?.get(s.skuId) ?? 0) > 0 || (production.get(d.dateEt)?.get(s.skuId) ?? 0) > 0 || (flattened.get(d.dateEt)?.get(s.skuId) ?? 0) > 0) { start = d.dateEt; break; }
    }
    if (!laneStartByGrain.has(s.grainKey) || laneStartByGrain.get(s.grainKey) == null) laneStartByGrain.set(s.grainKey, start);
  }
  const overlay = (p: Partial<ParOverlayRow>): ParOverlayRow => ({ weekdayPar: null, weekendPar: null, activeOverride: null, pinnedWeekdayAt: null, pinnedWeekendAt: null, ...p });
  const overlayBySku = new Map<string, ParOverlayRow>([
    [sku(1), overlay({ weekdayPar: 7 })],
    [sku(10), overlay({ pinnedWeekdayAt: "2026-10-10T12:00:00.000Z", pinnedWeekendAt: "2026-10-10T12:00:00.000Z" })],
    [sku(18), overlay({ autoWeekendPar: 10, autoWeekendBaselinePar: 9, autoWeekendPackEpoch: 2, effectivePackEpoch: 2 })],
  ]);
  const rhythm = (vendorId: string, orderDow: number, leadDays: number) => ({ vendorId, locationId: FIX_LOC, orderDow, leadDays });
  return {
    locationId: FIX_LOC, runDateEt, window, skus, overlayBySku,
    directOzByDate: direct, productionOzByDate: production, flattenedOzByDate: flattened, laneStartByGrain,
    suspectDays: new Set([addDaysEt(runDateEt, -9)]), signalsStartAt: addDaysEt(runDateEt, -20),
    rhythmByVendor: new Map([[V1, [rhythm(V1, 1, 1), rhythm(V1, 4, 1)]], [V2, [rhythm(V2, 2, 2), rhythm(V2, 5, 3)]]]),
    skipsByVendor: new Map([[V1, [{ vendorId: V1, skipFrom: addDaysEt(runDateEt, 4), skipThrough: addDaysEt(runDateEt, 4) }]]]),
    cutoffsByVendor: new Map([
      [V1, [{ locationId: null, orderDay: 1, cutoffTime: "14:00" }, { locationId: FIX_LOC, orderDay: 4, cutoffTime: "10:00:00" }]],
      [V2, [{ locationId: null, orderDay: 2, cutoffTime: "12:00" }, { locationId: null, orderDay: 5, cutoffTime: "12:00" }]],
    ]),
    priorBySlot: new Map([
      [`${sku(19)}:weekday`, { suggestedPar: 9, generationId: "g-prior-19", direction: 1 }],
      [`${sku(19)}:weekend`, { suggestedPar: 9, generationId: "g-prior-19w", direction: 1 }],
      [`${sku(11)}:weekday`, { suggestedPar: 7, generationId: "g-prior-11", direction: -1 }],
      [`${sku(11)}:weekend`, { suggestedPar: 7, generationId: "g-prior-11w", direction: -1 }],
      [`${sku(10)}:weekday`, { suggestedPar: 7, generationId: "g-prior-10", direction: -1 }],
      [`${sku(1)}:weekend`, { suggestedPar: 9, generationId: "g-prior-1", direction: 1 }],
    ]),
    budgetSpentBySlot: new Set([`${sku(11)}:weekday`, `${sku(11)}:weekend`]),
    recipeEditedAt: null, noLocalHistory: false,
    packEpochBySku: new Map([[sku(18), 2], [sku(1), 1]]),
  };
}

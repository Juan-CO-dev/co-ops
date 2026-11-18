/**
 * Demand signals (item 4 PR 1): THE POINT-IN-TIME REPLAY HARNESS for the three baselines.
 * No I/O (node:crypto only, for the content hash). The server pass (ledger.ts) stores what this builds;
 * the report script and the tests replay it.
 *
 * ── THE BASELINE IS WHAT THE SHOP USES TODAY, RUN BY THE SHOP'S OWN CODE ────────────────────
 *   pars    `computeParLedger` (lib/dynamic-pars-engine-shared.ts): the Dynamic Pars v1 shadow engine end
 *           to end, with the #579 gap rule and the #580 like-for-like peak floor, rounding and the guards.
 *   labor   `forecastDay` + `dayTypeFor` (lib/scheduling/demand-shared.ts), with the scheduler's own
 *           weekend class.
 *   prep    `pickOverride` + `resolveItemPar` (lib/items.ts): the manual override for the day, else the
 *           default par. Prep has no engine: it gets a baseline score only.
 * Both arms run the same code. The candidate differs ONLY by the signal term, and with no signal it is
 * byte-identical to the baseline (tests/demand-signals-replay.test.ts).
 *
 * ── A NIGHT IS STORED WHOLE (Astra r2 P2 #1) ────────────────────────────────────────────────
 * A forecast and a fingerprint cannot be replayed: a hash does not give an input back. So every input the
 * engine reads at its boundary is stored, as content-addressed parts under a manifest:
 *   pars    par_catalog  the SKUs with their resolved pack (ounces per order unit, has-chain), cushion
 *                        class, par step and global pars; the per-shop overlay (human lane, machine lane,
 *                        pins, activation); the vendor rhythms, cutoffs and skips; the pack epochs
 *           par_guard    the guard state: the hysteresis priors, the spent budgets, the recipe-edit
 *                        date, the signals start, the lane starts, the cold-start flag
 *           par_day x21  one part per window day: the three ounce lanes per SKU, the two observation
 *                        oracles, the catering-suspect flag
 *   labor   labor_inputs the 28-day baseline as the RPC returned it, the day-type thresholds and weekend
 *                        days, the structure version id, the manager's day-type overrides
 *   prep    prep_inputs  every item's default par, unit and active flag, and its shop par rows
 * GRAPH DEPENDENCIES are stored by their EFFECT: recipes, packs and item bases decide the ounce lanes and
 * the ounces per order unit, and those resolved values are in the parts. The upstream derivation (orders ->
 * ounces) is NOT re-run by a replay; what it produced as of the decision is what is kept.
 * A part is named by the sha256 of its canonical text, so an unchanged day is stored once across nights and
 * a changed one (an order corrected later) is a NEW part that the earlier manifest does not name.
 * RETENTION: parts and manifests are never deleted by this PR (0341 has no delete path). The plan's
 * 25-month retention needs its own reviewed sweep, which must keep every part a ledger row still names.
 *
 * ── REPLAY VERDICTS ─────────────────────────────────────────────────────────────────────────
 *   reproduced      the manifest resolves and the engine returns the recorded forecast
 *   engine_changed  the manifest resolves, but the row was recorded by another engine version: the
 *                   recorded forecast stands (it was made at the decision) and its inputs are intact
 *   diverged        same engine, other answer: the stored inputs do not explain the stored forecast
 *   unresolved      a part is missing or does not hash to its name
 * Only the first two support E2 (`evidenceOfReplay`).
 */
import { computeParLedger, type DemandInputs, type DemandSku, type ParLedgerRow, type ParOverlayRow } from "@/lib/dynamic-pars-engine-shared";
import { dayClassForDate, type DayClass } from "@/lib/dynamic-pars-shared";
import type { LedgerPrior } from "@/lib/dynamic-pars-run-shared";
import { operationalDayOfWeek, pickOverride, resolveItemPar, type ItemParRow } from "@/lib/items";
import { baselineHourly, type HeatCell } from "@/lib/pulse/baseline-shared";
import { dayTypeFor, forecastDay, type DayForecast, type DayTypeOverride, type SalesBaselineResult } from "@/lib/scheduling/demand-shared";
import type { CrewType, ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { isoDowOf } from "@/lib/scheduling/time-shared";
import { addDaysEt, type CutoffRow, type RhythmRow, type RhythmSkip } from "@/lib/vendor-rhythm-shared";
import { mapToObject, objectToMap } from "./canonical-shared";
import { composeSignals } from "./candidates-shared";
import { classifyEvidence, type EvidenceClass } from "./evidence-shared";
import { addressOf, sha256Hex } from "./hash";
import type { PairedRow } from "./scoring-shared";

/** The engine a forecast was made by. Bump a value when that baseline's computation changes. */
export const REPLAY_ENGINES = Object.freeze({
  pars: "pars-v1-shadow+likeforlike-floor",
  labor: "labor-trailing-same-weekday-v1",
  prep: "prep-static-par-v1",
});
export type ReplaySurface = keyof typeof REPLAY_ENGINES;

export const BLOB_KINDS = ["manifest", "par_catalog", "par_guard", "par_day", "labor_inputs", "prep_inputs", "forecast", "target", "model"] as const;
export type BlobKind = (typeof BLOB_KINDS)[number];
export interface Blob { kind: BlobKind; hash: string; text: string }
/** How a replay reads a stored part. undefined = we do not hold it. */
export type BlobSource = (hash: string) => string | undefined;

export function blobOf(kind: BlobKind, value: unknown): Blob {
  return { kind, ...addressOf(value) };
}
function read<T>(hash: string, get: BlobSource): T {
  const text = get(hash);
  if (text === undefined) throw new Error(`snapshot_part_missing:${hash}`);
  if (sha256Hex(text) !== hash) throw new Error(`snapshot_hash_mismatch:${hash}`);
  return JSON.parse(text) as T;
}

/** Whole days from the decision date to the valid date (0 = the decision's own day). */
export function leadDaysOf(decisionDate: string, validDate: string): number {
  return Math.round((Date.parse(`${validDate}T00:00:00Z`) - Date.parse(`${decisionDate}T00:00:00Z`)) / 86_400_000);
}

/** The candidate arm: which signals speak for a date, and which episode that is. */
export interface CandidateSpec {
  signalsFor: (validDate: string) => ReadonlyArray<number>;
  episodeFor: (validDate: string) => string | null;
}
/** The baseline arm: no signal, ever. */
export const NO_SIGNAL: CandidateSpec = Object.freeze({ signalsFor: () => [], episodeFor: () => null });

/** A frozen target for a date, "not_covered" (excluded and counted), or undefined (not frozen yet: no row). */
export type TargetLookup<T> = (validDate: string) => T | "not_covered" | undefined;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PARS
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface ParCatalogPart {
  v: 1; locationId: string; skus: DemandSku[]; overlay: Record<string, ParOverlayRow>;
  rhythm: Record<string, RhythmRow[]>; skips: Record<string, RhythmSkip[]>; cutoffs: Record<string, CutoffRow[]>;
  packEpoch: Record<string, number> | null;
}
interface ParGuardPart {
  v: 1; locationId: string; runDateEt: string; prior: Record<string, LedgerPrior>; budgetSpent: string[];
  recipeEditedAt: string | null; signalsStartAt: string | null; noLocalHistory: boolean; laneStart: Record<string, string | null>;
}
interface ParDayPart {
  v: 1; locationId: string; dateEt: string; dayClass: DayClass; salesObserved: boolean; productionObserved: boolean; suspect: boolean;
  direct: Record<string, number>; production: Record<string, number>; flattened: Record<string, number>;
}
interface ParManifest { v: 1; surface: "pars"; locationId: string; runDateEt: string; catalog: string; guard: string; days: Array<{ dateEt: string; hash: string }> }

const same = <T>(v: T): T => v;
const lane = (m: ReadonlyMap<string, ReadonlyMap<string, number>>, date: string): Record<string, number> => {
  const row = m.get(date);
  return row ? mapToObject(row as ReadonlyMap<string, number>, same) : {};
};

/** One night's engine inputs as content-addressed parts under a manifest. */
export function snapshotParInputs(inputs: DemandInputs): { manifest: Blob; parts: Blob[] } {
  const catalog = blobOf("par_catalog", {
    v: 1, locationId: inputs.locationId, skus: inputs.skus, overlay: mapToObject(inputs.overlayBySku, same),
    rhythm: mapToObject(inputs.rhythmByVendor, same), skips: mapToObject(inputs.skipsByVendor, same), cutoffs: mapToObject(inputs.cutoffsByVendor, same),
    packEpoch: inputs.packEpochBySku ? mapToObject(inputs.packEpochBySku as ReadonlyMap<string, number>, same) : null,
  } satisfies ParCatalogPart);
  const guard = blobOf("par_guard", {
    v: 1, locationId: inputs.locationId, runDateEt: inputs.runDateEt, prior: mapToObject(inputs.priorBySlot, same),
    budgetSpent: [...inputs.budgetSpentBySlot].sort(), recipeEditedAt: inputs.recipeEditedAt, signalsStartAt: inputs.signalsStartAt,
    noLocalHistory: inputs.noLocalHistory, laneStart: mapToObject(inputs.laneStartByGrain, same),
  } satisfies ParGuardPart);
  const days = inputs.window.map((d) => blobOf("par_day", {
    v: 1, locationId: inputs.locationId, dateEt: d.dateEt, dayClass: d.dayClass, salesObserved: d.salesObserved, productionObserved: d.productionObserved,
    suspect: inputs.suspectDays.has(d.dateEt), direct: lane(inputs.directOzByDate, d.dateEt), production: lane(inputs.productionOzByDate, d.dateEt),
    flattened: lane(inputs.flattenedOzByDate, d.dateEt),
  } satisfies ParDayPart));
  const manifest = blobOf("manifest", {
    v: 1, surface: "pars", locationId: inputs.locationId, runDateEt: inputs.runDateEt, catalog: catalog.hash, guard: guard.hash,
    days: inputs.window.map((d, i) => ({ dateEt: d.dateEt, hash: days[i]!.hash })),
  } satisfies ParManifest);
  const seen = new Set<string>();
  return { manifest, parts: [catalog, guard, ...days].filter((b) => !seen.has(b.hash) && seen.add(b.hash)) };
}

/** The engine inputs a manifest names, read back from the store. Throws `snapshot_part_missing` / `snapshot_hash_mismatch`. */
export function restoreParInputs(manifestHash: string, get: BlobSource): DemandInputs {
  const m = read<ParManifest>(manifestHash, get);
  if (m.surface !== "pars") throw new Error("snapshot_wrong_surface");
  const c = read<ParCatalogPart>(m.catalog, get), g = read<ParGuardPart>(m.guard, get);
  const direct = new Map<string, Map<string, number>>(), production = new Map<string, Map<string, number>>(), flattened = new Map<string, Map<string, number>>();
  const suspectDays = new Set<string>();
  const window = m.days.map(({ hash }) => {
    const d = read<ParDayPart>(hash, get);
    const put = (into: Map<string, Map<string, number>>, row: Record<string, number>) => { if (Object.keys(row).length > 0) into.set(d.dateEt, objectToMap(row, same)); };
    put(direct, d.direct); put(production, d.production); put(flattened, d.flattened);
    if (d.suspect) suspectDays.add(d.dateEt);
    return { dateEt: d.dateEt, dayClass: d.dayClass, salesObserved: d.salesObserved, productionObserved: d.productionObserved };
  });
  return {
    locationId: m.locationId, runDateEt: m.runDateEt, window, skus: c.skus, overlayBySku: objectToMap(c.overlay, same),
    directOzByDate: direct, productionOzByDate: production, flattenedOzByDate: flattened, laneStartByGrain: objectToMap(g.laneStart, same),
    suspectDays, signalsStartAt: g.signalsStartAt, rhythmByVendor: objectToMap(c.rhythm, same), skipsByVendor: objectToMap(c.skips, same),
    cutoffsByVendor: objectToMap(c.cutoffs, same), priorBySlot: objectToMap(g.prior, same), budgetSpentBySlot: new Set(g.budgetSpent),
    recipeEditedAt: g.recipeEditedAt, noLocalHistory: g.noLocalHistory,
    ...(c.packEpoch ? { packEpochBySku: objectToMap(c.packEpoch, same) } : {}),
  };
}

/** Pars are forecast for the decision's own day and the six after it. */
export const PAR_LEADS: ReadonlyArray<number> = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

export interface ParGrainTerms {
  /** The SKU whose row speaks for this product (the designated primary when it speaks, else the lowest id). */
  skuId: string;
  velocityRatio: number;
  baseOzPerDay: Record<DayClass, number | null>;
  /** Did the engine get as far as a par target for this day-class? Only then is its demand a forecast. */
  speaks: Record<DayClass, boolean>;
}
export interface ParCoverageUnit {
  skuId: string; grainKey: string; dayClass: DayClass; walkDate: string; coverThroughDate: string; coveredDays: string[];
  baseOzPerDay: Record<DayClass, number | null>; velocityRatio: number; cushionPct: number; peakFloorOz: number | null;
  /** The engine's own numbers (detail.demand_oz / detail.covered_oz). */
  demandOz: number; coveredOz: number;
}
export interface ParForecast {
  v: 1; surface: "pars"; engine: string; locationId: string; runDateEt: string; decisionDate: string;
  /** The whole engine output, by hash: a replay proves all of it without storing it twice (the rows are in par_auto_moves). */
  rowsHash: string; rowCount: number;
  terms: Record<string, ParGrainTerms>;
  coverage: ParCoverageUnit[];
  /** Rows the engine did not speak for, by reason. Counted, never scored. */
  silent: Record<string, number>;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The pars baseline forecast of one night: the engine's rows, reduced to what a score needs. */
export function forecastPars(inputs: DemandInputs, decisionDate: string): ParForecast {
  const rows = computeParLedger(inputs, "shadow");
  const bySlot = new Map<string, ParLedgerRow>();
  for (const r of rows) bySlot.set(`${r.sku_id}:${r.day_class}`, r);
  const rate = (skuId: string): Record<DayClass, number | null> => ({
    weekday: bySlot.get(`${skuId}:weekday`)?.base_rate_oz_per_day ?? null, weekend: bySlot.get(`${skuId}:weekend`)?.base_rate_oz_per_day ?? null });
  const speaks = (skuId: string): Record<DayClass, boolean> => ({
    weekday: bySlot.get(`${skuId}:weekday`)?.target_par != null, weekend: bySlot.get(`${skuId}:weekend`)?.target_par != null });

  const terms: Record<string, ParGrainTerms> = {};
  const byGrain = new Map<string, DemandSku[]>();
  for (const s of inputs.skus) (byGrain.get(s.grainKey) ?? byGrain.set(s.grainKey, []).get(s.grainKey)!).push(s);
  for (const grainKey of [...byGrain.keys()].sort()) {
    const members = byGrain.get(grainKey)!.slice().sort((a, b) =>
      Number(b.skuId === b.writeHomeSkuId) - Number(a.skuId === a.writeHomeSkuId) || (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0));
    const rep = members.find((s) => { const sp = speaks(s.skuId); return sp.weekday || sp.weekend; });
    if (!rep) continue;
    terms[grainKey] = { skuId: rep.skuId, velocityRatio: bySlot.get(`${rep.skuId}:weekday`)?.velocity_ratio ?? 1, baseOzPerDay: rate(rep.skuId), speaks: speaks(rep.skuId) };
  }

  const coverage: ParCoverageUnit[] = [];
  const silent: Record<string, number> = {};
  const grainOf = new Map(inputs.skus.map((s) => [s.skuId, s.grainKey]));
  for (const r of rows) {
    const detail = r.detail as { optimisation_walk_date?: string; demand_oz?: number; covered_oz?: number };
    if (r.target_par == null || r.cover_through_date == null || detail.optimisation_walk_date == null || r.cushion_pct == null
      || detail.demand_oz == null || detail.covered_oz == null) { silent[r.reason_code] = (silent[r.reason_code] ?? 0) + 1; continue; }
    const coveredDays: string[] = [];
    for (let d = addDaysEt(detail.optimisation_walk_date, 1); d < r.cover_through_date; d = addDaysEt(d, 1)) coveredDays.push(d);
    coverage.push({
      skuId: r.sku_id, grainKey: grainOf.get(r.sku_id) ?? r.sku_id, dayClass: r.day_class, walkDate: detail.optimisation_walk_date,
      coverThroughDate: r.cover_through_date, coveredDays, baseOzPerDay: rate(r.sku_id), velocityRatio: r.velocity_ratio ?? 1,
      cushionPct: r.cushion_pct, peakFloorOz: r.peak_floor_oz, demandOz: detail.demand_oz, coveredOz: detail.covered_oz,
    });
  }
  return {
    v: 1, surface: "pars", engine: REPLAY_ENGINES.pars, locationId: inputs.locationId, runDateEt: inputs.runDateEt, decisionDate,
    rowsHash: addressOf(rows).hash, rowCount: rows.length, terms, coverage, silent,
  };
}

/**
 * The daily demand forecast, in ounces per product, for one valid date: rate(day-class) x velocity x signal.
 * Only products the engine speaks for on that day-class. With no signal the multiplier is the literal 1.
 */
export function parDailyForecast(f: ParForecast, validDate: string, signals: ReadonlyArray<number>): Record<string, number> {
  const dc = dayClassForDate(validDate);
  const out: Record<string, number> = {};
  for (const grainKey of Object.keys(f.terms).sort()) {
    const t = f.terms[grainKey]!;
    const base = t.baseOzPerDay[dc];
    if (!t.speaks[dc] || base == null) continue;
    out[grainKey] = round6(base * t.velocityRatio * composeSignals(signals, t.velocityRatio));
  }
  return out;
}

/**
 * The covered ounces of one par slot under a candidate, in the engine's own order (plan r2 §5):
 * sum over covered days of rate x velocity x signal, then the cushion, then max(…, peak floor).
 * With no signal this is `computeCoverage`'s arithmetic to the bit, and the tests hold it to the engine's number.
 */
export function parCoverageOz(unit: ParCoverageUnit, signalsFor: (validDate: string) => ReadonlyArray<number>): number {
  let demandOz = 0;
  for (const dateEt of unit.coveredDays) {
    const base = unit.baseOzPerDay[dayClassForDate(dateEt)];
    if (base == null) return unit.coveredOz;
    demandOz += base * unit.velocityRatio * composeSignals(signalsFor(dateEt), unit.velocityRatio);
  }
  demandOz = round6(demandOz);
  const withCushion = round6(demandOz * (1 + unit.cushionPct));
  return unit.peakFloorOz != null && unit.peakFloorOz > withCushion ? unit.peakFloorOz : withCushion;
}

export interface ParTarget { v: 1; target: "par_product_day_oz"; locationId: string; validDate: string; oz: Record<string, number> }

/**
 * The realized ounces of one day, per product, as the engine's own loader reads them (direct + production,
 * never flattened). null = the date is outside these inputs' window. A day neither oracle saw is
 * `not_covered`: excluded and counted, never zero. On a covered day a product that is absent did not move:
 * that is a true zero, and the scorer reads it as one.
 */
export function parTargetFromInputs(inputs: DemandInputs, validDate: string): { coverage: "covered" | "not_covered"; payload: ParTarget | null } | null {
  const day = inputs.window.find((d) => d.dateEt === validDate);
  if (!day) return null;
  if (!day.salesObserved && !day.productionObserved) return { coverage: "not_covered", payload: null };
  const oz: Record<string, number> = {};
  for (const s of inputs.skus) {
    if (oz[s.grainKey] !== undefined) continue;
    const v = round6((inputs.directOzByDate.get(validDate)?.get(s.skuId) ?? 0) + (inputs.productionOzByDate.get(validDate)?.get(s.skuId) ?? 0));
    if (v > 0) oz[s.grainKey] = v;
  }
  return { coverage: "covered", payload: { v: 1, target: "par_product_day_oz", locationId: inputs.locationId, validDate, oz } };
}

/** Both arms of the product-day ounce score, for every lead whose target is frozen. */
export function parScoreRows(shopId: string, f: ParForecast, targets: TargetLookup<ParTarget>, candidate: CandidateSpec): PairedRow[] {
  const out: PairedRow[] = [];
  for (const leadDays of PAR_LEADS) {
    const validDate = addDaysEt(f.decisionDate, leadDays);
    const t = targets(validDate);
    if (t === undefined) continue;
    const signals = candidate.signalsFor(validDate);
    const base = parDailyForecast(f, validDate, []), cand = parDailyForecast(f, validDate, signals);
    const episodeId = composeSignals(signals, 1) !== 1 ? candidate.episodeFor(validDate) : null;
    for (const unitKey of Object.keys(base)) {
      out.push({ shopId, target: "par_product_day_oz", leadDays, validDate, unitKey, baseline: base[unitKey]!, candidate: cand[unitKey] ?? null,
        actual: t === "not_covered" ? null : t.oz[unitKey] ?? 0, episodeId });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LABOR
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface LaborInputs {
  v: 1; locationId: string;
  /** The build day: the forecast reads the 28 days before it. It is also the decision date. */
  asOf: string;
  baseline: SalesBaselineResult;
  dayTypes: ScheduleStructure["dayTypes"];
  structureId: string;
  overrides: Array<{ id: string; date: string; dayType: DayTypeOverride }>;
}
/** The draft schedules 5 to 11 days out; edits happen inside the week. */
export const LABOR_LEADS: ReadonlyArray<number> = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

export interface LaborDay {
  date: string; leadDays: number; kind: "ok" | "no_history" | "unavailable";
  hourlyCents: number[] | null; dayCents: number | null; weeks: number | null;
  dayType: CrewType; dayTypeSource: "override" | "weekend" | "forecast" | "no_history";
}
export interface LaborForecast { v: 1; surface: "labor"; engine: string; locationId: string; decisionDate: string; days: LaborDay[] }

export function snapshotLaborInputs(inputs: LaborInputs): Blob {
  return blobOf("labor_inputs", { ...inputs, overrides: inputs.overrides.slice().sort((a, b) => (a.date + a.id < b.date + b.id ? -1 : 1)) });
}
export function restoreLaborInputs(hash: string, get: BlobSource): LaborInputs {
  return read<LaborInputs>(hash, get);
}

/** The labor forecast of one build day. The candidate multiplies the hourly dollars; the manager's override still wins the day type. */
export function forecastLabor(inputs: LaborInputs, candidate: CandidateSpec): LaborForecast {
  const days: LaborDay[] = LABOR_LEADS.map((leadDays) => {
    const date = addDaysEt(inputs.asOf, leadDays);
    const override = inputs.overrides.filter((o) => o.date === date).at(-1) ?? null;
    const base = forecastDay(inputs.baseline, date, inputs.asOf);
    let forecast: DayForecast | { kind: "unavailable"; cause: "timeout" | "rpc_missing" | "rpc_error" } = base;
    const m = composeSignals(candidate.signalsFor(date), 1);
    if (base.kind === "ok" && m !== 1) {
      const hourlyCents = base.hourlyCents.map((c) => Math.round(c * m));
      forecast = { ...base, hourlyCents, dayCents: hourlyCents.reduce((a, b) => a + b, 0) };
    }
    const type = dayTypeFor(date, { override, structure: { dayTypes: inputs.dayTypes }, forecast });
    return {
      date, leadDays, kind: forecast.kind, hourlyCents: forecast.kind === "ok" ? forecast.hourlyCents : null,
      dayCents: forecast.kind === "ok" ? forecast.dayCents : null, weeks: forecast.kind === "ok" ? forecast.weeks : null,
      dayType: type.dayType, dayTypeSource: type.source,
    };
  });
  return { v: 1, surface: "labor", engine: REPLAY_ENGINES.labor, locationId: inputs.locationId, decisionDate: inputs.asOf, days };
}

export interface LaborTarget { v: 1; target: "labor_sales_day"; locationId: string; validDate: string; hourlyCents: number[]; dayCents: number; unknownCents: number }

/**
 * One realized day from the SAME read the forecast uses (`pulse_sales_baseline` for that single date): the
 * check totals by opened hour. Not in `capturedDays` = `not_covered`. A captured day with no sales is a true zero.
 */
export function laborTargetFromDay(locationId: string, validDate: string, heat: ReadonlyArray<HeatCell>, capturedDays: ReadonlyArray<string>): { coverage: "covered" | "not_covered"; payload: LaborTarget | null } {
  if (!capturedDays.includes(validDate)) return { coverage: "not_covered", payload: null };
  const dow = isoDowOf(validDate);
  const hourlyCents = baselineHourly(heat, dow, 1) ?? new Array<number>(24).fill(0);
  const unknownCents = heat.filter((c) => c.dow === dow && !(Number.isInteger(c.hour) && c.hour >= 0 && c.hour <= 23)).reduce((n, c) => n + c.cents, 0);
  return { coverage: "covered", payload: { v: 1, target: "labor_sales_day", locationId, validDate, hourlyCents, dayCents: hourlyCents.reduce((a, b) => a + b, 0), unknownCents } };
}

/** The class a day turned out to be, by the same thresholds the forecast is judged with. A weekend day is "weekend". */
export function realizedDayType(date: string, dayTypes: ScheduleStructure["dayTypes"], actualDayCents: number): CrewType {
  const asForecast: DayForecast = { kind: "ok", date, hourlyCents: [], dayCents: actualDayCents, weeks: 1, basis: "trailing_same_weekday", weeksAhead: 0, confidence: "normal", unknownCents: 0, catering: [] };
  return dayTypeFor(date, { override: null, structure: { dayTypes }, forecast: asForecast }).dayType;
}

export interface ClassCall { leadDays: number; validDate: string; forecast: CrewType | null; candidate: CrewType | null; actual: CrewType | null }

/** Day dollars, service-hour dollars and the slow / normal / busy call, both arms, for every lead whose target is frozen. */
export function laborScoreRows(shopId: string, baseline: LaborForecast, inputs: LaborInputs, targets: TargetLookup<LaborTarget>, candidate: CandidateSpec): { day: PairedRow[]; hour: PairedRow[]; classCalls: ClassCall[] } {
  const cand = forecastLabor(inputs, candidate);
  const day: PairedRow[] = [], hour: PairedRow[] = [], classCalls: ClassCall[] = [];
  baseline.days.forEach((b, i) => {
    const t = targets(b.date);
    if (t === undefined) return;
    const c = cand.days[i]!;
    const covered = t === "not_covered" ? null : t;
    const episodeId = composeSignals(candidate.signalsFor(b.date), 1) !== 1 ? candidate.episodeFor(b.date) : null;
    const common = { shopId, leadDays: b.leadDays, validDate: b.date, episodeId };
    day.push({ ...common, target: "labor_day_cents", unitKey: "", baseline: b.dayCents, candidate: c.dayCents, actual: covered ? covered.dayCents : null });
    for (let h = 0; h < 24; h += 1) {
      hour.push({ ...common, target: "labor_hour_cents", unitKey: String(h).padStart(2, "0"), baseline: b.hourlyCents?.[h] ?? null,
        candidate: c.hourlyCents?.[h] ?? null, actual: covered ? covered.hourlyCents[h] ?? 0 : null });
    }
    // The class call is the FORECAST's call: a day the manager overrode, or with no forecast, is not one.
    const called = (d: LaborDay): CrewType | null => (d.kind === "ok" && d.dayTypeSource !== "override" ? d.dayType : null);
    classCalls.push({ leadDays: b.leadDays, validDate: b.date, forecast: called(b), candidate: called(c), actual: covered ? realizedDayType(b.date, inputs.dayTypes, covered.dayCents) : null });
  });
  return { day, hour, classCalls };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PREP
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface PrepInputs {
  v: 1; locationId: string;
  items: Array<{ itemId: string; defaultPar: number | null; defaultParUnit: string | null; active: boolean; parRows: ItemParRow[] }>;
}
export const PREP_LEADS: ReadonlyArray<number> = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
export interface PrepForecast { v: 1; surface: "prep"; engine: string; locationId: string; decisionDate: string; days: Array<{ date: string; leadDays: number; par: Record<string, number> }> }

const parRowOrder = (a: ItemParRow, b: ItemParRow): number => (a.dayOfWeek ?? -1) - (b.dayOfWeek ?? -1);
export function snapshotPrepInputs(inputs: PrepInputs): Blob {
  return blobOf("prep_inputs", { ...inputs, items: inputs.items.slice().sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
    .map((i) => ({ ...i, parRows: i.parRows.slice().sort(parRowOrder) })) });
}
export function restorePrepInputs(hash: string, get: BlobSource): PrepInputs {
  return read<PrepInputs>(hash, get);
}

/** The prep baseline: each active item's par for each date, by the checklist's own rule. No engine, no candidate. */
export function forecastPrep(inputs: PrepInputs, decisionDate: string): PrepForecast {
  const items = inputs.items.slice().sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  const days = PREP_LEADS.map((leadDays) => {
    const date = addDaysEt(decisionDate, leadDays);
    const par: Record<string, number> = {};
    for (const item of items) {
      if (!item.active) continue;
      const value = resolveItemPar(item, pickOverride(item.parRows, operationalDayOfWeek(date)));
      if (value != null && Number.isFinite(Number(value))) par[item.itemId] = Number(value);
    }
    return { date, leadDays, par };
  });
  return { v: 1, surface: "prep", engine: REPLAY_ENGINES.prep, locationId: inputs.locationId, decisionDate, days };
}

/** A day's realized prep use per item, in the item's par unit. An item that is absent is UNKNOWN (never zero). */
export interface PrepTarget { v: 1; target: "prep_item_day_units"; locationId: string; validDate: string; units: Record<string, number> }

export function prepScoreRows(shopId: string, f: PrepForecast, targets: TargetLookup<PrepTarget>): PairedRow[] {
  const out: PairedRow[] = [];
  for (const d of f.days) {
    const t = targets(d.date);
    if (t === undefined) continue;
    for (const unitKey of Object.keys(d.par).sort()) {
      const par = d.par[unitKey]!;
      out.push({ shopId, target: "prep_item_day_units", leadDays: d.leadDays, validDate: d.date, unitKey, baseline: par, candidate: par,
        actual: t === "not_covered" ? null : t.units[unitKey] ?? null, episodeId: null });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REPLAY
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** What a forecast ledger row says about itself. */
export interface ForecastRef { surface: ReplaySurface; manifestHash: string; forecastHash: string; decisionDate: string; engine: string }
export type ReplayVerdict = "reproduced" | "engine_changed" | "diverged" | "unresolved";

/** Recompute a recorded BASELINE forecast from its stored inputs. */
export function replayForecast(ref: Pick<ForecastRef, "surface" | "manifestHash" | "decisionDate">, get: BlobSource): ParForecast | LaborForecast | PrepForecast {
  if (ref.surface === "pars") return forecastPars(restoreParInputs(ref.manifestHash, get), ref.decisionDate);
  if (ref.surface === "labor") return forecastLabor(restoreLaborInputs(ref.manifestHash, get), NO_SIGNAL);
  return forecastPrep(restorePrepInputs(ref.manifestHash, get), ref.decisionDate);
}

export function replayVerdict(ref: ForecastRef, get: BlobSource): ReplayVerdict {
  let recomputed: ReturnType<typeof replayForecast>;
  try { recomputed = replayForecast(ref, get); } catch (e) {
    if (e instanceof Error && /^snapshot_/.test(e.message)) return "unresolved";
    throw e;
  }
  if (ref.engine !== REPLAY_ENGINES[ref.surface]) return "engine_changed";
  return addressOf(recomputed).hash === ref.forecastHash ? "reproduced" : "diverged";
}

/** The evidence class a replay verdict supports. Inputs that do not resolve, or do not explain the forecast, are E1. */
export function evidenceOfReplay(verdict: ReplayVerdict, facts: { featureKnownAtDecision: boolean; targetFrozen: boolean }): EvidenceClass {
  return classifyEvidence({ ...facts, replayedFromStoredInputs: verdict === "reproduced" || verdict === "engine_changed" });
}

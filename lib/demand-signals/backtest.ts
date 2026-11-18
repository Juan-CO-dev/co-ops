/**
 * Demand signals (item 4 PR 1): THE RETROSPECTIVE BACKTEST. No I/O. Given each shop's history as the replay
 * harness reads it, it scores the three baselines and the two zero-feed candidates (trend, calendar holidays)
 * per target and per decision lead.
 *
 * EVERYTHING HERE IS E1. The history a script can load today is today's copy: orders are rebuilt from current
 * pointers, pars and settings are read as they are now. So every candidate is run through the pass rule with
 * `evidenceClass: "E1"` and no holdout, and every one of them fails by name (`evidence_not_e2`,
 * `holdout_missing`). The numbers may be shown; they can turn nothing on. E2 evidence only accrues from the
 * forecast ledger (0342), from the night it is switched on.
 *
 * WALK-FORWARD: a candidate at a decision reads only what was known before it.
 *   trend     the daily totals of the days strictly before the decision date;
 *   holiday   actual / baseline on EARLIER holidays whose target had already frozen (holiday + 4 <= decision).
 *
 * ONE POPULATION PER RATIO (review r5). Every actual a candidate learns from is read through a decision's own
 * `actualOn`: the realized total of exactly the units THAT decision's forecast speaks for. For pars that is the
 * products the engine forecast that night, by that night's product identity (`parForecastActualOz`), never every
 * SKU in the record: a SKU the engine does not speak for (no rhythm, no par) is in no forecast, so its usage is
 * in no numerator.
 *   holiday   each earlier holiday's ratio = that holiday decision's `actualOn` / that decision's own forecast;
 *   trend     recent and prior weeks are both the CURRENT decision's population, the one the multiplier is applied to.
 * There is no whole-record total in this file.
 */
import type { DemandInputs } from "@/lib/dynamic-pars-engine-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { HOLIDAY_MODEL, TREND_MODEL, holidayOn, holidaySignal, trendSignal, type SignalValue } from "./candidates-shared";
import type { EvidenceClass } from "./evidence-shared";
import { candidateModel, TARGET_FREEZE_LAG_DAYS } from "./ledger-shared";
import {
  NO_SIGNAL, forecastLabor, forecastPars, forecastPrep, laborScoreRows, leadDaysOf, parActualOz, parCoverageOz, parDailyForecast, parForecastActualOz, parIdentityOf, parScoreRows, prepScoreRows,
  type CandidateSpec, type ClassCall, type LaborInputs, type LaborTarget, type ParForecast, type ParIdentity, type ParTarget, type PrepInputs, type PrepTarget,
  type ReplaySurface, type TargetLookup,
} from "./replay";
import {
  classAccuracy, coverageSim, episodeIdsFor, qualify, scoreScope,
  type PairedRow, type Qualification, type ScopeResult, type ScoreScope,
} from "./scoring-shared";

export interface ShopHistory {
  shopId: string;
  shopName: string;
  /** One night's engine inputs per run date. The decision is the next morning. */
  parNights: DemandInputs[];
  parTargets: TargetLookup<ParTarget>;
  /** One build day each. */
  laborDays: LaborInputs[];
  laborTargets: TargetLookup<LaborTarget>;
  prepDays: Array<{ decisionDate: string; inputs: PrepInputs }>;
  prepTargets: TargetLookup<PrepTarget>;
}

export const CANDIDATE_KEYS = ["trend", "calendar_holiday"] as const;
export type CandidateKey = (typeof CANDIDATE_KEYS)[number];

export interface CoverageLine { shopId: string; arm: "baseline" | CandidateKey; units: number; skippedUnits: number; actualOz: number; shortfallOz: number; overCoverOz: number }
export interface SignalTrace { surface: ReplaySurface; shopId: string; candidate: CandidateKey; decisionDate: string; validDate: string; multiplier: number; active: boolean; eventKey: string }
export interface ReplayReport {
  v: 1;
  evidenceClass: EvidenceClass;
  from: string;
  to: string;
  shops: Array<{ id: string; name: string }>;
  baselines: Array<{ surface: ReplaySurface; scope: ScoreScope; result: ScopeResult }>;
  classCalls: Array<{ leadDays: number; n: number; correct: number; value: number | null; excluded: number }>;
  candidates: Array<{ surface: ReplaySurface; candidate: CandidateKey; modelHash: string; scope: ScoreScope; result: ScopeResult; qualification: Qualification }>;
  coverage: CoverageLine[];
  silentPars: Record<string, number>;
  counts: { parNights: number; laborDays: number; prepDays: number };
  /** Every signal that had an event to speak about, for inspection. */
  debug: { laborSignals: SignalTrace[]; parSignals: SignalTrace[] };
}

/** One decision of one shop on one surface, in the shape the candidates need. */
interface Decision {
  shopId: string;
  decisionDate: string;
  validDates: string[];
  /** The baseline's total for the decision's own day (lead 0), for the holiday ratio. */
  baselineTotal0: number | null;
  /**
   * What was realized on `date` by exactly the units THIS decision's forecast speaks for on that date: the same
   * population as its forecast total. null = the date is not covered (or not frozen): missing, never zero.
   */
  actualOn: (date: string) => number | null;
  rows: (candidate: CandidateSpec) => PairedRow[];
}
interface SurfaceRun { surface: ReplaySurface; decisions: Decision[] }

/** The trend's days for one decision, in that decision's own population. */
function trendSeries(d: Decision): Array<{ date: string; value: number }> {
  const series: Array<{ date: string; value: number }> = [];
  for (let i = TREND_MODEL.recentDays + TREND_MODEL.priorDays; i >= 1; i -= 1) {
    const date = addDaysEt(d.decisionDate, -i);
    const v = d.actualOn(date);
    if (v !== null) series.push({ date, value: v });
  }
  return series;
}

function signalAt(key: CandidateKey, d: Decision, validDate: string, series: ReadonlyArray<{ date: string; value: number }>, holidayDecisions: ReadonlyArray<Decision>): SignalValue {
  if (key === "trend") return trendSignal(series, d.decisionDate, TREND_MODEL);
  if (holidayOn(validDate) === null) return { multiplier: 1, active: false, eventKey: null };
  const ratios: number[] = [];
  for (const h of holidayDecisions) {
    const forecast = h.baselineTotal0;
    if (addDaysEt(h.decisionDate, TARGET_FREEZE_LAG_DAYS) > d.decisionDate || forecast === null || !(forecast > 0)) continue;
    // Numerator and denominator are the SAME decision's: the products that forecast spoke for, and no other.
    const actual = h.actualOn(h.decisionDate);
    if (actual !== null) ratios.push(actual / forecast);
  }
  return holidaySignal(validDate, ratios, HOLIDAY_MODEL);
}

/** Both arms of one candidate over one surface: rows by scope, and the trace of what the signal said. */
function runCandidate(run: SurfaceRun, key: CandidateKey): { rows: PairedRow[]; trace: SignalTrace[] } {
  const shopIds = [...new Set(run.decisions.map((d) => d.shopId))].sort();
  const signals = new Map<string, SignalValue>();
  const sigKey = (d: Decision, validDate: string) => `${d.shopId}|${d.decisionDate}|${validDate}`;
  for (const shopId of shopIds) {
    const mine = run.decisions.filter((d) => d.shopId === shopId);
    // One decision per holiday date (the last one given, as before), each carrying its own forecast and population.
    const byDate = new Map<string, Decision>();
    for (const d of mine) if (d.baselineTotal0 !== null && holidayOn(d.decisionDate) !== null) byDate.set(d.decisionDate, d);
    const holidayDecisions = [...byDate.keys()].sort().map((date) => byDate.get(date)!);
    for (const d of mine) {
      const series = key === "trend" ? trendSeries(d) : [];
      for (const validDate of d.validDates) signals.set(sigKey(d, validDate), signalAt(key, d, validDate, series, holidayDecisions));
    }
  }
  // Episodes are per decision lead (the scope) and carry no shop: one event is one episode everywhere.
  const activeByLead = new Map<number, Array<{ date: string; eventKey: string }>>();
  const trace: SignalTrace[] = [];
  for (const d of run.decisions) for (const validDate of d.validDates) {
    const s = signals.get(sigKey(d, validDate))!;
    if (s.eventKey === null) continue;
    trace.push({ surface: run.surface, shopId: d.shopId, candidate: key, decisionDate: d.decisionDate, validDate, multiplier: s.multiplier, active: s.active, eventKey: s.eventKey });
    if (!s.active) continue;
    const lead = leadDaysOf(d.decisionDate, validDate);
    (activeByLead.get(lead) ?? activeByLead.set(lead, []).get(lead)!).push({ date: validDate, eventKey: s.eventKey });
  }
  const episodes = new Map<number, Map<string, string>>();
  for (const [lead, active] of activeByLead) episodes.set(lead, episodeIdsFor(active));
  const rows: PairedRow[] = [];
  for (const d of run.decisions) {
    rows.push(...d.rows({
      signalsFor: (validDate) => { const s = signals.get(sigKey(d, validDate)); return s && s.active ? [s.multiplier] : []; },
      episodeFor: (validDate) => {
        const s = signals.get(sigKey(d, validDate));
        return s && s.active && s.eventKey !== null ? episodes.get(leadDaysOf(d.decisionDate, validDate))?.get(`${s.eventKey}|${validDate}`) ?? null : null;
      },
    }));
  }
  return { rows, trace };
}

function byScope(rows: ReadonlyArray<PairedRow>): Array<{ scope: ScoreScope; rows: PairedRow[] }> {
  const groups = new Map<string, { scope: ScoreScope; rows: PairedRow[] }>();
  for (const r of rows) {
    const key = `${r.target}|${String(r.leadDays).padStart(3, "0")}`;
    (groups.get(key) ?? groups.set(key, { scope: { target: r.target, leadDays: r.leadDays }, rows: [] }).get(key)!).rows.push(r);
  }
  return [...groups.keys()].sort().map((k) => groups.get(k)!);
}

const sum = (xs: Iterable<number>): number => { let n = 0; for (const x of xs) n += x; return n; };

export function runBacktest(shops: ReadonlyArray<ShopHistory>, range: { from: string; to: string }): ReplayReport {
  const evidenceClass: EvidenceClass = "E1";
  const total = <T>(lookup: TargetLookup<T>, date: string, of: (t: T) => number): number | null => {
    const t = lookup(date);
    return t === undefined || t === "not_covered" ? null : of(t);
  };

  // ── Labor ──
  const classCalls: ClassCall[] = [];
  const labor: SurfaceRun = {
    surface: "labor",
    decisions: shops.flatMap((s) => s.laborDays.map((inputs): Decision => {
      const base = forecastLabor(inputs, NO_SIGNAL);
      classCalls.push(...laborScoreRows(s.shopId, base, inputs, s.laborTargets, NO_SIGNAL).classCalls);
      return {
        shopId: s.shopId, decisionDate: inputs.asOf, validDates: base.days.map((d) => d.date), baselineTotal0: base.days[0]?.dayCents ?? null,
        // One population for every labor decision: the day's dollars in hours 0-23, as the forecast's `dayCents` is.
        actualOn: (date) => total(s.laborTargets, date, (t) => t.dayCents),
        rows: (candidate) => { const r = laborScoreRows(s.shopId, base, inputs, s.laborTargets, candidate); return [...r.day, ...r.hour]; },
      };
    })),
  };

  // ── Pars ──
  const silentPars: Record<string, number> = {};
  const parForecasts: Array<{ shopId: string; f: ParForecast; identity: ParIdentity }> = [];
  const pars: SurfaceRun = {
    surface: "pars",
    decisions: shops.flatMap((s) => s.parNights.map((inputs): Decision => {
      const decisionDate = addDaysEt(inputs.runDateEt, 1);
      const f = forecastPars(inputs, decisionDate);
      const identity = parIdentityOf(inputs); // the FORECAST night's product identity, never a later night's
      parForecasts.push({ shopId: s.shopId, f, identity });
      for (const [reason, n] of Object.entries(f.silent)) silentPars[reason] = (silentPars[reason] ?? 0) + n;
      return {
        shopId: s.shopId, decisionDate, validDates: [...new Set([...Array.from({ length: 7 }, (_, i) => addDaysEt(decisionDate, i)), ...f.coverage.flatMap((u) => u.coveredDays)])].sort(),
        baselineTotal0: sum(Object.values(parDailyForecast(f, decisionDate, []))),
        actualOn: (date) => total(s.parTargets, date, (t) => parForecastActualOz(f, identity, t)),
        rows: (candidate) => parScoreRows(s.shopId, f, identity, s.parTargets, candidate),
      };
    })),
  };

  // ── Prep: a baseline score only ──
  const prepRows = shops.flatMap((s) => s.prepDays.flatMap((d) => prepScoreRows(s.shopId, forecastPrep(d.inputs, d.decisionDate), s.prepTargets)));

  const baselines: ReplayReport["baselines"] = [];
  const candidates: ReplayReport["candidates"] = [];
  const debug: ReplayReport["debug"] = { laborSignals: [], parSignals: [] };
  const coverage: CoverageLine[] = [];
  const signalByCandidate = new Map<CandidateKey, Map<string, ReadonlyArray<number>>>();

  for (const run of [labor, pars]) {
    const baseRows = run.decisions.flatMap((d) => d.rows(NO_SIGNAL));
    for (const g of byScope(baseRows)) baselines.push({ surface: run.surface, scope: g.scope, result: scoreScope(g.rows, g.scope) });
    for (const key of CANDIDATE_KEYS) {
      const { rows, trace } = runCandidate(run, key);
      (run.surface === "labor" ? debug.laborSignals : debug.parSignals).push(...trace);
      if (run.surface === "pars") signalByCandidate.set(key, new Map(trace.filter((t) => t.active).map((t) => [`${t.shopId}|${t.decisionDate}|${t.validDate}`, [t.multiplier]])));
      const modelHash = candidateModel(run.surface, key).blob.hash;
      for (const g of byScope(rows)) {
        const result = scoreScope(g.rows, g.scope);
        candidates.push({ surface: run.surface, candidate: key, modelHash, scope: g.scope, result,
          qualification: qualify({ scope: g.scope, modelHash, evidenceClass, dev: result, holdout: null, evidenceRunId: "retrospective", holdoutReadId: "none" }) });
      }
    }
  }
  for (const g of byScope(prepRows)) baselines.push({ surface: "prep", scope: g.scope, result: scoreScope(g.rows, g.scope) });

  // ── The par coverage simulation: what the covered ounces would have left short or over ──
  for (const s of shops) {
    for (const arm of ["baseline", ...CANDIDATE_KEYS] as const) {
      const line: CoverageLine = { shopId: s.shopId, arm, units: 0, skippedUnits: 0, actualOz: 0, shortfallOz: 0, overCoverOz: 0 };
      for (const { shopId, f, identity } of parForecasts) {
        if (shopId !== s.shopId) continue;
        for (const unit of f.coverage) {
          let actual: number | null = 0;
          for (const d of unit.coveredDays) {
            const t = s.parTargets(d);
            if (t === undefined || t === "not_covered") { actual = null; break; }
            actual += parActualOz(t, unit, identity);
          }
          if (actual === null) { line.skippedUnits += 1; continue; }
          const signals = arm === "baseline" ? undefined : signalByCandidate.get(arm);
          const covered = signals ? parCoverageOz(unit, (d) => signals.get(`${shopId}|${f.decisionDate}|${d}`) ?? []) : unit.coveredOz;
          const sim = coverageSim(covered, actual);
          line.units += 1; line.actualOz += actual; line.shortfallOz += sim.shortfallOz; line.overCoverOz += sim.overCoverOz;
        }
      }
      coverage.push(line);
    }
  }

  const calls: ReplayReport["classCalls"] = [];
  for (const lead of [...new Set(classCalls.map((c) => c.leadDays))].sort((a, b) => a - b)) {
    calls.push({ leadDays: lead, ...classAccuracy(classCalls.filter((c) => c.leadDays === lead).map((c) => ({ forecast: c.forecast, actual: c.actual }))) });
  }
  return {
    v: 1, evidenceClass, from: range.from, to: range.to, shops: shops.map((s) => ({ id: s.shopId, name: s.shopName })),
    baselines, classCalls: calls, candidates, coverage, silentPars,
    counts: { parNights: sum(shops.map((s) => s.parNights.length)), laborDays: sum(shops.map((s) => s.laborDays.length)), prepDays: sum(shops.map((s) => s.prepDays.length)) },
    debug,
  };
}

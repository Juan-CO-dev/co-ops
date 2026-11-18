/**
 * Demand signals (item 4 PR 1): THE NIGHTLY LEDGER PASS for one shop. Every read and every write is injected,
 * so this file has no database in it and is tested whole (tests/demand-signals-ledger-pass.test.ts). The real
 * reads and the heartbeat are in ledger.ts.
 *
 * What one pass does, for the decision made THIS morning (the database's ET date; 0342 refuses any other):
 *   1. registers the three baseline engines as models (idempotent);
 *   2. pars   stores last night's engine inputs whole and records the forecast for today and the six days after;
 *   3. labor  stores the baseline, the day-type rules and the overrides, and records today and eleven days after;
 *   4. prep   stores every item's par data and records today and the six days after;
 *   5. freezes the realized values of four days ago (pars from the night's own window, labor from one read).
 * It records the BASELINES only. A candidate's forecast is recorded from the PR that registers that candidate.
 *
 * Fail-soft and bounded: a step that fails is named by a fixed code and the others still run; a step starts
 * only while the deadline has not passed; writes go only through 0342's writers. Before 0342 the first call
 * finds no function and the pass returns `not_installed` having read nothing.
 *
 * PREP TARGETS ARE NOT FROZEN YET (stated, not hidden): there is no reviewed reading of how much of a prep item
 * a shop used in a day. The prep pars are ledgered from the first night; their score waits for that reading.
 */
import type { DemandInputs } from "@/lib/dynamic-pars-engine-shared";
import type { HeatCell } from "@/lib/pulse/baseline-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import {
  baselineModel, freezeDateFor, laborForecastRecord, parForecastRecord, prepForecastRecord, targetFreezeArgs,
  type ForecastRecord, type TargetFreezeArgs,
} from "./ledger-shared";
import {
  NO_SIGNAL, forecastLabor, forecastPars, forecastPrep, laborTargetFromDay, parTargetFromInputs, snapshotLaborInputs, snapshotParInputs,
  snapshotPrepInputs, type Blob, type LaborInputs, type PrepInputs, type ReplaySurface,
} from "./replay";

/** The only functions this pass may call. */
export const DEMAND_WRITERS = ["demand_blobs_put", "demand_model_register", "demand_forecast_record", "demand_target_freeze", "demand_holdout_claim"] as const;
type Writer = (typeof DEMAND_WRITERS)[number];

export interface LedgerDeps {
  rpc: (name: Writer, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  /** The labor inputs for a build day of TODAY. */
  loadLabor: () => Promise<LaborInputs>;
  /** One realized day, from the same read the forecast uses. */
  loadLaborDay: (date: string) => Promise<{ heat: HeatCell[]; capturedDays: string[] }>;
  loadPrep: () => Promise<PrepInputs>;
  now: () => number;
}

export type SurfaceStep = { recorded: number; kept: number } | { skipped: string } | { error: string };
export type TargetStep = "frozen" | "kept" | "revised" | "skipped" | "failed";
export type ShopLedgerResult =
  | { status: "not_installed" }
  | { status: "ok" | "partial"; pars: SurfaceStep; labor: SurfaceStep; prep: SurfaceStep; targets: { par_product_day_oz: TargetStep; labor_sales_day: TargetStep } };

const BLOBS_PER_CALL = 100;
const CHARS_PER_CALL = 600_000;
const missingFunction = (e: { code?: string; message: string }): boolean =>
  e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message);

export async function runDemandLedgerForShop(
  args: { locationId: string; todayEt: string; parInputs: DemandInputs | null; deadlineAt: number },
  deps: LedgerDeps,
): Promise<ShopLedgerResult> {
  const { locationId, todayEt } = args;
  const call = async (name: Writer, a: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await deps.rpc(name, a);
    if (error) throw new Error("demand_writer_failed");
    return data;
  };
  const put = async (blobs: ReadonlyArray<Blob>): Promise<void> => {
    let batch: Blob[] = [], chars = 0;
    const flush = async () => { if (batch.length > 0) { await call("demand_blobs_put", { p_blobs: batch }); batch = []; chars = 0; } };
    for (const b of blobs) {
      if (batch.length >= BLOBS_PER_CALL || (batch.length > 0 && chars + b.text.length > CHARS_PER_CALL)) await flush();
      batch.push(b); chars += b.text.length;
    }
    await flush();
  };
  const inTime = (): boolean => deps.now() < args.deadlineAt;

  // ① The models. This is also the readiness probe: before 0342 there is no such function.
  const models = (["pars", "labor", "prep"] as const).map((s) => baselineModel(s));
  const late: SurfaceStep = { skipped: "deadline" };
  if (!inTime()) return { status: "partial", pars: late, labor: late, prep: late, targets: { par_product_day_oz: "skipped", labor_sales_day: "skipped" } };
  const first = await deps.rpc("demand_blobs_put", { p_blobs: models.map((m) => m.blob) });
  if (first.error) {
    if (missingFunction(first.error)) return { status: "not_installed" };
    const failed: SurfaceStep = { error: "models_failed" };
    return { status: "partial", pars: failed, labor: failed, prep: failed, targets: { par_product_day_oz: "skipped", labor_sales_day: "skipped" } };
  }
  let modelsOk = true;
  try {
    for (const m of models) await call("demand_model_register", { p_model_hash: m.blob.hash, p_surface: m.surface, p_model_key: m.modelKey, p_feature_class: m.featureClass });
  } catch { modelsOk = false; }
  const modelHash = (s: ReplaySurface): string => models.find((m) => m.surface === s)!.blob.hash;

  const record = async (surface: ReplaySurface, build: () => Promise<{ manifest: Blob; parts: Blob[]; record: ForecastRecord } | { skipped: string }>): Promise<SurfaceStep> => {
    if (!modelsOk) return { error: "models_failed" };
    if (!inTime()) return { skipped: "deadline" };
    try {
      const built = await build();
      if ("skipped" in built) return built;
      await put([built.manifest, ...built.parts, built.record.forecast]);
      const out = await call("demand_forecast_record", {
        p_location_id: locationId, p_surface: surface, p_model_hash: modelHash(surface), p_engine: built.record.engine,
        p_manifest_hash: built.manifest.hash, p_decision_date: todayEt, p_entries: built.record.entries,
      }) as { recorded?: number; kept?: number } | null;
      return { recorded: Number(out?.recorded ?? 0), kept: Number(out?.kept ?? 0) };
    } catch { return { error: `${surface}_failed` }; }
  };

  // ② Pars: only the night that just ran is this morning's decision.
  const parNight = args.parInputs !== null && args.parInputs.runDateEt === addDaysEt(todayEt, -1) ? args.parInputs : null;
  const pars = await record("pars", async () => {
    if (args.parInputs === null) return { skipped: "no_par_inputs" };
    if (parNight === null) return { skipped: "par_inputs_not_last_night" };
    const snap = snapshotParInputs(parNight);
    return { manifest: snap.manifest, parts: snap.parts, record: parForecastRecord(forecastPars(parNight, todayEt)) };
  });
  // ③ Labor.
  const labor = await record("labor", async () => {
    const inputs = await deps.loadLabor();
    if (inputs.asOf !== todayEt) return { skipped: "labor_inputs_not_today" };
    return { manifest: snapshotLaborInputs(inputs), parts: [], record: laborForecastRecord(forecastLabor(inputs, NO_SIGNAL)) };
  });
  // ④ Prep.
  const prep = await record("prep", async () => {
    const inputs = await deps.loadPrep();
    return { manifest: snapshotPrepInputs(inputs), parts: [], record: prepForecastRecord(forecastPrep(inputs, todayEt)) };
  });

  // ⑤ The targets of four days ago.
  const validDate = freezeDateFor(todayEt);
  const freeze = async (read: () => Promise<TargetFreezeArgs | null>): Promise<TargetStep> => {
    if (!inTime()) return "skipped";
    try {
      const a = await read();
      if (a === null) return "skipped";
      if (a.blob) await put([a.blob]);
      const out = await call("demand_target_freeze", {
        p_location_id: locationId, p_target: a.target, p_valid_date: a.validDate, p_coverage: a.coverage, p_payload_hash: a.blob?.hash ?? null, p_fingerprint: a.fingerprint,
      });
      return out === "frozen" || out === "kept" || out === "revised" ? out : "failed";
    } catch { return "failed"; }
  };
  const parTarget = await freeze(async () => {
    const read = parNight === null ? null : parTargetFromInputs(parNight, validDate);
    return read === null ? null : targetFreezeArgs("par_product_day_oz", validDate, read);
  });
  const laborTarget = await freeze(async () => {
    const day = await deps.loadLaborDay(validDate);
    return targetFreezeArgs("labor_sales_day", validDate, laborTargetFromDay(locationId, validDate, day.heat, day.capturedDays));
  });

  const done = (s: SurfaceStep): boolean => "recorded" in s;
  const frozen = (t: TargetStep): boolean => t === "frozen" || t === "kept" || t === "revised";
  return {
    status: done(pars) && done(labor) && done(prep) && frozen(parTarget) && frozen(laborTarget) ? "ok" : "partial",
    pars, labor, prep, targets: { par_product_day_oz: parTarget, labor_sales_day: laborTarget },
  };
}

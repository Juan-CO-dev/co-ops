// Item 4 PR 1: the nightly ledger pass for one shop, with every read and write injected. No database.
import { describe, expect, it } from "vitest";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { runDemandLedgerForShop, DEMAND_WRITERS, type LedgerDeps } from "@/lib/demand-signals/ledger-pass";
import { NOT_COVERED_FINGERPRINT } from "@/lib/demand-signals/ledger-shared";
import { replayVerdict, type Blob, type LaborInputs, type PrepInputs } from "@/lib/demand-signals/replay";
import { buildParInputs, FIX_LOC } from "./helpers/par-engine-fixture";

const TODAY = "2026-10-16";
const parInputs = () => buildParInputs({ runDate: addDaysEt(TODAY, -1) });
const labor: LaborInputs = { v: 1, locationId: FIX_LOC, asOf: TODAY, structureId: "s", overrides: [],
  baseline: { kind: "ok", raw: { hours: [{ dow: 5, hour: 12, cents: 400_000 }], capturedDays: ["2026-10-09"] } },
  dayTypes: { slowBelowCents: 400_000, busyAboveCents: 480_000, weekendIsoDows: [6, 7] } };
const prep: PrepInputs = { v: 1, locationId: FIX_LOC, items: [{ itemId: "aioli", defaultPar: 6, defaultParUnit: "qt", active: true, parRows: [] }] };

interface Call { name: string; args: Record<string, unknown> }
function harness(over: Partial<LedgerDeps> & { rpcError?: (name: string) => { code?: string; message: string } | null } = {}) {
  const calls: Call[] = [];
  const blobs = new Map<string, string>();
  const loads: string[] = [];
  let clock = 0;
  const deps: LedgerDeps = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      const error = over.rpcError?.(name) ?? null;
      if (error) return { data: null, error };
      if (name === "demand_blobs_put") for (const b of args.p_blobs as Blob[]) blobs.set(b.hash, b.text);
      return { data: name === "demand_forecast_record" ? { recorded: (args.p_entries as unknown[]).length, kept: 0 } : name === "demand_target_freeze" ? "frozen" : "registered", error: null };
    },
    loadLabor: over.loadLabor ?? (async () => { loads.push("labor"); return labor; }),
    loadLaborDay: over.loadLaborDay ?? (async (date) => { loads.push(`laborDay:${date}`); return { heat: [{ dow: 1, hour: 12, cents: 123_400 }], capturedDays: [date] }; }),
    loadPrep: over.loadPrep ?? (async () => { loads.push("prep"); return prep; }),
    now: over.now ?? (() => (clock += 10)),
  };
  return { deps, calls, blobs, loads };
}
const run = (h: ReturnType<typeof harness>, o: { par?: ReturnType<typeof parInputs> | null; deadlineAt?: number } = {}) =>
  runDemandLedgerForShop({ locationId: FIX_LOC, todayEt: TODAY, parInputs: o.par === undefined ? parInputs() : o.par, deadlineAt: o.deadlineAt ?? 1e9 }, h.deps);

describe("the ledger pass", () => {
  it("before 0341 it finds no writer, reads nothing and says so", async () => {
    const h = harness({ rpcError: () => ({ code: "PGRST202", message: "Could not find the function" }) });
    expect(await run(h)).toEqual({ status: "not_installed" });
    expect(h.calls.length).toBe(1);
    expect(h.loads).toEqual([]);
  });
  it("records the three baselines for today's decision and freezes the targets of four days ago", async () => {
    const h = harness();
    const res = await run(h);
    expect(res).toMatchObject({ status: "ok", pars: { recorded: 7, kept: 0 }, labor: { recorded: 12, kept: 0 }, prep: { recorded: 7, kept: 0 },
      targets: { par_product_day_oz: "frozen", labor_sales_day: "frozen" } });
    const records = h.calls.filter((c) => c.name === "demand_forecast_record");
    expect(records.map((c) => c.args.p_surface)).toEqual(["pars", "labor", "prep"]);
    expect(records.every((c) => c.args.p_decision_date === TODAY && c.args.p_location_id === FIX_LOC)).toBe(true);
    expect(h.calls.filter((c) => c.name === "demand_model_register").map((c) => `${c.args.p_surface}:${c.args.p_model_key}:${c.args.p_feature_class}`))
      .toEqual(["pars:baseline:baseline", "labor:baseline:baseline", "prep:baseline:baseline"]);
    const freezes = h.calls.filter((c) => c.name === "demand_target_freeze");
    expect(freezes.map((c) => [c.args.p_target, c.args.p_valid_date, c.args.p_coverage])).toEqual([
      ["par_product_day_oz", "2026-10-12", "covered"], ["labor_sales_day", "2026-10-12", "covered"]]);
    expect(h.loads).toEqual(["labor", "prep", "laborDay:2026-10-12"]);
  });
  it("what it stored replays to what it recorded (the inputs, not a fingerprint)", async () => {
    const h = harness();
    await run(h);
    for (const c of h.calls.filter((x) => x.name === "demand_forecast_record")) {
      const entry = (c.args.p_entries as Array<{ forecast_hash: string }>)[0]!;
      expect(replayVerdict({ surface: c.args.p_surface as "pars", manifestHash: c.args.p_manifest_hash as string, forecastHash: entry.forecast_hash,
        decisionDate: TODAY, engine: c.args.p_engine as string }, (hash) => h.blobs.get(hash))).toBe("reproduced");
    }
  });
  it("writes only through the five 0341 writers, in bounded requests", async () => {
    const h = harness();
    await run(h);
    expect(new Set(h.calls.map((c) => c.name))).toEqual(new Set(["demand_blobs_put", "demand_model_register", "demand_forecast_record", "demand_target_freeze"]));
    expect(h.calls.every((c) => (DEMAND_WRITERS as readonly string[]).includes(c.name))).toBe(true);
    for (const c of h.calls.filter((x) => x.name === "demand_blobs_put")) {
      const bs = c.args.p_blobs as Blob[];
      expect(bs.length).toBeLessThanOrEqual(100);
      expect(bs.reduce((n, b) => n + b.text.length, 0)).toBeLessThanOrEqual(600_000);
    }
  });
  it("an uncaptured day is frozen as not covered; a day outside the night's window is not frozen at all", async () => {
    const h = harness({ loadLaborDay: async () => ({ heat: [], capturedDays: [] }) });
    const par = parInputs();
    const day = par.window.find((d) => d.dateEt === "2026-10-12")!;
    day.salesObserved = false; day.productionObserved = false;
    await run(h, { par });
    const freezes = h.calls.filter((c) => c.name === "demand_target_freeze");
    expect(freezes.map((c) => [c.args.p_target, c.args.p_coverage, c.args.p_payload_hash, c.args.p_fingerprint])).toEqual([
      ["par_product_day_oz", "not_covered", null, NOT_COVERED_FINGERPRINT], ["labor_sales_day", "not_covered", null, NOT_COVERED_FINGERPRINT]]);
  });
  it("par inputs that are not last night's are not recorded as today's forecast", async () => {
    const h = harness();
    const res = await run(h, { par: buildParInputs({ runDate: addDaysEt(TODAY, -3) }) });
    expect(res).toMatchObject({ status: "partial", pars: { skipped: "par_inputs_not_last_night" } });
    expect(h.calls.filter((c) => c.name === "demand_forecast_record").map((c) => c.args.p_surface)).toEqual(["labor", "prep"]);
    expect((await run(harness(), { par: null }))).toMatchObject({ pars: { skipped: "no_par_inputs" }, targets: { par_product_day_oz: "skipped" } });
  });
  it("one surface failing never stops the others, and is named by a fixed code", async () => {
    const h = harness({ loadLabor: async () => { throw new Error("relation \"secret_table\" does not exist"); } });
    const res = await run(h);
    expect(res).toMatchObject({ status: "partial", pars: { recorded: 7 }, labor: { error: "labor_failed" }, prep: { recorded: 7 } });
    expect(JSON.stringify(res)).not.toContain("secret_table");
    const h2 = harness({ rpcError: (name) => (name === "demand_target_freeze" ? { message: "target_freeze_too_early" } : null) });
    expect(await run(h2)).toMatchObject({ status: "partial", targets: { par_product_day_oz: "failed", labor_sales_day: "failed" } });
  });
  it("nothing starts past the deadline", async () => {
    let t = 0;
    const h = harness({ now: () => (t += 100) });
    const res = await run(h, { deadlineAt: 250 });
    expect(res).toMatchObject({ status: "partial", labor: { skipped: "deadline" }, prep: { skipped: "deadline" }, targets: { labor_sales_day: "skipped" } });
  });
});

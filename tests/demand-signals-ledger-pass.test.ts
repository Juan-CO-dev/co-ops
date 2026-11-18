// Item 4 PR 1: the nightly ledger pass for one shop, with every read and write injected. No database.
import { describe, expect, it, vi } from "vitest";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { runDemandLedgerForShop, DEMAND_WRITERS, type LedgerDeps } from "@/lib/demand-signals/ledger-pass";
import { NOT_COVERED_FINGERPRINT } from "@/lib/demand-signals/ledger-shared";
import { replayVerdict, type Blob, type LaborInputs, type PrepInputs } from "@/lib/demand-signals/replay";
import { buildParInputs, FIX_LOC } from "./helpers/par-engine-fixture";

const auditMock = vi.hoisted(() => vi.fn(async (_input: unknown): Promise<void> => {}));
vi.mock("@/lib/audit", () => ({ audit: (input: unknown) => auditMock(input) }));

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
  it("before 0342 it finds no writer, reads nothing and says so", async () => {
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
  it("writes only through the five 0342 writers, in bounded requests", async () => {
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

// Review r1 #3: the deadline used to gate only whether a step STARTED. A request that never answered held the pass
// (and the labor pull behind it in the nightly) for as long as it liked.
describe("the ledger pass is cut off at its deadline", () => {
  const never = <T>(): Promise<T> => new Promise<T>(() => {});
  const real = { now: () => Date.now() };
  const timed = async <T>(work: Promise<T>): Promise<{ value: T; ms: number }> => { const t0 = Date.now(); const value = await work; return { value, ms: Date.now() - t0 }; };
  const BUDGET = 80, SLACK = 1_000;

  it("every read and every write is handed the pass's abort signal", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const h = harness();
    const deps: LedgerDeps = {
      rpc: (name, args, signal) => { signals.push(signal); return h.deps.rpc(name, args, signal); },
      loadLabor: (signal) => { signals.push(signal); return h.deps.loadLabor(signal); },
      loadLaborDay: (date, signal) => { signals.push(signal); return h.deps.loadLaborDay(date, signal); },
      loadPrep: (signal) => { signals.push(signal); return h.deps.loadPrep(signal); },
      now: h.deps.now,
    };
    await run({ ...h, deps });
    expect(signals.length).toBeGreaterThan(10);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
    expect(new Set(signals).size).toBe(1);
  });
  it.each(["demand_blobs_put", "demand_model_register", "demand_forecast_record", "demand_target_freeze"] as const)(
    "a %s that never answers ends the pass at the deadline", async (stuck) => {
      let seen: AbortSignal | undefined, n = 0;
      const h = harness();
      const deps: LedgerDeps = { ...h.deps, ...real,
        // the first blob write is the readiness probe: let it through so a surface's own batch is the one that hangs
        rpc: (name, args, signal) => { if (name === stuck && (name !== "demand_blobs_put" || (n += 1) > 1)) { seen = signal; return never(); } return h.deps.rpc(name, args, signal); } };
      const { value, ms } = await timed(run({ ...h, deps }, { deadlineAt: Date.now() + BUDGET }));
      expect(ms).toBeLessThan(BUDGET + SLACK);
      expect(seen?.aborted).toBe(true);
      expect(value.status).toBe("partial");
      expect(JSON.stringify(value)).toContain("deadline");
    });
  it("a readiness probe that never answers ends the pass at the deadline", async () => {
    const h = harness();
    const { value, ms } = await timed(run({ ...h, deps: { ...h.deps, ...real, rpc: () => never() } }, { deadlineAt: Date.now() + BUDGET }));
    expect(ms).toBeLessThan(BUDGET + SLACK);
    expect(value).toMatchObject({ status: "partial", pars: { error: "deadline" }, labor: { error: "deadline" }, prep: { error: "deadline" } });
  });
  it.each(["loadLabor", "loadPrep", "loadLaborDay"] as const)("a %s read that never answers ends the pass at the deadline", async (stuck) => {
    let seen: AbortSignal | undefined;
    const h = harness();
    const hang = (...a: unknown[]) => { seen = a[a.length - 1] as AbortSignal; return never<never>(); };
    const { value, ms } = await timed(run({ ...h, deps: { ...h.deps, ...real, [stuck]: hang } }, { deadlineAt: Date.now() + BUDGET }));
    expect(ms).toBeLessThan(BUDGET + SLACK);
    expect(seen?.aborted).toBe(true);
    expect(value.status).toBe("partial");
    // nothing is started after the cut: no writer is called once the signal has fired
    const after = h.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(h.calls.length).toBe(after);
  });
  it("a step cut by the deadline is named, and the steps after it are skipped, not started", async () => {
    const h = harness();
    const deps: LedgerDeps = { ...h.deps, ...real, loadLabor: () => never() };
    const { value } = await timed(run({ ...h, deps }, { deadlineAt: Date.now() + BUDGET }));
    expect(value).toMatchObject({ status: "partial", pars: { recorded: 7 }, labor: { error: "deadline" }, prep: { skipped: "deadline" },
      targets: { par_product_day_oz: "skipped", labor_sales_day: "skipped" } });
    expect(h.loads).toEqual([]);
  });
  it("a pass that finishes in time leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await run({ ...h, deps: { ...h.deps, ...real } }, { deadlineAt: Date.now() + 40_000 });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

// The night: every shop and the heartbeat inside ONE deadline, on the real client wiring.
describe("the ledger night never runs past its deadline", () => {
  const BUDGET = 120, SLACK = 1_000;
  /** A PostgREST-shaped builder that answers only when its abort signal fires (as fetch does). */
  const stuckClient = (seen: AbortSignal[]) => {
    const builder = (): Record<string, unknown> => {
      let signal: AbortSignal | undefined;
      const b: Record<string, unknown> = new Proxy({}, { get: (_t, prop) => {
        if (prop === "abortSignal") return (s: AbortSignal) => { signal = s; seen.push(s); return b; };
        if (prop === "then") return (ok: (v: unknown) => unknown) => new Promise((resolve) => {
          const done = () => resolve({ data: null, error: { code: "20", message: "AbortError" } });
          if (signal?.aborted) done(); else signal?.addEventListener("abort", done, { once: true });
        }).then(ok);
        return () => b;
      } });
      return b;
    };
    return { rpc: () => builder(), from: () => builder() };
  };
  it("a database that never answers costs the nightly the ledger's budget and no more, heartbeat included", async () => {
    const seen: AbortSignal[] = [];
    auditMock.mockImplementation(() => new Promise<void>(() => {}));
    const { runDemandLedgerNight } = await import("@/lib/demand-signals/ledger");
    const t0 = Date.now();
    const out = await runDemandLedgerNight({ sb: stuckClient(seen) as never, locationIds: [FIX_LOC, "shop-2"], todayEt: TODAY,
      parInputsByShop: new Map([[FIX_LOC, parInputs()]]), deadlineAt: t0 + BUDGET, heartbeatMs: 40 });
    expect(Date.now() - t0).toBeLessThan(BUDGET + SLACK);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.aborted)).toBe(true);
    expect(out[FIX_LOC]).toMatchObject({ status: "partial" });
    expect(out["shop-2"]).toMatchObject({ status: "partial", pars: { skipped: "deadline" } });
    expect(auditMock).toHaveBeenCalledTimes(1);
    // with the default tail, a deadline shorter than the tail starts nothing at all and still returns on time
    seen.length = 0;
    const t1 = Date.now();
    const late = await runDemandLedgerNight({ sb: stuckClient(seen) as never, locationIds: [FIX_LOC], todayEt: TODAY, parInputsByShop: new Map(), deadlineAt: t1 + BUDGET });
    expect(Date.now() - t1).toBeLessThan(BUDGET + SLACK);
    expect(seen).toEqual([]);
    expect(late[FIX_LOC]).toMatchObject({ status: "partial", pars: { skipped: "deadline" } });
  });
  it("the shops stop early enough to leave the heartbeat its share of the same deadline", async () => {
    const { DEMAND_LEDGER_BUDGET_MS, DEMAND_LEDGER_HEARTBEAT_MS } = await import("@/lib/demand-signals/ledger");
    expect(DEMAND_LEDGER_HEARTBEAT_MS).toBeGreaterThan(0);
    expect(DEMAND_LEDGER_HEARTBEAT_MS).toBeLessThan(DEMAND_LEDGER_BUDGET_MS / 4);
  });
});

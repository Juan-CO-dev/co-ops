// Item 4 PR 1: everything is dark, and the two contracts for later PRs cannot be missed.
//   · DARK: with DEMAND_LEDGER unset nothing imports or calls the ledger, and no operational module reads this layer.
//   · CENSUS: every module under lib/demand-signals (and every signal route) is listed here with the contract it
//     answers. PR 2 (sources) and PR 7 (AI) add modules: this test fails until their author lists each one and
//     says how it meets Astra r2 P2 #3 (revocation stops USE) or P2 #4 (the AI sentence is validated evidence).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demandLedgerEnabled } from "@/lib/demand-signals/config-shared";
import {
  INSIGHT_CLAIMS, MODEL_FREE_TEXT_RENDERED, REVOCATION_KEEPS_HISTORY, SIGNAL_USE_POINTS, insightSentenceKey, signalUsable, validateInsightClaims,
} from "@/lib/demand-signals/contracts-shared";

const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name).replace(/\\/g, "/");
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * THE CENSUS. `none` = the module touches no external source and renders no model text (say why).
 * A PR 2 module that collects, computes, renders or accepts a sourced signal must be `revocation` and call
 * `signalUsable`. A PR 7 module that handles model output must be `ai` and call `validateInsightClaims`.
 */
const CENSUS: Record<string, { contract: "none" | "revocation" | "ai"; why: string }> = {
  "lib/demand-signals/backtest.ts": { contract: "none", why: "zero-feed candidates only (trend, calendar); no source" },
  "lib/demand-signals/candidates-shared.ts": { contract: "none", why: "the sales trend and the computed holiday calendar; no source" },
  "lib/demand-signals/canonical-shared.ts": { contract: "none", why: "text canonicalisation" },
  "lib/demand-signals/config-shared.ts": { contract: "none", why: "the DEMAND_LEDGER switch" },
  "lib/demand-signals/contracts-shared.ts": { contract: "none", why: "the contracts themselves" },
  "lib/demand-signals/evidence-shared.ts": { contract: "none", why: "evidence classes and vintage selection" },
  "lib/demand-signals/hash.ts": { contract: "none", why: "the sha256 content hash" },
  "lib/demand-signals/ledger-pass.ts": { contract: "none", why: "records BASELINE forecasts only; no signal, no source" },
  "lib/demand-signals/ledger-shared.ts": { contract: "none", why: "writer arguments for baselines and zero-feed models" },
  "lib/demand-signals/ledger.ts": { contract: "none", why: "reads the three baselines' own inputs; no external source" },
  "lib/demand-signals/replay.ts": { contract: "none", why: "replays baselines; the candidate arm takes multipliers, not sources" },
  "lib/demand-signals/report-shared.ts": { contract: "none", why: "deterministic text; no model output" },
  "lib/demand-signals/scoring-shared.ts": { contract: "none", why: "scoring and the pass rule" },
};

describe("dark by default", () => {
  it("the switch is on only for the literal 1", () => {
    for (const v of [undefined, "", "0", "true", "on", " 1"]) expect(demandLedgerEnabled(v)).toBe(false);
    expect(demandLedgerEnabled("1")).toBe(true);
  });
  it("no app, component or lib module outside this layer imports it, except the nightly's guarded hook", () => {
    const importers = [...walk("lib"), ...walk("app"), ...walk("components")]
      .filter((p) => !p.startsWith("lib/demand-signals/") && /(from|import\()\s*"@\/lib\/demand-signals/.test(read(p)));
    expect(importers).toEqual(["lib/toast-sales-pull-run.ts"]);
  });
  it("the nightly statically imports only the import-free switch, and reaches the ledger only inside the ON branch", () => {
    const src = read("lib/toast-sales-pull-run.ts");
    expect([...src.matchAll(/from "@\/lib\/demand-signals\/([\w-]+)"/g)].map((m) => m[1])).toEqual(["config-shared"]);
    expect(read("lib/demand-signals/config-shared.ts")).not.toMatch(/^import /m);
    const on = src.indexOf("if (demandLedgerOn) {");
    expect(on).toBeGreaterThan(-1);
    expect(src.indexOf('await import("@/lib/demand-signals/ledger")')).toBeGreaterThan(on);
    expect(src.match(/import\("@\/lib\/demand-signals/g)!.length).toBe(1);
    // Off: the par run is called exactly as before, with two arguments.
    expect(src).toContain(": await runParShadowForLocation(locationId, businessDate)).rows;");
    expect(src).toMatch(/demandLedgerOn\s*\?\s*await runParShadowForLocation\(locationId, businessDate, \(inputs\)/);
  });
  it("the par run's observer cannot change or fail the run", () => {
    const src = read("lib/dynamic-pars.ts");
    expect(src).toContain("if (observe) { try { observe(inputs); } catch {");
    expect(src.indexOf("if (observe)")).toBeGreaterThan(src.indexOf("const ledger = computeParLedger(inputs, mode);"));
    expect(src.indexOf("if (observe)")).toBeLessThan(src.indexOf("await writeLedger(sb, locationId, runDateEt, ledger);"));
  });
  it("this layer makes no outside call and writes no table directly", () => {
    for (const p of walk("lib/demand-signals")) {
      const src = read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, p).not.toMatch(/\bfetch\(|axios|https?:\/\/|node:https?|\.insert\(|\.upsert\(|\.delete\(/);
      // hash.ts calls createHash().update(): the one `.update(` of the layer, and not a table write.
      if (p !== "lib/demand-signals/hash.ts") expect(src, p).not.toMatch(/\.update\(/);
      if (p !== "lib/demand-signals/ledger.ts") expect(src, p).not.toMatch(/\bsb\.(rpc|from)\(|\.from\("|supabase-server|server-only/);
      if (p !== "lib/demand-signals/ledger.ts") expect(src, p).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|process\.env/);
    }
    const ledger = read("lib/demand-signals/ledger.ts");
    expect([...ledger.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]).sort()).toEqual(["item_par_levels", "items"]);
    expect([...ledger.matchAll(/\.rpc\(("?\w+"?)/g)].map((m) => m[1]).sort()).toEqual(['"pulse_sales_baseline"', "name"]);
  });
  it("0342 is the only migration of this PR and the next free number", () => {
    const files = readdirSync("supabase/migrations").filter((f) => /^\d{4}_/.test(f)).sort();
    expect(files.filter((f) => f.includes("demand_signals"))).toEqual(["0342_demand_signals_replay.sql"]);
    expect(read("supabase/migrations/0342_demand_signals_replay.sql")).toMatch(/^-- AUTHORED 2026-11-17 .* NOT YET APPLIED/m);
  });
});

describe("the module census (PR 2 and PR 7 must come through here)", () => {
  it("every module of the layer is listed, and nothing listed is gone", () => {
    expect(walk("lib/demand-signals").sort()).toEqual(Object.keys(CENSUS).sort());
  });
  it("no signal route or page exists yet; the first one must be added to this census with its contract", () => {
    const routes = [...walk("app")].filter((p) => /\/(signals|demand-signals)\//.test(p));
    expect(routes).toEqual([]);
  });
  it("a module under a contract calls the contract's one check", () => {
    for (const [path, entry] of Object.entries(CENSUS)) {
      if (entry.contract === "revocation") expect(read(path), path).toMatch(/\bsignalUsable\(/);
      if (entry.contract === "ai") { expect(read(path), path).toMatch(/\bvalidateInsightClaims\(/); expect(read(path), path).toMatch(/MODEL_FREE_TEXT_RENDERED/); }
      expect(entry.why.length).toBeGreaterThan(10);
    }
  });
});

describe("PR 2 contract: a revoked source stops USE at every point", () => {
  const ok = [{ sourceId: "nws", status: "verified" as const }];
  it("only verified sources are usable, and the answer is the same at collect, compute, render and accept", () => {
    expect(SIGNAL_USE_POINTS).toEqual(["collect", "compute", "render", "accept"]);
    for (const use of SIGNAL_USE_POINTS) {
      expect(signalUsable(ok, use)).toEqual({ ok: true });
      expect(signalUsable([...ok, { sourceId: "ncei", status: "revoked" }], use)).toEqual({ ok: false, code: "source_revoked", sourceId: "ncei" });
      expect(signalUsable([{ sourceId: "opm", status: "unverified" }], use)).toEqual({ ok: false, code: "source_unverified", sourceId: "opm" });
      expect(signalUsable([], use)).toEqual({ ok: true }); // a zero-feed signal has no source
    }
  });
  it("revocation between display and accept refuses the accept (the check reads the CURRENT status)", () => {
    const register = new Map([["nws", "verified" as "verified" | "revoked"]]);
    const current = () => [...register].map(([sourceId, status]) => ({ sourceId, status }));
    expect(signalUsable(current(), "render").ok).toBe(true);
    register.set("nws", "revoked");
    expect(signalUsable(current(), "accept")).toEqual({ ok: false, code: "source_revoked", sourceId: "nws" });
    expect(REVOCATION_KEEPS_HISTORY).toBe(true);
  });
});

describe("PR 7 contract: the AI sentence is validated evidence or it is nothing", () => {
  const evidence = [{ id: "ev1", kind: "candidate_score" as const }, { id: "ev2", kind: "named_event" as const }, { id: "ev3", kind: "qualification" as const }];
  it("there is no free-text channel", () => { expect(MODEL_FREE_TEXT_RENDERED).toBe(false); });
  it("a claim needs a known type and evidence of a kind that type may cite", () => {
    const res = validateInsightClaims([
      { type: "signal_helped_on_history", evidenceIds: ["ev1"] },
      { type: "event_on_date", evidenceIds: ["ev2"] },
      { type: "demand_will_surge_because_of_the_shutdown", evidenceIds: ["ev2"] },
      { type: "signal_qualified", evidenceIds: ["ev1"] },
      { type: "signal_qualified", evidenceIds: [] },
      { type: "signal_qualified", evidenceIds: ["ev9"] },
    ], evidence);
    expect(res.valid).toEqual([{ type: "signal_helped_on_history", evidenceIds: ["ev1"] }, { type: "event_on_date", evidenceIds: ["ev2"] }]);
    expect(res.rejected.map((r) => r.reason)).toEqual(["unknown_claim_type", "evidence_kind_mismatch", "no_evidence", "unknown_evidence"]);
  });
  it("a valid claim is rendered by a template key, never by the model; no claim type forecasts or explains a cause", () => {
    expect(insightSentenceKey("signal_qualified")).toBe("signals.insight.signal_qualified");
    expect(Object.keys(INSIGHT_CLAIMS).join(" ")).not.toMatch(/will|because|cause|predict|surge/);
    expect(validateInsightClaims([{ type: "constructor", evidenceIds: ["ev1"] }], evidence).valid).toEqual([]);
  });
});

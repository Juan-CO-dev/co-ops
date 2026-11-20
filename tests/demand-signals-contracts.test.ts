// Item 4 PR 1: everything is dark, and the two contracts for later PRs cannot be missed.
//   · DARK: with DEMAND_LEDGER unset nothing imports or calls the ledger, and no operational module reads this layer.
//   · CENSUS: every module under lib/demand-signals (and every signal route) is listed here with the contract it
//     answers. PR 2 (sources) and PR 7 (AI) add modules: this test fails until their author lists each one and
//     says how it meets Astra r2 P2 #3 (revocation stops USE) or P2 #4 (the AI sentence is validated evidence).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { demandLedgerEnabled } from "@/lib/demand-signals/config-shared";
import {
  INSIGHT_CLAIMS, MODEL_FREE_TEXT_RENDERED, REVOCATION_KEEPS_HISTORY, SIGNAL_USE_POINTS, insightSentenceKey, signalUsable, validateInsightClaims,
} from "@/lib/demand-signals/contracts-shared";
import { DEMAND_SIGNAL_RPCS } from "@/lib/demand-signals/signal-store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
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
  // PR 2 (sources). A route is listed by its path too.
  "app/api/admin/demand-signals/sources/mark/route.ts": { contract: "none", why: "writes the register's own status (MoO+, Tier B); it uses no signal" },
  // PR 5 (the pages). A page is listed by its path too.
  "app/admin/demand-signals/page.tsx": { contract: "none", why: "renders what signals-page.ts returns; every sourced row there came through the gated readers at render" },
  "app/admin/demand-signals/sources/page.tsx": { contract: "none", why: "shows the register itself (MoO+); it uses no signal" },
  "app/api/admin/demand-signals/events/route.ts": { contract: "none", why: "a manual event has no source, so no revocation applies; GM+ by role, behind the switch" },
  // PR 7 (AI insights; OFF behind DEMAND_AI, inert without its own key).
  "app/api/admin/demand-signals/insights/route.ts": { contract: "ai", why: "the one door to the model: builds facts, then requestInsights, whose answer passes acceptClaims (validateInsightClaims) or is dropped" },
  "lib/demand-signals/ai-client.ts": { contract: "none", why: "the SDK call itself; it returns raw text to insights.ts, which validates it, and renders nothing" },
  "lib/demand-signals/ai-store.ts": { contract: "none", why: "the spend ledger's store (0352); it stores only claims that already passed validation" },
  "lib/demand-signals/insights-shared.ts": { contract: "ai", why: "the facts, the schema, parseModelClaims and acceptClaims, which ends in validateInsightClaims; no model text survives it" },
  "lib/demand-signals/insights.ts": { contract: "ai", why: "the one request path: reserve, ask, parseModelClaims, acceptClaims (validateInsightClaims), settle" },
  // PR 6, first half (signals on the order walk, by name; no number, no writer).
  "lib/demand-signals/order-signals-shared.ts": { contract: "revocation", why: "render: the gate a tested number must pass asks usableNow with the register read for that render" },
  "lib/demand-signals/order-signals.ts": { contract: "none", why: "composes signals-page.ts (gated at render) and the gate in order-signals-shared.ts; it reads nothing itself" },
  "lib/demand-signals/input-shared.ts": { contract: "none", why: "pure, import-free: what a person sends (the mark, a manual event)" },
  "lib/demand-signals/signals-page.ts": { contract: "revocation", why: "render: the gated readers at the render use point, and usableNow over the register read for this render" },
  "lib/demand-signals/signals-view-shared.ts": { contract: "revocation", why: "render: weatherSourceStatus asks usableNow, so a revoked source reads 'not verified', never a forecast" },
  "app/api/cron/demand-signals/route.ts": { contract: "revocation", why: "collect: asks collectionPrecheck (the register NOW) before its lease and before any request" },
  "lib/demand-signals/access-shared.ts": { contract: "none", why: "role rules only; no source and no signal" },
  "lib/demand-signals/collect.ts": { contract: "revocation", why: "collect: collectDecision before anything, again before each shop; the writer asks again in SQL" },
  "lib/demand-signals/nws-client.ts": { contract: "none", why: "the GET itself; it knows no register and is reached only through collect.ts after the gate" },
  "lib/demand-signals/nws-shared.ts": { contract: "none", why: "pure normalizers and the adapter's own definition; no request, no read" },
  "lib/demand-signals/shop-points-shared.ts": { contract: "none", why: "pure: which shops have one active point (a catering node) and which are listed by reason; no source, no signal" },
  "lib/demand-signals/signal-store.ts": { contract: "revocation", why: "compute / render: keepUsable over the register NOW; collect: collectDecision; every write is a gated 0343 function" },
  "lib/demand-signals/sources-shared.ts": { contract: "revocation", why: "the register helpers every use point calls; each one ends in signalUsable" },
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
    // PR 2 added two doors: the collection cron (OFF, and gated by the register) and the source mark route.
    // PR 5 adds the pages (dark behind DEMAND_SIGNALS), the manual-event route, the hub tile and the two clients.
    expect(importers.sort()).toEqual(["app/admin/demand-signals/page.tsx", "app/admin/demand-signals/sources/page.tsx", "app/admin/page.tsx",
      "app/api/admin/demand-signals/events/route.ts", "app/api/admin/demand-signals/insights/route.ts", "app/api/admin/demand-signals/sources/mark/route.ts",
      "app/api/cron/demand-signals/route.ts", "app/ordering/page.tsx", "components/admin/demand-signals/DemandSignalsClient.tsx", "components/admin/demand-signals/SourcesClient.tsx",
      "components/ordering/OrderSignalsPanel.tsx", "lib/toast-sales-pull-run.ts"]);
    // PR 6 (first half): the order walk's page reaches the layer only inside its DEMAND_SIGNALS branch (tests/demand-signals-order.test.ts).
    // The hub reaches only the two import-free rule files (who may see the tile, and the switch).
    expect([...read("app/admin/page.tsx").matchAll(/from "@\/lib\/demand-signals\/([\w-]+)"/g)].map((m) => m[1]).sort()).toEqual(["access-shared", "config-shared"]);
    expect(read("lib/demand-signals/access-shared.ts")).not.toMatch(/^import /m);
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
  it("ONE module makes an outside call (the NWS client, api.weather.gov only), and no module writes a table directly", () => {
    const strip = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
    // The modules that talk to the database: the ledger, the signal store, and (PR 7) the AI spend ledger's store.
    const DB = ["lib/demand-signals/ledger.ts", "lib/demand-signals/signal-store.ts", "lib/demand-signals/ai-store.ts"];
    // PR 7: the model client is server-only as well; it reads no environment and no table (tests/demand-signals-insights.test.ts).
    const SERVER_ONLY = [...DB, "lib/demand-signals/nws-client.ts", "lib/demand-signals/ai-client.ts"];
    for (const p of walk("lib/demand-signals")) {
      const src = strip(p);
      expect(src, p).not.toMatch(/axios|node:https?|\.insert\(|\.upsert\(|\.delete\(/);
      // PR 2: the one fetch of the layer. It is GET-only and host-pinned (tests/demand-signals-collect.test.ts).
      if (p !== "lib/demand-signals/nws-client.ts") expect(src, p).not.toMatch(/\bfetch\b/);
      // A URL appears only where a source is DEFINED (the NWS definition: weather.gov only) or a scheme is checked.
      const hosts = [...new Set([...src.matchAll(/https?:\/\/([A-Za-z0-9.${}_-]*)/g)].map((m) => m[1]!))].sort();
      if (p === "lib/demand-signals/nws-shared.ts") expect(hosts.every((h) => h === "${NWS_HOST}" || h === "api.weather.gov" || h === "www.weather.gov" || h === "api"), p + " " + hosts.join(",")).toBe(true);
      else if (p === "lib/demand-signals/sources-shared.ts") expect(hosts, p).toEqual([""]);
      else expect(hosts, p).toEqual([]);
      // hash.ts calls createHash().update(): the one `.update(` of the layer, and not a table write.
      if (p !== "lib/demand-signals/hash.ts") expect(src, p).not.toMatch(/\.update\(/);
      if (!DB.includes(p)) expect(src, p).not.toMatch(/\bsb\.(rpc|from)\(|\bclient\.(rpc|from)\(|\.from\("|supabase-server/);
      if (!SERVER_ONLY.includes(p)) expect(src, p).not.toMatch(/server-only/);
      if (!DB.includes(p)) expect(src, p).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|process\.env/);
      // PR 7: no module of the layer reads an environment value for the AI; the route and the page pass it in.
      expect(src, p).not.toMatch(/process\.env\.(DEMAND_AI|ANTHROPIC)/);
    }
    // The NWS client is wired in exactly one place, behind the collection pass's gate.
    const users = walk("lib").concat(walk("app")).filter((p) => /nws-client"/.test(read(p)) && !p.endsWith("nws-client.ts"));
    expect(users).toEqual(["lib/demand-signals/signal-store.ts"]);
    // The store: a shop's coordinates (two tables), and for the pages (PR 5) the register's own definitions and the
    // run ledger; 0343's functions and nothing else; one env value. No SIGNAL table is read here or anywhere.
    const store = strip("lib/demand-signals/signal-store.ts");
    expect([...store.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]).sort()).toEqual(["catering_fulfillment_nodes", "demand_signal_runs", "demand_sources", "locations"]);
    expect([...store.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1])).toEqual(["NWS_USER_AGENT"]);
    const M0343 = read("supabase/migrations/0343_demand_signal_sources.sql");
    for (const name of DEMAND_SIGNAL_RPCS) expect(M0343, name).toContain(`create function public.${name}(`);
    expect(store).toContain("client.rpc(name, args)");
    // Fix round 1: the second spelling is the PAGED read of the two set-returning readers (count: exact + range).
    expect(store).toContain('client.rpc(name, args, { count: "exact" }).range(out.length, out.length + SIGNAL_READ_PAGE - 1)');
    expect(store).toMatch(/async function callAll\(sb: SupabaseClient, name: Extract<Rpc, "demand_usable_weather" \| "demand_usable_day_events">/);
    expect(store.match(/\.rpc\(/g)!.length).toBe(2);
    // No reader of a set calls the unpaged spelling: every stored-signal read goes through callAll.
    expect(store).not.toMatch(/call<[^>]*>\(sb, "demand_usable_/);
    expect(store.match(/await callAll\(sb, "demand_usable_(weather|day_events)"/g)!.length).toBe(2);
    const ledger = read("lib/demand-signals/ledger.ts");
    expect([...ledger.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]).sort()).toEqual(["item_par_levels", "items"]);
    expect([...ledger.matchAll(/\.rpc\(("?\w+"?)/g)].map((m) => m[1]).sort()).toEqual(['"pulse_sales_baseline"', "name"]);
  });
  it("STORED SIGNALS HAVE ONE READER: no module anywhere reads a signal table directly (it would skip the register)", () => {
    for (const p of [...walk("lib"), ...walk("app"), ...walk("components")]) {
      // The signal tables: nobody, the store included (their readers are 0343's gated functions).
      expect(read(p), p).not.toMatch(/from\("demand_(weather_hourly|day_events|source_events)"\)/);
      // The register's definitions and the run ledger hold no signal; PR 5 reads them for the pages, in the store only.
      if (p !== "lib/demand-signals/signal-store.ts") expect(read(p), p).not.toMatch(/from\("demand_(signal_runs|sources)"\)/);
    }
    const callers = [...walk("lib"), ...walk("app"), ...walk("components")].filter((p) => /"demand_(usable_weather|usable_day_events|weather_ingest|events_ingest)"/.test(read(p)));
    expect(callers).toEqual(["lib/demand-signals/signal-store.ts"]);
  });
  // Pins this PR's migration by name, never "the highest number": later migrations from other arcs are legal
  // (0344 portal, 0345 board landed after it), and a "latest file" pin breaks every PR that adds one.
  it("0343 is PR 2's one migration, its number unique, the file present", () => {
    const files = readdirSync("supabase/migrations").filter((f) => /^\d{4}_/.test(f)).sort();
    expect(files.filter((f) => f.startsWith("0343_"))).toEqual(["0343_demand_signal_sources.sql"]);
    expect(files.filter((f) => f.includes("demand_signal_sources"))).toEqual(["0343_demand_signal_sources.sql"]);
    expect(read("supabase/migrations/0343_demand_signal_sources.sql")).toMatch(/^-- AUTHORED 2026-11-18 /m);
  });
  it("0342 is the only migration of this PR and the next free number", () => {
    const files = readdirSync("supabase/migrations").filter((f) => /^\d{4}_/.test(f)).sort();
    expect(files.filter((f) => f.includes("demand_signals"))).toEqual(["0342_demand_signals_replay.sql"]);
    expect(read("supabase/migrations/0342_demand_signals_replay.sql")).toMatch(/^-- AUTHORED 2026-11-17 .* NOT YET APPLIED/m);
  });
});

describe("the module census (PR 2 and PR 7 must come through here)", () => {
  it("every module of the layer AND every signal route is listed, and nothing listed is gone", () => {
    const routes = [...walk("app")].filter((p) => /\/(signals|demand-signals)\//.test(p));
    expect(routes.sort()).toEqual(["app/admin/demand-signals/page.tsx", "app/admin/demand-signals/sources/page.tsx", "app/api/admin/demand-signals/events/route.ts",
      "app/api/admin/demand-signals/insights/route.ts", "app/api/admin/demand-signals/sources/mark/route.ts", "app/api/cron/demand-signals/route.ts"]);
    expect([...walk("lib/demand-signals"), ...routes].sort()).toEqual(Object.keys(CENSUS).sort());
  });
  it("PR 5 added the two pages; there is still no chip and no accept route (PR 6 adds them under 'revocation')", () => {
    expect([...walk("app")].filter((p) => /\/(signals|demand-signals)\//.test(p) && /page\.tsx$/.test(p)).sort())
      .toEqual(["app/admin/demand-signals/page.tsx", "app/admin/demand-signals/sources/page.tsx"]);
    expect([...walk("app")].filter((p) => /\/(signals|demand-signals)\//.test(p) && /accept/.test(p))).toEqual([]);
  });
  it("a module under a contract calls the contract's one check", () => {
    for (const [path, entry] of Object.entries(CENSUS)) {
      // PR 2: the one check is signalUsable; the register helpers (sources-shared.ts) and the cron's precheck are
      // the ONLY spellings built on it, and each is proved to end in it below.
      if (entry.contract === "revocation") expect(read(path), path).toMatch(/\b(signalUsable|usableNow|collectDecision|keepUsable|collectionPrecheck)\(/);
      // PR 7: the one check is validateInsightClaims; acceptClaims and requestInsights are the ONLY spellings built
      // on it, and each is proved to end in it below. A module under this contract also names the constant that
      // keeps model text off the page (a route reaches it through requestInsights).
      if (entry.contract === "ai") {
        expect(read(path), path).toMatch(/\b(validateInsightClaims|acceptClaims|requestInsights)\(/);
        if (path.startsWith("lib/")) expect(read(path), path).toMatch(/MODEL_FREE_TEXT_RENDERED/);
      }
      expect(entry.why.length).toBeGreaterThan(10);
    }
  });
});

describe("PR 2: every spelling of the check ends in signalUsable, with the register's CURRENT status", () => {
  it("the helpers are built on signalUsable and on nothing else", () => {
    const src = read("lib/demand-signals/sources-shared.ts");
    const body = (name: string) => { const at = src.indexOf(`export function ${name}`); return src.slice(at, src.indexOf("\n}\n", at)); };
    expect(body("usableNow")).toContain("return signalUsable(currentStatuses(states, sourceIds), use);");
    expect(body("collectDecision")).toContain('usableNow(states, [sourceId], "collect")');
    expect(body("keepUsable")).toContain("usableNow(states, [row.sourceId], use)");
    const store = read("lib/demand-signals/signal-store.ts");
    const precheck = store.slice(store.indexOf("export async function collectionPrecheck"), store.indexOf("/** Mark a source"));
    expect(precheck).toContain("readSourceStates(sb");
    expect(precheck).toContain("collectDecision(states, NWS_SOURCE_ID, NWS_DEFINITION.hash)");
  });
  it("each use point reads the register itself: no status is passed in from an earlier step", () => {
    const store = read("lib/demand-signals/signal-store.ts");
    for (const reader of ["loadUsableWeather", "loadUsableDayEvents"]) {
      const at = store.indexOf(`export async function ${reader}`), body = store.slice(at, store.indexOf("\n}\n", at));
      expect(body.indexOf("await readSourceStates(sb, signal)"), reader).toBeGreaterThan(-1);
      expect(body, reader).toContain("return keepUsable(mapped, states, args.use);");
      expect(body.match(/\bstates\b/g)!.length, reader).toBe(2);
    }
    const collect = read("lib/demand-signals/collect.ts");
    expect(collect).toContain("const gate = async () => collectDecision(await within((s) => deps.loadSourceStates(s)), NWS_SOURCE_ID, NWS_DEFINITION.hash);");
    expect(collect.match(/await gate\(\)/g)!.length).toBe(2);              // before anything, and before each shop
    expect(collect.indexOf("await gate()")).toBeLessThan(collect.indexOf("deps.getJson("));
    // persisted rows carry their source ids, so a later consumer can ask the register about them
    expect(store).toContain("sourceIds: [String(r.source_id)]");
  });
  it("in SQL the same question is asked inside every write and every read of a sourced row", () => {
    const sql = read("supabase/migrations/0343_demand_signal_sources.sql");
    const fn = (name: string) => { const at = sql.indexOf(`create function public.${name}(`); return sql.slice(at, sql.indexOf("end $$;", at)); };
    for (const writer of ["demand_weather_ingest", "demand_events_ingest"]) {
      const body = fn(writer);
      expect(body.indexOf("v_seq := public.demand_source_gate(p_source_id, p_definition_hash);"), writer).toBeGreaterThan(-1);
      expect(body.indexOf("public.demand_source_gate("), writer).toBeLessThan(body.indexOf("insert into"));
    }
    expect(fn("demand_usable_weather")).toContain("public.demand_source_status(w.source_id) = 'verified'");
    expect(fn("demand_usable_day_events")).toContain("public.demand_source_status(f.source_id) = 'verified'");
    expect(fn("demand_source_gate")).toContain("perform pg_advisory_xact_lock_shared(public.demand_source_key(p_source_id));");
    expect(fn("demand_source_mark")).toContain("perform pg_advisory_xact_lock(public.demand_source_key(p_source_id));");
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/delete from public\.demand_/);   // a revocation deletes nothing
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

describe("PR 7: every spelling of the check ends in validateInsightClaims, and model text has no way out", () => {
  const shared = read("lib/demand-signals/insights-shared.ts"), path = read("lib/demand-signals/insights.ts");
  const fn = (src: string, name: string) => { const at = src.indexOf(`export function ${name}`) >= 0 ? src.indexOf(`export function ${name}`) : src.indexOf(`export async function ${name}`); return src.slice(at, src.indexOf("\n}\n", at)); };
  it("acceptClaims validates against the facts that were sent and refuses to run if free text were ever turned on", () => {
    const body = fn(shared, "acceptClaims");
    expect(body).toContain('if (MODEL_FREE_TEXT_RENDERED) throw new Error("model_free_text_must_stay_off");');
    expect(body).toContain("validateInsightClaims(offered, facts.map((f) => ({ id: f.id, kind: f.kind })))");
    expect(shared.match(/validateInsightClaims\(/g)!.length).toBe(1);
  });
  it("requestInsights reserves before it asks, and the answer reaches storage only through parseModelClaims and acceptClaims", () => {
    const body = fn(path, "requestInsights");
    const at = (s: string) => { const i = body.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at("await deps.reserve(")).toBeLessThan(at("await deps.ask("));
    expect(at("await deps.ask(")).toBeLessThan(at("parseModelClaims(answer.text)"));
    expect(at("parseModelClaims(answer.text)")).toBeLessThan(at("acceptClaims(parsed, facts)"));
    expect(at("acceptClaims(parsed, facts)")).toBeLessThan(at('outcome: "ok"'));
    // The only use of the model's text is as the argument of the parser.
    expect(body.match(/answer\.text/g)!.length).toBe(1);
    expect(body).toContain("claims: accepted");
    expect(path).not.toMatch(/console\./);
  });
  it("no type of the layer has a field that could carry a sentence the model wrote", () => {
    for (const p of ["lib/demand-signals/insights-shared.ts", "lib/demand-signals/insights.ts", "lib/demand-signals/ai-store.ts"]) {
      expect(read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1"), p).not.toMatch(/\b(sentence|prose|summary|explanation|freeText|narrative)\s*[:?]/);
    }
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

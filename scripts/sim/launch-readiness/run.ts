import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { loadSimEnv } from "./env";
import { Evidence } from "./evidence";
import { acquire, assertHeld, release } from "./lease.mjs";
import { SIM_APP_ORIGIN, RUNNER_PRIVATE_KEYS } from "../../../lib/sim-isolation-shared";
import { SIM_LOCATIONS, SIM_PERSONAS } from "../personas-shared";
import * as driver from "../concurrency/driver.mjs";
import { resetFixture, assertClean } from "./reset";
import type { Catalog } from "./fixtures";
import { startProduction, buildReceiptPath, buildAssetsFromHtml, type BuildReceipt } from "./target";

export const SUITES = ["runner", "isolation", "personas", "fixtures", "opening"] as const;
export const FIXTURES = ["warm-history", "cold-empty", "incomplete-pack", "over-1000", "two-shop-divergent"] as const;
export function parseArgs(args: string[]) {
  let suite = "runner", fixture = "cold-empty", dev = false, noRestore = false, repeat = 1, restoreOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dev") dev = true;
    else if (arg === "--no-restore") noRestore = true;
    else if (arg === "--restore-only") { restoreOnly = true; const value = args[i + 1]; if (value && !value.startsWith("--")) { fixture = value; i++; } }
    else if (["--suite", "--fixture", "--repeat"].includes(arg ?? "")) {
      const value = args[++i]; if (!value || value.startsWith("--")) throw new Error("usage");
      if (arg === "--suite") suite = value;
      if (arg === "--fixture") fixture = value;
      if (arg === "--repeat") { if (!/^[1-9]\d*$/.test(value)) throw new Error("usage"); repeat = Number(value); }
    } else throw new Error("usage");
  }
  if (!(SUITES as readonly string[]).includes(suite) || !(FIXTURES as readonly string[]).includes(fixture) || !Number.isSafeInteger(repeat)) throw new Error("usage");
  if (noRestore && (suite !== "runner" || restoreOnly)) throw new Error("usage");
  if (suite === "opening" && fixture !== "cold-empty") throw new Error("usage");
  return { suite, fixture, dev, noRestore, repeat, restoreOnly };
}
export const restoreFixture = resetFixture;
async function portFree() {
  await new Promise<void>((ok, fail) => { const probe = net.createServer(); probe.once("error", () => fail(new Error("port occupied"))); probe.listen(3100, "localhost", () => probe.close(() => ok())); });
}
function launch(args: string[], env: Record<string, string | undefined>): ChildProcess {
  // LRA_DEBUG: inherit child stdio so startup failures are visible locally (never in evidence).
  return spawn(process.execPath, args, { cwd: process.cwd(), env: { ...env, NODE_ENV: env.NODE_ENV === "development" ? "development" : "production" }, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: process.env.LRA_DEBUG ? "inherit" : "ignore" });
}
async function stopped(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    // Argument arrays bypass Git Bash conversion: native /T is its //T spelling.
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
    if (result.error) throw new Error("child tree cleanup failed");
  } else { try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); } catch { /* checked below */ } }
    else throw new Error("child did not exit");
  }
}
async function waitReady(child: ChildProcess, cancelled: () => boolean) {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (cancelled() || child.exitCode !== null || child.signalCode !== null) throw new Error("server stopped before readiness");
    try { const response = await fetch(SIM_APP_ORIGIN, { redirect: "manual", signal: AbortSignal.timeout(1500) }); if (response.status === 200) return await response.text(); await response.body?.cancel(); } catch { /* bounded readiness polling */ }
    await delay(200);
  }
  throw new Error("server readiness timeout");
}
function verifyListener(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) throw new Error("server identity mismatch");
  if (process.platform === "win32") {
    // No `-p tcp`: on Windows that filter is IPv4-only and `-H localhost` binds `[::1]` (CC boot, 2026-09-09).
    const listeners = spawnSync("netstat.exe", ["-ano"], { encoding: "utf8", windowsHide: true });
    if (listeners.status !== 0) throw new Error("listener identity unavailable");
    const pids = listeners.stdout.split(/\r?\n/).filter(line => /(?:127\.0\.0\.1|\[::1\]):3100\s+\S+\s+LISTENING\s+\d+/.test(line)).map(line => Number(line.trim().split(/\s+/).at(-1)));
    if (!pids.length) throw new Error("listener identity missing");
    // Only numeric process IDs cross this PowerShell boundary. This is a
    // read-only ancestry query, never a shell-built process-kill command.
    const tree = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    if (tree.status !== 0) throw new Error("process ancestry unavailable");
    const parents = new Map<number, number>((JSON.parse(tree.stdout) as { ProcessId: number; ParentProcessId: number }[]).map(p => [p.ProcessId, p.ParentProcessId]));
    for (const pid of pids) {
      let current = pid; const seen = new Set<number>();
      while (current !== child.pid && !seen.has(current)) { seen.add(current); current = parents.get(current) ?? 0; }
      if (current !== child.pid) throw new Error("listener does not belong to runner child");
    }
  }
}
async function verifyProd(html: string, child: ChildProcess, receipt: BuildReceipt) {
  verifyListener(child);
  // App Router HTML carries NO buildId in its asset paths (chunks are content-hashed under /_next/static/chunks/),
  // so the HTML can only contradict the receipt, never prove it (CC prod boot, 2026-09-09). The proof is the served
  // build manifest under the receipt's buildId being byte-identical to the file this checkout just built.
  const assets = buildAssetsFromHtml(html);
  if (assets.some(asset => asset.buildId !== receipt.buildId)) throw new Error("production buildId asset identity mismatch");
  const response = await fetch(`${SIM_APP_ORIGIN}/_next/static/${receipt.buildId}/_buildManifest.js`, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error("production buildId manifest unavailable"); }
  const served = Buffer.from(await response.arrayBuffer());
  const onDisk = readFileSync(resolve(".next-sim-launch/static", receipt.buildId, "_buildManifest.js"));
  if (!served.equals(onDisk)) throw new Error("production buildId asset identity mismatch");
  return receipt.buildId;
}
async function verifyDev(html: string, child: ChildProcess, started: number) {
  verifyListener(child);
  const asset = [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(m => m[1]!).find(s => s.includes(".js"));
  if (!asset) throw new Error("dev asset identity missing");
  const url = new URL(asset.replaceAll("&amp;", "&"), SIM_APP_ORIGIN);
  if (url.origin !== SIM_APP_ORIGIN) throw new Error("dev asset origin mismatch");
  const file = resolve(".next-sim-launch/dev", decodeURIComponent(url.pathname.slice("/_next/".length)));
  const { statSync } = await import("node:fs");
  // Dev identity = listener ancestry (above) + byte equality of a served chunk with the file on disk.
  // No mtime freshness rule: Turbopack legitimately reuses cached chunks across dev boots (CC boot, 2026-09-09);
  // the F5 production target carries a BUILD_ID receipt instead. `started` stays for the manifest.
  void started;
  if (!file.startsWith(resolve(".next-sim-launch/dev/static") + requireSeparator()) || !statSync(file).isFile()) throw new Error("stale dev asset");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  const served = Buffer.from(await response.arrayBuffer());
  if (!response.ok || !served.equals(readFileSync(file))) throw new Error("dev asset identity mismatch");
  return `dev:${createHash("sha256").update(served).digest("hex")}`;
}
function requireSeparator() { return process.platform === "win32" ? "\\" : "/"; }

export async function main(args = process.argv.slice(2)) {
  const runId = randomUUID();
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(args); } catch { const e = new Evidence(runId, "invalid"); e.manifest.reason = "usage: --suite runner|isolation|personas|fixtures|opening --fixture <known-id> [--dev] [--no-restore] [--repeat N] or --restore-only <known-id>; opening requires cold-empty"; e.finalize([]); return 2; }
  const evidence = new Evidence(runId, options.fixture);
  let held = false, server: ChildProcess | undefined, playwright: ChildProcess | undefined, interrupted = false, stage = "lease", configFile: string | undefined;
  const signal = () => { interrupted = true; void stopped(playwright).catch(() => {}); void stopped(server).catch(() => {}); };
  process.on("SIGINT", signal); process.on("SIGTERM", signal);
  const privateDir = resolve("scripts/sim/launch-readiness/.private", runId);
  const openingArtifacts: string[] = [];
  try {
    acquire({ runId }); held = true;
    // Exercise the actual CLI while we hold the lease, BEFORE config or DB work.
    const contender = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/sim/launch-readiness/run.ts"), "--suite", "runner", "--no-restore", "--dev"], { env: process.env, shell: false, windowsHide: true, encoding: "utf8", timeout: 15_000 });
    if (contender.status !== 2 || !contender.stdout.includes(`owned by ${runId}`)) throw new Error("second runner was not refused by this lease");
    evidence.manifest.identity.secondRunnerRefused = true;
    stage = "environment";
    // F1 remains authoritative for autoload filenames and unknown keys. Only
    // the closed, runner-owned PIN controls are extracted to a private copy.
    const initial = loadSimEnv(process.cwd());
    if (!initial.ok) throw new Error("sim environment blocked");
    const parsed = parseEnv(readFileSync(resolve(".env.sim"), "utf8"));
    const pins: Record<string, string> = {};
    for (const key of RUNNER_PRIVATE_KEYS) {
      const pin = parsed[key] ?? process.env[key];
      if (pin !== undefined) { if (!/^\d{4}$/.test(pin)) throw new Error("invalid private PIN control"); pins[key] = pin; }
      delete parsed[key];
    }
    mkdirSync(privateDir, { recursive: true });
    configFile = resolve(privateDir, ".env.sim");
    writeFileSync(configFile, Object.entries(parsed).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
    const loaded = loadSimEnv(privateDir); if (!loaded.ok) throw new Error("sim environment blocked");
    const startServer = async () => {
      stage = "server";
      assertClean(); await portFree(); assertHeld(runId);
      const started = Date.now();
      let receipt: BuildReceipt | undefined;
      if (options.dev) {
        server = launch(["node_modules/next/dist/bin/next", "dev", "-p", "3100", "-H", "localhost"], { ...loaded.env, NODE_ENV: "development", SIM_PHASE: "build", LRA_RUN_ID: runId });
      } else {
        const production = startProduction({ env: { ...loaded.env, LRA_RUN_ID: runId }, receiptPath: buildReceiptPath });
        server = production.child; receipt = production.receipt;
      }
      let failed = false; server.once("error", () => { failed = true; });
      const html = await waitReady(server, () => interrupted || failed);
      stage = "identity";
      await driver.init({ root: privateDir, assertLease: () => assertHeld(runId), verifyServer: async () => {
        evidence.manifest.buildId = receipt ? await verifyProd(html, server!, receipt) : await verifyDev(html, server!, started);
        evidence.manifest.identity.server = true;
      } });
    };
    const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8", windowsHide: true });
    const sha = git(["rev-parse", "HEAD"]), dirty = git(["status", "--porcelain"]);
    if (sha.status !== 0 || dirty.status !== 0) throw new Error("candidate identity unavailable");
    evidence.manifest.candidateSha = sha.stdout.trim(); evidence.manifest.dirty = dirty.stdout.trim().length > 0;
    evidence.manifest.dependencyLockHash = createHash("sha256").update(readFileSync("package-lock.json")).digest("hex");
    evidence.manifest.personas = SIM_PERSONAS.map(p => ({ alias: p.email.split("@")[0]!, role: p.role, level: p.level, language: p.language, locationCodes: [...p.locations] }));
    stage = "fixture";
    const restore = async (fixtureId: string) => {
      const receipt = await restoreFixture({ runId, fixtureId, env: loaded.env, schemaDigest: process.env.LRA_SCHEMA_DIGEST ?? "" });
      evidence.manifest.fixture = { id: fixtureId, restore: "done" };
      return receipt;
    };
    if (options.restoreOnly) {
      const receipt = await restore(options.fixture);
      console.log(`Fixture ${options.fixture}: ${receipt.fingerprint}`);
      evidence.manifest.status = "pass"; evidence.manifest.reason = "fixture restored and verified; app not started";
    } else if (options.suite === "fixtures") {
      const { runFixtureContracts } = await import("./contracts/fixtures.spec");
      const catalog = JSON.parse(readFileSync(resolve("scripts/sim/launch-readiness/fixtures/manifest.json"), "utf8")) as Catalog;
      const results = await runFixtureContracts(catalog.recipes, {
        restore,
        start: startServer,
        stop: async () => { await stopped(server); await portFree(); server = undefined; },
      }, pins.SIM_PIN_ROSA ?? "");
      evidence.write("results.json", { status: "pass", tests: results });
      evidence.manifest.status = "pass"; evidence.manifest.reason = "fixture Node contracts passed";
    } else if (options.suite === "opening") {
      // Today's opening is a singleton per shop. Every Node pass and viewport
      // must start from cold-empty under this SAME lease, with the app stopped.
      const { runOpeningContracts } = await import("./contracts/opening.spec");
      const nodeResults: Awaited<ReturnType<typeof runOpeningContracts>> = [];
      const slices: { project: string; attempt: number; status: string; report: string }[] = [];
      let failed = false;
      const stopOpening = async () => { await stopped(server); await portFree(); server = undefined; };
      for (let attempt = 1; attempt <= options.repeat && !interrupted; attempt++) {
        await restore("cold-empty"); await startServer();
        stage = "identity";
        evidence.manifest.identity.locations = true; evidence.manifest.identity.personas = true;
        const results = await runOpeningContracts(pins);
        nodeResults.push(...results);
        for (const result of results) {
          evidence.manifest.tests.push({ ...result, id: `${result.id}-${attempt}`, viewport: null, project: "node-opening", attempt });
          failed ||= result.status !== "passed";
        }
        evidence.write("opening-contracts.json", nodeResults);
        await stopOpening();
        // LRA_PROJECTS (comma list) narrows the viewport slices for local iteration; release evidence runs all four.
        const allProjects = ["phone-en", "phone-es", "tablet-en", "tablet-es"];
        const wanted = (process.env.LRA_PROJECTS ?? "").split(",").map(s => s.trim()).filter(Boolean);
        const projects = wanted.length ? allProjects.filter(p => wanted.includes(p)) : allProjects;
        if (wanted.length) evidence.manifest.reason = "partial viewport matrix (LRA_PROJECTS) — not release evidence";
        for (const project of projects) {
          if (interrupted) break;
          stage = "fixture";
          await restore("cold-empty"); await startServer();
          evidence.write("manifest.json", evidence.manifest);
          stage = "playwright";
          const slice = `${project}-${attempt}`;
          playwright = launch(["node_modules/@playwright/test/cli.js", "test", "--config", "scripts/sim/launch-readiness/playwright.config.ts", `--project=${project}`], { ...loaded.env, ...pins, LRA_DEV: options.dev ? "1" : "0", LRA_RUN_ID: runId, LRA_SUITE: "opening", LRA_FIXTURE: "cold-empty", LRA_CONFIG_ROOT: privateDir, LRA_OPENING_SLICE: slice });
          const code = await new Promise<number | null>((ok, fail) => { playwright!.once("error", fail); playwright!.once("exit", ok); });
          failed ||= code !== 0;
          const report = `opening/${slice}/results.json`, html = `opening/${slice}/html/index.html`;
          openingArtifacts.push(report, html);
          slices.push({ project, attempt, status: code === 0 ? "passed" : "failed", report });
          await stopped(playwright); playwright = undefined;
          await stopOpening();
        }
      }
      openingArtifacts.push("opening-contracts.json");
      evidence.write("results.json", { node: nodeResults, browser: slices });
      mkdirSync(resolve(evidence.directory, "html"), { recursive: true });
      writeFileSync(resolve(evidence.directory, "html/index.html"), `<!doctype html><title>Opening contracts</title><p>See manifest.json for assertion IDs and opening-contracts.json for Node results.</p><ul>${slices.map(s => `<li><a href="../opening/${s.project}-${s.attempt}/html/index.html">${s.project} attempt ${s.attempt}: ${s.status}</a></li>`).join("")}</ul>`);
      evidence.manifest.status = failed || interrupted ? "fail" : "pass";
      evidence.manifest.reason = interrupted ? "interrupted" : failed ? "opening findings; inspect failedAssertionIds in manifest" : options.dev ? "opening passed (development mode; not release evidence)" : "opening contracts passed";
    } else {
      if (!options.noRestore) await restore(options.fixture);
      assertClean();
      stage = "server";
      await startServer();
      stage = "identity";
      // init itself validates both locations and all nine identities. Re-read via
      // its now-initialized, SELECT-only oracle before allowing any browser login.
      const { data } = await driver.db.from("locations").select("id,code,name").order("code");
      const expectedLocations = Object.values(SIM_LOCATIONS);
      if (!Array.isArray(data) || data.length !== expectedLocations.length || !expectedLocations.every(loc => data.some((row: { id: string; code: string; name: string }) => row.id === loc.id && row.code === loc.code && row.name === loc.name))) throw new Error("location identity mismatch");
      evidence.manifest.identity.locations = true; evidence.manifest.identity.personas = true;
      evidence.write("manifest.json", evidence.manifest);
      stage = "playwright";
      playwright = launch(["node_modules/@playwright/test/cli.js", "test", "--config", "scripts/sim/launch-readiness/playwright.config.ts", `--repeat-each=${options.repeat}`], { ...loaded.env, ...pins, LRA_DEV: options.dev ? "1" : "0", LRA_RUN_ID: runId, LRA_SUITE: options.suite, LRA_FIXTURE: options.fixture, LRA_CONFIG_ROOT: privateDir });
      const code = await new Promise<number | null>((ok, fail) => { playwright!.once("error", fail); playwright!.once("exit", ok); });
      evidence.manifest.status = code === 0 && !interrupted ? "pass" : "fail"; evidence.manifest.reason = interrupted ? "interrupted" : code === 0 ? options.dev ? "contracts passed (development mode; not release evidence)" : "production contracts passed" : "Playwright failed";
    }
  } catch (error) {
    evidence.manifest.status = stage === "playwright" || stage === "identity" ? "fail" : "blocked";
    evidence.manifest.reason = stage === "fixture" ? "fixture reset/contract blocked; inspect fixtures/manifest.json and DIRTY marker" : `${stage} ${interrupted ? "interrupted" : "failed or blocked"}`;
    if (stage === "lease" && error instanceof Error) {
      const owner = error.message.match(/owned by ([a-zA-Z0-9-]+)/)?.[1];
      if (owner) evidence.manifest.reason = `lease refused: owned by ${owner}`;
    }
    const safeReasons = new Set(["sim environment blocked", "invalid private PIN control", "candidate identity unavailable", "port occupied", "server readiness timeout", "server stopped before readiness", "dev asset identity missing", "dev asset origin mismatch", "stale dev asset", "dev asset identity mismatch", "listener identity unavailable", "listener identity missing", "process ancestry unavailable", "listener does not belong to runner child", "location identity mismatch", "second runner was not refused by this lease"]);
    if (error instanceof Error && safeReasons.has(error.message)) evidence.manifest.reason = error.message;
    if (error instanceof Error && (/^build receipt mismatch: (candidateSha|dirty|lockfileSha256|policyVersion|publicConfigDigest|buildId|builtAt|nodeVersion|nextVersion|receipt)$/.test(error.message) || ["production buildId asset identity mismatch", "production buildId manifest unavailable"].includes(error.message))) evidence.manifest.reason = error.message;
    // Local diagnostics only: the raw message goes to stderr, never into evidence (CC, 2026-09-09).
    if (process.env.LRA_DEBUG) console.error(`[lra debug] stage=${stage}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try { await stopped(playwright); await stopped(server); if (server) await portFree(); }
    catch { evidence.manifest.status = "fail"; evidence.manifest.reason = "child cleanup or port release failed"; }
    try {
      const fragments = existsSync(resolve(privateDir, "projections")) ? readdirSync(resolve(privateDir, "projections")) : [];
      const network: unknown[] = [], consoleProjection: unknown[] = [], shots: string[] = [];
      for (const file of fragments) {
        const part = JSON.parse(readFileSync(resolve(privateDir, "projections", file), "utf8"));
        evidence.manifest.tests.push(part.test); network.push(...part.network); consoleProjection.push(...part.console); shots.push(...part.shots);
        evidence.manifest.expectedDenials += part.expectedDenials;
        for (const [key, count] of Object.entries(part.denied)) evidence.manifest.deniedDestinations[key] = (evidence.manifest.deniedDestinations[key] ?? 0) + Number(count);
      }
      if (stage === "playwright" && !evidence.manifest.tests.length) { evidence.manifest.status = "fail"; evidence.manifest.reason = "no test evidence"; }
      evidence.write("network.json", network); evidence.write("console.json", consoleProjection);
      evidence.write("claims.json", JSON.parse(readFileSync(resolve("scripts/sim/launch-readiness/claims.json"), "utf8")));
      if (!existsSync(resolve(evidence.directory, "results.json"))) {
        if (stage === "playwright") { evidence.manifest.status = "fail"; evidence.manifest.reason = "missing Playwright JSON report"; }
        evidence.write("results.json", { status: evidence.manifest.status, tests: [] });
      }
      if (!existsSync(resolve(evidence.directory, "html/index.html"))) {
        if (stage === "playwright") { evidence.manifest.status = "fail"; evidence.manifest.reason = "missing Playwright HTML report"; }
        mkdirSync(resolve(evidence.directory, "html"), { recursive: true }); writeFileSync(resolve(evidence.directory, "html/index.html"), "<!doctype html><title>Blocked runner</title><p>No browser results. See manifest.json.</p>");
      }
      evidence.finalize(["results.json", "html/index.html", "network.json", "console.json", "claims.json", ...openingArtifacts, ...shots]);
    } finally {
      try {
        if (configFile && existsSync(configFile)) unlinkSync(configFile);
      } catch {
        evidence.manifest.status = "fail"; evidence.manifest.reason = "private config cleanup failed";
        evidence.write("manifest.json", evidence.manifest);
      } finally {
        try {
          if (held) release(runId);
        } catch {
          evidence.manifest.status = "fail"; evidence.manifest.reason = "lease release failed";
          evidence.write("manifest.json", evidence.manifest);
        } finally { process.off("SIGINT", signal); process.off("SIGTERM", signal); }
      }
    }
  }
  console.log(`LRA ${runId}: ${evidence.manifest.status}; ${evidence.manifest.reason}`);
  return evidence.manifest.status === "pass" ? 0 : evidence.manifest.status === "blocked" ? 2 : 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main().then(code => { process.exitCode = code; }).catch(() => { console.error("Runner finalization failed"); process.exitCode = 1; });

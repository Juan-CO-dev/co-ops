/** SIM ONLY. Explicit .env.sim, shared preflight, localhost:3100.
 * Run: node scripts/sim/dev-sim.mjs
 * The concurrency drivers keep the same file, port and JWT scheme.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Re-exec under the FULL tsx loader: tsx's `tsImport` API resolves only the file it is handed and
// not that file's own TS imports (ERR_MODULE_NOT_FOUND on lib/sim-isolation-shared, 2026-09-09).
if (!process.env.SIM_LAUNCHER_TSX) {
  const r = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit", env: { ...process.env, SIM_LAUNCHER_TSX: "1" },
  });
  process.exit(r.status ?? 1);
}
const { loadSimEnv } = await import("./launch-readiness/env.ts");
const root = fileURLToPath(new URL("../../", import.meta.url));
const result = loadSimEnv(root);
if (!result.ok) {
  console.error(`REFUSING: ${result.reasons.join("; ")}`);
  process.exit(1);
}
// Dev compiles on demand, so next/font fetches happen at request time here: phase "build"
// keeps the documented fonts exception open in dev. Release evidence uses the F5 production target.
const env = { ...result.env, NODE_ENV: "development", SIM_PHASE: "build" };
// The Node-side network guard is installed by `instrumentation.ts` (Next's server-init hook)
// whenever SIM_MODE is set — NOT via NODE_OPTIONS: a tsx loader preload makes `next dev`
// (Turbopack) hang silently before it ever listens (probed 2026-09-09, CC F1 review).
delete env.NODE_OPTIONS;
const child = spawn(process.execPath, [fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url)), "dev", "-p", "3100", "-H", "localhost"], {
  cwd: root, env, stdio: "inherit", shell: false,
});
child.on("error", () => { console.error("Sim dev process could not start"); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

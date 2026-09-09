/** SIM ONLY. Explicit .env.sim, shared preflight, localhost:3100.
 * Run: node scripts/sim/dev-sim.mjs
 * The concurrency drivers keep the same file, port and JWT scheme.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const { loadSimEnv } = await tsImport("./launch-readiness/env.ts", import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const result = loadSimEnv(root);
if (!result.ok) {
  console.error(`REFUSING: ${result.reasons.join("; ")}`);
  process.exit(1);
}
// Dev compiles on demand, so next/font fetches happen at request time here: phase "build"
// keeps the documented fonts exception open in dev. Release evidence uses the F5 production target.
const env = { ...result.env, NODE_ENV: "development", SIM_PHASE: "build" };
// Propagate the preload into Next workers. The wrapper owns NODE_OPTIONS;
// CC's inheritance simplification otherwise stays intact.
const tsx = import.meta.resolve("tsx");
const guard = new URL("./launch-readiness/network.ts", import.meta.url).href;
env.NODE_OPTIONS = `--import=${tsx} --import=${guard}`;
const child = spawn(process.execPath, [fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url)), "dev", "-p", "3100", "-H", "localhost"], {
  cwd: root, env, stdio: "inherit", shell: false,
});
child.on("error", () => { console.error("Sim dev process could not start"); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

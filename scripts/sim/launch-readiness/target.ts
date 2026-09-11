import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSimEnv } from "./env";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { acquire, assertHeld, release } from "./lease.mjs";
import { SIM_APP_ORIGIN } from "../../../lib/sim-isolation-shared";

type Env = Record<string, string | undefined>;
// Pure helpers live in build-identity.ts (no import.meta) so Playwright specs can import them.
import { hash, publicConfigDigest, validateBuildReceipt, buildAssetsFromHtml, type BuildReceipt, type BuildIdentity } from "./build-identity";
export { publicConfigDigest, validateBuildReceipt, buildAssetsFromHtml, type BuildReceipt, type BuildIdentity };
const checkoutRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const buildReceiptPath = resolve(checkoutRoot, ".next-sim-launch/lra-build-receipt.json");

function readBuildId(root: string): string {
  try { return readFileSync(resolve(root, ".next-sim-launch/BUILD_ID"), "utf8").trim(); }
  catch { throw new Error("build receipt mismatch: buildId"); }
}
function identity(root: string, env: Env, policyVersion: string, buildId = readBuildId(root)): BuildIdentity {
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, windowsHide: true });
    if (result.status !== 0) throw new Error("candidate identity unavailable");
    return result.stdout.trim();
  };
  return {
    candidateSha: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]).length > 0,
    lockfileSha256: hash(readFileSync(resolve(root, "package-lock.json"))), policyVersion,
    publicConfigDigest: publicConfigDigest(env), buildId,
    nodeVersion: process.version, nextVersion: (JSON.parse(readFileSync(resolve(root, "node_modules/next/package.json"), "utf8")) as { version: string }).version,
  };
}

/** Runner owns the shared lease and supplies its already-validated environment. */
export function startProduction({ env, receiptPath }: { env: Env; receiptPath: string }) {
  const owner = assertHeld(env.LRA_RUN_ID ?? "");
  if (owner.pid !== process.pid) throw new Error("Only the parent lease owner may start");
  const loaded = loadSimEnv(checkoutRoot);
  if (!loaded.ok) throw new Error(loaded.reasons.join("\n"));
  if (publicConfigDigest(env) !== publicConfigDigest(loaded.env)) throw new Error("build receipt mismatch: publicConfigDigest");
  let stored: unknown;
  try { stored = JSON.parse(readFileSync(receiptPath, "utf8")); }
  catch { throw new Error("build receipt mismatch: receipt"); }
  const receipt = validateBuildReceipt(stored, identity(checkoutRoot, env, loaded.target.policyVersion));
  const child = spawn(process.execPath, [resolve(checkoutRoot, "node_modules/next/dist/bin/next"), "start", "-p", "3100", "-H", "localhost"], {
    cwd: checkoutRoot, env: { ...env, NODE_ENV: "production", SIM_MODE: "1", SIM_PHASE: "runtime" },
    shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: "ignore",
  });
  return { child, receipt };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [command, root] = args;
  if (command === "start") { console.error("use run.ts"); return 2; }
  if (command === "build" && args.length === 1) {
    const loaded = loadSimEnv(checkoutRoot);
    if (!loaded.ok) { console.error(loaded.reasons.join("\n")); return 2; }
    const runId = randomUUID(); let held = false;
    try {
      acquire({ runId }); held = true;
      // An unsuccessful rebuild cannot leave a previously valid receipt behind.
      if (existsSync(buildReceiptPath)) unlinkSync(buildReceiptPath);
      const before = identity(checkoutRoot, loaded.env, loaded.target.policyVersion, "pending");
      const child = spawn(process.execPath, [resolve(checkoutRoot, "node_modules/next/dist/bin/next"), "build"], {
        cwd: checkoutRoot, env: { ...loaded.env, NODE_ENV: "production", SIM_MODE: "1", SIM_PHASE: "build" },
        shell: false, windowsHide: true, stdio: "inherit", detached: process.platform !== "win32",
      });
      let interrupted = false;
      const stop = () => {
        interrupted = true;
        if (!child.pid) return;
        if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else { try { process.kill(-child.pid, "SIGTERM"); } catch { /* close still awaited below */ } }
      };
      process.on("SIGINT", stop); process.on("SIGTERM", stop);
      let code: number | null;
      try { code = await new Promise<number | null>((ok, fail) => { child.once("error", fail); child.once("close", ok); }); }
      finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
      if (code !== 0 || interrupted) return 1;
      assertHeld(runId);
      const expected = identity(checkoutRoot, loaded.env, loaded.target.policyVersion);
      validateBuildReceipt({ ...before, buildId: expected.buildId, builtAt: new Date().toISOString() }, expected);
      const receipt = validateBuildReceipt({ ...expected, builtAt: new Date().toISOString() }, expected);
      const bytes = JSON.stringify(receipt, null, 2) + "\n";
      writeFileSync(buildReceiptPath, bytes);
      if (readFileSync(buildReceiptPath, "utf8") !== bytes) throw new Error("build receipt readback failed");
      console.log("Sim production build receipt written.");
      return 0;
    } catch { console.error("Sim production build failed or blocked; no verified receipt."); return 2; }
    finally { if (held) release(runId); }
  }
  if (command !== "check" || args.length > 2) { console.error("Usage: target.ts check [checkout-root] | build; use run.ts to start"); return 2; }
  const result = loadSimEnv(root ? resolve(root) : fileURLToPath(new URL("../../../", import.meta.url)));
  if (!result.ok) { console.error(result.reasons.join("\n")); return 1; }
  console.log("Sim isolation: fixed app, DB and derived storage origins validated; explicit config valid; provider legs disabled.");
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main().then(code => { process.exitCode = code; }).catch(() => { console.error("Sim target failed"); process.exitCode = 2; });

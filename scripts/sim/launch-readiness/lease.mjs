import { mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hostname } from "node:os";

export const DEFAULT_LEASE_DIR = "C:/Users/conta/co-ops-assets/lra-sim-lease/";
export const leaseDirectory = () => resolve(process.env.LRA_LEASE_DIR || DEFAULT_LEASE_DIR);

/** EPERM means an existing process we cannot signal, never a stale lease. */
export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

/** Pure owner classification; malformed/in-progress records fail closed. */
export function classifyOwner(owner, isAlive, host = hostname()) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.runId !== "string" || !owner.runId ||
      typeof owner.startedAt !== "string" || !Number.isFinite(Date.parse(owner.startedAt)) ||
      owner.host !== host) return "unknown";
  return isAlive(owner.pid) ? "held" : "stale";
}

function readOwner(dir) {
  try { return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); }
  catch { return undefined; }
}
function refused(owner) {
  return new Error(`Lease refused: owned by ${owner?.runId ?? "unknown (owner record incomplete)"}`);
}

/** All paths are explicit for tests; production callers use the shared host dir.
 * @param {{runId: string, dir?: string, log?: (message: string) => void}} options
 */
export function acquire({ runId, dir = leaseDirectory(), log = console.error }) {
  if (typeof runId !== "string" || !runId.trim()) throw new Error("Lease requires runId");
  dir = resolve(dir);
  mkdirSync(dirname(dir), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { mkdirSync(dir); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = readOwner(dir);
      if (classifyOwner(owner, pidAlive) !== "stale") throw refused(owner);
      // Serialize stale cleanup inside the old directory. A contender seeing a
      // partially written owner or cleanup in progress refuses without mutation.
      const reclaim = join(dir, "reclaim");
      try { writeFileSync(reclaim, String(process.pid), { flag: "wx" }); }
      catch { throw refused(readOwner(dir)); }
      const current = readOwner(dir);
      if (JSON.stringify(current) !== JSON.stringify(owner) || classifyOwner(current, pidAlive) !== "stale") {
        unlinkSync(reclaim);
        throw refused(current);
      }
      log(`clearing stale lease from ${owner.runId}`);
      rmSync(dir, { recursive: true });
      continue;
    }
    const owner = { pid: process.pid, startedAt: new Date().toISOString(), runId, host: hostname() };
    try {
      writeFileSync(join(dir, "owner.json"), JSON.stringify(owner), { flag: "wx" });
      assertHeld(runId, { dir });
      return owner;
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }
  throw refused(readOwner(dir));
}

/** Workers may assert their living parent runner's runId without owning its PID. */
export function assertHeld(runId, { dir = leaseDirectory() } = {}) {
  const owner = readOwner(dir);
  if (!owner || owner.runId !== runId || classifyOwner(owner, pidAlive) !== "held") throw refused(owner);
  return owner;
}

export function release(runId, { dir = leaseDirectory() } = {}) {
  const owner = readOwner(dir);
  if (!owner || owner.runId !== runId) throw refused(owner);
  rmSync(dir, { recursive: true });
}

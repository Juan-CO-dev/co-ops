import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { buildChildEnv, parseAllowedTarget, validateSimEnvFile, type SimTarget } from "../../../lib/sim-isolation-shared";

export type ChildEnvResult = { ok: true; env: Record<string, string>; target: SimTarget } | { ok: false; reasons: string[] };
const AUTOLOAD_FILES = [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"];

export function loadSimEnv(root: string): ChildEnvResult {
  const reasons: string[] = [];
  for (const name of AUTOLOAD_FILES) {
    try {
      lstatSync(resolve(root, name)); // Filename only; also rejects dangling symlinks.
      reasons.push(`${name}: Next autoload file forbidden`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") reasons.push(`${name}: cannot check filename`);
    }
  }
  if (reasons.length) return { ok: false, reasons };
  let parsed: Record<string, string>;
  try {
    const values = parseEnv(readFileSync(resolve(root, ".env.sim"), "utf8"));
    parsed = {};
    for (const [key, value] of Object.entries(values)) if (value !== undefined) parsed[key] = value;
  }
  catch { return { ok: false, reasons: [".env.sim: missing or unreadable"] }; }
  const validation = validateSimEnvFile(parsed);
  if (!validation.ok) return validation;
  const target = parseAllowedTarget(parsed);
  if (!target.ok) return target;
  return { ok: true, env: buildChildEnv(process.env, parsed), target: target.target };
}

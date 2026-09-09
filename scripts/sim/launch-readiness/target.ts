import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSimEnv } from "./env";

export function main(args = process.argv.slice(2)): number {
  const [command, root] = args;
  if (command === "build" || command === "start") { console.error("F5"); return 2; }
  if (command !== "check" || args.length > 2) { console.error("Usage: target.ts check [checkout-root]"); return 2; }
  const result = loadSimEnv(root ? resolve(root) : fileURLToPath(new URL("../../../", import.meta.url)));
  if (!result.ok) { console.error(result.reasons.join("\n")); return 1; }
  console.log("Sim isolation: fixed app, DB and derived storage origins validated; explicit config valid; provider legs disabled.");
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();

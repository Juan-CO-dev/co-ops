/** Offline: npx tsx scripts/vendor-exports/normalize.ts */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Adapter, ExportRow } from "./model";
import { pfg } from "./adapters/pfg";
import { usfoods } from "./adapters/usfoods";
import { receipts } from "./adapters/receipts";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const EXPORT_ROOT = join(ROOT, "docs/seed/source/vendor-exports");
export const adapters: readonly Adapter[] = [pfg, usfoods, receipts];

export function normalizeText(vendor: string, text: string, sourceFile: string): ExportRow[] {
  const matches = adapters.filter(a => a.vendor === vendor && a.detects(text));
  if (matches.length !== 1) throw new Error(`${sourceFile}: expected one adapter for ${vendor}, found ${matches.length}`);
  return matches[0]!.parse(text, sourceFile);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    if (e.isSymbolicLink()) throw new Error(`Symlinks are not inputs: ${join(dir, e.name)}`);
    return e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)];
  });
}

export function normalizeAll(root = EXPORT_ROOT): { output: string; rows: ExportRow[] }[] {
  const outputs: { output: string; rows: ExportRow[] }[] = [];
  const names = new Set<string>();
  for (const folder of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (["normalized", "reports", "context"].includes(folder.name) || !folder.isDirectory()) continue;
    for (const file of filesUnder(join(root, folder.name))) {
      if (basename(file) === "README.md") continue; // Documented capture metadata, never a data export.
      const stem = relative(join(root, folder.name), file).replaceAll("\\", "/").slice(0, -extname(file).length).replaceAll("/", "--");
      const output = `${folder.name}-${stem}.json`;
      if (names.has(output)) throw new Error(`Output collision: ${output}`);
      names.add(output);
      outputs.push({ output, rows: normalizeText(folder.name, readFileSync(file, "utf8"), relative(ROOT, file).replaceAll("\\", "/")) });
    }
  }
  // Validate every input before writing any output. No clocks: identical input => identical bytes.
  mkdirSync(join(root, "normalized"), { recursive: true });
  for (const { output, rows } of outputs) {
    const destination = join(root, "normalized", output);
    const json = JSON.stringify(rows, null, 2) + "\n";
    writeFileSync(destination, json);
    if (readFileSync(destination, "utf8") !== json) throw new Error(`Readback failed: ${destination}`);
  }
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const result of normalizeAll()) console.log(`${basename(result.output)}: ${result.rows.length} rows`);
}

/** Run after next build: NFT paths are relative to the trace, not the project. */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
const dist = path.join(root, "vendor/co-scenes/dist");
const trace = path.join(root, ".next/server/app/api/training/co-scenes/[...path]/route.js.nft.json");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");

try {
  const manifest = JSON.parse(readFileSync(path.join(dist, "asset-manifest.json"), "utf8"));
  const nft = JSON.parse(readFileSync(trace, "utf8"));
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)
    || !Object.keys(manifest.files).length) throw new Error("Empty or invalid manifest.files");
  if (!Array.isArray(nft.files) || !nft.files.every((file) => typeof file === "string")) {
    throw new Error("Invalid NFT files list");
  }
  const traced = new Set(nft.files.map((file) => path.resolve(path.dirname(trace), file)));
  const errors = [];
  for (const name of ["asset-manifest.json", ...Object.keys(manifest.files)]) {
    const file = path.resolve(dist, name);
    if (!file.startsWith(dist + path.sep)) throw new Error("Asset outside dist");
    if (!traced.has(file)) errors.push(`Missing traced asset: ${relative(file)}`);
  }
  const media = path.join(root, "vendor/co-scenes/photos");
  for (const file of traced) {
    if (file === media || file.startsWith(media + path.sep)) errors.push(`Ignored media traced: ${relative(file)}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Training trace passed: ${Object.keys(manifest.files).length} manifest assets and manifest included; no ignored media.`);
} catch (error) {
  console.error(`Training trace check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

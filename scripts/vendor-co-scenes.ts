/**
 * Vendor the co-scenes web bundle (the <crunchy-build> element) into the app.
 *
 * co-scenes publishes hashed static assets plus an asset-manifest.json
 * (co-scenes web/build-web.ts; spec §9 "CO-OPS pins a version"). This copies
 * EXACTLY the files the manifest names into vendor/co-scenes/dist/, checks
 * each sha256 on the way in, and pins the version in vendor/co-scenes/VERSION.
 * tests/co-scenes-vendor.test.ts re-checks every hash, so a hand-edited or
 * half-copied bundle fails CI. NOT under public/: the files are served only
 * through app/api/training/co-scenes/[...path]/route.ts, behind full session
 * validation, like every other page of the app.
 *
 * Run (after `npx tsx web/build-web.ts` in the co-scenes checkout):
 *   npx tsx scripts/vendor-co-scenes.ts <co-scenes>/web/dist <co-scenes commit sha> <branch>
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const [distDir, commit, branch] = process.argv.slice(2);
if (!distDir || !commit || !/^[0-9a-f]{7,40}$/.test(commit) || !branch) {
  console.error("usage: npx tsx scripts/vendor-co-scenes.ts <co-scenes web/dist> <commit sha> <branch>");
  process.exit(1);
}

const OUT = path.join("vendor", "co-scenes", "dist");
const manifestText = readFileSync(path.join(distDir, "asset-manifest.json"), "utf8");
const manifest = JSON.parse(manifestText) as { entries?: { training?: string }; files: Record<string, string> };
if (!manifest.entries?.training) throw new Error("vendor-co-scenes: the manifest has no training entry");

rmSync(OUT, { recursive: true, force: true });
for (const [rel, sha] of Object.entries(manifest.files)) {
  if (rel.includes("..") || path.isAbsolute(rel)) throw new Error(`vendor-co-scenes: refusing path ${rel}`);
  const src = path.join(distDir, rel);
  const got = createHash("sha256").update(readFileSync(src)).digest("hex");
  if (got !== sha) throw new Error(`vendor-co-scenes: ${rel} does not match its manifest hash`);
  const dst = path.join(OUT, rel);
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}
writeFileSync(path.join(OUT, "asset-manifest.json"), manifestText, { encoding: "utf8" });

mkdirSync(path.join("vendor", "co-scenes"), { recursive: true });
writeFileSync(
  path.join("vendor", "co-scenes", "VERSION"),
  `co-scenes ${commit} (${branch})\ntraining entry ${manifest.entries.training}\n`,
  { encoding: "utf8" },
);
console.log(`vendored ${Object.keys(manifest.files).length} files → ${OUT}; training entry ${manifest.entries.training}`);

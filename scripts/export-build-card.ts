/**
 * Export the "Learn the build" cards from the build sheet (co-scenes spec §3).
 *
 * Reads docs/seed/source/sandwich-build-sheet.csv in place and writes one
 * lib/training/build-cards/<slug>.card.json per BUILD_DEFS entry. Run after any
 * edit to the sheet; tests/training-build-card.test.ts fails until you do.
 *
 * Run: npx tsx scripts/export-build-card.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { exportBuildCard, serializeBuildCard, BUILD_SHEET_PATH } from "@/lib/training/build-card-export";
import { BUILD_DEFS, buildSteps } from "@/lib/training/build-card-shared";

const csv = readFileSync(BUILD_SHEET_PATH, "utf8");
const outDir = path.join("lib", "training", "build-cards");
mkdirSync(outDir, { recursive: true });

for (const def of BUILD_DEFS) {
  const card = exportBuildCard(csv, def.item);
  buildSteps(def, card, "en"); // refuses an unbound / unknown / doubly bound line before anything is written
  const out = path.join(outDir, `${def.slug}.card.json`);
  writeFileSync(out, serializeBuildCard(card), { encoding: "utf8" });
  console.log(`${out}: ${card.lines.length} lines, revision ${card.revision_sha.slice(0, 12)}`);
}

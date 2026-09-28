/**
 * build-card-export — the build-time export of one item's card from the
 * build-sheet CSV (co-scenes spec §3: "M1 runs off an export built from the
 * CSV"). Node-only (hashing); used by scripts/export-build-card.ts to write the
 * committed JSON and by the test that fails when that JSON is stale.
 *
 * revision_sha = sha256 of the canonical JSON of the item's CSV rows, so any
 * edit to those rows on the sheet makes the committed export stale.
 */

import { createHash } from "node:crypto";

import { itemRows, parseBuildSheetItem, type BuildCard } from "./build-card-shared";

export const BUILD_SHEET_PATH = "docs/seed/source/sandwich-build-sheet.csv";

export function exportBuildCard(csvText: string, item: string): BuildCard {
  const rows = itemRows(csvText, item);
  const revision_sha = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { item, source: BUILD_SHEET_PATH, revision_sha, lines: parseBuildSheetItem(csvText, item) };
}

export function serializeBuildCard(card: BuildCard): string {
  return JSON.stringify(card, null, 2) + "\n";
}

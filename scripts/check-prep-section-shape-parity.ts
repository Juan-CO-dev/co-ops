/**
 * check-prep-section-shape-parity — Item/Inventory Spine, add-sections slice.
 *
 * Read-only parity gate for the data-driven AM-prep render cutover. Asserts two
 * things against the live prep_sections table:
 *
 *  1. shapeToColumns(row.shape) deep-equals row.columns for every active section
 *     (guards against a shape↔columns drift after the migration 0086 re-sync).
 *  2. The six seeded sections still carry the EXACT shape + columns the removed
 *     per-section components hardcoded, in the same display order — i.e. the
 *     data-driven render reproduces the pre-cutover render byte-for-byte.
 *
 * The expected-six table is the parity oracle: it encodes what VegSection/
 * CooksSection/SidesSection/SaucesSection/SlicingSection/MiscSection rendered
 * (note Cooks carries back_up — the Build #2 PR 1 follow-up the component had
 * but the table row was stale on until migration 0086 re-synced it).
 *
 * Exit 0 always (it's a check — prints findings). Run:
 *   npx tsx --env-file=.env.local scripts/check-prep-section-shape-parity.ts
 */

import { pathToFileURL } from "node:url";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { shapeToColumns } from "@/lib/prep-sections";
import type { PrepSectionShape } from "@/lib/types";

/** Parity oracle: the 6 seeded sections as the removed components rendered them. */
const EXPECTED: Array<{ slug: string; shape: PrepSectionShape; columns: string[]; order: number }> = [
  { slug: "Veg", shape: "on_hand", columns: ["par", "on_hand", "back_up", "total"], order: 1 },
  { slug: "Cooks", shape: "on_hand", columns: ["par", "on_hand", "back_up", "total"], order: 2 },
  { slug: "Sides", shape: "portioned", columns: ["par", "portioned", "back_up", "total"], order: 3 },
  { slug: "Sauces", shape: "line", columns: ["par", "line", "back_up", "total"], order: 4 },
  { slug: "Slicing", shape: "line", columns: ["par", "line", "back_up", "total"], order: 5 },
  { slug: "Misc", shape: "yes_no", columns: ["yes_no"], order: 6 },
];

function eqArr(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main() {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("prep_sections")
    .select("slug, shape, columns, display_order, active")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<Array<{ slug: string; shape: PrepSectionShape; columns: string[]; display_order: number; active: boolean }>>();
  if (error) throw new Error(`query failed: ${error.message}`);
  const rows = data ?? [];

  let mismatches = 0;

  // Check 1 — shapeToColumns(shape) === columns for every active section.
  for (const r of rows) {
    const derived = shapeToColumns(r.shape);
    // yes_no rows may legitimately carry a free_text note column; allow that.
    const ok = eqArr(derived, r.columns) || (r.shape === "yes_no" && eqArr(["yes_no", "free_text"], r.columns));
    if (!ok) {
      mismatches += 1;
      console.error(`  [shape↔columns DRIFT] ${r.slug}: shape=${r.shape} derived=${JSON.stringify(derived)} stored=${JSON.stringify(r.columns)}`);
    }
  }

  // Check 2 — the 6 seeded sections match the parity oracle (shape+columns+order).
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const e of EXPECTED) {
    const r = bySlug.get(e.slug);
    if (!r) {
      mismatches += 1;
      console.error(`  [MISSING] seeded section ${e.slug} not found active`);
      continue;
    }
    if (r.shape !== e.shape) {
      mismatches += 1;
      console.error(`  [SHAPE] ${e.slug}: expected ${e.shape}, got ${r.shape}`);
    }
    if (!eqArr(r.columns, e.columns)) {
      mismatches += 1;
      console.error(`  [COLUMNS] ${e.slug}: expected ${JSON.stringify(e.columns)}, got ${JSON.stringify(r.columns)}`);
    }
    if (r.display_order !== e.order) {
      mismatches += 1;
      console.error(`  [ORDER] ${e.slug}: expected ${e.order}, got ${r.display_order}`);
    }
  }

  console.log(`prep_sections parity: ${rows.length} active section(s); ${mismatches} mismatch(es).`);
  if (mismatches === 0) console.log("✓ Data-driven render reproduces the pre-cutover 6 byte-for-byte.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

/**
 * Unit spine — the Phase 2 finalize universe is ACTIVE template items only (0197, LRA-202).
 *
 * `submit_phase2_atomic` counted every `openingPhase2` template item — deactivated ones included —
 * while the screen, the per-item save and Phase 1 only ever enumerate active items. One deactivated
 * Phase 2 item ("Chicken Cutlet", both shops) made every opening un-finalizable from 2026-06-17 until
 * the Launch-Readiness Audit's opening contract reproduced it. Source assertion over the LATEST
 * migration that defines the function: the sibling-asymmetry class the 09-01 audit named, pinned so
 * the next rewrite of this RPC cannot drop the predicate silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const DEFINES = "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(";

/** The last migration (lexical order = lineage order) that (re)defines the finalize RPC. */
const latest = (() => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const defining = files.filter((f) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").includes(DEFINES));
  expect(defining.length).toBeGreaterThan(0);
  const file = defining[defining.length - 1]!;
  const src = readFileSync(`${MIGRATIONS}/${file}`, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf(DEFINES);
  const end = src.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return { file, body: src.slice(start, end) };
})();

describe("submit_phase2_atomic universe = ACTIVE openingPhase2 items (0197)", () => {
  it("is defined last by 0197 or later", () => {
    expect(latest.file >= "0197").toBe(true);
  });

  it("filters cti.active in EVERY enumeration of the universe (count + recompute loop)", () => {
    const universes = latest.body.split("cti.prep_meta->>'openingPhase2' = 'true'").length - 1;
    expect(universes).toBeGreaterThanOrEqual(2);
    // Each universe predicate must sit next to its active filter within the same WHERE clause.
    const clauses = latest.body.match(/WHERE cti\.template_id = v_template_id[\s\S]{0,120}?openingPhase2' = 'true'/g) ?? [];
    expect(clauses.length).toBe(universes);
    for (const clause of clauses) expect(clause).toContain("cti.active = TRUE");
  });

  it("still refuses an incomplete universe with the phase2_incomplete code", () => {
    expect(latest.body).toContain("phase2_incomplete");
  });
});

/**
 * Unit spine — the opener's two-box recount (0215 batch vs bottle, plan S r3 ruling F).
 *
 * A batch_mode item is recounted as LINE (ready) + BACK UP (the bulk container); the total
 * the Phase 1 RPC persists is derived. Three guarantees, and the one that matters most is a
 * NEGATIVE: a non-batch item's draft, wire entry and RPC entry are byte-identical to today's.
 *
 *   · the draft envelope round-trips the two boxes and OMITS them when absent;
 *   · the pure total is null until both boxes are present and non-negative;
 *   · lib/opening.ts forwards the boxes to submit_phase1_atomic as "" when absent (the RPC's
 *     NULLIF idiom), maps the three P0001 codes to one typed error, and the route maps it
 *     to 422 — asserted at the source, the house posture for DB-coupled modules.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { recountTotal } from "@/lib/batch-prep-shared";
import {
  buildOpeningPhase1Draft,
  parseOpeningPhase1Draft,
  type OpeningPhase1DraftItem,
} from "@/lib/opening-draft-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const item = (patch: Partial<OpeningPhase1DraftItem> = {}): OpeningPhase1DraftItem => ({
  countValue: null,
  photoId: null,
  notes: null,
  ticked: false,
  openerRecount: null,
  ...patch,
});

describe("draft envelope — the two boxes are additive", () => {
  it("a non-batch item builds EXACTLY the pre-0215 item (no new keys)", () => {
    const built = buildOpeningPhase1Draft([["a", item({ ticked: true, openerRecount: 4 })]], [], null);
    expect(Object.keys(built.items.a!).sort()).toEqual(["countValue", "notes", "openerRecount", "photoId", "ticked"]);
  });
  it("a batch item's boxes round-trip through build → JSON → parse", () => {
    const built = buildOpeningPhase1Draft(
      [["b", item({ ticked: true, openerRecount: 10, openerRecountLine: 2, openerRecountBackUp: 8 })]],
      [],
      null,
    );
    expect(built.items.b).toEqual({ countValue: null, photoId: null, notes: null, ticked: true, openerRecount: 10, openerRecountLine: 2, openerRecountBackUp: 8 });
    const parsed = parseOpeningPhase1Draft(JSON.parse(JSON.stringify(built)));
    expect(parsed).toEqual(built);
  });
  it("a draft written before the field existed parses unchanged", () => {
    const old = { version: 1, items: { a: item({ openerRecount: 4 }) }, sections: {}, openerNoPriorDataAttestation: null };
    expect(parseOpeningPhase1Draft(old)).toEqual(old);
  });
  it("a present non-number box rejects the whole draft", () => {
    const bad = { version: 1, items: { a: { ...item(), openerRecountLine: "2" } }, sections: {}, openerNoPriorDataAttestation: null };
    expect(parseOpeningPhase1Draft(bad)).toBeNull();
  });
});

describe("recountTotal — derived, never typed", () => {
  it("is line + back up only when both are present and non-negative", () => {
    expect(recountTotal(2, 8)).toBe(10);
    expect(recountTotal(0, 0)).toBe(0);
    expect(recountTotal(2, null)).toBeNull();
    expect(recountTotal(null, 8)).toBeNull();
    expect(recountTotal(-1, 8)).toBeNull();
  });
});

describe("lib/opening.ts — the wire to submit_phase1_atomic", () => {
  const src = read("lib", "opening.ts");
  const at = src.indexOf("const rpcEntries = args.entries.map");
  const block = src.slice(at, src.indexOf("}));", at));
  it("forwards openerRecountLine / openerRecountBackUp as \"\" when absent (the NULLIF idiom)", () => {
    expect(block).toMatch(/openerRecountLine:\s*\n?\s*e\.openerRecountLine === null \|\| e\.openerRecountLine === undefined \? "" : String\(e\.openerRecountLine\)/);
    expect(block).toMatch(/openerRecountBackUp:\s*\n?\s*e\.openerRecountBackUp === null \|\| e\.openerRecountBackUp === undefined \? "" : String\(e\.openerRecountBackUp\)/);
  });
  it("keeps the pre-0215 fields in their original form", () => {
    expect(block).toContain('openerRecount: e.openerRecount === null ? "" : String(e.openerRecount)');
    expect(block).toContain('countValue: e.countValue === null ? "" : String(e.countValue)');
  });
  it("maps the three recount_split codes to OpeningRecountSplitError with the item id", () => {
    const fn = src.slice(src.indexOf("export async function submitPhase1Atomic("));
    expect(fn).toMatch(/\["recount_split_required", "recount_split_incomplete", "recount_split_negative"\] as const/);
    expect(fn).toMatch(/throw new OpeningRecountSplitError\(splitCode, itemId\)/);
  });
  it("the route maps that error to 422 and the three codes have en + es strings", () => {
    const helpers = read("app", "api", "opening", "_helpers.ts");
    const at2 = helpers.indexOf("err instanceof OpeningRecountSplitError");
    expect(at2).toBeGreaterThan(-1);
    expect(helpers.slice(at2, at2 + 400)).toMatch(/jsonError\(422, err\.code/);
    for (const code of ["recount_split_required", "recount_split_incomplete", "recount_split_negative"]) {
      expect((en as Record<string, string>)[`opening.error.${code}`]).toBeTruthy();
      expect((es as Record<string, string>)[`opening.error.${code}`]).toBeTruthy();
    }
  });
  it("the Phase 1 route validator accepts the two boxes as finite numbers or null", () => {
    const route = read("app", "api", "opening", "submit", "phase1", "route.ts");
    expect(route).toMatch(/entries\[\$\{i\}\]\.openerRecountLine/);
    expect(route).toMatch(/entries\[\$\{i\}\]\.openerRecountBackUp/);
  });
});

describe("snapshots — the closer's two boxes ride beside closer_count", () => {
  const src = read("lib", "opening.ts");
  it("materializer reads the primary box and BACK UP from the AM prep inputs", () => {
    const fn = src.slice(src.indexOf("async function materializeCloserCountSnapshots("), src.indexOf("export interface OpeningCloserCountSnapshotRow"));
    expect(fn).toMatch(/\[inputs\.line, inputs\.onHand, inputs\.portioned\]\.find/);
    expect(fn).toMatch(/backUp: typeof inputs\.backUp === "number" \? inputs\.backUp : null/);
  });
  it("the create-path sends line_count / back_up_count and the reader selects them", () => {
    expect(src).toMatch(/line_count: live\?\.line \?\? null/);
    expect(src).toMatch(/back_up_count: live\?\.backUp \?\? null/);
    expect(src).toContain("par_value, par_unit, snapshot_taken_at, line_count, back_up_count");
  });
  it.each(["opening.phase1.recount_line", "opening.phase1.recount_back_up", "opening.phase1.recount_total_hint", "opening.phase1.recount_two_box_hint"])("%s exists in en and es", (key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((es as Record<string, string>)[key]).toBeTruthy();
  });
});

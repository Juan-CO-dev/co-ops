/**
 * Catalog Phase 3a — THE SAME PIN OVER A PROD-SHAPED SNAPSHOT (spec §8). Skipped unless
 * RECIPE_VERSIONS_SNAPSHOT_DIR is set, so CI never runs it. READ-ONLY BY CONSTRUCTION: the snapshot is
 * a directory of `<table>.json` files exported with SELECT statements only (Step 8); this test loads
 * them into the in-memory stand-in and never touches a database.
 *
 * TWO INDEPENDENT CAPTURES, NOTHING RECONSTRUCTED (Astra 3a r1#7):
 *   1. BEFORE — a PRE-migration export (it must NOT contain the 0262/0263 tables), computed by the Task 1
 *      commit's code. Writes { fingerprint, outputs }:
 *        RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-before RECIPE_VERSIONS_SNAPSHOT_OUT=tmp/recipe-before.json \
 *          npx vitest run tests/recipe-versions-snapshot.test.ts
 *   2. AFTER — a POST-migration export that MUST contain the real recipe_versions, recipe_version_lines and
 *      menu_item_shop_settings (no synthetic backfill, ever), computed by the finished branch's code:
 *        RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-after RECIPE_VERSIONS_SNAPSHOT_BASELINE=tmp/recipe-before.json \
 *          npx vitest run tests/recipe-versions-snapshot.test.ts
 *      It refuses unless the base tables are byte-identical to the BEFORE capture (same fingerprint — the
 *      data did not move between the captures), then checks the persisted journal itself (every recipe has
 *      exactly one live global version, from 2000-01-01, whose lines equal recipe_inputs), then compares
 *      the numbers.
 *   RECIPE_VERSIONS_SNAPSHOT_DAYS (default: yesterday ET) is a comma list of dated business dates.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { computeRecipeOutputs, liveRecipeApi, type RecipeEquivalenceOutputs } from "./fixtures/recipe-versions-harness";

/** The tables 0262/0263 create. A BEFORE export must not have them; an AFTER export must have the first three. */
const NEW_TABLES = ["recipe_versions", "recipe_version_lines", "menu_item_shop_settings", "recipe_notice_dismissals"];
const REQUIRED_AFTER = ["recipe_versions", "recipe_version_lines", "menu_item_shop_settings"];
const LINE_FIELDS = ["component_sku_id", "component_item_id", "component_product_id", "quantity", "unit",
  "each_container_label", "portioned", "display_order"] as const;

type Tables = Record<string, Array<Record<string, unknown>>>;
interface BeforeCapture { fingerprint: string; outputs: RecipeEquivalenceOutputs }

const DIR = process.env.RECIPE_VERSIONS_SNAPSHOT_DIR;

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

/** The export as it is — NO table is ever synthesized here. */
function loadSnapshot(dir: string): Tables {
  const tables: Tables = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    tables[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<Record<string, unknown>>;
  }
  return tables;
}

/** The base tables (every exported table but the new ones), hashed per table: equal fingerprints = the data did not move. */
function fingerprintOf(tables: Tables): string {
  const per = Object.keys(tables).filter((t) => !NEW_TABLES.includes(t)).sort()
    .map((t) => `${t}:${createHash("sha256").update(JSON.stringify(tables[t])).digest("hex")}`);
  return per.join("\n");
}

/** The persisted journal, checked directly: one live global version per recipe, from 2000-01-01, lines = recipe_inputs. */
function journalProblems(tables: Tables): string[] {
  const problems: string[] = [];
  const key = (l: Record<string, unknown>) => JSON.stringify(LINE_FIELDS.map((f) => (l[f] == null ? null : String(l[f]))));
  const versions = tables.recipe_versions ?? [];
  const linesByVersion = new Map<string, string[]>();
  for (const l of tables.recipe_version_lines ?? []) {
    const list = linesByVersion.get(String(l.version_id)) ?? [];
    list.push(key(l));
    linesByVersion.set(String(l.version_id), list);
  }
  const inputsByRecipe = new Map<string, string[]>();
  for (const i of tables.recipe_inputs ?? []) {
    const list = inputsByRecipe.get(String(i.recipe_id)) ?? [];
    list.push(key(i));
    inputsByRecipe.set(String(i.recipe_id), list);
  }
  for (const r of tables.recipes ?? []) {
    const live = versions.filter((v) => v.recipe_id === r.id && v.location_id == null && v.active === true);
    if (live.length !== 1) { problems.push(`${String(r.id)}: ${live.length} live global versions`); continue; }
    const v = live[0]!;
    if (!String(v.valid_from).startsWith("2000-01-01")) problems.push(`${String(r.id)}: baseline valid_from ${String(v.valid_from)}`);
    const a = [...(linesByVersion.get(String(v.id)) ?? [])].sort();
    const b = [...(inputsByRecipe.get(String(r.id)) ?? [])].sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${String(r.id)}: baseline lines differ from recipe_inputs`);
  }
  if (versions.some((v) => v.location_id != null)) problems.push("shop versions exist right after the apply");
  if ((tables.menu_item_shop_settings ?? []).length > 0) problems.push("menu shop settings exist right after the apply");
  return problems;
}

function yesterdayEt(): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!DIR)("prod-shaped snapshot — the same recipe and menu numbers before and after", () => {
  it("computes, and writes (BEFORE) or verifies and compares (AFTER)", async () => {
    const tables = loadSnapshot(DIR!);
    const outPath = process.env.RECIPE_VERSIONS_SNAPSHOT_OUT;
    const basePath = process.env.RECIPE_VERSIONS_SNAPSHOT_BASELINE;
    expect(Boolean(outPath) !== Boolean(basePath), "set exactly one of RECIPE_VERSIONS_SNAPSHOT_OUT / _BASELINE").toBe(true);
    if (outPath) {
      // BEFORE: a pre-migration export, or it is not an independent "before".
      expect(NEW_TABLES.filter((t) => t in tables), "a BEFORE export must predate 0262/0263").toEqual([]);
    } else {
      // AFTER: the REAL persisted tables, never a reconstruction.
      expect(REQUIRED_AFTER.filter((t) => !(t in tables)), "an AFTER export must include the persisted 0262/0263 tables").toEqual([]);
      expect(journalProblems(tables)).toEqual([]);
    }
    current = createFakeDb(tables);
    const shops = (tables.locations ?? []).filter((l) => l.active !== false).map((l) => String(l.id)).sort();
    const days = (process.env.RECIPE_VERSIONS_SNAPSHOT_DAYS ?? yesterdayEt()).split(",").map((d) => d.trim()).filter(Boolean);
    const got = await computeRecipeOutputs(liveRecipeApi, tables, shops, days);
    if (outPath) {
      const capture: BeforeCapture = { fingerprint: fingerprintOf(tables), outputs: got };
      writeFileSync(outPath, `${JSON.stringify(capture, null, 2)}\n`);
      return;
    }
    expect(existsSync(basePath!)).toBe(true);
    const before = JSON.parse(readFileSync(basePath!, "utf8")) as BeforeCapture;
    // The data did not move between the two captures; if it did, the proof is INCONCLUSIVE — never "re-take
    // the before from the after".
    expect(fingerprintOf(tables), "base tables moved between the captures: inconclusive (Task 12 Step 6)").toBe(before.fingerprint);
    expect(got).toEqual(before.outputs);
  });
});

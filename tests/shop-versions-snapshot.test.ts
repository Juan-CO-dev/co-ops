/**
 * Catalog Phase 2a — THE PROD-SNAPSHOT EQUIVALENCE PROOF (spec §8; Astra full-branch r1 P2).
 *
 *   BEFORE  the ORIGINAL snapshot rows (a pre-0259 export: no version/lane/scope columns) through
 *           origin/main's own loaders, frozen verbatim (tests/fixtures/prep-consumption-v0-oracle.ts,
 *           the harness's legacyApi).
 *   AFTER   the SAME rows loaded into PGlite, the REAL 0259 and 0260 executed over them
 *           (tests/fixtures/snapshot-migrate.ts), the resulting rows read back — versions, intervals,
 *           level links, lanes and epochs exactly as the migrations wrote them, nothing fabricated —
 *           then the NEW scoped resolver (the harness's liveApi).
 *   ASSERT  no shop version and no lane exists, the flat mirror is untouched, and every number —
 *           chains, whole-catalog chains, prices, PO cents, order-unit oz, flat content, the graph's
 *           packs, depletion, cost per oz, menu/prep rollups, the dated depletion — is IDENTICAL.
 *
 * Two runs:
 *   · ALWAYS: a synthetic prod-shaped snapshot (uuid ids; a live chain written in two statements; a
 *     retired set; per-shop product primaries; tied prices) proves the pipeline end to end in CI.
 *   · ON DEMAND: SHOP_VERSIONS_SNAPSHOT_DIR=tmp/shop-versions-snapshot — a directory of `<table>.json`
 *     arrays exported from prod READ-ONLY (scripts/snapshot-equivalence.mjs runs it and lists the
 *     tables and columns). Never touches a database: the snapshot is a file, PGlite is in memory.
 *     SHOP_VERSIONS_SNAPSHOT_DAY (default: today ET) is the dated business date — today's packs ARE
 *     the live ones, so it must equal live. SHOP_VERSIONS_SNAPSHOT_OUT writes the report as JSON.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, QUIET_DAY } from "./fixtures/shop-versions-fixture";
import { computeOutputs, legacyApi, liveApi, type EquivalenceOutputs } from "./fixtures/shop-versions-harness";
import { migrateSnapshot, type SnapshotTables } from "./fixtures/snapshot-migrate";

const DIR = process.env.SHOP_VERSIONS_SNAPSHOT_DIR;

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

const clone = (t: SnapshotTables): SnapshotTables => JSON.parse(JSON.stringify(t)) as SnapshotTables;

/** BEFORE (legacy loaders, original rows) vs AFTER (real 0259 + 0260 in PGlite, new resolver). */
async function prove(snapshot: SnapshotTables, day: string) {
  if (snapshot.sku_pack_versions || (snapshot.sku_pack_levels ?? []).some((l) => "version_id" in l)) {
    throw new Error("the snapshot must be a PRE-0259 export (no sku_pack_versions, no version_id): it is the 'before'");
  }
  const shops = (snapshot.locations ?? []).filter((l) => l.active !== false).map((l) => String(l.id)).sort();
  current = createFakeDb(clone(snapshot));
  const before = await computeOutputs(legacyApi, clone(snapshot), shops, day);
  const migrated = await migrateSnapshot(clone(snapshot));
  current = createFakeDb(clone(migrated.tables));
  const after = await computeOutputs(liveApi, clone(migrated.tables), shops, day);
  return { before, after, report: migrated.report, migrated: migrated.tables };
}

/** Every differing path (for a readable failure on a real snapshot). */
function diffPaths(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
      diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
  } else out.push(`${path}: ${JSON.stringify(a)?.slice(0, 120)} → ${JSON.stringify(b)?.slice(0, 120)}`);
  return out;
}

// ── the synthetic prod-shaped snapshot ────────────────────────────────────────

/**
 * The fixture matrix as a PRE-0259 export: the version/lane/scope columns stripped, every id
 * remapped to a uuid (Postgres types), created_at present (NOT NULL in prod). Two awkward prod
 * shapes are made explicit: s-bags' live chain written in TWO statements (5 s apart — the 0259 P1
 * case), and s-cups' retired box given its own leaf (a retired level always points into its own
 * retired set: the TS writer deactivates whole sets).
 */
function syntheticSnapshot(): SnapshotTables {
  const t = buildShopVersionsFixture();
  delete t.sku_pack_versions;
  delete t.sku_price_lanes;
  for (const l of t.sku_pack_levels ?? []) {
    delete l.version_id; delete l.location_id;
    l.created_at = l.effective_from;
    l.created_by = null;
  }
  const bagsCase = (t.sku_pack_levels ?? []).find((l) => l.id === "pl-b-case")!;
  bagsCase.effective_from = "2026-08-01T00:00:05.000Z"; bagsCase.created_at = bagsCase.effective_from;
  Object.assign((t.sku_pack_levels ?? []).find((l) => l.id === "pl-c-old")!, { contains_level_id: null, contains_measure_unit: "each" });
  for (const p of t.vendor_price_history ?? []) { delete p.location_id; delete p.price_lane_id; }
  // ids → uuids, everywhere they are referenced
  const ids = new Set<string>();
  for (const rows of Object.values(t)) for (const r of rows) if (typeof r.id === "string") ids.add(r.id);
  let n = 0;
  const map = new Map([...ids].sort().map((id) => [id, `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`]));
  const remap = (v: unknown): unknown => (typeof v === "string" && map.has(v) ? map.get(v) : v);
  for (const rows of Object.values(t)) for (const r of rows) for (const k of Object.keys(r)) r[k] = remap(r[k]);
  return t;
}

describe("the snapshot proof's pipeline, over a synthetic prod-shaped snapshot (always runs)", () => {
  it("real 0259 + 0260 in PGlite, then the new resolver, equals origin/main's loaders on the original rows", async () => {
    const { before, after, report, migrated } = await prove(syntheticSnapshot(), QUIET_DAY);
    expect(report.shopVersions).toBe(0);
    expect(report.lanes).toBe(0);
    expect(report.mirrorChanged).toEqual([]);
    // the migration really ran: every level is versioned, s-bags' two-statement chain is ONE live version
    expect(migrated.sku_pack_levels!.every((l) => typeof l.version_id === "string")).toBe(true);
    const bagsSku = migrated.sku_pack_levels!.find((l) => l.label === "sleeve" && l.active === true && l.contains_measure_unit === "each" && Number(l.contains_qty) === 50)!.sku_id;
    const bagsLive = migrated.sku_pack_versions!.filter((v) => v.sku_id === bagsSku && v.active === true);
    expect(bagsLive).toHaveLength(1);
    expect(new Set(migrated.sku_pack_levels!.filter((l) => l.sku_id === bagsSku && l.active === true).map((l) => l.version_id))).toEqual(new Set([bagsLive[0]!.id]));
    expect(diffPaths(before, after)).toEqual([]);
    expect(after).toEqual(before);
    // …and the comparison is not vacuous
    expect(Object.keys(before)).toHaveLength(3);
    expect(Object.keys(before.global!.chains).length).toBeGreaterThan(3);
    expect(Object.keys(before.global!.prices).length).toBeGreaterThan(5);
  }, 120_000);
});

// ── the real prod snapshot (on demand) ────────────────────────────────────────

function loadSnapshot(dir: string): SnapshotTables {
  const tables: SnapshotTables = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    tables[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<Record<string, unknown>>;
  }
  return tables;
}

function todayEt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

describe.skipIf(!DIR)("prod snapshot — origin/main's numbers equal 2a's after the real 0259 + 0260", () => {
  it("is identical, with no shop version, no lane and an untouched flat mirror", async () => {
    const day = process.env.SHOP_VERSIONS_SNAPSHOT_DAY ?? todayEt();
    const { before, after, report } = await prove(loadSnapshot(DIR!), day);
    const diffs = diffPaths(before, after);
    const out = process.env.SHOP_VERSIONS_SNAPSHOT_OUT;
    if (out) writeFileSync(out, `${JSON.stringify({ day, report, diffs, before: before as EquivalenceOutputs }, null, 2)}\n`);
    console.log(`snapshot proof: day ${day}; ${report.versions} versions over ${report.levels} levels; ${diffs.length} differing values`);
    expect(report.shopVersions).toBe(0);
    expect(report.lanes).toBe(0);
    expect(report.mirrorChanged).toEqual([]);
    expect(diffs).toEqual([]);
  }, 300_000);
});

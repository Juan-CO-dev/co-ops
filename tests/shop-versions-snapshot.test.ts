/**
 * Catalog Phase 2a — THE SAME PIN OVER A PROD-SHAPED SNAPSHOT (spec §8). Skipped unless
 * SHOP_VERSIONS_SNAPSHOT_DIR is set, so CI never runs it. READ-ONLY BY CONSTRUCTION: the snapshot
 * is a directory of `<table>.json` files exported with SELECT statements only (Step 8); this test
 * loads them into the in-memory stand-in and never touches a database.
 *
 *   1. On the Task 1 commit:
 *        SHOP_VERSIONS_SNAPSHOT_DIR=tmp/shop-versions-snapshot SHOP_VERSIONS_SNAPSHOT_OUT=tmp/before.json \
 *          npx vitest run tests/shop-versions-snapshot.test.ts
 *   2. On the finished branch:
 *        SHOP_VERSIONS_SNAPSHOT_DIR=tmp/shop-versions-snapshot SHOP_VERSIONS_SNAPSHOT_BASELINE=tmp/before.json \
 *          npx vitest run tests/shop-versions-snapshot.test.ts
 *   SHOP_VERSIONS_SNAPSHOT_DAY (default: yesterday ET) is the dated business date; on the finished
 *   branch it must still equal live unless a GLOBAL chain changed after that day (Task 14 Step 1
 *   reports whether one did).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { withBackfilledVersions } from "./fixtures/shop-versions-fixture";
import { computeOutputs, liveApi, type EquivalenceOutputs } from "./fixtures/shop-versions-harness";

const DIR = process.env.SHOP_VERSIONS_SNAPSHOT_DIR;

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

function loadSnapshot(dir: string): Record<string, Array<Record<string, unknown>>> {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    tables[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<Record<string, unknown>>;
  }
  return tables.sku_pack_versions ? tables : withBackfilledVersions(tables);
}

function yesterdayEt(): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const t = Date.parse(`${today}T12:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

describe.skipIf(!DIR)("prod-shaped snapshot — the same numbers before and after", () => {
  it("computes, and writes or compares", async () => {
    const tables = loadSnapshot(DIR!);
    current = createFakeDb(tables);
    const shops = (tables.locations ?? []).filter((l) => l.active !== false).map((l) => String(l.id)).sort();
    const got = await computeOutputs(liveApi, tables, shops, process.env.SHOP_VERSIONS_SNAPSHOT_DAY ?? yesterdayEt());
    const outPath = process.env.SHOP_VERSIONS_SNAPSHOT_OUT;
    const basePath = process.env.SHOP_VERSIONS_SNAPSHOT_BASELINE;
    if (outPath) writeFileSync(outPath, `${JSON.stringify(got, null, 2)}\n`);
    if (basePath) {
      expect(existsSync(basePath)).toBe(true);
      expect(got).toEqual(JSON.parse(readFileSync(basePath, "utf8")) as EquivalenceOutputs);
    }
    expect(outPath ?? basePath, "set SHOP_VERSIONS_SNAPSHOT_OUT or _BASELINE").toBeTruthy();
  });
});

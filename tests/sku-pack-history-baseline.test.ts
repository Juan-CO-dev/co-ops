/**
 * Audit W18/B188: the 0259 trigger records a SKU's legacy flat pack as a dated BASELINE version
 * (`flat_snapshot` set, no levels) when it gets its first global chain. History showed it like any
 * other row and offered Restore, which always failed (no levels → a bare 404).
 */
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
import { loadSkuPackVersionHistory, restoreSkuPackVersion, SkuVersionError } from "@/lib/admin/sku-versions";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  ...current!.client,
  rpc: async () => { throw new Error("no write may run for a baseline restore"); },
}) }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; });

const moo = { user: { id: "u1", role: "moo" }, role: "moo", level: 8, locations: [] } as unknown as AuthContext;

const db = () => createFakeDb({
  sku_pack_versions: [
    { id: "v-base", sku_id: "s", location_id: null, active: false, based_on_version_id: null, valid_from: "2026-10-01T00:00:00Z",
      valid_to: "2026-10-15T00:00:00Z", created_by: null, note: "baseline", flat_snapshot: { pack_format: "case", pack_qty: 4 } },
    { id: "v-live", sku_id: "s", location_id: null, active: true, based_on_version_id: "v-base", valid_from: "2026-10-15T00:00:00Z",
      valid_to: null, created_by: null, note: null, flat_snapshot: null },
  ],
  sku_pack_levels: [{ id: "l1", version_id: "v-live", sku_id: "s", label: "case", contains_qty: 4, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0 }],
});

it("history marks the flat baseline and Restore refuses it by name", async () => {
  current = db();
  const rows = await loadSkuPackVersionHistory(moo, "s", null);
  expect(rows.map((r) => [r.id, r.baseline])).toEqual([["v-live", false], ["v-base", true]]);
  const err = await restoreSkuPackVersion(moo, { skuId: "s", scope: null, fromVersionId: "v-base", expectedLiveVersionId: "v-live" })
    .then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(SkuVersionError);
  expect({ status: (err as SkuVersionError).status, code: (err as SkuVersionError).code }).toEqual({ status: 409, code: "baseline_not_restorable" });
});

it("the item page never offers Restore on a baseline row and labels it in words", () => {
  const src = readFileSync("components/catalog/SkuItemClient.tsx", "utf8");
  expect(src).toMatch(/const canRestore = !h\.active && !h\.baseline &&/);
  expect(src).toContain('t("catalog.history.baseline")');
  for (const lang of ["en", "es"] as const) {
    const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
    expect(dict["catalog.history.baseline"], lang).toBeTruthy();
    expect(dict["catalog.error.baseline_not_restorable"], lang).toBeTruthy();
  }
});

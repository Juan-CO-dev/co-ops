/**
 * Catalog Phase 2a — every loader that reads a 0259 table names only columns that EXIST in the real
 * schema (Astra full-branch r2 P2). The in-memory fake DB accepts any column — it happily "ordered"
 * sku_pack_epochs by a nonexistent `id`, which in Postgres failed every readiness load. So:
 *
 *   1. the loaders run against a RECORDING client that captures each query they build (table,
 *      selected columns, filter columns, order columns, paged or not);
 *   2. PGlite applies the stub base tables + the REAL 0259 + 0260;
 *   3. every captured query on a table that schema defines fully is EXECUTED there as
 *      `select <cols> from <table> where <filter cols> ... order by <order cols> limit 0` — a
 *      missing column is a Postgres error, not a guess.
 * Fully defined here: the three 0259 tables, sku_pack_levels (0159 verbatim + 0259),
 * vendor_price_history (the foundation columns + 0177 + 0259) and 0261's sku_pack_change_requests.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { AuthContext } from "@/lib/session";

interface Captured { table: string; select: string[]; filters: string[]; order: string[]; ranged: boolean; via: string }
const captured: Captured[] = [];
let via = "";

function recordingClient() {
  return {
    from(table: string) {
      const rec: Captured = { table, select: [], filters: [], order: [], ranged: false, via };
      captured.push(rec);
      const q: Record<string, unknown> = {};
      const col = (c: string) => { rec.filters.push(c.split(".")[0]!); return q; };
      Object.assign(q, {
        select: (cols: string) => {
          rec.select = cols.split(",").map((c) => c.trim()).filter((c) => c !== "" && !c.includes("(") && !c.includes("!"));
          return q;
        },
        eq: (c: string) => col(c), neq: (c: string) => col(c), is: (c: string) => col(c), in: (c: string) => col(c),
        gt: (c: string) => col(c), gte: (c: string) => col(c), lt: (c: string) => col(c), lte: (c: string) => col(c),
        not: (c: string) => col(c),
        or: (expr: string) => { for (const alt of expr.split(",")) rec.filters.push(alt.split(".")[0]!); return q; },
        order: (c: string) => { rec.order.push(c); return q; },
        range: () => { rec.ranged = true; return q; },
        limit: () => q, returns: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
      });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => recordingClient() }));

import { loadSkuDataReadiness, READINESS_COLUMNS, readinessOrder } from "@/lib/sku-data-readiness-load";
import { loadAllSkuPackResolution, loadPackBoundaries, loadShopPackEpochs, loadSkuPackResolution } from "@/lib/prep-consumption";
import { loadCurrentSkuPriceHeads } from "@/lib/admin/cost";
import { loadSkuPackVersionHistory, restoreSkuPackVersion, retireShopPackVersion } from "@/lib/admin/sku-versions";
import { dismissPackChangeRequest, filePackChangeRequest, loadOpenPackChangeRequests, loadRequestAdditions } from "@/lib/pack-change-requests";
import { globalValueExists, loadSkuPriceHistory, requestShop } from "@/lib/catalog/sku-item";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { migratedSchemaDb } from "./fixtures/snapshot-migrate";

const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
const SKU = "6f1d2c3e-0000-4000-8000-0000000000b1";
const owner = { user: { id: "u", role: "owner" }, role: "owner", level: 9, locations: [LOC] } as unknown as AuthContext;
const FULLY_DEFINED = new Set(["sku_pack_versions", "sku_price_lanes", "sku_pack_epochs", "sku_pack_levels", "vendor_price_history",
  // Catalog Phase 2b (0261): the door's report table.
  "sku_pack_change_requests", "sku_pack_change_request_additions"]);

let db: PGlite;
beforeAll(async () => {
  db = await migratedSchemaDb();
  const run = async (name: string, fn: () => Promise<unknown>) => { via = name; try { await fn(); } catch { /* refusals after the read are fine */ } };
  await run("loadSkuDataReadiness", () => loadSkuDataReadiness(owner));
  await run("loadSkuPackResolution(global)", () => loadSkuPackResolution([SKU], null));
  await run("loadSkuPackResolution(shop)", () => loadSkuPackResolution([SKU], LOC));
  await run("loadSkuPackResolution(shop, asOf)", () => loadSkuPackResolution([SKU], LOC, "2026-10-15T03:59:59.999Z"));
  await run("loadAllSkuPackResolution(shop)", () => loadAllSkuPackResolution(LOC));
  await run("loadPackBoundaries(shop)", () => loadPackBoundaries(LOC));
  await run("loadShopPackEpochs", () => loadShopPackEpochs([SKU], LOC));
  await run("loadCurrentSkuPriceHeads(shop)", () => loadCurrentSkuPriceHeads([SKU], LOC));
  await run("loadSkuPackVersionHistory", () => loadSkuPackVersionHistory(owner, SKU, LOC));
  await run("retireShopPackVersion", () => retireShopPackVersion(owner, { skuId: SKU, versionId: SKU, locationId: LOC }));
  await run("restoreSkuPackVersion", () => restoreSkuPackVersion(owner, { skuId: SKU, scope: LOC, fromVersionId: SKU, expectedLiveVersionId: null }));
  // Catalog Phase 2b (0261) — every read of the door's report table.
  await run("loadOpenPackChangeRequests", () => loadOpenPackChangeRequests(owner, { locationIds: [LOC], skuId: SKU }));
  await run("dismissPackChangeRequest", () => dismissPackChangeRequest(owner, { requestId: SKU, skuId: SKU }));
  // Catalog Phase 2b — the item page's own reads of 0259/0261 tables.
  await run("globalValueExists(pack)", () => globalValueExists(getServiceRoleClient(), SKU, "pack"));
  await run("globalValueExists(price)", () => globalValueExists(getServiceRoleClient(), SKU, "price"));
  await run("loadSkuPriceHistory(shop)", () => loadSkuPriceHistory(getServiceRoleClient(), SKU, LOC));
  await run("requestShop", () => requestShop(getServiceRoleClient(), SKU));
  await run("loadRequestAdditions", () => loadRequestAdditions(getServiceRoleClient() as never, [SKU]));
  await run("filePackChangeRequest", () => filePackChangeRequest(owner, { skuId: SKU, locationId: LOC, deliveryId: null, note: null, proposal: null, photoId: null }));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("every query a loader builds on a 0259 table runs against the REAL schema", () => {
  it("captured the reads (the check is not vacuous)", () => {
    const tables = new Set(captured.map((c) => c.table));
    for (const t of FULLY_DEFINED) expect(tables, t).toContain(t);
    expect(captured.filter((c) => c.table === "sku_pack_epochs").length).toBeGreaterThanOrEqual(2); // readiness + the walk's loader
  });

  it("each executes in Postgres: every selected, filtered and ordered column exists", async () => {
    const failures: string[] = [];
    for (const c of captured.filter((x) => FULLY_DEFINED.has(x.table))) {
      const cols = [...new Set([...c.select, ...c.filters, ...c.order])];
      const sql = `select ${c.select.length > 0 ? c.select.join(", ") : "1"} from public.${c.table}`
        + (c.filters.length > 0 ? ` where ${[...new Set(c.filters)].map((f) => `${f} is not distinct from ${f}`).join(" and ")}` : "")
        + (c.order.length > 0 ? ` order by ${c.order.join(", ")}` : "") + " limit 0";
      try { await db.query(sql); } catch (e) { failures.push(`${c.via} → ${c.table} [${cols.join(", ")}]: ${(e as Error).message}`); }
    }
    expect(failures).toEqual([]);
  });

  it("every PAGED read is ordered (a page boundary without a total order reshuffles rows)", () => {
    const unordered = captured.filter((c) => c.ranged && c.order.length === 0).map((c) => `${c.via} → ${c.table}`);
    expect(unordered).toEqual([]);
  });
});

describe("the readiness loader pages every table by a key that table HAS", () => {
  it("sku_pack_epochs (no id) pages by its composite key; every order column is one it selects", () => {
    expect(readinessOrder("sku_pack_epochs")).toEqual(["sku_id", "location_id"]);
    for (const [table, columns] of Object.entries(READINESS_COLUMNS) as Array<[Parameters<typeof readinessOrder>[0], string]>) {
      const selected = columns.split(",");
      for (const col of readinessOrder(table)) expect(selected, `${table} orders by ${col}`).toContain(col);
    }
  });
  it("the epochs read the loader actually sent orders by (sku_id, location_id), never id", () => {
    const epochs = captured.find((c) => c.via === "loadSkuDataReadiness" && c.table === "sku_pack_epochs")!;
    expect(epochs.order).toEqual(["sku_id", "location_id"]);
    expect(epochs.ranged).toBe(true);
  });
});

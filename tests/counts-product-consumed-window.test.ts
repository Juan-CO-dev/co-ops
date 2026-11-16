/**
 * Audit W17 / B023 — a product count's consumed term must not spend the production-id list.
 *
 * `sumConsumedOzWindow` (createCountEvent → allocateProductLines → loadProductConsumedOz) read
 * every LIVE production id at the shop since the product's oldest lot and sent them all in one
 * `.in("production_id", …)`. Past 220 productions the gateway refused the request line and
 * every count sheet with a product line answered 500. The inputs are now scoped through the
 * header embed: the same rows, a constant request line.
 */
import { describe, expect, it } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { withInListGuard } from "./fixtures/in-list-guard";
import { sumConsumedOzWindow } from "@/lib/counts";

const L = "loc-L";
const AFTER = "2026-09-01T12:00:00+00:00";
const UNTIL = "2026-12-01T00:00:00+00:00";

function seed() {
  const productions: Array<Record<string, unknown>> = [];
  const inputs: Array<Record<string, unknown>> = [];
  let n = 0;
  const production = (id: string, over: Record<string, unknown>, lines: Array<[string, number | string | null]>) => {
    productions.push({ id, location_id: L, produced_at: "2026-10-01T15:00:00+00:00", superseded_at: null, revoked_at: null, ...over });
    for (const [skuId, oz] of lines) inputs.push({ id: `in-${String(++n).padStart(5, "0")}`, production_id: id, input_sku_id: skuId, input_oz: oz });
  };
  // 300 live productions at L inside the window: 2 oz of ham each, and every third one 1.5 oz of turkey.
  for (let i = 0; i < 300; i++) {
    const at = new Date(Date.parse("2026-09-02T00:00:00Z") + i * 3_600_000).toISOString();
    production(`p-${String(i).padStart(4, "0")}`, { produced_at: at }, i % 3 === 0 ? [["ham", 2], ["turkey", "1.5"]] : [["ham", 2]]);
  }
  production("p-superseded", { superseded_at: "2026-10-02T00:00:00+00:00" }, [["ham", 1000]]);
  production("p-revoked", { revoked_at: "2026-10-02T00:00:00+00:00" }, [["ham", 1000]]);
  production("p-other-shop", { location_id: "loc-other" }, [["ham", 1000]]);
  production("p-before", { produced_at: "2026-08-31T00:00:00+00:00" }, [["ham", 1000]]);
  production("p-at-anchor", { produced_at: AFTER }, [["ham", 1000]]); // exactly at `after` → out
  production("p-at-until", { produced_at: "2026-12-01T00:00:00Z" }, [["ham", 5]]); // exactly at `until` → in
  production("p-after-until", { produced_at: "2026-12-01T00:00:00.000001Z" }, [["ham", 1000]]);
  production("p-null-oz", {}, [["cheese", null], ["cheese", 4]]); // a null input taints its SKU
  production("p-unasked", {}, [["not-asked", 9]]);
  return { productions, production_inputs: inputs };
}

describe("sumConsumedOzWindow", () => {
  it("sums 300+ live productions at the shop in (after, until] without spending the id list", async () => {
    const sb = withInListGuard(createFakeDb(seed()).client);
    expect(await sumConsumedOzWindow(sb, ["ham", "turkey", "cheese", "lettuce"], L, AFTER, UNTIL)).toEqual(new Map<string, number | null>([
      ["ham", 300 * 2 + 5],
      ["turkey", 100 * 1.5],
      ["cheese", null],
      ["lettuce", 0],
    ]));
  });

  it("an open window runs to the end of the ledger", async () => {
    const sb = withInListGuard(createFakeDb(seed()).client);
    expect((await sumConsumedOzWindow(sb, ["ham"], L, AFTER, null)).get("ham")).toBe(300 * 2 + 5 + 1000);
  });

  it("is one paged read: no production header round trip", async () => {
    const db = createFakeDb(seed());
    await sumConsumedOzWindow(withInListGuard(db.client), ["ham"], L, AFTER, UNTIL);
    expect(db.log.map((q) => q.table)).toEqual(["production_inputs"]);
  });
});

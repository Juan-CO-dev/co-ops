import { describe, expect, it } from "vitest";
import { parsePack } from "@/lib/vendor-import-shared/parsers";
import type { CatalogSku, ExportRow } from "@/lib/vendor-import-shared/model";
import { matchObservations } from "@/lib/vendor-import-shared/match";

/**
 * Audit W04/B042. A GLOBAL import (no shop) must prove the physical hierarchy of a multi-level chain
 * before it proposes a price, exactly as a shop import does. 12 x 32 oz and 24 x 16 oz weigh the same,
 * and a price read against a hierarchy nobody accepted must wait for a person.
 */
const row = (pack: string, extra: Partial<ExportRow> = {}): ExportRow => ({ vendor: "v1", source_file: "x", source_line: 1, account_id: "", list_name: "", category: "", item_no: "123", description: "Sauce", brand: "", ...parsePack(pack), uom: "CS", price_cents: 12000, price_per_lb_cents: null, last_purchase_qty: null, last_purchase_uom: null, last_purchase_date: null, exported_at: "2026-11-10", ...extra });
const chained = (extra: Partial<CatalogSku> = {}): CatalogSku => ({ id: "s", vendor_id: "v1", location_id: null, name: "Sauce", item_number: "123", active: true, root: { levelId: "case", label: "case", quantity: 384, unit: "oz", dimension: "weight" }, packCounts: [12], latestPrice: { id: "p", unit_price: 100, effective_date: "2026-10-01" }, price_basis: "per_each", ...extra });

describe("W04/B042 global imports prove the pack hierarchy before pricing", () => {
  it("holds a 24/16 OZ row against a 12 x 32 oz chain (same total) for a person, with no price", () => {
    const observations = matchObservations([row("24/16 OZ")], [chained()], "v1");
    expect(observations.some((o) => o.kind === "price")).toBe(false);
    expect(observations).toEqual([expect.objectContaining({ kind: "needs_person", reason: "pack_hierarchy_review", proposed: null })]);
  });

  it("holds a multi-level row whose total changed too (no price read against the old chain)", () => {
    const observations = matchObservations([row("12/16 OZ")], [chained()], "v1");
    expect(observations.some((o) => o.kind === "price" || o.kind === "pack")).toBe(false);
    expect(observations[0]).toMatchObject({ kind: "needs_person", reason: "pack_hierarchy_review" });
  });

  it("still prices a matching 12/32 OZ row at the root", () => {
    const observations = matchObservations([row("12/32 OZ")], [chained()], "v1");
    expect(observations).toEqual([expect.objectContaining({ kind: "price", reason: "price_changed", proposed: { unit_price: 120, effective_date: "2026-11-10" } })]);
  });

  it("keeps a global item-number fill beside the hold", () => {
    const observations = matchObservations([row("24/16 OZ")], [chained({ item_number: null })], "v1");
    expect(observations.map((o) => o.kind).sort()).toEqual(["item_number", "needs_person"]);
  });

  it("leaves single-level SKUs and unproven chains on the existing global path (pack proposals allowed)", () => {
    const single = chained({ root: { levelId: "r", label: "case", quantity: 16, unit: "oz", dimension: "weight" }, packCounts: [], latestPrice: { id: "p", unit_price: 1, effective_date: "2026-10-01" } });
    expect(matchObservations([row("1/2 LB", { price_cents: 800 })], [single], "v1").map((o) => o.kind).sort()).toEqual(["pack", "price"]);
    const unproven = { ...single, packCounts: undefined };
    expect(matchObservations([row("1/2 LB", { price_cents: 800 })], [unproven], "v1").map((o) => o.kind).sort()).toEqual(["pack", "price"]);
  });
});

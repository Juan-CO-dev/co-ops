/** Catalog Phase 2a — the ONE version resolver (pure): live, as of an instant, prices, flat content, gates. */
import { describe, expect, it } from "vitest";
import {
  CATALOG_LEVEL6_WRITE_ROLES, FIRST_GLOBAL_WRITE_MIN, GLOBAL_VERSION_WRITE_MIN, SHOP_VERSION_WRITE_MIN, catalogWriteRoleAllowed,
  asOfForBusinessDate, assertScopeToken, catalogShopAllowed, contentOzForScope, levelsBySku,
  packsFromVersions, pickVersionsAsOf, priceCentsFromDollars, resolveCurrentPrices, resolvePackLevels,
  skuOwnerAllowed, unitsPerPackForScope, versionWriteGate, type ScopedLevelRow, type ScopedPriceRow, type ScopedVersionRow, type PackPickWarning,
} from "@/lib/sku-versions-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

const lvl = (id: string, sku_id: string, location_id: string | null, version_id: string, ord: number, label = id): ScopedLevelRow => ({
  id, sku_id, version_id, location_id, effective_from: location_id ? "2026-10-10T00:00:00Z" : "2026-08-01T00:00:00Z",
  label, contains_qty: ord === 0 ? 4 : "80", contains_level_id: ord === 0 ? `${sku_id}-${location_id ?? "g"}-1` : null,
  contains_measure_unit: ord === 0 ? null : "oz", display_ordinal: ord,
});

describe("resolvePackLevels — this shop's live version, else the global one", () => {
  const rows = [
    lvl("t-g-0", "turkey", null, "v-g", 0, "case"), lvl("t-g-1", "turkey", null, "v-g", 1, "bag"),
    lvl("t-s-0", "turkey", "shop-a", "v-s", 0, "case"), lvl("t-s-1", "turkey", "shop-a", "v-s", 1, "bag"),
    lvl("h-g-0", "ham", null, "v-h", 1, "pack"),
    lvl("x-b-0", "cheese", "shop-b", "v-b", 1, "block"),
  ];
  it("a shop version beats the global one for that shop", () => {
    const r = resolvePackLevels(rows, "shop-a").get("turkey")!;
    expect(r).toMatchObject({ versionId: "v-s", locationId: "shop-a", effectiveFrom: "2026-10-10T00:00:00Z" });
    expect(r.levels.map((l) => l.id)).toEqual(["t-s-0", "t-s-1"]);
  });
  it("with no shop version the shop reads the global one", () => {
    expect(resolvePackLevels(rows, "shop-a").get("ham")!.versionId).toBe("v-h");
  });
  it("another shop's version is never this shop's answer; the global scope ignores every shop row", () => {
    expect(resolvePackLevels(rows, "shop-a").has("cheese")).toBe(false);
    expect(resolvePackLevels(rows, null).get("turkey")!.versionId).toBe("v-g");
  });
  it("rows without the 0259 columns read as global, and levels keep input order", () => {
    const legacy = [{ id: "a", sku_id: "s", label: "case", contains_qty: "2", contains_level_id: "b", contains_measure_unit: null, display_ordinal: 0 },
      { id: "b", sku_id: "s", label: "bag", contains_qty: 5, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1 }] as ScopedLevelRow[];
    expect(resolvePackLevels(legacy, "shop-a").get("s")).toMatchObject({ locationId: null, versionId: null });
    expect(levelsBySku(resolvePackLevels(legacy, null)).get("s")).toEqual([
      { id: "a", label: "case", containsQty: 2, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
    ]);
  });
});

describe("as of an instant (D1) — the version IN FORCE then", () => {
  const v = (id: string, sku: string, loc: string | null, from: string, to: string | null): ScopedVersionRow => ({ id, sku_id: sku, location_id: loc, valid_from: from, valid_to: to });
  const versions = [
    v("g1", "turkey", null, "2026-08-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    v("g2", "turkey", null, "2026-10-01T00:00:00Z", null),
    v("s1", "turkey", "shop-a", "2026-10-15T14:00:00Z", null),
    v("s0", "ham", "shop-a", "2026-09-01T00:00:00Z", "2026-09-10T00:00:00Z"), // back to default on 09-10
    v("h1", "ham", null, "2026-08-01T00:00:00Z", null),
  ];
  it("yesterday reads the global version in force; today (after the shop save) reads the shop's", () => {
    expect(pickVersionsAsOf(versions, "shop-a", "2026-10-15T03:59:59.999Z").get("turkey")!.id).toBe("g2");
    expect(pickVersionsAsOf(versions, "shop-a", "2026-10-16T03:59:59.999Z").get("turkey")!.id).toBe("s1");
    expect(pickVersionsAsOf(versions, null, "2026-09-15T00:00:00Z").get("turkey")!.id).toBe("g1");
  });
  it("a retired shop version answers only inside its own dates (back to default)", () => {
    expect(pickVersionsAsOf(versions, "shop-a", "2026-09-05T00:00:00Z").get("ham")!.id).toBe("s0");
    expect(pickVersionsAsOf(versions, "shop-a", "2026-09-10T00:00:00Z").get("ham")!.id).toBe("h1");
  });
  it("packsFromVersions builds the chain of exactly the picked version, in level order", () => {
    const picked = pickVersionsAsOf(versions, "shop-a", "2026-10-16T03:59:59.999Z");
    const packs = packsFromVersions(picked, [lvl("x", "turkey", "shop-a", "s1", 0, "case"), lvl("y", "turkey", null, "g2", 0, "case"), lvl("z", "turkey", "shop-a", "s1", 1, "bag")]);
    expect(packs.get("turkey")).toMatchObject({ versionId: "s1", locationId: "shop-a", effectiveFrom: "2026-10-15T14:00:00Z" });
    expect(packs.get("turkey")!.levels.map((l) => l.id)).toEqual(["x", "z"]);
  });
  it("a shop version whose levels did not load falls back to the global version in force — with a NAMED warning, never silently", () => {
    const picked = pickVersionsAsOf(versions, "shop-a", "2026-10-16T03:59:59.999Z");
    expect(picked.get("turkey")!.globalFallback?.id).toBe("g2");
    const warnings: PackPickWarning[] = [];
    // s1's levels are absent from the loaded set; g2's are present.
    const packs = packsFromVersions(picked, [lvl("y", "turkey", null, "g2", 0, "case"), lvl("h", "ham", null, "h1", 0, "pack")], warnings);
    expect(packs.get("turkey")).toMatchObject({ versionId: "g2", locationId: null, fallbackFromVersionId: "s1" });
    expect(packs.get("turkey")!.levels.map((l) => l.id)).toEqual(["y"]);
    expect(warnings).toEqual([{ code: "shop_version_levels_missing", skuId: "turkey", versionId: "s1", locationId: "shop-a", fellBackToVersionId: "g2" }]);
  });
  it("…and when neither the shop nor the global version has levels, both absences are named", () => {
    const picked = pickVersionsAsOf(versions, "shop-a", "2026-10-16T03:59:59.999Z");
    const warnings: PackPickWarning[] = [];
    const packs = packsFromVersions(picked, [], warnings);
    expect(packs.size).toBe(0);
    expect(warnings).toEqual(expect.arrayContaining([
      { code: "shop_version_levels_missing", skuId: "turkey", versionId: "s1", locationId: "shop-a", fellBackToVersionId: null },
      { code: "global_version_levels_missing", skuId: "ham", versionId: "h1", locationId: null, fellBackToVersionId: null },
    ]));
    expect(warnings).toHaveLength(2);
  });
  it("a pre-chain baseline version answers with the flat pack it preserved (Astra 2b r2#5)", () => {
    const flat = { pack_format: "case", each_container_label: null, units_per_pack: 24, each_size: 1, each_measure: "lb" };
    const vs = [
      { ...v("base", "lettuce", null, "2000-01-01T00:00:00Z", "2026-10-15T14:00:00Z"), flat_snapshot: flat },
      v("first", "lettuce", null, "2026-10-15T14:00:00Z", null),
    ];
    const yesterday = packsFromVersions(pickVersionsAsOf(vs, null, "2026-10-15T03:59:59.999Z"), []);
    expect(yesterday.get("lettuce")).toMatchObject({ versionId: "base", levels: [], flat });
    const today = packsFromVersions(pickVersionsAsOf(vs, null, "2026-10-16T03:59:59.999Z"), [lvl("c", "lettuce", null, "first", 1, "case")]);
    expect(today.get("lettuce")!.flat).toBeUndefined();
  });
  it("a business date resolves at its last instant (ET)", () => {
    expect(asOfForBusinessDate("2026-10-14")).toBe("2026-10-15T03:59:59.999Z"); // EDT
    expect(asOfForBusinessDate("2026-12-14")).toBe("2026-12-15T04:59:59.999Z"); // EST
  });
});

describe("contentOzForScope — the two flat-path consumers (production, surplus)", () => {
  const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["lb", { dimension: "weight", toBaseFactor: 16 }]]);
  const flat = { unitsPerPack: 24, eachSize: 1, eachMeasure: "lb", avgOzPerEach: null };
  it("global answer: today's flat mirror, byte-for-byte (the chain is ignored, exactly as before)", () => {
    expect(contentOzForScope(flat, undefined, measures)).toBe(384);
    expect(contentOzForScope(flat, { levels: [{ id: "c", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }], versionId: "g", locationId: null, effectiveFrom: null }, measures)).toBe(384);
  });
  it("a shop version answers through its chain (it has no flat mirror)", () => {
    expect(contentOzForScope(flat, { levels: [{ id: "c", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }], versionId: "s", locationId: "shop-a", effectiveFrom: null }, measures)).toBe(192);
  });
});

describe("unitsPerPackForScope — prep's 'each' comes from the SAME pack as its content", () => {
  const shop = (levels: Array<[string, number, string | null, string | null]>) => ({
    levels: levels.map(([id, q, next, unit], i) => ({ id, label: id, containsQty: q, containsLevelId: next, containsMeasureUnit: unit, displayOrdinal: i })),
    versionId: "s", locationId: "shop-a", effectiveFrom: null,
  });
  it("a shop's 4 × 10 lb case is 4 per pack — never the global flat 6", () => {
    expect(unitsPerPackForScope(6, shop([["case", 4, "bag", null], ["bag", 10, null, "lb"]]))).toBe(4);
  });
  it("global answers stay the flat mirror; a one-level shop chain is 1; a malformed chain is null", () => {
    expect(unitsPerPackForScope(6, undefined)).toBe(6);
    expect(unitsPerPackForScope(6, { ...shop([["case", 4, "bag", null], ["bag", 10, null, "lb"]]), locationId: null })).toBe(6);
    expect(unitsPerPackForScope(6, shop([["case", 12, null, "lb"]]))).toBe(1);
    expect(unitsPerPackForScope(6, shop([["a", 2, "b", null], ["b", 3, "a", null]]))).toBeNull();
  });
});

describe("resolveCurrentPrices — the shop's live lane, else the global head", () => {
  const p = (id: string, sku: string, unit_price: number | string, date: string, location_id: string | null = null, price_lane_id: string | null = null): ScopedPriceRow =>
    ({ id, vendor_item_id: sku, unit_price, effective_date: date, recorded_at: `${date}T12:00:00Z`, location_id, price_lane_id });
  const rows = [
    p("p5", "turkey", 150, "2026-10-12", "shop-a", "lane-a"),
    p("p4", "turkey", 128, "2026-10-01"),
    p("p3", "turkey", 140, "2026-09-20", "shop-a", "lane-old"),
    p("p2", "ham", "3.10", "2026-10-02"),
    p("p1", "ham", 2.9, "2026-09-02"),
  ];
  it("no lanes: first parseable global row per SKU — today's rule", () => {
    const r = resolveCurrentPrices(rows, new Map());
    expect(r.get("turkey")).toMatchObject({ value: 128, priceId: "p4", laneId: null, locationId: null });
    expect(r.get("ham")!.value).toBe(3.1);
  });
  it("a live lane prices the shop from that lane only; a retired lane's rows are ignored", () => {
    expect(resolveCurrentPrices(rows, new Map([["turkey", "lane-a"]])).get("turkey")).toMatchObject({ value: 150, laneId: "lane-a" });
    expect(resolveCurrentPrices(rows.filter((x) => x.id !== "p5"), new Map([["turkey", "lane-a"]])).get("turkey")!.priceId).toBe("p4");
  });
  it("an unparseable row is skipped exactly as today; cents round with the PO's rule", () => {
    expect(resolveCurrentPrices([p("bad", "ham", "x", "2026-10-03"), ...rows], new Map()).get("ham")!.priceId).toBe("p2");
    expect(priceCentsFromDollars(19.99)).toBe(1999);
    expect(priceCentsFromDollars(0.1 + 0.2)).toBe(30);
  });
});

describe("the catalog shop allowance (D2) and the write gates (spec §2)", () => {
  it("floors", () => {
    expect([SHOP_VERSION_WRITE_MIN, GLOBAL_VERSION_WRITE_MIN, FIRST_GLOBAL_WRITE_MIN.pack, FIRST_GLOBAL_WRITE_MIN.price]).toEqual([6, 8, 7, 6]);
  });
  it("a GLOBAL write to a shop-OWNED SKU binds that shop below MoO; a shared SKU follows the first-value rule (r3#1)", () => {
    expect(skuOwnerAllowed({ level: 6, locations: ["shop-a"] }, "shop-b")).toBe(false);
    expect(skuOwnerAllowed({ level: 7, locations: ["shop-a"] }, "shop-a")).toBe(true);
    expect(skuOwnerAllowed({ level: 6, locations: ["shop-a"] }, null)).toBe(true);
    expect(skuOwnerAllowed({ level: 8, locations: [] }, "shop-b")).toBe(true);
  });
  it("MoO (8) and up may work in ANY shop; GM/AGM only their memberships", () => {
    expect(catalogShopAllowed({ level: 8, locations: [] }, "shop-b")).toBe(true);
    expect(catalogShopAllowed({ level: 7, locations: ["shop-a"] }, "shop-b")).toBe(false);
    expect(catalogShopAllowed({ level: 6, locations: ["shop-a"] }, "shop-a")).toBe(true);
  });
  it("a shop version needs level 6 AND the shop", () => {
    expect(versionWriteGate({ kind: "pack", role: "shift_lead", level: 5, scope: "a", scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(versionWriteGate({ kind: "pack", role: "gm", level: 7, scope: "a", scopeAllowed: false })).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(versionWriteGate({ kind: "price", role: "agm", level: 6, scope: "a", scopeAllowed: true })).toEqual({ ok: true, firstOnly: false });
  });
  it("global: MoO+ freely; a GM (pack) / AGM (price) only the FIRST value — the database decides that, atomically", () => {
    expect(versionWriteGate({ kind: "pack", role: "moo", level: 8, scope: null, scopeAllowed: false })).toEqual({ ok: true, firstOnly: false });
    expect(versionWriteGate({ kind: "pack", role: "gm", level: 7, scope: null, scopeAllowed: false })).toEqual({ ok: true, firstOnly: true });
    expect(versionWriteGate({ kind: "pack", role: "agm", level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(versionWriteGate({ kind: "price", role: "agm", level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: true, firstOnly: true });
  });
  it("level 6 is the OPERATIONAL managers only: AGM, prep, catering — never social media (role check, not level-only)", () => {
    expect([...CATALOG_LEVEL6_WRITE_ROLES].sort()).toEqual(["agm", "catering_mgr", "prep_mgr"]);
    for (const role of ["agm", "prep_mgr", "catering_mgr"] as const) {
      expect(catalogWriteRoleAllowed(role, 6)).toBe(true);
      expect(versionWriteGate({ kind: "pack", role, level: 6, scope: "a", scopeAllowed: true })).toEqual({ ok: true, firstOnly: false });
      expect(versionWriteGate({ kind: "price", role, level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: true, firstOnly: true });
    }
    expect(catalogWriteRoleAllowed("social_media_mgr", 6)).toBe(false);
    expect(versionWriteGate({ kind: "pack", role: "social_media_mgr", level: 6, scope: "a", scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(versionWriteGate({ kind: "price", role: "social_media_mgr", level: 6, scope: "a", scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(versionWriteGate({ kind: "price", role: "social_media_mgr", level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "forbidden" });
    // GM and up: every role at that level; below 6 nobody.
    expect(catalogWriteRoleAllowed("gm", 7)).toBe(true);
    expect(catalogWriteRoleAllowed("moo", 8)).toBe(true);
    expect(catalogWriteRoleAllowed("shift_lead", 5)).toBe(false);
  });
  it("assertScopeToken refuses anything that could break a PostgREST filter", () => {
    expect(assertScopeToken("6f1d2c3e-0000-4000-8000-000000000001")).toBe("6f1d2c3e-0000-4000-8000-000000000001");
    expect(() => assertScopeToken("a,location_id.is.null")).toThrow(/scope/);
  });
});

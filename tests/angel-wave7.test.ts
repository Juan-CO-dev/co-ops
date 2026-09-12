/** Wave 7: prove physical denominators and refusals with synthetic invoice evidence. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SOURCE, canonical, identityKey, isoDate, parseHistory, parsePack, planRow, planWave7,
  readManifest, refusal, selectInvoices,
  type ManifestRow, type Snapshot,
} from "@/lib/angel-wave7";
import type { PurchaseRow } from "@/lib/angel-wave4";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { bundleFor, loadAll, operationUuid, reviewDigest, validateTarget } from "@/scripts/seed/26-angel-wave7";
import { evaluateWave7Tables, verifyWave7Scope } from "@/scripts/parity-angel";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import wave7Manifest from "@/docs/angel-wave7-manifest.json";

const AS_OF = "2026-09-10";
const ID = "00000000-0000-4000-8000-000000000001";
const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
  ["gal", { dimension: "volume", toBaseFactor: 128 }],
]);
function row(over: Partial<ManifestRow> = {}): ManifestRow {
  return {
    revision: "r1", row_n: 1,
    angel: { product: "TEST BUTTER", brand: "TEST BRAND", manufacturer: "TEST MAKER", vendor: "TEST VENDOR", pack_size: "36/1 LB", source_file: "synthetic.csv", source_line: 2, weight_source: "default_one_lb" },
    selected_sku: { id: ID, name: "Test Butter", vendor: "Test Supplier", pack_format: "box", active: true, item_number: "A1" },
    decision: "selected", vendor_binding: "vendor-match", confidence: "HIGH", evidence: "Reviewed synthetic mapping", meaning: "same product", owner_question: "", owner_answer: "Confirmed", ...over,
  };
}
function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    sku: { id: ID, name: "Test Butter", vendor_id: "vendor-1", active: true, item_number: "A1", pack_format: "box", units_per_pack: 1, each_size: 16, each_measure: "oz", sku_class: "raw", avg_oz_per_each: null, weight_class: null },
    vendor: { id: "vendor-1", name: "Test Supplier", active: true }, chain: [], price: null, ...over,
  };
}
function invoice(r = row(), over: Partial<PurchaseRow> = {}): PurchaseRow {
  return { date: "Sep 01, 2026", product: r.angel.product, brand: r.angel.brand, manufacturer: r.angel.manufacturer, vendor: r.angel.vendor, packSize: r.angel.pack_size, quantity: 1, unitPricePerCase: 81.11, pricePerLb: null, netWeightLbs: null, lbsPerUnit: null, weightSource: "default_one_lb", lineTotal: 81.11, ...over };
}
function withPack(pack: string, sku: Record<string, unknown>) {
  const r = row(); r.angel.pack_size = pack;
  const s = snapshot(); Object.assign(s.sku, sku);
  r.selected_sku!.pack_format = String(s.sku.pack_format);
  return { r, s };
}
const codes = (d: ReturnType<typeof planRow>) => d.refusals.map(f => f.code);

describe("owner pack hole filling", () => {
  const owner = { pack: "35/12 FL OZ", source: "Juan 2026-08-28 label" };
  function fixture(pack = "—") {
    const { r, s } = withPack(pack, { units_per_pack: 35, each_size: 12, each_measure: "fl oz", avg_oz_per_each: 1, weight_class: "ESTIMATE" });
    r.owner_pack = owner;
    const registry = new Map(measures).set("fl oz", { dimension: "volume", toBaseFactor: 1 });
    return { r, s, registry };
  }
  it.each(["—", "", "unknown"])("prices missing or unsupported Angel pack %j and preserves invoice join/provenance", pack => {
    const { r, s, registry } = fixture(pack);
    const d = planRow(r, s, [invoice(r)], registry, AS_OF);
    expect(d.intent?.price.unit_price).toBe(81.11);
    expect(d.intent?.owner_pack).toEqual(owner);
    expect(bundleFor(d.intent!, "test", {}).owner_pack).toEqual(owner);
    expect(d.intent?.evidence.manifest.angel.pack_size).toBe(pack);
    expect(d.intent?.evidence.arithmetic).toContain("(owner pack: 35/12 FL OZ — Juan 2026-08-28 label)");
    expect(d.refusals.every(f => f.message.includes("(owner pack:"))).toBe(true);
    expect(readManifest(JSON.stringify({ wave: SOURCE, built_by: "test", rows: [r] })).rows[0]?.owner_pack).toEqual(owner);
  });
  it("refuses a hole without owner evidence", () => {
    const { r, s, registry } = fixture(); delete r.owner_pack;
    expect(codes(planRow(r, s, [invoice(r)], registry, AS_OF))).toContain("UNSUPPORTED_PACK_SYNTAX");
  });
  it("rejects owner overrides of parseable invoices", () => {
    const { r } = fixture("24/12 FL OZ");
    expect(() => readManifest(JSON.stringify({ wave: SOURCE, built_by: "test", rows: [r] }))).toThrow("Invalid wave-7 reviewed row");
  });
  it.each([null, {}, { pack: "", source: "label" }, { pack: "1 CT", source: " " }, { pack: "unknown", source: "label" }, { pack: 12, source: "label" }])("rejects malformed owner evidence %j", owner_pack => {
    const { r } = fixture();
    expect(() => readManifest(JSON.stringify({ wave: SOURCE, built_by: "test", rows: [{ ...r, owner_pack }] }))).toThrow("Invalid wave-7 reviewed row");
  });
  it("labels invoice-join refusals too", () => {
    const { r, s, registry } = fixture();
    expect(planRow(r, s, [], registry, AS_OF).refusals[0]?.message).toContain("(owner pack:");
  });
  it("scales a gallon jar invoice to the four-jar order case", () => {
    const { r, s, registry } = fixture();
    r.owner_pack = { pack: "1/128 FL OZ", source: "CC inference flagged for Juan" };
    Object.assign(s.sku, { units_per_pack: 4, each_size: 128 });
    expect(planRow(r, s, [invoice(r, { unitPricePerCase: 8.95, lineTotal: 8.95 })], registry, AS_OF).intent?.price.unit_price).toBe(35.8);
  });
  it("keeps r4 uncertainties pending and routes both onions to the consuming SKU", () => {
    const manifest = readManifest(JSON.stringify(wave7Manifest));
    // r4b (Juan 2026-09-11): Dr. Brown's per 6-pack, prosciutto per our 12 oz pack, pickle chips = the 1,500-slice tub.
    expect(manifest.rows.filter(r => r.owner_pack).map(r => r.row_n)).toEqual([16, 24, 25, 30, 31, 43, 45, 84, 93, 94, 100, 103, 147, 149]);
    for (const n of [50]) expect(manifest.rows.find(r => r.row_n === n)?.decision).toBe("pending");
    for (const n of [16, 30, 84, 93, 94, 100, 147, 149]) expect(manifest.rows.find(r => r.row_n === n)?.decision).toBe("selected");
    for (const n of [78, 143]) expect(manifest.rows.find(r => r.row_n === n)?.decision).toBe("rejected");
    for (const n of [18, 113]) expect(manifest.rows.find(r => r.row_n === n)).toMatchObject({ vendor_binding: "vendor-match", selected_sku: { id: "17422bb2-b29b-4a57-9c23-c53bd9d43403", name: "Onion (White)", pack_format: "Bag" } });
  });
  it("uses the actual purchase history for owner-pack prices and the August onion winner", () => {
    const manifest = readManifest(JSON.stringify(wave7Manifest));
    const history = parseHistory(readFileSync("docs/angel-purchase-history.csv", "utf8"));
    const registry = new Map(measures).set("fl oz", { dimension: "volume", toBaseFactor: 1 });
    const snapshots = new Map<string, Snapshot>();
    // Physical states are CC's 2026-09-11 verified facts from the dispatch; no DB read.
    for (const r of manifest.rows.filter(r => r.owner_pack || [18, 113].includes(r.row_n))) {
      const selected = r.selected_sku!;
      const onion = [18, 113].includes(r.row_n), pepper = [25, 103].includes(r.row_n);
      snapshots.set(selected.id, snapshot({
        sku: { ...snapshot().sku, ...selected, vendor_id: "vendor-1", units_per_pack: onion ? 1 : pepper ? 4 : r.row_n === 45 ? 24 : 35, each_size: onion ? 800 : pepper ? 128 : 12, each_measure: onion ? "oz" : "fl oz", avg_oz_per_each: 1, weight_class: "ESTIMATE" },
        vendor: { id: "vendor-1", name: selected.vendor, active: true },
      }));
    }
    const decisions = planWave7(manifest, snapshots, history, registry, "2026-09-11");
    // $32.40 is an older line; the Aug 14 row of record is $35.33.
    for (const [n, price] of [[24, 25.45], [31, 25.45], [45, 12.95], [25, 35.8], [103, 35], [18, 35.33]]) {
      expect(decisions.find(d => d.row.row_n === n)?.intent?.price.unit_price).toBe(price);
    }
    expect(decisions.find(d => d.row.row_n === 113)?.selection).toContain("row of record #18");
  });
});

describe("reviewed identity and source selection", () => {
  it("normalizes missing sentinels without collapsing different brands or vendors", () => {
    expect(identityKey(" P ", "-", "V", "—")).toBe(identityKey("P", "", "V", ""));
    expect(identityKey("P", "A", "V", "1 CT")).not.toBe(identityKey("P", "B", "V", "1 CT"));
    expect(identityKey("P", "A", "V", "1 CT")).not.toBe(identityKey("P", "A", "W", "1 CT"));
  });
  it.each(["2026-02-30", "2026-13-01", "not a date"])("rejects unsupported date %s", value => expect(isoDate(value)).toBeNull());
  it("selects latest invoice and date together, not the historical maximum", () => {
    const result = selectInvoices(row(), [invoice(undefined, { date: "Aug 01, 2026", unitPricePerCase: 90.36, lineTotal: 90.36 }), invoice()], AS_OF);
    expect("code" in result).toBe(false);
    if ("code" in result) throw new Error(result.message);
    expect(result.date).toBe("2026-09-01"); expect(result.latest.unitPricePerCase).toBe(81.11);
  });
  it("never joins a different pack under the same product name", () => {
    expect(selectInvoices(row(), [invoice(undefined, { packSize: "1/50 LB" })], AS_OF)).toMatchObject({ code: "SOURCE_JOIN_FAILED" });
  });
  it("refuses latest-day price ambiguity rather than first-wins", () => {
    expect(selectInvoices(row(), [invoice(), invoice(undefined, { unitPricePerCase: 80, lineTotal: 80 })], AS_OF)).toMatchObject({ code: "LATEST_INVOICE_AMBIGUOUS" });
  });
  it.each([
    { quantity: 0 }, { unitPricePerCase: NaN }, { lineTotal: 2 }, { date: "Sep 11, 2026" },
    { weightSource: "invoice_catch_weight", netWeightLbs: 20, lbsPerUnit: 1 },
  ])("refuses invalid or inconsistent invoice values %j", over => {
    expect(selectInvoices(row(), [invoice(undefined, over)], AS_OF)).toMatchObject({ code: "INVALID_SOURCE_DATA" });
  });
  it("refuses duplicate observations before they bias weights", () => {
    expect(selectInvoices(row(), [invoice(), invoice()], AS_OF)).toMatchObject({ code: "INVALID_SOURCE_DATA" });
  });
  it("weights invoices by received quantity instead of averaging rounded unit weights", () => {
    const a = invoice(undefined, { quantity: 1, netWeightLbs: 10, lbsPerUnit: 10, weightSource: "invoice_catch_weight" });
    const b = invoice(undefined, { date: "Aug 31, 2026", quantity: 3, lineTotal: 243.33, netWeightLbs: 18, lbsPerUnit: 6, weightSource: "invoice_catch_weight" });
    const result = selectInvoices(row(), [a, b], AS_OF);
    if ("code" in result) throw new Error(result.message);
    expect(result.average?.meanLbs).toBe(7); expect(result.average?.meanUnweightedLbs).toBe(8);
  });
  it("rejects duplicate manifest row numbers and selected mappings with no evidence", () => {
    expect(() => readManifest(JSON.stringify({ wave: SOURCE, built_by: "test", rows: [row(), row()] }))).toThrow();
    expect(() => readManifest(JSON.stringify({ wave: SOURCE, built_by: "test", rows: [row({ evidence: "" })] }))).toThrow();
  });
});

describe("anchored pack syntax", () => {
  it.each([["10/100 CT", 1000], ["250/1 CT", 250], ["200/1 EA", 200], ["120 CT", 120]])("parses actual item counts in %s", (text, total) => expect(parsePack(text)).toMatchObject({ dimension: "count", total }));
  it("keeps #10 cans in count-space", () => expect(parsePack("6/#10 CN")).toMatchObject({ dimension: "can", total: 6 }));
  it("keeps gallons in volume-space", () => expect(parsePack("4/1 GA")).toMatchObject({ dimension: "volume", total: 512 }));
  it("keeps one roll as one roll", () => expect(parsePack("1 RL")).toMatchObject({ dimension: "roll", total: 1 }));
  it.each(["18X500", "40X46", "8 OZ bowls", "1/0 CT", "2/1.5 CT", "-", "case", "2 RL", "1/12 CT extra"])("refuses ambiguous or invalid syntax %s", text => expect(parsePack(text)).toBeNull());
});

describe("physical price and pack plans", () => {
  it("prices one pound of butter from the latest 36-pound case", () => {
    const d = planRow(row(), snapshot(), [invoice()], measures, AS_OF);
    expect(d.intent?.price.unit_price).toBe(2.25);
    expect(d.intent?.price.effective_date).toBe("2026-09-01");
    expect(d.intent?.price.source_note).toContain("TEST BUTTER [TEST BRAND] 36/1 LB");
  });
  it("prefers six physical tuna cans to a rounded mass divisor", () => {
    const { r, s } = withPack("6/66.5OZ", { each_size: 66.6, pack_format: "can" });
    const d = planRow(r, s, [invoice(r, { unitPricePerCase: 60, lineTotal: 60 })], measures, AS_OF);
    expect(d.intent?.price.unit_price).toBe(10);
  });
  it("prices a gallon by container ratio without claiming mass", () => {
    const { r, s } = withPack("4/1 GA", { each_size: 1, each_measure: "gal", pack_format: "jug" });
    const d = planRow(r, s, [invoice(r, { unitPricePerCase: 80, lineTotal: 80 })], measures, AS_OF);
    expect(d.intent?.price.unit_price).toBe(20); expect(d.intent?.weight).toBeNull();
    expect(d.intent?.evidence.afterOz).toBeNull();
  });
  it("refuses mass-to-volume arithmetic without a proven relationship", () => {
    const { r, s } = withPack("4/1 GA", { each_size: 128, each_measure: "oz" });
    const d = planRow(r, s, [invoice(r)], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain("PACK_PREMISE_BROKEN");
  });
  it("creates count-only supply chain without inventing inner sleeves or ounces", () => {
    const { r, s } = withPack("250/1 CT", { sku_class: "packaging", pack_format: "case", units_per_pack: null, each_size: null, each_measure: null });
    const d = planRow(r, s, [invoice(r)], measures, AS_OF);
    expect(d.intent?.chain).toEqual([{ label: "case", containsQty: 250, containsIndex: null, containsMeasureUnit: "each" }]);
    expect(d.intent?.price.unit_price).toBe(81.11); expect(d.intent?.evidence.afterOz).toBeNull();
  });
  it("does not reinterpret a known 100-item box as a 1000-item case", () => {
    const { r, s } = withPack("10/100 CT", { sku_class: "packaging", each_measure: "each", each_size: 100 });
    const d = planRow(r, s, [invoice(r)], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain("PACK_PREMISE_BROKEN");
  });
  it("refuses a supply whose existing order root is unresolved", () => {
    const { r, s } = withPack("10/100 CT", { sku_class: "packaging", pack_format: "unknown", each_size: null, each_measure: null });
    expect(codes(planRow(r, s, [invoice(r)], measures, AS_OF))).toContain("OUR_PACK_UNRESOLVABLE");
  });
  it.each(["1/240 CT", "240/1 CT", "1/240 EA", "240/1 EA", "240 EA"])("infers a missing supply order root from %s", pack => {
    for (const classification of [{ sku_class: "packaging" }, { sku_class: "raw", inventory_only: true }]) {
      const { r, s } = withPack(pack, { ...classification, pack_format: "", units_per_pack: null, each_size: null, each_measure: null });
      const d = planRow(r, s, [invoice(r)], measures, AS_OF);
      expect(d.intent?.chain).toEqual([{ label: "Case", containsQty: 240, containsIndex: null, containsMeasureUnit: "each" }]);
      expect(d.intent?.price.unit_price).toBe(81.11);
      expect(d.intent?.evidence.afterOz).toBeNull();
    }
  });
  it("does not infer a missing root for multiple inner groups or a food SKU", () => {
    for (const [pack, sku_class, refusalCode] of [["10/100 CT", "packaging", "OUR_PACK_UNRESOLVABLE"], ["1/240 CT", "raw", "SCALE_GATED"]] as const) {
      const { r, s } = withPack(pack, { sku_class, pack_format: "", units_per_pack: null, each_size: null, each_measure: null });
      const d = planRow(r, s, [invoice(r)], measures, AS_OF);
      expect(codes(d)).toContain(refusalCode);
      expect(d.intent).toBeNull();
    }
  });
  it("resolves manifest Quart (Large) after the r3 vendor refusal is adjudicated", () => {
    const r = readManifest(JSON.stringify(wave7Manifest)).rows.find(r => r.row_n === 109)!;
    expect(r.angel.pack_size).toBe("1/240 CT");
    expect(r.selected_sku).toMatchObject({ name: "Quart (Large)", vendor: "PFG", pack_format: "" });
    const s = snapshot();
    Object.assign(s.sku, r.selected_sku, { vendor_id: "vendor-1", sku_class: "packaging", inventory_only: true, units_per_pack: null, each_size: null, each_measure: null });
    s.vendor = { id: "vendor-1", name: "PFG", active: true };
    const history = [invoice(r, { date: "Aug 7, 2026", unitPricePerCase: 63.71, lineTotal: 63.71 })];
    // Archived wave7-dryrun-sim-r3.txt:357 predates the 0202 PFG re-vendor.
    const r3Refusal = "VENDOR_DRIFT | Quart (Large) | bundle | missing fact: Resolve the fact named above.";
    const historical = planRow({ ...r, vendor_binding: "VENDOR_DRIFT", selected_sku: { ...r.selected_sku!, vendor: "Webstaurant" } }, s, history, measures, AS_OF);
    const held = historical.refusals[0]!;
    expect(`${held.code} | ${r.selected_sku!.name} | ${held.operation} | missing fact: ${held.missingFact}`).toBe(r3Refusal);
    expect(historical.intent).toBeNull();
    const d = planRow(r, s, history, measures, AS_OF);
    expect(codes(d)).not.toContain("OUR_PACK_UNRESOLVABLE");
    expect(d.intent?.chain).toEqual([{ label: "Case", containsQty: 240, containsIndex: null, containsMeasureUnit: "each" }]);
    expect(d.intent?.price.unit_price).toBe(63.71);
    expect(d.intent?.evidence.afterOz).toBeNull();
  });
  it("uses the actual count registry label when each is absent", () => {
    const registry = new Map(measures); registry.delete("each"); registry.set("count", { dimension: "count", toBaseFactor: 1 });
    const { r, s } = withPack("250/1 CT", { sku_class: "packaging", pack_format: "case", units_per_pack: null, each_size: null, each_measure: null });
    const d = planRow(r, s, [invoice(r)], registry, AS_OF);
    expect(d.intent?.chain?.[0]).toMatchObject({ containsQty: 250, containsMeasureUnit: "count" });
    expect(d.intent?.price.unit_price).toBe(81.11);
  });
});

describe("mapping and newer-evidence refusals", () => {
  it.each([
    [{ decision: "pending" } as Partial<ManifestRow>, "MAPPING_UNCONFIRMED"],
    [{ decision: "rejected" } as Partial<ManifestRow>, "NO_MATCH"],
    [{ vendor_binding: "VENDOR_DRIFT" } as Partial<ManifestRow>, "VENDOR_DRIFT"],
  ])("refuses reviewed disposition %j", (over, code) => {
    const d = planRow(row(over), snapshot(), [invoice()], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain(code);
  });
  it("compares live item_number and refuses identity drift", () => {
    const s = snapshot(); s.sku.item_number = "different";
    expect(codes(planRow(row(), s, [invoice()], measures, AS_OF))).toContain("AMBIGUOUS_PRODUCT_IDENTITY");
  });
  it("refuses a changed pack premise", () => {
    const s = snapshot(); s.sku.pack_format = "case";
    expect(codes(planRow(row(), s, [invoice()], measures, AS_OF))).toContain("PACK_SHAPE_CHANGED");
  });
  it("preserves newer app evidence inside the 30-day window", () => {
    const s = snapshot({ price: { id: "new", effective_date: "2026-09-05", source: null, recorded_by: "operator" } });
    const d = planRow(row(), s, [invoice()], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain("NEWER_PRICE_EXISTS");
  });
  it.each([null, "manual_invoice"])("preserves a same-date app price even without recorded_by (%s)", source => {
    const s = snapshot({ price: { id: "same-day-app", effective_date: "2026-09-01", source, recorded_by: null } });
    const d = planRow(row(), s, [invoice()], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain("NEWER_PRICE_EXISTS");
  });
  it("treats manifest empty pack_format and live null as the same missing premise", () => {
    const r = row(); r.selected_sku!.pack_format = "";
    const s = snapshot(); s.sku.pack_format = null;
    const d = planRow(r, s, [invoice()], measures, AS_OF);
    expect(codes(d)).not.toContain("PACK_SHAPE_CHANGED");
  });
  it("prints both dates correctly in an old-price refusal", () => {
    const s = snapshot({ price: { id: "new", effective_date: "2026-09-05", source: null, recorded_by: "operator" } });
    const d = planRow(row(), s, [invoice(undefined, { date: "Aug 01, 2026" })], measures, AS_OF);
    expect(d.refusals[0]?.message).toBe("REFUSED price Test Butter: Angel 2026-08-01 is 40 days old; newer app price 2026-09-05 already exists; N=30.");
  });
  it("permits an old honest invoice to fill an unpriced SKU", () => {
    const d = planRow(row(), snapshot(), [invoice(undefined, { date: "Aug 01, 2026" })], measures, AS_OF);
    expect(d.intent?.price.effective_date).toBe("2026-08-01");
  });
  it("selects a stable row of record when invoice date, lines and prices tie", () => {
    const a = row(), b = row({ row_n: 2 }); b.angel = { ...a.angel, brand: "OTHER BRAND", source_line: 3 };
    const decisions = planWave7({ wave: SOURCE, built_by: "test", rows: [a, b] }, new Map([[ID, snapshot()]]), [invoice(a), invoice(b)], measures, AS_OF);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.intent?.duplicate_decision).toEqual({ row_n: 1, rejected_row_ns: [2] });
    expect(decisions[1]).toMatchObject({ intent: null, rejected: true, refusals: [] });
  });
  it("does not let a rejected competitor block the selected record", () => {
    const a = row(), b = row({ row_n: 2, decision: "rejected" });
    const d = planWave7({ wave: SOURCE, built_by: "test", rows: [a, b] }, new Map([[ID, snapshot()]]), [invoice()], measures, AS_OF);
    expect(d[0]?.intent).not.toBeNull(); expect(d[1]?.intent).toBeNull();
  });
});

describe("revision 2 row of record", () => {
  function cluster() {
    const a = row(), b = row({ row_n: 2 });
    b.angel = { ...b.angel, product: "OTHER BUTTER", brand: "OTHER BRAND" };
    return { a, b, run: (history: PurchaseRow[], s = snapshot()) => planWave7({ wave: SOURCE, built_by: "test", rows: [b, a] }, new Map([[ID, s]]), history, measures, AS_OF) };
  }
  it("chooses latest history date, ignoring manifest recency and order", () => {
    const { a, b, run } = cluster(); a.angel.last_seen = "Sep 10, 2026";
    const ds = run([invoice(a), invoice(b, { date: "Sep 02, 2026" })]);
    expect(ds[0]?.intent?.duplicate_decision).toEqual({ row_n: 2, rejected_row_ns: [1] });
    expect(ds[1]?.selection).toContain("rejected: older latest invoice");
  });
  it("breaks date ties by joined purchase_lines", () => {
    const { a, b, run } = cluster(); a.angel.purchase_lines = 999;
    const ds = run([invoice(a), invoice(b), invoice(b, { date: "Aug 31, 2026" })]);
    expect(ds[0]?.intent?.duplicate_decision?.row_n).toBe(2);
    expect(ds[1]?.selection).toContain("fewer purchase_lines");
  });
  it("eliminates an incompatible newer pack without refusing the competitor", () => {
    const { a, b, run } = cluster(); b.angel.pack_size = "4/1 GA";
    const ds = run([invoice(a), invoice(b, { date: "Sep 02, 2026" })]);
    expect(ds[1]?.intent?.duplicate_decision?.row_n).toBe(1);
    expect(ds[0]).toMatchObject({ intent: null, rejected: true, refusals: [] });
    expect(ds[0]?.selection).toContain("PACK_PREMISE_BROKEN");
  });
  it("rejects a non-integer divisor even though mass arithmetic is possible", () => {
    const { a, b, run } = cluster(); b.angel.pack_size = "1/1.5 LB";
    const ds = run([invoice(a), invoice(b, { date: "Sep 02, 2026" })]);
    expect(ds[1]?.intent?.duplicate_decision?.row_n).toBe(1);
    expect(ds[0]?.selection).toContain("not exact or an integer divisor");
  });
  it("keeps PACK_PREMISE_BROKEN if no competitor resolves", () => {
    const { a, b, run } = cluster(); a.angel.pack_size = b.angel.pack_size = "4/1 GA";
    for (const d of run([invoice(a), invoice(b)])) {
      expect(d.intent).toBeNull(); expect(codes(d)).toContain("PACK_PREMISE_BROKEN"); expect(d.rejected).not.toBe(true);
    }
  });
  it("does not report an equal price as correct when every competing divisor is ineligible", () => {
    const { a, b, run } = cluster(); a.angel.pack_size = b.angel.pack_size = "1/1.5 LB";
    const s = snapshot({ price: { unit_price: 54.07, source: "angel-wave4", effective_date: "2026-08-01" } });
    for (const d of run([invoice(a), invoice(b)], s)) {
      expect(codes(d)).toContain("PACK_PREMISE_BROKEN"); expect(codes(d)).not.toContain("ALREADY_CORRECT");
    }
  });
  it.each([[115, false], [116, true]])("warns strictly above 15%% (%s)", (price, warn) => {
    const { a, b, run } = cluster(); a.angel.pack_size = b.angel.pack_size = "1/1 LB";
    const ds = run([invoice(a, { unitPricePerCase: 100, lineTotal: 100 }), invoice(b, { date: "Sep 02, 2026", unitPricePerCase: price, lineTotal: price })]);
    expect(ds[0]?.intent?.price.unit_price).toBe(price);
    expect(ds[0]?.warnings?.length ?? 0).toBe(warn ? 1 : 0);
    if (warn) expect(ds[0]?.warnings?.[0]).toMatch(/WARN.*OTHER BUTTER.*TEST BUTTER/);
  });
  it("compares normalized pack prices instead of invoice case prices", () => {
    const { a, b, run } = cluster(); a.angel.pack_size = "1/1 LB"; b.angel.pack_size = "2/1 LB";
    const ds = run([invoice(a, { unitPricePerCase: 10, lineTotal: 10 }), invoice(b, { unitPricePerCase: 20, lineTotal: 20, date: "Sep 02, 2026" })]);
    expect(ds[0]?.intent?.price.unit_price).toBe(10); expect(ds[0]?.warnings).toBeUndefined();
  });
  it("does not fall back to an older competitor around a newer app price", () => {
    const { a, b, run } = cluster();
    const ds = run([invoice(a), invoice(b, { date: "Sep 02, 2026" })], snapshot({ price: { unit_price: 2.25, source: "manual", effective_date: "2026-09-03" } }));
    expect(codes(ds[0]!)).toContain("NEWER_PRICE_EXISTS"); expect(ds[1]?.rejected).toBe(true);
    expect(ds.every(d => !d.intent)).toBe(true);
  });
  it("never suppresses pending or vendor-drift rows as rejected competitors", () => {
    const { a, b } = cluster();
    const drift = row({ row_n: 3, vendor_binding: "VENDOR_DRIFT" }), pending = row({ row_n: 4, decision: "pending" });
    const ds = planWave7({ wave: SOURCE, built_by: "test", rows: [a, b, drift, pending] }, new Map([[ID, snapshot()]]), [invoice(a), invoice(b)], measures, AS_OF);
    expect(codes(ds[2]!)).toEqual(["VENDOR_DRIFT"]); expect(codes(ds[3]!)).toEqual(["MAPPING_UNCONFIRMED"]);
  });
});

describe("revision 2 measured purchase pack", () => {
  function unpriced(pack = "4/5 LB") {
    const { r, s } = withPack(pack, { each_size: null, units_per_pack: null, each_measure: null, pack_format: null });
    r.selected_sku!.pack_format = null; r.angel.weight_source = "invoice_catch_weight";
    return { r, s };
  }
  function measured(r: ManifestRow, pounds: number, quantity = 1, date = "Sep 01, 2026") {
    return invoice(r, { date, quantity, lineTotal: 81.11 * quantity, weightSource: "invoice_catch_weight", netWeightLbs: pounds * quantity, lbsPerUnit: pounds });
  }
  it("writes price and quantity-weighted net pack ounces together", () => {
    const { r, s } = unpriced();
    const d = planRow(r, s, [measured(r, 20, 3), measured(r, 20.4, 1, "Aug 31, 2026")], measures, AS_OF);
    expect(d.intent?.price.unit_price).toBe(81.11);
    expect(d.intent?.chain).toEqual([{ label: "case", containsQty: 321.6, containsIndex: null, containsMeasureUnit: "oz" }]);
    expect(d.intent?.evidence).toMatchObject({ afterOz: 321.6, packWeightClass: "INVOICE_DERIVED" });
    expect(d.intent?.weight).toBeNull();
  });
  it("accepts one measured fixed-weight line", () => {
    const { r, s } = unpriced("1/5 LB");
    expect(planRow(r, s, [measured(r, 5)], measures, AS_OF).intent?.chain?.[0]).toMatchObject({ label: "pack", containsQty: 80 });
  });
  it.each(["1/12 CT", "4/1 GA"])("rejects single measured non-fixed-weight pack %s", pack => {
    const { r, s } = unpriced(pack); const d = planRow(r, s, [measured(r, 5)], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain("SCALE_GATED");
  });
  it.each([[19.5, 20.5, true], [19.49, 20.51, false]])("gates the 5%% spread boundary (%s,%s)", (lo, hi, allowed) => {
    const { r, s } = unpriced(); const d = planRow(r, s, [measured(r, lo), measured(r, hi, 1, "Aug 31, 2026")], measures, AS_OF);
    expect(!!d.intent).toBe(allowed); if (!allowed) expect(codes(d)).toContain("SCALE_GATED");
  });
  it("refuses fabricated weights despite a fixed-weight string", () => {
    const { r, s } = unpriced("1/5 LB");
    const d = planRow(r, s, [invoice(r, { netWeightLbs: 5, lbsPerUnit: 5 })], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain("SCALE_GATED");
  });
  it("does not redefine a partially specified existing pack", () => {
    const { r, s } = unpriced(); s.sku.units_per_pack = 1;
    const d = planRow(r, s, [measured(r, 20)], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toContain("OUR_PACK_UNRESOLVABLE");
  });
});

describe("revision 2 Angel cent no-op", () => {
  it("reconstructs audited operations for exact replay verification despite a near-equal predecessor", () => {
    const s = snapshot({ price: { id: "prior", unit_price: 2.25, source: "angel-wave4", effective_date: "2026-08-01" } });
    const manifest = { wave: SOURCE, built_by: "test", rows: [row()] };
    expect(planWave7(manifest, new Map([[ID, s]]), [invoice()], measures, AS_OF)[0]?.intent).toBeNull();
    const replay = planWave7(manifest, new Map([[ID, s]]), [invoice()], measures, AS_OF, new Set([ID]));
    expect(replay[0]?.intent?.price.unit_price).toBe(2.25);
    expect(replay[0]?.intent?.duplicate_decision).toBeUndefined();
  });
  it.each([58.18, 58.19, 58.20])("writes nothing within one cent of %s", current => {
    const { r, s } = withPack("1/1 LB", {}); s.price = { id: "old", unit_price: current, source: "angel-wave4", effective_date: "2026-09-05" };
    const d = planRow(r, s, [invoice(r, { unitPricePerCase: 58.19, lineTotal: 58.19 })], measures, AS_OF);
    expect(d.intent).toBeNull(); expect(codes(d)).toEqual(["ALREADY_CORRECT"]);
  });
  it("still refuses a more-than-cent change behind newer evidence", () => {
    const s = snapshot({ price: { unit_price: 2.27, source: "angel-wave4", effective_date: "2026-09-05" } });
    expect(codes(planRow(row(), s, [invoice()], measures, AS_OF))).toContain("NEWER_PRICE_EXISTS");
  });
  it("writes a more-than-cent change with newer invoice evidence", () => {
    const s = snapshot({ price: { unit_price: 2.27, source: "angel-wave4", effective_date: "2026-08-01" } });
    expect(planRow(row(), s, [invoice()], measures, AS_OF).intent?.price.unit_price).toBe(2.25);
  });
  it("does not call an equal app price an Angel no-op", () => {
    const s = snapshot({ price: { unit_price: 2.25, source: "manual", effective_date: "2026-09-01" } });
    expect(codes(planRow(row(), s, [invoice()], measures, AS_OF))).toContain("NEWER_PRICE_EXISTS");
  });
});

describe("weight grain and immutable operation evidence", () => {
  it.each(["OPERATIONAL", "ESTIMATE", "SPEC"])("preserves %s slice weight during whole deli-piece correction", weightClass => {
    const { r, s } = withPack("-", { name: "Turkey", pack_format: "piece", each_size: 140, avg_oz_per_each: 1, weight_class: weightClass });
    r.angel.product = "OVENGOLD TURKEY"; r.selected_sku!.name = "Turkey";
    const d = planRow(r, s, [invoice(r, { netWeightLbs: 9.25, lbsPerUnit: 9.25, weightSource: "invoice_catch_weight", pricePerLb: 6 })], measures, AS_OF);
    expect(d.intent?.price.unit_price).toBe(55.5); expect(d.intent?.weight).toBeNull();
    expect(d.intent?.chain?.[0]?.containsQty).toBe(148);
    expect(codes(d)).toContain(weightClass === "OPERATIONAL" ? "OPERATIONAL_KEEP_LIVE" : "WEIGHT_GRAIN_MISMATCH");
    expect(s.sku.avg_oz_per_each).toBe(1); expect(s.sku.weight_class).toBe(weightClass);
  });
  it("never treats bacon box mass as a strip average", () => {
    const { r, s } = withPack("1/15 LB", { name: "Bacon", each_size: 240, avg_oz_per_each: 0.75, weight_class: "OPERATIONAL" });
    r.angel.product = "IMP LAYER BACON 12/14"; r.selected_sku!.name = "Bacon";
    const d = planRow(r, s, [invoice(r, { netWeightLbs: 15, lbsPerUnit: 15, weightSource: "invoice_catch_weight" })], measures, AS_OF);
    expect(d.intent?.weight).toBeNull(); expect(codes(d)).toContain("OPERATIONAL_KEEP_LIVE");
  });
  it("prices a packless bacon invoice as its documented 240-ounce box", () => {
    const { r, s } = withPack("—", { name: "Bacon", pack_format: "case", each_size: 240, avg_oz_per_each: 0.75, weight_class: "OPERATIONAL" });
    r.angel.product = "IMP LAYER BACON 12/14"; r.selected_sku!.name = "Bacon";
    const d = planRow(r, s, [invoice(r, { unitPricePerCase: 70.35, lineTotal: 70.35, netWeightLbs: 15, lbsPerUnit: 15, weightSource: "invoice_catch_weight" })], measures, AS_OF);
    expect(d.intent?.price.unit_price).toBe(70.35); expect(d.intent?.weight).toBeNull();
    expect(d.intent?.evidence.grain).toContain("bacon box");
  });
  it("never divides a mozzarella case into 192 invented weighed slices", () => {
    const { r, s } = withPack("1/12 LB", { name: "Fresh Mozzarella", pack_format: "case", each_size: 192, avg_oz_per_each: 1, weight_class: "OPERATIONAL" });
    r.angel.product = "CHEESE MOZZ 1OZ SLCD LOG 32 CT"; r.selected_sku!.name = "Fresh Mozzarella";
    const d = planRow(r, s, [invoice(r, { netWeightLbs: 12.75, lbsPerUnit: 12.75, weightSource: "invoice_catch_weight" })], measures, AS_OF);
    expect(d.intent?.weight).toBeNull(); expect(codes(d)).toContain("OPERATIONAL_KEEP_LIVE");
  });
  it("writes a measured whole-cucumber average only at matching count grain", () => {
    const { r, s } = withPack("1/12 CT", { each_size: 12, each_measure: "each", avg_oz_per_each: 5, weight_class: "ESTIMATE" });
    r.angel.product = "CUCUMBER WHOLE";
    const d = planRow(r, s, [invoice(r, { netWeightLbs: 6, lbsPerUnit: 6, weightSource: "invoice_catch_weight" })], measures, AS_OF);
    expect(d.intent?.weight?.avg_oz_per_each).toBe(8);
    expect(d.intent?.weight?.weight_established_at).toBe("2026-09-01T00:00:00.000Z");
  });
  it("recognizes whole-cucumber weight grain through the count registry label", () => {
    const registry = new Map(measures); registry.delete("each"); registry.set("count", { dimension: "count", toBaseFactor: 1 });
    const { r, s } = withPack("1/12 CT", { each_size: 12, each_measure: "count", avg_oz_per_each: 5, weight_class: "SPEC" });
    r.angel.product = "CUCUMBER WHOLE";
    const d = planRow(r, s, [invoice(r, { netWeightLbs: 6, lbsPerUnit: 6, weightSource: "invoice_catch_weight" })], registry, AS_OF);
    expect(d.intent?.weight?.avg_oz_per_each).toBe(8);
  });
  it("holds an unexplained existing weight instead of treating it as missing", () => {
    const s = snapshot(); s.sku.avg_oz_per_each = 2; s.sku.weight_class = null;
    const d = planRow(row(), s, [invoice()], measures, AS_OF);
    expect(d.intent?.weight).toBeNull(); expect(codes(d)).toContain("WEIGHT_EVIDENCE_UNCLASSIFIED");
  });
  it("canonicalizes object key order but preserves evidence content and revision", () => {
    expect(canonical({ b: 2, a: [1, 3] })).toBe(canonical({ a: [1, 3], b: 2 }));
    expect(canonical({ revision: "r1" })).not.toBe(canonical({ revision: "r2" }));
    expect(() => canonical({ absent: undefined })).toThrow();
  });
  it("preserves the exact ALREADY_CORRECT template and never hides a missing placeholder", () => {
    expect(refusal("ALREADY_CORRECT", { SKU: "Test Butter" }).message).toBe("ALREADY Test Butter: price, chain and provenance match this approved operation; zero writes.");
    expect(() => refusal("PACK_SHAPE_CHANGED", {})).toThrow("Missing refusal placeholder");
  });
});

describe("seed target and operation guards (no database or environment files)", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-value" };
  const digest = "a".repeat(64);
  it("defaults a verified sim target to dry-run", () => expect(validateTarget(["--target", "sim"], env)).toMatchObject({ target: "sim", execute: false }));
  it.each([
    [], ["--target", "other"], ["--target", "sim", "--target", "sim"],
    ["--target", "sim", "--execute", "--execute"], ["--target", "sim", "--unknown"],
    ["--target", "sim", "--as-of"], ["--target", "sim", "--as-of", "2026-02-30"],
    ["--target", "sim", "--execute"], ["--target", "sim", "--execute", "--plan-digest", "wrong"],
    ["--target", "sim", "--execute", "--plan-digest", digest, "--wave7"],
  ].map(args => ({ args })))("refuses incomplete, duplicate, or unsafe options $args", ({ args }) => expect(() => validateTarget(args, env)).toThrow());
  it("rejects wrong-target and credential-bearing URL text without reflecting it", () => {
    const unsafe = "https://synthetic-user:synthetic-password@other.supabase.co";
    try { validateTarget(["--target", "sim"], { ...env, NEXT_PUBLIC_SUPABASE_URL: unsafe }); throw new Error("unexpected acceptance"); }
    catch (error) { expect(String(error)).toContain("Target refused"); expect(String(error)).not.toContain("synthetic-password"); }
  });
  it("requires both reviewed digest and exact production confirmation", () => {
    const prodRef = "bgcvurheqzylyfehqgzh";
    const prodEnv = { ...env, NEXT_PUBLIC_SUPABASE_URL: `https://${prodRef}.supabase.co` };
    const args = ["--target", "prod", "--execute", "--plan-digest", digest];
    expect(() => validateTarget(args, prodEnv)).toThrow("ANGEL_WAVE7_PROD_CONFIRM");
    expect(() => validateTarget(args, { ...prodEnv, ANGEL_WAVE7_PROD_CONFIRM: "yes" })).toThrow();
    expect(validateTarget(args, { ...prodEnv, ANGEL_WAVE7_PROD_CONFIRM: prodRef }).execute).toBe(true);
  });
  it("makes operation IDs stable and separates SKU/revision corrections", () => {
    const input = `${SOURCE}/${ID}/r1`;
    expect(operationUuid(input)).toBe(operationUuid(input));
    expect(operationUuid(input)).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(operationUuid(input)).not.toBe(operationUuid(`${SOURCE}/${ID}/r2`));
    expect(operationUuid(input)).not.toBe(operationUuid(`${SOURCE}/other-sku/r1`));
  });
  function digestFixture() {
    const expected = snapshot({ chain: [{ id: "old-level", sku_id: ID, active: true, contains_qty: 16 }] });
    const chain = [{ id: "new-level", sku_id: ID, active: true, contains_qty: 20 }];
    const before = { vendor_items: [expected.sku], sku_pack_levels: expected.chain, vendor_price_history: [{ id: "older-price", vendor_item_id: ID, unit_price: 1 }], recipes: [{ id: "recipe-1", batch_yield: 10 }] };
    const after = structuredClone(before);
    after.vendor_items = [{ ...expected.sku, avg_oz_per_each: 8, weight_class: "INVOICE_DERIVED" }];
    after.sku_pack_levels = [{ ...expected.chain[0]!, active: false }, ...chain];
    after.vendor_price_history.push({ id: "new-price", vendor_item_id: ID, unit_price: 2 });
    const applied = [{ skuId: ID, priceId: "new-price", expected, bundle: { chain } }];
    const review = { target: "sim", projectRef: SIM_PROJECT_REF, hashes: { manifest: "synthetic-manifest-hash" } };
    return { before, after, applied, review };
  }
  it("reuses the reviewed digest after exact bundle replay without mutating the readback", () => {
    const { before, after, applied, review } = digestFixture();
    const saved = structuredClone(after);
    expect(reviewDigest(after, applied, review)).toBe(reviewDigest(before, [], review));
    expect(after).toEqual(saved);
  });
  it.each(["recipe", "old price", "other chain", "target", "source hash"])("invalidates replay digest after unrelated %s drift", drift => {
    const { before, after, applied, review } = digestFixture();
    const original = reviewDigest(before, [], review);
    if (drift === "recipe") after.recipes[0]!.batch_yield = 11;
    if (drift === "old price") after.vendor_price_history[0]!.unit_price = 99;
    if (drift === "other chain") after.sku_pack_levels.push({ id: "unrelated-level", sku_id: "another-sku", active: true, contains_qty: 2 });
    if (drift === "target") review.target = "prod";
    if (drift === "source hash") review.hashes.manifest = "different-input";
    expect(reviewDigest(after, applied, review)).not.toBe(original);
  });
  function pagedClient(total: number, cap = total, duplicate = false): SupabaseClient {
    const rows = Array.from({ length: total }, (_, i) => ({ id: `row-${i}` }));
    if (duplicate && rows[500]) rows[500] = { id: "row-0" };
    return { from() {
      let head = false, start = 0, end = 499;
      const query = {
        select(_select: string, options: { head?: boolean }) { head = options.head === true; return query; },
        order() { return query; }, range(a: number, b: number) { start = a; end = b; return query; }, eq() { return query; },
        then(resolve: (value: { data: { id: string }[] | null; count: number; error: null }) => unknown) {
          return Promise.resolve({ data: head ? null : rows.slice(start, Math.min(end + 1, cap)), count: total, error: null }).then(resolve);
        },
      };
      return query;
    } } as unknown as SupabaseClient;
  }
  it("loads beyond 1000 rows and checks the final exact total", async () => expect(await loadAll(pagedClient(1201), "synthetic_table")).toHaveLength(1201));
  it("refuses a server-side 1000-row truncation despite a plausible last page", async () => {
    await expect(loadAll(pagedClient(1201, 1000), "synthetic_table")).rejects.toThrow("Truncated pagination");
  });
  it("refuses duplicate IDs across page boundaries", async () => {
    await expect(loadAll(pagedClient(1201, 1201, true), "synthetic_table")).rejects.toThrow("Duplicate/missing id");
  });
});

describe("lane-1 recomputation from synthetic complete tables", () => {
  function tables(): Record<string, Record<string, unknown>[]> {
    const data: Record<string, Record<string, unknown>[]> = Object.fromEntries([
      "items", "menu_items", "products", "recipes", "recipe_inputs", "recipe_outputs", "vendor_deliveries", "vendor_delivery_items", "product_primaries", "location_sku_settings", "sku_pack_levels", "vendor_price_history", "vendor_cutoffs", "vendor_delivery_rhythm",
    ].map(name => [name, []]));
    data.locations = [{ id: "shop-1", name: "Test North", active: true }, { id: "shop-2", name: "Test South", active: true }];
    data.vendors = [{ id: "vendor-1", name: "Test Supplier", active: true }];
    data.measure_units = [{ id: "measure-each", label: "each", dimension: "count", to_base_factor: 1, active: true }, { id: "measure-oz", label: "oz", dimension: "weight", to_base_factor: 1, active: true }];
    data.vendor_items = [{ ...snapshot().sku, name: "Test Supply", sku_class: "packaging", inventory_only: true, units_per_pack: null, each_size: null, each_measure: null, weekday_par: 1, weekend_par: 1, weight_class: "ESTIMATE", avg_oz_per_each: 1 }];
    return data;
  }
  it("recomputes per-shop price/count closures without claiming an estimated unit weight was retired", () => {
    const data = tables(), before = evaluateWave7Tables(data);
    const sku = data.vendor_items![0]!;
    const revised: Snapshot = { sku, vendor: data.vendors![0]!, chain: [{ id: "level-1", sku_id: ID, label: "box", contains_qty: 100, contains_level_id: null, contains_measure_unit: "each", display_ordinal: 0, active: true }], price: { id: "price-1", vendor_item_id: ID, unit_price: 10, effective_date: "2026-09-01", recorded_at: "2026-09-10T00:00:00Z" } };
    const after = evaluateWave7Tables(data, new Map([[ID, revised]]));
    expect(before.shops).toHaveLength(2); expect(after.shops).toHaveLength(2);
    for (const shop of before.shops) expect(shop.rows[0]).toMatchObject({ unpriced: true, chainless: true, estimate: true, count: "blocked" });
    for (const shop of after.shops) expect(shop.rows[0]).toMatchObject({ unpriced: false, chainless: false, estimate: true, count: "usable" });
    expect(data.vendor_price_history).toEqual([]); // Projection has not mutated the baseline.
  });
  it("fails on missing tables and dangling dependency IDs instead of shrinking the population", () => {
    const missing = tables(); delete missing.recipe_inputs;
    expect(() => evaluateWave7Tables(missing)).toThrow("INCOMPLETE_GRAPH");
    const dangling = tables(); dangling.recipe_inputs = [{ id: "input-1", recipe_id: "missing-recipe", component_sku_id: ID }];
    expect(() => evaluateWave7Tables(dangling)).toThrow("INCOMPLETE_GRAPH");
  });
  it("honors a location's active override when deriving each shop's population", () => {
    const data = tables(); data.location_sku_settings = [{ id: "overlay-1", location_id: "shop-2", sku_id: ID, active_override: false }];
    const report = evaluateWave7Tables(data);
    expect(report.shops.find(s => s.id === "shop-1")?.rows).toHaveLength(1);
    expect(report.shops.find(s => s.id === "shop-2")?.rows).toHaveLength(0);
  });
  it("accepts an exact no-op without adding any history", () => {
    const before = tables(), after = structuredClone(before);
    expect(() => verifyWave7Scope(before, after, new Map())).not.toThrow();
  });
  it("accepts only the approved price append and complete predecessor chain supersession", () => {
    const before = tables();
    before.sku_pack_levels = [{ id: "old-level", sku_id: ID, label: "box", contains_qty: 10, contains_measure_unit: "each", contains_level_id: null, active: true }];
    const after = structuredClone(before);
    const chain = [{ id: "new-level", sku_id: ID, label: "box", contains_qty: 100, contains_measure_unit: "each", contains_level_id: null, active: true }];
    const price = { id: "new-price", vendor_item_id: ID, source: SOURCE, unit_price: 10 };
    after.sku_pack_levels = [{ ...before.sku_pack_levels[0]!, active: false }, ...chain];
    after.vendor_price_history = [price];
    const applied = new Map([[ID, { sku: before.vendor_items![0]!, chain, price, vendor: before.vendors![0]! }]]);
    expect(() => verifyWave7Scope(before, after, applied)).not.toThrow();
    after.sku_pack_levels[0]!.active = true;
    expect(() => verifyWave7Scope(before, after, applied)).toThrow("WAVE7_SCOPE_CHANGED");
  });
  it.each(["vendor_items", "products", "vendor_price_history"])("rejects an unrelated edit to %s", table => {
    const before = tables();
    before.products = [{ id: "product-1", unit_oz: 1 }];
    before.vendor_price_history = [{ id: "old-price", vendor_item_id: ID, unit_price: 10 }];
    const after = structuredClone(before);
    Object.assign(after[table]![0]!, table === "vendor_items" ? { weekday_par: 99 } : table === "products" ? { unit_oz: 99 } : { unit_price: 99 });
    expect(() => verifyWave7Scope(before, after, new Map())).toThrow(`WAVE7_SCOPE_CHANGED: ${table}`);
  });
});

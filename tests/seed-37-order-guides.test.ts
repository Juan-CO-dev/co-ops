import { describe, expect, it } from "vitest";
import { planOrderGuides, routeRow, SECTION_NAMES, SOURCE, verifyWriteScope, type Plan, type Tables } from "@/scripts/seed/37-order-guides";

const V = { PFG: "v-pfg", "Leonard Paper": "v-leo", Trimark: "v-tri", "Boar's Head": "v-bh", Baldor: "v-bal", Whisked: "v-wh" };
const sku = (name: string, vendor: keyof typeof V, item_number: string | null = null, product_id: string | null = null) =>
  ({ id: `${name}|${vendor}`, name, vendor_id: V[vendor], item_number, active: true, product_id });
const sheets = {
  pfg_leonard: [
    { section: "Produce", item: "Arugula", item_number: "242470", par: "5", vendor: "PFG" },
    { section: "Dairy", item: "Eggs", item_number: "439686", par: "", vendor: "PFG" },
    { section: "Dairy", item: "Eggs (cooked)", item_number: "439686", par: "", vendor: "PFG" },
    { section: "Leonard Paper / Trimark", item: "Butcher Paper", item_number: "N/A", par: "", vendor: "TRIMARK" },
    { section: "Leonard Paper / Trimark", item: "Plastic forks", item_number: "N/A", par: "", vendor: "Leonard Paper" },
    { section: "Produce", item: "Cannoli Shell", item_number: "N/A", par: "", vendor: "Baldor" },
    { section: "Produce", item: "Transfer from P St", item_number: "N/A", par: "", vendor: "TRANSFER" },
  ],
  boars_head: [
    { section: "Boar's Head", item: "Turkey", pack_note: "2/cs", par: "9" },
    { section: "Beverage", item: "Coke", pack_note: "", par: "" },
    { section: "Smallwares", item: "Mystery widget", pack_note: "", par: "" },
  ],
};
const tables = (): Tables => ({
  vendors: Object.entries(V).map(([name, id]) => ({ id, name, active: true })),
  vendor_items: [sku("Arugula", "PFG", "242470"), sku("Eggs", "PFG", "439686"), sku("Butcher Paper", "Trimark"), sku("Plastic forks", "Leonard Paper"),
    sku("Turkey", "Boar's Head"), sku("Coke", "PFG"), sku("Cannoli Shell", "Baldor"), sku("Croissant", "Whisked")],
  vendor_order_guides: [], order_guide_sections: [], order_guide_lines: [],
});

describe("routeRow", () => {
  it("routes laminate rows by their vendor key and renames the mixed section per vendor", () => {
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[3]!)).toEqual({ vendor: "Trimark", section: SECTION_NAMES.Trimark["Leonard Paper / Trimark"] });
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[4]!)).toEqual({ vendor: "Leonard Paper", section: "Leonard Paper" });
  });
  it("sends Boar's Head sections to Boar's Head and second-sheet sections to 'by_sku'", () => {
    expect(routeRow("boars_head", sheets.boars_head[0]!)).toEqual({ vendor: "Boar's Head", section: "Boar's Head" });
    expect(routeRow("boars_head", sheets.boars_head[1]!)).toEqual({ vendor: "by_sku", section: "Beverage" });
  });
  it("reports Baldor and TRANSFER laminate rows", () => {
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[5]!)).toEqual({ vendor: "report", section: "Produce" });
    expect(routeRow("pfg_leonard", sheets.pfg_leonard[6]!)).toEqual({ vendor: "report", section: "Produce" });
  });
});

describe("planOrderGuides", () => {
  it("builds one guide per vendor with matched lines, keeps the first of a repeated item, routes second-sheet rows by SKU vendor, starts a guide for sheetless vendors", () => {
    const plans = planOrderGuides(tables(), sheets);
    const pfg = plans.find((p) => p.vendor === "PFG")!;
    expect(pfg.status).toBe("ready");
    expect(pfg.sections.map((s) => [s.name, s.lines.map((l) => l.label)])).toEqual([["Produce", ["Arugula"]], ["Dairy", ["Eggs"]], ["Beverage", ["Coke"]]]);
    expect(pfg.report.some((r) => /repeat/.test(r))).toBe(true);
    expect(plans.find((p) => p.vendor === "Trimark")!.sections[0]!.name).toBe("Trimark");
    expect(plans.find((p) => p.vendor === "Baldor")!.kind).toBe("starter");
    expect(plans.find((p) => p.vendor === "Whisked")!.sections[0]!.lines.map((l) => l.label)).toEqual(["Croissant"]);
    expect(plans.flatMap((p) => p.report)).toEqual(expect.arrayContaining([expect.stringMatching(/Cannoli Shell/), expect.stringMatching(/Transfer/), expect.stringMatching(/Mystery widget/)]));
  });
  it("matches by item number first, then exact name, then unambiguous contains; ambiguous → null sku", () => {
    const t = tables(); t.vendor_items.push(sku("Eggs Large", "PFG"), sku("Eggs Medium", "PFG"));
    const s = { pfg_leonard: [{ section: "Dairy", item: "Eggs", item_number: "N/A", par: "", vendor: "PFG" }, { section: "Dairy", item: "Egg", item_number: "N/A", par: "", vendor: "PFG" }], boars_head: [] };
    const pfg = planOrderGuides(t, s).find((p) => p.vendor === "PFG")!;
    expect(pfg.sections[0]!.lines.map((l) => l.skuId)).toEqual(["Eggs|PFG", null]); // "Egg" contains-matches three → ambiguous
  });
  it("is idempotent: an existing seed-37 guide with everything placed → already; a hand-made guide → refused; a null-sku line is re-matched only", () => {
    const t = tables();
    t.vendor_order_guides.push({ id: "g", vendor_id: V.PFG, name: "PFG — laminated guide", source_note: `[${SOURCE}]`, updated_at: "x" });
    t.order_guide_sections.push({ id: "s", guide_id: "g", name: "Produce", position: 1 }, { id: "s2", guide_id: "g", name: "Dairy", position: 2 }, { id: "s3", guide_id: "g", name: "Beverage", position: 3 });
    t.order_guide_lines.push({ id: "l", section_id: "s", position: 1, sku_id: null, label: "Arugula", item_number: "242470" }, { id: "l2", section_id: "s2", position: 1, sku_id: "Eggs|PFG", label: "Eggs", item_number: "439686" }, { id: "l3", section_id: "s3", position: 1, sku_id: "Coke|PFG", label: "Coke", item_number: null });
    const pfg = planOrderGuides(t, sheets).find((p) => p.vendor === "PFG")!;
    expect(pfg.status).toBe("ready"); expect(pfg.rematch).toEqual([{ lineId: "l", skuId: "Arugula|PFG" }]); expect(pfg.append).toEqual([]);
    t.order_guide_lines[0]!.sku_id = "Arugula|PFG";
    expect(planOrderGuides(t, sheets).find((p) => p.vendor === "PFG")!.status).toBe("already");
    t.vendor_order_guides[0]!.source_note = "made by hand";
    expect(planOrderGuides(t, sheets).find((p) => p.vendor === "PFG")!.status).toBe("refused");
  });
});

/**
 * Astra finding 3 (BC-007): a rerun's rematches and appends never advanced
 * `vendor_order_guides.updated_at`, so a manager holding the editor open could save an
 * unrelated reorder against a stale model and quietly undo the rerun. The rerun now bumps the
 * token with a guarded UPDATE — which means `verifyWriteScope` has to permit that one column
 * on that one guide, and still refuse it everywhere else.
 */
describe("verifyWriteScope — the rerun's token bump", () => {
  const guides = () => ({
    vendors: [{ id: V.PFG, name: "PFG", active: true }, { id: V["Leonard Paper"], name: "Leonard Paper", active: true }],
    vendor_items: [sku("Arugula", "PFG", "242470")],
    vendor_order_guides: [
      { id: "g", vendor_id: V.PFG, name: "PFG — laminated guide", source_note: `[${SOURCE}]`, updated_at: "t0" },
      { id: "g2", vendor_id: V["Leonard Paper"], name: "Leonard — laminated guide", source_note: `[${SOURCE}]`, updated_at: "t0" },
    ],
    order_guide_sections: [{ id: "s", guide_id: "g", name: "Produce", position: 1 }],
    order_guide_lines: [{ id: "l", section_id: "s", position: 1, sku_id: null, label: "Arugula", item_number: "242470" }],
  }) as Tables;
  const plan = (): Plan => ({
    vendor: "PFG", vendorId: V.PFG, kind: "sheet", status: "ready", name: "PFG — laminated guide",
    sourceNote: `[${SOURCE}]`, sections: [], rematch: [{ lineId: "l", skuId: "Arugula|PFG" }], append: [], report: [],
    before: null, expected: { guideId: "g", guideUpdatedAt: "t0" },
  });
  const clone = (t: Tables) => JSON.parse(JSON.stringify(t)) as Tables;

  it("allows the rerun's own writes: the re-matched sku_id, an appended line, and this guide's updated_at", () => {
    const before = guides();
    const after = clone(before);
    after.vendor_order_guides[0]!.updated_at = "t1";
    after.order_guide_lines[0]!.sku_id = "Arugula|PFG";
    after.order_guide_lines.push({ id: "l2", section_id: "s", position: 2, sku_id: null, label: "Basil", item_number: null });
    expect(() => verifyWriteScope(before, after, plan())).not.toThrow();
  });

  it("still refuses another guide's token moving", () => {
    const before = guides();
    const after = clone(before);
    after.vendor_order_guides[1]!.updated_at = "t1";
    expect(() => verifyWriteScope(before, after, plan())).toThrow(/vendor_order_guides/);
  });

  it("still refuses an unrelated change on this guide's own row, and anything outside the guide tables", () => {
    const renamed = clone(guides());
    renamed.vendor_order_guides[0]!.name = "renamed by hand";
    expect(() => verifyWriteScope(guides(), renamed, plan())).toThrow(/vendor_order_guides/);
    const sku = clone(guides());
    sku.vendor_items[0]!.name = "Arugula (new pack)";
    expect(() => verifyWriteScope(guides(), sku, plan())).toThrow(/vendor_items/);
  });
});

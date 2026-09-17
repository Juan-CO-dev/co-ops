/**
 * V3-A §3 — the guide key on a PO line: snapshotted at draft time from the LIVE guide, read
 * back as `snapshot ?? live`. Two pins:
 *   1. resolveGuideKey — the pure read law (a pre-0205 snapshot with a position but no section
 *      still counts as snapshotted; a null snapshot falls back to the live guide; nothing → null).
 *   2. A source pin on lib/purchase-orders.ts (the repo's pattern for wiring laws, see
 *      po-vendor-picker.test.ts): both draft paths write BOTH snapshot columns from the ONE
 *      helper `guideKeysFor`, and no reader of the dropped `vendor_items.guide_position` remains.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolveGuideKey } from "@/lib/order-guides-shared";

describe("resolveGuideKey (V3-A read law)", () => {
  const live = { position: 2001, section: "Produce" };
  it("a snapshot wins over the live guide, section included", () => {
    expect(resolveGuideKey({ position: 1001, section: "Dairy" }, live)).toEqual({ position: 1001, section: "Dairy" });
  });
  it("a pre-0205 snapshot (position, no section) still counts as snapshotted", () => {
    expect(resolveGuideKey({ position: 7, section: null }, live)).toEqual({ position: 7, section: null });
  });
  it("no snapshot → the live guide (legacy POs, lines added after an edit)", () => {
    expect(resolveGuideKey({ position: null, section: null }, live)).toEqual({ position: 2001, section: "Produce" });
  });
  it("no snapshot and not on any guide → nulls", () => {
    expect(resolveGuideKey({ position: null, section: null }, undefined)).toEqual({ position: null, section: null });
  });
});

const src = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", src, ts.ScriptTarget.Latest, true);

describe("lib/purchase-orders.ts wiring pins", () => {
  it("never reads the dropped vendor_items.guide_position", () => {
    expect(src).not.toMatch(/select\("id, guide_position"\)/);
    expect(src).not.toMatch(/\.order\("guide_position"/);
    expect(src).not.toMatch(/guide_position\b(?!_snapshot)[^\n]*\bs\.guide_position/);
  });
  it("both draft paths snapshot position AND section from guideKeysFor", () => {
    expect((src.match(/guideKeysFor\(/g) ?? []).length).toBeGreaterThanOrEqual(3); // createDraftsFromLines, insertNewDraftLines, loadPoDetail
    expect((src.match(/guide_section_snapshot: guideKeys\.get\(l\.skuId\)\?\.section \?\? null/g) ?? []).length).toBe(2);
    expect((src.match(/guide_position_snapshot: guideKeys\.get\(l\.skuId\)\?\.position \?\? null/g) ?? []).length).toBe(2);
  });
  it("loadPoDetail hydrates lines through resolveGuideKey and sorts the picker by the guide", () => {
    expect(src).toContain("resolveGuideKey({ position: l.guide_position_snapshot, section: l.guide_section_snapshot }, liveGuide.get(l.sku_id))");
    expect(src).toContain("compareByGuide(");
  });
  it("the confirmed snapshot carries the FROZEN key, never the raw columns", () => {
    expect(src).toContain("guidePos: frozenGuideKeys.get(l.id)?.position ?? null,");
    expect(src).toContain("guideSection: frozenGuideKeys.get(l.id)?.section ?? null,");
    expect(src).not.toContain("guideSection: l.guide_section_snapshot,");
  });
});

/**
 * Astra finding 4 (BC-013, BC-042): confirmation copied the RAW snapshot columns into
 * `confirmed_snapshot`. A legacy draft — or a SKU placed on the guide after drafting — has
 * nulls there, so the panel/copy rendered it through the live fallback while the email, which
 * reads the snapshot with no fallback, sorted it alphabetically under "Not on the guide".
 * confirmPO now resolves the effective key ONCE and freezes it in both places.
 */
describe("confirmPO freezes the effective guide key (finding 4)", () => {
  const confirm = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "confirmPO");
  if (!confirm || !ts.isFunctionDeclaration(confirm) || !confirm.body) throw new Error("Missing confirmPO");
  const cbody = confirm.body.getText(ast);

  const freeze = () => {
    const start = cbody.indexOf("const frozenGuideKeys");
    const end = cbody.indexOf("]));", start) + "]));".length;
    expect(start).toBeGreaterThan(0);
    const js = ts.transpile(cbody.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    return new Function("lines", "liveGuideAtConfirm", "resolveGuideKey", `${js}; return frozenGuideKeys;`) as
      (lines: unknown[], live: Map<string, unknown>, rg: typeof resolveGuideKey) => Map<string, { position: number | null; section: string | null }>;
  };

  const line = (id: string, skuId: string, position: number | null, section: string | null) =>
    ({ id, sku_id: skuId, guide_position_snapshot: position, guide_section_snapshot: section });

  it("a line with null snapshots takes the LIVE key; a snapshotted line keeps its own", () => {
    const keys = freeze()(
      [line("row-legacy", "sku-a", null, null), line("row-frozen", "sku-b", 1001, "Dairy"), line("row-nowhere", "sku-c", null, null)],
      new Map([["sku-a", { position: 2001, section: "Produce" }], ["sku-b", { position: 9009, section: "Moved" }]]),
      resolveGuideKey,
    );
    expect(keys.get("row-legacy")).toEqual({ position: 2001, section: "Produce" });
    expect(keys.get("row-frozen")).toEqual({ position: 1001, section: "Dairy" });
    expect(keys.get("row-nowhere")).toEqual({ position: null, section: null });
  });

  it("the po_lines row is patched with that key only where it was null, so row and snapshot agree", () => {
    const start = cbody.indexOf("const patch: Record<string, unknown>");
    const end = cbody.indexOf("const { error: puErr", start);
    expect(start).toBeGreaterThan(0);
    const js = ts.transpile(cbody.slice(start, end), { target: ts.ScriptTarget.ES2022 });
    const patchFor = new Function("l", "frozen", "priceCents", `${js}; return patch;`) as
      (l: unknown, frozen: unknown, price: number | null) => Record<string, unknown>;

    expect(patchFor(line("a", "sku-a", null, null), { position: 2001, section: "Produce" }, 500))
      .toEqual({ price_cents_at_order: 500, guide_position_snapshot: 2001, guide_section_snapshot: "Produce" });
    expect(patchFor(line("b", "sku-b", 1001, "Dairy"), { position: 1001, section: "Dairy" }, null))
      .toEqual({ price_cents_at_order: null });
    expect(patchFor(line("c", "sku-c", null, null), { position: null, section: null }, 250))
      .toEqual({ price_cents_at_order: 250 });
  });
});

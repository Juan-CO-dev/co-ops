/**
 * tests/order-guide-surfaces.test.ts — the two CLIENT halves of the Astra review (2026-09-17).
 *
 * Both are wiring laws about a whole surface rather than a pure function, so they are pinned
 * the way this repo pins wiring (see tests/po-vendor-picker.test.ts): against the real source,
 * through the TypeScript AST, so the pin names the file and the shape it must keep.
 *
 *   FINDING 5 (BC-042) — `DraftView` was the last order-reading surface still in insertion
 *   order. It concatenated existing lines with new picks and mapped straight over the result:
 *   an item picked from the guide's first section landed below a later-section line, with no
 *   headers, so the manager reviewed one sequence and confirmed another.
 *
 *   FINDING 6 (BC-007) — `OrderGuidePanel` disabled Save and Discard while saving but left
 *   every reorder/rename/remove/place control live, and `dispatch` ignored `busy`. A change
 *   made during a slow save was replaced by the response, dirty was cleared, and the panel
 *   said "Saved".
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function functionBody(file: ts.SourceFile, name: string): string {
  let found: string | null = null;
  const walk = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) found = node.body.getText(file);
    else ts.forEachChild(node, walk);
  };
  walk(file);
  if (found === null) throw new Error(`Missing function ${name} in ${file.fileName}`);
  return found;
}

/** Every JSX element under `node`, as [tag, the text of its `disabled` attribute or null]. */
function controls(file: ts.SourceFile, node: ts.Node): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(file);
      const attr = n.attributes.properties.find(
        (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(file) === "disabled",
      );
      out.push([tag, attr?.initializer ? attr.initializer.getText(file) : null]);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

describe("PoPanel DraftView groups by the vendor's guide (finding 5)", () => {
  const file = parse("components/ordering/PoPanel.tsx");
  const body = functionBody(file, "DraftView");

  it("a newly picked line carries the guide key the picker already sorted by", () => {
    expect(body).toContain("guidePositionSnapshot: sku.guidePosition");
    expect(body).toContain("guideSection: sku.guideSection");
  });

  it("the combined list runs through groupByGuideSection on the SAME keys as the frozen table", () => {
    expect(body).toContain("groupByGuideSection(");
    expect(body).toContain("position: l.guidePositionSnapshot, section: l.guideSection");
    const frozen = functionBody(file, "ConfirmedView");
    expect(frozen).toContain("position: l.guidePositionSnapshot, section: l.guideSection");
  });

  it("rows render out of the groups, never out of a bare map over the concatenation", () => {
    expect(body).toContain("{g.rows.map((l) => {");
    expect(body).not.toMatch(/\{\[\.\.\.detail\.lines, \.\.\.newLines\]\.map\(/);
  });

  it("section headers use the shared suppression rule, so a nameless group prints no band", () => {
    expect(body).toContain("hasGuideHeader(g.section)");
    expect(body).toContain("NOT_ON_GUIDE");
  });
});

describe("OrderGuidePanel locks editing while a save is in flight (finding 6)", () => {
  const file = parse("components/admin/vendors/OrderGuidePanel.tsx");
  let panel: ts.FunctionDeclaration | null = null;
  const findPanel = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "OrderGuidePanel") panel = n;
    else ts.forEachChild(n, findPanel);
  };
  findPanel(file);
  if (panel === null) throw new Error("Missing OrderGuidePanel");
  const body = (panel as ts.FunctionDeclaration).body!.getText(file);

  it("dispatch refuses every edit while busy — the floor under the disabled props", () => {
    const start = body.indexOf("const dispatch = (edit: GuideEdit) => {");
    expect(start).toBeGreaterThan(0);
    const guard = body.slice(start, body.indexOf("\n", body.indexOf("if (", start)));
    expect(guard).toMatch(/if \(busy \|\| /);
  });

  it("every editing control in the panel is disabled while busy", () => {
    const editable = new Set(["PlainBtn", "PrimaryBtn", "select", "input"]);
    const offenders = controls(file, panel as unknown as ts.Node)
      .filter(([tag]) => editable.has(tag))
      .filter(([, disabled]) => disabled === null || !disabled.includes("busy"));
    expect(offenders).toEqual([]);
  });

  /**
   * Astra r2-4 (BC-007, BC-042). `busy` was cleared the moment the POST returned, and only THEN
   * did the stale branch await `reload()`. During that GET the controls were live again, and
   * whatever the manager changed was replaced by the fresh model with `dirty` cleared — the
   * same loss the lock exists to stop, moved a few hundred milliseconds later. A failed GET
   * returned silently while the notice claimed the guide had reloaded.
   */
  it("holds busy through the stale reload, and releases it exactly once, in a finally", () => {
    const save = body.slice(body.indexOf("const save = async () => {"), body.indexOf("const commitRename"));
    expect(save).toContain("} finally {");
    expect(save.match(/setBusy\(false\)/g) ?? []).toHaveLength(1);
    expect(save.indexOf("setBusy(false)")).toBeGreaterThan(save.indexOf("await reload()"));
  });

  it("announces a reload only after one actually happened, and says so when it did not", () => {
    const save = body.slice(body.indexOf("const save = async () => {"), body.indexOf("const commitRename"));
    expect(save).toContain("const reloaded = await reload();");
    expect(save).toMatch(/if \(!reloaded\)[\s\S]{0,120}setErrorMsg\(/);
    expect(save.indexOf('setNotice(t("admin.order_guide.stale"))')).toBeGreaterThan(save.indexOf("const reloaded"));
    // reload has to be able to report failure at all.
    expect(body).toContain("const reload = async (): Promise<boolean> =>");
    expect(body).toMatch(/if \(!res\.ok\) return false;/);
  });

  it("the panel still has the controls this is protecting (the assertion cannot pass vacuously)", () => {
    const editable = controls(file, panel as unknown as ts.Node).filter(([tag]) =>
      ["PlainBtn", "PrimaryBtn", "select", "input"].includes(tag),
    );
    expect(editable.length).toBeGreaterThanOrEqual(12);
  });
});

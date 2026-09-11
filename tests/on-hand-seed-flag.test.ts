/**
 * LRA-217 call-site classification (all production + sim calls):
 * File / function                                          | Classification
 * lib/ordering.ts loadWalkerData -> loadOnHandDerived       | walk seeder (default true)
 * lib/ordering.ts submitParPass -> loadOnHandDerived        | walk seeder (default true)
 * lib/ordering.ts loadShrinkageSignals -> loadOnHandDerived | pulse read (false)
 * lib/counts.ts loadOnHand -> loadOnHandDerived              | counts-panel read (false)
 * app/(authed)/operations/counts/page.tsx -> loadOnHand      | counts-panel read (wrapper)
 * scripts/sim/product-identity/day2-two-vendor-count.ts      | panel verification read (false)
 *   -> loadOnHandDerived
 * lib/counts.ts loadOnHandDerived -> loadInferredRows (x3)   | forwards flag in every branch
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const counts = readFileSync("lib/counts.ts", "utf8");
const ordering = readFileSync("lib/ordering.ts", "utf8");
function fn(source: string, name: string) {
  const ast = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node || !ts.isFunctionDeclaration(node) || !node.body) throw new Error(`Missing ${name}`);
  return { ast, node, text: node.getText(ast) };
}

describe("LRA-217: inference persistence is explicit", () => {
  it("makes the pulse read opt out", () => {
    expect(fn(ordering, "loadShrinkageSignals").text).toContain("loadOnHandDerived(actor, locationId, Date.now(), { seedBaselines: false })");
  });

  it("preserves both walk seeders and the default", () => {
    for (const name of ["loadWalkerData", "submitParPass"]) {
      expect(fn(ordering, name).text).toContain("loadOnHandDerived(actor, locationId)");
    }
    expect(fn(counts, "loadOnHandDerived").text).toContain("const seedBaselines = opts.seedBaselines ?? true");
  });

  it("disables seeds for the counts panel and its simulation read", () => {
    expect(fn(counts, "loadOnHand").text).toContain("loadOnHandDerived(actor, locationId, now, { withProducts: true, seedBaselines: false })");
    expect(readFileSync("app/(authed)/operations/counts/page.tsx", "utf8")).toContain("loadOnHand(auth, location)");
    expect(readFileSync("scripts/sim/product-identity/day2-two-vendor-count.ts", "utf8")).toContain("loadOnHandDerived(actor, loc.id, Date.now(), { withProducts: true, seedBaselines: false })");
  });

  it("forwards the flag through cold, empty-anchor, and anchored branches", () => {
    const calls = fn(counts, "loadOnHandDerived").text.match(/await loadInferredRows\([^;]+;/g);
    expect(calls).toHaveLength(3);
    for (const call of calls!) expect(call).toContain(", now, { seedBaselines })");
  });

  it("guards the upsert, while keeping inference and the in-memory merge unconditional", () => {
    const { ast, node, text } = fn(counts, "loadInferredRows");
    const writes: ts.CallExpression[] = [];
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "upsert") writes.push(n);
      ts.forEachChild(n, visit);
    }
    visit(node);
    expect(writes).toHaveLength(1);
    let parent: ts.Node | undefined = writes[0]!.parent;
    while (parent && !ts.isIfStatement(parent)) parent = parent.parent;
    expect(parent && ts.isIfStatement(parent) && parent.expression.getText(ast)).toBe("seedBaselines && toInsert.length > 0");
    expect(text.indexOf("computeInferredBaselineOz(total")).toBeLessThan(text.indexOf("if (seedBaselines"));
    expect(text.indexOf("baselineBySku.set(id,")).toBeLessThan(text.indexOf("if (seedBaselines"));
    expect(text).toContain('onConflict: "location_id,sku_id", ignoreDuplicates: true');
  });
});

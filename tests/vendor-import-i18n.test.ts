import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { REASONS } from "@/lib/vendor-import-shared/model";

const component = readFileSync("components/admin/vendors/VendorImportPanel.tsx", "utf8");
const prefix = "admin.vendor_import.";
const dynamic = [
  ...REASONS.map(r => `reason.${r}`),
  ...["price", "item_number", "pack", "needs_person", "noop"].map(k => `kind.${k}`),
  ...["item_number", "name_exact", "ambiguous", "unmatched"].map(k => `match.${k}`),
  ...["staged", "applied", "superseded"].map(k => `status.${k}`),
  ...["auth", "too_large", "unknown_adapter", "adapter_vendor_mismatch", "multiple_accounts", "invalid_plan"].map(k => `error.${k}`),
].map(k => prefix + k);
const literal = [...component.matchAll(/t\("(admin\.vendor_import\.[^"]+)"/g)].map(m => m[1]!);

describe("vendor importer translations", () => {
  it("references a nonempty set of UI keys", () => expect(literal.length).toBeGreaterThan(20));
  for (const [language, dictionary] of Object.entries({ en, es })) {
    it(`covers literal and dynamic component keys in ${language}`, () => {
      for (const key of [...literal, ...dynamic]) expect((dictionary as Record<string, string>)[key], key).toBeTruthy();
    });
    it(`preserves interpolation placeholders in ${language}`, () => {
      for (const key of [...literal, ...dynamic]) {
        const placeholders = (value: string) => [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
        expect(placeholders((dictionary as Record<string, string>)[key]!), key).toEqual(placeholders((en as Record<string, string>)[key]!));
      }
    });
  }
  it("registers every reason emitted by the matcher and server", () => {
    const emitted = new Set<string>();
    function strings(node: ts.Node) {
      if (ts.isStringLiteral(node)) emitted.add(node.text);
      else ts.forEachChild(node, strings);
    }
    for (const path of ["lib/vendor-import-shared/match.ts", "lib/vendor-import.ts"]) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && (node.expression.getText(source) === "add" || node.expression.getText(source) === "held.set") && node.arguments[1]) strings(node.arguments[1]);
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === "reason" && ts.isStringLiteral(node.initializer)) strings(node.initializer);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect([...emitted].sort()).toEqual([...REASONS].sort());
  });
});

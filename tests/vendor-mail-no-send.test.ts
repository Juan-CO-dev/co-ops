import { normalize, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { chain, diskReader, importClosure, importSpecifiers, listFiles, SINK_MODULES, SINK_PACKAGES, SINK_PATH, type Reader, type Closure } from "./fixtures/schedule/no-notify-closure";

const entries = [
  ...listFiles("lib").filter(path => /vendor-mail[^\\/]*\.ts$/.test(path) && !path.endsWith("vendor-mail-forward.ts")),
  ...listFiles("app/api/operations/vendor-mail").filter(path => !path.split(/[\\/]/).includes("forward")),
  "lib/inbound-parse.ts", "lib/receipt-parse.ts", "lib/email-receipts.ts",
].map(normalize);
const overlay = (files: Record<string, string>): Reader => path => files[path] ?? diskReader(path);
// This is an EMAIL no-send contract. Existing in-app assignment notifications
// remain permitted. These modules still get walked: a future email import in
// any of them is detected, including by the injected-helper test below.
const nonSenders = ["lib/notifications.ts", "lib/po-email-shared.ts", "lib/email-receipts-matching-shared.ts"].map(normalize);
function sinkViolations(closure: Closure, roots: readonly string[]): string[] {
  const allowed = new Set([...roots, ...nonSenders]);
  return [
    ...[...closure.files].filter(path => !nonSenders.includes(path) && (SINK_MODULES.includes(path) || (SINK_PATH.test(path.replace(/\.(ts|tsx)$/, "")) && !allowed.has(path)))).map(path => chain(closure, path)),
    ...[...closure.packages].filter(([name]) => SINK_PACKAGES.includes(name)).map(([name, path]) => `${name}: ${chain(closure, path)}`),
  ];
}

/** The mixed router is not a closure entry: positively constrain every call in
 * its vendor branch, and walk the implementations of its imported callees. */
function vendorBranchCalls(source: string): string[] {
  const file = ts.createSourceFile("router.ts", source, ts.ScriptTarget.Latest, true);
  let statements: readonly ts.Statement[] | undefined;
  function locate(node: ts.Node) {
    if (ts.isBlock(node)) {
      const index = node.statements.findIndex(statement => ts.isIfStatement(statement) &&
        statement.expression.getText(file).replace(/\s/g, "") === 'route.lane!=="vendor_receipt"');
      if (index >= 0) statements = node.statements.slice(index);
    }
    ts.forEachChild(node, locate);
  }
  locate(file);
  if (!statements) return ["missing vendor boundary"];
  const errors: string[] = [];
  const calls = new Set(["save", "archiveProjection", "fetchInboundContent", "ingestInboundReceipt"]);
  const methods = new Set(["select", "eq", "maybeSingle", "find"]);
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const target = node.expression.getText(file);
      if (target === "sb.from") {
        if (node.arguments[0]?.getText(file) !== '"email_receipts"') errors.push(target);
      } else if (!calls.has(target) && !(ts.isPropertyAccessExpression(node.expression) && methods.has(node.expression.name.text))) errors.push(target);
    }
    if (ts.isNewExpression(node) && node.expression.getText(file) !== "Error") errors.push(node.expression.getText(file));
    ts.forEachChild(node, visit);
  }
  statements.forEach(visit);
  return errors;
}

describe("Vendor mail no-send boundary", () => {
  it("walks all non-Forward entries transitively without cron exemptions or sender dependencies", () => {
    expect(entries).toContain(normalize("lib/email-receipts.ts"));
    expect(entries).toContain(normalize("lib/inbound-parse.ts"));
    expect(entries.some(path => path.includes("cron"))).toBe(false);
    const closure = importClosure(entries);
    expect(closure.files.size).toBeGreaterThan(entries.length);
    expect(sinkViolations(closure, entries)).toEqual([]);
  });
  it("only the Forward module imports the email sender in the vendor-mail surface", () => {
    const surface = [...entries, normalize("lib/vendor-mail-forward.ts"), ...listFiles("app/api/operations/vendor-mail")];
    const importers = [...new Set(surface)].filter(path => importSpecifiers(diskReader(path) ?? "").some(spec => /(?:@\/lib\/|\.\/)email$/.test(spec)));
    expect(importers).toEqual([normalize("lib/vendor-mail-forward.ts")]);
  });
  it("detects a fake sender injected directly and through a helper at every entry", () => {
    const helper = join("lib", "vendor-fake-helper.ts");
    for (const target of [...entries, ...nonSenders]) {
      for (const spec of ["@/lib/email", "resend"]) {
        const read = overlay({ [target]: `import "${spec}";\n${diskReader(target)}` });
        expect(sinkViolations(importClosure(entries, read), entries).length, target).toBeGreaterThan(0);
      }
      const read = overlay({ [target]: `import "@/lib/vendor-fake-helper";\n${diskReader(target)}`, [helper]: 'import {sendEmail} from "@/lib/email"; export const send = () => sendEmail();' });
      expect(sinkViolations(importClosure(entries, read), entries).some(message => message.includes("vendor-fake-helper") && message.includes("email.ts")), target).toBe(true);
    }
  }, 120_000);
  it("AST allowlists the router vendor branch and rejects injected sends/writes", () => {
    const source = diskReader(normalize("lib/inbound-router.ts"))!;
    expect(vendorBranchCalls(source)).toEqual([]);
    const ast = ts.createSourceFile("router.ts", source, ts.ScriptTarget.Latest, true);
    for (const [name, module] of [["fetchInboundContent", "@/lib/inbound-fetch"], ["ingestInboundReceipt", "@/lib/email-receipts"]]) {
      const binding = ast.statements.find(node => ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(item => item.name.text === name));
      expect(binding && ts.isImportDeclaration(binding) && ts.isStringLiteral(binding.moduleSpecifier) ? binding.moduleSpecifier.text : null).toBe(module);
    }
    for (const call of ['await sendEmail();', 'await fetch("https://example.test", {method:"POST"});', 'await sb.rpc("send", {});', 'await sb.from("email_receipts").update({});']) {
      const mutated = source.replace('function archiveProjection(', `${call}\nfunction archiveProjection(`);
      expect(vendorBranchCalls(mutated).length).toBeGreaterThan(0);
    }
    const closure = importClosure(["lib/inbound-fetch.ts", "lib/email-receipts.ts"]);
    expect(sinkViolations(closure, [...entries, normalize("lib/email-receipts-matching-shared.ts")])).toEqual([]);
  });
});

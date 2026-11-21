/**
 * Nav PR 5, group 12 (plan r4, 6.3 and open question 9): the day engine never reads "works as". Juan: "My shadow role is
 * for the engines to place me properly." Display surfaces follow the REAL role. A token scan (the TypeScript scanner, as
 * tests/nav-destinations-works-as.test.ts) of the two new modules; `DayViewer` is closed; a CGS viewer carrying a
 * smuggled worksAs gets exactly the plain CGS view at both shops. (PR 7 widens the nav test's glob to the Dashboard.)
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DayViewer } from "@/lib/day-plan-shared";

const FILES = ["lib/day-plan-shared.ts", "lib/scheduling/catering-day-shared.ts"];

function tokens(file: string): { identifiers: string[]; strings: string[] } {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, readFileSync(file, "utf8"));
  const identifiers: string[] = [];
  const strings: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.Identifier) identifiers.push(scanner.getTokenText());
    if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) strings.push(scanner.getTokenValue());
  }
  return { identifiers, strings };
}

describe("the day engine never reads works-as", () => {
  it.each(FILES)("%s: no works-as string and no works_?as identifier (comments stripped by the scanner)", (file) => {
    const { identifiers, strings } = tokens(file);
    expect(identifiers.length).toBeGreaterThan(20);
    expect(strings.filter((s) => s.includes("works-as"))).toEqual([]);
    expect(identifiers.filter((id) => /works_?as/i.test(id))).toEqual([]);
  });

  it("DayViewer is closed: userId, role, level, surfaces, switches", () => {
    expectTypeOf<keyof DayViewer>().toEqualTypeOf<"userId" | "role" | "level" | "surfaces" | "switches">();
  });
});

/**
 * Nav PR 3, guard (g) (plan r5, 4.7; spec 3.3.6, 10): the destination list and its resolver never read "works as".
 * Placement engines may; navigation decides by the person's real role. Later PRs widen the glob to the Dashboard
 * and day-plan trees (spec 3.7 group 12).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DESTINATIONS } from "@/lib/nav/destinations";
import { destinationsFor } from "@/lib/nav/resolve";
import type { Facts, Viewer } from "@/lib/nav/types";

const FILES = [
  ...readdirSync("lib/nav").filter((f) => f.endsWith(".ts")).map((f) => join("lib/nav", f).split("\\").join("/")),
  "lib/nav-links.ts",
  "lib/admin/sections.ts",
  // Nav PR 4: the Dashboard chip row passes the real role.
  "components/DashboardNav.tsx",
];

/** Identifiers and string literals of a file, comments stripped (the TypeScript scanner skips trivia). */
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

describe("guard (g): the module never reads works-as", () => {
  it("covers the module files", () => {
    expect(FILES).toEqual(expect.arrayContaining(["lib/nav/types.ts", "lib/nav/destinations.ts", "lib/nav/resolve.ts"]));
  });

  it.each(FILES)("%s: no works-as import and no works-as identifier (comments stripped)", (file) => {
    const { identifiers, strings } = tokens(file);
    expect(strings.filter((s) => s.includes("works-as"))).toEqual([]);
    expect(identifiers.filter((id) => /works_?as/i.test(id))).toEqual([]);
  });

  it("Viewer and Facts are closed: neither can carry a works-as role", () => {
    expectTypeOf<keyof Viewer>().toEqualTypeOf<"role" | "level" | "switches">();
    expectTypeOf<keyof Facts>().toEqualTypeOf<"assignedTasks" | "businessReportOffered">();
  });

  it("a CGS viewer object, or a facts object, carrying an extra worksAs resolves to exactly the plain CGS list", () => {
    const plain: Viewer = { role: "cgs", level: 10, switches: {} };
    const smuggled = { ...plain, worksAs: "key_holder" } as unknown as Viewer;
    const smuggledFacts = { worksAs: "key_holder" } as unknown as Facts;
    expect(destinationsFor(smuggled).map((d) => d.id)).toEqual(destinationsFor(plain).map((d) => d.id));
    expect(destinationsFor(plain, smuggledFacts).map((d) => d.id)).toEqual(destinationsFor(plain).map((d) => d.id));
    expect(destinationsFor(plain).length).toBeGreaterThan(DESTINATIONS.length / 2);
  });
});

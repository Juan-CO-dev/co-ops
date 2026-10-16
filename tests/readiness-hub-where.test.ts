/**
 * Catalog Phase 3b lead decision: hub readiness counts are ATTRIBUTED per shop — "1 in the default · 2 at P Street" —
 * by the shop's NAME (never a location code), each entry linking to that scope's list (3a Task 6b's data).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readinessWhereEntries } from "@/lib/admin/readiness-scope-shared";
import { serverT } from "@/lib/i18n/server";

const LOC = "6f1d2c3e-0000-4000-8000-00000000000a";
const LOC2 = "6f1d2c3e-0000-4000-8000-00000000000b";
const byScope = [
  { scope: null, scopeName: null, skus: 0, recipes: 1, items: 0 },
  { scope: LOC, scopeName: "P Street", skus: 2, recipes: 2, items: 3 },
  { scope: LOC2, scopeName: "Capitol Hill", skus: 0, recipes: 0, items: 1 },
];
const words = (lang: "en" | "es", section: "recipes" | "items", href: string) =>
  readinessWhereEntries(section, href, byScope).map((e) => serverT(lang, e.key, e.params)).join(" · ");

describe("hub readiness, attributed per shop", () => {
  it("reads '1 in the default · 2 at P Street' — the default first, then each shop with failures, by name (en + es)", () => {
    expect(words("en", "recipes", "/admin/recipes")).toBe("1 in the default · 2 at P Street");
    expect(words("es", "recipes", "/admin/recipes")).toBe("1 en el predeterminado · 2 en P Street");
    expect(words("en", "items", "/admin/items")).toBe("3 at P Street · 1 at Capitol Hill");
  });
  it("each entry links to that scope's list", () => {
    expect(readinessWhereEntries("skus", "/admin/skus", byScope).map((e) => e.href))
      .toEqual([`/admin/skus?location=${LOC}`]);
    expect(readinessWhereEntries("recipes", "/admin/recipes", byScope).map((e) => e.href))
      .toEqual(["/admin/recipes?location=global", `/admin/recipes?location=${LOC}`]);
    expect(readinessWhereEntries("items", "/admin/items", byScope).map((e) => e.href))
      .toEqual([`/admin/items?view=registry&location=${LOC}`, `/admin/items?view=registry&location=${LOC2}`]);
  });
  it("the hub renders the entries with a dot between them, every link 44px", () => {
    const src = readFileSync("app/admin/page.tsx", "utf8");
    expect(src).toContain("readinessWhereEntries(s.id, s.href, byScope)");
    expect(src).toMatch(/<span aria-hidden="true"[^>]*>·<\/span>/);
    expect(src).toContain("inline-flex min-h-[44px] items-center font-bold text-co-text underline");
    expect(src).not.toMatch(/["'](EM|MEP)["']/);
  });
});

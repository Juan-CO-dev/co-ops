import { expect, it } from "vitest";
import Page from "@/app/admin/menu-costing/page";
it.each([
  [undefined, ""], ["shop-a", "?location=shop-a"], ["global", "?location=global"],
  ["shop & other", "?location=shop+%26+other"], [["a", "b"], "?location=a&location=b"],
] as const)("permanently redirects preserving location %j", async (location, expected) => {
  await expect(Page({ searchParams: Promise.resolve({ location: Array.isArray(location) ? [...location] : location as string | undefined }) })).rejects.toMatchObject({
    digest: `NEXT_REDIRECT;replace;/admin/sandwiches${expected};308;`,
  });
});

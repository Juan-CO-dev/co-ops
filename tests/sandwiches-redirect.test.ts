import { expect, it } from "vitest";
import Page from "@/app/admin/menu-costing/page";
it.each([undefined, "shop-a", "global", "shop & other", ["a", "b"]])("permanently redirects preserving location %j", async location => {
  const query = new URLSearchParams();
  for (const value of Array.isArray(location) ? location : location === undefined ? [] : [location]) query.append("location", value);
  await expect(Page({ searchParams: Promise.resolve({ location }) })).rejects.toMatchObject({
    digest: `NEXT_REDIRECT;replace;/admin/sandwiches${query.size ? `?${query}` : ""};308;`,
  });
});

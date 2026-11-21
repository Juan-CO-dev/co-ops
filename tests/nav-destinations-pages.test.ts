/**
 * Nav PR 3, guard (a) (plan r5, 4.1): every page is a destination, a child of exactly one destination, or on a short
 * named list (public, planned, redirect, print). And the reverse: no stale destination route, child or named entry.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "@/lib/nav/destinations";
import { NAMED_PAGES, pageFiles } from "./helpers/nav-pages";

const pages = pageFiles();
const routes = DESTINATIONS.map((d) => d.route);
const children = DESTINATIONS.flatMap((d) => (d.children ?? []).map((c) => ({ child: c, owner: d.id })));

describe("guard (a): every page has exactly one place", () => {
  it("the inventory after nav PR 2: 126 pages = 84 destinations + 20 children + 22 named", () => {
    expect(pages.size).toBe(126);
    expect(DESTINATIONS).toHaveLength(84);
    expect(children).toHaveLength(20);
    expect(Object.keys(NAMED_PAGES)).toHaveLength(22);
  });

  it.each([...pages.keys()])("%s is in exactly one of: destination, child, named", (route) => {
    const places = [
      ...routes.filter((r) => r === route).map(() => "destination"),
      ...children.filter((c) => c.child === route).map((c) => `child of ${c.owner}`),
      ...(NAMED_PAGES[route] ? [`named (${NAMED_PAGES[route]!.category})`] : []),
    ];
    expect(places, route).toHaveLength(1);
  });

  it("every destination route, child pattern and named entry is a real page (nothing stale)", () => {
    const stale = [...routes, ...children.map((c) => c.child), ...Object.keys(NAMED_PAGES)].filter((r) => !pages.has(r));
    expect(stale).toEqual([]);
  });

  it("the two named redirects really redirect where they say", () => {
    expect(readFileSync(pages.get("/written-reports")!, "utf8")).toMatch(/[rR]edirect\([^)]*\/reports\/written/);
    expect(readFileSync(pages.get("/admin/menu-costing")!, "utf8")).toMatch(/[rR]edirect\([^)]*\/admin\/sandwiches/);
  });
});

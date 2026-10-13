// tests/guides-v2-shape.test.ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { englishSections, SPANISH_HEADING } from "@/lib/guides/readability-shared";

const source = (p: string) => readFileSync(p, "utf8");

describe("guides v2 loader (one file per guide, Spanish inside it)", () => {
  it("reads only the base guide, with no launch file and no language key", () => {
    const content = source("lib/guides/content.ts");
    expect(content).not.toMatch(/launch-/);
    expect(content).toMatch(/export function loadGuide\(slug: GuideSlug\): GuideDoc/);
    expect(content).toMatch(/const parsed = new Map<GuideSlug, GuideDoc>\(\)/);
  });
  it("the training page asks for a guide by slug only", () => {
    expect(source("app/training/page.tsx")).toMatch(/loadGuide\(slug\)/);
  });
});

describe("guides v2 content shape", () => {
  const guides = ["staff", "manager", "catering"] as const;
  it.each(guides)("every ## section of the %s guide has its Spanish", (g) => {
    const md = source(`docs/guides/${g}-guide.md`);
    const missing = md.split(/^## /m).slice(1).filter((part) => !SPANISH_HEADING.test(part)).map((part) => part.split("\n")[0]);
    expect(missing).toEqual([]);
    expect(englishSections(md).length).toBeGreaterThan(3);
  });
  it.each(guides)("every photo the %s guide links exists", (g) => {
    const md = source(`docs/guides/${g}-guide.md`);
    const links = [...md.matchAll(/!\[[^\]]*\]\((img\/[^)]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(5);
    for (const l of links) expect(existsSync(`docs/guides/${l}`), l).toBe(true);
  });
  it("the guides open with Start here and run in shift order", () => {
    for (const g of guides) {
      const heads = source(`docs/guides/${g}-guide.md`).split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).toLowerCase());
      expect(heads[0], g).toMatch(/start here/);
    }
    const order = (g: string, words: string[]) => {
      const md = source(`docs/guides/${g}-guide.md`).toLowerCase();
      const at = words.map((w) => md.indexOf(`## ${w}`));
      expect(at.every((i) => i > -1), `${g}: ${words.join(" → ")}`).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    };
    order("staff", ["start here", "morning", "all day", "night"]);
    order("manager", ["start here", "morning", "all day", "night"]);
  });
  it("the launch files are gone", () => {
    expect(readdirSync("docs/guides").filter((f) => f.startsWith("launch-"))).toEqual([]);
  });
});

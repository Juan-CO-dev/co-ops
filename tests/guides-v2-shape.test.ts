// tests/guides-v2-shape.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

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

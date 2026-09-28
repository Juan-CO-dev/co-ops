import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

// Vercel applies .vercelignore to GIT deploys too ("Found .vercelignore" in the build log). A bare `docs`
// line deleted docs/guides before `next build`, so /training (lib/guides/content.ts reads the Markdown at
// runtime) rendered its error page with ENOENT. Found 2026-09-28; this pins every guide file against it.

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe(".vercelignore keeps the training guides in the deploy", () => {
  const ig = ignore().add(readFileSync(join(ROOT, ".vercelignore"), "utf8"));
  // Exactly what the runtime reads: next.config.ts outputFileTracingIncludes for /training and the guide image route.
  const guideFiles = walk(join(ROOT, "docs", "guides"))
    .map((f) => relative(ROOT, f).split(sep).join("/"))
    .filter((f) => /^docs\/guides\/[^/]+-guide\.md$/.test(f) || /^docs\/guides\/img\/.+\.png$/.test(f));

  it("finds the guides this test protects", () => {
    expect(guideFiles).toContain("docs/guides/staff-guide.md");
    expect(guideFiles).toContain("docs/guides/manager-guide.md");
    expect(guideFiles).toContain("docs/guides/catering-guide.md");
  });

  it("never ignores a guide file or its images", () => {
    expect(guideFiles.filter((f) => ig.ignores(f))).toEqual([]);
  });

  it("still keeps the rest of docs/ out of the deploy", () => {
    expect(ig.ignores("docs/ROADMAP.md")).toBe(true);
  });
});

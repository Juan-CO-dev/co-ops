/**
 * Juan's path, pinned end to end (2026-09-28: "The link from the dashboard
 * through training didn't get me there, I had to manually put the link in.").
 *
 * ROOT CAUSE: not a link. `.vercelignore` said `docs`, and Vercel applies it to
 * GIT deploys too ("Removed N ignored files defined in .vercelignore" in every
 * build log). docs/guides/*.md was deleted before `next build`, so /training threw
 * ENOENT on staff-guide.md and rendered its error page — the dashboard chip and
 * the Learn-the-build card were fine, but the page between them never rendered.
 * /training/build/crunchy-boi reads no docs/ file, so typing it worked.
 *
 * This file follows the real links (dashboard chip → /training → the card →
 * the page), checks the gating each hop actually uses, and — the part that would
 * have caught it — checks that every file a route reads at RUNTIME survives
 * .vercelignore.
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";
import { chipHref, navDestinationsFor } from "@/lib/nav-links";
import { parentFor } from "@/lib/nav-parents";
import { buildCardForSlug } from "@/lib/training/build-cards";
import { BUILD_DEFS, buildDefForSlug, learnTheBuildHref } from "@/lib/training/build-card-shared";

const vercelIgnore = ignore().add(readFileSync(".vercelignore", "utf8"));
const deployed = (file: string) => !vercelIgnore.ignores(file.replace(/\\/g, "/").replace(/^\.\//, ""));

describe("dashboard → Training → Learn the build → the page", () => {
  it("hop 1: every role level gets the Training chip, and it is a plain /training href (unscoped)", () => {
    for (let level = 1; level <= 10; level++) {
      const training = navDestinationsFor(level).find((d) => d.key === "nav.training");
      expect(training, `level ${level}`).toBeTruthy();
      expect(chipHref(training!.href, training!.scoped, "some-location-id")).toBe("/training");
    }
  });

  it("hop 2: /training gates on a session only, and renders the Learn-the-build card on BOTH branches", () => {
    const src = readFileSync("app/training/page.tsx", "utf8");
    expect(src).toMatch(/requireSessionFromHeaders\("\/training"\)/);
    // one in the no-guide branch, one in the guides branch: no role can land on /training without it
    expect(src.match(/<LearnTheBuildEntry /g)).toHaveLength(2);
    expect(src).toMatch(/href=\{learnTheBuildHref\(d\.slug\)\}/);
  });

  it("hop 3: every card href is a real route whose def and card resolve, gated by session only", () => {
    expect(existsSync("app/training/build/[item]/page.tsx")).toBe(true);
    const page = readFileSync("app/training/build/[item]/page.tsx", "utf8");
    expect(page).toMatch(/requireSessionFromHeaders\(/);
    expect(page).not.toMatch(/\.level\s*[<>]/); // no role floor on the build page
    for (const d of BUILD_DEFS) {
      const href = learnTheBuildHref(d.slug);
      expect(href).toBe(`/training/build/${d.slug}`);
      const slug = href.split("/").pop()!;
      expect(buildDefForSlug(slug)).not.toBeNull();
      expect(buildCardForSlug(slug)).not.toBeNull();
      expect(parentFor(href).href).toBe("/training");
    }
  });
});

describe("every file a route reads at runtime survives .vercelignore (the actual bug)", () => {
  const includes = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;

  it("the three guides and their screenshots are deployed", () => {
    for (const g of ["staff", "manager", "catering"]) {
      const f = `docs/guides/${g}-guide.md`;
      expect(existsSync(f), f).toBe(true);
      expect(deployed(f), f).toBe(true);
    }
    const pngs = globSync("docs/guides/img/**/*.png");
    expect(pngs.length).toBeGreaterThan(0);
    expect(pngs.filter((f) => !deployed(f))).toEqual([]);
  });

  it.each(Object.entries(includes))("%s: every traced include exists and is deployed", (_route, globs) => {
    for (const g of globs) {
      const files = globSync(g.replace(/^\.\//, ""));
      expect(files.length, g).toBeGreaterThan(0);
      expect(files.filter((f) => !deployed(f)), g).toEqual([]);
    }
  });

  it("the rest of docs/ stays out, as intended", () => {
    expect(deployed("docs/seed/source/sandwich-build-sheet.csv")).toBe(false);
    expect(deployed("docs/runbooks/training-assets.md")).toBe(false);
    expect(deployed(path.join("docs", "ROADMAP.md"))).toBe(false);
  });
});

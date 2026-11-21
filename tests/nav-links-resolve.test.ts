/**
 * Every in-app link literal must name a page that exists (links audit, 2026-11-20).
 *
 * Walks app/ for the page routes (route groups dropped, [dynamic] segments kept) and scans app/, components/ and
 * lib/ for quoted path literals under the staff app's top-level routes. A literal with no matching page is a 404
 * waiting for a click (the catering inbox's Quote button pointed at /catering/quotes/<id>, a route that never
 * existed: quote detail is a client view of /catering/quotes).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (file: string) => relative(ROOT, file).split(sep).join("/");

const pagePatterns = walk(join(ROOT, "app"))
  .map(rel)
  .filter((f) => /(^|\/)page\.tsx?$/.test(f))
  .map((f) => "/" + f.replace(/^app\//, "").replace(/(^|\/)page\.tsx?$/, "").split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/"));

function pageExists(path: string): boolean {
  const cs = path.split("/").filter(Boolean);
  return pagePatterns.some((pattern) => {
    const ps = pattern.split("/").filter(Boolean);
    return ps.length === cs.length && ps.every((seg, i) => (seg.startsWith("[") ? true : seg === cs[i]));
  });
}

const TOP = "dashboard|reports|admin|operations|catering|assignments|cash|pm-report|maintenance|mid-shift|my-feedback|profile|schedule|settings|stations|vault|lto|ordering|training|written-reports|recipes|announcements|ai|comms|feedback|tips|rollups|deep-cleaning|order|eat|verify|reset-password";
const LITERAL = new RegExp("([`\"'])(/(?:" + TOP + ")(?:[/?#][^`\"'\\s]*)?)\\1", "g");

/** Files whose path literals are patterns, prefixes, prose or assets rather than links. */
const NOT_LINKS = new Set([
  "lib/nav-parents.ts", // route PATTERNS ("/admin/[section]")
  "lib/session.ts", // prose ("/admin/...")
  "lib/shop-context-shared.ts", // route PREFIXES
  "app/eat/layout.tsx", // icon assets
]);

describe("in-app link literals resolve to a page", () => {
  it("finds the route inventory", () => {
    expect(pagePatterns).toContain("/dashboard");
    expect(pagePatterns).toContain("/catering/quotes");
    expect(pagePatterns).not.toContain("/catering/quotes/[id]");
  });

  it("every literal path under a staff route names an existing page", () => {
    const broken: string[] = [];
    const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib"))]
      .map(rel)
      .filter((f) => /\.(tsx?|mjs)$/.test(f) && !f.startsWith("app/api/") && !f.startsWith("lib/landing/") && !NOT_LINKS.has(f));
    for (const file of files) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(LITERAL)) {
          const path = m[2]!.split(/[?#]/)[0]!.replace(/\$\{[^}]*\}/g, "[x]");
          if (!pageExists(path)) broken.push(`${file}:${i + 1} ${m[2]}`);
        }
      });
    }
    expect(broken).toEqual([]);
  });
});

describe("staff pages that were missing a way back render one", () => {
  it.each(["app/(authed)/schedule/page.tsx", "app/(authed)/schedule/settings/page.tsx", "app/(authed)/stations/page.tsx"])("%s renders the registry BackLink", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src).toContain('import { BackLink } from "@/components/nav/BackLink"');
    expect(src).toContain("<BackLink");
  });
});

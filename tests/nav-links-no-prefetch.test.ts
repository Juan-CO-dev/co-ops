/**
 * Nav PR 9, S4 (plan r2 6.2, 6.4; lead ruling r1 R4): every <Link> in components/nav/** is `prefetch={false}`.
 *
 * Why: (authed) has a loading.tsx, so a default prefetch of a non-admin page from an admin page renders the (authed)
 * layout on the server, whose session check passes "/dashboard" and CLEARS the step-up unlock. The always-visible
 * Dashboard link and a sheet full of links would clear it on every admin page load.
 *
 * ONE named exemption: components/nav/BackLink.tsx (a registry back link, default prefetch today), until the R4 check on
 * a production build with a cold router cache decides it (plan 6.4). That check is P3's last step in the sim journey
 * (scripts/sim/launch-readiness/journeys/nav-top-bar.spec.ts), run by CC on the reviewed preview build. If it
 * reproduces, BackLink gets `prefetch={false}` when it leaves /admin and this exemption is deleted in that commit; if
 * not, the evidence (build id, network log line, result) is cited here and in the PR.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "components", "nav");
const EXEMPT = new Set(["components/nav/BackLink.tsx"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(e) ? [full] : [];
  });
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Each `<Link …>` opening tag (attributes with nested braces and arrows included). */
function linkTags(src: string): string[] {
  const out: string[] = [];
  const re = /<Link\b/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0;
    let i = m.index + 5;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

describe("S4: no prefetch from the bar and its sheets", () => {
  const files = walk(DIR).map((f) => ({ file: rel(f), src: readFileSync(f, "utf8") }));
  it("finds the bar's links (the census is not vacuous)", () => {
    const withLinks = files.filter((f) => !EXEMPT.has(f.file) && linkTags(f.src).length > 0).map((f) => f.file).sort();
    expect(withLinks).toEqual(["components/nav/GoToSheet.tsx", "components/nav/PeopleResults.tsx", "components/nav/TopBarDashboardLink.tsx"]);
  });
  it.each(walk(DIR).map(rel).filter((f) => !EXEMPT.has(f)))("%s: every <Link> carries prefetch={false}", (file) => {
    for (const tag of linkTags(readFileSync(path.join(ROOT, file), "utf8"))) expect(tag, tag).toMatch(/\bprefetch=\{false\}/);
  });
  it("the one named exemption is BackLink, until the R4 check decides it", () => {
    expect([...EXEMPT]).toEqual(["components/nav/BackLink.tsx"]);
  });
});

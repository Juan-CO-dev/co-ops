/**
 * three.js stays OUT of the initial bundle: the only file under app/ or components/ that mentions the
 * `three` package is Floor3D.tsx, and there only as a dynamic `import("three")`; FloorCard reaches
 * Floor3D only through next/dynamic with ssr:false. The post-build chunk check in the PR body is the
 * runtime half of this evidence; this test keeps the static half from regressing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const files = [...walk("app"), ...walk("components"), ...walk("lib")];
const mentionsThree = (src: string) => /["']three(\/[^"']*)?["']/.test(src);

describe("three.js lazy-load invariant", () => {
  it("only components/pulse/floor/Floor3D.tsx references the three package (training's vendored bundle aside)", () => {
    const offenders = files.filter((f) => !f.includes("vendor") && mentionsThree(readFileSync(f, "utf8"))).map((f) => f.replace(/\\/g, "/"));
    expect(offenders).toEqual(["components/pulse/floor/Floor3D.tsx"]);
  });
  it("Floor3D imports three dynamically only (no static import), and FloorCard loads Floor3D via next/dynamic ssr:false", () => {
    const floor3d = readFileSync("components/pulse/floor/Floor3D.tsx", "utf8");
    expect(floor3d).toMatch(/await import\("three"\)/);
    expect(floor3d).not.toMatch(/^import .* from ["']three["']/m);
    // Type-only references erase at build time and are allowed.
    const typeOnly = floor3d.match(/import\("three"\)/g) ?? [];
    expect(typeOnly.length).toBeGreaterThan(0);
    const card = readFileSync("components/pulse/floor/FloorCard.tsx", "utf8");
    expect(card).toMatch(/dynamic\(\(\) => import\("@\/components\/pulse\/floor\/Floor3D"\), \{\s*ssr: false/);
    expect(card).not.toMatch(/from ["']@\/components\/pulse\/floor\/Floor3D["']/);
  });
  it("Floor3D is a client component and the pulse shell never imports it directly", () => {
    expect(readFileSync("components/pulse/floor/Floor3D.tsx", "utf8").startsWith('"use client"')).toBe(true);
    for (const f of ["components/pulse/PulseClient.tsx", "components/pulse/SectionBody.tsx", "app/(authed)/mid-shift/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toContain("Floor3D");
    }
  });
});

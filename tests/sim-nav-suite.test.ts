/**
 * Nav PR 9 (plan r2 8.3): the `nav` suite is registered in the sim launch-readiness harness: cold-empty only, production
 * only, 375 px projects only, and the parent-only password control reaches only its Playwright child. Source and
 * argument pins; the journey itself runs on the sim, by CC, before merge (never in CI).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the nav suite in the harness", () => {
  it("parseArgs: cold-empty only, production only", async () => {
    const { parseArgs, SUITES } = await import("../scripts/sim/launch-readiness/run");
    expect(SUITES).toContain("nav");
    expect(parseArgs(["--suite", "nav", "--fixture", "cold-empty"]).suite).toBe("nav");
    for (const args of [["--suite", "nav", "--fixture", "warm-history"], ["--suite", "nav", "--fixture", "cold-empty", "--dev"]]) {
      expect(() => parseArgs(args), args.join(" ")).toThrow("usage");
    }
  });
  it("the config selects the nav journey and only the two 375 px projects for it", () => {
    const config = readFileSync("scripts/sim/launch-readiness/playwright.config.ts", "utf8");
    expect(config).toContain('nav: "nav-top-bar"');
    expect(config).toContain("process.env.LRA_NAV_SLICE");
    expect(config).toMatch(/name: `phone375-\$\{locale\}`[^\n]*viewport: \{ width: 375, height: 812 \}/);
    expect(config).toMatch(/!\/\^phone375-\(en\|es\)-\[1-9\]\\d\*\$\/\.test\(slice\)/);
  });
  it("the runner: 375 px projects, no Node contracts, the password only for the nav Playwright child, never the contender", () => {
    const run = readFileSync("scripts/sim/launch-readiness/run.ts", "utf8");
    expect(run).toContain('const allProjects = suite === "nav" ? ["phone375-en", "phone375-es"]');
    expect(run).toContain('suite === "nav" ? noContracts');
    expect(run).toContain("delete contenderEnv.SIM_NAV_PASSWORD_MARCUS;");
    expect(run).toMatch(/const navPassword = suite === "nav" && process\.env\.SIM_NAV_PASSWORD_MARCUS/);
    // The app server never gets it: startProduction and the dev launch take the loaded .env.sim only.
    expect(run).not.toMatch(/startProduction\(\{ env: \{[^}]*SIM_NAV_PASSWORD/);
  });
  it("the journey exists with P1-P4 and R4's recorded annotation", () => {
    const spec = readFileSync("scripts/sim/launch-readiness/journeys/nav-top-bar.spec.ts", "utf8");
    for (const t of ["P1:", "P2:", "P3:", "P4:"]) expect(spec).toContain(`test("${t}`);
    expect(spec).toContain('type: "nav.r4"');
    expect(spec).toContain("context.tracing.stop()");
  });
});

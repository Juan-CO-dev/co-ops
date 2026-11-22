/**
 * Nav PR 9 (plan r2 8.3): the `nav` suite is registered in the sim launch-readiness harness: cold-empty only, production
 * only, 375 px projects only, and the parent-only password control reaches only its Playwright child. Source and
 * argument pins; the journey itself runs on the sim, by CC, before merge (never in CI).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIM_PROJECT_REF } from "../lib/sim-isolation-shared";

// The synthetic, valid .env.sim of tests/sim-isolation.test.ts (placeholders only).
const simFixture = (): Record<string, string> => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sk_sim_placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "sk_sim_placeholder", AUTH_PIN_PEPPER: "sim_pin_placeholder",
  AUTH_PASSWORD_PEPPER: "sim_password_placeholder", AUTH_JWT_SECRET: "ab".repeat(32),
  NEXT_PUBLIC_STOREFRONT_LOCATION_ID: "11111111-1111-4111-8111-111111111111",
});

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
    expect(run).toContain("const contenderEnv = withoutNodeOnlyControls(process.env);");
    expect(run).toMatch(/const navPassword: Record<string, string> = suite === "nav" && process\.env\.SIM_NAV_PASSWORD_MARCUS/);
    expect(run).toMatch(/LRA_NAV_SLICE" : "LRA_CUSTOMER_SLICE"\]: slice \}, navPassword\);/);
  });
  // Astra code r1 P2: the CONSTRUCTED environments, not source text. A parent env carrying the password (any letter
  // case) yields an app / build env (buildChildEnv, what loadSimEnv returns and startProduction / the dev launch
  // take), a contender env and a plain launched child without it; only an explicit `extra` puts it back.
  it.each(["SIM_NAV_PASSWORD_MARCUS", "sim_nav_password_marcus", "Sim_Nav_Password_Marcus", "SIM_CATALOG_PASSWORD", "sim_catalog_password"])(
    "the parent-only control %s never reaches the app, build, contender or a plain child env",
    async key => {
      const { buildChildEnv, withoutNodeOnlyControls } = await import("../lib/sim-isolation-shared");
      const { launchEnv } = await import("../scripts/sim/launch-readiness/run");
      const sentinel = "synthetic-parent-only-sentinel";
      const parent = { [key]: sentinel, PATH: "synthetic_path" };
      const leaks = (env: Record<string, string | undefined>) => Object.entries(env).filter(([k, v]) => k.toUpperCase() === key.toUpperCase() || v === sentinel);
      expect(leaks(buildChildEnv(parent, simFixture()))).toEqual([]);
      expect(leaks(withoutNodeOnlyControls(parent))).toEqual([]);
      expect(leaks(launchEnv(parent))).toEqual([]);
      expect(launchEnv(parent).PATH).toBe("synthetic_path");
      expect(parent[key]).toBe(sentinel);
    },
  );
  it("only the nav Playwright child gets the password, through launch's explicit extra", async () => {
    const { launchEnv } = await import("../scripts/sim/launch-readiness/run");
    const env = launchEnv({ sim_nav_password_marcus: "inherited" }, { SIM_NAV_PASSWORD_MARCUS: "explicit" });
    expect(Object.keys(env).filter(k => k.toUpperCase() === "SIM_NAV_PASSWORD_MARCUS")).toEqual(["SIM_NAV_PASSWORD_MARCUS"]);
    expect(env.SIM_NAV_PASSWORD_MARCUS).toBe("explicit");
  });
  it("the journey exists with P1-P4 and R4's recorded annotation", () => {
    const spec = readFileSync("scripts/sim/launch-readiness/journeys/nav-top-bar.spec.ts", "utf8");
    for (const t of ["P1:", "P2:", "P3:", "P4:"]) expect(spec).toContain(`test("${t}`);
    expect(spec).toContain('type: "nav.r4"');
    expect(spec).toContain("context.tracing.stop()");
  });
});

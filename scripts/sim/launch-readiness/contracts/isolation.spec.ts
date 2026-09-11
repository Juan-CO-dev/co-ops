import { test, expect } from "../playwright.config";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SIM_PROJECT_REF } from "../../../../lib/sim-isolation-shared";

const good: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-key",
  AUTH_PIN_PEPPER: "synthetic-pepper", AUTH_PASSWORD_PEPPER: "synthetic-pepper",
  AUTH_JWT_SECRET: "ab".repeat(32), NEXT_PUBLIC_STOREFRONT_LOCATION_ID: "11111111-1111-4111-8111-111111111111",
};
const cases: [string, Record<string, string> | null, number][] = [
  ["valid config", good, 0],
  ["wrong DB", { ...good, NEXT_PUBLIC_SUPABASE_URL: "https://wrong.invalid" }, 1],
  ["unexpected host", { ...good, NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100" }, 1],
  ["missing config", { ...good, AUTH_PIN_PEPPER: "" }, 1],
  ["enabled external leg", { ...good, RESEND_API_KEY: "synthetic-provider" }, 1],
  ["missing file", null, 1],
];
for (const [name, file, expected] of cases) {
  test(`isolation CLI ${name}`, async ({ contract }) => {
    contract.assertionIds.push(`isolation.cli.${name.replaceAll(" ", "-")}`);
    const parent = resolve("scripts/sim/launch-readiness/.private", process.env.LRA_RUN_ID!, "negative-cases");
    mkdirSync(parent, { recursive: true });
    const dir = mkdtempSync(resolve(parent, "case-"));
    try {
      if (file) writeFileSync(resolve(dir, ".env.sim"), Object.entries(file).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join("\n"));
      const child = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/sim/launch-readiness/target.ts"), "check", dir], { shell: false, windowsHide: true, encoding: "utf8", timeout: 15_000, env: { ...process.env, NODE_OPTIONS: "" } });
      expect(child.error === undefined).toBe(true); expect(child.status).toBe(expected);
      expect(`${child.stdout}${child.stderr}`.includes("synthetic-key")).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
test("isolation in-app navigation has no external network contact", async ({ page, contract }) => {
  contract.assertionIds.push("isolation.app-network-no-external");
  await page.goto("/");
  await expect(page.getByRole("button", { name: /P Street/ })).toBeVisible();
  expect(contract.network.length).toBeGreaterThan(0);
  expect(contract.network.every(row => row.category === "app" || row.category === "sim-db")).toBe(true);
  expect(Object.keys(contract.denied)).toHaveLength(0);
  await contract.screenshot("outcome");
});

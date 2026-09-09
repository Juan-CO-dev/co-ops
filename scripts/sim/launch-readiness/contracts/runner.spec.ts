import { test, expect, login } from "../playwright.config";
import { SIM_LOCATIONS, personaByEmail } from "../../personas-shared";

test("runner tile login and manifest identity", async ({ page, contract }) => {
  contract.assertionIds.push("runner.tile-login", "runner.identity");
  await page.goto("/");
  for (const loc of Object.values(SIM_LOCATIONS)) await expect(page.getByRole("button", { name: new RegExp(loc.name) })).toBeVisible();
  expect(contract.manifest.runId).toBe(process.env.LRA_RUN_ID);
  expect(contract.manifest.identity).toEqual({ server: true, locations: true, personas: true, secondRunnerRefused: true });
  await contract.screenshot("start");
});
test("runner Marcus PIN and both shops", async ({ page, contract }) => {
  contract.assertionIds.push("runner.marcus-pin", "runner.both-shops");
  await login(page, personaByEmail("marcus@sim.co-ops"), "EM");
  for (const loc of Object.values(SIM_LOCATIONS)) await expect(page.getByRole("link", { name: new RegExp(loc.name) }).first()).toBeVisible();
  await contract.screenshot("outcome");
});
test("runner deliberate external destination refusal", async ({ page, contract }) => {
  contract.assertionIds.push("runner.external-denied");
  await page.goto("/"); contract.expectedDenials = 1;
  let refused = false;
  try { await page.goto("https://example.invalid/"); } catch { refused = true; }
  expect(refused).toBe(true); expect(contract.denied.external).toBe(1);
});

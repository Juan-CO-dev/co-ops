import { defineConfig, test as base, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Evidence, projectNetwork, type Projection, type Manifest } from "./evidence";
import { assertHeld } from "./lease.mjs";
import { SIM_APP_ORIGIN } from "../../../lib/sim-isolation-shared";
import { SIM_LOCATIONS, type SimPersona, type LocationCode } from "../personas-shared";
import { ROLES } from "../../../lib/roles";
import * as driver from "../concurrency/driver.mjs";
import en from "../../../lib/i18n/en.json";
import es from "../../../lib/i18n/es.json";

const runId = process.env.LRA_RUN_ID;
if (!runId || !/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Use run.ts under a host lease");
const suite = process.env.LRA_SUITE;
if (!["runner", "isolation", "personas"].includes(suite ?? "")) throw new Error("Unknown suite");
const artifacts = resolve("scripts/sim/launch-readiness/.artifacts", runId);
const privateDir = resolve("scripts/sim/launch-readiness/.private", runId);
export default defineConfig({
  testDir: "./contracts", testMatch: `${suite}.spec.ts`, workers: 1, fullyParallel: false, retries: 0, timeout: 90_000,
  outputDir: resolve(privateDir, "pw"),
  use: { browserName: "chromium", baseURL: SIM_APP_ORIGIN, serviceWorkers: "block", trace: "retain-on-failure", screenshot: "off", video: "off" },
  projects: ["phone", "tablet"].flatMap(device => ["en", "es"].map(locale => ({ name: `${device}-${locale}`, metadata: { locale }, use: { viewport: device === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 800 }, locale } }))),
  reporter: [["./evidence.ts"], ["list"], ["json", { outputFile: resolve(artifacts, "results.json") }], ["html", { outputFolder: resolve(artifacts, "html"), open: "never" }]],
});
type Contract = { manifest: Manifest; network: Projection[]; denied: Record<string, number>; expectedDenials: number; assertionIds: string[]; screenshot: (label: string) => Promise<void> };
export const test = base.extend<{ contract: Contract }>({
  contract: [async ({ page }, use, info) => {
    assertHeld(runId);
    const manifest = JSON.parse(readFileSync(resolve(artifacts, "manifest.json"), "utf8")) as Manifest;
    if (manifest.runId !== runId || !Object.values(manifest.identity).every(Boolean)) throw new Error("Parent identity receipt incomplete");
    await driver.init({ root: process.env.LRA_CONFIG_ROOT, assertLease: () => { assertHeld(runId); }, verifyServer: async () => { if (!manifest.identity.server) throw new Error("Unverified server"); } });
    const id = createHash("sha256").update(`${info.project.name}:${info.testId}:${info.repeatEachIndex}`).digest("hex").slice(0, 20);
    const evidence = new Evidence(runId, process.env.LRA_FIXTURE ?? "cold-empty");
    const shots: string[] = [], network: Projection[] = [], consoleEvents: { type: string }[] = [], denied: Record<string, number> = {};
    const contract: Contract = { manifest, network, denied, expectedDenials: 0, assertionIds: [], screenshot: async label => { shots.push(await evidence.screenshot(page, id, label)); } };
    const guard: Parameters<Page["route"]>[1] = async route => {
      const request = route.request(), projection = projectNetwork(request.method(), request.url());
      if (projection.category === "app" || projection.category === "sim-db") await route.continue();
      else { denied[projection.category] = (denied[projection.category] ?? 0) + 1; network.push(projection); await route.abort("blockedbyclient"); }
    };
    // Context guard covers popup first requests too; page guard precedes navigation.
    await page.context().route("**/*", guard); await page.route("**/*", guard);
    page.on("response", response => { const request = response.request(), timing = request.timing(); network.push(projectNetwork(request.method(), response.url(), response.status(), timing.responseEnd < 0 ? 0 : timing.responseEnd)); });
    page.on("console", message => { consoleEvents.push({ type: ["error", "warning", "info", "log", "debug"].includes(message.type()) ? message.type() : "other" }); });
    page.on("pageerror", () => { consoleEvents.push({ type: "pageerror" }); });
    try { await use(contract); }
    finally {
      if (info.status !== "passed" && !page.isClosed()) await contract.screenshot("failure");
      const actualDenials = Object.values(denied).reduce((a,b) => a+b, 0);
      mkdirSync(resolve(privateDir, "projections"), { recursive: true });
      const file = resolve(privateDir, "projections", `${id}.json`);
      writeFileSync(file, JSON.stringify({ test: { id, assertionIds: contract.assertionIds, viewport: page.viewportSize(), project: info.project.name, status: info.status, attempt: info.repeatEachIndex + 1 }, shots, network, console: consoleEvents, denied, expectedDenials: contract.expectedDenials }));
      if (!readFileSync(file).length) throw new Error("Missing test projection");
      expect(actualDenials, "only deliberate destination refusals are permitted").toBe(contract.expectedDenials);
    }
  }, { auto: true }],
});
export { expect, driver };
export async function selectPersona(page: Page, persona: SimPersona, code: LocationCode) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(SIM_LOCATIONS[code].name) }).click();
  // The role tile's accessible name is `<shortLabel><label>` ("GMGeneral Manager"); a bare label regex
  // also matches AGM's "…Assistant General Manager" → strict-mode violation (CC boot, 2026-09-09).
  const key = `role.${persona.role}` as keyof typeof en;
  const short = ROLES[persona.role].shortLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Accessible name is the tile's aria-label "Select role General Manager" (es: "… rol …"); the badge
  // form is tolerated too. Anchored at the end and requiring the label to START right after "role "
  // (or the badge), so AGM's "…Assistant General Manager" can never match GM. (aria snapshot, CC 2026-09-09)
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^(?:.*\\b(?:role|rol)\\s+)?(?:${short}\\s*)?(?:${esc(en[key])}|${esc(es[key])})$`) }).click();
}
export async function login(page: Page, persona: SimPersona, code: LocationCode) {
  const alias = persona.email.split("@")[0]!.toUpperCase(), pin = process.env[`SIM_PIN_${alias}`];
  if (!pin || !/^\d{4}$/.test(pin)) throw new Error(`SIM_PIN_${alias} required`);
  await selectPersona(page, persona, code);
  await page.getByRole("button", { name: new RegExp(persona.name) }).click();
  // No screenshots or trace recording during credential entry.
  await page.context().tracing.stop();
  try {
    await expect(page.getByRole("heading", { name: persona.name })).toBeVisible();
    const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/pin" && r.request().method() === "POST");
    await page.keyboard.type(pin);
    if (!(await response).ok()) throw new Error("PIN login refused");
    await page.waitForURL(url => url.pathname === "/dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", persona.language);
  } catch { throw new Error("Real UI PIN login failed"); }
  finally { await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); }
}

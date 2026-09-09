import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { Reporter, TestCase, TestResult, TestError } from "@playwright/test/reporter";
import { SIM_APP_ORIGIN, SIM_PROJECT_REF } from "../../../lib/sim-isolation-shared";

export const MASK_SELECTORS = ['input[type="password"]', 'input[inputmode="numeric"]', '[aria-label*="PIN"]', '[aria-label*="teclado" i]', '[data-sensitive]'] as const;
export type Projection = { method: string; route: string; status: number; timing: number; category: "app" | "sim-db" | "external" | "invalid" };
// Closed route vocabulary: unknown path segments can themselves contain secrets.
const ROUTES = new Set(["/", "/dashboard", "/api/locations", "/api/users/login-options", "/api/auth/pin", "/api/auth/logout"]);
export function projectNetwork(method: string, raw: string, status = 0, timing = 0): Projection {
  let category: Projection["category"] = "invalid", route = "/:redacted";
  try {
    const url = new URL(raw);
    category = url.username || url.password ? "invalid" : url.origin === SIM_APP_ORIGIN ? "app" : url.origin === `https://${SIM_PROJECT_REF}.supabase.co` ? "sim-db" : "external";
    if (category === "app") route = ROUTES.has(url.pathname) ? url.pathname : url.pathname.startsWith("/_next/") ? "/_next/:asset" : "/:route";
    if (category === "sim-db") route = "/rest-or-storage/:resource";
  } catch { /* Never copy caller text. */ }
  return { method: /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method) ? method : "OTHER", route, status, timing: Math.max(0, Math.round(timing)), category };
}
export function artifactComplete(bytes: Uint8Array): boolean { return bytes.byteLength > 0; }
export type Manifest = ReturnType<typeof newManifest>;
export function newManifest(runId: string, fixtureId: string) {
  const startedAt = new Date().toISOString();
  return { schemaVersion: 1, runId, candidateSha: "unavailable", dirty: true, dependencyLockHash: "unavailable", policyVersion: "f1-v1", buildId: "dev", fixture: { id: fixtureId, restore: "stub" as "stub" | "done" },
    personas: [] as { alias: string; role: string; level: number; language: string; locationCodes: string[] }[],
    etAnchor: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()), startedAt, finishedAt: null as string | null,
    tests: [] as { id: string; assertionIds: string[]; viewport: { width: number; height: number } | null; project: string; status: string; attempt: number }[],
    status: "blocked" as "pass" | "fail" | "blocked", reason: "not started", deniedDestinations: {} as Record<string, number>, expectedDenials: 0,
    identity: { server: false, locations: false, personas: false, secondRunnerRefused: false }, artifacts: [] as { file: string; sha256: string; bytes: number }[], reviewerProvenance: "unverified" };
}
export class Evidence {
  readonly directory: string;
  readonly manifest: Manifest;
  constructor(readonly runId: string, fixtureId: string, root = process.cwd()) {
    if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid run ID");
    this.directory = resolve(root, "scripts/sim/launch-readiness/.artifacts", runId);
    this.manifest = newManifest(runId, fixtureId);
  }
  write(file: string, value: unknown) {
    const destination = resolve(this.directory, file);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, JSON.stringify(value, null, 2));
    if (!artifactComplete(readFileSync(destination))) throw new Error("Empty evidence artifact");
  }
  async screenshot(page: Page, testId: string, label: string) {
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 100);
    const file = `shots/${safe(testId)}-${safe(label)}.png`;
    mkdirSync(resolve(this.directory, "shots"), { recursive: true });
    await page.screenshot({ path: resolve(this.directory, file), mask: MASK_SELECTORS.map(selector => page.locator(selector)), fullPage: true });
    return file;
  }
  finalize(files: string[], read: (file: string) => Uint8Array = readFileSync) {
    this.manifest.artifacts = [];
    for (const file of files) {
      try {
        if (file.includes(".private") || file.includes("..") || file.startsWith("/") || file.includes(":")) throw new Error();
        const bytes = read(resolve(this.directory, file));
        if (!artifactComplete(bytes)) throw new Error();
        this.manifest.artifacts.push({ file, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
      } catch { this.manifest.status = "fail"; this.manifest.reason = "missing or empty required artifact"; }
    }
    this.manifest.finishedAt = new Date().toISOString();
    this.write("manifest.json", this.manifest);
    return this.manifest;
  }
}

/** Runs BEFORE stock reporters. No raw console, error payloads, step arguments,
 * or attachments (especially trace ZIPs) may reach public JSON/HTML reports. */
export default class PublicProjectionReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult) {
    result.attachments = [];
    result.stdout = []; result.stderr = []; result.steps = [];
    result.errors = result.errors.map(() => ({ message: "Contract failed; inspect LOCAL private trace." }));
    if (result.error) result.error = { message: "Contract failed; inspect LOCAL private trace." };
  }
  onError(error: TestError) {
    for (const key of Object.keys(error)) delete (error as Record<string, unknown>)[key];
    error.message = "Runner infrastructure failure";
  }
}

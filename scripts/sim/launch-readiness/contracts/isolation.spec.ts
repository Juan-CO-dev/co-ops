/** F1 Node contract skeleton; Playwright and positive app boot belong to F4/F5.
 * node --import tsx scripts/sim/launch-readiness/contracts/isolation.spec.ts
 * Synthetic files only. No DB contact; negative CLI cases cannot spawn an app.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SIM_PROJECT_REF } from "../../../../lib/sim-isolation-shared";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const cli = resolve(root, "scripts/sim/launch-readiness/target.ts");
const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const temp = mkdtempSync(resolve(tmpdir(), "f1-isolation-"));
const good: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sk_sim_placeholder", SUPABASE_SERVICE_ROLE_KEY: "sk_sim_placeholder",
  AUTH_PIN_PEPPER: "sim_pin_placeholder", AUTH_PASSWORD_PEPPER: "sim_password_placeholder",
  AUTH_JWT_SECRET: "ab".repeat(32), NEXT_PUBLIC_STOREFRONT_LOCATION_ID: "11111111-1111-4111-8111-111111111111",
};

function runCase(name: string, file: Record<string, string> | null, expected: number, autoload?: string): void {
  const dir = resolve(temp, name);
  mkdirSync(dir);
  if (file) writeFileSync(resolve(dir, ".env.sim"), Object.entries(file).map(([key, value]) => `${key}="${value}"`).join("\n"));
  // A directory proves the loader rejects the filename before trying to read it.
  if (autoload) mkdirSync(resolve(dir, autoload));
  const result = spawnSync(process.execPath, ["--import", tsx, cli, "check", dir], {
    cwd: root, env: { ...process.env, ...good, NODE_OPTIONS: "", SIM_MODE: "", RESEND_API_KEY: "inherited_sim_placeholder" },
    encoding: "utf8", timeout: 30_000, shell: false,
  });
  assert.equal(result.error, undefined, `${name}: child launch failed`);
  assert.equal(result.status, expected, `${name}: unexpected exit code`);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("sk_sim_placeholder"), `${name}: value disclosure`);
  console.log(`PASS ${name}: exit ${expected}`);
}

try {
  runCase("positive", good, 0);
  runCase("wrong-DB", { ...good, NEXT_PUBLIC_SUPABASE_URL: "https://wrong.invalid" }, 1);
  runCase("unexpected-host", { ...good, NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100" }, 1);
  const missing = { ...good }; delete missing.AUTH_PIN_PEPPER;
  runCase("missing-config", missing, 1);
  runCase("enabled-external-leg", { ...good, RESEND_API_KEY: "sk_sim_placeholder" }, 1);
  runCase("missing-file", null, 1);
  for (const [index, name] of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"].entries()) runCase(`autoload-${index}`, good, 1, name);
  for (const command of ["build", "start"]) {
    const result = spawnSync(process.execPath, ["--import", tsx, cli, command], { cwd: root, env: { ...process.env, NODE_OPTIONS: "", SIM_MODE: "" }, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 2); assert.equal(result.stderr.trim(), "F5");
    console.log(`PASS ${command}: F5 exit 2`);
  }

  // Installed Node/undici proof, not a mocked redirect: only allowed localhost
  // receives traffic. The redirect destination is rejected before DNS/dispatch.
  const probe = `
    import assert from 'node:assert/strict';
    import http, { request as namedRequest } from 'node:http';
    import https from 'node:https';
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits++;
      if (req.url === '/redirect') { res.writeHead(302, { location: 'https://refused.sim.invalid/private?token=synthetic' }); res.end(); }
      else if (req.url === '/replay') { res.writeHead(307, { location: '/echo' }); res.end(); }
      else { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => res.end(body || 'ok')); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3100, 'localhost', resolve); });
    try {
      await assert.rejects(fetch('http://localhost:3100/redirect'), { name: 'SimIsolationError' });
      assert.equal(hits, 1);
      assert.equal(await (await fetch('http://localhost:3100/replay', { method: 'POST', body: 'sim_payload' })).text(), 'sim_payload');
      assert.equal(hits, 3);
      for (const call of [() => http.request('http://refused.sim.invalid'), () => http.get('http://refused.sim.invalid'), () => https.request('https://refused.sim.invalid'), () => https.get('https://refused.sim.invalid'), () => namedRequest('http://refused.sim.invalid')]) assert.throws(call, { name: 'SimIsolationError' });
      await new Promise((resolve, reject) => http.get('http://localhost:3100/ok', res => { res.resume(); res.on('end', resolve); }).on('error', reject));
      assert.equal(hits, 4);
      console.log('PASS Node preload: fetch redirects/replay and HTTP/HTTPS request/get');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  `;
  const guard = pathToFileURL(resolve(root, "scripts/sim/launch-readiness/network.ts")).href;
  const result = spawnSync(process.execPath, ["--import", tsx, "--import", guard, "--input-type=module", "--eval", probe], {
    cwd: root, env: { ...process.env, ...good, NODE_OPTIONS: "", SIM_MODE: "1", SIM_PHASE: "runtime" }, encoding: "utf8", timeout: 30_000, shell: false,
  });
  assert.equal(result.status, 0, `Node preload probe failed: ${result.error ? "child launch failed" : "nonzero exit"}`);
  console.log(result.stdout.trim());
} finally {
  const inside = relative(resolve(tmpdir()), temp);
  assert.ok(inside && !inside.startsWith("..") && !isAbsolute(inside) && inside.startsWith("f1-isolation-"));
  rmSync(temp, { recursive: true, force: true });
}

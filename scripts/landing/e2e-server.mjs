import { portBase, pidFile } from './e2e-ports.cjs';
import { writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { prepareNearbyFixture } from './e2e-nearby-fixture.mjs';
const runtime = { ...process.env };
// Browser harness has no access to production service credentials or provider sends.
for (const key of Object.keys(runtime)) if (/SUPABASE|TOKEN|SECRET|PEPPER|META_|LANDING_|SITE_ORIGIN|STAFF_ORIGIN/.test(key)) delete runtime[key];
runtime.NEXT_TELEMETRY_DISABLED = '1';
runtime.AUTH_JWT_SECRET = 'aa'.repeat(32);
runtime.AUTH_PIN_PEPPER = 'landing-e2e-only';
runtime.AUTH_PASSWORD_PEPPER = 'landing-e2e-only';
const next = 'node_modules/next/dist/bin/next';
function run(args, env, cwd = process.cwd()) {
  const starting = args[0] === 'start';
  const child = spawn(process.execPath, [next, ...args], { cwd, stdio: starting ? ['ignore','pipe','inherit'] : 'inherit', env });
  if (starting) child.ready = new Promise(resolve => {
    let output = '';
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      output = (output + chunk.toString()).slice(-2048);
      if (output.includes('Ready in')) resolve();
    });
  });
  return child;
}
if (process.env.LANDING_E2E_USE_BUILD === '1') {
  if (!existsSync('.next/BUILD_ID')) throw new Error('Run npm run build first');
} else {
  const build = run(['build'], runtime);
  const code = await new Promise(resolve => build.on('exit', resolve));
  if (code !== 0) process.exit(code ?? 1);
}
const fixtureDir = await prepareNearbyFixture(runtime);
// Fictional public facts served through the real loader. No app test switch and no
// production credential: refuse every other table, projection and write.
const locations = createServer((req, res) => {
  if (req.url.startsWith('/unavailable/')) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({message:'Fictional shop loader outage'})); return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${portBase + 2}`);
  if (req.method !== 'GET' || url.pathname !== '/rest/v1/locations' || url.searchParams.get('select') !== 'code,name,address,phone' || url.searchParams.get('active') !== 'eq.true') {
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({code:'PGRST202',message:'Unsupported fixture request'})); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify([
    { code: 'MEP', name: 'Capitol Hill fixture shop', address: '100 Test Street SE', phone: '+12025550101' },
    { code: 'EM', name: 'Dupont fixture shop', address: '200 Example Street NW', phone: '+12025550102' },
  ]));
});
await new Promise((resolve, reject) => { locations.once('error', reject); locations.listen(portBase + 2, '127.0.0.1', resolve); });
runtime.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${portBase + 2}`;
runtime.SUPABASE_SERVICE_ROLE_KEY = 'landing-e2e-fictional-local-only';
const active = run(['start', '-p', `${portBase}`, '-H', '0.0.0.0'], { ...runtime, LANDING_HOSTS: 'localhost,eat.example.test,preview.example.test', SITE_ORIGIN: `https://localhost:${portBase}`, STAFF_ORIGIN: `https://127.0.0.1:${portBase}`, NEXT_PUBLIC_META_PIXEL_ID: '123456789', LANDING_CAPI_ENABLED: 'true', LANDING_COUNTER_ENABLED: 'true' });
const dormant = run(['start', '-p', `${portBase + 1}`, '-H', '0.0.0.0'], { ...runtime, SITE_ORIGIN: `https://localhost:${portBase + 1}`, STAFF_ORIGIN: `https://127.0.0.1:${portBase + 1}` });
const unavailable = run(['start', '-p', `${portBase + 3}`, '-H', '0.0.0.0'], { ...runtime, NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${portBase + 2}/unavailable`, LANDING_HOSTS:'localhost', SITE_ORIGIN:`https://localhost:${portBase + 3}`, STAFF_ORIGIN:`https://127.0.0.1:${portBase + 3}` });
const nearby = run(['start', '-p', `${portBase + 5}`, '-H', '0.0.0.0'], {...runtime, LANDING_HOSTS:'localhost', SITE_ORIGIN:`https://localhost:${portBase + 5}`, STAFF_ORIGIN:`https://127.0.0.1:${portBase + 5}`, NEXT_PUBLIC_META_PIXEL_ID:'123456789', LANDING_CAPI_ENABLED:'true'}, fixtureDir);
const children = [active,dormant,unavailable,nearby];
writeFileSync(pidFile, JSON.stringify(children.map(child=>child.pid)));
function stop(code) { for (const child of children) child.kill(); locations.close(); process.exit(code); }
for (const child of children) child.on('exit', code => stop(code ?? 1));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => stop(0));

// Readiness belongs to these processes, never to another runner's open URL.
await Promise.all(children.map(child=>child.ready));
console.log('LANDING_E2E_READY');

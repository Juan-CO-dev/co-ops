import { warmRoutes } from './e2e-readiness.mjs';
import { portBase, pidFile } from './e2e-ports.cjs';
import { existsSync } from 'node:fs';
import { writePidsAtomic } from './perf-housekeeping.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { prepareNearbyFixture } from './e2e-nearby-fixture.mjs';
const runtime = { ...process.env };
// Browser harness has no access to production service credentials or provider sends.
for (const key of Object.keys(runtime)) if (/SUPABASE|TOKEN|SECRET|PEPPER|META_|LANDING_|SITE_ORIGIN|STAFF_ORIGIN|VERCEL_ENV/.test(key)) delete runtime[key];
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
// Lighthouse measures the ordinary landing only. The separately compiled
// nearby/not-found fixture remains mandatory for the complete browser suite.
const fixtureDir = process.env.LANDING_PERF_CONSENT ? null : await prepareNearbyFixture(runtime);
// Fictional public facts served through the real loader. No app test switch and no
// production credential: refuse every other table, projection and write except
// the exact bounded counter RPC exercised by the production handler.
let capitolHillUnattributed = 0;
const locations = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/__fixture/counter') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({capitolHillUnattributed})); return;
  }
  if (req.method === 'POST' && req.url === '/rest/v1/rpc/increment_landing_order_click') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 512) { res.writeHead(413); res.end(); return; }
    }
    let input;
    try { input = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
    if (!input || Object.keys(input).length !== 2 || !['capitol-hill','dupont'].includes(input.p_store_key) || !['subsim-photo','unattributed'].includes(input.p_ad_code)) {
      res.writeHead(400); res.end(); return;
    }
    if (input.p_store_key === 'capitol-hill' && input.p_ad_code === 'unattributed') capitolHillUnattributed++;
    res.writeHead(204); res.end(); return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${portBase + 2}`);
  if (req.method === 'GET' && url.pathname === '/rest/v1/landing_ad_codes' && url.searchParams.get('select') === 'code' && url.searchParams.get('active') === 'eq.true' && url.searchParams.get('limit') === '1') {
    const candidate = url.searchParams.get('code');
    const code = ['subsim-photo','campaign-new','send-october'].find(value => candidate === `eq.${value}`);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(code ? {code} : null)); return;
  }
  if (req.method !== 'GET' || url.pathname !== '/rest/v1/locations' || url.searchParams.get('select') !== 'code,name,address,phone,active' || url.searchParams.get('active') !== 'eq.true') {
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({code:'PGRST202',message:'Unsupported fixture request'})); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify([
    { code: 'MEP', name: 'Capitol Hill fixture shop', address: '100 Test Street SE', phone: '+12025550101', active:true },
    { code: 'EM', name: 'Dupont fixture shop', address: '200 Example Street NW', phone: '+12025550102', active:true },
  ]));
});
await new Promise((resolve, reject) => { locations.once('error', reject); locations.listen(portBase + 2, '127.0.0.1', resolve); });
runtime.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${portBase + 2}`;
runtime.SUPABASE_SERVICE_ROLE_KEY = 'landing-e2e-fictional-local-only';
const active = run(['start', '-p', `${portBase}`, '-H', '0.0.0.0'], { ...runtime, VERCEL_ENV: 'production', LANDING_HOSTS: 'localhost,eat.example.test,preview.example.test', SITE_ORIGIN: `https://localhost:${portBase}`, STAFF_ORIGIN: `https://127.0.0.1:${portBase}`, NEXT_PUBLIC_META_PIXEL_ID: '123456789', LANDING_CAPI_ENABLED: 'true', LANDING_COUNTER_ENABLED: 'true' });
const dormant = run(['start', '-p', `${portBase + 1}`, '-H', '0.0.0.0'], { ...runtime, VERCEL_ENV: 'preview', SITE_ORIGIN: `https://localhost:${portBase + 1}`, STAFF_ORIGIN: `https://127.0.0.1:${portBase + 1}` });
// Nothing listens on +4: prove a genuine connection refusal, not an HTTP error stub.
const unavailable = run(['start', '-p', `${portBase + 3}`, '-H', '0.0.0.0'], { ...runtime, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${portBase + 4}`, LANDING_COUNTER_ENABLED:'true', LANDING_HOSTS:'localhost', SITE_ORIGIN:`https://localhost:${portBase + 3}`, STAFF_ORIGIN:`https://127.0.0.1:${portBase + 3}` });
const nearby = fixtureDir ? run(['start', '-p', `${portBase + 5}`, '-H', '0.0.0.0'], {...runtime, VERCEL_ENV: 'preview', LANDING_HOSTS:'localhost', SITE_ORIGIN:`https://localhost:${portBase + 5}`, STAFF_ORIGIN:`https://127.0.0.1:${portBase + 5}`, NEXT_PUBLIC_META_PIXEL_ID:'123456789', LANDING_CAPI_ENABLED:'true'}, fixtureDir) : null;
const children = [active,dormant,unavailable,...(nearby ? [nearby] : [])];
writePidsAtomic(pidFile, children.map(child=>child.pid));
function stop(code) { for (const child of children) child.kill(); locations.close(); process.exit(code); }
for (const child of children) child.on('exit', code => stop(code ?? 1));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => stop(0));

// Readiness belongs to these processes, never to another runner's open URL.
await Promise.all(children.map(child=>child.ready));
await warmRoutes([
 `http://localhost:${portBase}/?lang=en`,
 `http://localhost:${portBase}/?lang=es`,
 `http://localhost:${portBase}/privacy`,
 `http://127.0.0.1:${portBase}/`,
 `http://127.0.0.1:${portBase + 1}/`,
 `http://localhost:${portBase + 3}/`,
 ...(nearby ? [`http://localhost:${portBase + 5}/`] : []),
]);
console.log('LANDING_E2E_READY');

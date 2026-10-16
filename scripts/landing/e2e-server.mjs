import { writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
const runtime = { ...process.env };
// Browser harness has no access to production service credentials or provider sends.
for (const key of Object.keys(runtime)) if (/SUPABASE|TOKEN|SECRET|PEPPER|META_|LANDING_|SITE_ORIGIN|STAFF_ORIGIN/.test(key)) delete runtime[key];
runtime.NEXT_TELEMETRY_DISABLED = '1';
runtime.AUTH_JWT_SECRET = 'aa'.repeat(32);
runtime.AUTH_PIN_PEPPER = 'landing-e2e-only';
runtime.AUTH_PASSWORD_PEPPER = 'landing-e2e-only';
const next = 'node_modules/next/dist/bin/next';
function run(args, env) { return spawn(process.execPath, [next, ...args], { stdio: 'inherit', env }); }
if (process.env.LANDING_E2E_USE_BUILD === '1') {
  if (!existsSync('.next/BUILD_ID')) throw new Error('Run npm run build first');
} else {
  const build = run(['build'], runtime);
  const code = await new Promise(resolve => build.on('exit', resolve));
  if (code !== 0) process.exit(code ?? 1);
}
// Fictional public facts served through the real loader. No app test switch and no
// production credential: refuse every other table, projection and write.
const locations = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:44172');
  if (req.method !== 'GET' || url.pathname !== '/rest/v1/locations' || url.searchParams.get('select') !== 'code,name,address,phone' || url.searchParams.get('active') !== 'eq.true') {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify([
    { code: 'MEP', name: 'Capitol Hill fixture shop', address: '100 Test Street SE', phone: '+12025550101' },
    { code: 'EM', name: 'Dupont fixture shop', address: '200 Example Street NW', phone: '+12025550102' },
  ]));
});
await new Promise((resolve, reject) => { locations.once('error', reject); locations.listen(44172, '127.0.0.1', resolve); });
runtime.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:44172';
runtime.SUPABASE_SERVICE_ROLE_KEY = 'landing-e2e-fictional-local-only';
const active = run(['start', '-p', '44170', '-H', '0.0.0.0'], { ...runtime, LANDING_HOSTS: 'localhost,eat.example.test,preview.example.test', SITE_ORIGIN: 'https://localhost:44170', STAFF_ORIGIN: 'https://127.0.0.1:44170', NEXT_PUBLIC_META_PIXEL_ID: '123456789', LANDING_CAPI_ENABLED: 'true' });
const dormant = run(['start', '-p', '44171', '-H', '0.0.0.0'], { ...runtime, SITE_ORIGIN: 'https://localhost:44171', STAFF_ORIGIN: 'https://127.0.0.1:44171' });
writeFileSync('tmp-landing-server-pids.json', JSON.stringify([active.pid,dormant.pid]));
for (const child of [active, dormant]) child.on('exit', code => { active.kill(); dormant.kill(); process.exit(code ?? 1); });
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { active.kill(); dormant.kill(); process.exit(0); });

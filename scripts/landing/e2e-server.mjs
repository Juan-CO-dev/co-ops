import { writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
const active = run(['start', '-p', '43170', '-H', '0.0.0.0'], { ...runtime, LANDING_HOSTS: 'localhost,eat.example.test,preview.example.test', SITE_ORIGIN: 'https://localhost:43170', STAFF_ORIGIN: 'https://127.0.0.1:43170', NEXT_PUBLIC_META_PIXEL_ID: '123456789', LANDING_CAPI_ENABLED: 'true' });
const dormant = run(['start', '-p', '43171', '-H', '0.0.0.0'], { ...runtime, SITE_ORIGIN: 'https://localhost:43171', STAFF_ORIGIN: 'https://127.0.0.1:43171' });
writeFileSync('tmp-landing-server-pids.json', JSON.stringify([active.pid,dormant.pid]));
for (const child of [active, dormant]) child.on('exit', code => { active.kill(); dormant.kill(); process.exit(code ?? 1); });
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { active.kill(); dormant.kill(); process.exit(0); });

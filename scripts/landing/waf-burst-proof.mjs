import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const STAFF = 'https://co-ops-ashy.vercel.app';
const endpoints = ['events', 'order-click', 'ad-code'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function origin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* Never echo supplied arguments. */ }
  throw Error('origin_invalid');
}

/** Parse before any I/O. Local OFF values attest remote deployment checks; they cannot verify them. */
export function parseArgs(args, env = {}, now = Date.now()) {
  const values = {};
  const switches = new Set(['confirm-juan-ok', 'confirm-flags-off']);
  const names = new Set(['origin', 'staff-origin', 'rule-ids', 'runner-label', 'phase', 'runner-count', 'start-at']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || key in values) throw Error('arguments_invalid');
    if (switches.has(key)) values[key] = true;
    else if (names.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) values[key] = args[++i];
    else throw Error('arguments_invalid');
  }
  if (!values['confirm-juan-ok']) throw Error('juan_approval_required');
  if (!values['confirm-flags-off'] || env.LANDING_CAPI_ENABLED !== 'false' || env.LANDING_COUNTER_ENABLED !== 'false') throw Error('flags_off_required');
  const target = origin(values.origin);
  const staff = origin(values['staff-origin'] ?? STAFF);
  if (target === staff || target === STAFF || target === origin(env.STAFF_ORIGIN ?? STAFF)) throw Error('staff_origin_refused');
  if (!/^[a-zA-Z0-9_-]{1,80}(,[a-zA-Z0-9_-]{1,80}){0,9}$/.test(values['rule-ids'] ?? '')) throw Error('rule_ids_required');
  // Controlled labels only: never accept arbitrary free text into evidence.
  if (!/^runner-[a-z]{1,12}$/.test(values['runner-label'] ?? '')) throw Error('runner_label_required');
  if (!/^[a-g]$/.test(values.phase ?? '')) throw Error('phase_required');
  const runners = Number(values['runner-count'] ?? 1);
  if (!Number.isInteger(runners) || runners < 1 || runners > 64) throw Error('runner_count_invalid');
  const start = values['start-at'] ? Date.parse(values['start-at']) : now;
  if (!Number.isFinite(start) || start < now || start > now + 600_000) throw Error('start_invalid');
  if (['b', 'c'].includes(values.phase) && (runners < (values.phase === 'c' ? 25 : 2) || !values['start-at'])) throw Error('coordinated_runners_required');
  return { origin: target, staff, runner: values['runner-label'], phase: values.phase, runners, start };
}

/** Injected transport/clock lets unit tests exercise every phase with zero network. */
export async function runProof(config, { send = fetch, sleep = wait, now = Date.now } = {}) {
  const results = [];
  await sleep(Math.max(0, config.start - now()));
  for (const endpoint of config.phase === 'c' ? ['events'] : endpoints) {
    // Separate endpoints and phases must begin with clean per-IP windows.
    if (results.length || config.phase === 'g') await sleep(65_000);
    const startedAt = new Date(now()).toISOString();
    /** @type {Record<string, Record<string, number>>} */
    const statuses = {};
    const count = config.phase === 'c' ? 25 : ['a', 'b', 'd'].includes(config.phase) ? 120 : 1;
    const began = now();
    await Promise.all(Array.from({ length: count }, async (_, index) => {
      await sleep(Math.max(0, began + index * 10_000 / count - now()));
      const host = config.phase === 'f' ? config.staff : config.origin;
      const headers = { 'content-type': 'application/json', origin: host, cookie: 'landing_consent=accepted' };
      // The first 90 consume the bucket; rotating spoofed addresses must not reopen it.
      if (config.phase === 'd' && index >= 90) headers[['x-forwarded-for', 'x-real-ip', 'true-client-ip'][index % 3]] = `192.0.2.${index + 1}`;
      const body = endpoint === 'events'
        ? { event_name: 'Lead', event_id: randomUUID(), event_time: Math.floor(now() / 1000), consent: 'accepted', source_url: `${host}/`, ad: 'unattributed', placement: 'hero' }
        : endpoint === 'order-click' ? { store: 'dupont', ad: 'unattributed' } : { candidate: 'unattributed' };
      let status = 'network_error';
      try {
        const response = await send(`${host}/api/landing/${endpoint}`, {
          method: config.phase === 'e' ? 'GET' : 'POST', headers,
          ...(config.phase === 'e' ? {} : { body: JSON.stringify(body) }),
          redirect: 'error', signal: AbortSignal.timeout(10_000),
        });
        status = String(response.status);
        await response.body?.cancel().catch(() => {});
      } catch { /* Error text can contain credentials, headers or URLs. Never retain it. */ }
      const segment = config.phase === 'd' && index >= 90 ? 'spoof' : 'ordinary';
      statuses[segment] ??= {};
      statuses[segment][status] = (statuses[segment][status] ?? 0) + 1;
    }));
    results.push({ endpoint, count, statuses, startedAt, endedAt: new Date(now()).toISOString() });
  }
  // No pass claim: cross-runner overlap and aggregate entitlement need CC review.
  return { runner: config.runner, phase: config.phase, runnerCount: config.runners, results };
}

export async function main(args, env = process.env) {
  const config = parseArgs(args, env);
  const evidence = await runProof(config);
  const directory = 'tmp/landing-waf-proof';
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  await writeFile(`${directory}/${timestamp}.json`, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => { console.error('waf_proof_refused_or_failed'); process.exitCode = 1; });
}

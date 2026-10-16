import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { landingTenantConfig } from '../config/tenant/landing.ts';

export const digest = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function destinations(origin, staffOrigin, portalLive = landingTenantConfig.cateringPortalLive) {
  return [
    { name: 'landing', url: new URL('/', origin).href },
    ...landingTenantConfig.stores.map(s => ({ name: `order-${s.key}`, url: s.orderUrl, branchId: s.branchId })),
    { name: 'catering', url: portalLive ? new URL('/order', staffOrigin).href : landingTenantConfig.cateringUrl },
    { name: 'inquiry', url: landingTenantConfig.inquiryUrl },
  ];
}

// Only merchant-reviewed, non-personal fields may enter this digest. No payload
// or individual field values are emitted. Schema is deliberately not guessed.
export function branchDigest(payload, schema, expected) {
  if (!Array.isArray(schema.arrayPath) || !Array.isArray(schema.fields) || !schema.fields.includes(schema.idField)) throw Error('branch-schema');
  let rows = payload;
  for (const key of schema.arrayPath) rows = rows?.[key];
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000 || !rows.some(row => row?.[schema.idField] === expected)) throw Error('missing-branch');
  const normalized = rows.map(row => Object.fromEntries([...schema.fields].sort().map(key => {
    if (!Object.hasOwn(row, key) || !['string', 'number', 'boolean'].includes(typeof row[key])) throw Error('branch-schema');
    return [key, row[key]];
  }))).map(row => JSON.stringify(row)).sort();
  return digest(JSON.stringify(normalized));
}

async function request(url, hosts, fetcher) {
  // One deadline covers redirects AND streaming the body. Enforce limits before
  // following a redirect; no cookies, auth headers or request bodies are sent.
  const signal = AbortSignal.timeout(15000);
  for (let hop = 0; hop <= 4; hop++) {
    const current = new URL(url);
    if (current.protocol !== 'https:' || current.username || current.password || !hosts.includes(current.hostname)) throw Error('host-drift');
    const response = await fetcher(current.href, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (hop === 4 || !response.headers.get('location')) throw Error('redirect-limit');
      url = new URL(response.headers.get('location'), current).href;
      continue;
    }
    const chunks = []; let bytes = 0;
    if (response.body) for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2_000_000) throw Error('response-too-large');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    return { status: response.status, finalHost: current.hostname, sha256: digest(body), redirects: hop, body };
  }
  throw Error('redirect-limit');
}

export async function probe(target, baseline, fetcher = fetch) {
  const result = { name: target.name, ok: false, status: null, finalHost: null, sha256: null };
  if (!baseline || !hashPattern.test(baseline.sha256) || !Array.isArray(baseline.hosts) || !baseline.hosts.length) return { ...result, reason: 'baseline-required' };
  try {
    let page;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        page = await request(target.url, baseline.hosts, fetcher);
        if (attempt === 0 && (page.status === 429 || (page.status >= 500 && target.name !== 'landing'))) continue;
        break;
      } catch (error) { if (attempt) throw error; }
    }
    Object.assign(result, { status: page.status, finalHost: page.finalHost, sha256: page.sha256, redirects: page.redirects });
    if (page.redirects) return { ...result, reason: 'redirect-review' };
    if (page.status !== 200) return { ...result, reason: 'http-status' };
    if (/captcha|access denied|verify you are human|cf-chl/i.test(page.body)) return { ...result, reason: 'challenge' };
    if (page.sha256 !== baseline.sha256) return { ...result, reason: 'response-drift' };
    if (target.branchId) {
      const data = baseline.data;
      if (!data?.url || !hashPattern.test(data.sha256) || !hashPattern.test(data.branchSha256) || !Array.isArray(data.hosts)) return { ...result, reason: 'merchant-baseline-required' };
      const payload = await request(data.url, data.hosts, fetcher);
      result.dataStatus = payload.status;
      result.dataFinalHost = payload.finalHost;
      result.dataSha256 = payload.sha256;
      result.dataRedirects = payload.redirects;
      if (payload.redirects) return { ...result, reason: 'merchant-redirect-review' };
      if (payload.status !== 200) return { ...result, reason: 'merchant-http-status' };
      const normalized = branchDigest(JSON.parse(payload.body), data, target.branchId);
      result.branchSha256 = normalized;
      if (normalized !== data.branchSha256 || payload.sha256 !== data.sha256) return { ...result, reason: 'branch-drift' };
    }
    return { ...result, ok: true, reason: 'ok' };
  } catch {
    // Never serialize an exception: fetch errors can embed URL/query/payload.
    return { ...result, reason: 'unavailable-or-invalid-payload' };
  }
}

export async function monitor(targets, baselines, options = {}) {
  const run = options.probe ?? probe, now = options.now ?? Date.now, wait = options.sleep ?? sleep;
  const started = now();
  const results = await Promise.all(targets.map(t => run(t, baselines[t.name])));
  const report = { startedAt: new Date(started).toISOString(), results, incident: [], ok: results.every(r => r.ok), pauseRequired: results.some(r => r.name.startsWith('order-') && !r.ok), recoveredAt: null };
  const landing = results.find(r => r.name === 'landing');
  if (landing?.status >= 500) {
    report.firstFailureAt = new Date(now()).toISOString();
    const firstFailure = now();
    for (let i = 0; i < 11; i++) {
      // Anchor to the first failure so fetch latency does not turn a one-minute
      // incident cadence into 60 seconds plus each request's duration.
      await wait(Math.max(0, firstFailure + (i + 1) * 60000 - now()));
      const next = await run(targets.find(t => t.name === 'landing'), baselines.landing);
      report.incident.push({ at: new Date(now()).toISOString(), ...next });
      if (next.ok) { report.recoveredAt = new Date(now()).toISOString(); break; }
      if (now() - firstFailure > 600000) report.pauseRequired = true;
    }
  }
  report.finishedAt = new Date(now()).toISOString();
  return report;
}

async function main() {
  let report;
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (!config.reviewedBy || !config.reviewedAt) throw Error('review-required');
    report = await monitor(destinations(config.landingOrigin, config.staffOrigin), config.probes);
  } catch { report = { ok: false, reason: 'reviewed-config-required' }; }
  await writeFile('money-path-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

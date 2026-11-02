import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { parseArgs, runProof } from '../../scripts/landing/waf-burst-proof.mjs';

const off = { LANDING_CAPI_ENABLED: 'false', LANDING_COUNTER_ENABLED: 'false' };
const instant = Date.UTC(2026, 10, 1);
const args = ['--origin', 'https://landing.example', '--rule-ids', 'ip,aggregate', '--runner-label', 'runner-alpha', '--confirm-juan-ok', '--confirm-flags-off', '--phase', 'a'];
describe('WAF proof offline safety', () => {
  it.each(['origin', 'rule-ids', 'runner-label', 'confirm-juan-ok', 'confirm-flags-off', 'phase'])('refuses missing %s before transport', key => {
    const input = [...args]; const index = input.indexOf(`--${key}`);
    input.splice(index, key.startsWith('confirm-') ? 1 : 2);
    expect(() => parseArgs(input, off, instant)).toThrow();
  });
  it.each(['http://landing.example', 'https://landing.example/path', 'https://landing.example/?x=y', 'https://user@landing.example', 'https://co-ops-ashy.vercel.app', 'https://staff.example'])('refuses unsafe or staff origin %s', target => {
    const input = [...args]; input[1] = target;
    expect(() => parseArgs(input, { ...off, STAFF_ORIGIN: 'https://staff.example' }, instant)).toThrow();
  });
  it('refuses custom staff origin, duplicates, arbitrary labels and non-OFF flags', () => {
    expect(() => parseArgs([...args, '--staff-origin', 'https://landing.example'], off, instant)).toThrow();
    expect(() => parseArgs([...args, '--origin', 'https://other.example'], off, instant)).toThrow();
    const input = [...args]; input[5] = randomBytes(32).toString('hex');
    expect(() => parseArgs(input, off, instant)).toThrow();
    for (const env of [{}, { ...off, LANDING_CAPI_ENABLED: 'true' }, { ...off, LANDING_COUNTER_ENABLED: 'true' }]) expect(() => parseArgs(args, env, instant)).toThrow();
  });
  it.each(['b', 'c'])('requires coordinated independent runners for %s', phase => {
    const input = [...args]; input[input.length - 1] = phase;
    expect(() => parseArgs(input, off, instant)).toThrow();
    expect(() => parseArgs([...input, '--runner-count', phase === 'c' ? '25' : '2', '--start-at', new Date(instant + 1000).toISOString()], off, instant)).not.toThrow();
  });
  it.each(['a', 'b', 'c', 'd', 'e', 'f', 'g'])('executes phase %s with injected transport only and bounded evidence', async phase => {
    const noise = randomBytes(32).toString('hex');
    const send = vi.fn(async () => new Response(noise, { status: phase === 'f' ? 404 : phase === 'e' ? 405 : 429, headers: { 'x-private': noise } }));
    const sleep = vi.fn(async () => {});
    const config = { ...parseArgs(args, off, instant), phase, runners: phase === 'c' ? 25 : phase === 'b' ? 2 : 1 };
    const proof = await runProof(config, { send, sleep, now: () => instant });
    expect(Object.keys(proof).sort()).toEqual(['phase', 'results', 'runner', 'runnerCount']);
    expect(proof.results).toHaveLength(phase === 'c' ? 1 : 3);
    for (const row of proof.results) {
      expect(Object.keys(row).sort()).toEqual(['count', 'endedAt', 'endpoint', 'startedAt', 'statuses']);
      expect(row.startedAt).toBe(new Date(instant).toISOString());
      expect(Object.values(row.statuses).flatMap(value => Object.values(value)).reduce((a, b) => Number(a) + Number(b), 0)).toBe(row.count);
    }
    const calls = send.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(phase === 'c' ? 25 : ['a', 'b', 'd'].includes(phase) ? 360 : 3);
    for (const [url, init] of calls) {
      expect(new URL(url).origin).toBe(phase === 'f' ? config.staff : config.origin);
      expect(init.redirect).toBe('error');
      expect(init.method).toBe(phase === 'e' ? 'GET' : 'POST');
      if (phase === 'e') expect(init.body).toBeUndefined();
      else if (url.endsWith('/ad-code')) expect(JSON.parse(String(init.body))).toEqual({ candidate: 'unattributed' });
    }
    if (phase === 'd') expect(proof.results[0]?.statuses.spoof).toEqual({ '429': 30 });
    if (phase === 'g') expect(sleep).toHaveBeenCalledWith(65_000);
    const serialized = JSON.stringify(proof);
    for (const forbidden of [noise, 'https://', '192.0.2.', 'cookie', 'headers', 'body', 'token', 'rule-ids']) expect(serialized).not.toContain(forbidden);
  });
  it('drops network exception text', async () => {
    const noise = randomBytes(32).toString('hex');
    const proof = await runProof({ ...parseArgs(args, off, instant), phase: 'g' }, { send: async () => { throw Error(noise); }, sleep: async () => {}, now: () => instant });
    expect(proof.results[0]?.statuses.ordinary).toEqual({ network_error: 1 });
    expect(JSON.stringify(proof)).not.toContain(noise);
  });
});

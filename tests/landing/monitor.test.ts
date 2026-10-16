import { describe, expect, it } from 'vitest';
import { digest, branchDigest, probe, monitor, destinations } from '../../scripts/probe-money-path.mjs';

const ok = '<html>order</html>';
const rule = { hosts: ['example.com'], sha256: '' };
const target = { name: 'landing', url: 'https://example.com' };
const response = (body = ok, status = 200) => new Response(body, { status });
describe('launch monitor', () => {
  it('requires reviewed baselines and rejects a successful shell without branch data', async () => {
    expect((await probe(target, rule, async () => response())).ok).toBe(false);
    expect(() => branchDigest({}, { arrayPath: ['branches'], idField: 'id', fields: ['id'] }, 'expected')).toThrow();
    expect(() => branchDigest({ branches: [{ id: 'wrong' }] }, { arrayPath: ['branches'], idField: 'id', fields: ['id'] }, 'expected')).toThrow();
  });
  it('normalizes branch record order and selected field order', () => {
    const schema = { arrayPath: ['branches'], idField: 'id', fields: ['id', 'name'] };
    expect(branchDigest({ branches: [{ id: 'a', name: 'A' }, { name: 'B', id: 'b' }] }, schema, 'a')).toBe(branchDigest({ branches: [{ id: 'b', name: 'B' }, { name: 'A', id: 'a' }] }, schema, 'a'));
  });
  it('requires both branch existence and reviewed payload digests on an order probe', async () => {
    const body = JSON.stringify({ branches: [{ id: 'expected', name: 'Shop' }] });
    const schema = { arrayPath: ['branches'], idField: 'id', fields: ['id', 'name'] };
    const baseline = { ...rule, sha256: digest(ok), data: { ...schema, url: 'https://example.com/data', hosts: ['example.com'], sha256: digest(body), branchSha256: branchDigest(JSON.parse(body), schema, 'expected') } };
    const order = { ...target, name: 'order-a', branchId: 'expected' };
    const fetcher: typeof fetch = async input => response(String(input).endsWith('/data') ? body : ok);
    expect((await probe(order, baseline, fetcher)).ok).toBe(true);
    expect((await probe({ ...order, branchId: 'absent' }, baseline, fetcher)).ok).toBe(false);
    expect((await probe(order, { ...baseline, data: { ...baseline.data, branchSha256: '0'.repeat(64) } }, fetcher)).ok).toBe(false);
  });
  it('bounds transient retries and records safe diagnostics only', async () => {
    let calls = 0;
    const result = await probe(target, { ...rule, sha256: digest(ok) }, async () => { calls++; return response('private body', 429); });
    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: 429, finalHost: 'example.com', reason: 'http-status' });
    expect(JSON.stringify(result)).not.toContain('private body');
  });
  it('requires review even when a redirect preserves host and response bytes', async () => {
    let calls = 0;
    const result = await probe(target, { ...rule, sha256: digest(ok) }, async () => ++calls === 1
      ? new Response('', { status: 302, headers: { location: '/moved' } }) : response());
    expect(result).toMatchObject({ ok: false, reason: 'redirect-review', redirects: 1 });
  });
  it.each([403, 429, 500])('refuses status %s', async status => {
    expect((await probe(target, { ...rule, sha256: digest(ok) }, async () => response(ok, status))).ok).toBe(false);
  });
  it('refuses timeouts, challenges, redirect host drift and digest drift', async () => {
    for (const fetcher of [async () => { throw new Error('private URL'); }, async () => response('verify you are human'), async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }), async () => response('changed')]) {
      const result = await probe(target, { ...rule, sha256: digest(ok) }, fetcher);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('private URL');
    }
  });
  it('resolves exactly five destinations and follows the active catering flag', () => {
    const active = destinations('https://landing.example', 'https://staff.example', true);
    expect(active).toHaveLength(5);
    expect(active.find((x: { name: string }) => x.name === 'catering')?.url).toBe('https://staff.example/order');
  });
  it('runs all destinations independently and signals broken orders', async () => {
    const targets = ['landing', 'order-a', 'order-b', 'catering', 'inquiry'].map(name => ({ ...target, name }));
    const report = await monitor(targets, {}, { probe: async (t: { name: string }) => ({ name: t.name, ok: t.name !== 'order-a', status: 200 }) });
    expect(report.results).toHaveLength(5);
    expect(report.pauseRequired).toBe(true);
  });
  it('rechecks landing 5xx beyond ten minutes and records recovery separately', async () => {
    let time = 0;
    const options = { now: () => time, sleep: async (ms: number) => { time += ms; }, probe: async () => ({ name: 'landing', ok: false, status: 503 }) };
    const failed = await monitor([target], {}, options);
    expect(failed.incident).toHaveLength(11);
    expect(failed.pauseRequired).toBe(true);
    time = 0;
    let count = 0;
    const recovered = await monitor([target], {}, { ...options, probe: async () => ({ name: 'landing', ok: count++ > 0, status: count > 1 ? 200 : 503 }) });
    expect(recovered.recoveredAt).toBeTruthy();
    expect(recovered.ok).toBe(false); // transient incident still delivers an alert
  });
});
it('preserves the first landing 5xx to trigger minute incident rechecks', async () => {
 let calls=0;
 const result=await probe(target,{...rule,sha256:digest(ok)},async()=>{calls++;return calls===1?response('unavailable',503):response();});
 expect(result.status).toBe(503);
 expect(calls).toBe(1);
});

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createManagementClient, collide, SIM_REF, joined } from '../scripts/catalog-jobs/management-api.mjs';

describe('catalog SIM Management API transport', () => {
  it.each(['bgcvurheqzylyfehqgzh', 'other', ''])('refuses %s before token or transport', ref => {
    const token = vi.fn(), fetch = vi.fn();
    expect(() => createManagementClient({ ref, token, fetch, assertLease: () => {}, verifiedServer: true })).toThrow('SIM only');
    expect(token).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('requires the leased and verified F4 entry point before reading secrets', () => {
    const token = vi.fn();
    expect(() => createManagementClient({ ref: SIM_REF, token, assertLease: () => {}, verifiedServer: false })).toThrow('F4');
    expect(token).not.toHaveBeenCalled();
  });
  it('uses a POST per transaction and never returns raw SQL error text', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ value: 1 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('private SQL details swap:dependencies_busy private@example.invalid', { status: 400 }));
    const lease = vi.fn();
    const q = createManagementClient({ ref: SIM_REF, token: () => 'test-token', fetch, assertLease: lease, verifiedServer: true });
    expect((await q('begin; select 1; rollback;')).rows).toEqual([{ value: 1 }]);
    const failed = await q('select broken');
    expect(failed.code).toBe('swap:dependencies_busy');
    expect(JSON.stringify(failed)).not.toMatch(/private|test-token/);
    expect(fetch.mock.calls[0]![0]).toBe(`https://api.supabase.com/v1/projects/${SIM_REF}/database/query`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify({ query: 'begin; select 1; rollback;' }) });
    expect(lease.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it('starts the racer after 2 seconds and checks its unique blocked backend', async () => {
    const queries: string[] = [], delays: number[] = [];
    const q = vi.fn(async (sql: string) => { queries.push(sql); return { ok: true, rows: sql.includes('pg_locks') ? [{ locktype: 'advisory' }] : [], ms: 5000 }; });
    const result = await collide(q, 'select holder_write()', 'select racer_write()', { sleep: async (ms: number) => { delays.push(ms); }, nonce: 'unit-race' });
    expect(delays[0]).toBe(2000);
    expect(queries[0]).toMatch(/begin;[\s\S]*holder_write[\s\S]*pg_sleep\(7\)[\s\S]*commit;/);
    expect(queries[1]).toContain('catalog-racer-unit-race');
    expect(queries[2]).toMatch(/not l.granted/);
    expect(queries[2]).toContain('catalog-racer-unit-race');
    expect(result.waits).toEqual(['advisory']);
  });
  it('registers catalog under the actual F4 fixture, server and report lifecycle', () => {
    const runner = readFileSync('scripts/sim/launch-readiness/run.ts', 'utf8');
    expect(runner).toContain('"catalog"');
    expect(runner).toContain('runCatalogContracts');
    expect(runner).toContain('catalogReport.fails.length === 0');
    expect(runner).toContain('SIM_CATALOG_PASSWORD');
    const suite = readFileSync('scripts/sim/catalog/catalog.ts', 'utf8');
    expect(suite).toContain('new driver.Session');
    expect(suite).toContain('catalogWindow: true');
    expect(suite).toContain('runCatalogApiEvidence');
    expect(suite).toContain('assertClean();');
    expect(suite).toContain('markCatalogDirty(prefix)');
    const catalogBranch = runner.slice(runner.indexOf('} else if (options.suite === "catalog")'), runner.indexOf('} else if (["opening", "ordering", "customer"].includes(options.suite))'));
    expect(catalogBranch).toContain('await startServer()');
    expect(catalogBranch).not.toContain('await restore(');
    expect(catalogBranch).toContain('restore: "not-required"');
    expect(runner).toContain('delete childEnv.SIM_CATALOG_PASSWORD');
  });
  it('only admits isolated catalog fixtures in production mode', async () => {
    const { parseArgs } = await import('../scripts/sim/launch-readiness/run');
    expect(parseArgs(['--suite', 'catalog', '--fixture', 'catalog-isolated']).suite).toBe('catalog');
    for (const args of [ ['--suite', 'catalog'], ['--suite', 'catalog', '--fixture', 'catalog-isolated', '--dev'], ['--suite', 'runner', '--fixture', 'catalog-isolated'], ['--restore-only', 'catalog-isolated'] ]) expect(() => parseArgs(args)).toThrow('usage');
  });
  it('joins a successful sibling before propagating a failed concurrent request', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let ended = false;
    const result = joined([Promise.reject(new Error('private')), pending]).catch(error => { ended = true; return error; });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(ended).toBe(false);
    release(); expect(await result).toMatchObject({ message: 'Concurrent request failed' });
  });
  it('joins holder and racer even when lock observation fails', async () => {
    let finishHolder!: (value: object) => void, finishRacer!: (value: object) => void;
    const holder = new Promise(resolve => { finishHolder = resolve; });
    const racer = new Promise(resolve => { finishRacer = resolve; });
    const q = vi.fn().mockReturnValueOnce(holder).mockReturnValueOnce(racer).mockResolvedValue({ ok: false, rows: [] });
    let ended = false;
    const result = collide(q, 'holder', 'racer', { sleep: async () => {}, nonce: 'join' }).catch(error => { ended = true; return error; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ended).toBe(false);
    finishHolder({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ended).toBe(false);
    finishRacer({ ok: true });
    expect(await result).toMatchObject({ message: 'Lock observation unavailable' });
  });
});

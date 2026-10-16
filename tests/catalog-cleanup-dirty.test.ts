import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ marker: undefined as string | undefined, writeFails: false, q: vi.fn(), inner: vi.fn(), calls: [] as string[] }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const isMarker = (path: unknown) => String(path).endsWith('DIRTY');
  return { ...actual,
    existsSync: (path: unknown) => isMarker(path) ? state.marker !== undefined : actual.existsSync(path as string),
    mkdirSync: vi.fn(),
    writeFileSync: (path: unknown, bytes: string) => { if (!isMarker(path)) throw Error('unexpected write'); state.calls.push('marker'); if (state.writeFails) throw Error('disk'); state.marker = bytes; },
    readFileSync: (path: unknown, encoding: unknown) => isMarker(path) ? state.marker : actual.readFileSync(path as string, encoding as BufferEncoding),
  };
});
vi.mock('../scripts/catalog-jobs/management-api.mjs', async importOriginal => ({
  ...await importOriginal<object>(), createManagementClient: () => state.q,
}));
vi.mock('../scripts/catalog-jobs/concurrency.mjs', async importOriginal => ({
  ...await importOriginal<object>(), runCatalogApiEvidence: (...args: unknown[]) => state.inner(...args),
}));
vi.mock('../scripts/sim/concurrency/driver.mjs', () => ({
  LOC: { EM: 'shop' }, findUser: async () => ({ id: 'actor' }),
  Session: class { async login() { return this; } async call(_method: string, path: string) { return path.includes('step-up') ? { status: 200 } : { status: 201, json: { skuId: 'sku' } }; } },
  makeReport: () => { const rows: { name: string; pass: boolean }[] = []; return { check: (name: string, pass: boolean) => rows.push({ name, pass }), done: () => ({ rows, fails: rows.filter(r => !r.pass) }) }; },
}));
import { runCatalogContracts } from '../scripts/sim/catalog/catalog';
import { assertClean, resetFixture } from '../scripts/sim/launch-readiness/reset';
vi.mock('../scripts/sim/launch-readiness/lease.mjs', () => ({ assertHeld: () => ({ pid: process.pid }) }));
const options = { assertLease: vi.fn(), verifiedServer: true, pin: '1234', password: 'mock' };
beforeEach(() => { state.marker = undefined; state.writeFails = false; state.calls = []; state.q.mockReset(); state.inner.mockReset().mockResolvedValue(undefined); options.assertLease.mockClear(); });
const ok = (rows: object[] = []) => ({ ok: true, rows });
function outerQuery(mode: string) {
  state.q.mockImplementation(async (sql: string) => {
    if (sql.startsWith('update')) { state.calls.push('retire'); if (mode === 'throw') throw Error('transport'); return mode === 'returned' ? { ok: false, rows: [] } : ok(); }
    if (sql.includes('count(*)') && sql.includes('active')) { if (mode === 'verify-throw') throw Error('verification'); return mode === 'verify-returned' ? { ok: false, rows: [] } : ok([{ n: mode === 'verify-live' ? 1 : 0 }]); }
    return ok([{ id: 'vendor', n: 1 }]);
  });
}
describe('catalog cleanup DIRTY boundary (no DB)', () => {
  it.each(['returned', 'throw', 'verify-live', 'verify-throw', 'verify-returned'])('outer %s failure persists DIRTY and fails report', async mode => {
    outerQuery(mode);
    const report = await runCatalogContracts(options);
    expect(report.fails.some(r => r.name.includes('fixture'))).toBe(true);
    expect(state.marker).toBeDefined(); expect(() => assertClean()).toThrow('DIRTY');
    expect(state.calls.indexOf('marker')).toBeGreaterThan(state.calls.indexOf('retire'));
  });
  it('verified outer cleanup stays clean', async () => { outerQuery('ok'); await runCatalogContracts(options); expect(state.marker).toBeUndefined(); expect(state.q.mock.calls.some(([sql]) => sql.includes('count(*)') && sql.includes('where active'))).toBe(true); });
  it('pre-existing DIRTY refuses invocation before client or session activity', async () => {
    state.marker = 'prior'; outerQuery('ok'); await expect(runCatalogContracts(options)).rejects.toThrow('DIRTY'); expect(state.q).not.toHaveBeenCalled(); expect(state.marker).toBe('prior');
  });
  it('marker-write failure cannot become a passing report', async () => {
    outerQuery('returned'); state.writeFails = true;
    await expect(runCatalogContracts(options)).rejects.toThrow('DIRTY');
  });
  it.each(['returned', 'throw', 'verify-live', 'verify-throw', 'verify-returned', 'live-read', 'end-returned', 'end-throw', 'pending-after-end'])('inner %s failure persists DIRTY', async mode => {
    const { runCatalogApiEvidence } = await vi.importActual<typeof import('../scripts/catalog-jobs/concurrency.mjs')>('../scripts/catalog-jobs/concurrency.mjs');
    const q = vi.fn(async (sql: string) => {
      if (sql.includes('catalog_rollback_marker')) throw Error('skip scenarios');
      if (sql.startsWith('select s.id')) return mode === 'live-read' ? { ok: false, rows: [] } : ok((mode.startsWith('end-') || mode === 'pending-after-end') ? [{ id: 'swap' }] : []);
      if (sql.startsWith('select end_sku_swap')) { if (mode === 'end-throw') throw Error('end'); return mode === 'pending-after-end' ? ok() : { ok: false, rows: [] }; }
      if (sql.startsWith('begin;')) { if (mode === 'throw') throw Error('retirement'); return mode === 'returned' ? { ok: false, rows: [] } : ok(); }
      if (mode === 'verify-throw') throw Error('verification');
      return mode === 'verify-returned' ? { ok: false, rows: [] } : ok([{ n: mode === 'verify-live' ? 1 : 0, pending: mode === 'pending-after-end' ? 1 : 0 }]);
    });
    await expect(runCatalogApiEvidence({ q, actor: 'actor', shop: 'shop', check: vi.fn(), primaryRequest: vi.fn() })).rejects.toThrow();
    expect(state.marker).toBeDefined(); expect(() => assertClean()).toThrow('DIRTY');
  });
  it('verified inner cleanup preserves history and never clears prior quarantine', async () => {
    const { runCatalogApiEvidence } = await vi.importActual<typeof import('../scripts/catalog-jobs/concurrency.mjs')>('../scripts/catalog-jobs/concurrency.mjs');
    const q = vi.fn(async (sql: string) => {
      if (sql.includes('catalog_rollback_marker')) throw Error('scenario failed');
      return ok(sql.startsWith('select s.id') ? [] : [{ n: 0, pending: 0 }]);
    });
    for (const marker of [undefined, 'prior']) {
      state.marker = marker;
      await expect(runCatalogApiEvidence({ q, actor: 'actor', shop: 'shop', check: vi.fn(), primaryRequest: vi.fn() })).rejects.toThrow('scenario failed');
      expect(state.marker).toBe(marker);
    }
    expect(q.mock.calls.some(([sql]) => /delete\s+from/i.test(sql))).toBe(false);
    expect(q.mock.calls.filter(([sql]) => sql.startsWith('begin;')).every(([sql]) => sql.includes('F4-catalog-'))).toBe(true);
  });
  it('marker preserves previous failure evidence and records no raw exception', async () => {
    const { markCatalogDirty } = await import('../scripts/catalog-jobs/cleanup.mjs');
    state.marker = 'prior'; markCatalogDirty('next'); expect(state.marker).toBe('prior');
    state.marker = undefined; markCatalogDirty('F4-catalog-test');
    expect(JSON.parse(state.marker!)).toMatchObject({ prefix: 'F4-catalog-test', status: 'catalog-cleanup-failed' });
  });
  it('inner failure remains in the outer report after successful outer retirement', async () => {
    outerQuery('ok'); state.inner.mockImplementation(async () => { state.marker = 'inner failure'; throw Error('cleanup'); });
    const report = await runCatalogContracts(options); expect(report.fails.some(r => r.name === 'catalog.scenarios-completed')).toBe(true); expect(state.marker).toBe('inner failure');
  });
  it('reset refuses catalog quarantine before overwriting evidence or touching the target', async () => {
    state.marker = JSON.stringify({ status: 'catalog-cleanup-failed', prefix: 'F4-catalog-evidence' });
    const prior = state.marker;
    await expect(resetFixture({ runId: 'reset', fixtureId: 'cold-empty', env: {}, schemaDigest: '' }))
      .rejects.toThrow('CC-owned catalog clearance');
    expect(state.marker).toBe(prior);
    expect(state.calls).toEqual([]);
    expect(() => assertClean()).toThrow('swap-journal');
  });
});

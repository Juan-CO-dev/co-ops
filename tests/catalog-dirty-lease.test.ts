import { beforeEach, expect, it, vi } from 'vitest';
const fs = vi.hoisted(() => ({ files: new Map<string, string>(), removed: false }));
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => { if (!fs.files.has(path)) throw Error('missing'); return fs.files.get(path); },
  renameSync: (from: string, to: string) => { if (!fs.files.has(from)) throw Error('missing'); fs.files.set(to, fs.files.get(from)!); fs.files.delete(from); },
  mkdirSync: (path: string) => { if (path.endsWith('mock-lease')) throw Object.assign(Error('exists'), { code: 'EEXIST' }); },
  writeFileSync: vi.fn(), unlinkSync: vi.fn(), rmSync: () => { fs.removed = true; },
}));
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import * as lease from '../scripts/sim/launch-readiness/lease.mjs';
import { readFileSync } from 'node:fs';
const dir = resolve('mock-lease');
beforeEach(() => { fs.files.clear(); fs.removed = false; fs.files.set(join(dir, 'owner.json'), JSON.stringify({ runId: 'run', pid: process.pid, startedAt: new Date().toISOString(), host: hostname() })); });
it('quarantines the lease on marker persistence failure and refuses stale reclaim', () => {
  lease.quarantine('run', { dir });
  expect(fs.removed).toBe(false);
  expect(() => lease.acquire({ runId: 'next', dir })).toThrow('Lease refused');
  expect(fs.removed).toBe(false);
  expect(JSON.parse(readFileSync(join(dir, 'quarantined-owner.json'), 'utf8'))).toMatchObject({ runId: 'run' });
});
it('refuses to quarantine a different lease owner', () => {
  expect(() => lease.quarantine('other', { dir })).toThrow('Lease refused');
  expect(fs.files.has(join(dir, 'owner.json'))).toBe(true);
});

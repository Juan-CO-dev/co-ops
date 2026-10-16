import { afterEach, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { LANDING_ASSETS } from '@/lib/landing/host-shared';
import approved from '@/assets/approved-media.json';
import sources from '@/assets/source-manifest.json';
vi.mock('@/lib/auth', () => ({ verifyJwt: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());
function request(path: string, landing = true) {
  vi.stubEnv('LANDING_HOSTS', 'eat.example.test');
  vi.stubEnv('SITE_ORIGIN', 'https://eat.example.test');
  vi.stubEnv('STAFF_ORIGIN', 'https://staff.example.test');
  const host = landing ? 'eat.example.test' : 'staff.example.test';
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}
it('routes exactly the approved inventory, with content hashes on every media filename', () => {
  expect([...LANDING_ASSETS].sort()).toEqual(approved.media.map(e => e.publicPath).sort());
  for (const e of approved.media.filter(e => e.publicPath.startsWith('/media/'))) {
    expect(e.publicPath).toContain(e.sha256.slice(0, 12));
  }
});
it('every public media file has provenance; every photo names a confirmed eligible real source', () => {
  for (const file of readdirSync('public/media')) {
    const entry = approved.media.find(e => e.publicPath === `/media/${file}`);
    expect(entry, file).toBeDefined();
    if (entry && ['real-photo', 'real-edited'].includes(entry.classification)) {
      const source = sources.products.find(p => p.representative === ('sourceId' in entry ? entry.sourceId : undefined));
      expect(source?.eligible).toBe(true);
      expect(source?.hold).toBeNull();
      expect(source?.confirmedIds).toContain(source?.representative);
      expect(source?.sha256).toBe(entry.sourceSha256);
      expect(source?.path).toBe(entry.sourcePath);
    }
  }
});
it('leaves framework static caching alone and makes approved media immutable on landing only', async () => {
  expect((await proxy(request('/_next/static/chunks/a.js'))).headers.get('cache-control')).toBeNull();
  for (const e of approved.media.filter(e => e.publicPath.startsWith('/media/'))) {
    const landing = await proxy(request(e.publicPath));
    expect(landing.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await proxy(request(e.publicPath, false))).status).toBe(404);
  }
});
it('keeps every landing page and refused page private and no-store', async () => {
  for (const path of ['/', '/privacy', '/?image=a.webp', '/?_rsc=fixture', '/admin', '/foo.png']) {
    expect((await proxy(request(path))).headers.get('cache-control')).toBe('private, no-store');
  }
});

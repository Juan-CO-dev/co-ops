import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { landingIndexable } from '@/lib/landing/indexing-shared';
import { proxy } from '@/proxy';
vi.mock('@/lib/auth', () => ({ verifyJwt: vi.fn() }));
const env = { VERCEL_ENV: 'production', LANDING_HOSTS: 'eat.example.test,preview.example.test', SITE_ORIGIN: 'https://eat.example.test', STAFF_ORIGIN: 'https://staff.example.test' };
afterEach(() => vi.unstubAllEnvs());
it('requires production identity AND the approved canonical authority', () => {
  for (const host of ['eat.example.test','EAT.EXAMPLE.TEST:443']) expect(landingIndexable(new Headers({host}),env)).toBe(true);
  for (const host of ['preview.example.test','staff.example.test','unknown.test','eat.example.test:3100']) expect(landingIndexable(new Headers({host}),env)).toBe(false);
  for (const VERCEL_ENV of [undefined,'','preview','development','Production']) expect(landingIndexable(new Headers({host:'eat.example.test','x-landing-indexable':'1'}),{...env,VERCEL_ENV})).toBe(false);
  for (const SITE_ORIGIN of [undefined,'','http://eat.example.test','https://eat.example.test/path','https://evil.test']) expect(landingIndexable(new Headers({host:'eat.example.test'}),{...env,SITE_ORIGIN})).toBe(false);
  expect(landingIndexable(new Headers({host:'eat.example.test','x-forwarded-host':'preview.example.test'}),env)).toBe(false);
});
it('overwrites forged decisions and alternates uncached robots/sitemap by authoritative host', async () => {
  for (const [key,value] of Object.entries(env)) vi.stubEnv(key,value);
  for (const host of ['eat.example.test','preview.example.test','eat.example.test','preview.example.test']) {
    const indexable=host==='eat.example.test';
    for (const path of ['/','/privacy','/robots.txt','/sitemap.xml']) {
      const response=await proxy(new NextRequest(`https://${host}${path}`,{headers:{host,'x-landing-indexable':indexable?'0':'1'}}));
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-robots-tag')).toBe(indexable?null:'noindex, nofollow');
      if(path==='/robots.txt') expect(await response.text()).toBe(indexable?'User-agent: *\nAllow: /\nSitemap: https://eat.example.test/sitemap.xml\n':'User-agent: *\nDisallow: /\n');
      else if(path==='/sitemap.xml') { const body=await response.text(); expect(body.includes('<loc>https://eat.example.test/</loc>')).toBe(indexable); expect(body.includes('<loc>https://eat.example.test/privacy</loc>')).toBe(indexable); }
      else expect(response.headers.get('x-middleware-request-x-landing-indexable')).toBe(indexable?'1':'0');
    }
  }
});

import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { classifyLandingHost } from '@/lib/landing/host-shared';
import { landingIndexable as indexablePolicy } from '@/lib/landing/indexing-shared';
import { proxy } from '@/proxy';
vi.mock('@/lib/auth', () => ({ verifyJwt: vi.fn() }));
const landingIndexable = (headers: Headers, env: Parameters<typeof indexablePolicy>[2]) => indexablePolicy(classifyLandingHost(headers, env), headers, env);
const env = { VERCEL_ENV: 'production', LANDING_HOSTS: 'eat.example.test,preview.example.test', SITE_ORIGIN: 'https://eat.example.test', STAFF_ORIGIN: 'https://staff.example.test' };
it('rejects ambiguous language queries consistently with the page language resolver',async()=>{
 for(const [key,value] of Object.entries(env)) vi.stubEnv(key,value);
 for(const query of ['lang=es&lang=en','lang=invalid']) {
  const response=await proxy(new NextRequest(`https://eat.example.test/?${query}`,{headers:{host:'eat.example.test','accept-language':'en'}}));
  expect(response.headers.get('x-middleware-request-x-landing-language')).toBe('en');
 }
});
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
    vi.stubEnv('VERCEL_ENV', indexable ? 'production' : 'preview');
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

it('redirects production aliases preserving path/query but leaves apex and preview documents', async () => {
 for (const [key,value] of Object.entries(env)) vi.stubEnv(key,value);
 const alias=await proxy(new NextRequest('https://preview.example.test/privacy?lang=es&ad=test',{headers:{host:'preview.example.test'}}));
 expect(alias.status).toBe(301); expect(alias.headers.get('location')).toBe('https://eat.example.test/privacy?lang=es&ad=test');
 const apex=await proxy(new NextRequest('https://eat.example.test/',{headers:{host:'eat.example.test'}})); expect(apex.status).toBe(200);
 vi.stubEnv('VERCEL_ENV','preview');
 const preview=await proxy(new NextRequest('https://preview.example.test/',{headers:{host:'preview.example.test'}})); expect(preview.status).toBe(200); expect(preview.headers.get('x-robots-tag')).toBe('noindex, nofollow');
});

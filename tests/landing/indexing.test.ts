import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { classifyLandingHost } from '@/lib/landing/host-shared';
import { landingCanonical, landingIndexable as indexablePolicy } from '@/lib/landing/indexing-shared';
import { generateMetadata } from '@/app/eat/layout';
const metadataHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => metadataHeaders.current }));
import { proxy } from '@/proxy';
vi.mock('@/lib/auth', () => ({ verifyJwt: vi.fn() }));
const landingIndexable = (headers: Headers, env: Parameters<typeof indexablePolicy>[2]) => indexablePolicy(classifyLandingHost(headers, env), headers, env);
const env = { LANDING_INDEXING: 'on', VERCEL_ENV: 'production', LANDING_HOSTS: 'eat.example.test,preview.example.test', SITE_ORIGIN: 'https://eat.example.test', STAFF_ORIGIN: 'https://staff.example.test' };
it('rejects ambiguous language queries consistently with the page language resolver',async()=>{
 for(const [key,value] of Object.entries(env)) vi.stubEnv(key,value);
 for(const query of ['lang=es&lang=en','lang=invalid']) {
  const response=await proxy(new NextRequest(`https://eat.example.test/?${query}`,{headers:{host:'eat.example.test','accept-language':'en'}}));
  expect(response.headers.get('x-middleware-request-x-landing-language')).toBe('en');
 }
});
afterEach(() => vi.unstubAllEnvs());
it('serves alias APIs, assets and discovery endpoints in place with noindex',async()=>{
 for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
 for(const path of ['/api/landing/ad-code','/api/landing/events','/api/landing/order-click','/favicon.ico','/_next/static/a.js','/eat/icon.png','/robots.txt','/sitemap.xml']) {
  const response=await proxy(new NextRequest(`https://preview.example.test${path}`,{method:path.startsWith('/api/')?'POST':'GET',headers:{host:'preview.example.test'}}));
  expect(response.status,path).toBe(200);expect(response.headers.get('location'),path).toBeNull();expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  if(path==='/robots.txt')expect(await response.text()).toBe('User-agent: *\nDisallow: /\n');
  if(path==='/sitemap.xml')expect(await response.text()).not.toContain('<loc>');
 }
});
it.each([['/eat','/'],['/eat/privacy','/privacy']])('collapses alias %s in exactly one hop',async(path,destination)=>{
 for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
 const response=await proxy(new NextRequest(`https://preview.example.test${path}?lang=es&ad=campaign`,{headers:{host:'preview.example.test'}}));
 expect(response.status).toBe(301);expect(response.headers.get('location')).toBe(`https://eat.example.test${destination}?lang=es&ad=campaign`);
 const next=await proxy(new NextRequest(response.headers.get('location')!,{headers:{host:'eat.example.test'}}));expect(next.status).toBe(200);expect(next.headers.get('location')).toBeNull();
});
it('forwards only explicit valid single language and varies landing HTML',async()=>{
 for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
 for(const [query,explicit] of [['',''],['lang=invalid',''],['lang=es&lang=en',''],['lang=es','es'],['lang=en','en']]) {
  const response=await proxy(new NextRequest(`https://eat.example.test/?${query}`,{headers:{host:'eat.example.test','accept-language':'es','x-landing-explicit-language':'es'}}));
  expect(response.headers.get('x-middleware-request-x-landing-explicit-language')).toBe(explicit||null);
 }
});
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

it.each([undefined, 'on'])('redirects production aliases with indexing %s preserving path/query but leaves apex and preview documents', async LANDING_INDEXING => {
 for (const [key,value] of Object.entries(env)) vi.stubEnv(key,value);
 vi.stubEnv('LANDING_INDEXING', LANDING_INDEXING);
 const alias=await proxy(new NextRequest('https://preview.example.test/privacy?lang=es&ad=test',{headers:{host:'preview.example.test'}}));
 expect(alias.status).toBe(301); expect(alias.headers.get('location')).toBe('https://eat.example.test/privacy?lang=es&ad=test');
 const apex=await proxy(new NextRequest('https://eat.example.test/',{headers:{host:'eat.example.test'}})); expect(apex.status).toBe(200);
 vi.stubEnv('VERCEL_ENV','preview');
 const preview=await proxy(new NextRequest('https://preview.example.test/',{headers:{host:'preview.example.test'}})); expect(preview.status).toBe(200); expect(preview.headers.get('x-robots-tag')).toBe('noindex, nofollow');
});

it.each([undefined, '', 'off', '1', 'ON', ' on', 'on ', 'on'])('canonical identity is independent of indexing %s', async LANDING_INDEXING => {
  const config = { ...env, LANDING_INDEXING };
  for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
  const enabled = LANDING_INDEXING === 'on';
  const host = 'eat.example.test';
  expect(landingCanonical('landing', new Headers({ host }), config)).toBe(true);
  expect(landingIndexable(new Headers({ host }), config)).toBe(enabled);
  for (const path of ['/', '/privacy', '/robots.txt', '/sitemap.xml']) {
    const response = await proxy(new NextRequest(`https://${host}${path}`, { headers: { host, 'x-landing-indexable': enabled ? '0' : '1' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-robots-tag')).toBe(enabled ? null : 'noindex, nofollow');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    if (path === '/robots.txt') {
      expect(await response.text()).toBe(`User-agent: *\nAllow: /\n${enabled ? 'Sitemap: https://eat.example.test/sitemap.xml\n' : ''}`);
    } else if (path === '/sitemap.xml') {
      const body = await response.text();
      expect((body.match(/<loc>/g) ?? []).length).toBe(enabled ? 4 : 0);
    } else {
      const forwarded = new Headers();
      response.headers.forEach((value, key) => {
        if (key.startsWith('x-middleware-request-')) forwarded.set(key.slice('x-middleware-request-'.length), value);
      });
      metadataHeaders.current = forwarded;
      expect(forwarded.get('x-landing-indexable')).toBe(enabled ? '1' : '0');
      expect((await generateMetadata()).robots).toEqual({ index: enabled, follow: enabled });
    }
  }
  for (const [path, destination] of [['/', '/'], ['/privacy', '/privacy'], ['/eat', '/'], ['/eat/privacy', '/privacy']]) {
    const alias = await proxy(new NextRequest(`https://preview.example.test${path}?lang=es`, { headers: { host: 'preview.example.test' } }));
    expect(alias.status).toBe(301);
    expect(alias.headers.get('location')).toBe(`https://${host}${destination}?lang=es`);
    const next = await proxy(new NextRequest(alias.headers.get('location')!, { headers: { host } }));
    expect(next.status).toBe(200);
    expect(next.headers.get('location')).toBeNull();
  }
});

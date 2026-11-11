// Permanent port of Opus review prod-equiv.test.ts: compares status, all headers and body.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { proxy as before } from '@/tests/landing/pre-portal-proxy.fixture';
vi.mock('@/lib/auth', () => ({ verifyJwt: vi.fn(async (t: string) => { if (t !== 'good') throw new Error('bad'); return { user_id:'u', app_role:'employee', role_level:1, session_id:'s' }; }) }));
const PROD = { LANDING_HOSTS:'eat.complimentsonlyoperations.com', SITE_ORIGIN:'https://eat.complimentsonlyoperations.com', STAFF_ORIGIN:'https://co-ops-ashy.vercel.app', VERCEL_ENV:'production', NEXT_PUBLIC_APP_URL:'https://co-ops-ashy.vercel.app' };
afterEach(() => vi.unstubAllEnvs());
const hosts = ['complimentsonlyoperations.com','co-ops-ashy.vercel.app','eat.complimentsonlyoperations.com','catering.complimentsonlyoperations.com','random-alias.vercel.app','EAT.complimentsonlyoperations.com:443','eat.complimentsonlyoperations.com.','bad host'];
const paths = ['/','/privacy','/eat','/eat/privacy','/order','/order/start','/order/quote/12345678-1234-1234-1234-123456789abc?checkout=success','/api/portal/magic-link/request','/api/portal/order/draft/lines','/admin','/dashboard','/api/admin/x','/api/auth/pin','/api/cron/x','/api/webhooks/stripe','/_next/static/chunks/a.js','/_next/image?url=%2Fx&w=64&q=75','/_next/data/b/x.json','/robots.txt','/sitemap.xml','/favicon.ico','/media/a.png','/brand/co-icon.png','/order/..%2fadmin','//admin','/ORDER','/order/','/x.json','/api/landing/events','/opengraph-image.png'];
const extras: Record<string,string>[] = [{}, {cookie:'co_ops_session=good'}, {cookie:'co_ops_session=bad'}, {rsc:'1','next-router-prefetch':'1'}, {'next-action':'abc', cookie:'co_ops_session=good'}, {'x-forwarded-host':'evil.test'}, {'x-co-user-id':'spoof'}];
const url = (host: string, p: string) => `https://${host.includes(' ')?'x.test':host.replace(/\.$/,'')}${p}`;
async function cmp(env: Record<string,string>, hs: string[], methods: string[]) {
  // Preserve the frozen fixture's canonical=indexable production behavior.
  vi.stubEnv('LANDING_INDEXING', 'on');
  vi.stubEnv('PORTAL_HOSTS', undefined); vi.stubEnv('PORTAL_ORIGIN', undefined);
  for (const [k,v] of Object.entries(env)) vi.stubEnv(k, v);
  let n = 0;
  for (const host of hs) for (const p of paths) for (const ex of extras) for (const method of methods) {
    const mk = () => new NextRequest(url(host,p), { method, headers: { host, ...ex } });
    const a = await before(mk()); const b = await proxy(mk());
    const id = `${method} ${host}${p} ${JSON.stringify(ex)}`;
    expect(b.status, id).toBe(a.status); expect([...b.headers], id).toEqual([...a.headers]); expect(await b.text(), id).toBe(await a.text()); n++;
  }
  return n;
}
describe('prod env equivalence', () => {
  it('portal unset', async () => expect(await cmp(PROD, hosts, ['GET','POST'])).toBe(3360));
  it('portal empty', async () => expect(await cmp({...PROD, PORTAL_HOSTS:'', PORTAL_ORIGIN:''}, hosts, ['GET','POST'])).toBe(3360));
  it('portal hosts set but origin unset (half config) - non-catering hosts', async () => expect(await cmp({...PROD, PORTAL_HOSTS:'catering.complimentsonlyoperations.com'}, hosts.filter(h=>!h.startsWith('catering')), ['GET'])).toBe(1470));
  it('portal on - non-catering hosts', async () => expect(await cmp({...PROD, PORTAL_HOSTS:'catering.complimentsonlyoperations.com', PORTAL_ORIGIN:'https://catering.complimentsonlyoperations.com'}, hosts.filter(h=>!h.startsWith('catering')), ['GET','POST'])).toBe(2940));
});

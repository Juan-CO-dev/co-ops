import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { classifyLandingHost, portalIdentity, portalPathDecision, PORTAL_API_PATHS } from '@/lib/landing/host-shared';
import { portalOrigin } from '@/lib/portal/origin-shared';
import { assertSameOrigin } from '@/lib/portal/csrf';
import { SECURITY_HEADERS } from '@/lib/security-headers';
import { proxy } from '@/proxy';
import { proxy as beforePortal } from './landing/pre-portal-proxy.fixture';
import { verifyJwt } from '@/lib/auth';
import { renderOrderConfirmationEmail } from '@/lib/email-templates/order-confirmation';
import { getLandingLinks } from '@/lib/landing/links';
import { loadLandingConfig } from '@/lib/landing/config';

vi.mock('@/lib/auth', () => ({ verifyJwt: vi.fn(async () => ({ user_id:'u', app_role:'employee', role_level:1, session_id:'s' })) }));
const env = { LANDING_HOSTS:'eat.example.test', SITE_ORIGIN:'https://eat.example.test', STAFF_ORIGIN:'https://staff.example.test', PORTAL_HOSTS:'catering.example.test,preview.example.test', PORTAL_ORIGIN:'https://catering.example.test' };
const uuid = '12345678-1234-1234-1234-123456789abc';
const allowed = ['/order', '/order/start', '/order/verify', '/order/account', '/order/build', '/order/review', `/order/quote/${uuid}`, ...PORTAL_API_PATHS, `/api/portal/order/draft/${uuid}`, `/api/portal/quote/${uuid}/pay`, '/_next/static/chunks/a..js', '/brand/co-icon.png', '/brand/co-wordmark.png', '/brand/co-wordmark.svg', '/favicon.ico', '/icon.png', '/apple-icon.png'];
const denied = ['/admin', '/admin/a.png', '/login', '/verify', '/reset-password', '/api/auth/pin', '/api/admin/users', '/api/locations', '/api/users/login-options', '/api/landing/events', '/api/cron/test', '/api/webhooks/stripe', '/api/portal/unknown', '/api/portal/magic-link/verify/extra', `/api/portal/quote/${uuid}/pay/extra`, '/api/portal/order/draft/future-operation', '/ordering', '/orderly', '/eat', '/media/a.png', '/_next/image', '/robots.txt', '/sitemap.xml'];
function request(path: string, host = 'catering.example.test', extra: Record<string,string> = {}) {
  return new NextRequest(`https://${host}${path}`, { headers: { host, ...extra } });
}
beforeEach(() => { for (const [k,v] of Object.entries(env)) vi.stubEnv(k,v); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());
describe('three-way classifier', () => {
  it.each([['staff.example.test','staff'],['eat.example.test','landing'],['catering.example.test','portal'],['CATERING.EXAMPLE.TEST:443','portal'],['catering.example.test:3100','portal'],['preview.example.test','portal'],['unknown.test','staff']])('%s -> %s', (host,kind) => expect(classifyLandingHost(new Headers({host:host!}),env)).toBe(kind));
  it('both-listed host does not classify as portal (proxy denies it)', () => expect(classifyLandingHost(new Headers({host:'catering.example.test'}), {...env, LANDING_HOSTS:env.LANDING_HOSTS+',catering.example.test'})).toBe('staff'));
  it.each([undefined,'','Catering.example.test','*.example.test','catering.example.test:443','catering.example.test,invalid_'])('rejects unset or invalid list %s', PORTAL_HOSTS => expect(classifyLandingHost(new Headers({host:'catering.example.test'}),{...env,PORTAL_HOSTS})).toBe('staff'));
  it.each(['http://catering.example.test','https://catering.example.test/','https://evil.test',undefined])('rejects origin %s', PORTAL_ORIGIN => expect(classifyLandingHost(new Headers({host:'catering.example.test'}),{...env,PORTAL_ORIGIN})).toBe('staff'));
  it('staff identity wins and forwarded hints cannot grant portal', () => {
    expect(classifyLandingHost(new Headers({host:'staff.example.test'}),{...env,PORTAL_HOSTS:'staff.example.test',PORTAL_ORIGIN:env.STAFF_ORIGIN})).toBe('staff');
    expect(classifyLandingHost(new Headers({host:'catering.example.test','x-forwarded-host':'staff.example.test'}),env)).toBe('staff');
  });
});
describe('portal proxy boundary', () => {
  it.each(allowed)('admits %s, strips identity, ignores staff cookie', async path => {
    const r = await proxy(request(path, undefined, {cookie:'co_ops_session=test', 'x-co-user-id':'spoof', 'x-landing-language':'es'}));
    expect(portalPathDecision(path)).toBe('allow'); expect(r.status).toBe(200);
    expect(r.headers.get('x-middleware-next')).toBe('1');
    expect(r.headers.get('x-middleware-request-x-co-user-id')).toBeNull();
    expect(r.headers.get('x-middleware-request-x-landing-language')).toBeNull();
    expect(verifyJwt).not.toHaveBeenCalled();
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    for(const {key,value} of SECURITY_HEADERS) expect(r.headers.get(key)).toBe(value);
  });
  it.each(denied)('empty 404 for %s even with staff session', async path => {
    const r = await proxy(request(path, undefined, {cookie:'co_ops_session=test'}));
    expect(r.status).toBe(404); expect(await r.text()).toBe('');
    expect(r.headers.get('x-middleware-next')).toBeNull(); expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(verifyJwt).not.toHaveBeenCalled();
  });
  it('root redirects to actual intake with query retained', async () => {
    const r = await proxy(request('/?lang=es')); expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('https://catering.example.test/order/start?lang=es');
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it('bad portal configuration/authority never falls into staff', async () => {
    for(const host of ['catering.example.test.','catering.example.test:0','catering.example.test:bad']) expect((await proxy(request('/',undefined,{host}))).status).toBe(404);
    expect((await proxy(request('/',undefined,{'x-forwarded-host':'staff.example.test'}))).status).toBe(404);
    vi.stubEnv('PORTAL_ORIGIN','http://catering.example.test'); expect((await proxy(request('/'))).status).toBe(404);
  });
  it.each(['/_next/static/%2e%2e/a','/_next/static/../a','/order/%2fadmin'])('rejects ambiguous paths %s', path => expect(portalPathDecision(path)).toBe('deny'));
  it.each([...PORTAL_API_PATHS, `/api/portal/quote/${uuid}/pay`])('same-origin POST passes on portal: %s', async path => {
    const req = new NextRequest(`https://catering.example.test${path}`, {method:'POST',headers:{host:'catering.example.test',origin:'https://catering.example.test'}});
    expect((await proxy(req)).headers.get('x-middleware-next')).toBe('1'); expect(assertSameOrigin(req)).toBeNull();
    req.headers.set('origin','https://staff.example.test'); expect(assertSameOrigin(req)?.status).toBe(403);
    req.headers.set('host','staff.example.test'); expect(assertSameOrigin(req)?.status).toBe(403);
  });
});
it.each([undefined,''])('unset env preserves full response bytes for existing hosts (%s)', async value => {
  vi.stubEnv('PORTAL_HOSTS',value);vi.stubEnv('PORTAL_ORIGIN',value);
  for(const host of ['staff.example.test','eat.example.test','unlisted.example.test']) for(const path of ['/',...allowed,...denied]) for(const cookie of ['', 'co_ops_session=test']) {
    const req = request(path,host,{cookie}); const before = await beforePortal(req); const after = await proxy(req);
    expect(after.status,`${host}${path}`).toBe(before.status); expect([...after.headers]).toEqual([...before.headers]); expect(await after.text()).toBe(await before.text());
  }
});
it('configured portal leaves staff and landing response bytes unchanged', async () => {
  for(const host of ['staff.example.test','eat.example.test']) for(const path of ['/', '/order/verify?token=legacy', '/admin', '/api/landing/events']) {
    const req=request(path,host); const a=await beforePortal(req);const b=await proxy(req);
    expect(b.status).toBe(a.status);expect([...b.headers]).toEqual([...a.headers]);expect(await b.text()).toBe(await a.text());
  }
});
describe('customer link origin', () => {
  it('routes the opt-in landing catering CTA through the same origin, leaving the dormant CTA unchanged', () => {
    const config=loadLandingConfig(env);
    expect(getLandingLinks(config).catering).toBe(config.cateringUrl);
    expect(getLandingLinks({...config,cateringPortalLive:true}).catering).toBe('https://catering.example.test/order');
    expect(getLandingLinks({...config,cateringPortalLive:true,PORTAL_ORIGIN:undefined}).catering).toBe('https://staff.example.test/order');
  });
  it('uses portal and preserves fallback bytes, including absent and legacy slash', () => {
    expect(portalOrigin({...env,NEXT_PUBLIC_APP_URL:env.STAFF_ORIGIN})).toBe(env.PORTAL_ORIGIN);
    for(const legacy of [undefined,'','https://staff.example.test','https://staff.example.test/']) expect(portalOrigin({NEXT_PUBLIC_APP_URL:legacy})).toBe(legacy);
    expect(portalOrigin({PORTAL_ORIGIN:'',NEXT_PUBLIC_APP_URL:env.STAFF_ORIGIN})).toBe(env.STAFF_ORIGIN);
  });
  it.each(['http://evil.test','https://user:pass@evil.test','https://evil.test/path','https://evil.test/','https://evil.test?x=1'])('invalid explicit origin stays dormant: %s', PORTAL_ORIGIN => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(portalOrigin({...env, PORTAL_ORIGIN, NEXT_PUBLIC_APP_URL:'legacy/'})).toBe('legacy/');
    expect(log).toHaveBeenCalledWith('[portal] invalid identity; customer links remain dormant');
    log.mockRestore();
  });
  it('confirmation email uses portal account and retains legacy appUrl normalization', () => {
    const input={name:'Test',eventDateLabel:'Tomorrow',totalCents:100,depositCents:20};
    expect(renderOrderConfirmationEmail(input)).toContain('href="https://catering.example.test/order/account"');
    vi.stubEnv('PORTAL_ORIGIN',undefined);vi.stubEnv('NEXT_PUBLIC_APP_URL','https://staff.example.test/');
    expect(renderOrderConfirmationEmail(input)).toContain('href="https://staff.example.test"');
  });
});

describe('review identity and fail-closed regressions', () => {
  it.each([
    { PORTAL_HOSTS: undefined }, { PORTAL_ORIGIN: undefined },
    { PORTAL_ORIGIN: 'https://other.test' }, { STAFF_ORIGIN: 'bad' },
    { STAFF_ORIGIN: env.PORTAL_ORIGIN },
    { LANDING_HOSTS: 'catering.example.test' },
  ])('links and classifier agree when incomplete: %j', overrides => {
    const config = {...env, ...overrides};
    expect(portalIdentity(config)).toBeNull();
    expect(portalOrigin({...config, NEXT_PUBLIC_APP_URL:'legacy/'})).toBe('legacy/');
    expect(classifyLandingHost(new Headers({host:'catering.example.test'}), config)).not.toBe('portal');
  });
  it.each([
    { LANDING_HOSTS:'catering.example.test', SITE_ORIGIN:env.PORTAL_ORIGIN },
    { STAFF_ORIGIN:env.PORTAL_ORIGIN }, { PORTAL_ORIGIN:undefined },
    { STAFF_ORIGIN:'bad' }, { PORTAL_HOSTS:'catering.example.test,invalid_' },
  ])('listed host is empty noindex 404: %j', async overrides => {
    for (const [k,v] of Object.entries(overrides)) vi.stubEnv(k,v);
    for (const path of ['/', '/order/start', '/admin', '/brand/co-wordmark.svg']) {
      const r = await proxy(request(path));
      expect(r.status).toBe(404); expect(await r.text()).toBe('');
      expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(r.headers.get('location')).toBeNull();
      expect(r.headers.get('x-middleware-next')).toBeNull();
    }
    expect(verifyJwt).not.toHaveBeenCalled();
  });
  it.each(allowed.filter(p => p.startsWith('/_next/') || p.startsWith('/brand/') || p.endsWith('.ico') || p.endsWith('.png')))('keeps asset caching for %s', async path => {
    const r = await proxy(request(path));
    expect(r.headers.get('cache-control')).toBe(path.startsWith('/brand/') ? 'public, max-age=300' : null);
  });
  it.each(['/order', '/api/portal/magic-link/request', '/admin', '/'])('keeps dynamic and error responses private: %s', async path => {
    expect((await proxy(request(path))).headers.get('cache-control')).toBe('private, no-store');
  });
});

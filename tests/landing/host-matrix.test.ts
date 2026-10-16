import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyLandingHost, parseAuthority, isLandingAsset, landingPathDecision } from '@/lib/landing/host-shared';

const env = { LANDING_HOSTS: 'eat.example.test,preview.example.test', SITE_ORIGIN: 'https://eat.example.test', STAFF_ORIGIN: 'https://staff.example.test' };
const headers = (host: string, forwarded?: string) => new Headers({ host, ...(forwarded ? { 'x-forwarded-host': forwarded } : {}) });
describe('strict authoritative host matrix', () => {
  it.each(['eat.example.test', 'EAT.EXAMPLE.TEST', 'eat.example.test:443', 'eat.example.test:3100', 'preview.example.test'])('allows normalized %s', host => expect(classifyLandingHost(headers(host), env)).toBe('landing'));
  it.each(['staff.example.test', 'unlisted.vercel.app', 'eat.example.test.evil.test'])('keeps %s outside landing', host => expect(classifyLandingHost(headers(host), env)).toBe('staff'));
  it.each(['', 'eat.example.test.', 'user@eat.example.test', 'eat.example.test/path', 'eat.example.test\\', 'eat.example.test,evil.test', ' eat.example.test', 'eat.example.test:0', 'eat.example.test:65536', 'eat.example.test:abc', 'xn--eat-9za.test', 'éat.example.test', 'eat.example.test?', 'eat.example.test#'])('rejects authority %s', host => expect(parseAuthority(host)).toBeNull());
  it('requires Host, ignores internal hints and refuses forwarded disagreement', () => {
    expect(classifyLandingHost(new Headers({ 'x-forwarded-host': 'eat.example.test', 'x-landing': 'true' }), env)).toBe('staff');
    expect(classifyLandingHost(headers('eat.example.test', 'staff.example.test'), env)).toBe('staff');
    expect(classifyLandingHost(headers('eat.example.test:3100', 'eat.example.test'), env)).toBe('staff');
    expect(classifyLandingHost(headers('EAT.EXAMPLE.TEST:443', 'eat.example.test'), env)).toBe('landing');
  });
  it.each([undefined, ''])('empty allowlist fails closed: %s', LANDING_HOSTS => {
    for (const host of ['eat.example.test', 'staff.example.test', 'preview.example.test']) expect(classifyLandingHost(headers(host), { ...env, LANDING_HOSTS })).toBe('staff');
  });
  it('never enables staff, malformed entries or invalid canonical origin', () => {
    expect(classifyLandingHost(headers('staff.example.test'), { ...env, LANDING_HOSTS: 'staff.example.test' })).toBe('staff');
    for (const LANDING_HOSTS of ['*.example.test', 'Eat.example.test', 'eat.example.test:443']) expect(classifyLandingHost(headers('eat.example.test'), { ...env, LANDING_HOSTS })).toBe('staff');
    expect(classifyLandingHost(headers('eat.example.test'), { ...env, SITE_ORIGIN: 'https://evil.test' })).toBe('staff');
  });
});
describe('finite landing route boundary', () => {
  it.each(['/api/locations','/api/users/login-options','/order','/order/start','/verify','/reset-password','/api/auth/pin','/api/auth/password','/api/auth/logout','/api/auth/verify','/api/auth/password-reset-request','/api/auth/password-reset','/api/portal/test','/api/webhooks/test','/api/cron/test','/admin/a.png','/dashboard','/jobs','/icon.png','/apple-icon.png','/opengraph-image.png','/eat/extra'])('refuses %s', path => expect(landingPathDecision(path, new URLSearchParams())).toBe('deny'));
  it.each(['/','/privacy'])('rewrites %s', path => expect(landingPathDecision(path, new URLSearchParams())).toBe('rewrite'));
  it.each(['/eat','/eat/privacy'])('canonicalizes %s', path => expect(landingPathDecision(path, new URLSearchParams())).toBe('redirect'));
  it.each(['/api/landing/events','/api/landing/order-click','/_next/static/a.js','/brand/landing-icon.png'])('allows %s', path => expect(landingPathDecision(path, new URLSearchParams())).toBe('allow'));
  it('refuses the unused image optimizer even for approved images', () => {
    expect(isLandingAsset('/_next/image', new URLSearchParams({url:'/brand/landing-icon.png'}))).toBe(false);
    for (const url of ['/admin/image.png','https://evil.test/a.png','//evil.test/a.png','/media/../icon.png','/brand/unknown.png','/brand/landing-icon.png?x=1']) expect(isLandingAsset('/_next/image', new URLSearchParams({url}))).toBe(false);
  });
});

it('a mistakenly allowlisted staff canonical origin never enables landing redirects',()=> {
  expect(classifyLandingHost(headers('eat.example.test'),{...env,LANDING_HOSTS:'eat.example.test,staff.example.test',SITE_ORIGIN:'https://staff.example.test'})).toBe('staff');
});

it('permits the actual shared not-found wordmark on the landing host', () => {
  const source = readFileSync('app/not-found.tsx', 'utf8');
  const image = source.match(/<img src="([^"]+)"/);
  expect(image).not.toBeNull();
  expect(landingPathDecision(image![1]!, new URLSearchParams())).toBe('allow');
});

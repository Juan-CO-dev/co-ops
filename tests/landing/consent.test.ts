import { describe, expect, it } from 'vitest';
import { marketingAllowed, readConsent, consentCookie } from '@/lib/landing/consent-shared';

describe('landing consent', () => {
  it.each([undefined, 'unknown', 'rejected'])('denies %s', choice => expect(marketingAllowed(true, choice, {})).toBe(false));
  it('requires server permission regardless of consent', () => expect(marketingAllowed(false, 'accepted', {})).toBe(false));
  it.each([{doNotTrack:'1'}, {globalPrivacyControl:true}])('honors browser privacy %o', signals => expect(marketingAllowed(true, 'accepted', signals)).toBe(false));
  it('allows only affirmative consent without privacy overrides', () => expect(marketingAllowed(true, 'accepted', {})).toBe(true));
  it('reads exact cookie and fails closed for duplicates', () => {
    expect(readConsent('other=accepted; landing_consent=accepted')).toBe('accepted');
    expect(readConsent('landing_consent=accepted; landing_consent=rejected')).toBe('unknown');
  });
  it('writes host-only secure consent preference', () => {
    expect(consentCookie('accepted', true)).toBe('landing_consent=accepted; Path=/; SameSite=Lax; Max-Age=15552000; Secure');
    expect(consentCookie('rejected', false)).not.toMatch(/Domain=/i);
  });
});

describe('W24/B131 marketing cookie withdrawal', () => {
  it('withdrawal expires marketing cookies on the host and every parent domain', async () => {
    const { marketingCookieExpiries } = await import('@/lib/landing/consent-shared');
    const writes = marketingCookieExpiries('eat.complimentsonlyoperations.com', true);
    for (const key of ['_fbp', '_fbc']) {
      const base = `${key}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
      expect(writes).toContain(base);
      expect(writes).toContain(`${base}; Domain=eat.complimentsonlyoperations.com`);
      expect(writes).toContain(`${base}; Domain=complimentsonlyoperations.com`);
    }
    expect(writes.some(w => /Domain=com$/.test(w))).toBe(false);
    expect(writes).toHaveLength(6);
    expect(writes.some(w => w.startsWith('landing_consent'))).toBe(false);
  });
  it.each(['localhost', '127.0.0.1', '[::1]', '::1'])('%s gets host-only expiries only', async host => {
    const { marketingCookieExpiries, marketingCookieDomains } = await import('@/lib/landing/consent-shared');
    expect(marketingCookieDomains(host)).toEqual([]);
    expect(marketingCookieExpiries(host, false)).toEqual(['_fbp=; Path=/; Max-Age=0; SameSite=Lax', '_fbc=; Path=/; Max-Age=0; SameSite=Lax']);
  });
  it('lists the host and each parent, never a bare TLD', async () => {
    const { marketingCookieDomains } = await import('@/lib/landing/consent-shared');
    expect(marketingCookieDomains('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
    expect(marketingCookieDomains('example.com')).toEqual(['example.com']);
    expect(marketingCookieDomains('EAT.Example.com.')).toEqual(['eat.example.com', 'example.com']);
  });
});

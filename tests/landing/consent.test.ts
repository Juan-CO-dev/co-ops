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

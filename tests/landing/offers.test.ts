import { describe, expect, it } from 'vitest';
import { resolveOffer, APPROVED_OFFERS, type LandingOffer } from '@/lib/landing/offers';
describe('landing offers', () => {
  const offer: LandingOffer = {ad:'test', code:'TEST', approved:true, redemptionConfigured:true, terms:'Test terms', expiresAt:'2030-01-01T00:00:00Z', stores:['test-store']};
  it('ships no invented live offer', () => expect(APPROVED_OFFERS).toEqual([]));
  it('shows an approved redeemable store offer with terms', () => expect(resolveOffer('test','test-store',[offer],0)).toEqual(offer));
  it.each([{approved:false},{redemptionConfigured:false},{terms:''},{expiresAt:'bad'},{expiresAt:'1970-01-01T00:00:00Z'}])('refuses invalid offer %o', change => expect(resolveOffer('test','test-store',[{...offer,...change}],1)).toBeUndefined());
  it('refuses unknown ad and wrong store', () => { expect(resolveOffer('other','test-store',[offer],0)).toBeUndefined(); expect(resolveOffer('test','other',[offer],0)).toBeUndefined(); });
});

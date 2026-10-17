import { describe, expect, it, vi } from 'vitest';
import { createLandingTracker } from '@/lib/landing/tracking-client';
describe('landing dispatch', () => {
  function fixture(overrides = {}) {
    const pixel = vi.fn(), post = vi.fn(), loadPixel = vi.fn(), revokePixel = vi.fn();
    let id = 0;
    const tracker = createLandingTracker({serverApproved:true,pixelId:'123',capiEnabled:true,sourceUrl:'https://eat.example/',allowedStores:['dupont'],allowedAds:['subsim-photo'],allowedPlacements:['hero','footer'],...overrides}, {pixel,post,loadPixel,revokePixel,uuid:()=>`id-${++id}`,now:()=>123000});
    return {tracker,pixel,post,loadPixel,revokePixel};
  }
  it('denies all sends without consent or server approval', () => {
    for (const approved of [true,false]) { const f=fixture({serverApproved:approved}); if (!approved) f.tracker.setConsent(true); f.tracker.dispatch('OrderClick',{store:'dupont',placement:'hero'}); expect(f.post).not.toHaveBeenCalled(); expect(f.pixel).not.toHaveBeenCalled(); }
  });
  it('loads once, deduplicates page/sections and revokes', () => {
    const f=fixture(); f.tracker.setConsent(true); f.tracker.setConsent(true); f.tracker.pageView(); f.tracker.pageView(); f.tracker.sectionView('hero'); f.tracker.sectionView('hero');
    expect(f.loadPixel).toHaveBeenCalledOnce(); expect(f.pixel.mock.calls.map(c=>c[1])).toEqual(['PageView','ViewContent']);
    f.tracker.setConsent(false); f.tracker.dispatch('Lead',{placement:'hero'}); expect(f.revokePixel).toHaveBeenCalledOnce(); expect(f.post).not.toHaveBeenCalled();
  });
  it('shares action IDs, uses custom semantics and one independent counter without retries', () => {
    const f=fixture(); f.tracker.setConsent(true);
    f.tracker.dispatch('OrderClick',{store:'dupont',placement:'hero',ad:'subsim-photo'});
    f.tracker.dispatch('OrderClick',{store:'dupont',placement:'hero'});
    expect(f.pixel.mock.calls[0]?.slice(0,2)).toEqual(['trackCustom','OrderClick']);
    expect(f.pixel.mock.calls[0]?.[3]).toBe('id-1'); expect(f.post.mock.calls[0]?.[1].event_id).toBe('id-1');
    expect(f.post.mock.calls.filter(c=>c[0].endsWith('order-click'))).toHaveLength(2);
    expect(f.post.mock.calls[1]?.[1]).toEqual({store:'dupont',ad:'subsim-photo'});
    expect(f.pixel.mock.calls[1]?.[3]).toBe('id-2');
  });
  it('counter works with Meta absent and excludes vendors', () => {
    const f=fixture({pixelId:undefined,capiEnabled:false}); f.tracker.setConsent(true);
    f.tracker.dispatch('OrderClick',{store:'dupont',placement:'hero',ad:'unknown'});
    f.tracker.dispatch('OrderClick',{store:'dupont',placement:'footer',vendor:'ubereats'});
    expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/landing/order-click',{store:'dupont',ad:'unattributed'});
    expect(f.loadPixel).not.toHaveBeenCalled(); expect(f.pixel).not.toHaveBeenCalled();
  });
  it('standard Lead and custom CateringClick; never arbitrary metadata', () => {
    const f=fixture(); f.tracker.setConsent(true);
    f.tracker.dispatch('Lead',{placement:'hero'}); f.tracker.dispatch('CateringClick',{placement:'hero'});
    expect(f.pixel.mock.calls.map(c=>c.slice(0,2))).toEqual([['track','Lead'],['trackCustom','CateringClick']]);
    f.tracker.dispatch('OrderClick',{store:'unknown',placement:'hero'}); expect(f.pixel).toHaveBeenCalledTimes(2);
  });
  it('CAPI can operate without a browser Pixel ID', () => {
    const f=fixture({pixelId:undefined});f.tracker.setConsent(true);
    f.tracker.dispatch('Lead',{placement:'hero'});
    expect(f.post).toHaveBeenCalledOnce();expect(f.post.mock.calls[0]?.[1].event_name).toBe('Lead');
    expect(f.loadPixel).not.toHaveBeenCalled();expect(f.pixel).not.toHaveBeenCalled();
  });
});

it.each(['sticky','crave','subdex'])('keeps %s consent-gated with one dispatch per action',placement=>{
  const pixel=vi.fn(),post=vi.fn();
  const tracker=createLandingTracker({serverApproved:true,pixelId:'123',capiEnabled:true,sourceUrl:'https://eat.example/',allowedStores:['dupont'],allowedAds:[],allowedPlacements:[placement]}, {pixel,post,loadPixel:vi.fn(),revokePixel:vi.fn(),uuid:()=> 'action-id',now:()=>123000});
  tracker.dispatch('OrderClick',{placement,store:'dupont'});expect(post).not.toHaveBeenCalled();
  tracker.setConsent(true);tracker.dispatch('OrderClick',{placement,store:'dupont'});
  expect(pixel).toHaveBeenCalledOnce();expect(post).toHaveBeenCalledTimes(2);
  tracker.setConsent(false);tracker.dispatch('OrderClick',{placement,store:'dupont'});expect(post).toHaveBeenCalledTimes(2);
});

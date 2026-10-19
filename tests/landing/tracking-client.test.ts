import { describe, expect, it, vi } from 'vitest';
import { buildFbc } from '@/lib/landing/attribution-shared';
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
  it.each(['OrderClick','CateringClick'] as const)('sends %s immediately during resolution, server only, exactly once',name=>{
    const f=fixture();f.tracker.beginResolution();
    const details=vi.fn(()=>({store:'dupont',placement:'hero',ad:'unresolved',fbc:'fb.1.123.Click',fbp:'fb.1.123.456'}));
    f.tracker.dispatch(name,details,{id:'original',time:123000});
    expect(details).toHaveBeenCalledWith(true);
    expect(f.loadPixel).not.toHaveBeenCalled();expect(f.pixel).not.toHaveBeenCalled();
    expect(f.post.mock.calls.find(call=>call[0]==='/api/landing/events')).toEqual(['/api/landing/events',expect.objectContaining({event_name:name,event_id:'original',event_time:123,ad:'unattributed',fbc:'fb.1.123.Click',fbp:'fb.1.123.456'}),{unload:true}]);
    // A departing page may deliver only one beacon: our own count is sent first.
    if(name==='OrderClick')expect(f.post.mock.calls[0]?.[0]).toBe('/api/landing/order-click');
    expect(f.post).toHaveBeenCalledTimes(name==='OrderClick'?2:1);
    f.tracker.setAcceptedAd('new-campaign');f.tracker.setConsent(true);f.tracker.flushPending('new-campaign');f.tracker.flushPending('new-campaign');
    expect(f.pixel).not.toHaveBeenCalled();expect(f.post).toHaveBeenCalledTimes(name==='OrderClick'?2:1);
    if(name==='OrderClick')expect(f.post.mock.calls[0]).toEqual(['/api/landing/order-click',{store:'dupont',ad:'unattributed'},{unload:true}]);
  });
  it('flushes a buffered Lead with fresh details and its original ID/time exactly once',()=>{
    const f=fixture();const current: {fbc?:string;fbp?:string}={};
    const details=vi.fn(()=>({placement:'hero',...current}));
    f.tracker.beginResolution();f.tracker.dispatch('Lead',details);
    expect(details).not.toHaveBeenCalled();expect(f.post).not.toHaveBeenCalled();
    current.fbc=buildFbc('Captured_Click',123456);current.fbp='fb.1.123.789';
    f.tracker.setAcceptedAd('new-campaign');f.tracker.setConsent(true);f.tracker.flushPending('new-campaign');f.tracker.flushPending('new-campaign');
    expect(details).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/landing/events',expect.objectContaining({event_id:'id-1',event_time:123,ad:'new-campaign',fbc:'fb.1.123456.Captured_Click',fbp:current.fbp}));
    expect(f.pixel.mock.calls[0]?.[3]).toBe('id-1');
  });
  it('keeps resolution sends gated by server approval and CAPI flag',()=>{
    const denied=fixture({serverApproved:false});denied.tracker.beginResolution();denied.tracker.dispatch('OrderClick',{store:'dupont',placement:'hero'});expect(denied.post).not.toHaveBeenCalled();
    const counter=fixture({capiEnabled:false});counter.tracker.beginResolution();counter.tracker.dispatch('OrderClick',{store:'dupont',placement:'hero'});
    expect(counter.post).toHaveBeenCalledExactlyOnceWith('/api/landing/order-click',{store:'dupont',ad:'unattributed'},{unload:true});
  });
  it.each(['withdrawal','generation'])('drops the prior buffer on %s',reason=>{
    const f=fixture();f.tracker.beginResolution();f.tracker.dispatch('Lead',{placement:'hero'});f.tracker.sectionView('hero');
    if(reason==='withdrawal')f.tracker.setConsent(false);else f.tracker.beginResolution();
    f.tracker.setConsent(true);f.tracker.flushPending('unattributed');expect(f.post).not.toHaveBeenCalled();expect(f.pixel).not.toHaveBeenCalled();
  });
  it('bounds queued calls to ten and preserves section deduplication',()=>{
    const f=fixture();f.tracker.beginResolution();f.tracker.sectionView('hero');f.tracker.sectionView('hero');
    for(let i=0;i<20;i++)f.tracker.dispatch('Lead',{placement:'hero'});
    f.tracker.setConsent(true);f.tracker.flushPending('unattributed');f.tracker.sectionView('hero');
    expect(f.pixel.mock.calls.filter(call=>call[1]==='ViewContent')).toHaveLength(1);expect(f.post).toHaveBeenCalledTimes(8);
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

it.each(['sticky','shops','footer'])('keeps %s consent-gated with one dispatch per action',placement=>{
  const pixel=vi.fn(),post=vi.fn();
  const tracker=createLandingTracker({serverApproved:true,pixelId:'123',capiEnabled:true,sourceUrl:'https://eat.example/',allowedStores:['dupont'],allowedAds:[],allowedPlacements:[placement]}, {pixel,post,loadPixel:vi.fn(),revokePixel:vi.fn(),uuid:()=> 'action-id',now:()=>123000});
  tracker.dispatch('OrderClick',{placement,store:'dupont'});expect(post).not.toHaveBeenCalled();
  tracker.setConsent(true);tracker.dispatch('OrderClick',{placement,store:'dupont'});
  expect(pixel).toHaveBeenCalledOnce();expect(post).toHaveBeenCalledTimes(2);
  tracker.setConsent(false);tracker.dispatch('OrderClick',{placement,store:'dupont'});expect(post).toHaveBeenCalledTimes(2);
});

describe('browser transport unload delivery', () => {
  it('prefers a same-origin JSON beacon only for unload posts and falls back to keepalive fetch', async () => {
    const { browserTransport } = await import('@/lib/landing/tracking-client');
    const beacon = vi.fn(() => true);
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const transport = browserTransport();
      transport.post('/api/landing/order-click', { store: 'dupont', ad: 'unattributed' }, { unload: true });
      expect(beacon).toHaveBeenCalledOnce();
      const [path, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
      expect(path).toBe('/api/landing/order-click');
      expect(blob.type).toBe('application/json');
      expect(JSON.parse(await blob.text())).toEqual({ store: 'dupont', ad: 'unattributed' });
      expect(fetchSpy).not.toHaveBeenCalled();
      transport.post('/api/landing/events', { a: 1 });
      expect(beacon).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledOnce();
      beacon.mockReturnValueOnce(false);
      transport.post('/api/landing/events', { b: 2 }, { unload: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1]).toEqual(['/api/landing/events', expect.objectContaining({ keepalive: true, method: 'POST', credentials: 'same-origin' })]);
      beacon.mockImplementationOnce(() => { throw new TypeError('disallowed'); });
      transport.post('/api/landing/events', { c: 3 }, { unload: true });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllGlobals(); }
  });
});

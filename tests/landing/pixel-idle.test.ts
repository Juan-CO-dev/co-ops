import {afterEach,expect,it,vi} from 'vitest';
import {browserTransport,createLandingTracker} from '@/lib/landing/tracking-client';

afterEach(()=>vi.unstubAllGlobals());
it('waits for load and idle and refuses insertion after withdrawal',()=>{
  let loaded:()=>void=()=>{}, idle:()=>void=()=>{};
  const appendChild=vi.fn();
  const win={addEventListener:vi.fn((_event,fn)=>{loaded=fn;}),requestIdleCallback:vi.fn(fn=>{idle=fn;}),fbq:undefined};
  vi.stubGlobal('window',win);
  vi.stubGlobal('document',{readyState:'loading',getElementById:()=>null,createElement:()=>({}),head:{appendChild}});
  const transport=browserTransport();
  transport.loadPixel('123');
  expect(appendChild).not.toHaveBeenCalled();
  expect(win.requestIdleCallback).not.toHaveBeenCalled();
  loaded();
  expect(win.requestIdleCallback).toHaveBeenCalledOnce();
  transport.revokePixel(); idle();
  expect(appendChild).not.toHaveBeenCalled();
  transport.grantPixel?.(); idle();
  expect(appendChild).toHaveBeenCalledOnce();
});

it('posts with unload survival, same-origin credentials and no-store',()=>{
  const send=vi.fn().mockResolvedValue({});vi.stubGlobal('fetch',send);
  browserTransport().post('/api/landing/events',{event_id:'original'});
  expect(send).toHaveBeenCalledExactlyOnceWith('/api/landing/events',expect.objectContaining({method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true,body:'{"event_id":"original"}'}));
});


it('queues standard OrderClick and custom CateringClick before the SDK is idle', () => {
  const win: Window & typeof globalThis = {} as Window & typeof globalThis;
  Object.assign(win, {addEventListener:vi.fn(),requestIdleCallback:vi.fn()});
  const appendChild=vi.fn();
  vi.stubGlobal('window',win);
  vi.stubGlobal('document',{readyState:'loading',getElementById:()=>null,createElement:()=>({}),head:{appendChild}});
  const tracker=createLandingTracker({serverApproved:true,pixelId:'123',sourceUrl:'https://landing.example/',allowedStores:['dupont'],allowedAds:[],allowedPlacements:['hero']}, {...browserTransport(),post:vi.fn()});
  tracker.setConsent(true);
  const id=crypto.randomUUID();
  tracker.dispatch('OrderClick',{mode:'pickup',store:'dupont',placement:'hero'},{id,time:Date.now()});
  tracker.dispatch('CateringClick',{placement:'hero'},{id,time:Date.now()});
  expect(win.fbq?.queue).toContainEqual(['track','InitiateCheckout',{ad:'unattributed',placement:'hero',store:'dupont',mode:'pickup',content_name:'OrderClick'},{eventID:id}]);
  expect(win.fbq?.queue).toContainEqual(['trackCustom','CateringClick',{ad:'unattributed',placement:'hero'},{eventID:id}]);
  expect(appendChild).not.toHaveBeenCalled();
});

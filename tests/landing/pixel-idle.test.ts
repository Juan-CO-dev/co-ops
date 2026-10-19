import {afterEach,expect,it,vi} from 'vitest';
import {browserTransport} from '@/lib/landing/tracking-client';

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

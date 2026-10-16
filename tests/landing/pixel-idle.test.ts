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

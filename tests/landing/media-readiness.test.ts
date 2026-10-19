import {afterEach,expect,it,vi} from 'vitest';
import {createMediaReadiness,MEDIA_READY_TIMEOUT_MS,waitForMediaReadiness} from '@/lib/landing/media-readiness-shared';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('rechecks the elapsed deadline on the second RAF when the timeout fired first',()=>{
 vi.useFakeTimers();let now=0,pending:FrameRequestCallback|undefined;
 vi.stubGlobal('performance',{now:()=>now});
 vi.stubGlobal('window',Object.assign(new EventTarget(),{setTimeout,clearTimeout}));
 vi.stubGlobal('document',{readyState:'loading'});vi.stubGlobal('PerformanceObserver',undefined);
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{pending=callback;return 1;});
 vi.stubGlobal('cancelAnimationFrame',()=>{pending=undefined;});
 const ready=vi.fn();const stop=waitForMediaReadiness(ready);
 try{
  now=MEDIA_READY_TIMEOUT_MS;vi.advanceTimersByTime(MEDIA_READY_TIMEOUT_MS);
  expect(ready).not.toHaveBeenCalled();
  pending!(now);expect(ready).not.toHaveBeenCalled();
  pending!(now);expect(ready).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(5000);expect(ready).toHaveBeenCalledOnce();
 }finally{stop();}
});

it('requires two paint opportunities even when load or timeout arrives first',()=>{
  for(const signal of [false,true]){
    const gate=createMediaReadiness(100);
    if(signal)gate.signal();
    expect(gate.ready(100+MEDIA_READY_TIMEOUT_MS)).toBe(false);
    gate.paint();expect(gate.ready(100+MEDIA_READY_TIMEOUT_MS)).toBe(false);
    gate.paint();expect(gate.ready(100+MEDIA_READY_TIMEOUT_MS)).toBe(true);
  }
});
it('releases at 1500 ms without LCP/load, or earlier after a signal and paint',()=>{
  const gate=createMediaReadiness(100);gate.paint();gate.paint();
  expect(gate.ready(1599)).toBe(false);expect(gate.ready(1600)).toBe(true);
  const signalled=createMediaReadiness(100);signalled.paint();signalled.paint();
  expect(signalled.ready(101)).toBe(false);signalled.signal();expect(signalled.ready(101)).toBe(true);
});

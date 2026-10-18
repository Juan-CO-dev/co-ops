import {expect,it} from 'vitest';
import {createMediaReadiness,MEDIA_READY_TIMEOUT_MS} from '@/lib/landing/media-readiness-shared';

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

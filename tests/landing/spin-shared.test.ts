import {expect,it} from 'vitest';
import {spinFrameAt,spinLoadOrder,wrapAngle} from '@/lib/landing/spin-shared';

it('wraps any angle into one revolution',()=>{
  expect(wrapAngle(0,48)).toBe(0);expect(wrapAngle(49,48)).toBe(1);expect(wrapAngle(-1,48)).toBe(47);expect(wrapAngle(-97,48)).toBe(47);
});
it('loads a coarse revolution first, then every remaining frame exactly once',()=>{
  const order=spinLoadOrder(48);
  expect(order.slice(0,12)).toEqual([0,4,8,12,16,20,24,28,32,36,40,44]);
  expect([...order].sort((a,b)=>a-b)).toEqual(Array.from({length:48},(_,i)=>i));
});
it('draws the nearest loaded frame, wrapping across zero, or nothing',()=>{
  const coarse=(i:number)=>i%4===0;
  expect(spinFrameAt(5,48,coarse)).toBe(4);
  expect(spinFrameAt(-1,48,coarse)).toBe(0);
  expect(spinFrameAt(46.6,48,coarse)).toBe(0);
  expect(spinFrameAt(7,48,()=>true)).toBe(7);
  expect(spinFrameAt(3,48,()=>false)).toBeNull();
});

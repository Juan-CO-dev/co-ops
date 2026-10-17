import {describe,expect,it} from 'vitest';
import {heroActionsPassed,createStickyPreference} from '@/lib/landing/sticky-order-shared';

describe('sticky order eligibility and session preference',()=>{
  it('waits for the entire hero group to pass above the viewport, including reverse scroll',()=>{
    for(const bottom of [667,44,1,0]) expect(heroActionsPassed(bottom)).toBe(false);
    expect(heroActionsPassed(-1)).toBe(true);
    expect(heroActionsPassed(1)).toBe(false);
    expect(heroActionsPassed(Number.NaN)).toBe(false);
  });
  it('persists minimize and explicit restore, independently of consent',()=>{
    const values=new Map<string,string>();
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    const first=createStickyPreference(()=>storage);
    expect(first.read()).toBe(false);first.write(true);
    const next=createStickyPreference(()=>storage);
    expect(next.read()).toBe(true);next.write(false);
    expect(first.read()).toBe(false);
    expect([...values.keys()]).toEqual(['landing_order_minimized']);
  });
  it('retains in-memory choice when storage access is denied',()=>{
    const preference=createStickyPreference(()=>{throw new Error('denied');});
    preference.write(true);expect(preference.read()).toBe(true);
    preference.write(false);expect(preference.read()).toBe(false);
  });
});

it('keeps a restored in-memory preference when storage writes fail but old reads succeed',()=>{
  const preference=createStickyPreference(()=>({getItem:()=> 'true',setItem:()=>{throw new Error('quota');}}));
  expect(preference.read()).toBe(true);preference.write(false);expect(preference.read()).toBe(false);
});

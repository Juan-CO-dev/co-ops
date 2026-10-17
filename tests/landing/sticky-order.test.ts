import {describe,expect,it} from 'vitest';
import {heroActionsPassed,createStickyPreference,createStickyVisibility} from '@/lib/landing/sticky-order-shared';

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

it('recovers after sustained clearance without requiring a scroll reversal',()=>{
  const policy=createStickyVisibility();
  const sample=(y:number,now:number,clearance:number,heroBottom=-10)=>policy.update({y,now,clearance,heroBottom,suppressed:false});
  expect(sample(500,0,119).visible).toBe(false);
  expect(sample(510,10,120).visible).toBe(false);
  expect(sample(520,249,120).visible).toBe(false);
  expect(sample(530,250,120).visible).toBe(true);
  expect(sample(540,260,1).visible).toBe(true);
  expect(sample(550,270,-1).visible).toBe(false);
  expect(sample(1000,2000,500).visible).toBe(false);
  expect(sample(1100,3000,500).visible).toBe(true);
  expect(sample(970,4000,500).visible).toBe(true);
  expect(sample(970,4240,500).visible).toBe(true);
  expect(sample(0,4500,500,20).visible).toBe(false);
});

it('returns after a transient suppression clears, at the same scroll position',()=>{
  const policy=createStickyVisibility();
  const base={y:600,clearance:200,heroBottom:-1,suppressed:false};
  policy.update({...base,now:0});
  expect(policy.update({...base,now:240}).visible).toBe(true);
  expect(policy.update({...base,now:700,suppressed:true}).visible).toBe(false);
  expect(policy.update({...base,now:800}).visible).toBe(false);
  expect(policy.update({...base,now:1200}).visible).toBe(true);
});

it('immediately suppresses unsafe geometry even during dwell',()=>{
  const policy=createStickyVisibility();
  const base={y:600,clearance:200,heroBottom:-1,suppressed:false};
  policy.update({...base,now:0});
  expect(policy.update({...base,now:240}).visible).toBe(true);
  expect(policy.update({...base,now:241,suppressed:true}).visible).toBe(false);
});

it('keeps a restored in-memory preference when storage writes fail but old reads succeed',()=>{
  const preference=createStickyPreference(()=>({getItem:()=> 'true',setItem:()=>{throw new Error('quota');}}));
  expect(preference.read()).toBe(true);preference.write(false);expect(preference.read()).toBe(false);
});

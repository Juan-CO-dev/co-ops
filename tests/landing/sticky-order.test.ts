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

const clear={clearance:Infinity,heroBottom:-121,suppressed:false};
it('requires hero/footer hysteresis and sustained dwell, then stays visible between boundaries',()=>{
 const policy=createStickyVisibility();
 expect(policy.update({...clear,now:0,heroBottom:-1}).visible).toBe(false);
 expect(policy.update({...clear,now:100}).visible).toBe(false);
 expect(policy.update({...clear,now:499}).visible).toBe(false);
 expect(policy.update({...clear,now:500}).visible).toBe(true);
 expect(policy.update({...clear,now:1000,clearance:0,heroBottom:-1}).visible).toBe(true);
 expect(policy.update({...clear,now:1100,clearance:-1}).visible).toBe(false);
 expect(policy.update({...clear,now:1500,clearance:119}).visible).toBe(false);
 expect(policy.update({...clear,now:1600}).visible).toBe(false);
 expect(policy.update({...clear,now:2000}).visible).toBe(true);
 expect(policy.update({...clear,now:2500,heroBottom:0}).visible).toBe(false);
});
it('returns after transient suppression clears without a position change or latch',()=>{
 const policy=createStickyVisibility();
 policy.update({...clear,now:0});
 expect(policy.update({...clear,now:400}).visible).toBe(true);
 expect(policy.update({...clear,now:900,suppressed:true}).visible).toBe(false);
 expect(policy.update({...clear,now:1000}).visible).toBe(false);
 expect(policy.update({...clear,now:1399}).visible).toBe(false);
 expect(policy.update({...clear,now:1400}).visible).toBe(true);
});
it('resets release dwell when hovering at either boundary',()=>{
 for(const boundary of [{heroBottom:-119},{clearance:119}]){
  const policy=createStickyVisibility();
  policy.update({...clear,now:0});
  expect(policy.update({...clear,...boundary,now:399}).visible).toBe(false);
  expect(policy.update({...clear,now:400}).visible).toBe(false);
  expect(policy.update({...clear,now:799}).visible).toBe(false);
  expect(policy.update({...clear,now:800}).visible).toBe(true);
 }
});
it('keeps a restored in-memory preference when storage writes fail but old reads succeed',()=>{
 const preference=createStickyPreference(()=>({getItem:()=> 'true',setItem:()=>{throw new Error('quota');}}));
 expect(preference.read()).toBe(true);preference.write(false);expect(preference.read()).toBe(false);
});

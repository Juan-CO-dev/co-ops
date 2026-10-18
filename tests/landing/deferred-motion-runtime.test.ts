import {afterEach,expect,it,vi} from 'vitest';

const harness=vi.hoisted(()=>({effects:[] as (()=>unknown)[],updates:[] as unknown[]}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useRef(){return {current:null};},
 useState(initial:unknown){return [initial,(value:unknown)=>harness.updates.push(value)];},
 useEffect(effect:()=>unknown){harness.effects.push(effect);},
}));
vi.mock('@/components/landing/HeroMotion',()=>{throw Error('Import unavailable');});
import {DeferredMotion} from '@/components/landing/DeferredMotion';

afterEach(()=>{harness.effects=[];harness.updates=[];vi.unstubAllGlobals();});
it('exposes each rejected import, re-arms once, then stops retrying',async()=>{
 const windowStub=Object.assign(new EventTarget(),{scrollY:0});
 vi.stubGlobal('window',windowStub);
 vi.stubGlobal('navigator',{});
 vi.stubGlobal('matchMedia',()=>Object.assign(new EventTarget(),{matches:false}));
 DeferredMotion({children:null,fallbackLabel:'Unavailable',src:'/clip.mp4',pauseLabel:'Pause',playLabel:'Play'});
 const cleanup=harness.effects[0]!() as ()=>void;
 try {
  windowStub.dispatchEvent(new Event('scroll'));
  await vi.waitFor(()=>expect(harness.updates).toEqual(['loading','failed']));
  windowStub.dispatchEvent(new Event('scroll'));
  await vi.waitFor(()=>expect(harness.updates).toEqual(['loading','failed','loading','failed']));
  windowStub.dispatchEvent(new Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(harness.updates).toEqual(['loading','failed','loading','failed']);
 } finally {cleanup();}
});

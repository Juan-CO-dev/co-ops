import {afterEach,expect,it,vi} from 'vitest';
import type {ScrollFrame} from '@/lib/landing/scroll-controller';

// Exercise the component's actual updater and effects, with deterministic hooks.
// Identity here is React's state bailout contract, not a duplicate policy model.
const harness=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {tag:string;current:unknown}[],effects:[] as (()=>unknown)[],stateIndex:0,refIndex:0,viewport:undefined as ((frame:ScrollFrame)=>void)|undefined}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState(initial:unknown){const i=harness.stateIndex++;if(!(i in harness.states))harness.states[i]=initial;return [harness.states[i],(update:unknown)=>{harness.states[i]=typeof update==='function'?update(harness.states[i]):update;}];},
 useRef(initial:unknown){const i=harness.refIndex++;return harness.refs[i]??(harness.refs[i]={tag:initial===null?'video':'runtime',current:initial});},
 useCallback(callback:unknown){return callback;},
 useEffect(effect:()=>unknown){harness.effects.push(effect);},
}));
vi.mock('@/lib/landing/scroll-controller',()=>({observeLandingViewport:vi.fn((_root:Element,callback:(frame:ScrollFrame)=>void)=>{harness.viewport=callback;return ()=>{};})}));
vi.mock('@/lib/landing/media-readiness-shared',()=>({waitForMediaReadiness:(ready:()=>void)=>{ready();return ()=>{};}}));
import {HeroMotion} from '@/components/landing/HeroMotion';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';

afterEach(()=>{harness.states=[];harness.refs=[];harness.effects=[];harness.viewport=undefined;vi.unstubAllGlobals();vi.clearAllMocks();});
it('bails out on steady scroll state, omits offscreen updates, and still pauses on exit',()=>{
 vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false}));
 vi.stubGlobal('navigator',{connection:Object.assign(new EventTarget(),{saveData:false})});
 vi.stubGlobal('innerHeight',667);
 let mediaTop=0;
 const section={getBoundingClientRect:()=>({top:mediaTop,bottom:mediaTop+100})};
 const container={current:{closest:()=>section,getBoundingClientRect:()=>({top:mediaTop,bottom:mediaTop+100})} as unknown as HTMLDivElement};
 const render=()=>{harness.stateIndex=0;harness.refIndex=0;harness.effects=[];HeroMotion({container,mediaSlot:{current:null},controlsSlot:{current:null},onStatus:()=>{},src:'/clip.mp4',pauseLabel:'Pause',playLabel:'Play'});};
 render();
 const video={muted:false,play:vi.fn(()=>Promise.resolve()),pause:vi.fn(),currentTime:0};
 const videoRef=harness.refs.find(ref=>ref.tag==='video')!;
 videoRef.current=video;
 const cleanup=harness.effects.find(effect=>effect.name==='observeMotion')!() as ()=>void;
 try{
  harness.viewport!({active:true,reducedMotion:false});render();harness.effects.find(effect=>effect.name==='syncPlayback')!();
  expect(video.play).toHaveBeenCalledOnce();
  const steady=harness.states[0];
  for(let i=0;i<60;i++)harness.viewport!({active:true,reducedMotion:false});
  expect(harness.states[0]).toBe(steady);
  expect(vi.mocked(observeLandingViewport).mock.calls[0]).toHaveLength(3);
  expect(vi.mocked(observeLandingViewport).mock.calls[0]![0]).toBe(section);
  expect(vi.mocked(observeLandingViewport).mock.calls[0]![2]).toEqual({offscreen:true});
  // Playback visibility remains the video's own viewport gate, even while
  // the section's heading/control area is visible and the visit stays armed.
  mediaTop=-200;harness.viewport!({active:true,reducedMotion:false});render();harness.effects.find(effect=>effect.name==='syncPlayback')!();
  expect(video.pause).toHaveBeenCalledOnce();video.pause.mockClear();
  harness.viewport!({active:false,reducedMotion:false});render();harness.effects.find(effect=>effect.name==='syncPlayback')!();
  expect(video.pause).toHaveBeenCalledOnce();
  const exited=harness.states[0];harness.viewport!({active:false,reducedMotion:false});
  expect(harness.states[0]).toBe(exited);
 }finally{cleanup();}
});

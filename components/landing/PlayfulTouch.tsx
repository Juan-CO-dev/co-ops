"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {createTouchArbiter,TOUCHES,type TouchSlot} from '@/lib/landing/playful-touches-shared';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';
// One arbiter per mounted document; skipped competition never becomes delayed work.
const arbiter=createTouchArbiter();
export function PlayfulTouch({slot}:{slot:TouchSlot}){
 const item=TOUCHES.find(t=>t.slot===slot)!;
 const ref=useRef<HTMLDivElement>(null);const [loaded,setLoaded]=useState(false);const [playing,setPlaying]=useState(false);
 const ready=useRef(item.id==='checker-peek');const onReady=useRef(()=>{});
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  let timer:ReturnType<typeof setTimeout>|undefined,active=false,reduced=true,disposed=false;
  const stop=()=>{clearTimeout(timer);timer=undefined;arbiter.release(slot);setPlaying(false);};
  const start=(reason:'auto'|'intent')=>{
   if(!ready.current||!active||reduced||document.hidden||!arbiter.claim(slot,reason))return;
   setPlaying(true);timer=setTimeout(stop,item.duration);
  };
  const section=node.closest('section');
  onReady.current=()=>{ready.current=true;start('auto');};
  const intent=()=>start('intent');
  section?.addEventListener('pointerenter',intent);section?.addEventListener('focusin',intent);
  // Two paint frames keep decoration out of hydration and the eager image path.
  let unsubscribe:(()=>void)|undefined,second=0;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
   if(disposed)return;
   unsubscribe=observeLandingViewport(node,frame=>{
    active=frame.active;reduced=frame.reducedMotion||!!(navigator as Navigator & {connection?:{saveData?:boolean}}).connection?.saveData;
    if(!active){stop();return;}
    setLoaded(true);if(reduced)stop();else start('auto');
   });
  });});
  return ()=>{disposed=true;cancelAnimationFrame(first);cancelAnimationFrame(second);unsubscribe?.();stop();section?.removeEventListener('pointerenter',intent);section?.removeEventListener('focusin',intent);};
 },[slot,item.duration]);
 return <div ref={ref} aria-hidden="true" data-playful-slot={slot} data-touch={item.id} data-playing={playing} className="landing-v2-touch-slot" style={{'--touch-duration':`${item.duration}ms`} as CSSProperties}>
  <span className="landing-v2-touch-art">{item.id==='checker-peek'?<span className="landing-v2-touch-checker"/>:loaded&&item.path?
   // eslint-disable-next-line @next/next/no-img-element
   <img src={item.path} alt="" width={item.width} height={item.height} decoding="async" onLoad={()=>onReady.current()}/>:null}</span>
 </div>;
}

"use client";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {HeroMotion} from './HeroMotion';

/** Keep the SSR still mounted while loading playback code only after scroll. */
export function DeferredMotion({children,fallbackLabel,testId='hero-motion',...motion}:{children:ReactNode;fallbackLabel:string;testId?:string;src:string;pauseLabel:string;playLabel:string}){
  const container=useRef<HTMLDivElement>(null),mediaSlot=useRef<HTMLDivElement>(null),controlsSlot=useRef<HTMLDivElement>(null);
  const [Motion,setMotion]=useState<typeof HeroMotion|null>(null);
  const [status,setStatus]=useState({ready:false,failed:false});
  const [posterFailed,setPosterFailed]=useState(false);
  useEffect(()=>{
    let disposed=false;
    const activate=()=>{
      window.removeEventListener('scroll',activate);
      void import('./HeroMotion').then(module=>{if(!disposed)setMotion(()=>module.HeroMotion);}).catch(()=>{});
    };
    window.addEventListener('scroll',activate,{once:true,passive:true});
    // Native scroll/anchor navigation can precede hydration.
    if(window.scrollY>0)activate();
    const image=container.current?.querySelector('img');
    if(image?.complete&&image.naturalWidth===0)setPosterFailed(true);
    return ()=>{disposed=true;window.removeEventListener('scroll',activate);};
  },[]);
  return <div ref={container} data-testid={testId} data-media-ready={status.ready} data-media-failed={status.failed}>
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#FFE560]">
      <div className={posterFailed?'invisible':undefined} onErrorCapture={()=>setPosterFailed(true)}>{children}</div>
      {posterFailed&&<div role="img" aria-label={fallbackLabel} className="absolute inset-0 flex items-center justify-center p-6 text-center">{fallbackLabel}</div>}
      <div ref={mediaSlot} className="contents"/>
    </div>
    <div ref={controlsSlot} className="min-h-[52px]"/>
    {Motion&&<Motion {...motion} container={container} mediaSlot={mediaSlot} controlsSlot={controlsSlot} onStatus={setStatus}/>}
  </div>;
}

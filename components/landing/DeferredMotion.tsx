"use client";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {HeroMotion} from './HeroMotion';

/** Keep the SSR still mounted while loading playback code only after scroll. */
export function DeferredMotion({children,fallbackLabel,testId='hero-motion',...motion}:{children:ReactNode;fallbackLabel:string;testId?:string;src:string;pauseLabel:string;playLabel:string}){
  const container=useRef<HTMLDivElement>(null),mediaSlot=useRef<HTMLDivElement>(null),controlsSlot=useRef<HTMLDivElement>(null);
  const [Motion,setMotion]=useState<typeof HeroMotion|null>(null);
  const [status,setStatus]=useState({ready:false,failed:false});
  const [importState,setImportState]=useState<'idle'|'suppressed'|'loading'|'failed'>('idle');
  const [posterFailed,setPosterFailed]=useState(false);
  useEffect(()=>{
    let disposed=false,attempts=0,loading=false,loaded=false,scrolled=window.scrollY>0;
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const connection=(navigator as Navigator & {connection?:EventTarget & {saveData?:boolean}}).connection;
    const activate=()=>{
      scrolled=true;
      if(disposed||loading||loaded||attempts>=2)return;
      if(preference.matches||connection?.saveData===true){setImportState('suppressed');return;}
      window.removeEventListener('scroll',activate);
      loading=true;attempts++;setImportState('loading');
      void import('./HeroMotion').then(module=>{if(!disposed){loaded=true;setMotion(()=>module.HeroMotion);}}).catch(()=>{
        if(disposed)return;
        loading=false;setImportState('failed');
        if(attempts<2)window.addEventListener('scroll',activate,{passive:true});
      });
    };
    // A preference change can activate an already-scrolled shell, but does not
    // spend the import retry: that requires a subsequent scroll gesture.
    const preferences=()=>{if(scrolled&&attempts===0)activate();};
    window.addEventListener('scroll',activate,{passive:true});
    preference.addEventListener('change',preferences);
    connection?.addEventListener('change',preferences);
    // Native scroll/anchor navigation can precede hydration.
    if(window.scrollY>0)activate();
    const image=container.current?.querySelector('img');
    if(image?.complete&&image.naturalWidth===0)setPosterFailed(true);
    return ()=>{disposed=true;window.removeEventListener('scroll',activate);preference.removeEventListener('change',preferences);connection?.removeEventListener('change',preferences);};
  },[]);
  // motion-state includes import lifecycle; media-ready is the child's bounded
  // paint/readiness gate (not decoded playback), media-failed is playback failure.
  return <div ref={container} data-testid={testId} data-motion-state={importState==='failed'?'failed':status.ready?'ready':importState} data-media-ready={status.ready} data-media-failed={status.failed}>
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#FFE560]">
      <div className={posterFailed?'invisible':undefined} onErrorCapture={()=>setPosterFailed(true)}>{children}</div>
      {posterFailed&&<div role="img" aria-label={fallbackLabel} className="absolute inset-0 flex items-center justify-center p-6 text-center">{fallbackLabel}</div>}
      <div ref={mediaSlot} className="contents"/>
    </div>
    <div ref={controlsSlot} className="min-h-[52px]"/>
    {Motion&&<Motion {...motion} container={container} mediaSlot={mediaSlot} controlsSlot={controlsSlot} onStatus={setStatus}/>}
  </div>;
}

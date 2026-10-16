"use client";
import {useEffect,useState,type ComponentProps} from 'react';
import type {HeroMotion} from './HeroMotion';

/** The poster is the initial experience; playback code is needed only on scroll. */
export function DeferredMotion(props:ComponentProps<typeof HeroMotion>) {
  const [Motion,setMotion]=useState<typeof HeroMotion|null>(null);
  useEffect(()=>{
    let disposed=false;
    const activate=()=>{
      window.removeEventListener('scroll',activate);
      void import('./HeroMotion').then(module=>{if(!disposed)setMotion(()=>module.HeroMotion);}).catch(()=>{});
    };
    window.addEventListener('scroll',activate,{once:true,passive:true});
    // Native scrolling can precede hydration on a slow connection. Preserve
    // that real interaction rather than requiring the visitor to scroll twice.
    if(window.scrollY>0)activate();
    return ()=>{disposed=true;window.removeEventListener('scroll',activate);};
  },[]);
  if(Motion)return <Motion {...props} initialTriggered/>;
  return <div data-testid={props.testId ?? 'hero-motion'}>
    <div className="relative overflow-hidden rounded-2xl bg-[#FFE560]">{props.children}</div>
    <div className="min-h-[52px]"/>
  </div>;
}

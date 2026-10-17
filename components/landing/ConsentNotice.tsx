"use client";
import {useEffect,useRef,useState} from 'react';
import type {ConsentChoice} from '@/lib/landing/consent-shared';
export interface ConsentLabels { notice:string; accept:string; reject:string; settings:string; withdraw:string; privacy:string; language:'en'|'es' }
export function ConsentNotice({choice,labels,onChoose}:{choice:ConsentChoice;labels:ConsentLabels;onChoose:(choice:'accepted'|'rejected')=>void}) {
  const [open,setOpen]=useState<boolean|null>(null);
  const expanded=open??choice==='unknown';
  const [flow,setFlow]=useState(false);
  const ref=useRef<HTMLElement>(null);
  const probe=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const root=ref.current?.closest<HTMLElement>('.landing-v2');
    const measure=()=>{
      const rem=parseFloat(getComputedStyle(document.documentElement).fontSize);
      const viewport=window.visualViewport;
      const expanded=rem>=24 || innerWidth<330 || (viewport?.scale??1)>1.5 || (viewport?.height??innerHeight)<500 || (innerWidth>=768 && (viewport?.height??innerHeight)<800);
      setFlow(expanded);
      root?.style.setProperty('--landing-dock-height',expanded?'0px':`${ref.current?.getBoundingClientRect().height??0}px`);
      root?.setAttribute('data-consent-flow',String(expanded));
    };
    const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);
    if(ref.current)observer?.observe(ref.current);
    if(probe.current)observer?.observe(probe.current);
    measure();window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
    return ()=>{observer?.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);root?.style.removeProperty('--landing-dock-height');root?.removeAttribute('data-consent-flow');};
  },[]);
  const content=<aside ref={ref} className="landing-v2-consent" data-flow={flow} data-expanded={expanded} aria-label={labels.settings}>
    <span ref={probe} className="landing-v2-rem-probe" aria-hidden="true"/>
    <button type="button" onClick={()=>setOpen(!expanded)} aria-expanded={expanded}>{labels.settings}</button>
    {expanded&&<div data-landing-consent>
      <p>{labels.notice}</p>
      <a href={`/privacy?lang=${labels.language}`}>{labels.privacy}</a>
      <div className="landing-v2-consent-actions">
        <button type="button" onClick={()=>{onChoose('accepted');setOpen(false);}}>{labels.accept}</button>
        <button type="button" onClick={()=>{onChoose('rejected');setOpen(false);}}>{choice==='accepted'?labels.withdraw:labels.reject}</button>
      </div>
    </div>}
  </aside>;
  return content;
}

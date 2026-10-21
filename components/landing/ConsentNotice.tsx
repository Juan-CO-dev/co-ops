"use client";
import {useEffect,useRef,useState} from 'react';
import type {ConsentChoice} from '@/lib/landing/consent-shared';
export interface ConsentLabels { notice:string; accept:string; reject:string; settings:string; withdraw:string; privacy:string; language:'en'|'es' }
/** Until consent is answered the notice is exactly as it always was (docked, collapsible).
 * Once answered it leaves the screen entirely (v4.2); the footer's / privacy page's
 * "Privacy settings" control reopens the same notice, with the same wording and controls. */
export function ConsentNotice({choice,labels,onChoose,open,setOpen,focusRequest=0}:{choice:ConsentChoice;labels:ConsentLabels;onChoose:(choice:'accepted'|'rejected')=>void;open:boolean;setOpen:(open:boolean)=>void;focusRequest?:number}) {
  const expanded=open;
  const gone=choice!=='unknown'&&!expanded;
  const [flow,setFlow]=useState(false);
  const ref=useRef<HTMLElement>(null);
  const probe=useRef<HTMLSpanElement>(null);
  const toggle=useRef<HTMLButtonElement>(null);
  const remeasure=useRef<()=>void>(()=>{});
  // Reopened from elsewhere on the page: move focus into the notice (this also brings an
  // in-flow notice into view).
  useEffect(()=>{if(focusRequest>0)toggle.current?.focus();},[focusRequest]);
  useEffect(()=>{remeasure.current();},[gone,expanded]);
  useEffect(()=>{
    const root=ref.current?.closest<HTMLElement>('.landing-v2');
    const measure=()=>{
      const rem=parseFloat(getComputedStyle(document.documentElement).fontSize);
      const viewport=window.visualViewport;
      const expanded=rem>=24 || innerWidth<330 || (viewport?.scale??1)>1.5 || (viewport?.height??innerHeight)<500 || (innerWidth>=768 && (viewport?.height??innerHeight)<800);
      setFlow(expanded);
      // A notice that has left the screen reserves nothing.
      root?.style.setProperty('--landing-dock-height',expanded||ref.current?.hidden?'0px':`${ref.current?.getBoundingClientRect().height??0}px`);
      root?.setAttribute('data-consent-flow',String(expanded));
    };
    const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);
    if(ref.current)observer?.observe(ref.current);
    if(probe.current)observer?.observe(probe.current);
    remeasure.current=measure;
    measure();window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
    return ()=>{remeasure.current=()=>{};observer?.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);root?.style.removeProperty('--landing-dock-height');root?.removeAttribute('data-consent-flow');};
  },[]);
  const content=<aside ref={ref} id="landing-consent-notice" className="landing-v2-consent" data-flow={flow} data-expanded={expanded} hidden={gone} aria-label={labels.settings}>
    <span ref={probe} className="landing-v2-rem-probe" aria-hidden="true"/>
    <button ref={toggle} type="button" onClick={()=>setOpen(!expanded)} aria-expanded={expanded}>{labels.settings}</button>
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

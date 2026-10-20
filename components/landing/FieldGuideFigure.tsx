"use client";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {TexturePhoto} from './CraveScene';
import {fieldGuideAnchors} from '@/lib/landing/crave-motion-shared';
import {foundCount,GUIDE_SCROLL_THRESHOLDS,leaderPath,nextUnfound,scrollFoundTarget} from '@/lib/landing/field-guide-shared';
import {prefersCalm,subscribeCalm} from '@/lib/landing/motion-policy-shared';

type AnchorId=(typeof fieldGuideAnchors)[number]['id'];
interface Pickup {src:string;width:number;height:number}
interface Props {labels:Record<AnchorId,string>;groupLabel:string;counter:string;crossAlt:string;caption:string;pickups:Record<AnchorId,Pickup>;
  /** The order action shown once all six are found (static modes: at once). Its box is reserved, so nothing shifts. */
  cta?:ReactNode;
  /** The action's label: an invisible twin of the button holds its exact height from the server render on. */
  ctaLabel?:string}

/** One word's leader line draws, holds and fades in this time; then the word is collected. */
const STEP_MS=1100;
/** The scroll finds at most one more word per beat, so each draw stays readable. */
const ADVANCE_MS=350;

/** Words (each with its pixel pickup) sit above the cross-section. Scrolling through the guide
 * finds them one by one (forward only: scrolling back never un-finds); tapping a word finds it at
 * once. A found word's leader line draws to its ingredient, holds, fades, and the word is
 * "collected"; six of six reveals the order action. Progress comes from an IntersectionObserver
 * on the photo (no scroll listener, no per-frame layout reads). Reduced motion / Save-Data show
 * every line at once with all six found; without JS the words stay a list. */
export function FieldGuideFigure({labels,groupLabel,counter,crossAlt,caption,pickups,cta,ctaLabel}:Props) {
  const root=useRef<HTMLDivElement>(null),photo=useRef<HTMLDivElement>(null);
  const words=useRef<Partial<Record<AnchorId,HTMLLIElement|null>>>({});
  const [paths,setPaths]=useState<Partial<Record<AnchorId,{d:string;x:number;y:number}>>>({});
  // Bit masks over fieldGuideAnchors: found (by scroll or tap) and still drawing its line.
  const [found,setFound]=useState(0);
  const [drawing,setDrawing]=useState(0);
  const findRef=useRef<(index:number)=>void>(()=>{});
  const [mode,setMode]=useState<'list'|'static'|'motion'>('list');
  useEffect(()=>{
    const element=root.current,frame=photo.current;if(!element||!frame)return;
    const measure=()=>{
      const box=element.getBoundingClientRect(),pic=frame.getBoundingClientRect();
      const next:Partial<Record<AnchorId,{d:string;x:number;y:number}>>={};
      for(const anchor of fieldGuideAnchors){
        const word=words.current[anchor.id]?.getBoundingClientRect();if(!word)continue;
        const to={x:pic.left-box.left+anchor.x*pic.width,y:pic.top-box.top+anchor.y*pic.height};
        next[anchor.id]={d:leaderPath({x:word.left+word.width/2-box.left,y:word.bottom-box.top},to),...to};
      }
      setPaths(next);
    };
    const resize=new ResizeObserver(measure);resize.observe(element);resize.observe(frame);measure();
    const total=fieldGuideAnchors.length,all=(1<<total)-1;
    if(prefersCalm()||typeof IntersectionObserver==='undefined'){
      setMode('static');setFound(all);return ()=>resize.disconnect();
    }
    setMode('motion');
    let mask=0,target=0,advance:ReturnType<typeof setTimeout>|undefined,calm=false;
    const draws=new Set<ReturnType<typeof setTimeout>>();
    const find=(index:number)=>{
      if(calm||index<0||index>=total||mask&(1<<index))return;
      mask|=1<<index;setFound(mask);setDrawing(value=>value|(1<<index));
      const timer=setTimeout(()=>{draws.delete(timer);setDrawing(value=>value&~(1<<index));},STEP_MS);
      draws.add(timer);
    };
    findRef.current=find;
    // Scroll progress only sets a target; one word per beat walks up to it.
    const step=()=>{
      advance=undefined;
      if(calm||foundCount(mask,total)>=target)return;
      find(nextUnfound(mask,total));
      if(foundCount(mask,total)<target)advance=setTimeout(step,ADVANCE_MS);
    };
    const observer=new IntersectionObserver(entries=>{
      const entry=entries[entries.length-1];if(!entry)return;
      const next=scrollFoundTarget(entry.intersectionRatio,entry.boundingClientRect.top,total);
      if(next<=target)return;
      target=next;
      if(target>=total)observer.disconnect();
      if(!advance)step();
    },{threshold:GUIDE_SCROLL_THRESHOLDS});
    observer.observe(frame);
    // Turning on reduced motion or Save-Data mid-visit switches to the complete static view.
    const unsubscribe=subscribeCalm(next=>{if(!next)return;calm=true;observer.disconnect();clearTimeout(advance);for(const timer of draws)clearTimeout(timer);draws.clear();mask=all;setFound(all);setDrawing(0);setMode('static');});
    return ()=>{resize.disconnect();observer.disconnect();clearTimeout(advance);for(const timer of draws)clearTimeout(timer);unsubscribe();findRef.current=()=>{};};
  },[]);
  const total=fieldGuideAnchors.length;
  const collectedMask=found&~drawing;
  const collected=foundCount(collectedMask,total);
  const complete=mode==='static'||collected>=total;
  return <div ref={root} className="landing-v3-guide" data-guide-mode={mode} data-guide-found={foundCount(found,total)}>
    <div role="group" aria-labelledby="field-guide-labels-title">
    <span id="field-guide-labels-title" className="sr-only">{groupLabel}</span>
    <ul className="landing-v3-guide-words">
      {fieldGuideAnchors.map((anchor,index)=>{
        const word=<>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pickups[anchor.id].src} width={pickups[anchor.id].width} height={pickups[anchor.id].height} alt="" aria-hidden="true" loading="lazy" decoding="async" className="landing-v3-pixel"/>
          <span>{labels[anchor.id]}</span>
        </>;
        return <li key={anchor.id} ref={node=>{words.current[anchor.id]=node;}} data-anatomy-label={anchor.id} data-found={Boolean(found&(1<<index))} data-collected={Boolean(collectedMask&(1<<index))} data-active={Boolean(drawing&(1<<index))}>
          {/* While the game runs a word is a button: tapping it finds it at once. */}
          {mode==='motion'?<button type="button" className="landing-v4-guide-word" onClick={()=>findRef.current(index)}>{word}</button>:word}
        </li>;
      })}
    </ul>
    </div>
    <p className="landing-v3-guide-count" aria-hidden="true" hidden={mode!=='motion'}>{counter.replace('{count}',String(collected)).replace('{total}',String(total))}</p>
    <figure className="landing-v3-guide-figure">
      <div ref={photo}><TexturePhoto kind="crossSection" alt={crossAlt}/></div>
      <figcaption>{caption}</figcaption>
    </figure>
    {/* One constant box from the server render on. An invisible, inert, disabled twin of the action
        (same element, class and words) sits in the slot's only grid cell from the start, so the box is
        the button's own height at any text size; at six-of-six the real action takes the same cell.
        It never changes height (no layout shift). Without JS the page's noscript rule removes it. */}
    {cta&&<div className="landing-v4-guide-cta" data-guide-cta data-ready={mode!=='list'&&complete}>
      <button type="button" disabled tabIndex={-1} aria-hidden="true" inert className="landing-v3-cta landing-v4-guide-twin" data-guide-twin>{ctaLabel}</button>
      {mode!=='list'&&complete?cta:null}
    </div>}
    <svg aria-hidden="true" className="landing-v3-guide-lines">
      {fieldGuideAnchors.map((anchor,index)=>{
        const path=paths[anchor.id];if(!path||mode==='list')return null;
        const state=mode==='static'?'shown':drawing&(1<<index)?'drawing':'idle';
        return <g key={anchor.id} data-line={anchor.id} data-state={state}><path d={path.d} pathLength={1}/><circle cx={path.x} cy={path.y} r="6"/></g>;
      })}
    </svg>
  </div>;
}

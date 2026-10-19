"use client";
import {useEffect,useRef,useState} from 'react';
import {TexturePhoto} from './CraveScene';
import {fieldGuideAnchors} from '@/lib/landing/crave-motion-shared';
import {leaderPath} from '@/lib/landing/field-guide-shared';
import {prefersCalm,subscribeCalm} from '@/lib/landing/motion-policy-shared';

type AnchorId=(typeof fieldGuideAnchors)[number]['id'];
interface Pickup {src:string;width:number;height:number}
interface Props {labels:Record<AnchorId,string>;groupLabel:string;counter:string;crossAlt:string;caption:string;pickups:Record<AnchorId,Pickup>}

const STEP_MS=1100;

/** Words (each with its pixel pickup) sit above the cross-section. On arrival one leader
 * line at a time draws from a word to its ingredient, holds, fades, and the word is
 * "collected". Reduced motion / Save-Data show every line at once; without JS the words stay a list. */
export function FieldGuideFigure({labels,groupLabel,counter,crossAlt,caption,pickups}:Props) {
  const root=useRef<HTMLDivElement>(null),photo=useRef<HTMLDivElement>(null);
  const words=useRef<Partial<Record<AnchorId,HTMLLIElement|null>>>({});
  const [paths,setPaths]=useState<Partial<Record<AnchorId,{d:string;x:number;y:number}>>>({});
  const [active,setActive]=useState(-1);
  const [collected,setCollected]=useState(0);
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
    if(prefersCalm()||typeof IntersectionObserver==='undefined'){
      setMode('static');setCollected(fieldGuideAnchors.length);return ()=>resize.disconnect();
    }
    setMode('motion');
    let timer:ReturnType<typeof setTimeout>|undefined,started=false;
    const run=(index:number)=>{
      if(index>=fieldGuideAnchors.length){setActive(-1);return;}
      setActive(index);
      timer=setTimeout(()=>{setCollected(index+1);run(index+1);},STEP_MS);
    };
    const observer=new IntersectionObserver(entries=>{if(!started&&entries.some(entry=>entry.isIntersecting)){started=true;observer.disconnect();run(0);}},{threshold:.45});
    observer.observe(frame);
    // Turning on reduced motion or Save-Data mid-visit switches to the complete static view.
    const unsubscribe=subscribeCalm(calm=>{if(!calm)return;started=true;observer.disconnect();clearTimeout(timer);setActive(-1);setCollected(fieldGuideAnchors.length);setMode('static');});
    return ()=>{resize.disconnect();observer.disconnect();clearTimeout(timer);unsubscribe();};
  },[]);
  const total=fieldGuideAnchors.length;
  return <div ref={root} className="landing-v3-guide" data-guide-mode={mode}>
    <div role="group" aria-labelledby="field-guide-labels-title">
    <span id="field-guide-labels-title" className="sr-only">{groupLabel}</span>
    <ul className="landing-v3-guide-words">
      {fieldGuideAnchors.map((anchor,index)=><li key={anchor.id} ref={node=>{words.current[anchor.id]=node;}} data-anatomy-label={anchor.id} data-collected={index<collected} data-active={index===active}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pickups[anchor.id].src} width={pickups[anchor.id].width} height={pickups[anchor.id].height} alt="" aria-hidden="true" loading="lazy" decoding="async" className="landing-v3-pixel"/>
        <span>{labels[anchor.id]}</span>
      </li>)}
    </ul>
    </div>
    <p className="landing-v3-guide-count" aria-hidden="true" hidden={mode!=='motion'}>{counter.replace('{count}',String(collected)).replace('{total}',String(total))}</p>
    <figure className="landing-v3-guide-figure">
      <div ref={photo}><TexturePhoto kind="crossSection" alt={crossAlt}/></div>
      <figcaption>{caption}</figcaption>
    </figure>
    <svg aria-hidden="true" className="landing-v3-guide-lines">
      {fieldGuideAnchors.map((anchor,index)=>{
        const path=paths[anchor.id];if(!path||mode==='list')return null;
        const state=mode==='static'?'shown':index===active?'drawing':'idle';
        return <g key={anchor.id} data-line={anchor.id} data-state={state}><path d={path.d} pathLength={1}/><circle cx={path.x} cy={path.y} r="6"/></g>;
      })}
    </svg>
  </div>;
}

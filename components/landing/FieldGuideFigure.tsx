"use client";
import {useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {TexturePhoto} from './CraveScene';
import {fieldGuideAnchors} from '@/lib/landing/crave-motion-shared';
import {findsNow,foundCount,GUIDE_FLUSH_AT,GUIDE_STEP_AT,GUIDE_WORDS_ABOVE,guideStepRootMargin,leaderPath,leaderStart,stepReached,stepTarget} from '@/lib/landing/field-guide-shared';
import {prefersCalm,subscribeCalm} from '@/lib/landing/motion-policy-shared';

type AnchorId=(typeof fieldGuideAnchors)[number]['id'];
interface Pickup {src:string;width:number;height:number}
interface Props {labels:Record<AnchorId,string>;groupLabel:string;counter:string;crossAlt:string;caption:string;pickups:Record<AnchorId,Pickup>;
  /** The order action shown once all six are found (static modes: at once). Its box is reserved, so nothing shifts. */
  cta?:ReactNode;
  /** The action's label: an invisible twin of the button holds its exact height from the server render on. */
  ctaLabel?:string}

/** One word's leader line draws in this time; the word is then collected. */
const STEP_MS=1100;
/** The scroll finds at most one more word per beat, so each draw stays readable. */
const ADVANCE_MS=350;

/** Words (each with its pixel pickup) frame the cross-section: the first three above it, the last
 * three below it, each pointing into its own half of the photo (no leader crosses a word). Scrolling through the guide
 * finds them one by one (forward only: scrolling back never un-finds); tapping a word finds it at
 * once. A found word's leader line draws to its ingredient and stays until the next word is
 * found, and the word is "collected"; six of six shows every line and reveals the order action.
 * With full motion and a tall enough screen the guide PINS while the reader scrolls a runway, and
 * the six finds are paced evenly along it (GUIDE_STEP_AT). Progress comes from one
 * IntersectionObserver on six invisible step markers (no scroll listener, no per-frame layout
 * reads). Reduced motion / Save-Data show every line at once with all six found and no runway;
 * without JS the words stay a list and the page's noscript rule (GUIDE_NO_JS_CSS) drops the pin. */
export function FieldGuideFigure({labels,groupLabel,counter,crossAlt,caption,pickups,cta,ctaLabel}:Props) {
  const root=useRef<HTMLDivElement>(null),pin=useRef<HTMLDivElement>(null),photo=useRef<HTMLDivElement>(null);
  const steps=useRef<(HTMLSpanElement|null)[]>([]),flushLine=useRef<HTMLSpanElement>(null);
  const words=useRef<Partial<Record<AnchorId,HTMLLIElement|null>>>({});
  const [paths,setPaths]=useState<Partial<Record<AnchorId,{d:string;x:number;y:number}>>>({});
  // Bit masks over fieldGuideAnchors: found (by scroll or tap) and still drawing its line.
  const [found,setFound]=useState(0);
  const [drawing,setDrawing]=useState(0);
  // The most recent find: its leader line stays drawn until the next word is found.
  const [latest,setLatest]=useState(-1);
  const findRef=useRef<(index:number)=>void>(()=>{});
  const [mode,setMode]=useState<'list'|'static'|'motion'>('list');
  useEffect(()=>{
    // Lines are drawn in the pinned box's own coordinates, so pinning never moves them.
    const element=pin.current,frame=photo.current;if(!element||!frame)return;
    const measure=()=>{
      const box=element.getBoundingClientRect(),pic=frame.getBoundingClientRect();
      const next:Partial<Record<AnchorId,{d:string;x:number;y:number}>>={};
      for(const anchor of fieldGuideAnchors){
        const word=words.current[anchor.id]?.getBoundingClientRect();if(!word)continue;
        const to={x:pic.left-box.left+anchor.x*pic.width,y:pic.top-box.top+anchor.y*pic.height};
        const from=leaderStart(word,pic);
        next[anchor.id]={d:leaderPath({x:from.x-box.left,y:from.y-box.top},to),...to};
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
      mask|=1<<index;setFound(mask);setLatest(index);setDrawing(value=>value|(1<<index));
      // Found by taps alone: nothing is left for scrolling to find.
      if(mask===all)stop();
      const timer=setTimeout(()=>{draws.delete(timer);setDrawing(value=>value&~(1<<index));},STEP_MS);
      draws.add(timer);
    };
    findRef.current=find;
    // Scroll progress only sets a target; one word per beat walks up to it.
    const step=()=>{
      advance=undefined;
      if(calm)return;
      for(const index of findsNow(mask,target,total,false))find(index);
      if(foundCount(mask,total)<target)advance=setTimeout(step,ADVANCE_MS);
    };
    // The flush line (still pinned, past the last find): every queued word lands at once, collected,
    // so no stagger carries on after the photo scrolls away. Cancels the walk and the draw timers.
    const flush=()=>{
      if(calm)return;
      clearTimeout(advance);advance=undefined;
      for(const timer of draws)clearTimeout(timer);
      draws.clear();
      for(const index of findsNow(mask,target,total,true))mask|=1<<index;
      target=total;setFound(mask);setDrawing(0);setLatest(-1);stop();
    };
    // Each step marker reports once it reaches the top band; reaching marker k makes k+1 words due.
    // The band is in pixels of the current viewport height, so the observer is rebuilt (debounced)
    // when that height changes; a fresh observer re-reports every marker, and the target only rises.
    let done=false,bandHeight=0,rebuild:ReturnType<typeof setTimeout>|undefined;
    // The observer stays on until every word is found (find() and flush() stop it), so the flush
    // line (and the guide leaving the band) can still report while the last words are queued.
    const report=(entries:IntersectionObserverEntry[])=>{
      let next=target,flushed=false;
      for(const entry of entries){
        const reached=stepReached(entry.isIntersecting,entry.boundingClientRect.bottom);
        if(entry.target===flushLine.current){flushed||=reached;continue;}
        // The guide itself covers the band all through the runway; it leaves it with its bottom above
        // the viewport only when the reader jumps clean past (markers that never touch the band
        // report nothing), which flushes too.
        if(entry.target===root.current){flushed||=!entry.isIntersecting&&entry.boundingClientRect.bottom<0;continue;}
        next=stepTarget(next,steps.current.indexOf(entry.target as HTMLSpanElement),reached,total);
      }
      if(flushed)return flush();
      if(next<=target)return;
      target=next;
      if(!advance)step();
    };
    let observer:IntersectionObserver|undefined;
    const watch=()=>{
      rebuild=undefined;
      if(done||calm||innerHeight===bandHeight)return;
      bandHeight=innerHeight;observer?.disconnect();
      observer=new IntersectionObserver(report,{rootMargin:guideStepRootMargin(bandHeight)});
      for(const marker of [...steps.current,flushLine.current,root.current])if(marker)observer.observe(marker);
    };
    const viewportChanged=()=>{clearTimeout(rebuild);rebuild=setTimeout(watch,150);};
    function stop(){done=true;observer?.disconnect();clearTimeout(rebuild);window.removeEventListener('resize',viewportChanged);}
    watch();
    window.addEventListener('resize',viewportChanged);
    // Turning on reduced motion or Save-Data mid-visit switches to the complete static view.
    const unsubscribe=subscribeCalm(next=>{if(!next)return;calm=true;stop();clearTimeout(advance);for(const timer of draws)clearTimeout(timer);draws.clear();mask=all;setFound(all);setDrawing(0);setLatest(-1);setMode('static');});
    return ()=>{resize.disconnect();stop();clearTimeout(advance);for(const timer of draws)clearTimeout(timer);unsubscribe();findRef.current=()=>{};};
  },[]);
  const total=fieldGuideAnchors.length;
  const collectedMask=found&~drawing;
  const collected=foundCount(collectedMask,total);
  const complete=mode==='static'||collected>=total;
  const wordItem=(anchor:(typeof fieldGuideAnchors)[number],index:number)=>{
    const word=<>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={pickups[anchor.id].src} width={pickups[anchor.id].width} height={pickups[anchor.id].height} alt="" aria-hidden="true" loading="lazy" decoding="async" className="landing-v3-pixel"/>
      <span>{labels[anchor.id]}</span>
    </>;
    return <li key={anchor.id} ref={node=>{words.current[anchor.id]=node;}} data-anatomy-label={anchor.id} data-found={Boolean(found&(1<<index))} data-collected={Boolean(collectedMask&(1<<index))} data-active={Boolean(drawing&(1<<index))}>
      {/* While the game runs a word is a button: tapping it finds it at once. */}
      {mode==='motion'?<button type="button" className="landing-v4-guide-word" onClick={()=>findRef.current(index)}>{word}</button>:word}
    </li>;
  };
  return <div ref={root} className="landing-v3-guide" data-guide-mode={mode} data-guide-found={foundCount(found,total)}>
    <div ref={pin} className="landing-v5-guide-pin">
    <div role="group" aria-labelledby="field-guide-labels-title" className="landing-v6-guide-board">
    <span id="field-guide-labels-title" className="sr-only">{groupLabel}</span>
    {/* The first three words sit above the photo, the last three below it. */}
    <ul className="landing-v3-guide-words" data-guide-words="above">{fieldGuideAnchors.slice(0,GUIDE_WORDS_ABOVE).map((anchor,index)=>wordItem(anchor,index))}</ul>
    <figure className="landing-v3-guide-figure">
      {/* While pinned the slot takes the height left over and the photo is the largest 2:3 box
          inside it, so the whole cross-section (every ingredient anchor) stays on screen. */}
      <div className="landing-v5-guide-slot"><div ref={photo} className="landing-v5-guide-photo"><TexturePhoto kind="crossSection" alt={crossAlt}/></div></div>
      <ul className="landing-v3-guide-words" data-guide-words="below">{fieldGuideAnchors.slice(GUIDE_WORDS_ABOVE).map((anchor,offset)=>wordItem(anchor,GUIDE_WORDS_ABOVE+offset))}</ul>
      <p className="landing-v3-guide-count" aria-hidden="true" hidden={mode!=='motion'}>{counter.replace('{count}',String(collected)).replace('{total}',String(total))}</p>
      <figcaption>{caption}</figcaption>
    </figure>
    </div>
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
        // Static modes and six-of-six show every line; while finding, the latest find's line only.
        const state=complete?'shown':index===latest?'drawing':'idle';
        return <g key={anchor.id} data-line={anchor.id} data-state={state}><path d={path.d} pathLength={1}/><circle cx={path.x} cy={path.y} r="6"/></g>;
      })}
    </svg>
    </div>
    {/* The runway the pinned guide is scrolled through, and its six invisible step markers. */}
    <div className="landing-v5-guide-runway" aria-hidden="true"/>
    {GUIDE_STEP_AT.map((at,index)=><span key={index} ref={node=>{steps.current[index]=node;}} aria-hidden="true" data-guide-step={index} className="landing-v5-guide-step" style={{'--guide-step':at} as CSSProperties}/>)}
    <span ref={flushLine} aria-hidden="true" data-guide-flush className="landing-v5-guide-step" style={{'--guide-step':GUIDE_FLUSH_AT} as CSSProperties}/>
  </div>;
}

"use client";
import {useEffect,useRef,useState} from 'react';
import {textureMedia} from '@/lib/landing/media';
import {canAnimateCrave,craveProgress} from '@/lib/landing/crave-motion-shared';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';

/** Attach after 10% enters view; a sliver below the desktop hero is not a media request.
 * `sizes` overrides the shared hint where a photo paints wider (the pinned crunch story). */
export function TexturePhoto({kind,alt,sizes}:{kind:keyof typeof textureMedia;alt:string;sizes?:string}) {
  const ref=useRef<HTMLDivElement>(null);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    if(typeof IntersectionObserver==='undefined'){setLoaded(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>=0.1)){setLoaded(true);observer.disconnect();}},{threshold:0.1});
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  const media=textureMedia[kind];
  const picture=<img {...media} sizes={sizes??media.sizes} alt={alt} loading="lazy" fetchPriority="low"/>;
  return <div ref={ref} data-landing-photo data-texture-photo={kind} className="landing-v2-texture-photo">{loaded?picture:<noscript>{picture}</noscript>}</div>;
}
/** Pinned, each photo covers the full-height story window: about 640px wide in the laptop column. */
const CRAVE_SIZES='(min-width: 1024px) 640px, (min-width: 768px) 90vw, calc(100vw - 44px)';
export function CraveScene({textureAlt,crossAlt,stillLabel,motionLabel,captions}:{textureAlt:string;crossAlt:string;stillLabel:string;motionLabel:string;captions:readonly [string,string]}) {
  const ref=useRef<HTMLDivElement>(null);
  const [still,setStill]=useState(false);
  const [enhanced,setEnhanced]=useState(false);
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    setEnhanced(true);
    const native=CSS.supports('animation-timeline: view()');
    element.dataset.timeline=native?'css':'raf';
    return observeLandingViewport(element,({active,reducedMotion})=>{
      const saveData=Boolean((navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData);
      const enabled=canAnimateCrave({still,reducedMotion,saveData,height:window.visualViewport?.height??innerHeight});
      element.dataset.motion=String(enabled);
      element.dataset.active=String(active);
      if(active&&enabled&&!native){const box=element.getBoundingClientRect();element.style.setProperty('--crave-progress',String(craveProgress(box.top,box.height,innerHeight)));}
      if(!enabled)element.style.removeProperty('--crave-progress');
    },{offscreen:true});
  },[still]);
  return <div ref={ref} data-crave-stage data-motion="pending" className="landing-v2-crave-stage">
    <noscript><style>{`.landing-v2 .landing-v2-crave-stage[data-motion="pending"] { height:auto; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-sticky { position:static; height:auto; display:block; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-window { width:100%; max-width:480px; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-track { display:grid; height:auto; transform:none; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-track > div { height:auto; aspect-ratio:2 / 3; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-track img { height:auto; aspect-ratio:2 / 3; object-fit:contain; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v3-crave-captions { display:block; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v3-crave-captions p[data-beat] { margin:0 0 8px; visibility:visible; }`}</style></noscript>
    <div className="landing-v2-crave-sticky">
      <div className="landing-v2-crave-control-slot">{enhanced?<button type="button" aria-pressed={still} onClick={()=>setStill(value=>!value)} className="landing-v2-crave-control">{still?motionLabel:stillLabel}</button>:<span aria-hidden="true" style={{visibility:'hidden'}} className="landing-v2-crave-control">{stillLabel}</span>}</div>
      {/* What you are looking at, per beat: crossfades with the scroll; static modes list both. */}
      <div className="landing-v3-crave-captions">{captions.map((caption,index)=><p key={index} data-beat={index}>{caption}</p>)}</div>
      <div className="landing-v2-crave-window"><div className="landing-v2-crave-track">
        <TexturePhoto kind="texture" alt={textureAlt} sizes={CRAVE_SIZES}/><TexturePhoto kind="crossSection" alt={crossAlt} sizes={CRAVE_SIZES}/>
      </div></div>
    </div>
  </div>;
}

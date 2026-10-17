"use client";
import {useEffect,useRef,useState} from 'react';
import {textureMedia} from '@/lib/landing/media';
import {canAnimateCrave,craveProgress} from '@/lib/landing/crave-motion-shared';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';

/** Attach after 10% enters view; a sliver below the desktop hero is not a media request. */
export function TexturePhoto({kind,alt}:{kind:keyof typeof textureMedia;alt:string}) {
  const ref=useRef<HTMLDivElement>(null);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    if(typeof IntersectionObserver==='undefined'){setLoaded(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>=0.1)){setLoaded(true);observer.disconnect();}},{threshold:0.1});
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  const media=textureMedia[kind];
  const picture=<img {...media} alt={alt} loading="lazy" fetchPriority="low"/>;
  return <div ref={ref} data-landing-photo data-texture-photo={kind} className="landing-v2-texture-photo">{loaded?picture:<noscript>{picture}</noscript>}</div>;
}
export function CraveScene({textureAlt,crossAlt,stillLabel,motionLabel}:{textureAlt:string;crossAlt:string;stillLabel:string;motionLabel:string}) {
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
    <noscript><style>{`.landing-v2 .landing-v2-crave-stage[data-motion="pending"] { height:auto; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-sticky { position:static; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-window { width:100%; } .landing-v2 .landing-v2-crave-stage[data-motion="pending"] .landing-v2-crave-track { display:grid; transform:none; }`}</style></noscript>
    <div className="landing-v2-crave-sticky">
      <div className="landing-v2-crave-control-slot">{enhanced?<button type="button" aria-pressed={still} onClick={()=>setStill(value=>!value)} className="landing-v2-crave-control">{still?motionLabel:stillLabel}</button>:<span aria-hidden="true" style={{visibility:'hidden'}} className="landing-v2-crave-control">{stillLabel}</span>}</div>
      <div className="landing-v2-crave-window"><div className="landing-v2-crave-track">
        <TexturePhoto kind="texture" alt={textureAlt}/><TexturePhoto kind="crossSection" alt={crossAlt}/>
      </div></div>
    </div>
  </div>;
}

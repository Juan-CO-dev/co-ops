"use client";
import {useRef} from 'react';

/** No source or request until the visitor explicitly plays this illustrated asset. */
export function IllustratedSpin({src,label,playLabel}:{src:string;label:string;playLabel:string}) {
  const video=useRef<HTMLVideoElement>(null);
  return <div className="landing-v2-spin">
    <p>{label}</p>
    <video ref={video} aria-label={label} controls muted playsInline preload="none"/>
    <button type="button" onClick={()=>{
      const element=video.current;
      if(!element)return;
      if(!element.getAttribute('src'))element.src=src;
      void element.play().catch(()=>{/* Native controls remain available for retry. */});
    }}>{playLabel}</button>
  </div>;
}

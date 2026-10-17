"use client";
import {useRef,useState} from 'react';
import {flushSync} from 'react-dom';

/** No source or request until the visitor explicitly plays this illustrated asset. */
export function IllustratedSpin({src,label,playLabel}:{src:string;label:string;playLabel:string}) {
  const video=useRef<HTMLVideoElement>(null);
  const [attached,setAttached]=useState(false);
  return <div className="landing-v2-spin">
    <p>{label}</p>
    {attached ? <video ref={video} aria-label={label} controls muted playsInline preload="none"/> : <div className="landing-v2-spin-placeholder" aria-hidden="true"/>}
    <button type="button" onClick={()=>{
      // Mount in this user gesture so native playback retains user activation.
      if(!attached)flushSync(()=>setAttached(true));
      const element=video.current;
      if(!element)return;
      if(!element.getAttribute('src'))element.src=src;
      void element.play().catch(()=>{/* Native controls remain available for retry. */});
    }}>{playLabel}</button>
  </div>;
}

"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';

/** Native no-JS fallback; enhanced pages attach URLs only at the viewport,
 * rather than relying on Chrome's much larger native lazy prefetch distance. */
export function LineupPhoto({src,small,width,height,alt,focusY}:{src:string;small:string;width:number;height:number;alt:string;
  /** The sub's vertical centre (0–1); the stage and roster crops convert it to object-position (CSS). */
  focusY:number}) {
  const ref=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
    });
    if(ref.current)observer.observe(ref.current);
    return ()=>observer.disconnect();
  },[]);
  const picture=<picture>
    <source type="image/webp" srcSet={`${small} 480w, ${src} 750w`} sizes="280px"/>
    <img src={src} width={width} height={height} sizes="280px" loading="lazy" fetchPriority="low" alt={alt} className="h-auto w-full"/>
  </picture>;
  return <div data-landing-photo data-focal-y={focusY} ref={ref} style={{aspectRatio:`${width}/${height}`,'--focal-y':focusY} as CSSProperties}>
    {visible ? picture : <noscript>{picture}</noscript>}
  </div>;
}

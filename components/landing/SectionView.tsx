"use client";
import { useEffect,useRef,type ReactNode } from 'react';
import { useLandingTracking } from './TrackingProvider';
export function SectionView({section,children}:{section:string;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null); const tracking=useLandingTracking();
  const callback=useRef(tracking.sectionView); callback.current=tracking.sectionView;
  useEffect(()=>{
    if(!tracking.allowed||!ref.current||typeof IntersectionObserver==='undefined')return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const cancel=()=>{clearTimeout(timer);timer=undefined;};
    const observer=new IntersectionObserver(entries=>{const entry=entries[0];cancel();if(entry&&entry.isIntersecting&&entry.intersectionRatio>=0.5&&document.visibilityState==='visible')timer=setTimeout(()=>callback.current(section),1000);},{threshold:[0,0.5]});
    observer.observe(ref.current); document.addEventListener('visibilitychange',cancel);
    return ()=>{cancel();observer.disconnect();document.removeEventListener('visibilitychange',cancel);};
  },[tracking.allowed,section]);
  return <div ref={ref}>{children}</div>;
}

"use client";
import { useEffect,useRef,type ReactNode } from 'react';
import { useLandingTracking } from './TrackingProvider';
export function SectionView({section,children,observationTargetId}:{section:string;children:ReactNode;observationTargetId?:string}) {
  const ref=useRef<HTMLDivElement>(null); const tracking=useLandingTracking();
  const callback=useRef(tracking.sectionView); callback.current=tracking.sectionView;
  useEffect(()=>{
    if(!tracking.allowed||!ref.current||typeof IntersectionObserver==='undefined')return;
    // Long native-scroll stages observe an explicit intro, keeping the same half-visible dwell contract.
    const target=observationTargetId?document.getElementById(observationTargetId):ref.current;
    if(!target||!ref.current.contains(target))return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const cancel=()=>{clearTimeout(timer);timer=undefined;};
    const observer=new IntersectionObserver(entries=>{const entry=entries[0];cancel();if(entry&&entry.isIntersecting&&entry.intersectionRatio>=0.5&&document.visibilityState==='visible')timer=setTimeout(()=>callback.current(section),1000);},{threshold:[0,0.5]});
    observer.observe(target); document.addEventListener('visibilitychange',cancel);
    return ()=>{cancel();observer.disconnect();document.removeEventListener('visibilitychange',cancel);};
  },[tracking.allowed,section,observationTargetId]);
  return <div ref={ref}>{children}</div>;
}

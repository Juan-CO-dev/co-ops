"use client";
import {useEffect,useRef} from 'react';
import {prefersCalm,subscribeCalm} from '@/lib/landing/motion-policy-shared';

/** Marks the landing root data-calm for CSS-only motion (walker, map zoom) under the shared policy. */
export function MotionPolicy() {
  const ref=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const root=ref.current?.closest<HTMLElement>('.landing-v2');if(!root)return;
    root.dataset.calm=String(prefersCalm());
    const unsubscribe=subscribeCalm(calm=>{root.dataset.calm=String(calm);});
    return ()=>{unsubscribe();delete root.dataset.calm;};
  },[]);
  return <span ref={ref} hidden/>;
}

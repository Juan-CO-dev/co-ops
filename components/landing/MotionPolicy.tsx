"use client";
import {useEffect,useRef} from 'react';
import {prefersCalm} from '@/lib/landing/motion-policy-shared';

/** Marks the landing root data-calm for CSS-only motion (walker, map zoom) under the shared policy. */
export function MotionPolicy() {
  const ref=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const root=ref.current?.closest<HTMLElement>('.landing-v2');if(!root)return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const connection=(navigator as Navigator&{connection?:EventTarget}).connection;
    const apply=()=>{root.dataset.calm=String(prefersCalm());};
    apply();media.addEventListener('change',apply);connection?.addEventListener('change',apply);
    return ()=>{media.removeEventListener('change',apply);connection?.removeEventListener('change',apply);delete root.dataset.calm;};
  },[]);
  return <span ref={ref} hidden/>;
}

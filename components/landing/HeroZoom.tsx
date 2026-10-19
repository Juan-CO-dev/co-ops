"use client";
import {useEffect,useRef} from 'react';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';
import {heroZoomProgress} from '@/lib/landing/hero-zoom-shared';

/** Scroll-coupled push-in on the hero photo. Inert until the first scroll, so the
 * LCP paint is the untouched still; transform-only, reduced motion/Save-Data skip it. */
export function HeroZoom() {
  const ref=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const section=ref.current?.closest('section');
    const media=section?.querySelector<HTMLElement>('[data-hero-zoom]');
    if(!section||!media)return;
    const saveData=Boolean((navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData);
    return observeLandingViewport(section,({active,reducedMotion})=>{
      if(reducedMotion||saveData||!active){if(!active)return;media.style.removeProperty('--hero-zoom');delete media.dataset.zooming;return;}
      const progress=heroZoomProgress(section.getBoundingClientRect().top,section.offsetHeight);
      if(progress<=0&&media.dataset.zooming===undefined)return;
      media.dataset.zooming='';
      media.style.setProperty('--hero-zoom',progress.toFixed(4));
    });
  },[]);
  return <span ref={ref} hidden/>;
}

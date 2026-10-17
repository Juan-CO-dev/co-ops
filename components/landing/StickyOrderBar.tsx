"use client";
import {useEffect,useRef,useState} from 'react';
import {heroActionsPassed,stickyPreference} from '@/lib/landing/sticky-order-shared';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';
import {OrderLink} from './OrderLink';
interface Props {
  stores: {key:string;orderUrl:string;label:string}[];
  labels: {name:string;minimize:string;restore:string;hints:[string,string]};
}
export function StickyOrderBar({stores,labels}:Props) {
  const ref=useRef<HTMLElement>(null);
  const [visible,setVisible]=useState(false);
  const [minimized,setMinimized]=useState(false);
  const [appearance,setAppearance]=useState(0);
  useEffect(()=>{
    setMinimized(stickyPreference.read());
    const hero=document.querySelector('[data-hero-actions]');
    const rail=ref.current;
    const root=rail?.closest<HTMLElement>('.landing-v2');
    if(!hero||!rail||!root||!stores.length)return;
    let wasVisible=false;
    const update=()=>{
      const notice=root.querySelector<HTMLElement>('.landing-v2-consent');
      const box=notice?.getBoundingClientRect();
      const expandedNoticeVisible=notice?.dataset.flow==='true' && box && box.bottom>0 && box.top<innerHeight;
      const viewport=window.visualViewport;
      const keyboard=(viewport?.height??innerHeight)<500;
      // The whole real-photo rectangle is protected, including while scrolling.
      // Keep the rail measurable when hidden so eligibility cannot oscillate.
      const railBox=rail.getBoundingClientRect();
      const dockHeight=innerWidth<768&&notice?.dataset.flow==='false'?(box?.height??0):0;
      const safeBottom=parseFloat(getComputedStyle(root).getPropertyValue('--landing-safe-bottom'))||0;
      const restoreAllowance=innerWidth<768&&rail.dataset.minimized==='true'?20:0;
      const protectedTop=railBox.top-dockHeight-(dockHeight?safeBottom:0)-restoreAllowance;
      const overlaps=(box:DOMRect)=>Math.max(0,Math.min(railBox.right,box.right)-Math.max(railBox.left,box.left))*Math.max(0,Math.min(railBox.bottom,box.bottom)-Math.max(protectedTop,box.top))>0;
      const obstructs=[...root.querySelectorAll('[data-landing-photo], [data-landing-placement]')].some(element=>!rail.contains(element)&&overlaps(element.getBoundingClientRect()));
      const next=heroActionsPassed(hero.getBoundingClientRect().bottom)&&!expandedNoticeVisible&&!keyboard&&!obstructs;
      if(next&&!wasVisible)setAppearance(value=>value+1);
      rail.dataset.visible=String(next);rail.inert=!next;rail.setAttribute('aria-hidden',String(!next));
      wasVisible=next;setVisible(next);
    };
    const stop=observeLandingViewport(hero,update,{offscreen:true});
    const notice=root.querySelector('.landing-v2-consent');
    const mutations=new MutationObserver(update);
    if(notice)mutations.observe(notice,{attributes:true,attributeFilter:['data-flow']});
    const resize=new ResizeObserver(update);resize.observe(rail);resize.observe(root);
    return ()=>{stop();mutations.disconnect();resize.disconnect();root.style.removeProperty('--landing-rail-height');root.style.removeProperty('--landing-header-rail-height');};
  },[stores.length]);
  useEffect(()=>{
    const rail=ref.current,root=rail?.closest<HTMLElement>('.landing-v2');
    if(!rail||!root)return;
    const measure=()=>{
      const height=visible?rail.getBoundingClientRect().height:0;
      const desktop=innerWidth>=768;
      root.style.setProperty('--landing-rail-height',`${desktop?0:height}px`);
      root.style.setProperty('--landing-header-rail-height',`${desktop?height:0}px`);
    };
    const resize=new ResizeObserver(measure);resize.observe(rail);measure();window.addEventListener('resize',measure);
    return ()=>{resize.disconnect();window.removeEventListener('resize',measure);};
  },[visible,minimized]);
  return <nav ref={ref} data-sticky-order data-minimized={minimized} data-visible={visible} inert={!visible} aria-hidden={!visible} aria-label={labels.name} className="landing-v2-sticky">
    <div className="landing-v2-sticky-heading" hidden={minimized}><span>{labels.hints[(appearance-1)%2===1?1:0]}</span><span aria-hidden="true" className="landing-v2-cta-accessory"/></div>
    <div className="landing-v2-sticky-links">{stores.map(store=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement="sticky" className="landing-v2-order">{store.label}</OrderLink>)}
      <button type="button" aria-label={minimized?labels.restore:labels.minimize} aria-expanded={!minimized} onClick={()=>{const next=!minimized;stickyPreference.write(next);setMinimized(next);}}>{minimized?'+':'−'}</button>
    </div>
  </nav>;
}

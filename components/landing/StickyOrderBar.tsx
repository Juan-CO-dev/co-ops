"use client";
import {useEffect,useRef,useState} from 'react';
import {createStickyVisibility,stickyPreference} from '@/lib/landing/sticky-order-shared';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';
import {OrderLink} from './OrderLink';
interface Props {
  stores: {key:string;orderUrl:string;label:string}[];
  labels: {name:string;minimize:string;restore:string;hints:[string,string]};
}
const MOBILE_BREAKPOINT=768;
const MIN_VISUAL_HEIGHT=500;
export function StickyOrderBar({stores,labels}:Props) {
  const ref=useRef<HTMLElement>(null);
  const [visible,setVisible]=useState(false);
  const [minimized,setMinimized]=useState(false);
  useEffect(()=>{
    setMinimized(stickyPreference.read());
    const hero=document.querySelector('[data-hero-actions]');
    const rail=ref.current;
    const root=rail?.closest<HTMLElement>('.landing-v2');
    if(!hero||!rail||!root||!stores.length)return;
    const notice=root.querySelector<HTMLElement>('.landing-v2-consent');
    const policy=createStickyVisibility();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const update=()=>{
      clearTimeout(timer);
      const box=notice?.getBoundingClientRect();
      const expandedNoticeVisible=Boolean(notice?.dataset.flow==='true'&&box&&box.bottom>0&&box.top<innerHeight);
      const railBox=rail.getBoundingClientRect();
      let clearance=Infinity;
      for(const element of root.querySelectorAll('[data-landing-photo], [data-landing-placement]')) {
        if(rail.contains(element))continue;
        const other=element.getBoundingClientRect();
        if(other.right<=railBox.left||other.left>=railBox.right)continue;
        clearance=Math.min(clearance,Math.max(other.top-railBox.bottom,railBox.top-other.bottom));
      }
      const next=policy.update({y:scrollY,now:performance.now(),clearance,heroBottom:hero.getBoundingClientRect().bottom,
        suppressed:document.hidden||expandedNoticeVisible||(window.visualViewport?.height??innerHeight)<MIN_VISUAL_HEIGHT});
      if(!next.visible&&rail.contains(document.activeElement))hero.querySelector<HTMLElement>('a')?.focus({preventScroll:true});
      rail.dataset.visible=String(next.visible);rail.inert=!next.visible;rail.setAttribute('aria-hidden',String(!next.visible));
      setVisible(next.visible);
      if(next.wait!==null)timer=setTimeout(update,next.wait+1);
    };
    const measure=()=>{
      // Resolve styles on resize only, never in the scroll callback.
      const safeBottom=parseFloat(getComputedStyle(root).getPropertyValue('--landing-safe-bottom'))||0;
      const desktop=innerWidth>=MOBILE_BREAKPOINT;
      const height=rail.getBoundingClientRect().height;
      const dock=notice?.dataset.flow==='false'?notice.getBoundingClientRect().height:0;
      root.style.setProperty('--landing-rail-height',`${desktop?0:height}px`);
      root.style.setProperty('--landing-header-rail-height',`${desktop?height:0}px`);
      root.style.setProperty('--landing-rail-bottom',`${desktop?0:dock+safeBottom}px`);
      update();
    };
    const stop=observeLandingViewport(hero,update,{offscreen:true});
    const mutations=new MutationObserver(measure);
    if(notice)mutations.observe(notice,{attributes:true,attributeFilter:['data-flow']});
    const resize=new ResizeObserver(measure);resize.observe(rail);resize.observe(root);if(notice)resize.observe(notice);
    window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);measure();
    return ()=>{stop();clearTimeout(timer);mutations.disconnect();resize.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);
      for(const name of ['--landing-rail-height','--landing-header-rail-height','--landing-rail-bottom'])root.style.removeProperty(name);
    };
  },[stores.length]);
  return <nav ref={ref} data-sticky-order data-minimized={minimized} data-visible={visible} inert={!visible} aria-hidden={!visible} aria-label={labels.name} className="landing-v2-sticky">
    <div id="landing-sticky-heading" className="landing-v2-sticky-heading" hidden={minimized}><span>{labels.hints[0]}</span><span aria-hidden="true" className="landing-v2-cta-accessory"/></div>
    <div className="landing-v2-sticky-links">{stores.map(store=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement="sticky" className="landing-v2-order">{store.label}</OrderLink>)}
      <button type="button" aria-controls="landing-sticky-heading" aria-label={minimized?labels.restore:labels.minimize} aria-expanded={!minimized} onClick={()=>{const next=!minimized;stickyPreference.write(next);setMinimized(next);}}>{minimized?'+':'−'}</button>
    </div>
  </nav>;
}
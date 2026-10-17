"use client";
import {useEffect,useRef,useState} from 'react';
import {createStickyVisibility,stickyPreference} from '@/lib/landing/sticky-order-shared';
import {OrderLink} from './OrderLink';
interface Props {
  stores: {key:string;orderUrl:string;label:string}[];
  labels: {name:string;minimize:string;restore:string;hint:string};
}
const MOBILE_BREAKPOINT=768;
const MIN_VISUAL_HEIGHT=500;
export function StickyOrderBar({stores,labels}:Props) {
  const ref=useRef<HTMLElement>(null);
  const [visible,setVisible]=useState(false);
  const [minimized,setMinimized]=useState(false);
  useEffect(()=>{
    setMinimized(stickyPreference.read());
    // Optional chrome stays inert when collision observation is unavailable.
    if(typeof IntersectionObserver==='undefined')return;
    const hero=document.querySelector('[data-hero-actions]');
    const rail=ref.current;
    const root=rail?.closest<HTMLElement>('.landing-v2');
    if(!hero||!rail||!root||!stores.length)return;
    const notice=root.querySelector<HTMLElement>('.landing-v2-consent');
    const policy=createStickyVisibility();
    // The page's link/section inventory is static. No selector or layout reads on scroll.
    const links=[...root.querySelectorAll<HTMLElement>('[data-landing-placement]')].filter(el=>!rail.contains(el));
    const sections=[...root.querySelectorAll<HTMLElement>('main section')];
    const collisions=new Set<Element>(), approachingDown=new Set<Element>(), approachingUp=new Set<Element>();
    let scrollingDown=true, previousY=scrollY;
    let heroPassed=false, noticeInView=false, settingsOpened=false;
    let band:IntersectionObserver|undefined, guardDown:IntersectionObserver|undefined, guardUp:IntersectionObserver|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const restoreFocus=()=>{
      // Only on focus evacuation, not on scroll: choose the section actually in view.
      const section=sections.map(el=>({el,box:el.getBoundingClientRect()})).filter(({box})=>box.bottom>0&&box.top<innerHeight).sort((a,b)=>Math.min(innerHeight,b.box.bottom)-Math.max(0,b.box.top)-(Math.min(innerHeight,a.box.bottom)-Math.max(0,a.box.top)))[0]?.el;
      const heading=section?.querySelector<HTMLElement>('h1,h2');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    };
    const update=()=>{
      clearTimeout(timer);
      const nearby=scrollingDown?approachingDown:approachingUp;
      const next=policy.update({y:scrollY,now:performance.now(),clearance:collisions.size?-1:nearby.size?0:Infinity,heroBottom:heroPassed?-1:1,
        suppressed:document.hidden||settingsOpened||(notice?.dataset.flow==='true'&&noticeInView)||(window.visualViewport?.height??innerHeight)<MIN_VISUAL_HEIGHT});
      if(!next.visible&&rail.contains(document.activeElement))restoreFocus();
      rail.dataset.visible=String(next.visible);rail.inert=!next.visible;rail.setAttribute('aria-hidden',String(!next.visible));
      setVisible(next.visible);
      if(next.wait!==null)timer=setTimeout(update,next.wait+1);
    };
    const heroObserver=new IntersectionObserver(entries=>{for(const entry of entries)heroPassed=entry.boundingClientRect.bottom<0;update();},{threshold:0});
    heroObserver.observe(hero);
    const noticeObserver=new IntersectionObserver(entries=>{noticeInView=entries.some(entry=>entry.isIntersecting);update();});
    if(notice)noticeObserver.observe(notice);
    const measure=()=>{
      const safeBottom=parseFloat(getComputedStyle(root).getPropertyValue('--landing-safe-bottom'))||0;
      const desktop=innerWidth>=MOBILE_BREAKPOINT;
      const height=rail.getBoundingClientRect().height;
      const dock=notice?.dataset.flow==='false'?notice.getBoundingClientRect().height:0;
      root.style.setProperty('--landing-rail-height',`${desktop?0:height}px`);
      root.style.setProperty('--landing-header-rail-height',`${desktop?height:0}px`);
      root.style.setProperty('--landing-rail-bottom',`${desktop?0:dock+safeBottom}px`);
      const box=rail.getBoundingClientRect();
      band?.disconnect();guardDown?.disconnect();guardUp?.disconnect();collisions.clear();approachingDown.clear();approachingUp.clear();
      const observeBand=(above:number,below:number,set:Set<Element>)=>{
        // Look ahead in the scroll direction, without waiting behind departed links.
        // Positive root margins preserve that look-ahead beyond the viewport edge.
        const top=box.top-above,bottom=box.bottom+below;
        const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)set.add(entry.target);else set.delete(entry.target);}update();},
          {rootMargin:`${-top}px 0px ${bottom-innerHeight}px 0px`,threshold:0});
        links.forEach(link=>observer.observe(link));return observer;
      };
      band=observeBand(0,0,collisions);guardDown=observeBand(0,124,approachingDown);guardUp=observeBand(124,0,approachingUp);update();
    };
    const direction=()=>{const y=scrollY;if(y===previousY)return;const down=y>previousY;previousY=y;if(down!==scrollingDown){scrollingDown=down;update();}};
    const mutations=new MutationObserver(records=>{
      if(records.some(record=>record.attributeName==='data-expanded'))settingsOpened=notice?.dataset.expanded==='true';
      measure();
    });
    if(notice)mutations.observe(notice,{attributes:true,attributeFilter:['data-flow','data-expanded']});
    const resize=new ResizeObserver(measure);resize.observe(rail);if(notice)resize.observe(notice);
    window.addEventListener('resize',measure);window.addEventListener('pageshow',measure);
    window.addEventListener('scroll',direction,{passive:true});
    document.addEventListener('visibilitychange',update);window.visualViewport?.addEventListener('resize',measure);measure();
    return ()=>{clearTimeout(timer);band?.disconnect();guardDown?.disconnect();guardUp?.disconnect();heroObserver.disconnect();noticeObserver.disconnect();mutations.disconnect();resize.disconnect();
      window.removeEventListener('scroll',direction);
      window.removeEventListener('resize',measure);window.removeEventListener('pageshow',measure);document.removeEventListener('visibilitychange',update);window.visualViewport?.removeEventListener('resize',measure);
      for(const name of ['--landing-rail-height','--landing-header-rail-height','--landing-rail-bottom'])root.style.removeProperty(name);
    };
  },[stores.length]);
  return <nav ref={ref} data-sticky-order data-minimized={minimized} data-visible={visible} inert={!visible} aria-hidden={!visible} aria-label={labels.name} className="landing-v2-sticky">
    <div id="landing-sticky-heading" className="landing-v2-sticky-heading" hidden={minimized}><span>{labels.hint}</span><span aria-hidden="true" className="landing-v2-cta-accessory"/></div>
    <div className="landing-v2-sticky-links">{stores.map(store=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement="sticky" className="landing-v2-order">{store.label}</OrderLink>)}
      <button type="button" aria-controls="landing-sticky-heading" aria-label={minimized?labels.restore:labels.minimize} aria-expanded={!minimized} onClick={()=>{const next=!minimized;stickyPreference.write(next);setMinimized(next);}}>{minimized?'+':'−'}</button>
    </div>
  </nav>;
}

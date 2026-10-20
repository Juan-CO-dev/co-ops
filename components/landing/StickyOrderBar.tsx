"use client";
import {useEffect,useRef,useState} from 'react';
import {createStickyVisibility,stickyPreference,STICKY_SHOW_CLEARANCE} from '@/lib/landing/sticky-order-shared';
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
    // Optional chrome stays inert when boundary observation is unavailable.
    if(typeof IntersectionObserver==='undefined')return;
    const hero=document.querySelector('[data-hero-actions]');
    const rail=ref.current;
    const root=rail?.closest<HTMLElement>('.landing-v2');
    if(!hero||!rail||!root||!stores.length)return;
    const notice=root.querySelector<HTMLElement>('.landing-v2-consent');
    const policy=createStickyVisibility();
    // The page's link/section inventory is static. No selector or layout reads on scroll.
    const footer=root.querySelector<HTMLElement>('footer .landing-v2-orders');
    if(!footer)return;
    const sections=[...root.querySelectorAll<HTMLElement>('main section')];
    let footerVisible=false, footerNear=false, heroClear=false;
    let heroPassed=false, noticeInView=false, settingsOpened=false;

    let timer:ReturnType<typeof setTimeout>|undefined;
    const restoreFocus=()=>{
      // Only on focus evacuation, not on scroll: choose the section actually in view.
      const section=sections.map(el=>({el,box:el.getBoundingClientRect()})).filter(({box})=>box.bottom>0&&box.top<innerHeight).sort((a,b)=>Math.min(innerHeight,b.box.bottom)-Math.max(0,b.box.top)-(Math.min(innerHeight,a.box.bottom)-Math.max(0,a.box.top)))[0]?.el;
      const heading=section?.querySelector<HTMLElement>('h1,h2');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    };
    const update=()=>{
      clearTimeout(timer);
      const next=policy.update({now:performance.now(),clearance:footerVisible?-1:footerNear?0:Infinity,heroBottom:heroPassed?(heroClear?-(STICKY_SHOW_CLEARANCE + 1):-1):1,
        suppressed:document.hidden||(settingsOpened&&noticeInView)||(notice?.dataset.flow==='true'&&noticeInView)||(window.visualViewport?.height??innerHeight)<MIN_VISUAL_HEIGHT});
      if(!next.visible&&rail.contains(document.activeElement))restoreFocus();
      rail.dataset.visible=String(next.visible);rail.inert=!next.visible;rail.setAttribute('aria-hidden',String(!next.visible));
      setVisible(next.visible);
      if(next.wait!==null)timer=setTimeout(update,next.wait+1);
    };
    const heroObserver=new IntersectionObserver(entries=>{for(const entry of entries)heroPassed=entry.boundingClientRect.bottom<0;update();},{threshold:0});
    heroObserver.observe(hero);
    // Actual viewport boundaries hide immediately; release observers add policy hysteresis.
    const heroGuard=new IntersectionObserver(([entry])=>{if(!entry)return;heroClear=!entry.isIntersecting;update();},{rootMargin:`${STICKY_SHOW_CLEARANCE}px 0px 0px 0px`});
    heroGuard.observe(hero);
    const footerObserver=new IntersectionObserver(entries=>{footerVisible=entries.some(entry=>entry.isIntersecting);update();});
    const footerGuard=new IntersectionObserver(entries=>{footerNear=entries.some(entry=>entry.isIntersecting);update();},{rootMargin:`${STICKY_SHOW_CLEARANCE}px 0px ${STICKY_SHOW_CLEARANCE}px 0px`});
    footerObserver.observe(footer);footerGuard.observe(footer);
    const noticeObserver=new IntersectionObserver(entries=>{noticeInView=entries.some(entry=>entry.isIntersecting);update();});
    if(notice)noticeObserver.observe(notice);
    const measure=()=>{
      // While the docked consent notice is open (unanswered or reopened), the rail is only its two
      // order buttons: CSS hides the hint row and toggle. A DOM attribute, so no re-render. The
      // notice's wording and controls are untouched.
      rail.dataset.compact=String(notice?.dataset.flow==='false'&&notice.dataset.expanded==='true');
      const safeBottom=parseFloat(getComputedStyle(root).getPropertyValue('--landing-safe-bottom'))||0;
      const desktop=innerWidth>=MOBILE_BREAKPOINT;
      const height=rail.getBoundingClientRect().height;
      const dock=notice?.dataset.flow==='false'?notice.getBoundingClientRect().height:0;
      root.style.setProperty('--landing-rail-height',`${desktop?0:height}px`);
      root.style.setProperty('--landing-header-rail-height',`${desktop?height:0}px`);
      root.style.setProperty('--landing-rail-bottom',`${desktop?0:dock+safeBottom}px`);
      update();
    };
    const mutations=new MutationObserver(records=>{
      if(records.some(record=>record.attributeName==='data-expanded'))settingsOpened=notice?.dataset.expanded==='true';
      measure();
    });
    if(notice)mutations.observe(notice,{attributes:true,attributeFilter:['data-flow','data-expanded']});
    const resize=new ResizeObserver(measure);resize.observe(rail);if(notice)resize.observe(notice);
    window.addEventListener('resize',measure);window.addEventListener('pageshow',measure);
    document.addEventListener('visibilitychange',update);window.visualViewport?.addEventListener('resize',measure);measure();
    return ()=>{clearTimeout(timer);heroGuard.disconnect();footerObserver.disconnect();footerGuard.disconnect();heroObserver.disconnect();noticeObserver.disconnect();mutations.disconnect();resize.disconnect();
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

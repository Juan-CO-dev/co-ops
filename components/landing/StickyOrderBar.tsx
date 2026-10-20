"use client";
import {useEffect,useRef,useState} from 'react';
import {blocksPill,createPillPolicy,IN_CONTENT_ORDER_SELECTOR} from '@/lib/landing/sticky-order-shared';
import {OrderSheet,type SheetShop} from './OrderSheet';
interface Props {
  shops: SheetShop[];
  labels: {order:string;title:string;close:string};
}
/** v4.2: one slim "Order" pill (bottom corner) that opens the shop chooser — both shops with
 * street + today's closing — whose links are the ordinary order links (placement "sticky").
 * It shows only when no other order control is on screen and the consent notice is not
 * showing. Observers and attribute changes only; nothing is read on scroll. */
export function StickyOrderBar({shops,labels}:Props) {
  const ref=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  const sheetOpen=useRef(false);
  const recompute=useRef<()=>void>(()=>{});
  useEffect(()=>{
    // Optional chrome stays hidden when boundary observation is unavailable.
    if(typeof IntersectionObserver==='undefined')return;
    const rail=ref.current;
    const root=rail?.closest<HTMLElement>('.landing-v2');
    if(!rail||!root||!shops.length)return;
    const notice=root.querySelector<HTMLElement>('.landing-v2-consent');
    // The page's order-surface inventory is static: collected once, then only observed.
    const targets=[...root.querySelectorAll<HTMLElement>(IN_CONTENT_ORDER_SELECTOR)].filter(el=>!rail.contains(el));
    const inView=new Set<Element>();
    let seen=false,timer:ReturnType<typeof setTimeout>|undefined;
    const policy=createPillPolicy();
    const update=()=>{
      clearTimeout(timer);
      if(!seen)return;
      const {visible:next,wait}=policy.update({
        orderInView:[...inView].some(blocksPill),
        consentShowing:!!notice&&!notice.hidden,
        pageHidden:document.hidden,
        visualHeight:window.visualViewport?.height??innerHeight,
        sheetOpen:sheetOpen.current,
      },performance.now());
      if(wait!==null)timer=setTimeout(update,wait+1);
      rail.dataset.visible=String(next);
      setVisible(next);
    };
    recompute.current=update;
    const observer=new IntersectionObserver(entries=>{
      seen=true;
      for(const entry of entries){if(entry.isIntersecting)inView.add(entry.target);else inView.delete(entry.target);}
      update();
    });
    for(const target of targets)observer.observe(target);
    // Consent showing/hidden and the Field Guide slot's reveal change attributes, not geometry.
    const mutations=new MutationObserver(update);
    if(notice)mutations.observe(notice,{attributes:true,attributeFilter:['hidden','data-expanded']});
    for(const target of targets)if(target.hasAttribute('data-ready'))mutations.observe(target,{attributes:true,attributeFilter:['data-ready']});
    // The sheet's dialog closing (close does not bubble; capture it on the pill).
    const closed=()=>{sheetOpen.current=false;update();};
    rail.addEventListener('close',closed,true);
    document.addEventListener('visibilitychange',update);window.visualViewport?.addEventListener('resize',update);window.addEventListener('resize',update);
    return ()=>{clearTimeout(timer);observer.disconnect();mutations.disconnect();rail.removeEventListener('close',closed,true);recompute.current=()=>{};
      document.removeEventListener('visibilitychange',update);window.visualViewport?.removeEventListener('resize',update);window.removeEventListener('resize',update);};
  },[shops.length]);
  // Only the pill itself hides (CSS visibility): its sheet is a sibling and never inherits it.
  return <div ref={ref} data-sticky-order data-visible={visible} className="landing-v2-sticky">
    <OrderSheet eager shops={shops} placement="sticky" triggerLabel={labels.order} title={labels.title} closeLabel={labels.close} className="landing-v42-pill"
      onOpen={()=>{sheetOpen.current=true;recompute.current();}}/>
  </div>;
}

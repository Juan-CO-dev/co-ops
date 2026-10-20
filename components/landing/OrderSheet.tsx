"use client";
import {useEffect,useId,useRef,useState} from 'react';
import type {LandingItem,LandingPlacement} from '@/lib/landing/tracking-schema-shared';
import {hop} from '@/lib/landing/hop-shared';
import {OrderLink} from './OrderLink';
import {SpinCanvas} from './SpinCanvas';

export interface SheetShop {key:string;orderUrl:string;label:string;detail:string}
export interface SheetSpin {frames:readonly string[];width:number;height:number;alt:string}

/** One order action for one sub: a button that opens a two-shop sheet. Before hydration
 * (and without JavaScript) it is the two native shop links instead. The drawn Crunchy Boi
 * keeps turning inside the sheet (loaded only while it is open; still under reduced motion
 * or Save-Data). Every shop link is an ordinary outbound order link. */
export function OrderSheet({shops,placement,item,triggerLabel,title,closeLabel,spin,onOpen,className='landing-v3-cta',eager=false}:{shops:readonly SheetShop[];placement:LandingPlacement;item?:LandingItem;triggerLabel:string;title:string;closeLabel:string;spin?:SheetSpin;onOpen?:()=>void;className?:string;
  /** Mounted only after the page is interactive (never server-rendered): start as the button. */
  eager?:boolean}) {
  // The button + sheet replace the native links only once the action nears the viewport, and
  // then at idle — never inside the hydration task and never for a section nobody reached
  // (keeps first-load blocking time down; the native links work meanwhile).
  const [hydrated,setHydrated]=useState(eager);
  const fallback=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(hydrated)return;
    let idle:number|undefined,timer:ReturnType<typeof setTimeout>|undefined,settleTimer:ReturnType<typeof setTimeout>|undefined;
    // Never swap the links out from under keyboard focus: wait until focus leaves them.
    let leave:((event:FocusEvent)=>void)|undefined;
    // Never swap them out from under a finger or mouse either: a press on a link holds the swap
    // until the gesture ends (its click has run, or it was cancelled), so the tap is never lost.
    let pressed=false,held=false;
    const element=fallback.current;
    const settle=()=>{
      clearTimeout(settleTimer);removeEventListener('pointerup',onUp,true);removeEventListener('pointercancel',settle,true);
      if(!pressed)return;pressed=false;
      if(held){held=false;swap();}
    };
    // The click follows pointerup; settle after it (a press that ends off the link has no click).
    const onUp=()=>{clearTimeout(settleTimer);settleTimer=setTimeout(settle,700);};
    const onClick=()=>{clearTimeout(settleTimer);settleTimer=setTimeout(settle,0);};
    const onDown=()=>{pressed=true;clearTimeout(settleTimer);addEventListener('pointerup',onUp,true);addEventListener('pointercancel',settle,true);};
    element?.addEventListener('pointerdown',onDown,true);element?.addEventListener('click',onClick,true);
    const swap=()=>{
      if(pressed){held=true;return;}
      if(element&&element.contains(document.activeElement)){
        if(leave)return;
        leave=event=>{if(element.contains(event.relatedTarget as Node|null))return;element.removeEventListener('focusout',leave!);leave=undefined;swap();};
        element.addEventListener('focusout',leave);return;
      }
      setHydrated(true);
    };
    const enhance=()=>{
      if(typeof window.requestIdleCallback==='function')idle=window.requestIdleCallback(swap,{timeout:1000});
      else timer=setTimeout(swap,50);
    };
    const stop=()=>{if(idle!==undefined)window.cancelIdleCallback(idle);clearTimeout(timer);clearTimeout(settleTimer);if(leave)element?.removeEventListener('focusout',leave);
      element?.removeEventListener('pointerdown',onDown,true);element?.removeEventListener('click',onClick,true);removeEventListener('pointerup',onUp,true);removeEventListener('pointercancel',settle,true);};
    if(!element||typeof IntersectionObserver==='undefined'){enhance();return stop;}
    const near=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){near.disconnect();enhance();}},{rootMargin:'100% 0px'});
    near.observe(element);
    return ()=>{near.disconnect();stop();};
  },[hydrated]);
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false);
  const titleId=useId();
  // One accessible name, read in order: "Order Capitol Hill · 8th St SE · til 6 PM".
  const link=(shop:SheetShop)=><OrderLink key={shop.key} href={shop.orderUrl} store={shop.key} placement={placement} item={item} className="landing-v2-order landing-v4-order-two">
    <span>{shop.label}</span><span className="sr-only"> · </span><span className="landing-v4-order-detail" data-order-detail>{shop.detail}</span>
  </OrderLink>;
  if(!hydrated)return <div ref={fallback} className="landing-v3-direct-orders">{shops.map(link)}</div>;
  const show=()=>{if(trigger.current)hop(trigger.current);onOpen?.();dialog.current?.showModal();setOpen(true);};
  return <>
    <button ref={trigger} type="button" onClick={show} aria-haspopup="dialog" className={className}>{triggerLabel}</button>
    <dialog ref={dialog} className="landing-v3-sheet" aria-labelledby={titleId} onClose={()=>{setOpen(false);trigger.current?.focus();}} onClick={event=>{if(event.target===dialog.current)dialog.current?.close();}}>
      <div>
        {/* The sheet is a modal: its own top-level heading, not a sub-heading of the card behind it. */}
        <h2 id={titleId}>{title}</h2>
        {open&&spin&&<div className="landing-v4-sheet-spin"><SpinCanvas frames={spin.frames} width={spin.width} height={spin.height} label={spin.alt} stillLabel={spin.alt} valueText={()=>''} auto decorative/></div>}
        <ul>{shops.map(shop=><li key={shop.key}>{link(shop)}</li>)}</ul>
        <button type="button" onClick={()=>dialog.current?.close()} className="landing-v3-sheet-close">{closeLabel}</button>
      </div>
    </dialog>
  </>;
}

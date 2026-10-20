"use client";
import {useId,useRef,useState,useSyncExternalStore} from 'react';
import type {LandingItem,LandingPlacement} from '@/lib/landing/tracking-schema-shared';
import {hop} from '@/lib/landing/hop-shared';
import {OrderLink} from './OrderLink';
import {SpinCanvas} from './SpinCanvas';

export interface SheetShop {key:string;orderUrl:string;label:string;detail:string}
export interface SheetSpin {frames:readonly string[];width:number;height:number;alt:string}
const noSubscribe=()=>()=>{};

/** One order action for one sub: a button that opens a two-shop sheet. Before hydration
 * (and without JavaScript) it is the two native shop links instead. The drawn Crunchy Boi
 * keeps turning inside the sheet (loaded only while it is open; still under reduced motion
 * or Save-Data). Every shop link is an ordinary outbound order link. */
export function OrderSheet({shops,placement,item,triggerLabel,title,closeLabel,spin,onOpen,className='landing-v3-cta'}:{shops:readonly SheetShop[];placement:LandingPlacement;item?:LandingItem;triggerLabel:string;title:string;closeLabel:string;spin?:SheetSpin;onOpen?:()=>void;className?:string}) {
  const hydrated=useSyncExternalStore(noSubscribe,()=>true,()=>false);
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false);
  const titleId=useId();
  // One accessible name, read in order: "Order Capitol Hill · 8th St SE · til 6 PM".
  const link=(shop:SheetShop)=><OrderLink key={shop.key} href={shop.orderUrl} store={shop.key} placement={placement} item={item} className="landing-v2-order landing-v4-order-two">
    <span>{shop.label}</span><span className="sr-only"> · </span><span className="landing-v4-order-detail" data-order-detail>{shop.detail}</span>
  </OrderLink>;
  if(!hydrated)return <div className="landing-v3-direct-orders">{shops.map(link)}</div>;
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

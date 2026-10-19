"use client";
import {useEffect,useRef,useState} from 'react';
import {LineupPhoto} from './LineupPhoto';
import {OrderLink} from './OrderLink';
import {SpinCanvas} from './SpinCanvas';
import {nextFighter,AUTO_ADVANCE_MS} from '@/lib/landing/fighter-select-shared';
import {prefersCalm,subscribeCalm} from '@/lib/landing/motion-policy-shared';

export interface Fighter {id:string;name:string;image:string;smallImage:string;width:number;height:number;ingredients:string;photoAlt:string}
export interface FighterShop {key:string;name:string;address?:string;orderUrl:string;orderLabel:string}
interface Sprite {src:string;width:number;height:number}
export interface FighterLabels {order:string;sheetTitle:string;close:string;auto:string;p1:string;spin:string;spinValue:string;browse:string}

const fill=(template:string,values:Record<string,string|number>)=>template.replace(/\{(\w+)\}/g,(_,key:string)=>String(values[key]??''));

/** "Choose your fighter": a select screen. The roster auto-advances (visible pause
 * control; any touch or focus inside the screen stops it, one loop at most); tapping a card
 * selects it; one CTA opens the shop sheet. The drawn spin is only ever the Crunchy Boi's
 * stage object and is never morphed into or out of a real photo. */
export function FighterSelect({fighters,shops,spin,sprites,labels}:{fighters:readonly Fighter[];shops:readonly FighterShop[];spin:{frames:readonly string[];width:number;height:number};sprites:{idle:Sprite;jump:Sprite;selected:Sprite};labels:FighterLabels}) {
  const root=useRef<HTMLDivElement>(null),strip=useRef<HTMLUListElement>(null),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const autoButton=useRef<HTMLButtonElement>(null);
  const [selected,setSelected]=useState(0);
  const [auto,setAuto]=useState(true);
  const [picked,setPicked]=useState(0);
  // Until hydration the screen is a plain menu with native shop links (also the no-JS path).
  const [enhanced,setEnhanced]=useState(false);
  // Reduced motion and Save-Data get the same static screen: no auto-advance or animation.
  const [calm,setCalm]=useState(false);
  const advanced=useRef(0);
  const fighter=fighters[selected]!;
  useEffect(()=>{
    setEnhanced(true);
    if(prefersCalm()){setCalm(true);setAuto(false);}
    return subscribeCalm(calm=>{setCalm(calm);if(calm)setAuto(false);});
  },[]);
  // Auto-advance only while running, in view, visible and motion is allowed.
  useEffect(()=>{
    const element=root.current;if(!element||!auto||typeof IntersectionObserver==='undefined')return;
    if(prefersCalm()){setAuto(false);return;}
    let visible=false,timer:ReturnType<typeof setInterval>|undefined;
    const stop=()=>{clearInterval(timer);timer=undefined;};
    const start=()=>{if(timer||!visible||document.hidden)return;timer=setInterval(()=>{
      setSelected(current=>{
        const next=nextFighter(current,fighters.length,advanced.current);
        if(next===null){stop();setAuto(false);return current;}
        advanced.current++;return next;
      });
    },AUTO_ADVANCE_MS);};
    // Watch the roster strip, not the whole screen: on short phones the screen never fits.
    const target=strip.current??element;
    const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);if(visible)start();else stop();},{threshold:.6});
    observer.observe(target);
    const visibility=()=>{if(document.hidden)stop();else start();};
    document.addEventListener('visibilitychange',visibility);
    return ()=>{stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);};
  },[auto,fighters.length]);
  // Keep the selected card in view by scrolling the strip itself, never the page.
  useEffect(()=>{
    const list=strip.current,card=list?.children[selected] as HTMLElement|undefined;if(!list||!card)return;
    const left=card.offsetLeft-(list.clientWidth-card.offsetWidth)/2;
    list.scrollTo({left:Math.max(0,left),behavior:prefersCalm()?'auto':'smooth'});
  },[selected]);
  const choose=(index:number)=>{setAuto(false);setSelected(index);setPicked(value=>value+1);};
  const openSheet=()=>{setAuto(false);dialog.current?.showModal();};
  const closeSheet=()=>{dialog.current?.close();};
  return <div ref={root} className="landing-v3-select" data-enhanced={enhanced} data-calm={calm} onPointerDownCapture={event=>{if(!autoButton.current?.contains(event.target as Node))setAuto(false);}} onFocusCapture={event=>{if(!autoButton.current?.contains(event.target as Node))setAuto(false);}}>
    <div className="landing-v3-stage" data-fighter={fighter.id}>
      <div key={`${fighter.id}-${picked}`} className="landing-v3-stage-media" data-pop={picked>0||selected!==0}>
        {fighter.id==='crunchy-boi'
          ? <SpinCanvas frames={spin.frames} width={spin.width} height={spin.height} label={fill(labels.spin,{name:fighter.name})} stillLabel={fighter.photoAlt} valueText={degrees=>fill(labels.spinValue,{degrees})}/>
          : <LineupPhoto src={fighter.image} small={fighter.smallImage} width={fighter.width} height={fighter.height} alt={fighter.photoAlt}/>}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {picked>0&&<img key={picked} src={sprites.selected.src} width={sprites.selected.width} height={sprites.selected.height} alt="" aria-hidden="true" loading="lazy" decoding="async" className="landing-v3-pixel landing-v3-stage-cheer"/>}
      <div className="landing-v3-plate">
        <span aria-hidden="true" className="landing-v3-p1">{labels.p1}</span>
        <h3>{fighter.name}</h3>
        <p data-stage-ingredients>{fighter.ingredients}</p>
        {enhanced
          ? <button ref={trigger} type="button" onClick={openSheet} aria-haspopup="dialog" className="landing-v3-cta">{fill(labels.order,{name:fighter.name})}</button>
          : <div className="landing-v3-direct-orders">{shops.map(shop=><OrderLink key={shop.key} href={shop.orderUrl} store={shop.key} placement="lineup" className="landing-v2-order">{shop.orderLabel}</OrderLink>)}</div>}
      </div>
    </div>
    {/* Without JS every fighter's full menu is visible, not just announced. */}
    <noscript><style>{'.landing-v2 .landing-v3-roster > li { flex-basis: 220px; } .landing-v2 .landing-v3-roster [data-ingredients] { position: static; width: auto; height: auto; margin: 0; padding: 0 6px 8px; overflow: visible; clip: auto; clip-path: none; white-space: normal; font-size: .8125rem; line-height: 1.35; } .landing-v2 .landing-v3-roster-bar { display: none; }'}</style></noscript>
    <div className="landing-v3-roster-bar" hidden={!enhanced}>
      <button ref={autoButton} type="button" aria-pressed={auto} onClick={()=>setAuto(value=>!value)} className="landing-v3-auto">{labels.auto}</button>
    </div>
    <ul ref={strip} data-lineup aria-label={labels.browse} className="landing-v3-roster">
      {fighters.map((item,index)=><li key={item.id} data-selected={index===selected}>
        {index===selected&&
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`cursor-${picked}`} src={(picked>0?sprites.jump:sprites.idle).src} width={sprites.idle.width} height={sprites.idle.height} alt="" aria-hidden="true" loading="lazy" decoding="async" className="landing-v3-pixel landing-v3-cursor"/>}
        <button type="button" aria-pressed={index===selected} onClick={()=>choose(index)}>
          <LineupPhoto src={item.image} small={item.smallImage} width={item.width} height={item.height} alt=""/>
          <span>{item.name}</span>
          {/* The full menu stays in the document for every fighter, not only the one on stage. */}
          <span data-ingredients className="sr-only">{item.ingredients}</span>
        </button>
      </li>)}
    </ul>
    <dialog ref={dialog} className="landing-v3-sheet" aria-labelledby="landing-v3-sheet-title" onClose={()=>trigger.current?.focus()} onClick={event=>{if(event.target===dialog.current)closeSheet();}}>
      <div>
        <h3 id="landing-v3-sheet-title">{fill(labels.sheetTitle,{name:fighter.name})}</h3>
        <ul>{shops.map(shop=><li key={shop.key}>
          <OrderLink href={shop.orderUrl} store={shop.key} placement="lineup" className="landing-v2-order">{shop.orderLabel}</OrderLink>
        </li>)}</ul>
        <button type="button" onClick={closeSheet} className="landing-v3-sheet-close">{labels.close}</button>
      </div>
    </dialog>
  </div>;
}

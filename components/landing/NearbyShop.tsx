"use client";
import { useState } from 'react';
import type { LandingStore } from '@/lib/landing/stores';
import { nearestStores, nearbyEnabled, validCoordinates } from '@/lib/landing/nearby-shared';
import type { Language } from '@/lib/i18n/types';
import { OrderLink } from './OrderLink';
import { OfferCode } from './OfferCode';

export interface NearbyLabels {nearest:string;locating:string;unavailable:string;straightLine:string;distance:string;offer:string;call:Record<string,string>;order:Record<string,string>}
export function NearbyShop({stores,language,labels,ad='unattributed'}:{stores:readonly LandingStore[];language:Language;labels:NearbyLabels;ad?:string}) {
  const [ordered,setOrdered]=useState(()=>stores.map(store=>({...store,distance:null as number|null})));
  const [status,setStatus]=useState<'idle'|'pending'|'ready'|'unavailable'>('idle');
  const canLocate=nearbyEnabled(stores);
  const locate=()=>{
    if(status==='pending' || !canLocate) return;
    if(!navigator.geolocation) {setStatus('unavailable');return;}
    setStatus('pending');
    try { navigator.geolocation.getCurrentPosition(position=>{
      const point={latitude:position.coords.latitude,longitude:position.coords.longitude};
      if(!validCoordinates(point)) {setStatus('unavailable');return;}
      // The coordinates never leave this callback: only distances enter component state.
      setOrdered(nearestStores(stores,point));setStatus('ready');
    },()=>setStatus('unavailable'),{enableHighAccuracy:false,timeout:8000,maximumAge:0});
    } catch { setStatus('unavailable'); }
  };
  return <div className="mt-6">
    {canLocate && <button type="button" disabled={status==='pending'} onClick={locate} className="inline-flex min-h-11 min-w-11 items-center rounded-xl border border-co-text px-4 py-3 font-bold">{status==='pending'?labels.locating:labels.nearest}</button>}
    <p role="status" className="mt-2 text-sm">{status==='unavailable'?labels.unavailable:status==='ready'?labels.straightLine:''}</p>
    <div className="mt-4 grid gap-5 sm:grid-cols-2">
      {ordered.map(store=><article key={store.key} data-shop={store.key} className="rounded-2xl border border-co-border bg-co-surface p-5">
        <h3 className="text-2xl font-bold">{store.name}</h3>
        {store.address && <address className="mt-3 not-italic">{store.address}</address>}
        {store.hours && <p className="mt-3">{store.hours[language]}</p>}
        {store.phone && <a href={`tel:${store.phone.replace(/[^+\d]/g,'')}`} className="inline-flex min-h-11 min-w-11 items-center underline" aria-label={labels.call[store.key]}>{store.phone}</a>}
        {store.distance!==null && <p className="mt-2 text-sm">{labels.distance.replace('{distance}',new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(store.distance))}</p>}
        <div className="mt-4"><OrderLink href={store.orderUrl} store={store.key} placement="shops">{labels.order[store.key]}</OrderLink></div>
        <OfferCode ad={ad} store={store.key} label={labels.offer}/>
      </article>)}
    </div>
  </div>;
}

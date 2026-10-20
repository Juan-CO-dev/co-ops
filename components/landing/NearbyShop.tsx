"use client";
import { useEffect, useState } from 'react';
import type { LandingStore } from '@/lib/landing/stores';
import { formatDistanceMiles, nearestStores, nearbyEnabled, validCoordinates } from '@/lib/landing/nearby-shared';
import type { Language } from '@/lib/i18n/types';
import { OrderLink } from './OrderLink';
import { OfferCode } from './OfferCode';
import { ShopMapView } from './ShopMapView';
import { directionsHref, projectPoint, type MapPoint, type MapProjection } from '@/lib/landing/map-shared';

export interface NearbyLabels {nearest:string;locating:string;unavailable:string;straightLine:string;distance:string;distanceOne?:string;offer:string;uberEats?:string;directions?:Record<string,string>;call:Record<string,string>;order:Record<string,string>;
  /** Today's closing line per shop ("Today: til 6 PM"), absent when the shop is closed today. */
  today?:Record<string,string|undefined>}
export interface NearbyMap extends MapProjection {image:string;width:number;height:number;labels:{map:string;you:string;attribution:string;attributionHref:string;offMap:string}}
export function NearbyShop({stores,language,labels,ad='unattributed',map}:{stores:readonly LandingStore[];language:Language;labels:NearbyLabels;ad?:string;map?:NearbyMap}) {
  const [ordered,setOrdered]=useState(()=>stores.map(store=>({...store,distance:null as number|null})));
  const [status,setStatus]=useState<'idle'|'pending'|'ready'|'unavailable'>('idle');
  const canLocate=nearbyEnabled(stores);
  // Only the projected map position (a fraction of the picture) is kept, in memory.
  const [you,setYou]=useState<MapPoint|null>(null);
  // Apple devices get Apple Maps; the server renders the Google link for everyone else.
  const [apple,setApple]=useState(false);
  useEffect(()=>{setApple(/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent));},[]);
  const locate=()=>{
    if(status==='pending' || !canLocate) return;
    if(!navigator.geolocation) {setStatus('unavailable');return;}
    setStatus('pending');
    try { navigator.geolocation.getCurrentPosition(position=>{
      const point={latitude:position.coords.latitude,longitude:position.coords.longitude};
      if(!validCoordinates(point)) {setStatus('unavailable');return;}
      // The coordinates never leave this callback: only distances enter component state.
      setOrdered(nearestStores(stores,point));if(map)setYou(projectPoint(map,point));setStatus('ready');
    },()=>setStatus('unavailable'),{enableHighAccuracy:false,timeout:8000,maximumAge:0});
    } catch { setStatus('unavailable'); }
  };
  const nearest=status==='ready'?ordered[0]?.key??null:null;
  return <div className="mt-6">
    {map&&<ShopMapView src={map.image} width={map.width} height={map.height} user={you} nearest={nearest} labels={map.labels}
      shops={stores.filter(store=>store.coordinates).map(store=>({key:store.key,name:store.name,point:projectPoint(map,store.coordinates!)}))}/>}
    {canLocate && <button type="button" disabled={status==='pending'} onClick={locate} className="inline-flex min-h-11 min-w-11 items-center rounded-xl border border-co-text px-4 py-3 font-bold">{status==='pending'?labels.locating:labels.nearest}</button>}
    <p role="status" className="mt-2 text-sm">{status==='unavailable'?labels.unavailable:status==='ready'?labels.straightLine:''}</p>
    <div className="mt-4 grid gap-5 sm:grid-cols-2">
      {ordered.map(store=><article key={store.key} id={store.key} data-shop={store.key} data-nearest={store.key===nearest} className="rounded-2xl border border-co-border bg-co-surface p-5">
        <h3 className="text-2xl font-bold">{store.name}</h3>
        {store.address && <address className="mt-3 not-italic">{store.address}</address>}
        {store.hours && <p className="mt-3">{store.hours[language]}</p>}
        {labels.today?.[store.key] && <p className="landing-v4-today">{labels.today[store.key]}</p>}
        {store.distance!==null && <p className="mt-2 text-sm">{formatDistanceMiles(store.distance,language,labels.distance,labels.distanceOne??labels.distance)}</p>}
        {/* Sell first: the order action right under the hours, directions and phone below it. */}
        <OrderLink href={store.orderUrl} store={store.key} placement="shops" className="landing-v3-cta landing-v4-shop-order">{labels.order[store.key]}</OrderLink>
        {store.directionsUrl && <a href={store.address?directionsHref(store.address,apple):store.directionsUrl} data-directions={store.key} className="landing-v4-directions">{labels.directions?.[store.key]}</a>}
        {store.phone && <a href={`tel:${store.phone.replace(/[^+\d]/g,'')}`} className="inline-flex min-h-11 min-w-11 items-center underline" aria-label={labels.call[store.key]}>{store.phoneDisplay}</a>}
        {store.uberEatsUrl && <OrderLink href={store.uberEatsUrl} store={store.key} placement="shops" vendor="ubereats" className="inline-flex min-h-11 min-w-11 items-center underline text-sm">{labels.uberEats}</OrderLink>}
        <OfferCode ad={ad} store={store.key} label={labels.offer}/>
      </article>)}
    </div>
  </div>;
}

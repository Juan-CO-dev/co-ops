"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { buildFbc, captureAttribution, persistAttribution, readAttribution, type Attribution, type AttributionPolicy } from '@/lib/landing/attribution-shared';
import { consentCookie, marketingAllowed, readConsent, type ConsentChoice } from '@/lib/landing/consent-shared';
import { browserTransport, createLandingTracker, type ActionDetails, type LandingAction } from '@/lib/landing/tracking-client';
import { ConsentNotice, type ConsentLabels } from './ConsentNotice';

interface TrackingContextValue { dispatch: (name: LandingAction, details: ActionDetails) => void; sectionView: (section:string)=>void; allowed: boolean }
const ConsentContext=createContext<ReactNode>(null);
export function LandingConsentSlot() { return useContext(ConsentContext); }
const TrackingContext=createContext<TrackingContextValue>({dispatch:()=>{},sectionView:()=>{},allowed:false});
export const useLandingTracking=()=>useContext(TrackingContext);
function signals() { return {doNotTrack:navigator.doNotTrack,globalPrivacyControl:(navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl}; }
function storage(): Storage | undefined { try { return window.sessionStorage; } catch { return undefined; } }
function clearMarketingCookies() {
  for(const key of ['_fbp','_fbc']) {
    const base=`${key}=; Path=/; Max-Age=0; SameSite=Lax${window.location.protocol==='https:'?'; Secure':''}`;
    document.cookie=base;
    document.cookie=`${base}; Domain=${window.location.hostname}`;
  }
}
function sanitizeTrackingLocation(attribution:Attribution) {
  // The third-party SDK reads location itself; never let arbitrary query/fragment data reach it.
  const query=new URLSearchParams();
  const lang=new URLSearchParams(window.location.search).get('lang');
  if(lang==='en'||lang==='es')query.set('lang',lang);
  if(attribution.ad!=='unattributed')query.set('ad',attribution.ad);
  if(attribution.fbclid)query.set('fbclid',attribution.fbclid);
  for(const [key,value] of Object.entries(attribution.utm))query.set(key,value);
  const search=query.toString();
  window.history.replaceState(window.history.state,'',`${window.location.pathname}${search?'?'+search:''}`);
}

export function TrackingProvider({serverApproved,pixelId,capiEnabled,sourceUrl,attributionPolicy,allowedStores,allowedPlacements,labels,children}: {
  serverApproved:boolean; pixelId?:string; capiEnabled?:boolean; sourceUrl:string; attributionPolicy:AttributionPolicy; allowedStores:readonly string[]; allowedPlacements:readonly string[]; labels:ConsentLabels; children:ReactNode;
}) {
  const [choice,setChoice]=useState<ConsentChoice>('unknown');
  const [allowed,setAllowed]=useState(false);
  const tracker=useRef<ReturnType<typeof createLandingTracker> | null>(null);
  const attribution=useRef<Attribution>({ad:'unattributed',utm:{}});
  const initial=useRef({serverApproved,pixelId,capiEnabled,sourceUrl,attributionPolicy,allowedStores,allowedPlacements});
  useEffect(()=>{
    const cfg=initial.current;
    if (!cfg.serverApproved) return;
    if (!tracker.current) tracker.current=createLandingTracker({...cfg,allowedAds:cfg.attributionPolicy.ads},browserTransport());
    const saved=readConsent(document.cookie); const permitted=marketingAllowed(cfg.serverApproved,saved,signals());
    const restored=permitted ? readAttribution(storage(),cfg.attributionPolicy) : undefined;
    const captured=captureAttribution(window.location.search,cfg.attributionPolicy,Date.now(),restored);
    const explicitAd=new URLSearchParams(window.location.search).has('ad');
    attribution.current=explicitAd || captured.fbclid ? {...captured,...(!captured.fbclid && restored?.fbclid && captured.ad === restored.ad ? {fbclid:restored.fbclid,capturedAt:restored.capturedAt} : {})} : restored ?? captured;
    persistAttribution(storage(),attribution.current,permitted);
    if(permitted)sanitizeTrackingLocation(attribution.current);
    else clearMarketingCookies();
    tracker.current.setConsent(permitted); tracker.current.pageView(); setChoice(saved); setAllowed(permitted);
  },[]);
  function choose(next: Exclude<ConsentChoice,'unknown'>) {
    if(!serverApproved) return;
    document.cookie=consentCookie(next,window.location.protocol==='https:');
    const permitted=marketingAllowed(serverApproved,next,signals());
    if(permitted)sanitizeTrackingLocation(attribution.current);
    setChoice(next); setAllowed(permitted); tracker.current?.setConsent(permitted);
    persistAttribution(storage(),attribution.current,permitted);
    if (!permitted) {
      attribution.current={ad:attribution.current.ad,utm:{}};
      sanitizeTrackingLocation(attribution.current);
      clearMarketingCookies();
    }
    if(permitted) tracker.current?.pageView();
  }
  const context:TrackingContextValue={allowed,
    dispatch(name,details) {
      if(!marketingAllowed(serverApproved,readConsent(document.cookie),signals())) { tracker.current?.setConsent(false); return; }
      const fbp=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('_fbp='))?.slice(5);
      tracker.current?.dispatch(name,{...details,ad:attribution.current.ad,fbc:buildFbc(attribution.current.fbclid,attribution.current.capturedAt??0),fbp});
    },
    sectionView(section) { if(marketingAllowed(serverApproved,readConsent(document.cookie),signals())) tracker.current?.sectionView(section); },
  };
  const notice=serverApproved?<ConsentNotice choice={choice} labels={labels} onChoose={choose}/>:null;
  return <TrackingContext.Provider value={context}><ConsentContext.Provider value={notice}>{children}{new URL(sourceUrl).pathname !== '/' && notice}</ConsentContext.Provider></TrackingContext.Provider>;
}

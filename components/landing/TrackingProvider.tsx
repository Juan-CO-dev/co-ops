"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { buildFbc, captureAttribution, persistAttribution, readAttribution, type Attribution, type AttributionPolicy } from '@/lib/landing/attribution-shared';
import { consentCookie, marketingAllowed, readConsent, type ConsentChoice } from '@/lib/landing/consent-shared';
import { browserTransport, createLandingTracker, lookupAdCode, readAdCandidate, type ActionDetails, type LandingAction } from '@/lib/landing/tracking-client';
import { queryAdCandidate } from '@/lib/landing/ad-codes-shared';
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
  const generation=useRef(0);
  const enable=useRef<() => Promise<void>>(async()=>{});
  useEffect(()=>{
    const cfg=initial.current;
    const lifecycle=generation;
    if (!cfg.serverApproved) return;
    if (!tracker.current) tracker.current=createLandingTracker({...cfg,allowedAds:['unattributed']},browserTransport());
    const permitted=()=>marketingAllowed(cfg.serverApproved,readConsent(document.cookie),signals());
    enable.current=async()=>{
      const version=++generation.current;
      tracker.current?.setConsent(false); setAllowed(false);
      if (!permitted()) return;
      const query=window.location.search;
      const explicitAd=new URLSearchParams(query).has('ad');
      const candidate=explicitAd ? queryAdCandidate(query) : readAdCandidate(storage());
      const ad=await lookupAdCode(candidate);
      // Withdrawal/unmount/re-accept invalidates an in-flight lookup, even if consent is now allowed.
      if(version!==generation.current || !permitted()) return;
      const policy={...cfg.attributionPolicy,ads:[ad,'unattributed']};
      const restored=readAttribution(storage(),policy);
      const captured=captureAttribution(query,policy,Date.now(),restored);
      attribution.current=explicitAd || captured.fbclid ? {...captured,...(!captured.fbclid && restored?.fbclid && captured.ad===restored.ad ? {fbclid:restored.fbclid,capturedAt:restored.capturedAt} : {})} : restored ?? captured;
      sanitizeTrackingLocation(attribution.current);
      persistAttribution(storage(),attribution.current,true);
      tracker.current?.setAcceptedAd(ad);
      tracker.current?.setConsent(true); tracker.current?.pageView(); setAllowed(true);
    };
    const saved=readConsent(document.cookie); setChoice(saved);
    if(permitted()) void enable.current();
    else {persistAttribution(storage(),attribution.current,false); clearMarketingCookies();}
    return ()=>{lifecycle.current++;tracker.current?.setConsent(false);};
  },[]);
  function choose(next: Exclude<ConsentChoice,'unknown'>) {
    if(!serverApproved) return;
    document.cookie=consentCookie(next,window.location.protocol==='https:');
    setChoice(next);
    if(marketingAllowed(serverApproved,next,signals())) {void enable.current();return;}
    generation.current++; setAllowed(false); tracker.current?.setConsent(false);
    attribution.current={ad:'unattributed',utm:{}};
    persistAttribution(storage(),attribution.current,false);
    sanitizeTrackingLocation(attribution.current); clearMarketingCookies();
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

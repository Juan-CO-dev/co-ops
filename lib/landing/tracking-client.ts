import { UNATTRIBUTED, validAdCandidate } from './ad-codes-shared';
import { ATTRIBUTION_KEY } from './attribution-shared';
import { validVendorPlacement } from './tracking-schema-shared';
export type LandingAction = 'OrderClick' | 'CateringClick' | 'Lead';
export interface ActionDetails { store?: string; ad?: string; placement: string; vendor?: string; fbc?: string; fbp?: string }
export type DetailsFactory = (cookiesOnly: boolean) => ActionDetails;
export interface TrackerConfig { serverApproved: boolean; pixelId?: string; capiEnabled?: boolean; sourceUrl: string; allowedStores: readonly string[]; allowedAds: readonly string[]; allowedPlacements: readonly string[] }
export interface TrackingTransport {
  loadPixel(id: string): void;
  revokePixel(): void;
  grantPixel?(): void;
  pixel(method: 'track' | 'trackCustom', name: string, params: Record<string,string>, id: string): void;
  /** `unload`: the page is navigating away now; prefer a beacon that survives unload. */
  post(path: string, payload: Record<string, unknown>, options?: { unload?: boolean }): void;
  uuid(): string;
  now(): number;
}
/** In-memory consented page lifetime, independently testable without browser globals. */
export function createLandingTracker(config: TrackerConfig, transport: TrackingTransport) {
  let consent = false, pixelLoaded = false, pageSent = false;
  const sections = new Set<string>();
  let resolving = false;
  let buffered: ((ad: string) => void)[] = [];
  const hasPixel = !!config.pixelId && /^\d{1,32}$/.test(config.pixelId);
  const safe = (action: () => void) => { try { action(); } catch { /* Analytics never affects a native action. */ } };
  const tracker = {
    beginResolution() { tracker.setConsent(false); resolving = true; },
    flushPending(ad: string) {
      const queued = buffered; buffered = []; resolving = false;
      if (consent) for (const send of queued) send(ad);
    },
    setAcceptedAd(ad: string) { config = { ...config, allowedAds: [ad, 'unattributed'] }; },
    setConsent(allowed: boolean) {
      const next = config.serverApproved && allowed;
      if (!next) { buffered = []; resolving = false; }
      if (!consent && next && pixelLoaded) safe(() => transport.grantPixel?.());
      if (consent && !next && pixelLoaded) safe(() => transport.revokePixel());
      consent = next;
      if (consent && hasPixel && !pixelLoaded) { pixelLoaded = true; safe(() => transport.loadPixel(config.pixelId!)); }
    },
    pageView() {
      if (!consent || !hasPixel || pageSent) return;
      pageSent = true; safe(() => transport.pixel('track','PageView',{},transport.uuid()));
    },
    sectionView(section: string, eventId?: string): void {
      if (resolving && config.serverApproved && buffered.length < 10) {
        const id = eventId ?? transport.uuid();
        buffered.push(() => tracker.sectionView(section, id)); return;
      }
      if (!consent || !hasPixel || sections.has(section) || !/^[a-z-]{1,40}$/.test(section)) return;
      sections.add(section); safe(() => transport.pixel('track','ViewContent',{content_name:section},eventId ?? transport.uuid()));
    },
    dispatch(name: LandingAction, intent: ActionDetails | DetailsFactory, event?: { id: string; time: number }): void {
      const navigating = resolving && config.serverApproved && (name === 'OrderClick' || name === 'CateringClick');
      if (resolving && !navigating && config.serverApproved && buffered.length < 10) {
        const original = event ?? { id: transport.uuid(), time: transport.now() };
        const resolveDetails = typeof intent === 'function' ? intent : () => ({ ...intent });
        buffered.push(ad => tracker.dispatch(name, { ...resolveDetails(false), ad }, original)); return;
      }
      const details = typeof intent === 'function' ? intent(navigating) : intent;
      if ((!consent && !navigating) || !['OrderClick','CateringClick','Lead'].includes(name) || !config.allowedPlacements.includes(details.placement)) return;
      if (details.store && !config.allowedStores.includes(details.store)) return;
      if (name === 'OrderClick' && !details.store && !details.vendor) return;
      const ad = !navigating && details.ad && config.allowedAds.includes(details.ad) ? details.ad : 'unattributed';
      const params: Record<string,string> = {ad,placement:details.placement};
      if (details.store) params.store = details.store;
      if (details.vendor) { if (name !== 'OrderClick' || !validVendorPlacement(details.vendor,details.placement,details.store)) return; params.vendor = details.vendor; }
      const id = event?.id ?? transport.uuid();
      if (!navigating && hasPixel) safe(() => transport.pixel(name === 'Lead' ? 'track' : 'trackCustom',name,params,id));
      const countClick = () => { if (name === 'OrderClick' && details.store && !details.vendor) safe(() => navigating ? transport.post('/api/landing/order-click',{store:details.store,ad},{unload:true}) : transport.post('/api/landing/order-click',{store:details.store,ad})); };
      // On a departing page our own order count is queued first, the Meta copy second.
      // (Linux WebKit has been seen delivering only one of the two; real browsers deliver both.)
      if (navigating) countClick();
      if (config.capiEnabled) {
        const payload: Record<string,unknown> = {event_name:name,event_id:id,event_time:Math.floor((event?.time ?? transport.now())/1000),consent:'accepted',source_url:config.sourceUrl,...params};
        if (details.fbc && /^fb\.1\.\d{1,16}\.[A-Za-z0-9_-]{1,500}$/.test(details.fbc)) payload.fbc=details.fbc;
        if (details.fbp && /^fb\.1\.\d{1,16}\.\d{1,30}$/.test(details.fbp)) payload.fbp=details.fbp;
        safe(() => navigating ? transport.post('/api/landing/events',payload,{unload:true}) : transport.post('/api/landing/events',payload));
      }
      if (!navigating) countClick();
    },
  };
  return tracker;
}

type Pixel = ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...args:unknown[])=>void; push?: Pixel; loaded?: boolean; version?: string };
declare global { interface Window { fbq?: Pixel; _fbq?: Pixel } }
export function browserTransport(): TrackingTransport {
  let configuredPixelId:string|undefined;
  let permitted=false;
  function schedulePixel() {
    const insert=()=>{
      if (!permitted || document.getElementById('landing-meta-pixel')) return;
      const script=document.createElement('script'); script.id='landing-meta-pixel'; script.async=true; script.src='https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(script);
    };
    // Wait for the initial document/media load, then yield the main thread.
    // No timeout forces the SDK onto a busy rendering path. Withdrawal is
    // rechecked inside the callback, including the load/idle race.
    const idle=()=>{ if(window.requestIdleCallback) window.requestIdleCallback(insert); else setTimeout(insert,200); };
    if(document.readyState==='complete') idle();
    else window.addEventListener('load',idle,{once:true});
  }
  return {
    loadPixel(id) {
      permitted=true;
      configuredPixelId=id;
      if (!window.fbq) {
        const pixel: Pixel = (...args) => { if (pixel.callMethod) pixel.callMethod(...args); else pixel.queue?.push(args); };
        pixel.queue=[]; pixel.push=pixel; pixel.loaded=true; pixel.version='2.0'; window.fbq=pixel; window._fbq=pixel;
      }
      window.fbq('consent','grant'); window.fbq('set','autoConfig',false,id); window.fbq('init',id);
      schedulePixel();
    },
    revokePixel() { permitted=false; if(window.fbq?.queue) window.fbq.queue.length=0; window.fbq?.('consent','revoke'); },
    grantPixel() {
      permitted=true;
      schedulePixel();
      window.fbq?.('consent','grant');
      // Withdrawal drops queued events while a blocked/slow SDK is still loading.
      // Re-establish initialization if that queue was discarded before SDK execution.
      if(configuredPixelId && window.fbq && !window.fbq.callMethod) {
        window.fbq('set','autoConfig',false,configuredPixelId);
        window.fbq('init',configuredPixelId);
      }
    },
    pixel(method,name,params,id) { window.fbq?.(method,name,params,{eventID:id}); },
    post(path,payload,options) {
      const body=JSON.stringify(payload);
      // A navigating page can cancel even keepalive fetches (observed: Linux WebKit).
      // Same-origin JSON beacon first; a refused or throwing beacon falls back.
      if(options?.unload && typeof navigator.sendBeacon==='function') {
        try { if(navigator.sendBeacon(path,new Blob([body],{type:'application/json'}))) return; } catch { /* fall back */ }
      }
      void fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body,credentials:'same-origin',cache:'no-store',keepalive:true}).catch(()=>{});
    },
    uuid:()=>crypto.randomUUID(), now:()=>Date.now(),
  };
}

/** Called only after consent. Never trusts a response to introduce another code. */
export async function lookupAdCode(candidate: unknown, send: typeof fetch = fetch): Promise<string> {
  if (!validAdCandidate(candidate) || candidate === UNATTRIBUTED) return UNATTRIBUTED;
  try {
    const response = await send('/api/landing/ad-code', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate }),
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return UNATTRIBUTED;
    const text = await response.text();
    if (text.length > 128) return UNATTRIBUTED;
    const data: unknown = JSON.parse(text);
    return data && typeof data === 'object' && Object.keys(data).length === 1 && 'ad' in data && data.ad === candidate ? candidate : UNATTRIBUTED;
  } catch { return UNATTRIBUTED; }
}

/** A stored code is only a candidate: caller must resolve it before use/persistence. */
export function readAdCandidate(storage: Pick<Storage, 'getItem'> | undefined): string | undefined {
  try {
    const raw = storage?.getItem(ATTRIBUTION_KEY);
    if (!raw || raw.length > 3000) return undefined;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && 'ad' in value && validAdCandidate(value.ad) ? value.ad : undefined;
  } catch { return undefined; }
}

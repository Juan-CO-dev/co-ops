import type { LandingStore } from '@/lib/landing/stores';
import type { Language } from '@/lib/i18n/types';
import { NearbyShop } from './NearbyShop';
import { serverT } from '@/lib/i18n/server';
import landingMap from '@/config/tenant/landing-map.json';

export function Shops({stores,language,ad}:{stores:readonly LandingStore[];language:Language;ad?:string}) {
  const labels={directions:Object.fromEntries(stores.map(store=>[store.key,serverT(language,'landing.shops.directions',{shop:store.name})])),nearest:serverT(language,'landing.shops.nearest'),locating:serverT(language,'landing.shops.locating'),unavailable:serverT(language,'landing.shops.location-unavailable'),straightLine:serverT(language,'landing.shops.straight-line'),distance:serverT(language,'landing.shops.distance'),distanceOne:serverT(language,'landing.shops.distance-one'),offer:serverT(language,'landing.offer.code'),call:Object.fromEntries(stores.map(store=>[store.key,serverT(language,'landing.shops.call',{shop:store.name})])),order:Object.fromEntries(stores.map(store=>[store.key,serverT(language,'landing.order',{shop:store.orderLabel})]))};
  const map={...landingMap,labels:{map:serverT(language,'landing.shops.map'),you:serverT(language,'landing.shops.you'),attribution:serverT(language,'landing.shops.map-attribution'),attributionHref:'https://www.openstreetmap.org/copyright',offMap:serverT(language,'landing.shops.off-map')}};
  return <NearbyShop stores={stores} language={language} labels={{...labels,uberEats:serverT(language,'landing.footer.uber-eats')}} ad={ad} map={map}/>;
}

import type { LandingStore } from '@/lib/landing/stores';
import type { Language } from '@/lib/i18n/types';
import { serverT } from '@/lib/i18n/server';
import { validCoordinates } from '@/lib/landing/nearby-shared';

/** Coordinate-based schematic only: no tiles, location requests or routing claims. */
export function ShopMap({stores,language}:{stores:readonly LandingStore[];language:Language}) {
  const points=stores.filter(store=>validCoordinates(store.coordinates));
  if (!points.length) return null;
  const latitudes=points.map(store=>store.coordinates!.latitude);
  const longitudes=points.map(store=>store.coordinates!.longitude);
  const minLat=Math.min(...latitudes), maxLat=Math.max(...latitudes);
  const minLon=Math.min(...longitudes), maxLon=Math.max(...longitudes);
  // One scale for both axes; longitude is corrected at the local mean latitude.
  const longitudeScale=Math.cos((minLat+maxLat)/2*Math.PI/180);
  const width=(maxLon-minLon)*longitudeScale, height=maxLat-minLat;
  const scale=Math.min(width>0?170/width:Infinity,height>0?85/height:Infinity);
  const finiteScale=Number.isFinite(scale)?scale:0;
  return <figure data-shop-map className="mt-6 rounded-xl border border-co-border p-4">
    <svg viewBox="0 0 320 180" role="img" aria-label={serverT(language,'landing.shops.map')} className="w-full max-w-lg">
      <rect x="1" y="1" width="318" height="178" rx="12" fill="none" stroke="currentColor"/>
      {points.map(store=>{
        const x=155+(store.coordinates!.longitude-(minLon+maxLon)/2)*longitudeScale*finiteScale;
        const y=87.5-(store.coordinates!.latitude-(minLat+maxLat)/2)*finiteScale;
        return <g key={store.key}><circle cx={x} cy={y} r="7" fill="currentColor"/><text x={x} y={y+25} textAnchor="middle" fill="currentColor" fontSize="14">{store.name}</text></g>;
      })}
    </svg>
    <figcaption className="text-sm"><p>{serverT(language,'landing.shops.schematic')}</p><a href="https://www.openstreetmap.org/copyright" className="inline-flex min-h-11 items-center underline">{serverT(language,'landing.shops.map-attribution')}</a></figcaption>
  </figure>;
}

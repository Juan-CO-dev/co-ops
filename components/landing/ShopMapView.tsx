"use client";
import type {CSSProperties} from 'react';
import {edgeMarker,fitView,insideMap,type MapPoint} from '@/lib/landing/map-shared';

export interface MapShop {key:string;name:string;point:MapPoint}
/** The self-hosted street map. The visitor's dot is placed from in-memory coordinates only;
 * nothing here makes a request that depends on where they are. */
export function ShopMapView({src,width,height,shops,user,nearest,labels}:{src:string;width:number;height:number;shops:readonly MapShop[];user:MapPoint|null;nearest:string|null;labels:{map:string;you:string;attribution:string;attributionHref:string;offMap:string}}) {
  const target=shops.find(shop=>shop.key===nearest);
  const onMap=!!user&&insideMap(user,.02);
  const view=user&&onMap&&target?fitView([user,target.point]):{scale:1,x:0,y:0};
  const arrow=user&&!onMap&&target?edgeMarker(target.point,user):null;
  const pct=(n:number)=>`${(n*100).toFixed(3)}%`;
  return <figure data-shop-map className="landing-v3-map">
    <div className="landing-v3-map-frame" role="img" aria-label={labels.map}>
      <div className="landing-v3-map-canvas" style={{transform:`translate(${pct(view.x)},${pct(view.y)}) scale(${view.scale})`,'--map-scale':view.scale} as CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={width} height={height} alt="" loading="lazy" decoding="async"/>
        {shops.map(shop=><span key={shop.key} data-map-pin={shop.key} data-nearest={shop.key===nearest} className="landing-v3-map-pin" style={{left:pct(shop.point.x),top:pct(shop.point.y)}}><span>{shop.name}</span></span>)}
        {user&&onMap&&<span data-map-you className="landing-v3-map-you" style={{left:pct(user.x),top:pct(user.y)}}><span>{labels.you}</span></span>}
      </div>
      {arrow&&<span data-map-offmap className="landing-v3-map-arrow" style={{left:pct(arrow.x),top:pct(arrow.y),'--arrow-deg':`${arrow.degrees}deg`} as CSSProperties} aria-hidden="true"/>}
    </div>
    {arrow&&<p className="landing-v3-map-note">{labels.offMap}</p>}
    <figcaption><a href={labels.attributionHref} className="inline-flex min-h-11 items-center text-sm underline">{labels.attribution}</a></figcaption>
  </figure>;
}

import { LandingConsentSlot } from "./TrackingProvider";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { LandingConfig } from "@/lib/landing/config";
import { heroMedia } from "@/lib/landing/media";
import { orderDetail } from "@/lib/landing/order-details";
import { SectionView } from "./SectionView";
import { OrderLink } from "./OrderLink";
import { OfferCode } from "./OfferCode";
import { preload } from "react-dom";
import { HeroZoom } from "./HeroZoom";

export function Hero({language, config, ad, now}:{language:Language;config:LandingConfig;ad:string;now?:Date}) {
  preload(heroMedia.poster, { as: 'image', imageSrcSet: heroMedia.srcSet, imageSizes: heroMedia.sizes, fetchPriority: 'high' });
  return <section id="hero" aria-labelledby="hero-title" className="landing-v2-hero">
    <SectionView section="hero">
      <div className="landing-v2-hero-grid">
        <div className="landing-v2-hero-copy">
          <div className="landing-v2-eyebrow">{serverT(language,"landing.hero.eyebrow")}</div>
          <h1 id="hero-title">{serverT(language,"landing.hero.title").split("\n").map((line,index)=><span key={line}>{index>0?'\n':''}{line}</span>)}</h1>
          <p>{serverT(language,"landing.hero.body")}</p>
          <div data-hero-actions>
            <div className="landing-v2-orders">{config.stores.map(store=>{
              const detail=orderDetail(store,language,now);
              // One accessible name, read in order: "Order Capitol Hill · 8th St SE · til 6 PM".
              return <OrderLink key={store.key} href={store.orderUrl} store={store.key} placement="hero" className="landing-v2-order landing-v4-order-two">
                <span>{serverT(language,"landing.order",{shop:store.orderLabel})}</span><span className="sr-only"> · </span><span className="landing-v4-order-detail" data-order-detail>{detail.line}</span>
              </OrderLink>;
            })}</div>
            {config.stores.length>0&&<a href="#shops" className="landing-v4-find-shop">{serverT(language,"landing.hero.find-shop")}</a>}
          </div>
          {config.stores.map(store=><OfferCode key={store.key} ad={ad} store={store.key} label={serverT(language,"landing.offer.code")}/>)}
          <div id="landing-consent-slot"><LandingConsentSlot/></div>
        </div>
        {/* Original P013, uniform object-cover crop. Copy never overlays it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div data-hero-zoom className="landing-v2-hero-media"><img data-landing-photo src={heroMedia.poster} srcSet={heroMedia.srcSet} sizes={heroMedia.sizes} alt={serverT(language,"landing.hero.alt")} width={heroMedia.width} height={heroMedia.height} fetchPriority="high" loading="eager" className="landing-v2-hero-photo"/></div>
      </div>
      <HeroZoom/>
    </SectionView>
  </section>;
}

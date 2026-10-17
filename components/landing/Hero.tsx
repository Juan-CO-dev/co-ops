import { LandingConsentSlot } from "./TrackingProvider";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { LandingConfig } from "@/lib/landing/config";
import { heroMedia } from "@/lib/landing/media";
import { SectionView } from "./SectionView";
import { getLandingLinks } from "@/lib/landing/links";
import { OrderLink } from "./OrderLink";
import { OfferCode } from "./OfferCode";
import { preload } from "react-dom";

export function Hero({language, config, ad}:{language:Language;config:LandingConfig;ad:string}) {
  preload(heroMedia.poster, { as: 'image', imageSrcSet: heroMedia.srcSet, imageSizes: heroMedia.sizes, fetchPriority: 'high' });
  return <section id="hero" aria-labelledby="hero-title" className="landing-v2-hero">
    <SectionView section="hero">
      <div className="landing-v2-hero-grid">
        <div className="landing-v2-hero-copy">
          <h1 id="hero-title">{serverT(language,"landing.hero.title")}</h1>
          <p>{serverT(language,"landing.hero.body")}</p>
          <div data-hero-actions>
            <div className="landing-v2-orders">{config.stores.map(store=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement="hero" className="landing-v2-order">{serverT(language,"landing.order",{shop:store.orderLabel})}</OrderLink>)}</div>
            <OrderLink href={getLandingLinks(config).catering} placement="catering" event="CateringClick" className="landing-v2-catering-link">{serverT(language,"landing.catering.order")}</OrderLink>
          </div>
          {config.stores.map(store=><OfferCode key={store.key} ad={ad} store={store.key} label={serverT(language,"landing.offer.code")}/>)}
          <div id="landing-consent-slot"><LandingConsentSlot/></div>
        </div>
        {/* Original P013, full-frame uniform delivery resize. Copy never overlays it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={heroMedia.poster} srcSet={heroMedia.srcSet} sizes={heroMedia.sizes} alt={serverT(language,"landing.hero.alt")} width={heroMedia.width} height={heroMedia.height} fetchPriority="high" loading="eager" className="landing-v2-hero-photo"/>
      </div>
    </SectionView>
  </section>;
}

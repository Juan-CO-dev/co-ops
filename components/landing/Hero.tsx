import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { LandingConfig } from "@/lib/landing/config";
import { heroMedia } from "@/lib/landing/media";
import { SectionView } from "./SectionView";
import { HeroMotion } from "./HeroMotion";
import { OrderLink } from "./OrderLink";
import { OfferCode } from "./OfferCode";

export function Hero({language, config, ad}:{language:Language;config:LandingConfig;ad:string}) {
  return <section id="hero" aria-labelledby="hero-title" className="rounded-3xl bg-[#FFE560] px-5 py-7 sm:px-8 sm:py-10">
    <link rel="preload" as="image" href={heroMedia.poster} fetchPriority="high"/>
    <SectionView section="hero">
      <div className="grid items-center gap-6 md:grid-cols-2">
        <div>
          <h1 id="hero-title" className="max-w-xl text-4xl font-black tracking-tight sm:text-6xl">{serverT(language,"landing.hero.title")}</h1>
          <p className="mt-4 max-w-xl text-lg">{serverT(language,"landing.hero.body")}</p>
          <div className="mt-6 flex flex-wrap gap-3">{config.stores.map(store=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement="hero" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-co-cta px-5 py-3 font-bold text-co-text">{serverT(language,"landing.order",{shop:store.orderLabel})}</OrderLink>)}</div>
          {config.stores.map(store=><OfferCode key={store.key} ad={ad} store={store.key} label={serverT(language,"landing.offer.code")}/>)}
        </div>
        <HeroMotion src={heroMedia.spin} pauseLabel={serverT(language,"landing.hero.pause")} playLabel={serverT(language,"landing.hero.play")}>
          {/* Original photo, crop/encode only; no image optimizer or alpha decoder dependency. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroMedia.poster} alt={serverT(language,"landing.hero.alt")} width={heroMedia.width} height={heroMedia.height} fetchPriority="high" loading="eager" className="block aspect-[2/3] max-h-[28rem] w-full object-contain"/>
        </HeroMotion>
      </div>
    </SectionView>
  </section>;
}

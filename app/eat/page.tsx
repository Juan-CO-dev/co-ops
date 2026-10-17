import { PlayfulTouch } from "@/components/landing/PlayfulTouch";
import { CraveScene } from "@/components/landing/CraveScene";
import { FieldGuide } from "@/components/landing/FieldGuide";
import { StickyOrderBar } from "@/components/landing/StickyOrderBar";
import { IllustratedSpin } from "@/components/landing/IllustratedSpin";
import { heroMedia } from "@/lib/landing/media";
import { Lineup } from "@/components/landing/Lineup";
import { Hero } from "@/components/landing/Hero";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { classifyLandingHost } from "@/lib/landing/host-shared";
import { loadLandingConfig } from "@/lib/landing/config";
import { loadPublicLandingStores } from "@/lib/landing/stores";
import { Shops } from "@/components/landing/Shops";
import { Catering } from "@/components/landing/Catering";
import { Footer } from "@/components/landing/Footer";
import { SubdexMoment } from "@/components/landing/SubdexMoment";
import { resolveLandingLanguage } from "@/lib/landing/language-shared";
import { serverT } from "@/lib/i18n/server";
import { TENANT_NAME } from "@/lib/tenant";
import { LanguageToggle } from "@/components/landing/LanguageToggle";
import { OrderLink } from "@/components/landing/OrderLink";
import { OfferCode } from "@/components/landing/OfferCode";
import { captureAttribution } from "@/lib/landing/attribution-shared";
import { CateringLink } from "@/components/landing/CateringLink";
import { SectionView } from "@/components/landing/SectionView";
import { FaqItem } from "@/components/landing/FaqItem";

export const dynamic = "force-dynamic";
export default async function LandingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const config = loadLandingConfig();
  const requestHeaders = await headers();
  if (classifyLandingHost(requestHeaders,config) !== "landing") notFound();
  const query = await searchParams;
  const language = resolveLandingLanguage(query.lang,requestHeaders.get("accept-language"));
  const stores = await loadPublicLandingStores(config);
  const publicStores = config.stores.filter(store=>stores.some(publicStore=>publicStore.key===store.key));
  const queryString = new URLSearchParams(Object.entries(query).flatMap(([key,value])=>typeof value === "string" ? [[key,value]] : Array.isArray(value) ? value.map((v)=>[key,v]) : [])).toString();
  const sectionKeys = ["crave","lineup","field-guide","subdex","catering","shops","footer"] as const;
  return <div lang={language} className="landing-v2-page">
    <header className="landing-v2-header"><img loading="eager" src="/brand/co-wordmark.svg" fetchPriority="low" alt={TENANT_NAME} width={1125} height={140} className="h-12 w-44 object-contain"/><CateringLink config={config} language={language}/><LanguageToggle language={language} query={queryString} label={serverT(language,"landing.language")} policy={config.attribution}/></header>
    <main>
      <Hero language={language} config={{...config,stores:publicStores}} ad={captureAttribution(queryString,config.attribution).ad}/>
      {sectionKeys.filter(key=>key !== "shops" || stores.length > 0).map(key=><section key={key} id={key} aria-labelledby={`${key}-title`} className="landing-v2-section">
        <SectionView section={key} observationTargetId={key === "crave" ? "crave-title" : undefined}>
          <h2 id={`${key}-title`} className="text-3xl font-black tracking-tight">{serverT(language,`landing.${key}.title`)}</h2>
          <p className="mt-4 max-w-xl text-lg">{serverT(language,`landing.${key}.body`)}</p>
          {key === "crave" && <><CraveScene textureAlt={serverT(language,"landing.texture.alt")} crossAlt={serverT(language,"landing.texture.cross-alt")} stillLabel={serverT(language,"landing.texture.still")} motionLabel={serverT(language,"landing.texture.motion")}/><PlayfulTouch slot="crave"/></>}
          {key === "field-guide" && <FieldGuide language={language}/>}
          {key === "lineup" && <Lineup language={language}/>}
          {(key === "crave" || key === "subdex" || key === "field-guide" || key === "lineup") && <div className="landing-v2-inline-orders">{publicStores.map(store=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement={key} className="landing-v2-inline-order">{serverT(language,"landing.order",{shop:store.orderLabel})}</OrderLink>)}</div>}
          {key === "field-guide" && publicStores.map((store) => <OfferCode key={store.key} ad={captureAttribution(queryString,config.attribution).ad} store={store.key} label={serverT(language,"landing.offer.code")}/>)}
          {key === "field-guide" && <div className="mt-6"><FaqItem q={serverT(language,"landing.faq.question")} a={serverT(language,"landing.faq.answer")}/></div>}
          {key === "subdex" && <><SubdexMoment language={language}/><IllustratedSpin src={heroMedia.spin} label={serverT(language,"landing.spin.illustrated")} playLabel={serverT(language,"landing.hero.play")}/></>}
          {key === "shops" && <Shops stores={stores} language={language} ad={captureAttribution(queryString,config.attribution).ad}/>}
          {key === "catering" && <Catering config={config} language={language}/>}
          {key === "footer" && <Footer config={config} stores={stores} language={language}/>}
        </SectionView>
      </section>)}
    </main>
    <StickyOrderBar stores={publicStores.map(store=>({key:store.key,orderUrl:store.orderUrl,label:serverT(language,"landing.order",{shop:store.orderLabel})}))} labels={{name:serverT(language,"landing.sticky.name"),minimize:serverT(language,"landing.sticky.minimize"),restore:serverT(language,"landing.sticky.restore"),hint:serverT(language,"landing.sticky.hint1")}}/>
  </div>;
}

import { orderDetailsByStore } from "@/lib/landing/order-details";
import { resolveAdCode } from "@/lib/landing/ad-codes-server";
import { queryAdCandidate } from "@/lib/landing/ad-codes-shared";
import { ShopStructuredData } from "@/components/landing/ShopStructuredData";
import { CraveScene } from "@/components/landing/CraveScene";
import { FieldGuide } from "@/components/landing/FieldGuide";
import { StickyOrderBar } from "@/components/landing/StickyOrderBar";
import { Lineup } from "@/components/landing/Lineup";
import { Hero } from "@/components/landing/Hero";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { classifyLandingHost, configuredOrigin } from "@/lib/landing/host-shared";
import { loadLandingConfig } from "@/lib/landing/config";
import { loadPublicLandingStores } from "@/lib/landing/stores";
import { Shops } from "@/components/landing/Shops";
import { Catering } from "@/components/landing/Catering";
import { Footer } from "@/components/landing/Footer";
import { MotionPolicy } from "@/components/landing/MotionPolicy";
import { resolveLandingLanguage } from "@/lib/landing/language-shared";
import { serverT } from "@/lib/i18n/server";
import { TENANT_NAME } from "@/lib/tenant";
import { LanguageToggle } from "@/components/landing/LanguageToggle";
import { OfferCode } from "@/components/landing/OfferCode";
import { captureAttribution } from "@/lib/landing/attribution-shared";
import { CateringLink } from "@/components/landing/CateringLink";
import { SectionView } from "@/components/landing/SectionView";
import { CrunchyOrder } from "@/components/landing/CrunchyOrder";
import { spriteMedia } from "@/lib/landing/media";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";
export default async function LandingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const config = loadLandingConfig();
  const requestHeaders = await headers();
  if (classifyLandingHost(requestHeaders,config) !== "landing") notFound();
  const origin = configuredOrigin(config.SITE_ORIGIN);
  if (!origin) notFound();
  const query = await searchParams;
  const language = resolveLandingLanguage(query.lang,requestHeaders.get("accept-language"));
  const queryString = new URLSearchParams(Object.entries(query).flatMap(([key,value])=>typeof value === "string" ? [[key,value]] : Array.isArray(value) ? value.map((v)=>[key,v]) : [])).toString();
  const [stores, acceptedAd] = await Promise.all([loadPublicLandingStores(config), resolveAdCode(queryAdCandidate(queryString))]);
  const publicStores = config.stores.filter(store=>stores.some(publicStore=>publicStore.key===store.key));
  const attributionPolicy = { ...config.attribution, ads: [acceptedAd, "unattributed"] };
  const ad = captureAttribution(queryString, attributionPolicy).ad;
  const sectionKeys = ["crave","lineup","field-guide","catering","shops","footer"] as const;
  // One clock for the whole render: today's closing time (static hours, America/New_York).
  const now = new Date();
  // Street + today's closing line per shop, computed once and shared by every order surface.
  const details = orderDetailsByStore(stores, language, now);
  // The P1 hop sprite is drawn by CSS only when an order control is tapped.
  const pageStyle = { "--landing-p1-hop": `url("${spriteMedia.p1Jump.src}")` } as CSSProperties;
  return <div lang={language} className="landing-v2-page" style={pageStyle}>
    <ShopStructuredData origin={origin.origin} stores={stores}/>
    <MotionPolicy/>
    <header className="landing-v2-header"><img loading="eager" src="/brand/co-wordmark.svg" fetchPriority="low" alt={TENANT_NAME} width={1125} height={140} className="h-12 w-44 object-contain"/><CateringLink config={config} language={language}/><LanguageToggle language={language} query={queryString} label={serverT(language,"landing.language")} policy={attributionPolicy}/></header>
    <main>
      <Hero language={language} config={{...config,stores:publicStores}} ad={ad} details={details}/>
      {sectionKeys.filter(key=>key !== "shops" || stores.length > 0).map(key=><section key={key} id={key} aria-labelledby={`${key}-title`} className="landing-v2-section">
        <SectionView section={key} observationTargetId={key === "crave" ? "crave-title" : undefined}>
          <h2 id={`${key}-title`} className="text-3xl font-black tracking-tight">{serverT(language,`landing.${key}.title`)}</h2>
          <p className="mt-4 max-w-xl text-lg">{serverT(language,`landing.${key}.body`)}</p>
          {key === "crave" && <><CraveScene textureAlt={serverT(language,"landing.texture.alt")} crossAlt={serverT(language,"landing.texture.cross-alt")} stillLabel={serverT(language,"landing.texture.still")} motionLabel={serverT(language,"landing.texture.motion")} captions={[serverT(language,"landing.crave.caption-texture"),serverT(language,"landing.crave.caption-cross")]}/><div className="landing-v4-crave-cta"><CrunchyOrder language={language} stores={stores} placement="crave" label={serverT(language,"landing.crave.order")} details={details}/></div></>}
          {key === "field-guide" && <FieldGuide language={language} stores={stores} details={details}/>}
          {key === "lineup" && <Lineup language={language} stores={stores} details={details}/>}
          {key === "field-guide" && publicStores.map((store) => <OfferCode key={store.key} ad={ad} store={store.key} label={serverT(language,"landing.offer.code")}/>)}
          {key === "shops" && <Shops stores={stores} language={language} ad={ad} details={details}/>}
          {key === "catering" && <Catering config={config} language={language}/>}
          {key === "footer" && <Footer config={config} stores={stores} language={language}/>}
        </SectionView>
      </section>)}
    </main>
    <StickyOrderBar stores={publicStores.map(store=>({key:store.key,orderUrl:store.orderUrl,label:serverT(language,"landing.order",{shop:store.orderLabel})}))} labels={{name:serverT(language,"landing.sticky.name"),minimize:serverT(language,"landing.sticky.minimize"),restore:serverT(language,"landing.sticky.restore"),hint:serverT(language,"landing.sticky.hint1")}}/>
  </div>;
}

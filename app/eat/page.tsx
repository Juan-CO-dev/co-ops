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
import { SectionView } from "@/components/landing/SectionView";
import { Reveal } from "@/components/portal/Reveal";
import { FaqItem } from "@/components/portal/FaqItem";

export const dynamic = "force-dynamic";
export default async function LandingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const config = loadLandingConfig();
  const requestHeaders = await headers();
  if (classifyLandingHost(requestHeaders,config) !== "landing") notFound();
  const query = await searchParams;
  const language = resolveLandingLanguage(query.lang,requestHeaders.get("accept-language"));
  const stores = await loadPublicLandingStores(config);
  const queryString = new URLSearchParams(Object.entries(query).flatMap(([key,value])=>typeof value === "string" ? [[key,value]] : Array.isArray(value) ? value.map((v)=>[key,v]) : [])).toString();
  const sectionKeys = ["field-guide","lineup","subdex","shops","catering","footer"] as const;
  return <div lang={language} className="mx-auto max-w-5xl px-5 pb-28 [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-center justify-between gap-4 py-5"><img src="/brand/co-wordmark.svg" alt={TENANT_NAME} width={1125} height={140} className="h-12 w-44 object-contain"/><LanguageToggle language={language} query={queryString} label={serverT(language,"landing.language")} policy={config.attribution}/></header>
    <main>
      <Hero language={language} config={config} ad={captureAttribution(queryString,config.attribution).ad}/>
      {sectionKeys.map(key=><section key={key} id={key} aria-labelledby={`${key}-title`} className="border-t border-co-border py-10 sm:py-14">
        <SectionView section={key}>
          <h2 id={`${key}-title`} className="text-3xl font-black tracking-tight">{serverT(language,`landing.${key}.title`)}</h2>
          <p className="mt-4 max-w-xl text-lg">{serverT(language,`landing.${key}.body`)}</p>
          {key === "lineup" && <Lineup language={language}/>}
          {(key === "field-guide" || key === "lineup") && <div className="mt-6 flex flex-wrap items-center gap-3">{config.stores.map((store)=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement={key} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-co-cta px-5 py-3 font-bold text-co-text">{serverT(language,"landing.order",{shop:store.orderLabel})}</OrderLink>)}</div>}
          {key === "field-guide" && config.stores.map((store) => <OfferCode key={store.key} ad={captureAttribution(queryString,config.attribution).ad} store={store.key} label={serverT(language,"landing.offer.code")}/>)}
          {key === "field-guide" && <div className="mt-6"><Reveal><FaqItem q={serverT(language,"landing.faq.question")} a={serverT(language,"landing.faq.answer")}/></Reveal></div>}
          {key === "subdex" && <SubdexMoment language={language}/>}
          {key === "shops" && <Shops stores={stores} language={language} ad={captureAttribution(queryString,config.attribution).ad}/>}
          {key === "catering" && <Catering config={config} language={language}/>}
          {key === "footer" && <Footer config={config} stores={stores} language={language}/>}
        </SectionView>
      </section>)}
    </main>
  </div>;
}

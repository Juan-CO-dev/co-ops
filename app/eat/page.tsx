import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { classifyLandingHost } from "@/lib/landing/host-shared";
import { loadLandingConfig } from "@/lib/landing/config";
import { getLandingLinks } from "@/lib/landing/links";
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
import { GoodToKnow } from "@/components/portal/GoodToKnow";

export const dynamic = "force-dynamic";
export default async function LandingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const config = loadLandingConfig();
  const requestHeaders = await headers();
  if (classifyLandingHost(requestHeaders,config) !== "landing") notFound();
  const query = await searchParams;
  const language = resolveLandingLanguage(query.lang,requestHeaders.get("accept-language"));
  const links = getLandingLinks(config);
  const queryString = new URLSearchParams(Object.entries(query).flatMap(([key,value])=>typeof value === "string" ? [[key,value]] : Array.isArray(value) ? value.map((v)=>[key,v]) : [])).toString();
  const sectionKeys = ["hero","field-guide","lineup","subdex","shops","catering","footer"] as const;
  return <div lang={language} className="mx-auto max-w-5xl px-5 pb-28">
    <header className="flex flex-wrap items-center justify-between gap-4 py-5"><span className="text-xl font-black">{TENANT_NAME}</span><LanguageToggle language={language} query={queryString} label={serverT(language,"landing.language")} policy={config.attribution}/></header>
    <main>
      {sectionKeys.map((key,index)=><section key={key} id={key} aria-labelledby={`${key}-title`} className="border-t border-co-border py-10 sm:py-14">
        <SectionView section={key}>
          {index === 0 ? <h1 id={`${key}-title`} className="max-w-xl text-4xl font-black tracking-tight sm:text-6xl">{serverT(language,`landing.${key}.title`)}</h1> : <h2 id={`${key}-title`} className="text-3xl font-black tracking-tight">{serverT(language,`landing.${key}.title`)}</h2>}
          <p className="mt-4 max-w-xl text-lg">{serverT(language,`landing.${key}.body`)}</p>
          {(key === "hero" || key === "field-guide" || key === "shops") && <div className="mt-6 flex flex-wrap items-center gap-3">{config.stores.map((store)=><OrderLink key={store.key} href={store.orderUrl} store={store.key} placement={key} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-co-cta px-5 py-3 font-bold text-co-text">{serverT(language,"landing.order",{shop:store.orderLabel})}</OrderLink>)}</div>}
          {(key === "hero" || key === "field-guide" || key === "shops") && config.stores.map((store) => <OfferCode key={store.key} ad={captureAttribution(queryString,config.attribution).ad} store={store.key} label={serverT(language,"landing.offer.code")}/>)}
          {key === "field-guide" && <div className="mt-6"><Reveal><FaqItem q={serverT(language,"landing.faq.question")} a={serverT(language,"landing.faq.answer")}/></Reveal></div>}
          {key === "shops" && <div className="mt-6"><GoodToKnow items={[serverT(language,"landing.shops.body")]} label={serverT(language,"landing.good-to-know")} tone="dark"/></div>}
          {key === "catering" && <div className="mt-6 flex flex-wrap items-center gap-3"><OrderLink href={links.catering} placement="catering" event="CateringClick" className="inline-flex min-h-11 items-center rounded-xl bg-co-cta px-5 py-3 font-bold text-co-text">{serverT(language,"landing.catering.order")}</OrderLink><OrderLink href={links.inquiry} placement="catering" event="Lead" className="inline-flex min-h-11 items-center rounded-xl border-2 border-co-cta-text px-5 py-3 font-bold text-co-cta-text">{serverT(language,"landing.catering.inquiry")}</OrderLink></div>}
          {key === "footer" && <a href={`/privacy?lang=${language}`} className="mt-4 inline-flex min-h-11 items-center underline">{serverT(language,"landing.privacy.link")}</a>}
        </SectionView>
      </section>)}
    </main>
  </div>;
}

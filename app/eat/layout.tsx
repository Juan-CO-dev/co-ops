import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { classifyLandingHost } from "@/lib/landing/host-shared";
import { loadLandingConfig } from "@/lib/landing/config";
import { resolveLandingLanguage } from "@/lib/landing/language-shared";
import { serverT } from "@/lib/i18n/server";
import { TENANT_NAME } from "@/lib/tenant";
import { TrackingProvider } from "@/components/landing/TrackingProvider";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: TENANT_NAME, robots:{index:false,follow:false}, icons:{icon:"/eat/icon.png",apple:"/eat/apple-icon.png"}, openGraph:{images:[]}, twitter:{images:[]} };

export default async function LandingLayout({children}:{children:ReactNode}) {
  const config = loadLandingConfig();
  const requestHeaders = await headers();
  if (classifyLandingHost(requestHeaders,config) !== "landing") notFound();
  const language = resolveLandingLanguage(requestHeaders.get("x-landing-language"),requestHeaders.get("accept-language"));
  const labels = {
    notice:serverT(language,"landing.consent.notice"), accept:serverT(language,"landing.consent.accept"), reject:serverT(language,"landing.consent.reject"), settings:serverT(language,"landing.consent.settings"), withdraw:serverT(language,"landing.consent.withdraw"), privacy:serverT(language,"landing.privacy.link"),
  };
  return <div lang={language} className="min-h-screen bg-co-bg text-co-text">
    <TrackingProvider serverApproved={true} pixelId={config.pixelId} capiEnabled={process.env.LANDING_CAPI_ENABLED === "true"} sourceUrl={`${config.siteOrigin}${requestHeaders.get("x-landing-path") === "/privacy" ? "/privacy" : "/"}`} allowedStores={config.stores.map((store) => store.key)} allowedPlacements={["hero","field-guide","shops","catering","footer"]} attributionPolicy={config.attribution} labels={labels}>{children}</TrackingProvider>
  </div>;
}

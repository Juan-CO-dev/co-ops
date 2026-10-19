import { LANDING_PLACEMENTS } from "@/lib/landing/tracking-schema-shared";
import "./landing-v2.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { classifyLandingHost, configuredOrigin } from "@/lib/landing/host-shared";
import { loadLandingConfig } from "@/lib/landing/config";
import { resolveLandingLanguage } from "@/lib/landing/language-shared";
import { serverT } from "@/lib/i18n/server";
import { TENANT_NAME } from "@/lib/tenant";
import { TrackingProvider } from "@/components/landing/TrackingProvider";

export const dynamic = "force-dynamic";
export const viewport: Viewport = { themeColor: "#FFF9E4" };
export async function generateMetadata(): Promise<Metadata> {
  const config = loadLandingConfig();
  const requestHeaders = await headers();
  if (classifyLandingHost(requestHeaders, config) !== "landing") notFound();
  const origin = configuredOrigin(config.SITE_ORIGIN);
  if (!origin) notFound();
  const language = resolveLandingLanguage(requestHeaders.get("x-landing-language"), requestHeaders.get("accept-language"));
  const title = serverT(language, "landing.metadata.title", { brand: TENANT_NAME });
  const description = serverT(language, "landing.metadata.description");
  const canonical = new URL(requestHeaders.get("x-landing-path") === "/privacy" ? "/privacy" : "/", origin);
  const english = canonical.href;
  const spanish = `${english}?lang=es`;
  if (requestHeaders.get("x-landing-explicit-language") === "es") canonical.search = "?lang=es";
  const indexable = requestHeaders.get("x-landing-indexable") === "1";
  return {
    metadataBase: new URL(origin), title, description,
    alternates: { canonical: canonical.href, languages: { "en-US": english, "es-US": spanish, "x-default": english } },
    robots: { index: indexable, follow: indexable },
    icons: { icon: "/eat/icon.png", apple: "/eat/apple-icon.png" },
    openGraph: { title, description, url: canonical.href, locale: language === "es" ? "es_US" : "en_US", images: [{url:"/brand/og-card.webp",width:1200,height:630}] },
    twitter: { title, description, images: ["/brand/og-card.webp"] },
  };
}

export default async function LandingLayout({children}:{children:ReactNode}) {
  const config = loadLandingConfig();
  const requestHeaders = await headers();
  if (classifyLandingHost(requestHeaders,config) !== "landing") notFound();
  const origin = configuredOrigin(config.SITE_ORIGIN);
  if (!origin) notFound();
  const language = resolveLandingLanguage(requestHeaders.get("x-landing-language"),requestHeaders.get("accept-language"));
  const labels = {
    notice:serverT(language,"landing.consent.notice"), accept:serverT(language,"landing.consent.accept"), reject:serverT(language,"landing.consent.reject"), settings:serverT(language,"landing.consent.settings"), withdraw:serverT(language,"landing.consent.withdraw"), privacy:serverT(language,"landing.privacy.link"), language,
  };
  return <div lang={language} className="landing-v2 min-h-screen bg-co-bg text-co-text">
    <TrackingProvider serverApproved={true} pixelId={config.pixelId} capiEnabled={process.env.LANDING_CAPI_ENABLED === "true"} sourceUrl={`${origin.origin}${requestHeaders.get("x-landing-path") === "/privacy" ? "/privacy" : "/"}`} allowedStores={config.stores.map((store) => store.key)} allowedPlacements={LANDING_PLACEMENTS} attributionPolicy={config.attribution} labels={labels}>{children}</TrackingProvider>
  </div>;
}

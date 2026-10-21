import { resolveAdCode } from "@/lib/landing/ad-codes-server";
import { queryAdCandidate } from "@/lib/landing/ad-codes-shared";
import { headers } from "next/headers";
import { resolveLandingLanguage } from "@/lib/landing/language-shared";
import { serverT } from "@/lib/i18n/server";
import { loadLandingConfig } from "@/lib/landing/config";
import { LanguageToggle } from "@/components/landing/LanguageToggle";
import { PrivacySettingsButton } from "@/components/landing/PrivacySettingsButton";
export default async function PrivacyPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const query = await searchParams;
  const queryString = new URLSearchParams(Object.entries(query).flatMap(([key,value]) => typeof value === "string" ? [[key,value]] : Array.isArray(value) ? value.map((v) => [key,v]) : [])).toString();
  const language = resolveLandingLanguage(query.lang,(await headers()).get("accept-language"));
  const acceptedAd = await resolveAdCode(queryAdCandidate(queryString));
  return <main lang={language} className="mx-auto max-w-2xl space-y-6 px-5 py-10 pb-32">
    <LanguageToggle language={language} query={queryString} path="/privacy" policy={{...loadLandingConfig().attribution, ads:[acceptedAd,"unattributed"]}} label={serverT(language,"landing.language")}/>
    <h1 className="text-3xl font-black">{serverT(language,"landing.privacy.title")}</h1>
    <p>{serverT(language,"landing.privacy.body")}</p><p>{serverT(language,"landing.privacy.meta")}</p>
    <div className="flex flex-wrap items-center gap-x-6"><a href={`/?lang=${language}`} className="inline-flex min-h-11 items-center underline">{serverT(language,"landing.privacy.back")}</a><PrivacySettingsButton label={serverT(language,"landing.consent.settings")}/></div>
  </main>;
}

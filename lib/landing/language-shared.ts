import type { Language } from "@/lib/i18n/types";
import { captureAttribution } from "./attribution-shared";
import { landingTenantConfig } from "@/config/tenant/landing";

export function resolveLandingLanguage(query: unknown, acceptLanguage: string | null): Language {
  if (query === "en" || query === "es") return query;
  const preferences = (acceptLanguage ?? "").split(",").map((part, index) => {
    const [tag = "", ...parameters] = part.trim().toLowerCase().split(";");
    const qValue = parameters.find((p) => p.trim().startsWith("q="));
    const quality = qValue ? Number(qValue.trim().slice(2)) : 1;
    return {tag, quality, index};
  }).filter((p) => p.quality > 0 && p.quality <= 1).sort((a,b) => b.quality-a.quality || a.index-b.index);
  for (const {tag} of preferences) {
    if (/^es(?:-|$)/.test(tag)) return "es";
    if (/^en(?:-|$)/.test(tag)) return "en";
  }
  return "en";
}

export function landingLanguageHref(language: Language, query: URLSearchParams, policy: {ads:readonly string[];utm?:Record<string,readonly string[]>} = landingTenantConfig.attribution, path = "/"): string {
  const attribution = captureAttribution(query.toString(), policy);
  const kept = new URLSearchParams({lang:language});
  if (attribution.ad !== "unattributed") kept.set("ad",attribution.ad);
  for (const [key,value] of Object.entries(attribution.utm)) kept.set(key,value);
  if (attribution.fbclid) kept.set("fbclid",attribution.fbclid);
  return `${path}?${kept}`;
}

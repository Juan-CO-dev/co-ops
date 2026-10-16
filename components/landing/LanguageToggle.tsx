import type { Language } from "@/lib/i18n/types";
import { landingLanguageHref } from "@/lib/landing/language-shared";

export function LanguageToggle({language, query, label, policy, path = "/"}:{language:Language;query:string;label:string;policy:{ads:readonly string[];utm?:Record<string,readonly string[]>};path?:string}) {
  return <nav aria-label={label} className="flex items-center gap-2">
    {(["en","es"] as const).map((value) => <a key={value} href={landingLanguageHref(value,new URLSearchParams(query),policy,path)} hrefLang={value} lang={value} aria-current={value === language ? "page" : undefined} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-co-border px-3 font-bold focus-visible:outline-2">{value.toUpperCase()}</a>)}
  </nav>;
}

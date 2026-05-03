/**
 * Server-side translation helper (per SPEC_AMENDMENTS.md C.31).
 *
 * Server Components can't use Context, so this is a standalone function
 * that takes language explicitly. Used by Server Components like
 * app/operations/closing/page.tsx and app/dashboard/page.tsx for any
 * static strings rendered server-side before TranslationProvider mounts.
 *
 * Same lookup order as the client Provider: requested language → en
 * fallback → key string itself.
 */

import en from "./en.json";
import es from "./es.json";
import type { Language, TranslationKey, TranslationParams } from "./types";

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Language, Dictionary> = {
  en: en as Dictionary,
  es: es as Dictionary,
};

export function serverT(
  language: Language,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const primary = DICTIONARIES[language][key];
  const template = primary ?? DICTIONARIES.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const replacement = params[name];
    return replacement === undefined ? `{${name}}` : String(replacement);
  });
}

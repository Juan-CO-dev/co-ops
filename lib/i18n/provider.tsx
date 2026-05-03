"use client";

/**
 * TranslationProvider + useTranslation hook (per SPEC_AMENDMENTS.md C.31).
 *
 * Native React Context, no external i18n library. The Provider mounts at
 * each authenticated page surface (Server Components inject the user's
 * `language` from a fresh users-table read per page render — NOT from JWT
 * claims, intentionally, to avoid post-toggle staleness).
 *
 * Lookup order: es (or current language) → en fallback → key string itself.
 * The defensive fallback ensures missing translations during rollout never
 * render `undefined` or break the UI.
 *
 * Param interpolation: simple `{name}`-style placeholders. No ICU
 * MessageFormat — out of scope per C.31 (no plurals, no nested formatting).
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import en from "./en.json";
import es from "./es.json";
import type { Language, TranslationKey, TranslationParams } from "./types";

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Language, Dictionary> = {
  en: en as Dictionary,
  es: es as Dictionary,
};

interface TranslationContextValue {
  language: Language;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  /**
   * Updates the in-memory language without persisting to the server.
   * UserMenu calls this after a successful PATCH to /api/users/me/language —
   * server is the source of truth; the local update avoids a navigation
   * round-trip to see the new language immediately.
   */
  setLanguage: (next: Language) => void;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams): string => {
      const primary = DICTIONARIES[language][key];
      const template = primary ?? DICTIONARIES.en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
        const replacement = params[name];
        return replacement === undefined ? `{${name}}` : String(replacement);
      });
    },
    [language],
  );

  const value = useMemo<TranslationContextValue>(
    () => ({ language, t, setLanguage }),
    [language, t],
  );

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within <TranslationProvider>.");
  }
  return ctx;
}

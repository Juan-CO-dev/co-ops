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

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

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

/**
 * Every mounted provider's language and nesting depth. `<html lang>` follows the INNERMOST mounted provider (the
 * last-changed among equals), and "en" when none is left — so unmounting a nested provider never resets the page to
 * "en" under an outer Spanish one (W27 / B228), and a provider-less surface (public portal, login) still never
 * inherits a stale "es". Depth comes from context: child effects run before the parent's, so mount order cannot say
 * which provider is inside which.
 */
const mountedLanguages = new Map<string, { depth: number; language: Language }>();
const ProviderDepth = createContext(0);
function applyDocumentLanguage(): void {
  let pick: { depth: number; language: Language } | null = null;
  for (const entry of mountedLanguages.values()) if (pick === null || entry.depth >= pick.depth) pick = entry;
  document.documentElement.lang = pick?.language ?? "en";
}

export function TranslationProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  // The root layout (app/layout.tsx) can't know the user — language is a per-request
  // users-table read, not available at the app shell. Assistive tech (screen readers,
  // etc.) reads document.documentElement.lang, so it must follow the actual UI language
  // here, where the value lives, rather than staying hardcoded "en" app-wide. Portal
  // pages that hardcode initialLanguage="en" are unaffected (already the default).
  const key = useId(); // stable per instance; adds no state slot
  const depth = useContext(ProviderDepth) + 1;
  useEffect(() => {
    mountedLanguages.delete(key);
    mountedLanguages.set(key, { depth, language });
    applyDocumentLanguage();
    // On unmount the root layout's default "en" returns only when no provider is left (see `mountedLanguages`).
    return () => { mountedLanguages.delete(key); applyDocumentLanguage(); };
  }, [key, depth, language]);

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

  return (
    <ProviderDepth.Provider value={depth}>
      <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
    </ProviderDepth.Provider>
  );
}

export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within <TranslationProvider>.");
  }
  return ctx;
}

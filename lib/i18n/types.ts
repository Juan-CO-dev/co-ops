/**
 * i18n type primitives — shared between client Provider, server helper,
 * and any consumer that needs the TranslationKey type.
 *
 * Per SPEC_AMENDMENTS.md C.31. TranslationKey is derived from keyof typeof
 * en.json via TypeScript's import-of-JSON typing — adding a key in en.json
 * automatically expands the union; calling t() with an unknown key surfaces
 * as a compile error.
 *
 * Spanish translations may be incomplete during rollout; the Provider
 * falls back to en.json's value when es.json is missing a key, then to
 * the key string itself (defensive — never renders undefined).
 */

import en from "./en.json";

export type Language = "en" | "es";
export const SUPPORTED_LANGUAGES: readonly Language[] = ["en", "es"] as const;

export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string | number>;

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es";
}

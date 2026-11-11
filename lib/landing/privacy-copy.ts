import { serverT } from "@/lib/i18n/server";

type Language = Parameters<typeof serverT>[0];

/**
 * The lead-form deletion line on the landing privacy page (A11; copy approved by Juan 2026-11-11 with
 * one change: name the catering address). The address is tenant DATA (`cateringContactEmail` on
 * config/tenant/landing.ts, T0 law: no tenant literal in code); unset → today's sentence without one.
 */
export function leadformDeleteLine(language: Language, cateringContactEmail: string | undefined): string {
  const email = cateringContactEmail?.trim();
  return email
    ? serverT(language, "landing.privacy.leadform.delete_email", { email })
    : serverT(language, "landing.privacy.leadform.delete");
}

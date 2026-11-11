/**
 * /order/verify copy — pure (client-safe, zero I/O). The portal is English-first; a Meta
 * continuation link for a Spanish form carries `lang=es` and its lifetime (`ttl=72h`), so the
 * landing page can say the right thing in the right language (build 2, A2). Both values are
 * display-only hints read from the URL; nothing about authorization depends on them.
 */

export type VerifyLanguage = "en" | "es";

export interface VerifyParams { token: string | null; language: VerifyLanguage; ttlLabel: string }

/** `?token=…&lang=es&ttl=72h` → token + language + "72 hours" (en) / "72 horas" (es); unknown → 30 minutes. */
export function parseVerifyParams(search: string): VerifyParams {
  const params = new URLSearchParams(search);
  const language: VerifyLanguage = params.get("lang") === "es" ? "es" : "en";
  const ttl = params.get("ttl");
  const hours = ttl && /^\d{1,3}h$/.test(ttl) ? Number(ttl.slice(0, -1)) : null;
  const ttlLabel = hours !== null && hours > 0
    ? (language === "es" ? `${hours} ${hours === 1 ? "hora" : "horas"}` : `${hours} ${hours === 1 ? "hour" : "hours"}`)
    : (language === "es" ? "30 minutos" : "30 minutes");
  return { token: params.get("token"), language, ttlLabel };
}

export interface VerifyCopy {
  back: string; verifyingTitle: string; verifyingBody: string;
  expiredTitle: string; expiredBody: string; requestNew: string; footer: string;
}

export function verifyCopy(language: VerifyLanguage, ttlLabel: string): VerifyCopy {
  if (language === "es") {
    return {
      back: "‹ Volver",
      verifyingTitle: "Entrando…",
      verifyingBody: "Estamos verificando tu enlace — solo toma un momento.",
      expiredTitle: "Enlace caducado",
      expiredBody: `Este enlace caducó, ya se usó o fue reemplazado por uno más nuevo. Solo funciona tu enlace más reciente, y los enlaces caducan a las ${ttlLabel}.`,
      requestNew: "Pedir un enlace nuevo →",
      footer: "Sin contraseñas que recordar — tu correo es tu cuenta.",
    };
  }
  return {
    back: "‹ Back",
    verifyingTitle: "Signing you in…",
    verifyingBody: "Verifying your link — this only takes a moment.",
    expiredTitle: "Link expired",
    expiredBody: `This link has expired, was already used, or was replaced by a newer one. Only your most recent link works, and links expire after ${ttlLabel}.`,
    requestNew: "Request a new link →",
    footer: "No passwords to remember — your email is your account.",
  };
}

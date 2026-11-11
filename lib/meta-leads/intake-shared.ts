import { TENANT_NAME } from "@/lib/tenant";
import { classifyEmail, normalizePhoneE164 } from "@/lib/customers/identity-shared";

export const META_CONSENT_QUESTION_KEY = "email_marketing_opt_in";
/**
 * Bumped on EVERY copy change (the SQL writer pins the same string). v3 = Juan's "double capture"
 * ruling (2026-11-11): the checkbox names the Meta pre-filled address explicitly, because that
 * address is the MARKETING email and the optional work email is the ORDER email, never marketed.
 */
export const META_CONSENT_TEXT_VERSION = "meta-email-marketing-v3";
export const META_CONSENT_COPY = {
  en: `Email me news and offers from ${TENANT_NAME} at my email above. I can unsubscribe anytime.`,
  es: `Quiero recibir novedades y ofertas de ${TENANT_NAME} en mi correo de arriba. Puedo cancelar la suscripción cuando quiera.`,
} as const;
/** The optional "Work email for this order (if different)" question key. */
export const META_WORK_EMAIL_KEY = "work_email";
export const META_MAPPING_VERSION = "meta-leads-v2";

export interface MetaMappedIntake {
  contactName: string;
  /** The ORDER email: the work email when one was given and valid, else the Meta pre-filled email.
   *  It is the catering_customers identity, the portal account, the continuation recipient and the
   *  company-domain match. */
  contactEmail: string;
  /** The Meta pre-filled email — the MARKETING email. The opt-in checkbox applies ONLY to it. */
  marketingEmail: string;
  /** The Meta email when it differs from the order email (a secondary contact note on the lead); null when
   *  both are one address (case-insensitive) — then nothing is secondary. */
  secondaryEmail: string | null;
  contactPhone: string | null; company: string | null;
  headcount: number | null; eventDate: string | null; shopCode: string; isDelivery: boolean; notes: string | null;
}
export type MetaMapResult = { ok: true; intake: MetaMappedIntake; rawKeys: string[];
  consent: { optedIn: boolean; questionKey: string; textVersion: string } }
  | { ok: false; error: "invalid_payload"; rawKeys: string[] };

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** No values escape into diagnostics. Unknown questions are tolerated, never guessed. */
export function mapMetaLeadFields(fieldData: unknown, disclaimerResponses?: unknown): MetaMapResult {
  const rawKeys: string[] = [];
  const bad = (): MetaMapResult => ({ ok: false, error: "invalid_payload", rawKeys });
  if (!Array.isArray(fieldData) || fieldData.length > 100) return bad();
  const fields = new Map<string, string>();
  const known = new Set(["full_name", "email", "phone_number", "company_name", "headcount", "event_date", "preferred_shop", "fulfillment_method", "notes", META_WORK_EMAIL_KEY, META_CONSENT_QUESTION_KEY]);
  const optionalLabels: Record<string, string> = { headcount: "Headcount", event_date: "Event date", company_name: "Company", notes: "Notes", [META_WORK_EMAIL_KEY]: "Work email" };
  const invalidOptional = new Set<string>();
  const fallbacks = new Map<string, string>();
  const preserve = (key: string, value: string) => {
    invalidOptional.add(key);
    fallbacks.set(key, `${optionalLabels[key]} (as typed): ${value.slice(0, 500)}`);
  };
  let invalid = false;
  for (const field of fieldData) {
    if (!object(field) || typeof field.name !== "string" || field.name.length > 80) { invalid = true; continue; }
    rawKeys.push(field.name);
    if (!known.has(field.name)) continue;
    if (optionalLabels[field.name] && (fields.has(field.name) || invalidOptional.has(field.name) || !Array.isArray(field.values) || field.values.length !== 1 || typeof field.values[0] !== "string" || field.values[0].length > (field.name === "company_name" ? 200 : field.name === META_WORK_EMAIL_KEY ? 254 : 4000))) {
      const raw = Array.isArray(field.values) ? field.values.map(v => typeof v === "string" ? v : JSON.stringify(v)).join("; ") : typeof field.values === "string" ? field.values : "[invalid value]";
      preserve(field.name, [fields.get(field.name), raw].filter(Boolean).join("; "));
      fields.delete(field.name);
      continue;
    }
    if (fields.has(field.name) || !Array.isArray(field.values) || field.values.length !== 1 || typeof field.values[0] !== "string" || field.values[0].length > 4000) { invalid = true; continue; }
    fields.set(field.name, field.values[0].trim());
  }
  if (invalid) return bad();
  const email = classifyEmail(fields.get("email"));
  const contactName = fields.get("full_name") ?? "";
  const shopCode = fields.get("preferred_shop") ?? "";
  const fulfillment = fields.get("fulfillment_method");
  if (email.kind !== "ok" || !contactName || contactName.length > 200 || !/^[A-Za-z0-9_-]{1,40}$/.test(shopCode) || (fulfillment !== "pickup" && fulfillment !== "delivery")) return bad();
  // Double capture: an OPTIONAL work email. Valid → the order identity; invalid → kept as typed (tolerant,
  // like every optional field); same address as the Meta email (case-insensitive) → one address.
  const workText = fields.get(META_WORK_EMAIL_KEY) || null;
  let workEmail: string | null = null;
  if (workText) {
    const work = classifyEmail(workText);
    if (work.kind === "ok") workEmail = work.email; else preserve(META_WORK_EMAIL_KEY, workText);
  }
  const marketingEmail = email.email;
  const contactEmail = workEmail && workEmail !== marketingEmail ? workEmail : marketingEmail;
  const secondaryEmail = contactEmail === marketingEmail ? null : marketingEmail;
  const headcountText = fields.get("headcount");
  let headcount = headcountText ? Number(headcountText) : null;
  if (headcount !== null && (!/^\d+$/.test(headcountText!) || !Number.isSafeInteger(headcount) || headcount < 1 || headcount > 10000)) { preserve("headcount", headcountText!); headcount = null; }
  let eventDate = fields.get("event_date") || null;
  if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !Number.isFinite(Date.parse(eventDate)) || new Date(eventDate).toISOString().slice(0, 10) !== eventDate)) { preserve("event_date", eventDate); eventDate = null; }
  // Only the pinned checkbox can authorize marketing; absence/false never means opt-out.
  let optedIn = fields.get(META_CONSENT_QUESTION_KEY) === "true";
  if (Array.isArray(disclaimerResponses)) {
    const matches = disclaimerResponses.filter(v => object(v) && v.checkbox_key === META_CONSENT_QUESTION_KEY);
    if (matches.length > 1) optedIn = false;
    else if (matches.length === 1) {
      const checked = object(matches[0]) && [true, "1", "true"].includes(matches[0].is_checked as boolean | string);
      optedIn = checked && (!fields.has(META_CONSENT_QUESTION_KEY) || optedIn);
    }
  }
  return { ok: true, rawKeys, intake: { contactName, contactEmail, marketingEmail, secondaryEmail,
    contactPhone: normalizePhoneE164(fields.get("phone_number")), company: fields.get("company_name") || null,
    headcount, eventDate, shopCode, isDelivery: fulfillment === "delivery", notes: [fields.get("notes"), ...fallbacks.values()].filter(Boolean).join("\n") || null },
    consent: { optedIn, questionKey: META_CONSENT_QUESTION_KEY, textVersion: META_CONSENT_TEXT_VERSION } };
}

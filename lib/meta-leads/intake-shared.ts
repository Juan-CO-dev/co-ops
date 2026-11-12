import { TENANT_NAME } from "@/lib/tenant";
import { classifyEmail, normalizePhoneE164 } from "@/lib/customers/identity-shared";
import { metaLeadsTenantConfig, type MetaLeadsTenantConfig } from "@/config/tenant/meta-leads";

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
/**
 * v3 (2026-11-11, the live form): answers are Meta option LABELS resolved through the tenant label
 * table; a delivery lead without a shop choice is ROUTED by the worker; headcount ranges, sizing
 * (seconds / extras), work phone, job title and unknown keys become notes; dates parse tolerantly.
 */
export const META_MAPPING_VERSION = "meta-leads-v3";
/** The pipeline notes column bound (catering_pipeline.notes is free text; the intake JSON pins 4000). */
export const META_NOTES_MAX = 4000;

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
  headcount: number | null; eventDate: string | null;
  /** The `locations.code` the customer chose; null = NO choice (delivery placeholder / unknown delivery
   *  label) and the worker routes the lead (history → ad set → tenant default). Never null for pickup. */
  shopCode: string | null;
  isDelivery: boolean; notes: string | null;
}
/** The notes, in their fixed order, so the worker can slot the routing line in after the mapping. */
export interface MetaNoteParts {
  /** The customer's own free-text notes. */
  customer: string | null;
  /** "Sizing: seconds yes · add sides" */
  sizing: string | null;
  /** "Headcount: 21-40" (a range label — never converted to a number). */
  headcount: string | null;
  /** Labelled optional answers (work phone, job title) and unknown keys as "<key>: <value>". */
  extras: string[];
  /** The existing "<Label> (as typed): …" fallbacks for answers that failed validation. */
  fallbacks: string[];
}
export type MetaMapResult = { ok: true; intake: MetaMappedIntake; rawKeys: string[]; noteParts: MetaNoteParts;
  consent: { optedIn: boolean; questionKey: string; textVersion: string } }
  | { ok: false; error: "invalid_payload"; rawKeys: string[] };
export interface MetaMapOptions {
  /** "Now" for the no-year event-date rule (next occurrence on or after today in America/New_York). */
  now?: Date;
  /** The tenant label / routing tables; defaults to the tenant config. */
  config?: MetaLeadsTenantConfig;
}

const OPERATIONAL_TZ = "America/New_York";
const UNKNOWN_KEY_LIMIT = 20;
const UNKNOWN_VALUE_MAX = 200;

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** Case-folded, whitespace-normalized label comparison key. */
function labelKey(value: string): string { return value.replace(/\s+/g, " ").trim().toLowerCase(); }

const ELLIPSIS = "…";
/**
 * Customer notes → Sizing → Headcount → Routed → extras/unknowns → the "(as typed)" fallbacks, bounded to
 * META_NOTES_MAX. The GENERATED lines (Sizing, Headcount, Routed) are reserved FIRST — they carry the
 * quantity and the shop decision — and the free text (customer notes, extras, fallbacks) is cut into what
 * is left, each cut line ending in "…"; a line with no room left is dropped.
 */
export function composeMetaNotes(parts: MetaNoteParts, routed: string | null = null): string | null {
  const ordered: Array<{ text: string; required: boolean }> = [
    { text: parts.customer ?? "", required: false }, { text: parts.sizing ?? "", required: true }, { text: parts.headcount ?? "", required: true },
    { text: routed ?? "", required: true }, ...parts.extras.map(text => ({ text, required: false })), ...parts.fallbacks.map(text => ({ text, required: false })),
  ].filter(line => line.text);
  // Every required line still to come reserves its own length plus the newline that joins it.
  let reserved = ordered.filter(line => line.required).reduce((sum, line) => sum + line.text.length + 1, 0);
  const out: string[] = [];
  let used = 0;
  for (const line of ordered) {
    const joiner = out.length ? 1 : 0;
    if (line.required) reserved -= line.text.length + 1;
    const room = META_NOTES_MAX - used - joiner - (line.required ? 0 : reserved);
    if (room <= 0) continue;
    const text = line.text.length > room ? (room >= 2 ? line.text.slice(0, room - 1) + ELLIPSIS : "") : line.text;
    if (!text) continue;
    out.push(text); used += joiner + text.length;
  }
  return out.length ? out.join("\n") : null;
}

/** pickup | delivery, tolerant of case, spaces and hyphens ("Pick up", "pick-up"); null = anything else. */
export function normalizeFulfillment(value: string | undefined): "pickup" | "delivery" | null {
  const key = (value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  return key === "pickup" ? "pickup" : key === "delivery" ? "delivery" : null;
}

/** A Meta option label or a raw `locations.code` → the code; "placeholder" = the delivery no-choice label. */
export function resolveShopLabel(value: string, config: MetaLeadsTenantConfig): { kind: "code"; code: string } | { kind: "placeholder" } | { kind: "unknown" } {
  const key = labelKey(value);
  if (!key) return { kind: "unknown" };
  for (const entry of config.shopLabels) if (labelKey(entry.label) === key || labelKey(entry.code) === key) return { kind: "code", code: entry.code };
  if (config.deliveryPlaceholderLabels.some(label => labelKey(label) === key)) return { kind: "placeholder" };
  return { kind: "unknown" };
}

const YES = new Set(["yes", "y", "yeah", "yep", "sure", "si", "sí", "true"]);
const NO = new Set(["no", "n", "nope", "nah", "false"]);
/** "Yes"/"y"/"yeah"/"sure" → yes, "No"/"n"/"nope" → no, anything else kept as typed. */
export function normalizeYesNo(value: string): string {
  const key = value.trim().toLowerCase().replace(/[.!]+$/, "");
  return YES.has(key) ? "yes" : NO.has(key) ? "no" : value.trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  ene: 1, enero: 1, febrero: 2, marzo: 3, abr: 4, abril: 4, mayo: 5, junio: 6, julio: 7, ago: 8, agosto: 8,
  set: 9, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, dic: 12, diciembre: 12,
};
function pad(n: number): string { return String(n).padStart(2, "0"); }
/** Date-only math: a real calendar date → "YYYY-MM-DD"; impossible dates → null. Never touches a clock or a TZ. */
function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}
/** The calendar date in America/New_York for an instant ("YYYY-MM-DD"). */
export function etCalendarDate(now: Date): string { return now.toLocaleDateString("en-CA", { timeZone: OPERATIONAL_TZ }); }
/**
 * Tolerant event-date parse (ET, date-only): "YYYY-MM-DD", "M/D", "M/D/YY(YY)", "Nov 20", "November 20th",
 * "20 Nov", each with an optional year. No year → the NEXT occurrence on or after `todayEt` (today counts).
 * Anything else, or an impossible date → null (the caller keeps the text as typed).
 */
export function parseEventDate(text: string, todayEt: string): string | null {
  const value = text.trim().replace(/\s+/g, " ");
  const todayYear = Number(todayEt.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayEt) || !Number.isInteger(todayYear)) return null;
  const nextOccurrence = (month: number, day: number): string | null => {
    // Four years out covers the next Feb 29.
    for (const year of [todayYear, todayYear + 1, todayYear + 2, todayYear + 3, todayYear + 4]) {
      const candidate = isoDate(year, month, day);
      if (candidate && candidate >= todayEt) return candidate;
    }
    return null;
  };
  const withYear = (year: string | undefined, month: number, day: number): string | null => {
    if (year === undefined) return nextOccurrence(month, day);
    return isoDate(year.length === 2 ? 2000 + Number(year) : Number(year), month, day);
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(value);
  if (m) return withYear(m[3], Number(m[1]), Number(m[2]));
  m = /^([A-Za-zÀ-ÿ]{3,10})\.?,? (\d{1,2})(?:st|nd|rd|th)?,?(?: (?:of |de )?(\d{4}))?$/i.exec(value);
  if (m) { const month = MONTHS[m[1]!.toLowerCase()]; return month ? withYear(m[3], month, Number(m[2])) : null; }
  m = /^(\d{1,2})(?:st|nd|rd|th)?(?: of| de)? ([A-Za-zÀ-ÿ]{3,10})\.?,?(?: (?:of |de )?(\d{4}))?$/i.exec(value);
  if (m) { const month = MONTHS[m[2]!.toLowerCase()]; return month ? withYear(m[3], month, Number(m[1])) : null; }
  return null;
}

/** No values escape into diagnostics. Unknown questions are kept as notes (never refused), never guessed. */
export function mapMetaLeadFields(fieldData: unknown, disclaimerResponses?: unknown, options: MetaMapOptions = {}): MetaMapResult {
  const config = options.config ?? metaLeadsTenantConfig;
  const rawKeys: string[] = [];
  const bad = (): MetaMapResult => ({ ok: false, error: "invalid_payload", rawKeys });
  if (!Array.isArray(fieldData) || fieldData.length > 100) return bad();
  const fields = new Map<string, string>();
  const known = new Set(["full_name", "email", "phone_number", "company_name", "headcount", "event_date", "preferred_shop", "fulfillment_method", "notes", "seconds", "extras", "work_phone_number", "job_title", META_WORK_EMAIL_KEY, META_CONSENT_QUESTION_KEY]);
  const optionalLabels: Record<string, string> = { headcount: "Headcount", event_date: "Event date", company_name: "Company", notes: "Notes", preferred_shop: "Preferred shop", seconds: "Seconds", extras: "Extras", work_phone_number: "Work phone", job_title: "Job title", [META_WORK_EMAIL_KEY]: "Work email" };
  const invalidOptional = new Set<string>();
  const fallbacks = new Map<string, string>();
  const unknowns: string[] = [];
  const preserve = (key: string, value: string) => {
    invalidOptional.add(key);
    fallbacks.set(key, `${optionalLabels[key]} (as typed): ${value.slice(0, 500)}`);
  };
  const rawText = (values: unknown): string => Array.isArray(values) ? values.map(v => typeof v === "string" ? v : JSON.stringify(v)).join("; ") : typeof values === "string" ? values : "[invalid value]";
  let invalid = false;
  for (const field of fieldData) {
    if (!object(field) || typeof field.name !== "string" || field.name.length > 80) { invalid = true; continue; }
    rawKeys.push(field.name);
    if (!known.has(field.name)) {
      // A future question never refuses the lead: its answer rides along as a bounded note line.
      if (unknowns.length < UNKNOWN_KEY_LIMIT) { const text = rawText(field.values).trim(); if (text) unknowns.push(`${field.name}: ${text.slice(0, UNKNOWN_VALUE_MAX)}`); }
      continue;
    }
    if (optionalLabels[field.name] && (fields.has(field.name) || invalidOptional.has(field.name) || !Array.isArray(field.values) || field.values.length !== 1 || typeof field.values[0] !== "string" || field.values[0].length > (field.name === "company_name" ? 200 : field.name === META_WORK_EMAIL_KEY ? 254 : 4000))) {
      preserve(field.name, [fields.get(field.name), rawText(field.values)].filter(Boolean).join("; "));
      fields.delete(field.name);
      continue;
    }
    if (fields.has(field.name) || !Array.isArray(field.values) || field.values.length !== 1 || typeof field.values[0] !== "string" || field.values[0].length > 4000) { invalid = true; continue; }
    fields.set(field.name, field.values[0].trim());
  }
  if (invalid) return bad();
  const email = classifyEmail(fields.get("email"));
  const contactName = fields.get("full_name") ?? "";
  const fulfillment = normalizeFulfillment(fields.get("fulfillment_method"));
  if (email.kind !== "ok" || !contactName || contactName.length > 200 || !fulfillment) return bad();
  // The shop: a label (or raw code) from the tenant table. Pickup needs a real choice; a delivery lead
  // with the placeholder ("our team picks") or an unknown label has NO choice → the worker routes it.
  const shopText = fields.get("preferred_shop") ?? "";
  const shop = resolveShopLabel(shopText, config);
  let shopCode: string | null = null;
  if (shop.kind === "code") shopCode = shop.code;
  else if (fulfillment === "pickup") return bad();
  else if (shop.kind === "unknown" && shopText) preserve("preferred_shop", shopText);
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
  // Headcount: a plain integer is the number; a range label ("21-40", "150+") stays NULL with a note —
  // never an invented number; anything else is kept as typed.
  const headcountText = fields.get("headcount");
  let headcount: number | null = null;
  let headcountNote: string | null = null;
  if (headcountText) {
    const range = /^(\d{1,6})\s*(?:-|–|—|to)\s*(\d{1,6})$|^(\d{1,6})\s*\+$/.exec(headcountText);
    if (range) headcountNote = `Headcount: ${headcountText.replace(/\s+/g, "")}`;
    else {
      headcount = Number(headcountText);
      if (!/^\d+$/.test(headcountText) || !Number.isSafeInteger(headcount) || headcount < 1 || headcount > 10000) { preserve("headcount", headcountText); headcount = null; }
    }
  }
  // Sizing: "Sizing: seconds yes · add sides and drinks" (each part only when answered).
  const secondsText = fields.get("seconds");
  const extrasText = fields.get("extras");
  const sizingParts = [secondsText ? `seconds ${normalizeYesNo(secondsText)}` : null, extrasText ? extrasText.toLowerCase() : null].filter(Boolean);
  const sizing = sizingParts.length ? `Sizing: ${sizingParts.join(" · ")}` : null;
  // Event date: tolerant parse in ET; unparseable → kept as typed.
  const eventText = fields.get("event_date") || null;
  let eventDate: string | null = null;
  if (eventText) {
    eventDate = parseEventDate(eventText, etCalendarDate(options.now ?? new Date()));
    if (!eventDate) preserve("event_date", eventText);
  }
  // Labelled optional answers → notes, never identity.
  const extras: string[] = [];
  for (const key of ["work_phone_number", "job_title"] as const) { const text = fields.get(key); if (text) extras.push(`${optionalLabels[key]}: ${text.slice(0, 500)}`); }
  extras.push(...unknowns);
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
  const noteParts: MetaNoteParts = { customer: fields.get("notes") || null, sizing, headcount: headcountNote, extras, fallbacks: [...fallbacks.values()] };
  return { ok: true, rawKeys, noteParts, intake: { contactName, contactEmail, marketingEmail, secondaryEmail,
    contactPhone: normalizePhoneE164(fields.get("phone_number")), company: fields.get("company_name") || null,
    headcount, eventDate, shopCode, isDelivery: fulfillment === "delivery", notes: composeMetaNotes(noteParts) },
    consent: { optedIn, questionKey: META_CONSENT_QUESTION_KEY, textVersion: META_CONSENT_TEXT_VERSION } };
}

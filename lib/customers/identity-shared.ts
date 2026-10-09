/**
 * Customer identity — PURE half (client-safe, zero I/O). 0234.
 *
 * Juan 2026-10-07: "different cards get attached to the profile if full name matches or email etc…"
 * Ruled: email / phone are STRONG and resolve automatically (email first, then phone) — that happens
 * in SQL (customer_resolve). Full name + card (brand + last four, never a PAN) is only ever a
 * "likely same person" SUGGESTION with a confidence, for a manager to confirm. Nothing here merges.
 */

export const CARD_BRANDS = ["VISA", "MASTERCARD", "AMEX", "DISCOVER", "JCB", "DINERS", "UNIONPAY", "OTHER"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];
export interface CardRef { brand: CardBrand; last4: string }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Lowercase + trim; null when it is not an address at all. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v.length <= 254 && EMAIL.test(v) ? v : null;
}

/**
 * E.164. A bare 10-digit number is a US/CA number (both shops are in DC); 11 digits starting with 1
 * likewise. A number written with a leading + keeps its country code. Anything else is refused,
 * never guessed.
 */
export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Extensions are not part of a person's number.
  const main = s.split(/\s*(?:x|ext\.?|extension)\s*\d+$/i)[0] ?? "";
  const plus = main.startsWith("+");
  const digits = main.replace(/\D/g, "");
  if (plus) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+${digits}`;
  return null;
}

/**
 * Relay / masked addresses that a marketplace hands us instead of the guest's own. They are NOT the
 * person's email: never stored as one, never exported. The order's channel is flagged instead.
 * Domain list = the delivery marketplaces and catering platforms that sit between us and a guest.
 */
export const MASKED_EMAIL_DOMAINS = [
  "doordash.com", "ubereats.com", "uber.com", "grubhub.com", "seamless.com", "postmates.com", "caviar.com",
  "ezcater.com", "marketplace.amazon.com", "relay.toasttab.com", "toasttab.com",
] as const;
/** Placeholder addresses staff type to get past a required field. */
const PLACEHOLDER_LOCAL = /^(no-?e?mail|none|na|n\/a|noreply|no-reply|test|null|x+)$/;

export type EmailClass = { kind: "ok"; email: string } | { kind: "masked" } | { kind: "placeholder" } | { kind: "invalid" };

export function classifyEmail(raw: unknown): EmailClass {
  const email = normalizeEmail(raw);
  if (!email) return { kind: "invalid" };
  const [local = "", domain = ""] = email.split("@");
  if (PLACEHOLDER_LOCAL.test(local)) return { kind: "placeholder" };
  if (MASKED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return { kind: "masked" };
  if (/(^|\.)(relay|masked|anonymi[sz]ed|proxy)\./.test(domain) || /^(relay|masked)[+.-]/.test(local)) return { kind: "masked" };
  return { kind: "ok", email };
}

/** The one spelling a name is compared in: lowercase, single-spaced, letters/digits/space/'/- only. */
export function nameKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length >= 2 ? v : null;
}

/** Toast `cardType` → our closed brand list. */
export function cardBrand(raw: unknown): CardBrand | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (v === "VISA") return "VISA";
  if (v === "MASTERCARD" || v === "MC") return "MASTERCARD";
  if (v === "AMEX" || v === "AMERICANEXPRESS") return "AMEX";
  if (v === "DISCOVER") return "DISCOVER";
  if (v === "JCB") return "JCB";
  if (v === "DINERS" || v === "DINERSCLUB") return "DINERS";
  if (v === "UNIONPAY" || v === "CUP" || v === "CHINAUNIONPAY") return "UNIONPAY";
  return "OTHER";
}

/** Exactly four digits, or nothing. A longer number is NEVER truncated into last4: it is refused. */
export function cardLast4(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const v = String(raw).trim();
  return /^\d{4}$/.test(v) ? v : null;
}

export type SuggestionReason = "same_full_name" | "similar_name" | "shared_card" | "same_shop";
export interface SameWhoInput { nameA: string | null; nameB: string | null; sharedCards: number; sameShop: boolean }
export interface SameWhoResult { confidence: number; reasons: SuggestionReason[] }

/** A suggestion is filed at or above this confidence; below it, nothing is said. */
export const SUGGESTION_MIN_CONFIDENCE = 0.7;

/**
 * "Likely same person" for two DIFFERENT profiles. A shared card is required: a name alone is never
 * evidence (two Juans are two people). The score is a suggestion strength, never a merge trigger.
 *   same full name + shared card           = 0.85 (+0.05 same shop)
 *   same first initial + last name + card  = 0.70 (+0.05 same shop)
 *   card only / different names            = no suggestion
 */
export function likelySamePerson(input: SameWhoInput): SameWhoResult | null {
  if (input.sharedCards < 1) return null;
  const a = nameKey(input.nameA);
  const b = nameKey(input.nameB);
  if (!a || !b) return null;
  let confidence = 0;
  const reasons: SuggestionReason[] = ["shared_card"];
  if (a === b && a.includes(" ")) {
    confidence = 0.85;
    reasons.unshift("same_full_name");
  } else {
    const pa = a.split(" ");
    const pb = b.split(" ");
    const lastA = pa[pa.length - 1];
    const lastB = pb[pb.length - 1];
    if (pa.length >= 2 && pb.length >= 2 && lastA === lastB && pa[0]![0] === pb[0]![0]) {
      confidence = 0.7;
      reasons.unshift("similar_name");
    }
  }
  if (confidence === 0) return null;
  if (input.sameShop) { confidence += 0.05; reasons.push("same_shop"); }
  confidence = Math.round(Math.min(confidence, 0.95) * 100) / 100;
  return confidence >= SUGGESTION_MIN_CONFIDENCE ? { confidence, reasons } : null;
}

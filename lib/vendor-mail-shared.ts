import { getRoleLevel, isRoleCode, type RoleCode } from "./roles";

export const VENDOR_MAIL_CONTENT_STATES = ["pending", "fetched", "failed", "blocked_config", "skipped"] as const;
export type VendorMailContentState = typeof VENDOR_MAIL_CONTENT_STATES[number];
export const VENDOR_MAIL_STATUSES = ["received", "fetched", "parsed", "matched_po", "matched_delivery", "needs_person", "failed", "handled"] as const;
export type VendorMailStatus = typeof VENDOR_MAIL_STATUSES[number];
export const VENDOR_MAIL_FAILURE_CODES = ["no_content", "no_api_key", "api_error", "empty_response", "unparseable_json", "truncated_output"] as const;
export type VendorMailFailureCode = typeof VENDOR_MAIL_FAILURE_CODES[number];
export interface VendorMailReader { role: RoleCode; active: boolean; locations: string[] }
export function vendorMailRoleAllowed(role: string): role is RoleCode {
  return isRoleCode(role) && (role === "gm" || getRoleLevel(role) >= 8);
}
export function canReadVendorMail(actor: VendorMailReader, locationId: string | null): boolean {
  return actor.active && vendorMailRoleAllowed(actor.role) && (getRoleLevel(actor.role) >= 8 || (locationId !== null && actor.locations.includes(locationId)));
}
/** Never expose provider diagnostics as a display/error vocabulary. */
export function vendorMailFailureCode(parsed: unknown): VendorMailFailureCode | null {
  if (!parsed || typeof parsed !== "object" || !("reason" in parsed) || typeof parsed.reason !== "string") return null;
  return VENDOR_MAIL_FAILURE_CODES.find(code => parsed.reason === code || (parsed.reason as string).startsWith(`${code}:`)) ?? null;
}
export function vendorMailStale(receivedAt: string, handledAt: string | null, linkedPoId: string | null, linkedDeliveryId: string | null, now = Date.now()): boolean {
  // Elapsed 24 hours, independent of ET calendar-day length across DST changes.
  return !handledAt && !linkedPoId && !linkedDeliveryId && now - Date.parse(receivedAt) > 86_400_000;
}
export interface VendorMailFilters {
  locationId?: string; vendorId?: string; status?: VendorMailStatus;
  receivedFrom?: string; receivedTo?: string; search?: string; stale?: boolean;
}
export function vendorMailOrder(a: { stale: boolean; received_at: string; id: string }, b: { stale: boolean; received_at: string; id: string }): number {
  return Number(b.stale) - Number(a.stale) || (a.stale ? a.received_at.localeCompare(b.received_at) : b.received_at.localeCompare(a.received_at)) || a.id.localeCompare(b.id);
}
/** A plain-text presentation only; never use this result as HTML. Preserve quoted mail. */
const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
    if (!code.startsWith("#")) return HTML_ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : " ";
  });
}
/**
 * An http(s) URL in canonical form (`<`, `>`, spaces and quotes percent-encoded), else null. Never any other scheme.
 * Surrounding whitespace and controls are dropped and inner controls removed; an inner SPACE is kept, so the
 * parser percent-encodes it (`Order Confirmation.pdf` → `Order%20Confirmation.pdf`), never joins the words.
 */
export function vendorMailSafeUrl(raw: string): string | null {
  const candidate = raw.replace(/^[\u0000- \u007f]+|[\u0000- \u007f]+$/g, "").replace(/[\u0000-\u001f\u007f]/g, "");
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}
const HREF = /(?:^|[\s"'/])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
/**
 * Anchors keep their target: `text <https://…>` (the URL alone when the text is empty or the URL itself).
 * Only http(s) targets are shown; any other scheme keeps its text and drops the target. Click-tracking
 * redirects are shown as they are — unwrapping them is not reliably safe.
 */
export function vendorMailHtmlToText(html: string): string {
  const urls: string[] = [];
  // Markers are NUL-delimited, so the input's own NULs go first; every pattern below is linear.
  const text = decodeEntities(html.replace(/\u0000/g, "")
    .replace(/<!--[^]*?(?:-->|$)/g, " ")
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<a\b([^>]*)(?:>|$)/gi, (_whole, attrs: string) => {
      const match = HREF.exec(attrs);
      const url = match ? vendorMailSafeUrl(decodeEntities(match[1] ?? match[2] ?? match[3] ?? "")) : null;
      if (!url) return " ";
      urls.push(url);
      return ` \u0000S${urls.length - 1}\u0000`;
    })
    .replace(/<\/a\s*>/gi, "\u0000E\u0000 ")
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/tr|\/blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[a-zA-Z/!][^>]*(?:>|$)/g, " "))
    .replace(/\u0000S(\d+)\u0000([^\u0000]*)\u0000E\u0000/g, (_whole, index: string, inner: string) => {
      const url = urls[Number(index)] ?? "";
      const label = inner.trim();
      // Always the bracketed form: the body view links `<…>` whole, so the target is never trimmed as prose.
      return !label ? `<${url}>` : label === url || label === url.replace(/\/$/, "") ? inner.replace(label, `<${url}>`) : `${inner.replace(/\s+$/, "")} <${url}>`;
    })
    .replace(/\u0000S(\d+)\u0000([^\u0000]*)/g, (_whole, index: string, inner: string) => `${inner.replace(/\s+$/, "")} <${urls[Number(index)] ?? ""}>`)
    .replace(/\u0000E\u0000/g, "");
  return text.replace(/[ \t]+/g, " ").trim();
}
export type VendorMailTextSegment = { text: string; href?: string };
const PROSE_TRAILING = new Set([".", ",", ";", ":", "!", "?", "'", '"', "]", "}"]);
/** Length of a prose URL once trailing punctuation and unbalanced `)` are trimmed — one count, one backward pass. */
function proseUrlLength(raw: string): number {
  let open = 0, close = 0;
  for (const ch of raw) { if (ch === "(") open++; else if (ch === ")") close++; }
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1]!;
    if (PROSE_TRAILING.has(ch)) end--;
    else if (ch === ")" && close > open) { end--; close--; }
    else break;
  }
  return end;
}
/**
 * Splits plain text into text and http(s) link segments; the caller renders text as text, never as HTML.
 * `<https://…>` (how an HTML anchor's target is kept) is an explicit target, linked whole with no punctuation
 * trimming; a bare URL in prose is trimmed. A link segment's text IS its href — what is shown is where it goes.
 */
export function vendorMailTextSegments(text: string): VendorMailTextSegment[] {
  const segments: VendorMailTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/<(https?:\/\/[^\s<>]+)>|https?:\/\/[^\s<>"'`]+/gi)) {
    const explicit = match[1];
    const raw = explicit ?? match[0].slice(0, proseUrlLength(match[0]));
    const href = vendorMailSafeUrl(raw);
    if (!href) continue;
    const start = (match.index ?? 0) + (explicit === undefined ? 0 : 1);
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: href, href });
    last = start + raw.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** Recovery baselines are appended only by the level-8+ runbook SQL procedure. */
export function vendorMailForwardAcknowledged(events: { event_type: string; data: unknown }[], requestId: string): boolean {
  return events.some(event => {
    const data = event.data as Record<string, unknown> | null;
    return event.event_type === "baseline" && data?.allow_new_forward === true && data.forward_acknowledged_claim_request_id === requestId;
  });
}
export function vendorMailHasUnknownForward(events: { event_type: string; data: unknown }[]): boolean {
  return events.some(event => {
    const data = event.data as Record<string, unknown> | null;
    return event.event_type === "forward_result" && data?.outcome === "unknown" &&
      (typeof data.claim_request_id !== "string" || !vendorMailForwardAcknowledged(events, data.claim_request_id));
  });
}

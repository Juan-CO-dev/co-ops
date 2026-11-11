import { normalizeInboundAddress } from "@/lib/inbound-router-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

export const INBOX_BODY_MAX_BYTES = 256 * 1024;
export const INBOX_SUBJECT_MAX = 2000;
export const INBOX_HEADER_MAX = 2000;
export const INBOX_ATTACHMENT_MAX = 100;
export const INBOX_HEADER_NAMES = ["message-id", "in-reply-to", "references", "auto-submitted", "precedence", "list-id", "list-unsubscribe", "return-path", "content-type", "x-auto-response-suppress"] as const;
export type InboxHeaders = Partial<Record<typeof INBOX_HEADER_NAMES[number], string>>;

/** Unicode-safe byte cap: never persist half a UTF-8 codepoint. */
export function capInboxBody(text: string, maxBytes = INBOX_BODY_MAX_BYTES) {
  const bytes = new TextEncoder().encode(text);
  let end = Math.max(0, Math.min(Math.floor(maxBytes), bytes.length));
  if (end < bytes.length) while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return { body_text: new TextDecoder().decode(bytes.subarray(0, end)), body_original_bytes: bytes.length, body_truncated: end < bytes.length };
}
export function inboxHeaders(input: unknown): InboxHeaders {
  const result: InboxHeaders = {};
  const entries: [string, unknown][] = Array.isArray(input)
    ? input.flatMap(entry => entry && typeof entry === "object" && typeof entry.name === "string" ? [[entry.name, entry.value] as [string, unknown]] : [])
    : input && typeof input === "object" ? Object.entries(input) : [];
  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    if (!(INBOX_HEADER_NAMES as readonly string[]).includes(name)) continue;
    if (typeof value !== "string") {
      if (value != null && (name === "in-reply-to" || name === "references")) result[name] = "[invalid]";
      continue;
    }
    // Unfold legal continuation lines, refuse injected headers and NULs.
    const unfolded = value.replace(/\r?\n[ \t]+/g, " ");
    if (/[\r\n\0]/.test(unfolded)) {
      // Invalid threading evidence must not silently turn a followup into an initial
      // message. Keep a non-secret presence marker, never the injected content.
      if (name === "in-reply-to" || name === "references") result[name] = "[invalid]";
      continue;
    }
    const safe = unfolded.trim().slice(0, INBOX_HEADER_MAX);
    if ((name === "in-reply-to" || name === "references") && result[name] && !safe) continue;
    result[name as keyof InboxHeaders] = safe;
  }
  return result;
}
export function inboxThreadInitial(subject: string, headers: InboxHeaders): boolean {
  return !headers["in-reply-to"]?.trim() && !headers.references?.trim() && !/^\s*(\[[^\]]{1,40}\]\s*)*(re|fw|fwd|rv|aw|sv|tr|res)(\[\d+\]|\(\d+\))?\s*[:：]/i.test(subject);
}
/** Text only, never an HTML sanitizer or a source suitable for innerHTML. */
export function inboxHtmlToText(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<!--[^]*?(?:-->|$)/g, " ")
    .replace(/<(script|style|blockquote)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[a-zA-Z/!][^>]*(?:>|$)/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
      if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? whole;
      const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : " ";
    }).replace(/[ \t]+/g, " ").trim();
}
export function inboxContent(input: { subject?: string | null; text?: string | null; html?: string | null }) {
  const fromHtml = !input.text?.trim() && !!input.html;
  return { subject: (input.subject ?? "").slice(0, INBOX_SUBJECT_MAX),
    ...capInboxBody(fromHtml ? inboxHtmlToText(input.html!) : input.text ?? ""), body_from_html: fromHtml };
}
export function inboxOwnAddresses(input: {
  aliases: readonly { address: string; active: boolean }[];
  receiptAddresses: readonly (string | null)[];
  emailFrom?: string | null; emailFromTeam?: string | null; legacyAddresses?: string | null;
  /** Phase 1b: the catering inbox reply sender (CATERING_INBOX_FROM), `addr` or `Name <addr>`. */
  inboxFrom?: string | null;
}): ReadonlySet<string> {
  const candidates = [...input.aliases.filter(a => a.active).map(a => a.address), ...input.receiptAddresses,
    input.emailFrom, input.emailFromTeam, input.inboxFrom?.match(/<([^<>]+)>\s*$/)?.[1] ?? input.inboxFrom,
    ...(input.legacyAddresses ?? "").split(",")];
  return new Set(candidates.map(normalizeInboundAddress).filter((v): v is string => v !== null));
}
export interface InboxAttachment { filename: string; content_type: string | null; size: number | null; omission_reason: "not_fetched" | "too_large" | "unsupported" | null }
/** Persist metadata only. Unknown provider fields (including signed URLs) are discarded. */
export function inboxAttachmentManifest(input: readonly InboxAttachment[]): InboxAttachment[] {
  return input.slice(0, INBOX_ATTACHMENT_MAX).map(a => ({ filename: a.filename.slice(0, 255),
    content_type: a.content_type?.slice(0, 100) ?? null, size: Number.isSafeInteger(a.size) && a.size! >= 0 ? a.size : null,
    omission_reason: a.omission_reason }));
}
export function inboxLatestText(body: string): { text: string; uncertainQuote: boolean } {
  const lines: string[] = [];
  let uncertainQuote = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.normalize("NFC");
    if (/^\s*(?:on .+wrote:|el .+escribi[oó]:|-{2,}\s*(?:original message|mensaje original|forwarded message))/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    if (/^\s*(?:from|de|sent|enviado):/i.test(line)) { uncertainQuote = true; break; }
    if (!OWN_TEMPLATE_LINES.some(pattern => pattern.test(line.trim()))) lines.push(line);
  }
  return { text: lines.join("\n").trim(), uncertainQuote };
}

// Exact full-line matches, with only our declared placeholders variable. Do not strip
// arbitrary lines merely because they mention catering or share a template keyword.
const OWN_TEMPLATE_LINES = [en, es].flatMap(dict => Object.entries(dict)
  .filter(([key]) => key.startsWith("catering.inbox.mail."))
  .map(([, value]) => new RegExp("^" + value.split(/\{\w+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\n]{1,120}?") + "$", "i")));

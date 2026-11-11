import "server-only";

export const INBOUND_ASSET_LIMIT = 15 * 1024 * 1024; // receipts bucket, migration 0170
const TYPES = new Set(["application/pdf", "message/rfc822", "text/plain", "text/html", "image/jpeg", "image/png", "image/webp", "image/heic"]);
export interface FetchedAttachment {
  filename: string;
  contentType: string;
  bytes: Buffer;
  omitted?: true;
  omissionReason?: "size" | "content_type";
}

/** Only the documented receiving CDN, exact email/attachment path, no redirects. */
export function trustedAttachmentUrl(raw: string, emailId: string, attachmentId: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "inbound-cdn.resend.com"
      && !url.port && !url.username && !url.password
      && url.pathname === `/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
  } catch { return false; }
}

async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) throw new Error("resend_download_failed");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("asset_oversize");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("asset_oversize"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export interface InboundMetadataContent {
  headers: unknown;
  text: string | null;
  html: string | null;
  attachments: unknown[];
}
interface InboundReceiptContent { rawEml: { bytes: Buffer; contentType: string } | null; attachments: FetchedAttachment[] }
export function fetchInboundContent(emailId: string, fetcher?: typeof fetch): Promise<InboundReceiptContent>;
export function fetchInboundContent(emailId: string, fetcher: typeof fetch | undefined, options: { metadataOnly: true }): Promise<InboundMetadataContent>;
/** Vendor default re-lists signed CDN URLs. Catering opts into one receiving GET only. */
export async function fetchInboundContent(emailId: string, fetcher: typeof fetch = fetch, options?: { metadataOnly: true }): Promise<InboundReceiptContent | InboundMetadataContent> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("resend_not_configured");
  const signal = AbortSignal.timeout(40_000); // whole fetch, not one timeout per file
  const base = `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`;
  async function api(url: string): Promise<Record<string, unknown>> {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal });
    if (response.status === 401 || response.status === 403) throw new Error("provider_auth");
    const bytes = await boundedBytes(response, 22 * 1024 * 1024);
    const result: unknown = JSON.parse(bytes.toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("resend_invalid_response");
    return result as Record<string, unknown>;
  }
  const email = await api(`${base}?html_format=cid`);
  if (email.id !== emailId) throw new Error("resend_email_mismatch");
  if (options?.metadataOnly) return {
    headers: email.headers,
    text: typeof email.text === "string" ? email.text : null,
    html: typeof email.html === "string" ? email.html : null,
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
  };
  const body = typeof email.text === "string" && email.text ? email.text : typeof email.html === "string" ? email.html : null;
  const bodyBytes = body === null ? null : Buffer.from(body, "utf8");
  const bodyOmitted = !!bodyBytes && bodyBytes.length > INBOUND_ASSET_LIMIT;
  const rawEml = bodyBytes && !bodyOmitted ? {
    bytes: bodyBytes, contentType: typeof email.text === "string" && email.text ? "text/plain" : "text/html",
  } : null;
  const attachments: FetchedAttachment[] = [];
  if (bodyOmitted) attachments.push({ filename: "message.eml", contentType: "text/plain", bytes: Buffer.alloc(0), omitted: true, omissionReason: "size" });
  let cursor: string | null = null;
  let total = rawEml?.bytes.length ?? 0;
  const seen = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const list = await api(`${base}/attachments?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`);
    if (!Array.isArray(list.data)) throw new Error("resend_invalid_attachments");
    for (const value of list.data) {
      if (!value || typeof value !== "object") throw new Error("resend_invalid_attachment");
      const att = value as Record<string, unknown>;
      if (typeof att.id !== "string" || seen.has(att.id)) throw new Error("resend_invalid_attachment");
      seen.add(att.id);
      cursor = att.id;
      const filename = typeof att.filename === "string" ? att.filename.slice(0, 500) : "attachment";
      const contentType = typeof att.content_type === "string" ? att.content_type.split(";")[0]!.trim().toLowerCase() : "application/octet-stream";
      const omitted = (reason: "size" | "content_type") => attachments.push({ filename, contentType, bytes: Buffer.alloc(0), omitted: true, omissionReason: reason });
      if (!TYPES.has(contentType)) { omitted("content_type"); continue; }
      if (typeof att.size !== "number" || !Number.isSafeInteger(att.size) || att.size < 0) throw new Error("resend_invalid_size");
      if (att.size > INBOUND_ASSET_LIMIT || total + att.size > 20 * 1024 * 1024) { omitted("size"); continue; }
      if (typeof att.download_url !== "string" || !trustedAttachmentUrl(att.download_url, emailId, att.id)) throw new Error("resend_untrusted_download");
      if (typeof att.expires_at !== "string" || !(Date.parse(att.expires_at) > Date.now())) throw new Error("resend_download_expired");
      try {
        const response = await fetcher(att.download_url, { redirect: "error", signal });
        const bytes = await boundedBytes(response, Math.min(INBOUND_ASSET_LIMIT, 20 * 1024 * 1024 - total));
        total += bytes.length;
        attachments.push({ filename, contentType, bytes });
      } catch (error) {
        if (error instanceof Error && error.message === "asset_oversize") { omitted("size"); continue; }
        throw error;
      }
    }
    if (list.has_more === false) return { rawEml, attachments };
    if (list.has_more !== true || list.data.length === 0) throw new Error("resend_invalid_pagination");
  }
  throw new Error("resend_attachment_page_limit");
}

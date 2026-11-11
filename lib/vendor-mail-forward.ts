import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sendEmail, type SendEmailResult } from "@/lib/email";
import { vendorMailRoleAllowed } from "./vendor-mail-shared";
import { audit } from "./audit";
import type { AuthContext } from "./session";
import { getServiceRoleClient } from "./supabase-server";
import { selectAllRows } from "./supabase-paginate";
import { getVendorMailMessage, readVendorMailRow, vendorMailAssetEntries, VendorMailError, VENDOR_MAIL_UUID } from "./vendor-mail";
import { vendorMailRpc, validateVendorMailMutation, type VendorMailMutation } from "./vendor-mail-actions";
export const VENDOR_MAIL_FORWARD_LIMIT = 40_000_000;
const DEFINITE_REJECTIONS = new Set([
  "validation_error", "missing_required_field", "invalid_from_address", "invalid_attachment",
  "missing_api_key", "invalid_api_key", "restricted_api_key",
  "monthly_quota_exceeded", "daily_quota_exceeded", "rate_limit_exceeded",
]);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const email = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export interface VendorMailForwardInput extends VendorMailMutation { recipient?: string; staff_id?: string; note?: string }
export async function forwardVendorMail(ctx: AuthContext, id: string, input: VendorMailForwardInput) {
  if (!ctx.user.active || !vendorMailRoleAllowed(ctx.user.role)) throw new VendorMailError(403, "forbidden");
  if (process.env.VENDOR_MAIL_FORWARD_ENABLED !== "1") throw new VendorMailError(409, "forward_off");
  const configuredSender = process.env.EMAIL_FROM_TEAM?.trim();
  const sender = configuredSender?.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? configuredSender;
  if (!sender || !email.test(sender) || sender.length > 254 || sender.split("@")[0]?.toLowerCase() !== "team") throw new VendorMailError(503, "forward_sender_missing");
  const receivingDomain = process.env.INBOUND_RECEIVING_DOMAIN?.trim().toLowerCase();
  if (!receivingDomain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(receivingDomain)) throw new VendorMailError(503, "forward_domain_missing");
  validateVendorMailMutation(input);
  const row = await readVendorMailRow(ctx, id);
  const sb = getServiceRoleClient();
  if ((input.recipient !== undefined && typeof input.recipient !== "string") || (input.staff_id !== undefined && typeof input.staff_id !== "string") || !!input.recipient === !!input.staff_id || (input.staff_id && !VENDOR_MAIL_UUID.test(input.staff_id)) || (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 4000))) throw new VendorMailError(400, "invalid_payload");
  let recipient = input.recipient?.trim().toLowerCase();
  if (input.staff_id) {
    const { data, error } = await sb.from("users").select("email,active").eq("id", input.staff_id).eq("active", true).maybeSingle();
    if (error) throw new VendorMailError(503, "vendor_mail_unavailable");
    if (!data?.email) throw new VendorMailError(400, "forward_recipient_invalid");
    if (ctx.user.role === "gm") {
      const member = await sb.from("user_locations").select("user_id").eq("user_id", input.staff_id).eq("location_id", row.effective_location_id!).eq("active", true).maybeSingle();
      if (member.error || !member.data) throw new VendorMailError(400, "forward_recipient_invalid");
    }
    recipient = data.email.trim().toLowerCase();
  }
  if (!recipient || !email.test(recipient) || recipient.length > 254) throw new VendorMailError(400, "forward_recipient_invalid");
  const [aliases, shops] = await Promise.all([
    selectAllRows<{ address: string }>((from,to) => sb.from("inbound_address_aliases").select("address").eq("active", true).order("id").range(from,to)),
    selectAllRows<{ receipt_email_address: string | null }>((from,to) => sb.from("locations").select("receipt_email_address").order("id").range(from,to)),
  ]);
  const receiving = [...aliases.map(a => a.address.toLowerCase()), ...shops.flatMap(s => s.receipt_email_address ? [s.receipt_email_address.toLowerCase()] : [])];
  const recipientDomain = recipient.split("@")[1]!;
  if (receiving.includes(recipient) || recipientDomain === receivingDomain || recipientDomain.endsWith(`.${receivingDomain}`)) throw new VendorMailError(400, "forward_loop");
  // Completed operations replay from the immutable snapshot even if originals are no longer available.
  const savedClaim = await sb.from("vendor_mail_events").select("data").eq("inbound_message_id", id).eq("event_type", "forward_claim").eq("request_id", input.request_id).maybeSingle();
  if (savedClaim.error) throw new VendorMailError(503, "vendor_mail_unavailable");
  if (savedClaim.data) {
    const snapshot = savedClaim.data.data as Record<string, unknown>;
    if (snapshot.recipient !== recipient || snapshot.note !== (input.note ?? "")) throw new VendorMailError(409, "request_conflict");
    await vendorMailRpc(ctx, id, input, "vendor_mail_forward_claim", snapshot);
    const completed = await sb.from("vendor_mail_events").select("revision,data").eq("inbound_message_id", id).eq("event_type", "forward_result").eq("data->>claim_request_id", input.request_id.toLowerCase()).maybeSingle();
    if (completed.error) throw new VendorMailError(503, "vendor_mail_unavailable");
    if (completed.data) return { revision: completed.data.revision, outcome: completed.data.data.outcome, replayed: true };
  }
  const detail = await getVendorMailMessage(ctx, id);
  if (row.archive_state !== "complete" || detail.body_state !== "available" || detail.body_truncated) throw new VendorMailError(409, "forward_originals_missing");
  const note = input.note ?? "";
  const body = `${note}${note ? "\n\n" : ""}From: ${row.from_address ?? ""}\nSubject: ${row.subject ?? ""}\n\n${detail.body_text}`;
  if (Buffer.byteLength(body) > 131072) throw new VendorMailError(413, "forward_body_too_large");
  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  const manifest: Array<{ path: string; filename: string; sha256: string }> = [];
  let bytes = Buffer.byteLength(body) * 8 + 8192;
  for (const asset of vendorMailAssetEntries(row).filter(a => !a.kind || a.kind === "attachment")) {
    if (!/\.(?:pdf|csv|txt|png|jpe?g|gif|webp|docx?|xlsx?|rtf|zip)$/i.test(asset.filename)) throw new VendorMailError(409, "forward_attachment_unsupported");
    if (!asset.path || asset.omitted) throw new VendorMailError(409, "forward_originals_missing");
    const { data, error } = await sb.storage.from("receipts").download(asset.path);
    if (error || !data) throw new VendorMailError(409, "forward_originals_missing");
    bytes += Math.ceil(data.size / 3) * 4 + 2048;
    if (bytes > VENDOR_MAIL_FORWARD_LIMIT) throw new VendorMailError(413, "forward_too_large");
    const content = Buffer.from(await data.arrayBuffer());
    attachments.push({ filename: asset.filename, content, contentType: asset.contentType });
    manifest.push({ path: asset.path, filename: asset.filename, sha256: hash(content) });
  }
  if (attachments.length > 25) throw new VendorMailError(413, "forward_too_large");
  const claim = await vendorMailRpc(ctx, id, input, "vendor_mail_forward_claim", { recipient, sender, note, body, body_sha256: hash(body), attachments: manifest });
  const prior = await sb.from("vendor_mail_events").select("data").eq("inbound_message_id", id).eq("event_type", "forward_result").eq("data->>claim_request_id", input.request_id.toLowerCase()).maybeSingle();
  if (prior.error) throw new VendorMailError(503, "vendor_mail_unavailable");
  if (prior.data) return { revision: row.revision, outcome: prior.data.data.outcome, replayed: true };
  if (claim.replayed) {
    const event = await sb.from("vendor_mail_events").select("created_at").eq("request_id", input.request_id).maybeSingle();
    if (event.error || !event.data) throw new VendorMailError(503, "vendor_mail_unavailable");
    if (Date.now() - Date.parse(event.data.created_at) >= 24 * 3600_000) throw new VendorMailError(409, "forward_unknown");
  }
  const sent: SendEmailResult = await sendEmail({ from: configuredSender!, to: recipient, subject: `Fwd: ${row.subject ?? row.reference_code}`, text: body, html: `<pre>${escape(body)}</pre>`, attachments, idempotencyKey: `vendor-mail/${input.request_id.toLowerCase()}` }).catch(() => ({ error: "unknown" }));
  const mismatch = "error" in sent && sent.code === "invalid_idempotent_request";
  const outcome = "id" in sent ? "accepted" : sent.code && DEFINITE_REJECTIONS.has(sent.code) ? "failed" : "unknown";
  const current = await readVendorMailRow(ctx, id);
  const result = await vendorMailRpc(ctx, id, { expected_revision: current.revision, request_id: randomUUID() }, "vendor_mail_forward_result", {
    claim_request_id: input.request_id, outcome, provider_id: "id" in sent ? sent.id : null, error: "id" in sent ? null : outcome === "unknown" ? "unknown" : "provider_error",
  }).catch(async error => {
    if (!(error instanceof VendorMailError) || !["stale_revision", "already_resulted"].includes(error.code)) throw error;
    const existing = await sb.from("vendor_mail_events").select("revision,data").eq("inbound_message_id", id).eq("event_type", "forward_result").eq("data->>claim_request_id", input.request_id.toLowerCase()).maybeSingle();
    if (existing.error || !existing.data) throw new VendorMailError(409, "forward_unknown");
    return { revision: existing.data.revision, replayed: true, data: existing.data.data as Record<string, unknown> };
  });
  await audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action: "vendor_mail.forward", resourceTable: "inbound_messages", resourceId: id, metadata: { request_id: input.request_id, outcome }, ipAddress: null, userAgent: null });
  if (mismatch) throw new VendorMailError(409, "forward_payload_mismatch");
  return { revision: result.revision, replayed: result.replayed, outcome: result.data.outcome ?? outcome };
}

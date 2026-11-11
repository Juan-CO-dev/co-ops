import "server-only";
import type { AuthContext } from "./session";
import { getServiceRoleClient } from "./supabase-server";
import { selectAllRows } from "./supabase-paginate";
import { vendorMailHtmlToText } from "./vendor-mail-shared";
import { canReadVendorMail, vendorMailRoleAllowed, vendorMailFailureCode, vendorMailStale, vendorMailOrder, VENDOR_MAIL_CONTENT_STATES, VENDOR_MAIL_STATUSES, type VendorMailStatus, type VendorMailContentState, type VendorMailReader, type VendorMailFilters } from "./vendor-mail-shared";

export class VendorMailError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const VENDOR_MAIL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checked<T extends { error?: unknown }>(result: T): T {
  if (result.error) {
    const code = typeof result.error === "object" && "code" in result.error ? String(result.error.code) : "";
    throw new VendorMailError(["PGRST205", "42P01", "42703", "PGRST204"].includes(code) ? 503 : 500, ["PGRST205", "42P01", "42703", "PGRST204"].includes(code) ? "vendor_mail_unavailable" : "read_failed");
  }
  return result;
}
async function reader(ctx: AuthContext): Promise<VendorMailReader> {
  if (!ctx.user.active || !vendorMailRoleAllowed(ctx.user.role)) throw new VendorMailError(403, "forbidden");
  const db = getServiceRoleClient();
  const { data: user } = checked(await db.from("users").select("role,active").eq("id", ctx.user.id).maybeSingle());
  if (!user?.active || !vendorMailRoleAllowed(user.role)) throw new VendorMailError(403, "forbidden");
  const memberships = await selectAllRows<{ location_id: string }>(async (from, to) => checked(await db.from("user_locations").select("location_id").eq("user_id", ctx.user.id).eq("active", true).order("location_id").range(from, to)));
  return { role: user.role, active: true, locations: memberships.map(row => row.location_id) };
}
export interface VendorMailAttachment { filename: string; contentType: string; path: string | null; omitted?: boolean; omissionReason?: string; kind?: "attachment" | "body" | "headers" }
interface Receipt {
  id: string; location_id: string | null; vendor_guess_id: string | null;
  parse_state: "unparsed" | "parsed" | "failed"; parsed_json: unknown;
  linked_po_id: string | null; linked_delivery_id: string | null; attribution_conflict: boolean;
  raw_storage_path: string | null; attachment_paths: VendorMailAttachment[] | null;
}
interface Row {
  id: string; reference_code: string; revision: number; received_at: string;
  from_address: string | null; subject: string | null; effective_location_id: string | null; effective_vendor_id: string | null;
  content_state: VendorMailContentState; display_status: VendorMailStatus; is_stale: boolean; last_error: string | null; email_receipt_id: string | null;
  handled_by: string | null; handled_at: string | null; handled_reason: string | null;
  archive_state: "pending" | "complete" | "incomplete"; archive_error: string | null;
  attachment_manifest: unknown[]; receipt: Receipt | null;
}
const COLUMNS = "id,reference_code,revision,received_at,from_address,subject,effective_location_id,effective_vendor_id,content_state,display_status,is_stale,last_error,email_receipt_id,handled_by,handled_at,handled_reason,archive_state,archive_error,attachment_manifest,receipt";
function summarize(row: Row, now: number) {
  const receipt = row.receipt;
  return { id: row.id, reference_code: row.reference_code, revision: row.revision, received_at: row.received_at,
    from_address: row.from_address, subject: row.subject, location_id: row.effective_location_id, vendor_id: row.effective_vendor_id,
    content_state: row.content_state, status: row.display_status, last_error: row.last_error, email_receipt_id: row.email_receipt_id,
    handled_by: row.handled_by, handled_at: row.handled_at, handled_reason: row.handled_reason,
    archive_state: row.archive_state, archive_error: row.archive_error,
    attachment_count: receipt ? (receipt.attachment_paths ?? []).filter(asset => !asset.kind || asset.kind === "attachment").length : row.archive_state !== "pending" ? row.attachment_manifest.filter(asset => asset && typeof asset === "object" && (!("kind" in asset) || asset.kind === "attachment")).length : null,
    parse_state: receipt?.parse_state ?? null, failure_code: vendorMailFailureCode(receipt?.parsed_json),
    linked_po_id: receipt?.linked_po_id ?? null, linked_delivery_id: receipt?.linked_delivery_id ?? null,
    attribution_conflict: receipt?.attribution_conflict ?? false,
    stale: vendorMailStale(row.received_at, row.handled_at, receipt?.linked_po_id ?? null, receipt?.linked_delivery_id ?? null, now) };
}
export function validateVendorMailFilters(filters: VendorMailFilters): void {
  if ((filters.locationId && filters.locationId !== "unassigned" && !VENDOR_MAIL_UUID.test(filters.locationId)) ||
    (filters.vendorId && !VENDOR_MAIL_UUID.test(filters.vendorId)) ||
    (filters.status && !VENDOR_MAIL_STATUSES.includes(filters.status)) ||
    [filters.receivedFrom, filters.receivedTo].some(date => date !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date)))) ||
    (filters.search !== undefined && (filters.search.length > 200 || /[\u0000-\u001f]/.test(filters.search))) ||
    (filters.receivedFrom && filters.receivedTo && Date.parse(filters.receivedFrom) > Date.parse(filters.receivedTo))) throw new VendorMailError(400, "invalid_payload");
}
export async function listVendorMail(ctx: AuthContext, filters: VendorMailFilters = {}) {
  const actor = await reader(ctx);
  validateVendorMailFilters(filters);
  const db = getServiceRoleClient();
  const load = (header: boolean) => selectAllRows<Row>(async (from, to) => {
    let query = db.from("vendor_mail_read").select(COLUMNS);
    if (actor.role === "gm") query = query.in("effective_location_id", actor.locations);
    if (filters.locationId === "unassigned") query = query.is("effective_location_id", null);
    else if (filters.locationId) query = query.eq("effective_location_id", filters.locationId);
    if (!header && filters.vendorId) query = query.eq("effective_vendor_id", filters.vendorId);
    if (!header && filters.status) query = query.eq("display_status", filters.status);
    if (!header && filters.stale !== undefined) query = query.eq("is_stale", filters.stale);
    if (!header && filters.search?.trim()) query = query.ilike("search_text", `%${filters.search.trim().replace(/[\\%_]/g, "\\$&")}%`);
    if (filters.receivedFrom) query = query.gte("received_at", filters.receivedFrom);
    if (filters.receivedTo) query = query.lte("received_at", filters.receivedTo);
    return checked(await query.order("id").range(from, to));
  });
  const rows = await load(false);
  const now = Date.now();
  const scoped = rows.filter(row => canReadVendorMail(actor, row.effective_location_id));
  const summaries = scoped.map(row => summarize(row, now));
  const messages = summaries.filter(row => filters.stale === undefined || row.stale === filters.stale).sort(vendorMailOrder);
  const header = (filters.vendorId || filters.status || filters.search?.trim() || filters.stale !== undefined) ? (await load(true)).filter(row => canReadVendorMail(actor, row.effective_location_id)).map(row => summarize(row, now)) : summaries;
  return { messages, reconciliation: { kind: "local_breakdown" as const, scope: "authorized_shop_and_date_filters" as const,
    total: header.length, stale_count: header.filter(row => row.stale).length,
    content_states: Object.fromEntries(VENDOR_MAIL_CONTENT_STATES.map(state => [state, header.filter(row => row.content_state === state).length])),
    provider_comparison: "not_performed" as const } };
}
/** Shared bound read for detail and signing; no asset I/O occurs before this check. */
export async function readVendorMailRow(ctx: AuthContext, id: string): Promise<Row> {
  const actor = await reader(ctx);
  if (!VENDOR_MAIL_UUID.test(id)) throw new VendorMailError(400, "invalid_payload");
  let query = getServiceRoleClient().from("vendor_mail_read").select(COLUMNS).eq("id", id);
  if (actor.role === "gm") query = query.in("effective_location_id", actor.locations);
  const { data } = checked(await query.maybeSingle());
  if (!data || !canReadVendorMail(actor, data.effective_location_id)) throw new VendorMailError(404, "not_found");
  return data as Row;
}
export function vendorMailAssetEntries(row: Awaited<ReturnType<typeof readVendorMailRow>>) {
  const entries: Array<VendorMailAttachment & { id: string }> = [];
  if (row.receipt?.raw_storage_path) entries.push({ id: "raw", filename: "message.eml", contentType: "application/octet-stream", path: row.receipt.raw_storage_path, kind: "body" });
  for (const [index, asset] of (row.receipt?.attachment_paths ?? []).entries()) entries.push({ ...asset, id: `attachment-${index}` });
  return entries;
}
/** Storage coordinates stay behind the bound asset-signing endpoint, including nested event snapshots. */
function withoutStoragePaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutStoragePaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/paths?$/i.test(key))
    .map(([key, entry]) => [key, withoutStoragePaths(entry)]));
}
function publicParsedJson(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "reason"));
}
export async function getVendorMailMessage(ctx: AuthContext, id: string) {
  const row = await readVendorMailRow(ctx, id);
  const events = await selectAllRows<{ id: string; event_type: string; actor_id: string | null; revision: number; created_at: string; data: unknown }>(async (from, to) => checked(await getServiceRoleClient().from("vendor_mail_events").select("id,event_type,actor_id,revision,created_at,data").eq("inbound_message_id", id).order("created_at").order("id").range(from, to)));
  let body: { body_text: string; body_from_html: boolean; body_truncated: boolean; body_state: "available" | "missing" | "unavailable" | "unsupported" } = { body_text: "", body_from_html: false, body_truncated: false, body_state: "missing" };
  if (row.receipt?.raw_storage_path) {
    const { data, error } = await getServiceRoleClient().storage.from("receipts").download(row.receipt.raw_storage_path);
    if (error || !data) body.body_state = "unavailable";
    else {
      const type = data.type.split(";")[0]?.trim().toLowerCase();
      if (!["text/plain", "text/html", "message/rfc822"].includes(type ?? "")) body.body_state = "unsupported";
      else {
        const limit = 200_000;
        const text = await data.slice(0, limit).text();
        body = { body_text: type === "text/html" ? vendorMailHtmlToText(text) : text, body_from_html: type === "text/html", body_truncated: data.size > limit, body_state: "available" };
      }
    }
  }
  return { ...summarize(row, Date.now()), ...body, parsed_json: publicParsedJson(row.receipt?.parsed_json),
    assets: vendorMailAssetEntries(row).map(({ path, ...asset }) => ({ ...asset, available: !!path && !asset.omitted })),
    events: events.map(event => ({ ...event, data: withoutStoragePaths(event.data) })) };
}

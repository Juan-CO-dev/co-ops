import { isInboxSchemaMissing } from "./inbox-schema-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { getRoleLevel, isRoleCode, type RoleCode } from "@/lib/roles";
import { canReadCateringInbox, inboxGroup, type InboxClassification, type InboxDisposition, type InboxIdentity, type InboxReason, type InboxGroup, type InboxReader } from "./inbox-shared";

export class CateringInboxError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
function inboxResult<T extends { error?: unknown }>(result: T): T {
  if (isInboxSchemaMissing(result.error)) throw new CateringInboxError(503, "inbox_unavailable");
  return result;
}
export interface InboxSummary {
  id: string; inbound_message_id: string; location_id: string | null;
  sender_address: string | null; subject: string; received_at: string;
  disposition: InboxDisposition; classification: InboxClassification | null;
  identity_status: InboxIdentity | null; reason: InboxReason | null; assigned_to: string | null;
  revision: number; group: InboxGroup; transport_only: boolean; stale: boolean;
}
export interface InboxDetail extends InboxSummary {
  body_text: string; body_from_html: boolean; body_truncated: boolean;
  catering_customer_id: string | null; lead_id: string | null; quote_id: string | null;
  preview_text: string | null; events: { id: string; event_type: "ingest" | "finalize" | "handle" | "reassign"; created_at: string }[];
  assignees: { id: string; name: string }[];
}
export interface InboxList { messages: InboxSummary[]; mode: "off" | "shadow" | "live"; assignees: { id: string; name: string }[] }
const SUMMARY = "id,inbound_message_id,location_id,sender_address,subject,received_at,disposition,classification,identity_status,reason,assigned_to,revision";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function roleAllowed(role: RoleCode) { return isRoleCode(role) && ( role === "gm" || role === "catering_mgr" || getRoleLevel(role) >= 8); }
/** Reject disallowed session roles before any I/O; then re-read role and active memberships. */
async function reader(ctx: AuthContext): Promise<InboxReader> {
  if (!ctx.user.active || !roleAllowed(ctx.user.role)) throw new CateringInboxError(403, "forbidden");
  const db = getServiceRoleClient();
  const { data: user, error } = await db.from("users").select("role,active").eq("id", ctx.user.id).maybeSingle();
  if (error) throw new CateringInboxError(500, "read_failed");
  if (!user?.active || !roleAllowed(user.role as RoleCode)) throw new CateringInboxError(403, "forbidden");
  const memberships = await selectAllRows<{location_id:string}>((from,to) => db.from("user_locations").select("location_id").eq("user_id", ctx.user.id).eq("active", true).order("location_id").range(from,to));
  return { role: user.role as RoleCode, active: true, locations: memberships.map(r => r.location_id) };
}
function summary(row: Omit<InboxSummary, "group" | "transport_only" | "stale">, transportOnly = false): InboxSummary {
  return { ...row, group: inboxGroup(row.disposition), transport_only: transportOnly, stale: Date.now() - Date.parse(row.received_at) > 86400000 };
}
async function candidates(actor: InboxReader, location?: string | null) {
  const db = getServiceRoleClient();
  const users = await selectAllRows<{id:string;name:string;role:RoleCode;active:boolean}>((from,to) => db.from("users").select("id,name,role,active").eq("active", true).in("role", ["gm", "catering_mgr", "moo", "owner", "cgs"]).order("id").range(from,to));
  const memberships = await selectAllRows<{user_id:string;location_id:string}>((from,to) => db.from("user_locations").select("user_id,location_id").eq("active", true).order("user_id").order("location_id").range(from,to));
  return users.filter(u => {
    const candidate: InboxReader = { role: u.role as RoleCode, active: u.active, locations: memberships.filter(m => m.user_id === u.id).map(m => m.location_id as string) };
    return location !== undefined ? canReadCateringInbox(candidate, location) : canReadCateringInbox(candidate, null) || candidate.locations.some(l => canReadCateringInbox(actor, l));
  }).map(u => ({ id: u.id as string, name: u.name as string }));
}
export async function listCateringInbox(ctx: AuthContext, assignedTo?: string): Promise<InboxList> {
  const actor = await reader(ctx);
  if (assignedTo && assignedTo !== "unassigned" && !UUID.test(assignedTo)) throw new CateringInboxError(400, "invalid_payload");
  const db = getServiceRoleClient();
  const children = await selectAllRows<Omit<InboxSummary, "group" | "transport_only" | "stale">>(async (from,to) => {
    let query = db.from("catering_inbound_messages").select(SUMMARY);
    if (actor.role === "gm") query = query.in("location_id", actor.locations);
    return inboxResult(await query.order("id").range(from,to));
  });
  const transports = await selectAllRows<{id:string;location_id:string|null;from_address:string|null;subject:string|null;received_at:string}>(async (from,to) => {
    let query = db.from("inbound_messages").select("id,location_id,from_address,subject,received_at,catering_inbound_messages!left(id)").eq("lane", "catering").in("content_state", ["pending", "failed", "blocked_config"]).is("catering_inbound_messages", null);
    if (actor.role === "gm") query = query.in("location_id", actor.locations);
    return inboxResult(await query.order("id").range(from,to));
  });
  const settings = await db.from("catering_inbox_settings").select("mode").eq("singleton", true).single();
  inboxResult(settings);
  if (settings.error) throw new CateringInboxError(500, "read_failed");
  const messages = children.filter(r => canReadCateringInbox(actor, r.location_id)).map(r => summary(r as Omit<InboxSummary, "group" | "transport_only" | "stale">));
  for (const r of transports) {
    if (!canReadCateringInbox(actor, r.location_id)) continue;
    messages.push(summary({ id: `transport:${r.id}`, inbound_message_id: r.id, location_id: r.location_id, sender_address: r.from_address, subject: r.subject ?? "", received_at: r.received_at, disposition: "recorded", classification: null, identity_status: null, reason: null, assigned_to: null, revision: 0 }, true));
  }
  return { messages: messages.filter(r => !assignedTo || (assignedTo === "unassigned" ? r.assigned_to === null : r.assigned_to === assignedTo)).sort((a,b) => Number(b.reason === "urgent") - Number(a.reason === "urgent") || a.received_at.localeCompare(b.received_at)), mode: settings.data.mode, assignees: await candidates(actor) };
}
export async function getCateringInboxMessage(ctx: AuthContext, id: string): Promise<InboxDetail> {
  const actor = await reader(ctx);
  const transport = id.startsWith("transport:");
  const rowId = transport ? id.slice(10) : id;
  if (!UUID.test(rowId)) throw new CateringInboxError(400, "invalid_payload");
  const db = getServiceRoleClient();
  let scope = db.from(transport ? "inbound_messages" : "catering_inbound_messages").select("location_id").eq("id", rowId);
  if (transport) scope = scope.eq("lane", "catering");
  const bound = await scope.maybeSingle();
  inboxResult(bound);
  if (bound.error) throw new CateringInboxError(500, "read_failed");
  if (!bound.data || !canReadCateringInbox(actor, bound.data.location_id)) throw new CateringInboxError(404, "not_found");
  if (transport) {
    const list = await listCateringInbox(ctx);
    const row = list.messages.find(m => m.id === id);
    if (!row) throw new CateringInboxError(404, "not_found");
    return { ...row, body_text: "", body_from_html: false, body_truncated: false, catering_customer_id: null, lead_id: null, quote_id: null, preview_text: null, events: [], assignees: [] };
  }
  const result = await db.from("catering_inbound_messages").select(`${SUMMARY},body_text,body_from_html,body_truncated,catering_customer_id,lead_id,quote_id`).eq("id", id).maybeSingle();
  inboxResult(result);
  if (result.error) throw new CateringInboxError(500, "read_failed");
  if (!result.data || !canReadCateringInbox(actor, result.data.location_id)) throw new CateringInboxError(404, "not_found");
  const draft = await db.from("catering_inbox_drafts").select("preview_text").eq("message_id", id).maybeSingle();
  const events = await selectAllRows<InboxDetail["events"][number]>(async (from,to) => inboxResult(await db.from("catering_inbox_events").select("id,event_type,created_at").eq("message_id", id).order("created_at").order("id").range(from,to)));
  inboxResult(draft);
  if (draft.error) throw new CateringInboxError(500, "read_failed");
  return { ...result.data, ...summary(result.data), preview_text: draft.data?.preview_text ?? null, events, assignees: await candidates(actor, result.data.location_id) } as InboxDetail;
}
export interface InboxActionInput { expectedRevision: number; requestId: string; assignedTo?: string | null }
async function act(ctx: AuthContext, id: string, input: InboxActionInput, action: "handle" | "reassign") {
  const actor = await reader(ctx);
  if (!UUID.test(id) || !UUID.test(input.requestId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || (input.assignedTo != null && !UUID.test(input.assignedTo))) throw new CateringInboxError(400, "invalid_payload");
  const db = getServiceRoleClient();
  const row = await db.from("catering_inbound_messages").select("location_id").eq("id", id).maybeSingle();
  inboxResult(row);
  if (row.error) throw new CateringInboxError(500, "read_failed");
  if (!row.data || !canReadCateringInbox(actor, row.data.location_id)) throw new CateringInboxError(404, "not_found");
  const { data, error } = await db.rpc("act_on_catering_inbox", { p_message_id: id, p_expected_revision: input.expectedRevision, p_request_id: input.requestId, p_actor_id: ctx.user.id, p_session_id: ctx.session.id, p_action: action, p_assigned_to: input.assignedTo ?? null });
  inboxResult({ error });
  if (error) {
    const code = ["stale_revision", "request_conflict", "invalid_state", "invalid_assignee", "forbidden", "not_found"].find(c => error.message === c);
    throw new CateringInboxError(code === "forbidden" ? 403 : code === "not_found" ? 404 : code ? 409 : 500, code ?? "write_failed");
  }
  if (!data?.replayed) await audit({ actorId: ctx.user.id, actorRole: actor.role, action: action === "handle" ? "catering.inbox.handle" : "catering.inbox.reassign", resourceTable: "catering_inbound_messages", resourceId: id, metadata: { request_id: input.requestId, revision: data?.revision }, ipAddress: null, userAgent: null });
  return data;
}
export const handleCateringInbox = (ctx: AuthContext, id: string, input: InboxActionInput) => act(ctx, id, input, "handle");
export const reassignCateringInbox = (ctx: AuthContext, id: string, input: InboxActionInput) => act(ctx, id, input, "reassign");

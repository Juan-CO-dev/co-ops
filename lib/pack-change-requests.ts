/**
 * "This case looks different" — file, list, dismiss (catalog Phase 2b, 0261). SERVER-ONLY, service
 * role. THE LIB BINDS (spec §2; lead D2), before any write:
 *   · FILING is a door act: KH+ (receiving's own floor, level-only like every door write) at the shop
 *     — a membership, or MoO+ for any active shop (catalogShopAllowed). The delivery and the photo it
 *     names must be THAT shop's.
 *   · READING the open list and DISMISSING are catalog acts: packRequestReviewAllowed (AGM+, and at
 *     level 6 only the operational managers — the social media manager is refused, a ROLE check) at
 *     the report's shop; a dismiss must also name the SKU the report belongs to.
 * APPLYING a report is NOT here: apply_sku_pack_change (0261) closes it in the same transaction as
 * the pack version that answers it, so a save of another SKU or scope can never close it.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { enqueueNotification, NOTIFICATION_TYPES } from "@/lib/notifications";
import type { AuthContext } from "@/lib/session";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import {
  PACK_REQUEST_FILE_MIN, PACK_REQUEST_NOTE_MAX, packRequestReviewAllowed, type PackChangeProposal,
} from "@/lib/pack-change-requests-shared";

export class PackChangeRequestError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PackChangeRequestError";
  }
}

type Sb = ReturnType<typeof getServiceRoleClient>;

/**
 * THE BIND (a BIND_PRIMITIVES name), pure and before any I/O: the act's role rule, then the shop
 * (a membership, or MoO+ for any active shop — D2).
 */
function requireLocation(actor: AuthContext, locationId: string, act: "file" | "review"): void {
  if (act === "file" ? actor.level < PACK_REQUEST_FILE_MIN : !packRequestReviewAllowed(actor)) {
    throw new PackChangeRequestError(403, "forbidden");
  }
  if (!catalogShopAllowed(actor, locationId)) throw new PackChangeRequestError(404, "not_found");
}

export interface FilePackChangeInput {
  skuId: string;
  locationId: string;
  deliveryId: string | null;
  note: string | null;
  proposal: PackChangeProposal | null;
  photoId: string | null;
}

/** File a report (or join the open one). Notifies the shop's GM(s); if the shop has none, MoO and the owner. */
/** A filing RPC refusal (`sku_pack_change:<code>`) as the door's named error; anything else is a 500. */
const FILE_REFUSALS: Record<string, number> = {
  sku_not_found: 404, location_not_found: 404, delivery_not_found: 404, photo_not_found: 404,
  sku_owned_by_other_shop: 409, invalid_payload: 400,
};
function fileErrorFromRpc(message: string): never {
  const code = /sku_pack_change:([a-z_]+)/.exec(message)?.[1];
  if (code && FILE_REFUSALS[code]) throw new PackChangeRequestError(FILE_REFUSALS[code]!, code === "location_not_found" ? "not_found" : code);
  throw new Error(`filePackChangeRequest: ${message}`);
}

/**
 * File a report, or JOIN the shop's open report for this item: whatever this crew member brought
 * (note, numbers, photo) is ADDED to it, never dropped (chunk-3 review P3a). One atomic RPC
 * (0261 file_sku_pack_change_request) under 0259's SKU lock. A NEW report notifies the shop's GM(s)
 * (none → MoO and the owner); a join does not re-notify.
 */
export async function filePackChangeRequest(actor: AuthContext, input: FilePackChangeInput): Promise<{ id: string; already: boolean; added: boolean }> {
  requireLocation(actor, input.locationId, "file");
  const note = input.note?.trim() ? input.note.trim().slice(0, PACK_REQUEST_NOTE_MAX) : null;
  const sb = getServiceRoleClient();
  const { data: sku, error: sErr } = await sb.from("vendor_items").select("id, name, location_id")
    .eq("id", input.skuId).eq("active", true).maybeSingle<{ id: string; name: string; location_id: string | null }>();
  if (sErr) throw new Error(`filePackChangeRequest sku: ${sErr.message}`);
  if (!sku) throw new PackChangeRequestError(404, "sku_not_found");
  // A shop-owned SKU (a store copy, a shop-only item) has no other shop (0259's owner rule).
  if (sku.location_id !== null && sku.location_id !== input.locationId) throw new PackChangeRequestError(409, "sku_owned_by_other_shop");
  // The delivery and the photo a report names must be THIS shop's — never another shop's records.
  if (input.deliveryId) {
    const { data: d, error: dErr } = await sb.from("vendor_deliveries").select("id, location_id").eq("id", input.deliveryId)
      .maybeSingle<{ id: string; location_id: string }>();
    if (dErr) throw new Error(`filePackChangeRequest delivery: ${dErr.message}`);
    if (!d || d.location_id !== input.locationId) throw new PackChangeRequestError(404, "delivery_not_found");
  }
  if (input.photoId) {
    const { data: p, error: pErr } = await sb.from("photos").select("id, location_id").eq("id", input.photoId)
      .maybeSingle<{ id: string; location_id: string }>();
    if (pErr) throw new Error(`filePackChangeRequest photo: ${pErr.message}`);
    if (!p || p.location_id !== input.locationId) throw new PackChangeRequestError(404, "photo_not_found");
  }

  const { data, error } = await sb.rpc("file_sku_pack_change_request", {
    p_sku: input.skuId, p_location: input.locationId, p_delivery: input.deliveryId, p_note: note,
    p_proposal: input.proposal, p_photo: input.photoId, p_actor: actor.user.id,
  });
  if (error) fileErrorFromRpc(error.message);
  const filed = data as { id: string; already: boolean; added: boolean } | null;
  if (!filed?.id) throw new Error("filePackChangeRequest returned no report");
  if (filed.already) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "sku.pack_change_request.file", resourceTable: "sku_pack_change_requests", resourceId: filed.id,
      metadata: { sku_id: input.skuId, location_id: input.locationId, joined: true, added: filed.added, has_note: note != null, has_proposal: input.proposal != null, has_photo: input.photoId != null },
      ipAddress: null, userAgent: null,
    });
    return { id: filed.id, already: true, added: filed.added };
  }
  const inserted = { id: filed.id };

  const [shopRes, recipients, meRes] = await Promise.all([
    sb.from("locations").select("name").eq("id", input.locationId).maybeSingle<{ name: string }>(),
    shopManagers(sb, input.locationId),
    sb.from("users").select("name").eq("id", actor.user.id).maybeSingle<{ name: string | null }>(),
  ]);
  if (shopRes.error) throw new Error(`filePackChangeRequest shop: ${shopRes.error.message}`);
  if (meRes.error) throw new Error(`filePackChangeRequest filer: ${meRes.error.message}`);
  if (recipients.length > 0) {
    await enqueueNotification(sb, {
      type: NOTIFICATION_TYPES.PACK_CHANGE_REQUEST,
      priority: "info",
      titleKey: "notif.pack_change_request.title",
      titleParams: { item: sku.name, shop: shopRes.data?.name ?? "" },
      bodyKey: "notif.pack_change_request.body",
      bodyParams: { who: meRes.data?.name ?? "" },
      extraData: { skuId: input.skuId, requestId: inserted.id },
      relatedTable: "sku_pack_change_requests",
      relatedId: inserted.id,
      locationId: input.locationId,
      createdBy: actor.user.id,
      recipients: recipients.map((userId) => ({ userId })),
    });
  }
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_change_request.file", resourceTable: "sku_pack_change_requests", resourceId: inserted.id,
    metadata: { sku_id: input.skuId, location_id: input.locationId, delivery_id: input.deliveryId, has_proposal: input.proposal != null, has_photo: input.photoId != null, notified: recipients.length },
    ipAddress: null, userAgent: null,
  });
  return { id: inserted.id, already: false, added: false };
}

/** Active GMs assigned to the shop; none → active MoO and owner (org-wide). */
async function shopManagers(sb: Sb, locationId: string): Promise<string[]> {
  const { data: links, error } = await sb.from("user_locations").select("user_id").eq("location_id", locationId).eq("active", true)
    .returns<Array<{ user_id: string }>>();
  if (error) throw new Error(`shopManagers links: ${error.message}`);
  const ids = [...new Set((links ?? []).map((l) => l.user_id))];
  if (ids.length > 0) {
    const { data: gms, error: gErr } = await sb.from("users").select("id").in("id", ids).eq("role", "gm").eq("active", true)
      .returns<Array<{ id: string }>>();
    if (gErr) throw new Error(`shopManagers gms: ${gErr.message}`);
    if ((gms ?? []).length > 0) return (gms ?? []).map((g) => g.id);
  }
  const { data: org, error: oErr } = await sb.from("users").select("id").in("role", ["moo", "owner"]).eq("active", true)
    .returns<Array<{ id: string }>>();
  if (oErr) throw new Error(`shopManagers org: ${oErr.message}`);
  return (org ?? []).map((u) => u.id);
}

/** What a later report of the same case ADDED to the open one (chunk-3 review P3a). */
export interface PackRequestAddition { filedBy: string | null; filedAt: string; note: string | null; proposal: PackChangeProposal | null; photoId: string | null }

/** The additions of the given reports, oldest first by real columns (filed_at, id). */
export async function loadRequestAdditions(sb: Sb, requestIds: string[]): Promise<Map<string, Array<PackRequestAddition & { filedById: string }>>> {
  const out = new Map<string, Array<PackRequestAddition & { filedById: string }>>();
  if (requestIds.length === 0) return out;
  const { data, error } = await sb.from("sku_pack_change_request_additions").select("id, request_id, note, proposal, photo_id, filed_by, filed_at")
    .in("request_id", requestIds).order("filed_at", { ascending: true }).order("id", { ascending: true })
    .returns<Array<{ id: string; request_id: string; note: string | null; proposal: PackChangeProposal | null; photo_id: string | null; filed_by: string; filed_at: string }>>();
  if (error) throw new Error(`loadRequestAdditions: ${error.message}`);
  for (const a of data ?? []) {
    const list = out.get(a.request_id) ?? [];
    list.push({ filedBy: null, filedById: a.filed_by, filedAt: a.filed_at, note: a.note, proposal: a.proposal, photoId: a.photo_id ?? null });
    out.set(a.request_id, list);
  }
  return out;
}

export interface OpenPackRequest {
  id: string; skuId: string; skuName: string; locationId: string;
  filedBy: string | null; filedAt: string; note: string | null; proposal: PackChangeProposal | null;
  /** The door's photo (bound to THIS report's shop when filed); shown via /api/photos/{id}. */
  photoId: string | null;
  /** What later reports of the same case added (note, numbers, photo), oldest first. */
  additions: PackRequestAddition[];
}

/** The newest open reports a page may show (newest first; ties by id). */
export const OPEN_REQUESTS_LIMIT = 200;

/**
 * Open reports for the shops the actor may review in (packRequestReviewAllowed; MoO+ every shop),
 * newest first; optionally one SKU. The social media manager is refused (403), never handed a list.
 */
export async function loadOpenPackChangeRequests(actor: AuthContext, opts: { locationIds: string[]; skuId?: string }): Promise<OpenPackRequest[]> {
  if (!packRequestReviewAllowed(actor)) throw new PackChangeRequestError(403, "forbidden");
  const allowed = opts.locationIds.filter((id) => catalogShopAllowed(actor, id));
  if (allowed.length === 0) return [];
  const sb = getServiceRoleClient();
  let q = sb.from("sku_pack_change_requests").select("id, sku_id, location_id, filed_by, filed_at, note, proposal, photo_id")
    .eq("status", "open").in("location_id", allowed);
  if (opts.skuId) q = q.eq("sku_id", opts.skuId);
  const { data, error } = await q.order("filed_at", { ascending: false }).order("id", { ascending: false }).limit(OPEN_REQUESTS_LIMIT)
    .returns<Array<{ id: string; sku_id: string; location_id: string; filed_by: string; filed_at: string; note: string | null; proposal: PackChangeProposal | null; photo_id: string | null }>>();
  if (error) throw new Error(`loadOpenPackChangeRequests: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const additions = await loadRequestAdditions(sb, rows.map((r) => r.id));
  const filers = [...new Set([...rows.map((r) => r.filed_by), ...[...additions.values()].flat().map((a) => a.filedById)])];
  const [{ data: skus, error: sErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from("vendor_items").select("id, name").in("id", [...new Set(rows.map((r) => r.sku_id))]).returns<Array<{ id: string; name: string }>>(),
    sb.from("users").select("id, name").in("id", filers).returns<Array<{ id: string; name: string | null }>>(),
  ]);
  if (sErr) throw new Error(`loadOpenPackChangeRequests skus: ${sErr.message}`);
  if (uErr) throw new Error(`loadOpenPackChangeRequests users: ${uErr.message}`);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id, skuId: r.sku_id, skuName: skuName.get(r.sku_id) ?? "", locationId: r.location_id,
    filedBy: userName.get(r.filed_by) ?? null, filedAt: r.filed_at, note: r.note, proposal: r.proposal,
    photoId: r.photo_id ?? null,
    additions: (additions.get(r.id) ?? []).map(({ filedById, ...a }) => ({ ...a, filedBy: userName.get(filedById) ?? null })),
  }));
}

/**
 * "Nothing changed": close an OPEN report as dismissed. Bound twice before the write: the report
 * must belong to `skuId` (the page that asked — a report for another item is not found here), and
 * the actor must be a reviewer for the report's shop. Guarded: open → dismissed exactly once.
 */
export async function dismissPackChangeRequest(actor: AuthContext, input: { requestId: string; skuId: string }): Promise<void> {
  if (!packRequestReviewAllowed(actor)) throw new PackChangeRequestError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data: req, error } = await sb.from("sku_pack_change_requests").select("id, sku_id, location_id, status")
    .eq("id", input.requestId).maybeSingle<{ id: string; sku_id: string; location_id: string; status: string }>();
  if (error) throw new Error(`dismissPackChangeRequest read: ${error.message}`);
  if (!req || req.sku_id !== input.skuId) throw new PackChangeRequestError(404, "not_found");
  requireLocation(actor, req.location_id, "review");
  if (req.status !== "open") throw new PackChangeRequestError(409, "already_resolved");
  const { error: uErr, count } = await sb.from("sku_pack_change_requests")
    .update({ status: "dismissed", resolved_by: actor.user.id, resolved_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", input.requestId).eq("sku_id", input.skuId).eq("status", "open");
  if (uErr) throw new Error(`dismissPackChangeRequest update: ${uErr.message}`);
  if (count !== 1) throw new PackChangeRequestError(409, "already_resolved");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_change_request.resolve", resourceTable: "sku_pack_change_requests", resourceId: input.requestId,
    metadata: { sku_id: req.sku_id, location_id: req.location_id, outcome: "dismissed", version_id: null },
    ipAddress: null, userAgent: null,
  });
}

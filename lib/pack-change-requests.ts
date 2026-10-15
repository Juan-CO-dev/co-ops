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
export async function filePackChangeRequest(actor: AuthContext, input: FilePackChangeInput): Promise<{ id: string; already: boolean }> {
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

  const { data: inserted, error } = await sb.from("sku_pack_change_requests").insert({
    sku_id: input.skuId, location_id: input.locationId, delivery_id: input.deliveryId,
    note, proposal: input.proposal, photo_id: input.photoId, filed_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) {
    // One OPEN report per (sku, shop): a second report of the same case joins the first.
    if (error.code === "23505") {
      const { data: open, error: oErr } = await sb.from("sku_pack_change_requests").select("id")
        .eq("sku_id", input.skuId).eq("location_id", input.locationId).eq("status", "open").maybeSingle<{ id: string }>();
      if (oErr) throw new Error(`filePackChangeRequest open: ${oErr.message}`);
      if (open) return { id: open.id, already: true };
    }
    throw new Error(`filePackChangeRequest insert: ${error.message}`);
  }
  if (!inserted) throw new Error("filePackChangeRequest returned no row");

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
  return { id: inserted.id, already: false };
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

export interface OpenPackRequest {
  id: string; skuId: string; skuName: string; locationId: string;
  filedBy: string | null; filedAt: string; note: string | null; proposal: PackChangeProposal | null;
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
  let q = sb.from("sku_pack_change_requests").select("id, sku_id, location_id, filed_by, filed_at, note, proposal")
    .eq("status", "open").in("location_id", allowed);
  if (opts.skuId) q = q.eq("sku_id", opts.skuId);
  const { data, error } = await q.order("filed_at", { ascending: false }).order("id", { ascending: false }).limit(OPEN_REQUESTS_LIMIT)
    .returns<Array<{ id: string; sku_id: string; location_id: string; filed_by: string; filed_at: string; note: string | null; proposal: PackChangeProposal | null }>>();
  if (error) throw new Error(`loadOpenPackChangeRequests: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const [{ data: skus, error: sErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from("vendor_items").select("id, name").in("id", [...new Set(rows.map((r) => r.sku_id))]).returns<Array<{ id: string; name: string }>>(),
    sb.from("users").select("id, name").in("id", [...new Set(rows.map((r) => r.filed_by))]).returns<Array<{ id: string; name: string | null }>>(),
  ]);
  if (sErr) throw new Error(`loadOpenPackChangeRequests skus: ${sErr.message}`);
  if (uErr) throw new Error(`loadOpenPackChangeRequests users: ${uErr.message}`);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id, skuId: r.sku_id, skuName: skuName.get(r.sku_id) ?? "", locationId: r.location_id,
    filedBy: userName.get(r.filed_by) ?? null, filedAt: r.filed_at, note: r.note, proposal: r.proposal,
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

/**
 * lib/order-guides.ts — the vendor order guide (V3-A). DB layer over the pure model.
 *
 * Read law (spec §3): PO surfaces read `snapshot ?? live`. `guideKeysFor(skuIds)` is that
 * live read — one query, keyed by SKU — used by both draft-creation paths (snapshot) and by
 * loadPoDetail / the walker preview (fallback). Position = section.position*1000 + line.position.
 *
 * Write law (spec §6/§7, hardened by the Astra review of 2026-09-17, findings 1 + 2): the
 * editor sends the whole model + the `updatedAt` it loaded, and the ENTIRE rewrite happens
 * inside ONE transaction — `save_order_guide` (migration 0207, SECURITY DEFINER, service-role
 * only). It locks the guide row, refuses a stale token BEFORE it writes anything, validates
 * that every submitted section/line id belongs to this guide and every SKU to this vendor,
 * then rewrites the children dense and advances the token. The old shape — delete, then a
 * park-at-a-high-offset upsert, then a final upsert, as three separate PostgREST requests —
 * could let two saves interleave (the loser heard 409 only after its writes landed) and let
 * a concurrent `guideKeysFor` read a parked position onto a PO line. Audit still stores the
 * full before/after, and `before` is read BEFORE the RPC so it is the state the RPC replaced.
 *
 * THE MODEL AND THE PURE REDUCER LIVE IN `lib/order-guides-shared.ts` and are re-exported here,
 * because this file imports the service-role client (`server-only`) and the admin Order-guide
 * panel is a client island. Server consumers import either path; client code must import the
 * edit module directly — the AGENTS.md § Module boundaries split, one file further along the
 * arc that already ships `lib/order-guide-sort.ts` as its pure comparator.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import {
  OrderGuideError,
  positionOf,
  renumber,
  type GuideKey,
  type GuideModel,
} from "@/lib/order-guides-shared";

export {
  applyGuideEdit,
  OrderGuideError,
  positionOf,
  renumber,
} from "@/lib/order-guides-shared";
export type {
  GuideEdit,
  GuideKey,
  GuideLine,
  GuideModel,
  GuideSection,
} from "@/lib/order-guides-shared";

// ── DB layer ────────────────────────────────────────────────────────────────────────────

type GuideRow = { id: string; vendor_id: string; name: string; updated_at: string };
type SectionRow = { id: string; guide_id: string; name: string; position: number };
type LineRow = { id: string; section_id: string; position: number; sku_id: string | null; label: string; item_number: string | null; note: string | null };

/** The vendor's guide, or null when none exists yet. */
export async function loadOrderGuide(vendorId: string): Promise<GuideModel | null> {
  const sb = getServiceRoleClient();
  const { data: g, error: gErr } = await sb.from("vendor_order_guides").select("id, vendor_id, name, updated_at").eq("vendor_id", vendorId).maybeSingle<GuideRow>();
  if (gErr) throw new Error(`loadOrderGuide: ${gErr.message}`);
  if (!g) return null;
  const { data: sections, error: sErr } = await sb.from("order_guide_sections").select("id, guide_id, name, position").eq("guide_id", g.id).order("position").returns<SectionRow[]>();
  if (sErr) throw new Error(`loadOrderGuide sections: ${sErr.message}`);
  const sectionIds = (sections ?? []).map((s) => s.id);
  const lineRead = sectionIds.length
    ? await sb.from("order_guide_lines").select("id, section_id, position, sku_id, label, item_number, note").in("section_id", sectionIds).order("position").returns<LineRow[]>()
    : { data: [] as LineRow[], error: null };
  if (lineRead.error) throw new Error(`loadOrderGuide lines: ${lineRead.error.message}`);
  const lines = lineRead.data;
  return {
    guideId: g.id, vendorId: g.vendor_id, name: g.name, updatedAt: g.updated_at,
    sections: (sections ?? []).map((s) => ({
      id: s.id, name: s.name, position: s.position,
      lines: (lines ?? []).filter((l) => l.section_id === s.id).map((l) => ({ id: l.id, position: l.position, skuId: l.sku_id, label: l.label, itemNumber: l.item_number, note: l.note })),
    })),
  };
}

/** LIVE guide keys for a set of SKUs (one query). Missing = not on any guide. */
export async function guideKeysFor(skuIds: readonly string[]): Promise<Map<string, GuideKey>> {
  const out = new Map<string, GuideKey>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("order_guide_lines")
    .select("sku_id, position, order_guide_sections!inner(name, position)")
    .in("sku_id", [...new Set(skuIds)])
    .returns<Array<{ sku_id: string; position: number; order_guide_sections: { name: string; position: number } }>>();
  if (error) throw new Error(`guideKeysFor: ${error.message}`);
  for (const r of data ?? []) out.set(r.sku_id, { position: positionOf(r.order_guide_sections.position, r.position), section: r.order_guide_sections.name });
  return out;
}

export const ORDER_GUIDE_EDIT_MIN = 7; // GM+

/**
 * Start a guide for a vendor that has none — the admin panel's only creation path (§6).
 *
 * Deliberately EMPTY, not pre-filled from the vendor's SKUs: seed 37 is what turns a
 * laminated sheet into rows, and a starter guide it authors carries `[seed-37 starter]`.
 * A guide made here is a manager saying "I have this vendor's sheet in front of me", so the
 * `source_note` names the human, and the first section is theirs to add.
 *
 * `unique (vendor_id)` is the real fence; the pre-read is the READABLE error (409 `exists`)
 * rather than a raw constraint message. The audit row carries `before: null` — the shape
 * saveOrderGuide writes, so the two halves of "how did this guide get this way?" read the same.
 */
export async function createEmptyGuide(actor: AuthContext, vendorId: string): Promise<GuideModel> {
  const sb = getServiceRoleClient();
  const existing = await loadOrderGuide(vendorId);
  if (existing) throw new OrderGuideError(409, "exists", "This vendor already has an order guide");

  const { data: vendor, error: vErr } = await sb.from("vendors").select("name").eq("id", vendorId).maybeSingle<{ name: string }>();
  if (vErr) throw new Error(`createEmptyGuide vendor: ${vErr.message}`);
  if (!vendor) throw new OrderGuideError(404, "vendor_not_found", "No such vendor");

  const { data: inserted, error } = await sb
    .from("vendor_order_guides")
    .insert({ vendor_id: vendorId, name: `${vendor.name} — guide`, source_note: `[admin] created by ${actor.user.name}` })
    .select("id")
    .single<{ id: string }>();
  if (error || !inserted) throw new Error(`createEmptyGuide: ${error?.message ?? "insert returned no row"}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "vendor.order_guide.edited",
    resourceTable: "vendor_order_guides", resourceId: inserted.id,
    metadata: { vendor_id: vendorId, before: null, after: { name: `${vendor.name} — guide`, sections: [] } },
    ipAddress: null, userAgent: null,
  });
  return (await loadOrderGuide(vendorId))!;
}

/**
 * Every refusal `save_order_guide` can raise (migration 0207), and the HTTP shape the admin
 * route turns it into. The RPC raises the CODE as the message, so this table is the whole
 * mapping — a message we do not recognise is a real 500, never a silently-swallowed 400.
 */
const RPC_REFUSALS: Record<string, { status: number; message: string }> = {
  guide_stale: { status: 409, message: "The guide changed since you loaded it" },
  sku_already_placed: { status: 409, message: "That SKU is on two lines" },
  section_name_taken: { status: 409, message: "That section name is already used on this guide" },
  foreign_section: { status: 400, message: "That section belongs to another vendor's guide" },
  foreign_line: { status: 400, message: "That line belongs to another vendor's guide" },
  foreign_sku: { status: 400, message: "That SKU is not in this vendor's active catalog" },
  invalid_payload: { status: 400, message: "The guide payload is not well formed" },
  guide_not_found: { status: 404, message: "No guide for this vendor" },
};

function rpcRefusal(message: string): OrderGuideError | null {
  const raw = message.trim();
  const exact = RPC_REFUSALS[raw];
  if (exact) return new OrderGuideError(exact.status, raw, exact.message);
  for (const [code, spec] of Object.entries(RPC_REFUSALS)) {
    if (raw.includes(code)) return new OrderGuideError(spec.status, code, spec.message);
  }
  return null;
}

/**
 * The cheap TS half of validation: the shape a manager's own editor can produce. The RPC
 * re-checks all of it (and the ownership questions TS cannot answer) inside the transaction —
 * this exists so the common refusals cost no round trip and read in the reducer's words.
 */
function assertSaveable(model: GuideModel): void {
  if (!model.name.trim()) throw new OrderGuideError(400, "invalid_payload", "A guide name is required");
  const names = new Set<string>();
  const skus = new Set<string>();
  for (const s of model.sections) {
    const name = s.name.trim().toLowerCase();
    if (!name) throw new OrderGuideError(400, "invalid_payload", "A section name is required");
    if (names.has(name)) throw new OrderGuideError(409, "section_name_taken", RPC_REFUSALS.section_name_taken!.message);
    names.add(name);
    for (const l of s.lines) {
      if (!l.label.trim()) throw new OrderGuideError(400, "invalid_payload", "A line label is required");
      if (!l.skuId) continue;
      if (skus.has(l.skuId)) throw new OrderGuideError(409, "sku_already_placed", RPC_REFUSALS.sku_already_placed!.message);
      skus.add(l.skuId);
    }
  }
}

/**
 * Persist a whole model (already reduced client-side or here). ONE transaction, in the DB:
 * `save_order_guide` locks the guide, re-checks `expectedUpdatedAt` under the lock, validates
 * the payload's ownership, rewrites sections/lines dense, and advances `updated_at`.
 *
 * The `before` read here is NOT the concurrency check — the RPC's is, under the row lock. It
 * is read first so the audit row carries the state the RPC actually replaced, and so a guide
 * that does not exist is a 404 before we spend an RPC on it.
 */
export async function saveOrderGuide(actor: AuthContext, vendorId: string, next: GuideModel, expectedUpdatedAt: string): Promise<GuideModel> {
  const sb = getServiceRoleClient();
  const before = await loadOrderGuide(vendorId);
  if (!before) throw new OrderGuideError(404, "not_found", "No guide for this vendor");
  if (before.updatedAt !== expectedUpdatedAt) throw new OrderGuideError(409, "guide_stale", RPC_REFUSALS.guide_stale!.message);
  const model = renumber(next);
  assertSaveable(model);

  const { error } = await sb.rpc("save_order_guide", {
    p_guide_id: before.guideId,
    p_expected_updated_at: expectedUpdatedAt,
    p_name: model.name,
    p_sections: model.sections,
  });
  if (error) {
    const refusal = rpcRefusal(error.message ?? "");
    if (refusal) throw refusal;
    throw new Error(`saveOrderGuide: ${error.message}`);
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "vendor.order_guide.edited",
    resourceTable: "vendor_order_guides", resourceId: before.guideId,
    metadata: { vendor_id: vendorId, before: stripForAudit(before), after: stripForAudit(model) },
    ipAddress: null, userAgent: null,
  });
  return (await loadOrderGuide(vendorId))!;
}

function stripForAudit(m: GuideModel) {
  return { name: m.name, sections: m.sections.map((s) => ({ name: s.name, position: s.position, lines: s.lines.map((l) => ({ label: l.label, sku_id: l.skuId, position: l.position }) ) })) };
}

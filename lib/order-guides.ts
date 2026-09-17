/**
 * lib/order-guides.ts — the vendor order guide (V3-A). DB layer over the pure model.
 *
 * Read law (spec §3): PO surfaces read `snapshot ?? live`. `guideKeysFor(skuIds)` is that
 * live read — one query, keyed by SKU — used by both draft-creation paths (snapshot) and by
 * loadPoDetail / the walker preview (fallback). Position = section.position*1000 + line.position.
 *
 * Write law (spec §6/§7): the editor sends the whole model + the `updatedAt` it loaded;
 * stale → 409 guide_stale; the server rewrites positions dense (renumber) inside one RPC-less
 * sequence guarded by the deferrable unique constraints; audit stores the full before/after.
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
 * Persist a whole model (already reduced client-side or here). Precondition: `expectedUpdatedAt`
 * equals the stored updated_at, else 409 guide_stale. Writes: upsert sections/lines by id,
 * delete rows absent from the model, bump updated_at, audit full before/after.
 */
export async function saveOrderGuide(actor: AuthContext, vendorId: string, next: GuideModel, expectedUpdatedAt: string): Promise<GuideModel> {
  const sb = getServiceRoleClient();
  const before = await loadOrderGuide(vendorId);
  if (!before) throw new OrderGuideError(404, "not_found", "No guide for this vendor");
  if (before.updatedAt !== expectedUpdatedAt) throw new OrderGuideError(409, "guide_stale", "The guide changed since you loaded it");
  const model = renumber(next);
  // One SKU per line, across the whole model (the DB unique index is the floor; this is the readable error).
  const seen = new Set<string>();
  for (const s of model.sections) for (const l of s.lines) { if (l.skuId) { if (seen.has(l.skuId)) throw new OrderGuideError(409, "sku_already_placed", "That SKU is on two lines"); seen.add(l.skuId); } }
  const now = new Date().toISOString();
  const keepSections = new Set(model.sections.map((s) => s.id));
  const keepLines = new Set(model.sections.flatMap((s) => s.lines.map((l) => l.id)));
  // Delete first (frees names/positions), then upsert with positions offset to avoid transient collisions.
  const goneLines = before.sections.flatMap((s) => s.lines).filter((l) => !keepLines.has(l.id)).map((l) => l.id);
  if (goneLines.length) { const { error } = await sb.from("order_guide_lines").delete().in("id", goneLines); if (error) throw new Error(`saveOrderGuide delete lines: ${error.message}`); }
  const goneSections = before.sections.filter((s) => !keepSections.has(s.id)).map((s) => s.id);
  if (goneSections.length) { const { error } = await sb.from("order_guide_sections").delete().in("id", goneSections); if (error) throw new Error(`saveOrderGuide delete sections: ${error.message}`); }
  // Two-phase positions: park at +100000 then set final, so (guide_id, position) never collides mid-way.
  for (const phase of ["park", "final"] as const) {
    const sRows = model.sections.map((s) => ({ id: s.id, guide_id: before.guideId, name: s.name, position: phase === "park" ? s.position + 100000 : s.position }));
    const { error: sErr } = await sb.from("order_guide_sections").upsert(sRows, { onConflict: "id" });
    if (sErr) throw new Error(`saveOrderGuide sections (${phase}): ${sErr.message}`);
    const lRows = model.sections.flatMap((s) => s.lines.map((l) => ({ id: l.id, section_id: s.id, position: phase === "park" ? l.position + 100000 : l.position, sku_id: l.skuId, label: l.label, item_number: l.itemNumber, note: l.note })));
    if (lRows.length) { const { error: lErr } = await sb.from("order_guide_lines").upsert(lRows, { onConflict: "id" }); if (lErr) throw new Error(`saveOrderGuide lines (${phase}): ${lErr.message}`); }
  }
  const { error: uErr, count } = await sb.from("vendor_order_guides").update({ updated_at: now, name: model.name }, { count: "exact" }).eq("id", before.guideId).eq("updated_at", expectedUpdatedAt);
  if (uErr || count !== 1) throw new OrderGuideError(409, "guide_stale", "The guide changed while saving");
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

/**
 * lib/order-guides-shared.ts — the vendor order guide's MODEL + PURE edit reducer (V3-A §6).
 *
 * WHY THIS IS ITS OWN FILE. `lib/order-guides.ts` is the DB layer, and it imports
 * `lib/supabase-server.ts`, which carries `import "server-only"` — so a client component
 * that imported the reducer through it would fail the build (AGENTS.md § Module boundaries).
 * The admin Order-guide panel is a client island that reduces edits locally before POSTing
 * the whole model, so the pure half lives here and `lib/order-guides.ts` re-exports it;
 * server consumers keep their `@/lib/order-guides` paths unchanged.
 *
 * NO I/O IN THIS FILE, EVER. Position law (spec §3): a SKU's guide position is
 * `section.position * 1000 + line.position`, which is what `positionOf` spells and what
 * `guideKeysFor` reads. Every edit ends in `renumber`, so positions are dense from 1 in
 * array order and the editor never has to reason about gaps.
 */

export interface GuideLine { id: string; position: number; skuId: string | null; label: string; itemNumber: string | null; note: string | null }
export interface GuideSection { id: string; name: string; position: number; lines: GuideLine[] }
export interface GuideModel { guideId: string; vendorId: string; name: string; updatedAt: string; sections: GuideSection[] }
export interface GuideKey { position: number; section: string }

export type GuideEdit =
  | { kind: "move_line"; lineId: string; direction: "up" | "down" }
  | { kind: "move_line_to_section"; lineId: string; sectionId: string }
  | { kind: "move_section"; sectionId: string; direction: "up" | "down" }
  | { kind: "add_line"; sectionId: string; skuId: string; label: string; itemNumber: string | null }
  | { kind: "set_line_sku"; lineId: string; skuId: string }
  | { kind: "remove_line"; lineId: string }
  | { kind: "add_section"; name: string }
  | { kind: "rename_section"; sectionId: string; name: string }
  | { kind: "remove_section"; sectionId: string };

export class OrderGuideError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const clone = (m: GuideModel): GuideModel => JSON.parse(JSON.stringify(m)) as GuideModel;

export function renumber(m: GuideModel): GuideModel {
  const out = clone(m);
  out.sections.forEach((s, i) => { s.position = i + 1; s.lines.forEach((l, j) => { l.position = j + 1; }); });
  return out;
}

export function positionOf(sectionPosition: number, linePosition: number): number {
  return sectionPosition * 1000 + linePosition;
}

function findLine(m: GuideModel, lineId: string): { s: GuideSection; idx: number } {
  for (const s of m.sections) { const idx = s.lines.findIndex((l) => l.id === lineId); if (idx >= 0) return { s, idx }; }
  throw new OrderGuideError(404, "line_not_found", `line ${lineId} is not on this guide`);
}
function findSection(m: GuideModel, sectionId: string): { s: GuideSection; idx: number } {
  const idx = m.sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) throw new OrderGuideError(404, "section_not_found", `section ${sectionId} is not on this guide`);
  return { s: m.sections[idx]!, idx };
}
function assertSkuFree(m: GuideModel, skuId: string, exceptLineId?: string): void {
  for (const s of m.sections) for (const l of s.lines) {
    if (l.skuId === skuId && l.id !== exceptLineId) throw new OrderGuideError(409, "sku_already_placed", "That SKU is already on the guide");
  }
}
function assertSectionNameFree(m: GuideModel, name: string, exceptId?: string): void {
  const n = name.trim().toLowerCase();
  if (!n) throw new OrderGuideError(400, "invalid_payload", "A section name is required");
  if (m.sections.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === n)) throw new OrderGuideError(409, "section_name_taken", "That section name is already used on this guide");
}
const swap = <T,>(arr: T[], i: number, j: number) => { const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t; };
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`);

/** PURE reducer: apply one edit and renumber. Throws OrderGuideError on an illegal edit. */
export function applyGuideEdit(model: GuideModel, edit: GuideEdit): GuideModel {
  const m = clone(model);
  switch (edit.kind) {
    case "move_line": {
      const { s, idx } = findLine(m, edit.lineId);
      const j = edit.direction === "up" ? idx - 1 : idx + 1;
      if (j >= 0 && j < s.lines.length) swap(s.lines, idx, j);
      break;
    }
    case "move_line_to_section": {
      const { s, idx } = findLine(m, edit.lineId);
      const target = findSection(m, edit.sectionId).s;
      const [line] = s.lines.splice(idx, 1);
      target.lines.push(line!);
      break;
    }
    case "move_section": {
      const { idx } = findSection(m, edit.sectionId);
      const j = edit.direction === "up" ? idx - 1 : idx + 1;
      if (j >= 0 && j < m.sections.length) swap(m.sections, idx, j);
      break;
    }
    case "add_line": {
      assertSkuFree(m, edit.skuId);
      const label = edit.label.trim();
      if (!label) throw new OrderGuideError(400, "invalid_payload", "A line label is required");
      findSection(m, edit.sectionId).s.lines.push({ id: newId(), position: 0, skuId: edit.skuId, label, itemNumber: edit.itemNumber, note: null });
      break;
    }
    case "set_line_sku": {
      assertSkuFree(m, edit.skuId, edit.lineId);
      const { s, idx } = findLine(m, edit.lineId);
      s.lines[idx]!.skuId = edit.skuId;
      break;
    }
    case "remove_line": {
      const { s, idx } = findLine(m, edit.lineId);
      s.lines.splice(idx, 1);
      break;
    }
    case "add_section": {
      assertSectionNameFree(m, edit.name);
      m.sections.push({ id: newId(), name: edit.name.trim(), position: 0, lines: [] });
      break;
    }
    case "rename_section": {
      assertSectionNameFree(m, edit.name, edit.sectionId);
      findSection(m, edit.sectionId).s.name = edit.name.trim();
      break;
    }
    case "remove_section": {
      const { s, idx } = findSection(m, edit.sectionId);
      if (s.lines.length > 0) throw new OrderGuideError(409, "section_not_empty", "That section is not empty — move or remove its lines first");
      m.sections.splice(idx, 1);
      break;
    }
  }
  return renumber(m);
}

/**
 * THE READ LAW (spec §3): a PO line renders by its snapshot when it has one, else by the live
 * guide, else it is "not on the guide". Both halves of the snapshot travel together — a line
 * snapshotted before 0205 has a position but no section, and still reads as snapshotted.
 */
export function resolveGuideKey(
  snapshot: { position: number | null; section: string | null },
  live: GuideKey | undefined,
): { position: number | null; section: string | null } {
  if (snapshot.position != null) return { position: snapshot.position, section: snapshot.section };
  if (live) return { position: live.position, section: live.section };
  return { position: null, section: null };
}

/**
 * The confirmed snapshot's OWN record of a line's guide key, or `undefined` when it has none.
 *
 * `undefined` and a recorded `null` are different answers and the difference is the whole point
 * (Astra r2-2): a snapshot that CARRIES the fields and records null is saying "this line was off
 * the guide when the order was frozen", which is authoritative. A snapshot written before 0205
 * has no `guideSection` at all — it cannot say anything — and that is the only case that may
 * fall back to the live guide.
 */
function frozenSnapshotKey(confirmedSnapshot: unknown, skuId: string): { position: number | null; section: string | null } | undefined {
  if (!confirmedSnapshot || typeof confirmedSnapshot !== "object") return undefined;
  const lines = (confirmedSnapshot as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return undefined;
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    if (l.skuId !== skuId) continue;
    if (l.guideSection === undefined) return undefined; // pre-0205 shape: it has no opinion
    return {
      position: typeof l.guidePos === "number" ? l.guidePos : null,
      section: typeof l.guideSection === "string" ? l.guideSection : null,
    };
  }
  return undefined;
}

/**
 * THE READ LAW FOR ONE PO LINE, all of it, in one place (spec §3 + Astra r2-2, BC-013/BC-042).
 *
 * A DRAFT reads `snapshot ?? live`: the guide is still moving under it, a line added after an
 * edit has no snapshot yet, and rendering it in today's guide order is the helpful answer.
 *
 * ONCE A PO LEAVES DRAFT ITS BODY NEVER CHANGES SHAPE. `confirmPO` freezes the effective key
 * into `confirmed_snapshot`, so that snapshot — not the `po_lines` columns, and never the live
 * guide — is what the panel and the copied body read. Without this, a SKU that was off-guide at
 * confirmation and placed on the guide afterwards MOVED in the panel while the email, which
 * reads the snapshot and has no fallback, kept it where it was frozen: the two halves of one
 * order disagreeing, with no concurrent request and no failure anywhere. The advisory `po_lines`
 * patch can also fail (it is deliberately log-and-continue), and that must not change what the
 * manager reads either — which is why the SNAPSHOT is consulted and the columns are not.
 */
export function poLineGuideKey(input: {
  /** `purchase_orders.status`. Only "draft" reads live. */
  status: string;
  /** `purchase_orders.confirmed_snapshot`, raw. */
  confirmedSnapshot: unknown;
  skuId: string;
  /** The `po_lines` snapshot columns. */
  snapshot: { position: number | null; section: string | null };
  live: GuideKey | undefined;
}): { position: number | null; section: string | null } {
  if (input.status !== "draft") {
    const frozen = frozenSnapshotKey(input.confirmedSnapshot, input.skuId);
    if (frozen) return frozen;
  }
  return resolveGuideKey(input.snapshot, input.live);
}

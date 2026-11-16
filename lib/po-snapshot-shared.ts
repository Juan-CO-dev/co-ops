/**
 * lib/po-snapshot-shared.ts — PURE, client-safe. The ONE reading of a purchase order's `confirmed_snapshot.lines`
 * (W19/B110). The snapshot is what was confirmed and what the vendor email sends, so everything that shows or sends
 * a PO past draft reads its lines through here: lib/po-email.ts (the email) and lib/purchase-orders.ts loadPoDetail
 * (the panel and its Copy / mailto body). jsonb is untyped on read, so every field is narrowed defensively.
 *
 * Qty-0 lines are KEPT (a removed line the panel shows as removed); a sender filters them itself
 * (`renderPoBodyLines` drops qty 0, the email gate keeps `qty > 0`).
 */
export interface SnapshotLine {
  skuId: string;
  name: string;
  itemNumber: string | null;
  qty: number;
  unitLabel: string | null;
  priceCents: number | null;
  guidePos: number | null;
  /** V3-A: section name frozen with the snapshot; null on pre-0205 snapshots. */
  guideSection: string | null;
}

/** The snapshot's lines in snapshot order. Malformed entries (not an object) are dropped; a non-numeric qty is 0.
 *  A missing or malformed snapshot yields []. */
export function parseSnapshotLines(raw: unknown): SnapshotLine[] {
  const lines = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as { lines?: unknown }).lines : undefined;
  if (!Array.isArray(lines)) return [];
  const out: SnapshotLine[] = [];
  for (const l of lines) {
    if (typeof l !== "object" || l === null || Array.isArray(l)) continue;
    const r = l as Record<string, unknown>;
    out.push({
      skuId: typeof r.skuId === "string" ? r.skuId : "",
      name: typeof r.name === "string" ? r.name : "(sku)",
      itemNumber: typeof r.itemNumber === "string" ? r.itemNumber : null,
      qty: typeof r.qty === "number" && Number.isFinite(r.qty) ? r.qty : 0,
      unitLabel: typeof r.unitLabel === "string" ? r.unitLabel : null,
      priceCents: typeof r.priceCents === "number" && Number.isFinite(r.priceCents) ? r.priceCents : null,
      guidePos: typeof r.guidePos === "number" ? r.guidePos : null,
      guideSection: typeof r.guideSection === "string" ? r.guideSection : null,
    });
  }
  return out;
}

/** W19/B110 fix round 1: the lines a PO past draft FROZE, or null when it never froze any. A snapshot whose `lines`
 *  is an array is authoritative even when EMPTY (that is what was confirmed, and what the email reads: it refuses
 *  `no_order_lines`), so a po_line inserted after the freeze must not show up in its place. Only a missing or
 *  malformed snapshot (a legacy PO confirmed before snapshots) is null, and the caller falls back to po_lines. */
export function frozenSnapshotLines(raw: unknown): SnapshotLine[] | null {
  const lines = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as { lines?: unknown }).lines : undefined;
  return Array.isArray(lines) ? parseSnapshotLines(raw) : null;
}

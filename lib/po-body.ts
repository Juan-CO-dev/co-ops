/**
 * lib/po-body.ts — PURE. The single renderer for a purchase order's readable body: the copied
 * text in the PO panel and the text half of the vendor email are byte-identical because both
 * call renderPoBodyText. Order = lib/order-guide-sort (section headers, not-on-guide last).
 */
import { groupByGuideSection, NOT_ON_GUIDE } from "@/lib/order-guide-sort";

export type BodyT = (key: string, vars?: Record<string, string | number>) => string;
export interface PoBodyLine {
  skuName: string; orderQty: number; orderUnitLabel: string | null; itemNumber: string | null;
  guidePosition: number | null; guideSection: string | null;
}
export interface PoBodyInput { displayCode: string; shopLabel: string; dateLabel: string; lines: readonly PoBodyLine[] }

export function renderPoBodyLines(lines: readonly PoBodyLine[], t: BodyT): string[] {
  const sent = lines.filter((l) => l.orderQty > 0).map((l) => ({ ...l, name: l.skuName, position: l.guidePosition, section: l.guideSection }));
  const out: string[] = [];
  for (const g of groupByGuideSection(sent)) {
    if (g.section === NOT_ON_GUIDE) out.push(t("ordering.body.not_on_guide"));
    else if (g.section !== null) out.push(t("ordering.body.section", { section: g.section }));
    for (const l of g.rows) out.push(t("ordering.email.body_line", { sku: l.skuName, qty: l.orderQty, unit: l.orderUnitLabel ?? t("ordering.unit_generic"), item: l.itemNumber ?? "—" }));
  }
  return out;
}

export function renderPoBodyText(input: PoBodyInput, t: BodyT): string {
  const po = t("ordering.email.body_po", { code: input.displayCode });
  const header = t("ordering.email.body_header", { shop: input.shopLabel, date: input.dateLabel });
  return `${po}\n${header}\n\n${renderPoBodyLines(input.lines, t).join("\n")}`;
}

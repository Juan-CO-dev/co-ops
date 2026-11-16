/** Item 1 PR B (phase 1): Toast line prices. Pure, zero I/O. Plan: C:\co\audit\item1-toast-r3.md §3.
 * Filled only while TOAST_LINE_PRICES=1. Never part of content_hash (see legacyHashInput).
 * Toast prices on a parent INCLUDE quantity and modifiers: line amounts are never multiplied,
 * modifiers are never summed, and receipt_line_cents is the only per-unit figure. */
import { excluded, type CheckSalesAccounting } from "./sales-accounting-shared";
import { lineCents } from "./money-shared";

export { lineCents };

type Row = Record<string, unknown>;
type Cents = (v: unknown) => number | null;
const obj = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(obj) : [];
const ENUM = /^[A-Z_]{1,40}$/;
const enumOrNull = (v: unknown): string | null => typeof v === "string" && ENUM.test(v) ? v : null;
const itemGuid = (s: Row): string | null => { const g = obj(s.item).guid; return typeof g === "string" && g.trim() ? g : null; };

export interface LinePriceFields {
  price_v: 1;
  net_cents: number | null;
  gross_cents: number | null;
  receipt_line_cents: number | null;
  tax_cents: number | null;
  tax_inclusion: string | null;
  selection_type: string | null;
  deferred: boolean;
}

/** §3.1. externalPriceAmount / openPriceAmount are deliberately never read. */
export function lineFields(s: Row): LinePriceFields {
  return { price_v: 1, net_cents: lineCents(s.price), gross_cents: lineCents(s.preDiscountPrice),
    receipt_line_cents: lineCents(s.receiptLinePrice), tax_cents: lineCents(s.tax),
    tax_inclusion: enumOrNull(s.taxInclusion), selection_type: enumOrNull(s.selectionType), deferred: s.deferred === true };
}

export interface CheckLinePrices {
  v: 1;
  selections_present: boolean;
  heads: number;
  uncaptured_heads: number;
  mixed_heads: number;
  net_cents: number | null;
  source_complete: boolean;
  net_complete: boolean;
  gross_complete: boolean;
  receipt_line_complete: boolean;
}

/** §3.3: a revenue head is a root selection that is not deleted, voided, SPECIAL_REQUEST or excluded. */
export const isRevenueHead = (s: Row) => s.deleted !== true && s.voided !== true && s.selectionType !== "SPECIAL_REQUEST" && !excluded(s);

const hasMixedDescendant = (s: Row): boolean =>
  rows(s.modifiers).some((m) => excluded(m) || m.voided === true || m.deleted === true || hasMixedDescendant(m));

/** §3.4 per-check completeness, stored as accounting.line_prices. `accounting` is the same
 * capture's projection of the same check, so both sides read one snapshot. */
export function checkLinePrices(check: Row, accounting: CheckSalesAccounting, cents: Cents): CheckLinePrices {
  const selections_present = Array.isArray(check.selections);
  const roots = rows(check.selections);
  let heads = 0, uncaptured = 0, mixed = 0;
  let net: number | null = 0;
  let allNet = true, allGross = true, allReceipt = true;
  for (const s of roots) {
    if (s.deleted === true || s.voided === true) continue;
    if (s.selectionType === "SPECIAL_REQUEST") {
      // A priced (or unpriceable) root note is revenue the capture cannot see.
      if (lineCents(s.price) !== 0) uncaptured++;
      continue;
    }
    if (excluded(s)) continue;
    heads++;
    if (!itemGuid(s)) { uncaptured++; continue; }
    if (hasMixedDescendant(s)) mixed++;
    const f = lineFields(s);
    net = net === null || f.net_cents === null ? null : net + f.net_cents;
    if (f.net_cents === null) allNet = false;
    if (f.gross_cents === null) allGross = false;
    const quantity = s.quantity;
    if (f.receipt_line_cents === null || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) allReceipt = false;
  }
  const amount = cents(check.amount);
  const services = accounting.service_charges_cents;
  const itemFigure = amount === null || services === null ? null : amount - services;
  const source_complete = selections_present && uncaptured === 0 && (heads > 0 || itemFigure === 0);
  return {
    v: 1, selections_present, heads, uncaptured_heads: uncaptured, mixed_heads: mixed, net_cents: net,
    source_complete,
    net_complete: source_complete && allNet && accounting.pre_refund_cents !== null && net === accounting.pre_refund_cents,
    gross_complete: source_complete && allGross && mixed === 0,
    receipt_line_complete: source_complete && allReceipt,
  };
}
